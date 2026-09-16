import {
  ItemView,
  Keymap,
  Menu,
  TFile,
  WorkspaceLeaf,
  debounce,
  setIcon,
} from "obsidian";
import type LocalGraphListPlugin from "./main";
import { buildGroups, getPropertyValue, resolveSortProperty, unwrapLink } from "./graph";
import { SORT_PROPERTY, type SortKey } from "./settings";

export const VIEW_TYPE_LOCAL_GRAPH_LIST = "local-graph-list";

const SORT_LABELS: Record<SortKey, string> = {
  created: "Created time",
  modified: "Modified time",
  property: "Property",
  title: "Title",
};

/** Frontmatter tags are stored bare; render them as real tags. */
function normalizeTags(key: string, value: unknown): unknown {
  if (key !== "tags" && key !== "file.tags") return value;
  const hash = (entry: unknown) =>
    typeof entry === "string" && entry && !entry.startsWith("#") ? `#${entry}` : entry;
  return Array.isArray(value) ? value.map(hash) : hash(value);
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class LocalGraphListView extends ItemView {
  plugin: LocalGraphListPlugin;

  /** File the current render is for, so metadata events can be filtered cheaply. */
  private renderedPaths = new Set<string>();

  private scheduleRender = debounce(() => this.render(), 150, true);

  constructor(leaf: WorkspaceLeaf, plugin: LocalGraphListPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LOCAL_GRAPH_LIST;
  }

  getDisplayText(): string {
    return "Local graph list";
  }

  getIcon(): string {
    return "list-tree";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("lgl-view");

    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleRender()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.scheduleRender())
    );
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRender()));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (this.renderedPaths.has(file.path)) this.scheduleRender();
      })
    );
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRender()));

    this.render();
  }

  /** Last markdown-ish file the user looked at, ignoring this sidebar view. */
  private getTargetFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.renderedPaths.clear();

    const file = this.getTargetFile();
    this.renderHeader(contentEl, file);

    if (!file) {
      contentEl.createDiv({ cls: "lgl-empty", text: "No file open." });
      return;
    }

    this.renderedPaths.add(file.path);

    const groups = buildGroups(this.app, file, this.plugin.settings);
    const total = groups.reduce((sum, group) => sum + group.files.length, 0);

    if (total === 0) {
      contentEl.createDiv({ cls: "lgl-empty", text: "No linked notes." });
      return;
    }

    for (const group of groups) {
      if (group.files.length === 0) continue;

      const header = contentEl.createDiv({ cls: "lgl-group-header" });
      header.createSpan({ cls: "lgl-group-label", text: group.label });
      header.createSpan({ cls: "lgl-group-count", text: String(group.files.length) });

      const list = contentEl.createDiv({ cls: "lgl-list" });
      group.files.forEach((neighbor, index) => {
        this.renderedPaths.add(neighbor.path);
        this.renderItem(list, neighbor, file, index + 1);
      });
    }
  }

  private renderHeader(parent: HTMLElement, file: TFile | null): void {
    const header = parent.createDiv({ cls: "lgl-header" });

    header.createDiv({
      cls: "lgl-header-title",
      text: file ? file.basename : "Nothing open",
    });

    const sortButton = header.createDiv({ cls: "clickable-icon lgl-header-btn" });
    setIcon(sortButton, "arrow-up-down");
    sortButton.setAttribute("aria-label", "Sort");
    sortButton.addEventListener("click", (evt) => this.openSortMenu(evt));
  }

  private openSortMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const { settings } = this.plugin;

    for (const key of Object.keys(SORT_LABELS) as SortKey[]) {
      menu.addItem((item) =>
        item
          .setTitle(
            key === "property" && settings.sortProperty
              ? `Property: ${settings.sortProperty}`
              : SORT_LABELS[key]
          )
          .setChecked(settings.sortKey === key)
          .onClick(async () => {
            settings.sortKey = key;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );
    }

    menu.addSeparator();

    for (const direction of ["asc", "desc"] as const) {
      menu.addItem((item) =>
        item
          .setTitle(direction === "asc" ? "Ascending" : "Descending")
          .setChecked(settings.sortDirection === direction)
          .onClick(async () => {
            settings.sortDirection = direction;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );
    }

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Separate inbound and outbound")
        .setChecked(settings.separateDirections)
        .onClick(async () => {
          settings.separateDirections = !settings.separateDirections;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
    );

    menu.showAtMouseEvent(evt);
  }

  private renderItem(
    parent: HTMLElement,
    file: TFile,
    source: TFile,
    index: number
  ): void {
    const item = parent.createDiv({ cls: "lgl-item" });

    if (this.plugin.settings.showIndex) {
      item.createSpan({ cls: "lgl-index", text: `${index}.` });
    }

    const title = item.createEl("a", {
      cls: "lgl-title internal-link",
      text: file.basename,
      href: file.path,
    });

    title.addEventListener("click", (evt) => {
      evt.preventDefault();
      this.app.workspace.openLinkText(file.path, source.path, Keymap.isModEvent(evt));
    });

    title.addEventListener("mouseover", (evt) => {
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: VIEW_TYPE_LOCAL_GRAPH_LIST,
        hoverParent: this,
        targetEl: title,
        linktext: file.path,
        sourcePath: source.path,
      });
    });

    title.addEventListener("contextmenu", (evt) => {
      const menu = new Menu();
      this.app.workspace.trigger("file-menu", menu, file, VIEW_TYPE_LOCAL_GRAPH_LIST);
      menu.showAtMouseEvent(evt);
    });

    const props = this.plugin.settings.properties.filter(Boolean);
    if (props.length === 0) return;

    const propsEl = item.createDiv({ cls: "lgl-props" });

    for (const prop of props) {
      const key =
        prop === SORT_PROPERTY ? resolveSortProperty(this.plugin.settings) : prop;
      if (!key) continue;

      const value = normalizeTags(key, getPropertyValue(this.app, file, key));
      const row = propsEl.createDiv({ cls: "lgl-prop" });

      if (this.plugin.settings.showPropertyNames) {
        row.createSpan({ cls: "lgl-prop-name", text: key });
      }

      const values = row.createDiv({ cls: "lgl-prop-values" });
      if (!this.renderValue(values, value, source.path)) row.remove();
    }

    if (propsEl.childElementCount === 0) propsEl.remove();
  }

  /** Render a property value. Returns false when there was nothing to show. */
  private renderValue(parent: HTMLElement, value: unknown, sourcePath: string): boolean {
    if (value === null || value === undefined || value === "") return false;

    if (Array.isArray(value)) {
      const rendered = value.filter((entry) =>
        this.renderScalar(parent, entry, sourcePath, true)
      );
      return rendered.length > 0;
    }

    return this.renderScalar(parent, value, sourcePath, false);
  }

  private renderScalar(
    parent: HTMLElement,
    value: unknown,
    sourcePath: string,
    asPill: boolean
  ): boolean {
    if (value === null || value === undefined || value === "") return false;

    if (value instanceof Date) {
      parent.createSpan({ cls: "lgl-value", text: formatDate(value) });
      return true;
    }

    if (typeof value === "boolean") {
      parent.createSpan({ cls: "lgl-value", text: value ? "✓" : "✗" });
      return true;
    }

    if (typeof value === "number") {
      parent.createSpan({ cls: "lgl-value", text: String(value) });
      return true;
    }

    if (typeof value !== "string") {
      parent.createSpan({ cls: "lgl-value", text: String(value) });
      return true;
    }

    const text = value.trim();
    if (!text) return false;

    if (text.startsWith("#")) {
      this.renderTag(parent, text);
      return true;
    }

    if (/^!?\[\[[^\]]+\]\]$/.test(text)) {
      this.renderLink(parent, text, sourcePath);
      return true;
    }

    parent.createSpan({ cls: asPill ? "lgl-value lgl-pill" : "lgl-value", text });
    return true;
  }

  private renderTag(parent: HTMLElement, tag: string): void {
    const el = parent.createSpan({
      cls: "lgl-value lgl-tag",
      text: tag.replace(/^#/, ""),
    });
    el.addEventListener("click", (evt) => {
      evt.preventDefault();
      const search = (this.app as any).internalPlugins?.getPluginById("global-search");
      search?.instance?.openGlobalSearch(`tag:${tag}`);
    });
  }

  private renderLink(parent: HTMLElement, wikilink: string, sourcePath: string): void {
    const target = unwrapLink(wikilink);
    const alias = wikilink.replace(/^!?\[\[|\]\]$/g, "").split("|")[1]?.trim();

    const el = parent.createEl("a", {
      cls: "lgl-value internal-link",
      text: alias || target,
      href: target,
    });

    el.addEventListener("click", (evt) => {
      evt.preventDefault();
      this.app.workspace.openLinkText(target, sourcePath, Keymap.isModEvent(evt));
    });
  }
}
