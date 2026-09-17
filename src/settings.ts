import { AbstractInputSuggest, App, PluginSettingTab, Setting } from "obsidian";
import type LocalGraphListPlugin from "./main";
import type { MentionScope } from "./mentions";

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
  /** Whether the link button converts the first mention of a note or all of them. */
  mentionScope: MentionScope;
  /** With scope "all", link new mentions of already-linked notes while editing. */
  autoLink: boolean;
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
  mentionScope: "first",
  autoLink: false,
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

    this.displaySort(containerEl);
    this.displayList(containerEl);
    this.displayProperties(containerEl);
    this.displayMentions(containerEl);
  }

  private displaySort(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Sort")
      .setDesc("Also changeable from the sort button in the view header.")
      .setHeading();

    new Setting(containerEl)
      .setName("Sort by")
      .setDesc(
        "Graph proximity ranks links by how much of this note's neighbourhood they share. " +
          "Notes missing the sort value always land last."
      )
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
        .setDesc("Any frontmatter property, or a file.* pseudo-property")
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
  }

  private displayList(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("List").setHeading();

    new Setting(containerEl)
      .setName("Separate inbound and outbound")
      .setDesc("Links to, then Linked from. Off shows the whole local graph as one flat list.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.separateDirections)
          .onChange(async (value) => {
            this.plugin.settings.separateDirections = value;
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
      .setName("Include attachments")
      .setDesc("List linked images, PDFs and other non-note files alongside notes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeAttachments)
          .onChange(async (value) => {
            this.plugin.settings.includeAttachments = value;
            await this.commit();
          })
      );
  }

  private displayProperties(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Properties")
      .setDesc(
        `Shown under each title, in this order. Empty values are skipped. ` +
          `"${SORT_PROPERTY}" tracks whatever you sort by; "${PROXIMITY_PROPERTY}" is the graph score.`
      )
      .setHeading()
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

  private displayMentions(containerEl: HTMLElement): void {
    const { settings } = this.plugin;

    new Setting(containerEl)
      .setName("Unlinked mentions")
      .setDesc(
        "Whole words only, case-insensitive. Frontmatter, code, URLs, tags and existing " +
          "links are never matched, and notes under Excluded files are never suggested."
      )
      .setHeading();

    new Setting(containerEl)
      .setName("Show unlinked mentions")
      .setDesc("Notes this one names but does not link, as ghost rows with a link button")
      .addToggle((toggle) =>
        toggle.setValue(settings.showMentions).onChange(async (value) => {
          settings.showMentions = value;
          await this.commit();
          this.display();
        })
      );

    if (!settings.showMentions) return;

    new Setting(containerEl)
      .setName("Link")
      .setDesc(
        settings.mentionScope === "first"
          ? "The link button links the first mention. Once a note is linked, its other mentions stay plain text."
          : "The link button links every mention. A note that is linked but mentioned again keeps its link button."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ first: "First mention", all: "All mentions" })
          .setValue(settings.mentionScope)
          .onChange(async (value) => {
            settings.mentionScope = value as MentionScope;
            await this.commit();
            this.display();
          })
      );

    if (settings.mentionScope !== "all") return;

    new Setting(containerEl)
      .setName("Auto-link new mentions")
      .setDesc(
        "When you mention a note this one already links, link it on the next save. " +
          "Skips the line you are typing on. Undoing an auto-link turns it off for that note " +
          "until Obsidian restarts. Notes you have never linked are only ever suggested."
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.autoLink).onChange(async (value) => {
          settings.autoLink = value;
          await this.commit();
        })
      );
  }
}
