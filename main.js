var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LocalGraphListPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/settings.ts
var import_obsidian = require("obsidian");
var SORT_PROPERTY = "sort";
var DEFAULT_SETTINGS = {
  sortKey: "property",
  sortProperty: "created",
  sortDirection: "desc",
  separateDirections: true,
  properties: [SORT_PROPERTY, "tags"],
  showPropertyNames: false,
  showIndex: true,
  includeAttachments: false
};
var FILE_PROPERTIES = [
  "file.name",
  "file.path",
  "file.folder",
  "file.ext",
  "file.ctime",
  "file.mtime",
  "file.size",
  "file.tags"
];
function getAllPropertyKeys(app) {
  var _a, _b;
  const keys = new Set(FILE_PROPERTIES);
  keys.add(SORT_PROPERTY);
  const registry = (_a = app.metadataTypeManager) == null ? void 0 : _a.properties;
  if (registry && typeof registry === "object") {
    for (const name of Object.keys(registry)) keys.add(name);
  } else {
    for (const file of app.vault.getMarkdownFiles()) {
      const fm = (_b = app.metadataCache.getFileCache(file)) == null ? void 0 : _b.frontmatter;
      if (fm) for (const key of Object.keys(fm)) keys.add(key);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}
var PropertySuggest = class extends import_obsidian.AbstractInputSuggest {
  constructor(app, inputEl, onPick) {
    super(app, inputEl);
    this.onPick = onPick;
  }
  getSuggestions(query) {
    const q = query.toLowerCase();
    return getAllPropertyKeys(this.app).filter((key) => key.toLowerCase().includes(q)).slice(0, 20);
  }
  renderSuggestion(key, el) {
    el.setText(key);
  }
  selectSuggestion(key) {
    this.setValue(key);
    this.onPick(key);
    this.close();
  }
};
var LocalGraphListSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  async commit() {
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Sort").setHeading();
    new import_obsidian.Setting(containerEl).setName("Sort by").addDropdown(
      (dropdown) => dropdown.addOptions({
        created: "Created time",
        modified: "Modified time",
        property: "Property",
        title: "Title"
      }).setValue(this.plugin.settings.sortKey).onChange(async (value) => {
        this.plugin.settings.sortKey = value;
        await this.commit();
        this.display();
      })
    ).addDropdown(
      (dropdown) => dropdown.addOptions({ asc: "Ascending", desc: "Descending" }).setValue(this.plugin.settings.sortDirection).onChange(async (value) => {
        this.plugin.settings.sortDirection = value;
        await this.commit();
      })
    );
    if (this.plugin.settings.sortKey === "property") {
      new import_obsidian.Setting(containerEl).setName("Sort property").setDesc("Notes missing this property are listed last").addText((text) => {
        text.setPlaceholder("created").setValue(this.plugin.settings.sortProperty).onChange(async (value) => {
          this.plugin.settings.sortProperty = value.trim();
          await this.commit();
        });
        new PropertySuggest(this.app, text.inputEl, async (key) => {
          this.plugin.settings.sortProperty = key;
          await this.commit();
        });
      });
    }
    new import_obsidian.Setting(containerEl).setName("Display").setHeading();
    new import_obsidian.Setting(containerEl).setName("Separate inbound and outbound").setDesc("Off shows the whole local graph as one flat list").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.separateDirections).onChange(async (value) => {
        this.plugin.settings.separateDirections = value;
        await this.commit();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Show property names").setDesc("Label each value with its property key").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showPropertyNames).onChange(async (value) => {
        this.plugin.settings.showPropertyNames = value;
        await this.commit();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Number rows").setDesc("Show a running count beside each title").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showIndex).onChange(async (value) => {
        this.plugin.settings.showIndex = value;
        await this.commit();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Include attachments").setDesc("Link images, PDFs and other non-note files alongside notes").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.includeAttachments).onChange(async (value) => {
        this.plugin.settings.includeAttachments = value;
        await this.commit();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Properties").setDesc(
      `Shown under each title, in this order. Empty values are skipped. "${SORT_PROPERTY}" tracks whatever you sort by.`
    ).addButton(
      (button) => button.setIcon("plus").setTooltip("Add property").onClick(async () => {
        this.plugin.settings.properties.push("");
        await this.commit();
        this.display();
      })
    );
    const { properties } = this.plugin.settings;
    properties.forEach((prop, index) => {
      const row = new import_obsidian.Setting(containerEl).setClass("lgl-property-row");
      row.addText((text) => {
        text.setPlaceholder("property name").setValue(prop).onChange(async (value) => {
          properties[index] = value.trim();
          await this.commit();
        });
        new PropertySuggest(this.app, text.inputEl, async (key) => {
          properties[index] = key;
          await this.commit();
        });
      });
      row.addExtraButton(
        (button) => button.setIcon("chevron-up").setTooltip("Move up").setDisabled(index === 0).onClick(async () => {
          [properties[index - 1], properties[index]] = [
            properties[index],
            properties[index - 1]
          ];
          await this.commit();
          this.display();
        })
      );
      row.addExtraButton(
        (button) => button.setIcon("chevron-down").setTooltip("Move down").setDisabled(index === properties.length - 1).onClick(async () => {
          [properties[index + 1], properties[index]] = [
            properties[index],
            properties[index + 1]
          ];
          await this.commit();
          this.display();
        })
      );
      row.addExtraButton(
        (button) => button.setIcon("trash-2").setTooltip("Remove").onClick(async () => {
          properties.splice(index, 1);
          await this.commit();
          this.display();
        })
      );
    });
    if (properties.length === 0) {
      containerEl.createDiv({
        cls: "setting-item-description lgl-empty-properties",
        text: "No properties selected. Only titles will be shown."
      });
    }
  }
};

// src/view.ts
var import_obsidian3 = require("obsidian");

// src/graph.ts
var import_obsidian2 = require("obsidian");
var NOTE_EXTENSIONS = /* @__PURE__ */ new Set(["md", "canvas", "base"]);
function collectNeighbors(app, file, settings) {
  var _a;
  const resolved = app.metadataCache.resolvedLinks;
  const outPaths = Object.keys((_a = resolved[file.path]) != null ? _a : {});
  const inPaths = [];
  for (const source of Object.keys(resolved)) {
    if (source === file.path) continue;
    if (resolved[source][file.path]) inPaths.push(source);
  }
  const toFiles = (paths) => {
    const files = [];
    for (const path of paths) {
      if (path === file.path) continue;
      const target = app.vault.getAbstractFileByPath(path);
      if (!(target instanceof import_obsidian2.TFile)) continue;
      if (!settings.includeAttachments && !NOTE_EXTENSIONS.has(target.extension)) continue;
      files.push(target);
    }
    return files;
  };
  return { out: toFiles(outPaths), in: toFiles(inPaths) };
}
function buildGroups(app, file, settings) {
  const { out, in: inbound } = collectNeighbors(app, file, settings);
  if (!settings.separateDirections) {
    const seen = /* @__PURE__ */ new Set();
    const merged = [];
    for (const neighbor of [...out, ...inbound]) {
      if (seen.has(neighbor.path)) continue;
      seen.add(neighbor.path);
      merged.push(neighbor);
    }
    return [{ label: "Linked notes", files: sortFiles(app, merged, settings) }];
  }
  return [
    { label: "Links to", files: sortFiles(app, out, settings) },
    { label: "Linked from", files: sortFiles(app, inbound, settings) }
  ];
}
function resolveSortProperty(settings) {
  switch (settings.sortKey) {
    case "created":
      return "file.ctime";
    case "modified":
      return "file.mtime";
    case "property":
      return settings.sortProperty || null;
    case "title":
      return null;
  }
}
function getPropertyValue(app, file, key) {
  var _a, _b, _c, _d, _e, _f;
  switch (key) {
    case "file.name":
      return file.basename;
    case "file.path":
      return file.path;
    case "file.folder":
      return (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "";
    case "file.ext":
      return file.extension;
    case "file.ctime":
      return new Date(file.stat.ctime);
    case "file.mtime":
      return new Date(file.stat.mtime);
    case "file.size":
      return file.stat.size;
    case "file.tags":
      return (_d = (0, import_obsidian2.getAllTags)((_c = app.metadataCache.getFileCache(file)) != null ? _c : {})) != null ? _d : [];
  }
  return (_f = (_e = app.metadataCache.getFileCache(file)) == null ? void 0 : _e.frontmatter) == null ? void 0 : _f[key];
}
function unwrapLink(value) {
  const match = value.match(/^!?\[\[([^\]]+)\]\]$/);
  const inner = match ? match[1] : value;
  return inner.split("|")[0].trim();
}
var ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/;
function toComparable(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (Array.isArray(value)) return value.length ? toComparable(value[0]) : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const text = unwrapLink(value);
    if (ISO_DATE.test(text)) {
      const parsed = Date.parse(text);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return text.toLowerCase();
  }
  return null;
}
function sortValue(app, file, settings) {
  switch (settings.sortKey) {
    case "created":
      return file.stat.ctime;
    case "modified":
      return file.stat.mtime;
    case "title":
      return file.basename.toLowerCase();
    case "property":
      return toComparable(getPropertyValue(app, file, settings.sortProperty));
  }
}
function sortFiles(app, files, settings) {
  const sign = settings.sortDirection === "asc" ? 1 : -1;
  const keyed = files.map((file) => ({ file, value: sortValue(app, file, settings) }));
  keyed.sort((a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value === b.value) return a.file.basename.localeCompare(b.file.basename);
      return a.value === null ? 1 : -1;
    }
    if (typeof a.value === "number" && typeof b.value === "number") {
      return (a.value - b.value) * sign;
    }
    return String(a.value).localeCompare(String(b.value)) * sign;
  });
  return keyed.map((entry) => entry.file);
}

// src/view.ts
var VIEW_TYPE_LOCAL_GRAPH_LIST = "local-graph-list";
var SORT_LABELS = {
  created: "Created time",
  modified: "Modified time",
  property: "Property",
  title: "Title"
};
function normalizeTags(key, value) {
  if (key !== "tags" && key !== "file.tags") return value;
  const hash = (entry) => typeof entry === "string" && entry && !entry.startsWith("#") ? `#${entry}` : entry;
  return Array.isArray(value) ? value.map(hash) : hash(value);
}
function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
var LocalGraphListView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    /** File the current render is for, so metadata events can be filtered cheaply. */
    this.renderedPaths = /* @__PURE__ */ new Set();
    this.scheduleRender = (0, import_obsidian3.debounce)(() => this.render(), 150, true);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_LOCAL_GRAPH_LIST;
  }
  getDisplayText() {
    return "Local graph list";
  }
  getIcon() {
    return "list-tree";
  }
  async onOpen() {
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
  getTargetFile() {
    return this.app.workspace.getActiveFile();
  }
  render() {
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
  renderHeader(parent, file) {
    const header = parent.createDiv({ cls: "lgl-header" });
    header.createDiv({
      cls: "lgl-header-title",
      text: file ? file.basename : "Nothing open"
    });
    const sortButton = header.createDiv({ cls: "clickable-icon lgl-header-btn" });
    (0, import_obsidian3.setIcon)(sortButton, "arrow-up-down");
    sortButton.setAttribute("aria-label", "Sort");
    sortButton.addEventListener("click", (evt) => this.openSortMenu(evt));
  }
  openSortMenu(evt) {
    const menu = new import_obsidian3.Menu();
    const { settings } = this.plugin;
    for (const key of Object.keys(SORT_LABELS)) {
      menu.addItem(
        (item) => item.setTitle(
          key === "property" && settings.sortProperty ? `Property: ${settings.sortProperty}` : SORT_LABELS[key]
        ).setChecked(settings.sortKey === key).onClick(async () => {
          settings.sortKey = key;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );
    }
    menu.addSeparator();
    for (const direction of ["asc", "desc"]) {
      menu.addItem(
        (item) => item.setTitle(direction === "asc" ? "Ascending" : "Descending").setChecked(settings.sortDirection === direction).onClick(async () => {
          settings.sortDirection = direction;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );
    }
    menu.addSeparator();
    menu.addItem(
      (item) => item.setTitle("Separate inbound and outbound").setChecked(settings.separateDirections).onClick(async () => {
        settings.separateDirections = !settings.separateDirections;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      })
    );
    menu.showAtMouseEvent(evt);
  }
  renderItem(parent, file, source, index) {
    const item = parent.createDiv({ cls: "lgl-item" });
    if (this.plugin.settings.showIndex) {
      item.createSpan({ cls: "lgl-index", text: `${index}.` });
    }
    const title = item.createEl("a", {
      cls: "lgl-title internal-link",
      text: file.basename,
      href: file.path
    });
    title.addEventListener("click", (evt) => {
      evt.preventDefault();
      this.app.workspace.openLinkText(file.path, source.path, import_obsidian3.Keymap.isModEvent(evt));
    });
    title.addEventListener("mouseover", (evt) => {
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: VIEW_TYPE_LOCAL_GRAPH_LIST,
        hoverParent: this,
        targetEl: title,
        linktext: file.path,
        sourcePath: source.path
      });
    });
    title.addEventListener("contextmenu", (evt) => {
      const menu = new import_obsidian3.Menu();
      this.app.workspace.trigger("file-menu", menu, file, VIEW_TYPE_LOCAL_GRAPH_LIST);
      menu.showAtMouseEvent(evt);
    });
    const props = this.plugin.settings.properties.filter(Boolean);
    if (props.length === 0) return;
    const propsEl = item.createDiv({ cls: "lgl-props" });
    for (const prop of props) {
      const key = prop === SORT_PROPERTY ? resolveSortProperty(this.plugin.settings) : prop;
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
  renderValue(parent, value, sourcePath) {
    if (value === null || value === void 0 || value === "") return false;
    if (Array.isArray(value)) {
      const rendered = value.filter(
        (entry) => this.renderScalar(parent, entry, sourcePath, true)
      );
      return rendered.length > 0;
    }
    return this.renderScalar(parent, value, sourcePath, false);
  }
  renderScalar(parent, value, sourcePath, asPill) {
    if (value === null || value === void 0 || value === "") return false;
    if (value instanceof Date) {
      parent.createSpan({ cls: "lgl-value", text: formatDate(value) });
      return true;
    }
    if (typeof value === "boolean") {
      parent.createSpan({ cls: "lgl-value", text: value ? "\u2713" : "\u2717" });
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
  renderTag(parent, tag) {
    const el = parent.createSpan({
      cls: "lgl-value lgl-tag",
      text: tag.replace(/^#/, "")
    });
    el.addEventListener("click", (evt) => {
      var _a, _b;
      evt.preventDefault();
      const search = (_a = this.app.internalPlugins) == null ? void 0 : _a.getPluginById("global-search");
      (_b = search == null ? void 0 : search.instance) == null ? void 0 : _b.openGlobalSearch(`tag:${tag}`);
    });
  }
  renderLink(parent, wikilink, sourcePath) {
    var _a;
    const target = unwrapLink(wikilink);
    const alias = (_a = wikilink.replace(/^!?\[\[|\]\]$/g, "").split("|")[1]) == null ? void 0 : _a.trim();
    const el = parent.createEl("a", {
      cls: "lgl-value internal-link",
      text: alias || target,
      href: target
    });
    el.addEventListener("click", (evt) => {
      evt.preventDefault();
      this.app.workspace.openLinkText(target, sourcePath, import_obsidian3.Keymap.isModEvent(evt));
    });
  }
};

// src/main.ts
var LocalGraphListPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    this.registerView(
      VIEW_TYPE_LOCAL_GRAPH_LIST,
      (leaf) => new LocalGraphListView(leaf, this)
    );
    this.addRibbonIcon("list-tree", "Local graph list", () => this.activateView());
    this.addCommand({
      id: "open",
      name: "Open local graph list",
      callback: () => this.activateView()
    });
    this.addSettingTab(new LocalGraphListSettingTab(this.app, this));
  }
  onunload() {
  }
  /** Reveal the view in the right sidebar, creating it if needed. */
  async activateView() {
    var _a;
    const { workspace } = this.app;
    let leaf = (_a = workspace.getLeavesOfType(VIEW_TYPE_LOCAL_GRAPH_LIST)[0]) != null ? _a : null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await (leaf == null ? void 0 : leaf.setViewState({ type: VIEW_TYPE_LOCAL_GRAPH_LIST, active: true }));
    }
    if (leaf) await workspace.revealLeaf(leaf);
  }
  /** Re-render every open instance after a settings change. */
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LOCAL_GRAPH_LIST)) {
      const view = leaf.view;
      if (view instanceof LocalGraphListView) view.render();
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
