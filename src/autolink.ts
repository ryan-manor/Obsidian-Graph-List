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
 * - Only lines written since this note was first scanned. Mentions that were
 *   already sitting in the note when auto-link first saw it are left alone, so
 *   turning the setting on never rewrites a note behind your back.
 * - Only names of four characters or more. Two- and three-letter aliases are
 *   the ambiguous ones, "ACL" being the note's own example, and they are worth
 *   suggesting but not worth writing unprompted.
 * - Only the note in the focused editor, so sync or another plugin writing the
 *   file cannot trigger edits in a note nobody is typing in.
 * - Never on a line holding a cursor or selection, so a word is not linked
 *   while it is still being typed. It gets linked on a later save, once the
 *   cursor has moved on.
 * - Applied through the editor as one transaction, so one undo removes it.
 *   Undoing, or deleting a link it made, stops auto-link for that target in
 *   that note until the plugin reloads, rather than fighting you.
 */
/** Names shorter than this are suggested but never written without a click. */
const MIN_AUTO_NAME_LENGTH = 4;

export class AutoLinker {
  /** Fewest links each auto-linked target should have, from the last auto-link on. */
  private expected = new Map<string, { count: number; at: number }>();

  /** Targets the user unlinked, per source note. */
  private declined = new Set<string>();

  /** Lines each note had when first scanned. Anything else was written since. */
  private baseline = new Map<string, Set<string>>();

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
    const lines = new Set(text.split("\n"));

    const known = this.baseline.get(file.path);
    if (!known) {
      this.baseline.set(file.path, lines);
      return;
    }

    const mentions = scanMentions(
      app,
      file,
      text,
      blockedRanges(text),
      this.plugin.getMentionIndex()
    ).filter((mention) => mention.linked && !this.declined.has(key(file, mention.file)));

    if (mentions.length === 0) return;

    const busy = editor.listSelections().map(({ anchor, head }) => [
      Math.min(anchor.line, head.line),
      Math.max(anchor.line, head.line),
    ]);
    const written = (line: number) => !known.has(editor.getLine(line));

    const changes: EditorChange[] = [];

    for (const mention of mentions) {
      let added = 0;

      for (const span of mention.spans) {
        if (span.name.length < MIN_AUTO_NAME_LENGTH) continue;

        const from = editor.offsetToPos(span.start);
        if (busy.some(([first, last]) => from.line >= first && from.line <= last)) continue;
        if (!written(from.line)) continue;

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
   * A target whose link count drops was unlinked on purpose, whether by undo
   * straight away or by deleting a link later. Every linked target is tracked,
   * not just ones auto-link wrote, so removing a link you made by hand also
   * counts as intent. A count recorded right after an auto-link is only
   * trusted once the file has been written since, so a resolve that still
   * reflects the pre-edit text is not mistaken for a deletion.
   */
  private noteDeclines(file: TFile, counts: Record<string, number>): void {
    const prefix = `${file.path}\u0000`;

    for (const target of Object.keys(counts)) {
      const id = prefix + target;
      const expected = this.expected.get(id);

      if (!expected) {
        this.expected.set(id, { count: counts[target], at: 0 });
        continue;
      }

      if (expected.at > 0 && file.stat.mtime <= expected.at) continue;

      if (counts[target] < expected.count) {
        this.declined.add(id);
        this.expected.delete(id);
      } else {
        this.expected.set(id, { count: counts[target], at: 0 });
      }
    }
  }
}

function key(source: TFile, target: TFile): string {
  return `${source.path}\u0000${target.path}`;
}
