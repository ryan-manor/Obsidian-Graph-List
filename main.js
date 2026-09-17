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
var PROXIMITY_PROPERTY = "proximity";
var DEFAULT_SETTINGS = {
  sortKey: "proximity",
  sortProperty: "created",
  sortDirection: "desc",
  separateDirections: true,
  properties: [SORT_PROPERTY, "tags"],
  showPropertyNames: false,
  showIndex: true,
  includeAttachments: false,
  showMentions: true,
  mentionScope: "first"
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
  keys.add(PROXIMITY_PROPERTY);
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
    this.displaySort(containerEl);
    this.displayList(containerEl);
    this.displayProperties(containerEl);
    this.displayMentions(containerEl);
  }
  displaySort(containerEl) {
    new import_obsidian.Setting(containerEl).setName("Sort").setDesc("Also changeable from the sort button in the view header.").setHeading();
    new import_obsidian.Setting(containerEl).setName("Sort by").setDesc(
      "Graph proximity ranks links by how much of this note's neighbourhood they share. Notes missing the sort value always land last."
    ).addDropdown(
      (dropdown) => dropdown.addOptions({
        proximity: "Graph proximity",
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
      new import_obsidian.Setting(containerEl).setName("Sort property").setDesc("Any frontmatter property, or a file.* pseudo-property").addText((text) => {
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
  }
  displayList(containerEl) {
    new import_obsidian.Setting(containerEl).setName("List").setHeading();
    new import_obsidian.Setting(containerEl).setName("Separate inbound and outbound").setDesc("Links to, then Linked from. Off shows the whole local graph as one flat list.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.separateDirections).onChange(async (value) => {
        this.plugin.settings.separateDirections = value;
        await this.commit();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Number rows").setDesc("Show a running count beside each title").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showIndex).onChange(async (value) => {
        this.plugin.settings.showIndex = value;
        await this.commit();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Include attachments").setDesc("List linked images, PDFs and other non-note files alongside notes").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.includeAttachments).onChange(async (value) => {
        this.plugin.settings.includeAttachments = value;
        await this.commit();
      })
    );
  }
  displayProperties(containerEl) {
    new import_obsidian.Setting(containerEl).setName("Properties").setDesc(
      `Shown under each title, in this order. Empty values are skipped. "${SORT_PROPERTY}" tracks whatever you sort by; "${PROXIMITY_PROPERTY}" is the graph score.`
    ).setHeading().addButton(
      (button) => button.setIcon("plus").setTooltip("Add property").onClick(async () => {
        this.plugin.settings.properties.push("");
        await this.commit();
        this.display();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Show property names").setDesc("Label each value with its property key").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showPropertyNames).onChange(async (value) => {
        this.plugin.settings.showPropertyNames = value;
        await this.commit();
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
  displayMentions(containerEl) {
    const { settings } = this.plugin;
    new import_obsidian.Setting(containerEl).setName("Unlinked mentions").setDesc(
      "Whole words only, case-insensitive. Frontmatter, code, URLs, tags and existing links are never matched, and notes under Excluded files are never suggested."
    ).setHeading();
    new import_obsidian.Setting(containerEl).setName("Show unlinked mentions").setDesc("Notes this one names but does not link, as ghost rows with a link button").addToggle(
      (toggle) => toggle.setValue(settings.showMentions).onChange(async (value) => {
        settings.showMentions = value;
        await this.commit();
        this.display();
      })
    );
    if (!settings.showMentions) return;
    new import_obsidian.Setting(containerEl).setName("Link").setDesc(
      settings.mentionScope === "first" ? "The link button links the first mention. Once a note is linked, its other mentions stay plain text." : "The link button links every mention. A note that is linked but mentioned again keeps its link button."
    ).addDropdown(
      (dropdown) => dropdown.addOptions({ first: "First mention", all: "All mentions" }).setValue(settings.mentionScope).onChange(async (value) => {
        settings.mentionScope = value;
        await this.commit();
        this.display();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Linking every mention at once").setDesc(
      "The command \u201CLink remaining mentions of linked notes\u201D converts every leftover mention of notes this one already links, in one undo step. Notes you have not linked yourself stay suggestions, with their own button."
    );
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
function buildGroups(app, file, settings, proximity) {
  const { out, in: inbound } = collectNeighbors(app, file, settings);
  if (!settings.separateDirections) {
    const seen = /* @__PURE__ */ new Set();
    const merged = [];
    for (const neighbor of [...out, ...inbound]) {
      if (seen.has(neighbor.path)) continue;
      seen.add(neighbor.path);
      merged.push(neighbor);
    }
    return [
      { label: "Linked notes", files: sortFiles(app, merged, settings, proximity) }
    ];
  }
  return [
    { label: "Links to", files: sortFiles(app, out, settings, proximity) },
    { label: "Linked from", files: sortFiles(app, inbound, settings, proximity) }
  ];
}
function resolveSortProperty(settings) {
  switch (settings.sortKey) {
    case "proximity":
      return PROXIMITY_PROPERTY;
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
function sortValue(app, file, settings, proximity) {
  var _a;
  switch (settings.sortKey) {
    case "proximity":
      return (_a = proximity.get(file.path)) != null ? _a : null;
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
function sortFiles(app, files, settings, proximity = /* @__PURE__ */ new Map()) {
  const sign = settings.sortDirection === "asc" ? 1 : -1;
  const keyed = files.map((file) => ({
    file,
    value: sortValue(app, file, settings, proximity)
  }));
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

// src/ppr.ts
var PPR_ALPHA = 0.15;
var PPR_EPS = 1e-4;
function buildAdjacency(resolvedLinks) {
  const adj = /* @__PURE__ */ new Map();
  const ensure = (path) => {
    let set = adj.get(path);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      adj.set(path, set);
    }
    return set;
  };
  for (const source in resolvedLinks) {
    const sourceSet = ensure(source);
    for (const target in resolvedLinks[source]) {
      if (target === source) continue;
      sourceSet.add(target);
      ensure(target).add(source);
    }
  }
  return adj;
}
function pushPPR(adj, source, alpha = PPR_ALPHA, eps = PPR_EPS) {
  var _a, _b, _c, _d;
  const mass = /* @__PURE__ */ new Map();
  const residual = /* @__PURE__ */ new Map([[source, 1]]);
  const queue = [source];
  const queued = /* @__PURE__ */ new Set([source]);
  const degree = (node) => {
    var _a2, _b2;
    return (_b2 = (_a2 = adj.get(node)) == null ? void 0 : _a2.size) != null ? _b2 : 0;
  };
  while (queue.length > 0) {
    const u = queue.pop();
    queued.delete(u);
    const ru = (_a = residual.get(u)) != null ? _a : 0;
    const du = degree(u);
    if (du === 0) {
      mass.set(u, ((_b = mass.get(u)) != null ? _b : 0) + ru);
      residual.set(u, 0);
      continue;
    }
    if (ru / du < eps) continue;
    mass.set(u, ((_c = mass.get(u)) != null ? _c : 0) + alpha * ru);
    const spread = (1 - alpha) * ru / du;
    residual.set(u, 0);
    for (const v of adj.get(u)) {
      const rv = ((_d = residual.get(v)) != null ? _d : 0) + spread;
      residual.set(v, rv);
      const dv = degree(v);
      if (!queued.has(v) && dv > 0 && rv / dv >= eps) {
        queue.push(v);
        queued.add(v);
      }
    }
  }
  return mass;
}
function adamicAdar(adj, source) {
  var _a, _b, _c;
  const aa = /* @__PURE__ */ new Map();
  const neighbors = adj.get(source);
  if (!neighbors) return aa;
  for (const z of neighbors) {
    const dz = (_b = (_a = adj.get(z)) == null ? void 0 : _a.size) != null ? _b : 0;
    const weight = dz > 1 ? 1 / Math.log(dz) : 0;
    if (weight === 0) continue;
    for (const v of adj.get(z)) {
      if (v === source) continue;
      aa.set(v, ((_c = aa.get(v)) != null ? _c : 0) + weight);
    }
  }
  return aa;
}
var PPR_TIEBREAK = 1e-3;
function proximityScores(adj, source) {
  var _a, _b;
  const aa = adamicAdar(adj, source);
  const mass = pushPPR(adj, source);
  let aaMax = 0;
  for (const [path, score] of aa) {
    if (path !== source && score > aaMax) aaMax = score;
  }
  let pprMax = 0;
  for (const [path, m] of mass) {
    if (path !== source && m > pprMax) pprMax = m;
  }
  const scores = /* @__PURE__ */ new Map();
  if (pprMax <= 0 && aaMax <= 0) return scores;
  const paths = /* @__PURE__ */ new Set([...aa.keys(), ...mass.keys()]);
  for (const path of paths) {
    if (path === source) continue;
    const near = pprMax > 0 ? ((_a = mass.get(path)) != null ? _a : 0) / pprMax : 0;
    if (aaMax <= 0) {
      if (near > 0) scores.set(path, near);
      continue;
    }
    scores.set(path, ((_b = aa.get(path)) != null ? _b : 0) / aaMax + PPR_TIEBREAK * near);
  }
  return scores;
}

// src/mentions.ts
var MIN_TITLE_LENGTH = 3;
var MIN_ALIAS_LENGTH = 2;
var WORD_CHAR = /[\p{L}\p{N}_-]/u;
var WORD = /[\p{L}\p{N}]+/gu;
function buildMentionIndex(app) {
  var _a, _b, _c, _d, _e;
  const index = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  const ignored = makeIgnoreTest(app);
  const suggestions = (_c = (_b = (_a = app.metadataCache).getLinkSuggestions) == null ? void 0 : _b.call(_a)) != null ? _c : [];
  for (const suggestion of suggestions) {
    const file = suggestion.file;
    if (!file || file.extension !== "md") continue;
    if (ignored(file.path)) continue;
    const name = (_d = suggestion.alias) != null ? _d : file.basename;
    if (name.length < (suggestion.alias ? MIN_ALIAS_LENGTH : MIN_TITLE_LENGTH)) continue;
    const key = `${file.path}\0${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lower = name.toLowerCase();
    const first = (_e = lower.match(WORD)) == null ? void 0 : _e[0];
    if (!first) continue;
    const candidate = { name, lower, file };
    const bucket = index.get(first);
    if (bucket) bucket.push(candidate);
    else index.set(first, [candidate]);
  }
  return index;
}
function makeIgnoreTest(app) {
  var _a, _b;
  const cache = app.metadataCache;
  if (typeof cache.isUserIgnored === "function") {
    return (path) => {
      var _a2, _b2;
      return (_b2 = (_a2 = cache.isUserIgnored) == null ? void 0 : _a2.call(cache, path)) != null ? _b2 : false;
    };
  }
  const config = (_b = (_a = app.vault).getConfig) == null ? void 0 : _b.call(_a, "userIgnoreFilters");
  const filters = Array.isArray(config) ? config : [];
  if (filters.length === 0) return () => false;
  const tests = filters.map((filter) => {
    const pattern = filter.match(/^\/(.*)\/$/);
    if (pattern) {
      try {
        const expression = new RegExp(pattern[1], "i");
        return (path) => expression.test(path);
      } catch (e) {
        return () => false;
      }
    }
    const fragment = filter.toLowerCase();
    return (path) => path.toLowerCase().includes(fragment);
  });
  return (path) => tests.some((test) => test(path));
}
async function findUnlinkedMentions(app, file, index) {
  if (file.extension !== "md") return [];
  const text = await app.vault.cachedRead(file);
  return scanMentions(app, file, text, blockedRanges(text), index);
}
function scanMentions(app, source, text, blocked, index) {
  var _a, _b;
  const linked = new Set(Object.keys((_a = app.metadataCache.resolvedLinks[source.path]) != null ? _a : {}));
  const lower = toLowerKeepingOffsets(text);
  const words = new Set((_b = lower.match(WORD)) != null ? _b : []);
  const hits = [];
  for (const [first, candidates] of index) {
    if (!words.has(first)) continue;
    for (const candidate of candidates) {
      if (candidate.file.path === source.path) continue;
      for (const start of findOccurrences(text, lower, candidate, blocked)) {
        hits.push({ start, end: start + candidate.name.length, candidate });
      }
    }
  }
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const taken = [];
  const found = /* @__PURE__ */ new Map();
  for (const hit of hits) {
    if (taken.some(([start, end]) => hit.start < end && hit.end > start)) continue;
    taken.push([hit.start, hit.end]);
    const span = { start: hit.start, end: hit.end, name: hit.candidate.name };
    const entry = found.get(hit.candidate.file.path);
    if (entry) {
      entry.spans.push(span);
    } else {
      found.set(hit.candidate.file.path, {
        file: hit.candidate.file,
        name: hit.candidate.name,
        names: [],
        count: 0,
        linked: linked.has(hit.candidate.file.path),
        spans: [span]
      });
    }
  }
  for (const mention of found.values()) {
    mention.spans.sort((a, b) => a.start - b.start);
    mention.count = mention.spans.length;
    mention.names = [...new Set(mention.spans.map((span) => span.name))];
  }
  return [...found.values()].sort(
    (a, b) => b.count - a.count || b.name.length - a.name.length || a.file.basename.localeCompare(b.file.basename)
  );
}
function spansToLink(mention, scope) {
  if (scope === "all") return mention.spans;
  return mention.spans.slice(0, 1);
}
function linkForSpan(app, source, target, text, span) {
  const shown = text.slice(span.start, span.end);
  return app.fileManager.generateMarkdownLink(
    target,
    source.path,
    void 0,
    shown === target.basename ? void 0 : shown
  );
}
function findOccurrences(text, lower, candidate, blocked) {
  const needle = candidate.lower;
  const hits = [];
  let start = lower.indexOf(needle);
  while (start !== -1) {
    const end = start + needle.length;
    const before = start > 0 ? text[start - 1] : " ";
    const after = end < text.length ? text[end] : " ";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after) && !isBlocked(blocked, start, end)) {
      hits.push(start);
    }
    start = lower.indexOf(needle, start + 1);
  }
  return hits;
}
function toLowerKeepingOffsets(text) {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let result = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const low = char.toLowerCase();
    result += low.length === 1 ? low : char;
  }
  return result;
}
function blockRanges(text) {
  const ranges = [];
  const lines = text.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const endOf = (index) => starts[index] + lines[index].length;
  let i = 0;
  while (i < lines.length) {
    const fence = lines[i].match(FENCE);
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !closing.test(lines[j])) j += 1;
      ranges.push([starts[i], j < lines.length ? endOf(j) : text.length]);
      i = j + 1;
      continue;
    }
    if (HTML_BLOCK.test(lines[i])) {
      let j = i;
      while (j < lines.length && lines[j].trim() !== "") j += 1;
      ranges.push([starts[i], endOf(j - 1)]);
      i = j;
      continue;
    }
    if (INDENTED.test(lines[i]) && startsIndentedCode(lines, i)) {
      let j = i;
      let last = i;
      while (j < lines.length && (lines[j].trim() === "" || INDENTED.test(lines[j]))) {
        if (lines[j].trim() !== "") last = j;
        j += 1;
      }
      ranges.push([starts[i], endOf(last)]);
      i = j;
      continue;
    }
    i += 1;
  }
  return ranges;
}
function startsIndentedCode(lines, index) {
  if (index > 0 && lines[index - 1].trim() !== "") return false;
  for (let j = index - 2; j >= 0; j -= 1) {
    if (lines[j].trim() === "") continue;
    return !LIST_ITEM.test(lines[j]) && !INDENTED.test(lines[j]);
  }
  return true;
}
var BLOCKED_PATTERNS = [
  /`[^`\n]*`/g,
  // inline code
  /\$\$[\s\S]*?(?:\$\$|$)/g,
  // display math
  /%%[\s\S]*?(?:%%|$)/g,
  // comments
  /<!--[\s\S]*?(?:-->|$)/g,
  // html comments
  /<\/?[a-zA-Z][^>\n]*>/g,
  // html tags, so a name inside an attribute is safe
  /https?:\/\/[^\s)<>]+/g,
  // bare URLs
  /\[[^\]\n]*\]\([^)\n]*\)/g,
  // markdown links, both halves
  /\[\[[^\]\n]*\]\]/g,
  // wikilinks, including unresolved ones
  /#[\p{L}\p{N}/_-]+/gu
  // tags
];
var FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/;
var FENCE = /^ {0,3}(`{3,}|~{3,})/;
var HTML_BLOCK = /^ {0,3}<[a-zA-Z!/]/;
var INDENTED = /^(?: {4}|\t)/;
var LIST_ITEM = /^ *(?:[-*+]|\d+[.)])\s/;
function blockedRanges(text) {
  const ranges = blockRanges(text);
  const frontmatter = text.match(FRONTMATTER);
  if (frontmatter) ranges.push([0, frontmatter[0].length]);
  for (const pattern of BLOCKED_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}
function isBlocked(ranges, start, end) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = low + high >> 1;
    const [rangeStart, rangeEnd] = ranges[mid];
    if (end <= rangeStart) high = mid - 1;
    else if (start >= rangeEnd) low = mid + 1;
    else return true;
  }
  return false;
}
async function linkMentions(app, source, index, scope, select) {
  var _a;
  const groupsIn = (text) => scanMentions(app, source, text, blockedRanges(text), index).filter(select).map((mention) => ({ target: mention.file, spans: spansToLink(mention, scope) })).filter((group) => group.spans.length > 0);
  const context = app.workspace.activeEditor;
  const editor = ((_a = context == null ? void 0 : context.file) == null ? void 0 : _a.path) === source.path ? context.editor : null;
  if (editor) {
    const text = editor.getValue();
    const groups = groupsIn(text);
    if (groups.length === 0) return { links: 0, notes: 0 };
    const changes = groups.flatMap(
      (group) => group.spans.map((span) => ({
        from: editor.offsetToPos(span.start),
        to: editor.offsetToPos(span.end),
        text: linkForSpan(app, source, group.target, text, span)
      }))
    );
    editor.transaction({ changes });
    return { links: changes.length, notes: groups.length };
  }
  if (groupsIn(await app.vault.cachedRead(source)).length === 0) return { links: 0, notes: 0 };
  let result = { links: 0, notes: 0 };
  await app.vault.process(source, (data) => {
    const groups = groupsIn(data);
    result = {
      links: groups.reduce((total, group) => total + group.spans.length, 0),
      notes: groups.length
    };
    const edits = groups.flatMap(
      (group) => group.spans.map((span) => ({ span, link: linkForSpan(app, source, group.target, data, span) }))
    );
    edits.sort((a, b) => b.span.start - a.span.start);
    let text = data;
    for (const { span, link } of edits) {
      text = text.slice(0, span.start) + link + text.slice(span.end);
    }
    return text;
  });
  return result;
}
async function linkMention(app, source, target, index, scope) {
  const result = await linkMentions(
    app,
    source,
    index,
    scope,
    (mention) => mention.file.path === target.path
  );
  return result.links;
}

// src/view.ts
var VIEW_TYPE_LOCAL_GRAPH_LIST = "local-graph-list";
var SORT_LABELS = {
  proximity: "Graph proximity",
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
    /** Discards an in-flight render whose mention scan was overtaken. */
    this.renderToken = 0;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_LOCAL_GRAPH_LIST;
  }
  getDisplayText() {
    return "BetterLinks";
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
    void this.renderAsync();
  }
  async renderAsync() {
    const token = ++this.renderToken;
    const file = this.getTargetFile();
    let mentions = [];
    if ((file == null ? void 0 : file.extension) === "md" && this.plugin.settings.showMentions) {
      mentions = await findUnlinkedMentions(this.app, file, this.plugin.getMentionIndex());
      if (token !== this.renderToken) return;
      if (this.plugin.settings.mentionScope === "first") {
        mentions = mentions.filter((mention) => !mention.linked);
      }
    }
    const { contentEl } = this;
    contentEl.empty();
    this.renderedPaths.clear();
    this.renderHeader(contentEl, file);
    if (!file) {
      contentEl.createDiv({ cls: "lgl-empty", text: "No file open." });
      return;
    }
    this.renderedPaths.add(file.path);
    const proximity = proximityScores(this.plugin.getAdjacency(), file.path);
    const groups = buildGroups(this.app, file, this.plugin.settings, proximity);
    const total = groups.reduce((sum, group) => sum + group.files.length, 0);
    if (total === 0 && mentions.length === 0) {
      contentEl.createDiv({ cls: "lgl-empty", text: "No linked notes." });
      return;
    }
    groups.forEach((group, groupIndex) => {
      const pending = /* @__PURE__ */ new Map();
      const ghosts = [];
      if (groupIndex === 0) {
        const rows = new Set(group.files.map((neighbor) => neighbor.path));
        for (const mention of mentions) {
          if (rows.has(mention.file.path)) pending.set(mention.file.path, mention);
          else if (!mention.linked) ghosts.push(mention);
        }
      }
      if (group.files.length === 0 && ghosts.length === 0) return;
      const header = contentEl.createDiv({ cls: "lgl-group-header" });
      header.createSpan({ cls: "lgl-group-label", text: group.label });
      header.createSpan({
        cls: "lgl-group-count",
        text: ghosts.length ? `${group.files.length} +${ghosts.length}` : String(group.files.length)
      });
      const list = contentEl.createDiv({ cls: "lgl-list" });
      group.files.forEach((neighbor, index) => {
        this.renderedPaths.add(neighbor.path);
        this.renderItem(list, neighbor, file, index + 1, proximity, pending.get(neighbor.path));
      });
      ghosts.forEach((mention, index) => {
        this.renderMention(list, mention, file, group.files.length + index + 1);
      });
    });
    this.renderUnresolved(contentEl, file);
  }
  /**
   * Links to notes that do not exist. The outgoing pane keeps these in their
   * own section, and without them this view cannot replace it. Clicking one
   * creates the note, which is what Obsidian itself does.
   */
  renderUnresolved(parent, file) {
    var _a;
    const entries = Object.entries((_a = this.app.metadataCache.unresolvedLinks[file.path]) != null ? _a : {});
    if (entries.length === 0) return;
    entries.sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB));
    const header = parent.createDiv({ cls: "lgl-group-header" });
    header.createSpan({ cls: "lgl-group-label", text: "Unresolved" });
    header.createSpan({ cls: "lgl-group-count", text: String(entries.length) });
    const list = parent.createDiv({ cls: "lgl-list" });
    entries.forEach(([name, count], index) => {
      const item = list.createDiv({ cls: "lgl-item lgl-unresolved" });
      if (this.plugin.settings.showIndex) {
        item.createSpan({ cls: "lgl-index", text: `${index + 1}.` });
      }
      const title = item.createEl("a", {
        cls: "lgl-title internal-link is-unresolved",
        text: name,
        href: name
      });
      title.addEventListener("click", (evt) => {
        evt.preventDefault();
        this.app.workspace.openLinkText(name, file.path, import_obsidian3.Keymap.isModEvent(evt));
      });
      if (count > 1) {
        const props = item.createDiv({ cls: "lgl-props" });
        const row = props.createDiv({ cls: "lgl-prop lgl-mention-row" });
        row.createDiv({ cls: "lgl-prop-values" }).createSpan({ cls: "lgl-value lgl-mention-count", text: `${count} links` });
      }
    });
  }
  /**
   * A note this one names but does not link yet. Rendered in the same list so
   * accepting one just turns the row solid and lets it sort with the rest.
   */
  renderMention(parent, mention, source, index) {
    const item = parent.createDiv({ cls: "lgl-item lgl-ghost" });
    if (this.plugin.settings.showIndex) {
      item.createSpan({ cls: "lgl-index", text: `${index}.` });
    }
    const title = item.createEl("a", {
      cls: "lgl-title internal-link",
      text: mention.file.basename,
      href: mention.file.path
    });
    title.addEventListener("click", (evt) => {
      evt.preventDefault();
      this.app.workspace.openLinkText(
        mention.file.path,
        source.path,
        import_obsidian3.Keymap.isModEvent(evt)
      );
    });
    title.addEventListener("mouseover", (evt) => {
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: VIEW_TYPE_LOCAL_GRAPH_LIST,
        hoverParent: this,
        targetEl: title,
        linktext: mention.file.path,
        sourcePath: source.path
      });
    });
    this.renderAcceptButton(item, mention, source);
    this.renderMentionSummary(item.createDiv({ cls: "lgl-props" }), mention);
  }
  /** Hover button that links the mention, first occurrence or all per the scope. */
  renderAcceptButton(item, mention, source) {
    var _a, _b;
    const scope = this.plugin.settings.mentionScope;
    const accept = item.createEl("button", {
      cls: "clickable-icon lgl-accept",
      attr: { type: "button" }
    });
    (0, import_obsidian3.setIcon)(accept, "link");
    accept.setAttribute(
      "aria-label",
      scope === "all" && mention.count > 1 ? `Link all ${mention.count} mentions` : `Link "${(_b = (_a = mention.spans[0]) == null ? void 0 : _a.name) != null ? _b : mention.name}"`
    );
    accept.addEventListener("click", async (evt) => {
      var _a2;
      evt.preventDefault();
      evt.stopPropagation();
      if (((_a2 = this.getTargetFile()) == null ? void 0 : _a2.path) !== source.path) {
        this.render();
        return;
      }
      try {
        const linked = await linkMention(
          this.app,
          source,
          mention.file,
          this.plugin.getMentionIndex(),
          scope
        );
        if (linked === 0) new import_obsidian3.Notice(`No unlinked mention of "${mention.file.basename}" left.`);
        this.render();
      } catch (error) {
        console.error("Local Graph List: linking failed", error);
        new import_obsidian3.Notice(`Could not link "${mention.file.basename}".`);
      }
    });
  }
  /** Mention count, plus the alias that matched when it is not the title. */
  renderMentionSummary(propsEl, mention) {
    const row = propsEl.createDiv({ cls: "lgl-prop lgl-mention-row" });
    const values = row.createDiv({ cls: "lgl-prop-values" });
    const noun = mention.linked ? "unlinked mention" : "mention";
    values.createSpan({
      cls: "lgl-value lgl-mention-count",
      text: `${mention.count} ${noun}${mention.count === 1 ? "" : "s"}`
    });
    for (const name of mention.names.slice(0, 3)) {
      if (name === mention.file.basename) continue;
      values.createSpan({ cls: "lgl-value lgl-pill", text: name });
    }
  }
  renderHeader(parent, file) {
    const header = parent.createDiv({ cls: "lgl-header" });
    header.createDiv({
      cls: "lgl-header-title",
      text: file ? file.basename : "Nothing open"
    });
    const sortButton = header.createEl("button", {
      cls: "clickable-icon lgl-header-btn",
      attr: { type: "button" }
    });
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
  renderItem(parent, file, source, index, proximity, mention) {
    var _a;
    const item = parent.createDiv({ cls: "lgl-item" });
    if (mention) {
      item.addClass("lgl-has-mentions");
      this.renderAcceptButton(item, mention, source);
    }
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
    const propsEl = item.createDiv({ cls: "lgl-props" });
    for (const prop of props) {
      const key = prop === SORT_PROPERTY ? resolveSortProperty(this.plugin.settings) : prop;
      if (!key) continue;
      const value = key === PROXIMITY_PROPERTY ? (_a = proximity.get(file.path)) == null ? void 0 : _a.toFixed(2) : normalizeTags(key, getPropertyValue(this.app, file, key));
      const row = propsEl.createDiv({ cls: "lgl-prop" });
      if (this.plugin.settings.showPropertyNames) {
        row.createSpan({ cls: "lgl-prop-name", text: key });
      }
      const values = row.createDiv({ cls: "lgl-prop-values" });
      if (!this.renderValue(values, value, source.path)) row.remove();
    }
    if (mention) this.renderMentionSummary(propsEl, mention);
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
    const el = parent.createEl("button", {
      cls: "lgl-value lgl-tag",
      text: tag.replace(/^#/, ""),
      attr: { type: "button", "aria-label": `Search ${tag}` }
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
    /** Whole-vault adjacency, rebuilt only when links actually change. */
    this.adjacency = null;
    /** Every title and alias in the vault, rebuilt alongside the adjacency. */
    this.mentionIndex = null;
  }
  async onload() {
    await this.loadSettings();
    this.registerView(
      VIEW_TYPE_LOCAL_GRAPH_LIST,
      (leaf) => new LocalGraphListView(leaf, this)
    );
    this.addRibbonIcon("list-tree", "BetterLinks", () => this.activateView());
    this.addCommand({
      id: "open",
      name: "Open links pane",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "link-mentions",
      name: "Link remaining mentions of linked notes",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if ((file == null ? void 0 : file.extension) !== "md") return false;
        if (!checking) void this.linkMentionsIn(file);
        return true;
      }
    });
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.adjacency = null;
        this.mentionIndex = null;
      })
    );
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
  /** Undirected vault link graph, cached until the metadata cache resolves again. */
  getAdjacency() {
    if (!this.adjacency) {
      this.adjacency = buildAdjacency(this.app.metadataCache.resolvedLinks);
    }
    return this.adjacency;
  }
  /** Title and alias lookup for unlinked mentions, cached on the same cycle. */
  getMentionIndex() {
    if (!this.mentionIndex) {
      this.mentionIndex = buildMentionIndex(this.app);
    }
    return this.mentionIndex;
  }
  /**
   * Link every leftover mention of notes this one already links, in one undo
   * step. Scoped to notes you have linked yourself, so a bulk action never
   * acts on a suggestion you have not accepted.
   */
  async linkMentionsIn(file) {
    try {
      const { links, notes } = await linkMentions(
        this.app,
        file,
        this.getMentionIndex(),
        "all",
        (mention) => mention.linked
      );
      new import_obsidian4.Notice(
        links === 0 ? "No unlinked mentions of linked notes here." : `Linked ${links} mention${links === 1 ? "" : "s"} across ${notes} note${notes === 1 ? "" : "s"}.`
      );
      this.refreshViews();
    } catch (error) {
      console.error("BetterLinks: linking mentions failed", error);
      new import_obsidian4.Notice("Could not link mentions.");
    }
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
