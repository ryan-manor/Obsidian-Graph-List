import {
  ItemView,
  Keymap,
  Menu,
  Notice,
  TFile,
  WorkspaceLeaf,
  debounce,
  setIcon,
} from "obsidian";
import type LocalGraphListPlugin from "./main";
import { findLinkRange, snippetFor, type LinkRange } from "./context";
import { NOTE_EXTENSIONS, buildGroups, getPropertyValue, unwrapLink, type Direction } from "./graph";
import type { SortKey } from "./settings";
import { proximityScores, suggestNotes, type Suggestion } from "./ppr";
import {
  findUnlinkedMentions,
  linkMention,
  makeIgnoreTest,
  type Mention,
  type MentionScope,
} from "./mentions";

/** Undocumented internals used to open core search on a tag. */
interface AppWithInternalPlugins {
  internalPlugins?: { getPluginById(id: string): unknown };
}

interface GlobalSearchPlugin {
  instance?: { openGlobalSearch(query: string): void };
}

/**
 * Kept at the old plugin id on purpose: the view type is persisted in
 * workspace.json, so changing it would orphan the pane people have open.
 */
export const VIEW_TYPE_LOCAL_GRAPH_LIST = "local-graph-list";

const SORT_LABELS: Record<SortKey, string> = {
  proximity: "Graph proximity",
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

/** A mention of the open note in `source`, where its link button writes. */
type Inbound = Mention & { source: TFile };

/**
 * One row of a link group, linked either way or a ghost. A mention carries
 * the button that writes the link: outbound into the open note, inbound into
 * the row's note.
 */
interface Row {
  file: TFile;
  linked: boolean;
  outMention?: Mention;
  inMention?: Inbound;
}

/** Rows in the Suggested group. A suggestion list is read, not scrolled. */
const MAX_SUGGESTIONS = 8;

/** Shared neighbours named on a suggestion row before the rest become "+N". */
const MAX_VIA = 3;

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class LocalGraphListView extends ItemView {
  plugin: LocalGraphListPlugin;

  /** File the current render is for, so metadata events can be filtered cheaply. */
  private renderedPaths = new Set<string>();

  private scheduleRender = debounce(() => this.render(), 150, true);

  /** Note text read for link context, shared by the rows of one render. */
  private texts = new Map<string, Promise<string>>();

  /** Discards an in-flight render whose mention scan was overtaken. */
  private renderToken = 0;

  constructor(leaf: WorkspaceLeaf, plugin: LocalGraphListPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LOCAL_GRAPH_LIST;
  }

  getDisplayText(): string {
    return "Graph List";
  }

  getIcon(): string {
    return "list-plus";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("lgl-view");

    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleRender()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.scheduleRender())
    );
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRender()));

    this.render();
  }

  async onClose(): Promise<void> {
    this.scheduleRender.cancel();
    // Any render still waiting on its mention scan sees a stale token and stops.
    this.renderToken += 1;
    this.contentEl.empty();
  }

  /**
   * Called by the plugin once the metadata cache settles. Re-render when the
   * graph or the names changed, or when a note on screen did; an edit to some
   * unrelated note leaves the list alone.
   */
  onMetadataResolved(structural: boolean, paths: Set<string>): void {
    if (structural || [...paths].some((path) => this.renderedPaths.has(path))) {
      this.scheduleRender();
    }
  }

  /** Last markdown-ish file the user looked at, ignoring this sidebar view. */
  private getTargetFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  render(): void {
    this.renderAsync().catch((error) => console.error("Graph List: render failed", error));
  }

  private async renderAsync(): Promise<void> {
    const token = ++this.renderToken;
    const file = this.getTargetFile();

    // Mentions need the file's text, so gather them before touching the DOM.
    // A newer render started while we waited wins.
    let mentions: Mention[] = [];
    if (file?.extension === "md" && this.plugin.settings.showMentions) {
      // A failed scan costs the mention rows, not the links themselves.
      try {
        mentions = await findUnlinkedMentions(this.app, file, this.plugin.getMentionIndex());
      } catch (error) {
        console.error("Graph List: mention scan failed", error);
      }
      if (token !== this.renderToken) return;

      // With "first", a linked note is done: its other mentions stay plain.
      // With "all", leftover mentions of a linked note bring its button back.
      if (this.plugin.settings.mentionScope === "first") {
        mentions = mentions.filter((mention) => !mention.linked);
      }
    }

    let inbound = new Map<string, Inbound>();
    if (file?.extension === "md" && this.plugin.settings.showInboundMentions) {
      try {
        inbound = this.collectInbound(await this.plugin.getInboundMentions(file));
      } catch (error) {
        console.error("Graph List: inbound mention scan failed", error);
      }
      if (token !== this.renderToken) return;
    }

    const { contentEl } = this;
    contentEl.empty();
    this.renderedPaths.clear();
    this.texts.clear();

    this.renderHeader(contentEl, file);

    if (!file) {
      contentEl.createDiv({ cls: "lgl-empty", text: "No file open." });
      return;
    }

    this.renderedPaths.add(file.path);

    const { settings } = this.plugin;
    const outbound = new Map(mentions.map((mention) => [mention.file.path, mention]));

    // Notes named but not linked yet, each way. They rank alongside the real
    // links, so accepting one only turns its row solid.
    const unlinked: Record<Direction, TFile[]> = {
      out: mentions.filter((mention) => !mention.linked).map((mention) => mention.file),
      in: [...inbound.values()].filter((mention) => !mention.linked).map((mention) => mention.source),
    };
    const ghostPaths = new Set([...unlinked.out, ...unlinked.in].map((ghost) => ghost.path));

    const adjacency = this.plugin.getAdjacency();
    const proximity = proximityScores(adjacency, file.path, settings.algorithm, ghostPaths);
    const groups = buildGroups(this.app, file, settings, proximity, unlinked);

    // A suggestion that is also an unlinked mention already has a ghost row
    // with a link button, so it is left to that row.
    const suggestions =
      settings.depth === 2
        ? this.collectSuggestions(suggestNotes(adjacency, file.path, settings.algorithm), ghostPaths)
        : [];

    if (groups.every((group) => group.files.length === 0) && suggestions.length === 0) {
      contentEl.createDiv({ cls: "lgl-empty", text: "No linked notes." });
      return;
    }

    const links = this.app.metadataCache.resolvedLinks;
    for (const group of groups) {
      if (group.files.length === 0) continue;

      // Linked in this group's direction: a note A links to but that only names
      // A back is still a ghost under Linked from.
      const linksOut = (neighbor: TFile) => Boolean(links[file.path]?.[neighbor.path]);
      const linksIn = (neighbor: TFile) => Boolean(links[neighbor.path]?.[file.path]);
      const rows = group.files.map((neighbor): Row => ({
        file: neighbor,
        linked:
          group.direction === "out"
            ? linksOut(neighbor)
            : group.direction === "in"
              ? linksIn(neighbor)
              : linksOut(neighbor) || linksIn(neighbor),
        outMention: group.direction === "in" ? undefined : outbound.get(neighbor.path),
        inMention: group.direction === "out" ? undefined : inbound.get(neighbor.path),
      }));
      const ghosts = rows.filter((row) => !row.linked).length;

      const header = contentEl.createDiv({ cls: "lgl-group-header" });
      header.createSpan({ cls: "lgl-group-label", text: group.label });
      header.createSpan({
        cls: "lgl-group-count",
        text: ghosts ? `${rows.length - ghosts} +${ghosts}` : String(rows.length),
      });

      const list = contentEl.createDiv({ cls: "lgl-list" });
      rows.forEach((row, index) => {
        this.renderedPaths.add(row.file.path);
        this.renderItem(list, row.file, file, index + 1, {
          row,
          direction: group.direction,
        });
      });
    }

    this.renderSuggestions(contentEl, file, suggestions);
    this.renderUnresolved(contentEl, file);
  }

  /**
   * Inbound mentions by source path. In "first" scope a note that already
   * links this one is done, the same rule as outbound.
   */
  private collectInbound(found: Map<string, Mention>): Map<string, Inbound> {
    const rows = new Map<string, Inbound>();
    for (const [path, mention] of found) {
      if (this.plugin.settings.mentionScope === "first" && mention.linked) continue;
      const source = this.app.vault.getAbstractFileByPath(path);
      if (source instanceof TFile) rows.set(path, { ...mention, source });
    }
    return rows;
  }

  /** Suggestions that can be rows: existing notes, not excluded, not already ghosts. */
  private collectSuggestions(
    suggestions: Suggestion[],
    ghostPaths: Set<string>
  ): { file: TFile; via: TFile[] }[] {
    const ignored = makeIgnoreTest(this.app);
    const rows: { file: TFile; via: TFile[] }[] = [];

    for (const suggestion of suggestions) {
      if (rows.length >= MAX_SUGGESTIONS) break;
      if (ghostPaths.has(suggestion.path) || ignored(suggestion.path)) continue;
      const target = this.app.vault.getAbstractFileByPath(suggestion.path);
      if (!(target instanceof TFile) || target.extension !== "md") continue;

      // Attachments are not rows, so two shared images are not a reason.
      const via: TFile[] = [];
      for (const path of suggestion.via) {
        const shared = this.app.vault.getAbstractFileByPath(path);
        if (shared instanceof TFile && NOTE_EXTENSIONS.has(shared.extension)) via.push(shared);
      }
      if (via.length >= 2) rows.push({ file: target, via });
    }

    return rows;
  }

  /**
   * Notes two links away that this one does not link yet, ranked by the same
   * shared-neighbour score as the list. Each row names the notes it shares,
   * which is the reason it is here.
   */
  private renderSuggestions(
    parent: HTMLElement,
    file: TFile,
    suggestions: { file: TFile; via: TFile[] }[]
  ): void {
    if (suggestions.length === 0) return;

    const header = parent.createDiv({ cls: "lgl-group-header" });
    header.createSpan({ cls: "lgl-group-label", text: "Suggested" });
    header.createSpan({ cls: "lgl-group-count", text: String(suggestions.length) });

    const list = parent.createDiv({ cls: "lgl-list" });
    suggestions.forEach((suggestion, index) => {
      this.renderedPaths.add(suggestion.file.path);
      this.renderItem(list, suggestion.file, file, index + 1, { via: suggestion.via });
    });
  }

  /** "Shares 3:" followed by the shared notes as links, strongest first. */
  private renderVia(propsEl: HTMLElement, via: TFile[], source: TFile): void {
    const row = propsEl.createDiv({ cls: "lgl-prop lgl-via-row" });
    const values = row.createDiv({ cls: "lgl-prop-values" });
    values.createSpan({ cls: "lgl-value lgl-mention-count", text: `Shares ${via.length}:` });

    for (const shared of via.slice(0, MAX_VIA)) {
      const el = values.createEl("a", {
        cls: "lgl-value lgl-pill internal-link",
        text: shared.basename,
        href: shared.path,
      });
      el.addEventListener("click", (evt) => {
        evt.preventDefault();
        void this.app.workspace.openLinkText(shared.path, source.path, Keymap.isModEvent(evt));
      });
    }

    if (via.length > MAX_VIA) {
      values.createSpan({ cls: "lgl-value lgl-mention-count", text: `+${via.length - MAX_VIA}` });
    }
  }

  /**
   * Links to notes that do not exist. The outgoing pane keeps these in their
   * own section, and without them this view cannot replace it. Clicking one
   * creates the note, which is what Obsidian itself does.
   */
  private renderUnresolved(parent: HTMLElement, file: TFile): void {
    const entries = Object.entries(this.app.metadataCache.unresolvedLinks[file.path] ?? {});
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
        href: name,
      });
      title.addEventListener("click", (evt) => {
        evt.preventDefault();
        void this.app.workspace.openLinkText(name, file.path, Keymap.isModEvent(evt));
      });

      if (count > 1) {
        const props = item.createDiv({ cls: "lgl-props" });
        const row = props.createDiv({ cls: "lgl-prop lgl-mention-row" });
        row
          .createDiv({ cls: "lgl-prop-values" })
          .createSpan({ cls: "lgl-value lgl-mention-count", text: `${count} links` });
      }
    });
  }

  /**
   * Hover button that links the mention in `editIn`, first occurrence or all
   * per the scope. `open` is the note the list is for.
   */
  private renderAcceptButton(parent: HTMLElement, mention: Mention, editIn: TFile, open: TFile): void {
    const scope = this.plugin.settings.mentionScope;
    const accept = parent.createEl("button", {
      cls: "clickable-icon lgl-accept",
      attr: { type: "button" },
    });
    setIcon(accept, "link");
    const where = editIn.path === open.path ? "" : ` in "${editIn.basename}"`;
    accept.setAttribute(
      "aria-label",
      scope === "all" && mention.count > 1
        ? `Link all ${mention.count} mentions${where}`
        : `Link "${mention.spans[0]?.name ?? mention.name}"${where}`
    );
    accept.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void this.acceptMention(accept, editIn, open, mention, scope);
    });
  }

  /** Link the mention, unless the row is busy or no longer for the open note. */
  private async acceptMention(
    accept: HTMLButtonElement,
    editIn: TFile,
    open: TFile,
    mention: Mention,
    scope: MentionScope
  ): Promise<void> {
    // One link at a time per row: a double click would otherwise link the
    // first mention and then the next one.
    if (accept.disabled) return;

    // The rows outlive a file switch by the render debounce, so check the
    // click is still for the note on screen before writing to it.
    if (this.getTargetFile()?.path !== open.path) {
      this.render();
      return;
    }

    accept.disabled = true;
    try {
      const linked = await linkMention(
        this.app,
        editIn,
        mention.file,
        this.plugin.getMentionIndex(),
        scope
      );
      // A new link re-renders once the metadata cache has parsed it, through
      // onMetadataResolved. Rendering now would drop the ghost row a beat before
      // its solid one exists.
      this.plugin.markInboundDirty(editIn.path);
      if (linked === 0) {
        new Notice(`No unlinked mention of "${mention.file.basename}" left.`);
        this.render();
      }
    } catch (error) {
      console.error("Graph List: linking failed", error);
      new Notice(`Could not link "${mention.file.basename}".`);
    } finally {
      accept.disabled = false;
    }
  }

  /**
   * Mention count, plus the alias that matched when it is not the title.
   * Inbound reads "of this", so a row with both kinds can tell them apart.
   */
  private renderMentionSummary(propsEl: HTMLElement, mention: Mention, direction: Direction): void {
    const row = propsEl.createDiv({ cls: "lgl-prop lgl-mention-row" });
    const values = row.createDiv({ cls: "lgl-prop-values" });

    const noun = mention.linked ? "unlinked mention" : "mention";
    values.createSpan({
      cls: "lgl-value lgl-mention-count",
      text: `${mention.count} ${noun}${mention.count === 1 ? "" : "s"}${direction === "in" ? " of this" : ""}`,
    });

    // Which text matched, so an alias match is not a mystery. Capped, since a
    // note can carry more aliases than the row has room for.
    for (const name of mention.names.slice(0, 3)) {
      if (name === mention.file.basename) continue;
      values.createSpan({ cls: "lgl-value lgl-pill", text: name });
    }
  }

  private renderHeader(parent: HTMLElement, file: TFile | null): void {
    const header = parent.createDiv({ cls: "lgl-header" });

    header.createDiv({
      cls: "lgl-header-title",
      text: file ? file.basename : "Nothing open",
    });

    const sortButton = header.createEl("button", {
      cls: "clickable-icon lgl-header-btn",
      attr: { type: "button" },
    });
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
    index: number,
    options: { row?: Row; direction?: Direction; via?: TFile[] } = {}
  ): void {
    const { row, direction, via } = options;
    const item = parent.createDiv({ cls: via ? "lgl-item lgl-suggested" : "lgl-item" });
    if (row && !row.linked) item.addClass("lgl-ghost");

    if (row?.outMention || row?.inMention) {
      item.addClass("lgl-has-mentions");
      const actions = item.createDiv({ cls: "lgl-actions" });
      if (row.inMention) this.renderAcceptButton(actions, row.inMention, file, source);
      if (row.outMention) this.renderAcceptButton(actions, row.outMention, source, source);
    }

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
      void this.app.workspace.openLinkText(file.path, source.path, Keymap.isModEvent(evt));
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

    const { settings } = this.plugin;
    const propsEl = item.createDiv({ cls: "lgl-props" });

    if (settings.preview === "context" && row) {
      // Filled once the note's text is read; removed if there is no line to show.
      const contextEl = propsEl.createDiv({ cls: "lgl-context" });
      void this.renderContext(contextEl, row, source, direction).catch((error) => {
        console.error("Graph List: link context failed", error);
        contextEl.remove();
      });
    } else if (row) {
      this.renderProperties(propsEl, file, source);
      if (row.outMention) this.renderMentionSummary(propsEl, row.outMention, "out");
      if (row.inMention) this.renderMentionSummary(propsEl, row.inMention, "in");
    } else {
      this.renderProperties(propsEl, file, source);
    }

    if (via) this.renderVia(propsEl, via, source);

    if (propsEl.childElementCount === 0) propsEl.remove();
  }

  private renderProperties(propsEl: HTMLElement, file: TFile, source: TFile): void {
    for (const key of this.plugin.settings.properties.filter(Boolean)) {
      const value = normalizeTags(key, getPropertyValue(this.app, file, key));
      const row = propsEl.createDiv({ cls: "lgl-prop" });

      if (this.plugin.settings.showPropertyNames) {
        row.createSpan({ cls: "lgl-prop-name", text: key });
      }

      const values = row.createDiv({ cls: "lgl-prop-values" });
      if (!this.renderValue(values, value, source.path)) row.remove();
    }
  }

  /**
   * Where the row's link sits, first occurrence only: the open note's line for
   * an outbound link, the row note's line for an inbound one, and the mention
   * itself for a ghost. A row linked both ways quotes the open note.
   */
  private findContext(row: Row, open: TFile, direction?: Direction): { from: TFile; range: LinkRange } | null {
    const links = this.app.metadataCache.resolvedLinks;
    const candidates: [TFile, () => LinkRange | null | undefined][] = [
      [open, () => direction !== "in" && links[open.path]?.[row.file.path] ? findLinkRange(this.app, open, row.file) : null],
      [row.file, () => direction !== "out" && links[row.file.path]?.[open.path] ? findLinkRange(this.app, row.file, open) : null],
      [open, () => row.outMention?.spans[0]],
      [row.file, () => row.inMention?.spans[0]],
    ];
    for (const [from, find] of candidates) {
      const range = find();
      if (range) return { from, range };
    }
    return null;
  }

  private async renderContext(el: HTMLElement, row: Row, open: TFile, direction?: Direction): Promise<void> {
    const drop = () => {
      const parent = el.parentElement;
      el.remove();
      if (parent?.childElementCount === 0) parent.remove();
    };

    const found = this.findContext(row, open, direction);
    if (!found) {
      drop();
      return;
    }

    const { from, range } = found;
    let read = this.texts.get(from.path);
    if (!read && "start" in range) {
      read = this.app.vault.cachedRead(from);
      this.texts.set(from.path, read);
    }
    const text = read ? await read : "";
    const snippet = snippetFor(text, range);
    if (!snippet.match && !snippet.before && !snippet.after) {
      drop();
      return;
    }

    el.createSpan({ text: snippet.before });
    el.createSpan({ cls: "lgl-context-match", text: snippet.match });
    el.createSpan({ text: snippet.after });

    // Clicking the line opens its note at that line.
    const line = "start" in range ? text.slice(0, range.start).split("\n").length - 1 : 0;
    el.setAttribute("aria-label", `Open "${from.basename}" at this line`);
    el.addEventListener("click", (evt) => {
      evt.preventDefault();
      void this.app.workspace
        .getLeaf(Keymap.isModEvent(evt))
        .openFile(from, { eState: { line } });
    });
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
      parent.createSpan({ cls: "lgl-value", text: JSON.stringify(value) });
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
    const el = parent.createEl("button", {
      cls: "lgl-value lgl-tag",
      text: tag.replace(/^#/, ""),
      attr: { type: "button", "aria-label": `Search ${tag}` },
    });
    el.addEventListener("click", (evt) => {
      evt.preventDefault();
      const { internalPlugins } = this.app as AppWithInternalPlugins;
      const search = internalPlugins?.getPluginById("global-search") as GlobalSearchPlugin | null;
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
      void this.app.workspace.openLinkText(target, sourcePath, Keymap.isModEvent(evt));
    });
  }
}
