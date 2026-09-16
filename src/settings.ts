import { AbstractInputSuggest, App, PluginSettingTab, Setting } from "obsidian";
import type LocalGraphListPlugin from "./main";

/** Display key that follows whatever the list is sorted by. */
export const SORT_PROPERTY = "sort";

/** Display key for the graph-proximity score. */
export const PROXIMITY_PROPERTY = "proximity";

export type SortKey =
  | "proximity"
  | "created"
  | "modified"
  | "property"
  | "title";
export type SortDirection = "asc" | "desc";

export interface LocalGraphListSettings {
  sortKey: SortKey;
  /** Frontmatter key (or file.* pseudo-key) used when sortKey is "property". */
  sortProperty: string;
  sortDirection: SortDirection;
  /** Split the list into Links to / Linked from instead of one flat list. */
  separateDirections: boolean;
  /** Frontmatter keys (or file.* pseudo-keys) rendered under each title. */
  properties: string[];
  /** Prefix each value with its property name. */
  showPropertyNames: boolean;
  /** Number the rows within each group. */
  showIndex: boolean;
  /** Include non-note links (images, PDFs, other attachments). */
  includeAttachments: boolean;
  /** Append unlinked outbound mentions as ghost rows. */
  showMentions: boolean;
}

export const DEFAULT_SETTINGS: LocalGraphListSettings = {
  sortKey: "proximity",
  sortProperty: "created",
  sortDirection: "desc",
  separateDirections: true,
  properties: [SORT_PROPERTY, "tags"],
  showPropertyNames: false,
  showIndex: true,
  includeAttachments: false,
  showMentions: true,
};

/** Pseudo-properties read off the file itself rather than frontmatter. */
export const FILE_PROPERTIES = [
  "file.name",
  "file.path",
  "file.folder",
  "file.ext",
  "file.ctime",
  "file.mtime",
  "file.size",
  "file.tags",
];

/**
 * Every property key the vault knows about. Uses the app's property registry
 * when present, and otherwise falls back to scanning frontmatter.
 */
export function getAllPropertyKeys(app: App): string[] {
  const keys = new Set<string>(FILE_PROPERTIES);
  keys.add(SORT_PROPERTY);
  keys.add(PROXIMITY_PROPERTY);

  const registry = (app as any).metadataTypeManager?.properties;
  if (registry && typeof registry === "object") {
    for (const name of Object.keys(registry)) keys.add(name);
  } else {
    for (const file of app.vault.getMarkdownFiles()) {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm) for (const key of Object.keys(fm)) keys.add(key);
    }
  }

  return [...keys].sort((a, b) => a.localeCompare(b));
}

class PropertySuggest extends AbstractInputSuggest<string> {
  private onPick: (value: string) => void;

  constructor(app: App, inputEl: HTMLInputElement, onPick: (value: string) => void) {
    super(app, inputEl);
    this.onPick = onPick;
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return getAllPropertyKeys(this.app)
      .filter((key) => key.toLowerCase().includes(q))
      .slice(0, 20);
  }

  renderSuggestion(key: string, el: HTMLElement): void {
    el.setText(key);
  }

  selectSuggestion(key: string): void {
    this.setValue(key);
    this.onPick(key);
    this.close();
  }
}

export class LocalGraphListSettingTab extends PluginSettingTab {
  plugin: LocalGraphListPlugin;

  constructor(app: App, plugin: LocalGraphListPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private async commit() {
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Sort").setHeading();

    new Setting(containerEl)
      .setName("Sort by")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            proximity: "Graph proximity",
            created: "Created time",
            modified: "Modified time",
            property: "Property",
            title: "Title",
          })
          .setValue(this.plugin.settings.sortKey)
          .onChange(async (value) => {
            this.plugin.settings.sortKey = value as SortKey;
            await this.commit();
            this.display();
          })
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ asc: "Ascending", desc: "Descending" })
          .setValue(this.plugin.settings.sortDirection)
          .onChange(async (value) => {
            this.plugin.settings.sortDirection = value as SortDirection;
            await this.commit();
          })
      );

    if (this.plugin.settings.sortKey === "property") {
      new Setting(containerEl)
        .setName("Sort property")
        .setDesc("Notes missing this property are listed last")
        .addText((text) => {
          text
            .setPlaceholder("created")
            .setValue(this.plugin.settings.sortProperty)
            .onChange(async (value) => {
              this.plugin.settings.sortProperty = value.trim();
              await this.commit();
            });
          new PropertySuggest(this.app, text.inputEl, async (key) => {
            this.plugin.settings.sortProperty = key;
            await this.commit();
          });
        });
    }

    new Setting(containerEl).setName("Display").setHeading();

    new Setting(containerEl)
      .setName("Separate inbound and outbound")
      .setDesc("Off shows the whole local graph as one flat list")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.separateDirections)
          .onChange(async (value) => {
            this.plugin.settings.separateDirections = value;
            await this.commit();
          })
      );

    new Setting(containerEl)
      .setName("Show property names")
      .setDesc("Label each value with its property key")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPropertyNames)
          .onChange(async (value) => {
            this.plugin.settings.showPropertyNames = value;
            await this.commit();
          })
      );

    new Setting(containerEl)
      .setName("Number rows")
      .setDesc("Show a running count beside each title")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showIndex)
          .onChange(async (value) => {
            this.plugin.settings.showIndex = value;
            await this.commit();
          })
      );

    new Setting(containerEl)
      .setName("Show unlinked mentions")
      .setDesc(
        "Append notes this one names but does not link, as ghost rows with a link button"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showMentions)
          .onChange(async (value) => {
            this.plugin.settings.showMentions = value;
            await this.commit();
          })
      );

    new Setting(containerEl)
      .setName("Include attachments")
      .setDesc("Link images, PDFs and other non-note files alongside notes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeAttachments)
          .onChange(async (value) => {
            this.plugin.settings.includeAttachments = value;
            await this.commit();
          })
      );

    new Setting(containerEl)
      .setName("Properties")
      .setDesc(
        `Shown under each title, in this order. Empty values are skipped. ` +
          `"${SORT_PROPERTY}" tracks whatever you sort by; "${PROXIMITY_PROPERTY}" is the graph score.`
      )
      .addButton((button) =>
        button
          .setIcon("plus")
          .setTooltip("Add property")
          .onClick(async () => {
            this.plugin.settings.properties.push("");
            await this.commit();
            this.display();
          })
      );

    const { properties } = this.plugin.settings;

    properties.forEach((prop, index) => {
      const row = new Setting(containerEl).setClass("lgl-property-row");

      row.addText((text) => {
        text
          .setPlaceholder("property name")
          .setValue(prop)
          .onChange(async (value) => {
            properties[index] = value.trim();
            await this.commit();
          });
        new PropertySuggest(this.app, text.inputEl, async (key) => {
          properties[index] = key;
          await this.commit();
        });
      });

      row.addExtraButton((button) =>
        button
          .setIcon("chevron-up")
          .setTooltip("Move up")
          .setDisabled(index === 0)
          .onClick(async () => {
            [properties[index - 1], properties[index]] = [
              properties[index],
              properties[index - 1],
            ];
            await this.commit();
            this.display();
          })
      );

      row.addExtraButton((button) =>
        button
          .setIcon("chevron-down")
          .setTooltip("Move down")
          .setDisabled(index === properties.length - 1)
          .onClick(async () => {
            [properties[index + 1], properties[index]] = [
              properties[index],
              properties[index + 1],
            ];
            await this.commit();
            this.display();
          })
      );

      row.addExtraButton((button) =>
        button
          .setIcon("trash-2")
          .setTooltip("Remove")
          .onClick(async () => {
            properties.splice(index, 1);
            await this.commit();
            this.display();
          })
      );
    });

    if (properties.length === 0) {
      containerEl.createDiv({
        cls: "setting-item-description lgl-empty-properties",
        text: "No properties selected. Only titles will be shown.",
      });
    }
  }
}
