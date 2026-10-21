import {
  CachedMetadata,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  parseFrontMatterAliases,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  RETIRED_PROPERTIES,
  LocalGraphListSettingTab,
  LocalGraphListSettings,
} from "./settings";
import { LocalGraphListView, VIEW_TYPE_LOCAL_GRAPH_LIST } from "./view";
import { buildAdjacency, type AdjMap } from "./ppr";
import {
  buildMentionIndex,
  findInboundMentions,
  linkMentions,
  type Mention,
  type MentionIndex,
} from "./mentions";

/**
 * Inbound mentions of one note, kept while that note stays open. Only notes
 * that changed since are scanned again; a new mention index means new names,
 * so it starts over.
 */
interface InboundCache {
  target: string;
  index: MentionIndex;
  found: Map<string, Mention>;
  dirty: Set<string>;
  /** Scans run one after another, so a render never reads a half-filled map. */
  ready: Promise<void>;
}

export default class LocalGraphListPlugin extends Plugin {
  settings: LocalGraphListSettings = DEFAULT_SETTINGS;

  /** Whole-vault adjacency, rebuilt only when links actually change. */
  private adjacency: AdjMap | null = null;

  /** Every title and alias in the vault, rebuilt only when names change. */
  private mentionIndex: MentionIndex | null = null;

  private inbound: InboundCache | null = null;

  /**
   * Per-file link targets and aliases as of the last build, so an edit that
   * only touches prose can be told apart from one that changes the graph.
   */
  private linkSignatures = new Map<string, string>();
  private aliasSignatures = new Map<string, string>();

  /** What changed since the last "resolved", handed to the views then. */
  private structureChanged = false;
  private changedPaths = new Set<string>();

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_LOCAL_GRAPH_LIST,
      (leaf) => new LocalGraphListView(leaf, this)
    );

    this.addRibbonIcon("list-plus", "Graph List", () => this.activateView());

    this.addCommand({
      id: "open",
      name: "Open",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "link-mentions",
      name: "Link remaining mentions of linked notes",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "md") return false;
        if (!checking) void this.linkMentionsIn(file);
        return true;
      },
    });

    this.registerHoverLinkSource(VIEW_TYPE_LOCAL_GRAPH_LIST, {
      display: "Graph List",
      defaultMod: true,
    });

    // Typing fires these on every pause, so drop the whole-vault structures
    // only when what they are built from actually changed.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        this.changedPaths.add(file.path);
        this.markInboundDirty(file.path);
        this.checkAliases(file, cache);
      })
    );
    this.registerEvent(this.app.metadataCache.on("resolve", (file) => this.checkLinks(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.onStructureChange(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onStructureChange(file)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.onStructureChange(file, oldPath))
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        const structural = this.structureChanged;
        const paths = this.changedPaths;
        this.structureChanged = false;
        this.changedPaths = new Set();
        for (const view of this.views()) view.onMetadataResolved(structural, paths);
      })
    );

    this.addSettingTab(new LocalGraphListSettingTab(this.app, this));
  }

  onunload() {
    // Leaves are left in place so the view is restored on next load.
  }

  /** A file appearing, going or moving changes both names and links. */
  private onStructureChange(file: TAbstractFile, oldPath?: string): void {
    this.adjacency = null;
    this.mentionIndex = null;
    this.inbound = null;
    this.structureChanged = true;
    this.changedPaths.add(file.path);
    if (oldPath) this.changedPaths.add(oldPath);
  }

  /** Drop the adjacency when this file's resolved link targets changed. */
  private checkLinks(file: TFile): void {
    if (!this.adjacency) return;
    const signature = linkSignature(this.app.metadataCache.resolvedLinks[file.path]);
    if (signature === (this.linkSignatures.get(file.path) ?? "")) return;
    this.adjacency = null;
    this.structureChanged = true;
  }

  /** Drop the mention index when this file's aliases changed. */
  private checkAliases(file: TFile, cache: CachedMetadata): void {
    if (!this.mentionIndex) return;
    const signature = aliasSignature(cache);
    if (signature === (this.aliasSignatures.get(file.path) ?? "")) return;
    this.mentionIndex = null;
    this.structureChanged = true;
  }

  private views(): LocalGraphListView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_LOCAL_GRAPH_LIST)
      .map((leaf) => leaf.view)
      .filter((view): view is LocalGraphListView => view instanceof LocalGraphListView);
  }

  /** Reveal the view in the right sidebar, creating it if needed. */
  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_LOCAL_GRAPH_LIST)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_LOCAL_GRAPH_LIST, active: true });
    }

    if (leaf) await workspace.revealLeaf(leaf);
  }

  /** Undirected vault link graph, cached until some note's links change. */
  getAdjacency(): AdjMap {
    if (!this.adjacency) {
      const { resolvedLinks } = this.app.metadataCache;
      this.adjacency = buildAdjacency(resolvedLinks);
      this.linkSignatures.clear();
      for (const path in resolvedLinks) {
        this.linkSignatures.set(path, linkSignature(resolvedLinks[path]));
      }
    }
    return this.adjacency;
  }

  /** Title and alias lookup for unlinked mentions, cached until names change. */
  getMentionIndex(): MentionIndex {
    if (!this.mentionIndex) {
      this.mentionIndex = buildMentionIndex(this.app);
      this.aliasSignatures.clear();
      for (const file of this.app.vault.getMarkdownFiles()) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache) this.aliasSignatures.set(file.path, aliasSignature(cache));
      }
    }
    return this.mentionIndex;
  }

  /**
   * Notes that name `target` without linking it, keyed by source path. The
   * first call for a note reads the whole vault; later ones rescan only the
   * notes that changed since.
   */
  async getInboundMentions(target: TFile): Promise<Map<string, Mention>> {
    const index = this.getMentionIndex();
    let cache = this.inbound;
    let full = false;

    if (!cache || cache.target !== target.path || cache.index !== index) {
      cache = { target: target.path, index, found: new Map(), dirty: new Set(), ready: Promise.resolve() };
      this.inbound = cache;
      full = true;
    }

    const current = cache;
    current.ready = current.ready.then(async () => {
      let sources: TFile[];
      if (full) {
        sources = this.app.vault.getMarkdownFiles();
      } else {
        sources = [];
        for (const path of current.dirty) {
          current.found.delete(path);
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) sources.push(file);
        }
      }
      current.dirty.clear();

      const found = await findInboundMentions(this.app, target, index, sources);
      for (const [path, mention] of found) current.found.set(path, mention);
    });

    try {
      await current.ready;
    } catch (error) {
      // A failed scan must not poison every later render of this note.
      if (this.inbound === current) this.inbound = null;
      throw error;
    }
    return current.found;
  }

  /** Rescan `path` the next time inbound mentions are asked for. */
  markInboundDirty(path: string): void {
    this.inbound?.dirty.add(path);
  }

  /**
   * Link every leftover mention of notes this one already links, in one undo
   * step. Scoped to notes you have linked yourself, so a bulk action never
   * acts on a suggestion you have not accepted.
   */
  private async linkMentionsIn(file: TFile): Promise<void> {
    try {
      const { links, notes } = await linkMentions(
        this.app,
        file,
        this.getMentionIndex(),
        "all",
        (mention) => mention.linked
      );

      new Notice(
        links === 0
          ? "No unlinked mentions of linked notes here."
          : `Linked ${links} mention${links === 1 ? "" : "s"} across ${notes} note${notes === 1 ? "" : "s"}.`
      );
      this.refreshViews();
    } catch (error) {
      console.error("Graph List: linking mentions failed", error);
      new Notice("Could not link mentions.");
    }
  }

  /** Re-render every open instance after a settings change. */
  refreshViews(): void {
    for (const view of this.views()) view.render();
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<LocalGraphListSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // A fresh array, since the settings tab edits it in place, minus retired keys.
    this.settings.properties = this.settings.properties.filter((key) => !RETIRED_PROPERTIES.has(key));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/** Link targets only: counts do not change the adjacency. */
function linkSignature(links: Record<string, number> | undefined): string {
  return links ? Object.keys(links).sort().join("\n") : "";
}

function aliasSignature(cache: CachedMetadata): string {
  return (parseFrontMatterAliases(cache.frontmatter) ?? []).join("\n");
}
