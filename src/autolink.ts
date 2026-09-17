import { EditorChange, TFile } from "obsidian";
import type LocalGraphListPlugin from "./main";
import { blockedRanges, linkForSpan, scanMentions } from "./mentions";

/**
 * Links new mentions of notes this one already links, as you write. Only runs
 * with the mention scope set to "all", where a link you already made says you
 * want every mention of that note linked.
 *
 * Deliberately narrow:
 * - Only targets already linked in the note. A note you never linked stays a
 *   suggestion with a button, never an edit.
 * - Only the note in the focused editor, so sync or another plugin writing the
 *   file cannot trigger edits in a note nobody is typing in.
 * - Never on a line holding a cursor or selection, so a word is not linked
 *   while it is still being typed. It gets linked on a later save, once the
 *   cursor has moved on.
 * - Applied through the editor as one transaction, so one undo removes it.
 *   Undoing, or deleting a link it made, stops auto-link for that target in
 *   that note until the plugin reloads, rather than fighting you.
 */
export class AutoLinker {
  /** Fewest links each auto-linked target should have, from the last auto-link on. */
  private expected = new Map<string, { count: number; at: number }>();

  /** Targets the user unlinked after an auto-link, per source note. */
  private declined = new Set<string>();

  constructor(private plugin: LocalGraphListPlugin) {}

  /** Runs on the metadata cache's per-file `resolve`, when link counts are fresh. */
  onResolve(file: TFile): void {
    const { app, settings } = this.plugin;
    if (!settings.showMentions || settings.mentionScope !== "all" || !settings.autoLink) {
      return;
    }

    const context = app.workspace.activeEditor;
    const editor = context?.editor;
    if (!editor || context.file?.path !== file.path || !editor.hasFocus()) return;

    const counts = app.metadataCache.resolvedLinks[file.path] ?? {};
    this.noteDeclines(file, counts);

    const text = editor.getValue();
    const mentions = scanMentions(
      app,
      file,
      text,
      blockedRanges(text, null),
      this.plugin.getMentionIndex()
    ).filter((mention) => mention.linked && !this.declined.has(key(file, mention.file)));

    if (mentions.length === 0) return;

    const busy = editor.listSelections().map(({ anchor, head }) => [
      Math.min(anchor.line, head.line),
      Math.max(anchor.line, head.line),
    ]);

    const changes: EditorChange[] = [];

    for (const mention of mentions) {
      let added = 0;

      for (const span of mention.spans) {
        const from = editor.offsetToPos(span.start);
        if (busy.some(([first, last]) => from.line >= first && from.line <= last)) continue;

        changes.push({
          from,
          to: editor.offsetToPos(span.end),
          text: linkForSpan(app, file, mention.file, text, span),
        });
        added += 1;
      }

      if (added > 0) {
        this.expected.set(key(file, mention.file), {
          count: (counts[mention.file.path] ?? 0) + added,
          at: Date.now(),
        });
      }
    }

    if (changes.length > 0) editor.transaction({ changes });
  }

  /**
   * A target that drops below the most links it has had since auto-link
   * touched it was unlinked on purpose, whether by undo straight away or by
   * deleting the link later. Only checked once the file has been written since
   * the auto-link, so a resolve that still reflects the pre-edit text is not
   * mistaken for one.
   */
  private noteDeclines(file: TFile, counts: Record<string, number>): void {
    const prefix = `${file.path}\u0000`;

    for (const [id, expected] of this.expected) {
      if (!id.startsWith(prefix) || file.stat.mtime <= expected.at) continue;

      const actual = counts[id.slice(prefix.length)] ?? 0;
      if (actual < expected.count) {
        this.declined.add(id);
        this.expected.delete(id);
      } else {
        expected.count = actual;
      }
    }
  }
}

function key(source: TFile, target: TFile): string {
  return `${source.path}\u0000${target.path}`;
}
