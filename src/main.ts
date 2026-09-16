import { Plugin, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  LocalGraphListSettingTab,
  LocalGraphListSettings,
} from "./settings";
import { LocalGraphListView, VIEW_TYPE_LOCAL_GRAPH_LIST } from "./view";

export default class LocalGraphListPlugin extends Plugin {
  settings: LocalGraphListSettings = DEFAULT_SETTINGS;

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
      callback: () => this.activateView(),
    });

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
