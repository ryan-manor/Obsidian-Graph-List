import {
  AbstractInputSuggest,
  App,
  PluginSettingTab,
  Setting,
  debounce,
  type SettingDefinitionGroup,
  type SettingDefinitionItem,
  type SettingDefinitionList,
} from "obsidian";
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

/** Undocumented registry behind the Properties view, keyed by property name. */
interface AppWithPropertyRegistry {
  metadataTypeManager?: { properties?: Record<string, unknown> };
}

/**
 * Every property key the vault knows about. Uses the app's property registry
 * when present, and otherwise falls back to scanning frontmatter.
 */
export function getAllPropertyKeys(app: App): string[] {
  const keys = new Set<string>(FILE_PROPERTIES);
  keys.add(SORT_PROPERTY);
  keys.add(PROXIMITY_PROPERTY);

  const registry = (app as AppWithPropertyRegistry).metadataTypeManager?.properties;
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
    this.commitSoon.cancel();
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }

  /** Text fields commit once typing pauses, not on every keystroke. */
  private commitSoon = debounce(() => void this.commit(), 400, true);

  /** Commit, then rebuild the definitions so labels and lists match the new state. */
  private async commitAndUpdate() {
    await this.commit();
    this.update();
  }

  hide(): void {
    this.commitSoon.run();
    super.hide();
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof LocalGraphListSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    // The mention scope rewrites its own description; the rest only show or hide rows.
    if (key === "mentionScope") await this.commitAndUpdate();
    else {
      await this.commit();
      this.refreshDomState();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      this.sortDefinitions(),
      this.listDefinitions(),
      this.propertyDefinitions(),
      this.propertyListDefinitions(),
      this.mentionDefinitions(),
    ];
  }

  private sortDefinitions(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: "Sort",
      items: [
        {
          name: "Sort by",
          desc:
            "Graph proximity ranks links by how much of this note's neighbourhood they share. " +
            "Notes missing the sort value always land last. Also changeable from the sort " +
            "button in the view header.",
          control: {
            type: "dropdown",
            key: "sortKey",
            options: {
              proximity: "Graph proximity",
              created: "Created time",
              modified: "Modified time",
              property: "Property",
              title: "Title",
            },
          },
        },
        {
          name: "Sort property",
          desc: "Any frontmatter property, or a file.* pseudo-property",
          visible: () => this.plugin.settings.sortKey === "property",
          render: (setting) => {
            setting.addText((text) => {
              text
                .setPlaceholder("created")
                .setValue(this.plugin.settings.sortProperty)
                .onChange((value) => {
                  this.plugin.settings.sortProperty = value.trim();
                  this.commitSoon();
                });
              new PropertySuggest(this.app, text.inputEl, (key) => {
                this.plugin.settings.sortProperty = key;
                void this.commit();
              });
            });
          },
        },
        {
          name: "Sort direction",
          control: {
            type: "dropdown",
            key: "sortDirection",
            options: { asc: "Ascending", desc: "Descending" },
          },
        },
      ],
    };
  }

  private listDefinitions(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: "List",
      items: [
        {
          name: "Separate inbound and outbound",
          desc: "Links to, then Linked from. Off shows the whole local graph as one flat list.",
          control: { type: "toggle", key: "separateDirections" },
        },
        {
          name: "Number rows",
          desc: "Show a running count beside each title",
          control: { type: "toggle", key: "showIndex" },
        },
        {
          name: "Include attachments",
          desc: "List linked images, PDFs and other non-note files alongside notes",
          control: { type: "toggle", key: "includeAttachments" },
        },
      ],
    };
  }

  private propertyDefinitions(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: "Properties",
      items: [
        {
          name: "Show property names",
          desc: "Label each value with its property key",
          control: { type: "toggle", key: "showPropertyNames" },
        },
        {
          name: "Pseudo-properties",
          desc:
            `"${SORT_PROPERTY}" tracks whatever you sort by; "${PROXIMITY_PROPERTY}" is the ` +
            `graph score. Empty values are skipped.`,
        },
      ],
    };
  }

  /** The displayed properties, in order, with drag to reorder. */
  private propertyListDefinitions(): SettingDefinitionList {
    const { properties } = this.plugin.settings;

    return {
      type: "list",
      heading: "Shown under each title",
      emptyState: "No properties selected. Only titles will be shown.",
      addItem: {
        name: "Add property",
        action: () => {
          properties.push("");
          void this.commitAndUpdate();
        },
      },
      onReorder: (from, to) => {
        const [moved] = properties.splice(from, 1);
        properties.splice(to, 0, moved);
        void this.commitAndUpdate();
      },
      onDelete: (index) => {
        properties.splice(index, 1);
        void this.commitAndUpdate();
      },
      items: properties.map((prop, index) => ({
        // The text field already shows the key, so the row needs no label.
        name: "",
        searchable: false,
        render: (setting: Setting) => {
          setting.setClass("lgl-property-row");
          setting.addText((text) => {
            text
              .setPlaceholder("Property name")
              .setValue(prop)
              .onChange((value) => {
                properties[index] = value.trim();
                this.commitSoon();
              });
            new PropertySuggest(this.app, text.inputEl, (key) => {
              properties[index] = key;
              void this.commitAndUpdate();
            });
          });
        },
      })),
    };
  }

  private mentionDefinitions(): SettingDefinitionGroup {
    const { settings } = this.plugin;
    const mentionsOn = () => settings.showMentions;

    return {
      type: "group",
      heading: "Unlinked mentions",
      items: [
        {
          name: "Show unlinked mentions",
          desc:
            "Notes this one names but does not link, as ghost rows with a link button. " +
            "Whole words only, case-insensitive. Frontmatter, code, URLs, tags and existing " +
            "links are never matched, and notes under Excluded files are never suggested.",
          control: { type: "toggle", key: "showMentions" },
        },
        {
          name: "Link",
          desc:
            settings.mentionScope === "first"
              ? "The link button links the first mention. Once a note is linked, its other mentions stay plain text."
              : "The link button links every mention. A note that is linked but mentioned again keeps its link button.",
          visible: mentionsOn,
          control: {
            type: "dropdown",
            key: "mentionScope",
            options: { first: "First mention", all: "All mentions" },
          },
        },
        {
          name: "Linking every mention at once",
          desc:
            "The command “Link remaining mentions of linked notes” converts every leftover " +
            "mention of notes this one already links, in one undo step. Notes you have not linked " +
            "yourself stay suggestions, with their own button.",
          visible: mentionsOn,
        },
      ],
    };
  }
}
