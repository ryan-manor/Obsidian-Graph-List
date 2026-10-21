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
import type { ProximityAlgorithm } from "./ppr";

/**
 * Retired display keys: `sort` followed the sort key and `proximity` was the
 * score, which is no longer shown. Stripped from saved settings.
 */
export const RETIRED_PROPERTIES = new Set(["sort", "proximity"]);

export type SortKey =
  | "proximity"
  | "created"
  | "modified"
  | "property"
  | "title";
export type SortDirection = "asc" | "desc";
/** What sits under each title: chosen properties, or the line the link is on. */
export type Preview = "properties" | "context";

export interface LocalGraphListSettings {
  sortKey: SortKey;
  /** Frontmatter key (or file.* pseudo-key) used when sortKey is "property". */
  sortProperty: string;
  sortDirection: SortDirection;
  /** Split the list into Links to / Linked from instead of one flat list. */
  separateDirections: boolean;
  /** What each row shows under its title. */
  preview: Preview;
  /** Frontmatter keys (or file.* pseudo-keys) rendered under each title. */
  properties: string[];
  /** Prefix each value with its property name. */
  showPropertyNames: boolean;
  /** Number the rows within each group. */
  showIndex: boolean;
  /** Rank unlinked outbound mentions in the list as ghost rows. */
  showMentions: boolean;
  /** List other notes that name this one without linking it. */
  showInboundMentions: boolean;
  /** Whether the link button converts the first mention of a note or all of them. */
  mentionScope: MentionScope;
  /** How shared neighbours are discounted by their degree. */
  algorithm: ProximityAlgorithm;
  /** 1 lists linked notes; 2 also suggests unlinked notes two links away. */
  depth: 1 | 2;
}

export const DEFAULT_SETTINGS: LocalGraphListSettings = {
  sortKey: "proximity",
  sortProperty: "created",
  sortDirection: "desc",
  separateDirections: true,
  preview: "properties",
  properties: ["tags"],
  showPropertyNames: false,
  showIndex: true,
  showMentions: true,
  showInboundMentions: true,
  mentionScope: "first",
  algorithm: "adamic-adar",
  depth: 1,
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
    const value = this.plugin.settings[key as keyof LocalGraphListSettings];
    // Dropdown options are strings; depth is stored as a number.
    return key === "depth" ? String(value) : value;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] =
      key === "depth" ? Number(value) : value;
    // These rewrite their own descriptions; the rest only show or hide rows.
    if (key === "mentionScope" || key === "algorithm" || key === "preview") await this.commitAndUpdate();
    else {
      await this.commit();
      this.refreshDomState();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      this.sortDefinitions(),
      this.graphDefinitions(),
      this.listDefinitions(),
      this.propertyDefinitions(),
      // Rebuilt when the preview changes, so the list only shows while it applies.
      ...(this.plugin.settings.preview === "properties" ? [this.propertyListDefinitions()] : []),
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

  private graphDefinitions(): SettingDefinitionGroup {
    const { settings } = this.plugin;

    return {
      type: "group",
      heading: "Graph",
      items: [
        {
          name: "Algorithm",
          desc:
            settings.algorithm === "adamic-adar"
              ? "Adamic-Adar: each shared neighbour counts 1/log(its links), so busy notes are discounted gently."
              : "Resource allocation: each shared neighbour counts 1/(its links), so a daily note or hub page counts for almost nothing.",
          control: {
            type: "dropdown",
            key: "algorithm",
            options: {
              "adamic-adar": "Adamic-Adar",
              "resource-allocation": "Resource allocation",
            },
          },
        },
        {
          name: "Depth",
          desc:
            "At 2, a Suggested group lists notes this one does not link yet but shares at " +
            "least two neighbours with, each with the notes they share.",
          control: {
            type: "dropdown",
            key: "depth",
            options: { "1": "1: linked notes", "2": "2: also suggest related notes" },
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
      ],
    };
  }

  private propertyDefinitions(): SettingDefinitionGroup {
    const showingProperties = () => this.plugin.settings.preview === "properties";

    return {
      type: "group",
      heading: "Preview",
      items: [
        {
          name: "Under each title",
          desc:
            this.plugin.settings.preview === "context"
              ? "The line the link sits on, with the link highlighted. The first one when there are several; for an unlinked mention, the mention."
              : "The properties listed below. Empty values are skipped.",
          control: {
            type: "dropdown",
            key: "preview",
            options: { properties: "Properties", context: "Link context" },
          },
        },
        {
          name: "Show property names",
          desc: "Label each value with its property key",
          visible: showingProperties,
          control: { type: "toggle", key: "showPropertyNames" },
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
    const mentionsOn = () => settings.showMentions || settings.showInboundMentions;

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
          name: "Show mentions in other notes",
          desc:
            "Notes that name this one but do not link it, as ghost rows in Linked from or the " +
            "flat list. Same matching rules, and the link button writes the link into that note.",
          control: { type: "toggle", key: "showInboundMentions" },
        },
        {
          name: "Link",
          desc:
            (settings.mentionScope === "first"
              ? "The link button links the first mention. Once a note is linked, its other mentions stay plain text. "
              : "The link button links every mention. A note that is linked but mentioned again keeps its link button. ") +
            "To catch up a whole note, the command “Link remaining mentions of linked notes” converts every " +
            "leftover mention of notes it already links, in one undo step.",
          visible: mentionsOn,
          control: {
            type: "dropdown",
            key: "mentionScope",
            options: { first: "First mention", all: "All mentions" },
          },
        },
      ],
    };
  }
}
