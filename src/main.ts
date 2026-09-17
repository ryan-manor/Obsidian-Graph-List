import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  LocalGraphListSettingTab,
  LocalGraphListSettings,
} from "./settings";
import { LocalGraphListView, VIEW_TYPE_LOCAL_GRAPH_LIST } from "./view";
import { buildAdjacency, type AdjMap } from "./ppr";
import { buildMentionIndex, linkMentions, type MentionIndex } from "./mentions";

export default class LocalGraphListPlugin extends Plugin {
  settings: LocalGraphListSettings = DEFAULT_SETTINGS;

  /** Whole-vault adjacency, rebuilt only when links actually change. */
  private adjacency: AdjMap | null = null;

  /** Every title and alias in the vault, rebuilt alongside the adjacency. */
  private mentionIndex: MentionIndex | null = null;

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

    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.adjacency = null;
        this.mentionIndex = null;
      })
    );

    this.addSettingTab(new LocalGraphListSettingTab(this.app, this));
  }

  onunload() {
    // Leaves are left in place so the view is restored on next load.
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

  /** Undirected vault link graph, cached until the metadata cache resolves again. */
  getAdjacency(): AdjMap {
    if (!this.adjacency) {
      this.adjacency = buildAdjacency(this.app.metadataCache.resolvedLinks);
    }
    return this.adjacency;
  }

  /** Title and alias lookup for unlinked mentions, cached on the same cycle. */
  getMentionIndex(): MentionIndex {
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
      console.error("BetterLinks: linking mentions failed", error);
      new Notice("Could not link mentions.");
    }
  }

  /** Re-render every open instance after a settings change. */
  refreshViews(): void {
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
}
