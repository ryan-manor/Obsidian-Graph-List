import { App, Editor, MarkdownView, TFile, parseFrontMatterAliases } from "obsidian";

/**
 * Outbound unlinked mentions: text in this note that names another note but
 * isn't a link yet. Inbound ones are the same thing seen from the other side,
 * see `findInboundMentions`.
 *
 * Obsidian's own pane matches case-insensitive substrings and renders one row
 * per occurrence, which on a working note is mostly noise: `Bases-style` counts
 * as a mention of "Style Understanding Home", a URL or a code block counts the
 * same as prose, and a target already linked once still suggests every other
 * time it appears.
 *
 * Matching itself stays case-insensitive like Obsidian's, so a lowercase
 * "style" still nudges towards the Style page. Everything filtered below is
 * structural.
 *
 * Nothing here is a ranking signal. It is all structural, so it costs one
 * cached read and no corpus statistics.
 */
export interface Mention {
  file: TFile;
  /** Longest matched name, which is an alias when the match came from one. */
  name: string;
  /** Distinct names that matched, in the order they first appear. */
  names: string[];
  /** Clean unlinked occurrences, under any of the target's names. */
  count: number;
  /** Whether this note already links to the target somewhere. */
  linked: boolean;
  /** Clean unlinked occurrences, in document order. */
  spans: Span[];
}

export interface Span {
  start: number;
  end: number;
  /** Which of the target's names matched here. */
  name: string;
}

/** Link only the first mention of a target, or every mention. */
export type MentionScope = "first" | "all";

interface Candidate {
  name: string;
  lower: string;
  file: TFile;
}

/** Candidates bucketed by their lowercased first word, to skip most of them cheaply. */
export type MentionIndex = Map<string, Candidate[]>;

/** Shape of the untyped `metadataCache.getLinkSuggestions()` entries we use. */
interface LinkSuggestion {
  file?: TFile | null;
  alias?: string;
}

/**
 * Titles this short are usually stubs or initials that collide with prose.
 * An alias is different: it was written by hand to stand for this note, so a
 * two-letter one like "Lr" is meant, and whole-word matching keeps it honest.
 */
const MIN_TITLE_LENGTH = 3;
const MIN_ALIAS_LENGTH = 2;

/** Letters, digits and the joiners that make a hyphenated or snake-cased word one word. */
const WORD_CHAR = /[\p{L}\p{N}_-]/u;

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Every note title and alias in the vault, keyed by first word. Rebuilt only
 * when the metadata cache resolves, since it changes with renames and aliases.
 */
export function buildMentionIndex(app: App): MentionIndex {
  const index: MentionIndex = new Map();
  const seen = new Set<string>();
  const ignored = makeIgnoreTest(app);

  const suggestions = linkSuggestions(app);

  for (const suggestion of suggestions) {
    const file = suggestion.file;
    if (!file || file.extension !== "md") continue;
    if (ignored(file.path)) continue;

    const name = suggestion.alias ?? file.basename;
    if (name.length < (suggestion.alias ? MIN_ALIAS_LENGTH : MIN_TITLE_LENGTH)) continue;

    const key = `${file.path}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // The same lowercasing as the text, so a match is exactly as long as the name.
    const lower = toLowerKeepingOffsets(name);
    const first = lower.match(WORD)?.[0];
    if (!first) continue;

    const candidate: Candidate = { name, lower, file };

    const bucket = index.get(first);
    if (bucket) bucket.push(candidate);
    else index.set(first, [candidate]);
  }

  return index;
}

/**
 * Every title and alias, from the link suggester when the app has it. That
 * method is private, so fall back to the public file list and frontmatter
 * rather than let mentions quietly disappear if it is ever renamed.
 */
function linkSuggestions(app: App): LinkSuggestion[] {
  const cache = app.metadataCache as unknown as {
    getLinkSuggestions?: () => LinkSuggestion[];
  };
  if (typeof cache.getLinkSuggestions === "function") return cache.getLinkSuggestions();

  const suggestions: LinkSuggestion[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    suggestions.push({ file });
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    for (const alias of parseFrontMatterAliases(frontmatter) ?? []) {
      suggestions.push({ file, alias });
    }
  }
  return suggestions;
}

/**
 * A test against Obsidian's "Excluded files" setting, which is what its own
 * link suggester and unlinked mentions honour. `isUserIgnored` lives on the
 * metadata cache at runtime but is not in obsidian.d.ts, so fall back to the
 * raw filter list: each entry is a path fragment, or a regex when slash-wrapped.
 */
export function makeIgnoreTest(app: App): (path: string) => boolean {
  const cache = app.metadataCache as unknown as {
    isUserIgnored?: (path: string) => boolean;
  };
  if (typeof cache.isUserIgnored === "function") {
    return (path) => cache.isUserIgnored?.(path) ?? false;
  }

  const config = (app.vault as unknown as { getConfig?: (key: string) => unknown })
    .getConfig?.("userIgnoreFilters");
  const filters = Array.isArray(config) ? (config as string[]) : [];
  if (filters.length === 0) return () => false;

  const tests = filters.map((filter) => {
    const pattern = filter.match(/^\/(.*)\/$/);
    if (pattern) {
      try {
        const expression = new RegExp(pattern[1], "i");
        return (path: string) => expression.test(path);
      } catch {
        return () => false;
      }
    }
    const fragment = filter.toLowerCase();
    return (path: string) => path.toLowerCase().includes(fragment);
  });

  return (path) => tests.some((test) => test(path));
}

/**
 * Unlinked mentions in `file`, one entry per target rather than per
 * occurrence. Targets the note already links are included and flagged, since
 * whether their leftover mentions matter depends on the mention scope.
 */
export async function findUnlinkedMentions(
  app: App,
  file: TFile,
  index: MentionIndex
): Promise<Mention[]> {
  // Only markdown has prose to mention anything. A canvas or a base is JSON,
  // and note names inside its file paths would match and take a wikilink.
  if (file.extension !== "md") return [];

  const text = await app.vault.cachedRead(file);
  return scanMentions(app, file, text, blockedRanges(text), index);
}

/**
 * Inbound unlinked mentions: notes among `sources` that name `target` without
 * linking it there, keyed by source path. Each value is the target's mention as
 * seen from that source, so the link button writes into the source with the
 * same matcher and rules as an outbound row.
 *
 * A common name like "Style" turns up in hundreds of notes, mostly inside
 * longer words, links or code, so the target's own names are tried first,
 * cheapest test first, and only notes with a clean match get the full scan
 * that settles overlaps with every other title.
 */
export async function findInboundMentions(
  app: App,
  target: TFile,
  index: MentionIndex,
  sources: Iterable<TFile>
): Promise<Map<string, Mention>> {
  const found = new Map<string, Mention>();
  if (target.extension !== "md") return found;

  const own: Candidate[] = [];
  for (const candidates of index.values()) {
    for (const candidate of candidates) {
      if (candidate.file.path === target.path) own.push(candidate);
    }
  }
  if (own.length === 0) return found;

  const ignored = makeIgnoreTest(app);
  const matches = (text: string, lower: string, blocked: Range[]) =>
    own.some((candidate) => findOccurrences(text, lower, candidate, blocked).length > 0);

  for (const source of sources) {
    if (source.extension !== "md" || source.path === target.path || ignored(source.path)) continue;

    const text = await app.vault.cachedRead(source);
    const lower = toLowerKeepingOffsets(text);
    if (!own.some((candidate) => lower.includes(candidate.lower))) continue;
    if (!matches(text, lower, [])) continue;

    const blocked = blockedRanges(text);
    if (!matches(text, lower, blocked)) continue;

    const mention = scanMentions(app, source, text, blocked, index).find(
      (entry) => entry.file.path === target.path
    );
    if (mention) found.set(source.path, mention);
  }

  return found;
}

/**
 * The matcher behind the list, the link button and auto-link, so all three
 * agree on what counts as a mention. Linked targets take part in overlap
 * resolution too: a note already linked elsewhere still owns its full name, so
 * a shorter title cannot claim a piece of it.
 */
export function scanMentions(
  app: App,
  source: TFile,
  text: string,
  blocked: Range[],
  index: MentionIndex
): Mention[] {
  const linked = new Set(Object.keys(app.metadataCache.resolvedLinks[source.path] ?? {}));
  const lower = toLowerKeepingOffsets(text);
  const words = new Set(lower.match(WORD) ?? []);

  const hits: Hit[] = [];

  for (const [first, candidates] of index) {
    if (!words.has(first)) continue;

    for (const candidate of candidates) {
      if (candidate.file.path === source.path) continue;

      for (const start of findOccurrences(text, lower, candidate, blocked)) {
        hits.push({ start, end: start + candidate.lower.length, candidate });
      }
    }
  }

  // Longest span wins an overlap. Without this the alias "Lightroom" claims the
  // tail of "Adobe Lightroom" and linking it strands the first word.
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);

  const taken: Range[] = [];
  const found = new Map<string, Mention>();

  for (const hit of hits) {
    if (taken.some(([start, end]) => hit.start < end && hit.end > start)) continue;
    taken.push([hit.start, hit.end]);

    const span: Span = { start: hit.start, end: hit.end, name: hit.candidate.name };
    const entry = found.get(hit.candidate.file.path);

    if (entry) {
      entry.spans.push(span);
    } else {
      // First hit for this note is its longest name, given the sort above.
      found.set(hit.candidate.file.path, {
        file: hit.candidate.file,
        name: hit.candidate.name,
        names: [],
        count: 0,
        linked: linked.has(hit.candidate.file.path),
        spans: [span],
      });
    }
  }

  for (const mention of found.values()) {
    mention.spans.sort((a, b) => a.start - b.start);
    mention.count = mention.spans.length;
    mention.names = [...new Set(mention.spans.map((span) => span.name))];
  }

  return [...found.values()].sort(
    (a, b) =>
      b.count - a.count ||
      b.name.length - a.name.length ||
      a.file.basename.localeCompare(b.file.basename)
  );
}

/**
 * The spans a link action converts. "first" means first in the document,
 * whichever of the target's names matched there. Overlap resolution has
 * already made sure that span is the longest match at that spot, so an alias
 * cannot take a bite out of a longer title.
 */
export function spansToLink(mention: Mention, scope: MentionScope): Span[] {
  if (scope === "all") return mention.spans;
  return mention.spans.slice(0, 1);
}

/**
 * A link to `target` for the text at `span`. The alias comes from the document
 * rather than the note, so a lowercase "style" stays lowercase once linked.
 *
 * Inside a table the alias pipe would split the cell, so it is escaped the way
 * Obsidian expects there: `[[Style\|style]]`.
 */
export function linkForSpan(
  app: App,
  source: TFile,
  target: TFile,
  text: string,
  span: Span
): string {
  const shown = text.slice(span.start, span.end);
  const link = app.fileManager.generateMarkdownLink(
    target,
    source.path,
    undefined,
    shown === target.basename ? undefined : shown
  );
  return inTable(text, span.start) ? link.replace(/(?<!\\)\|/g, "\\|") : link;
}

/**
 * Whether `offset` sits on a row of a pipe table: its line has a pipe, and the
 * run of non-blank lines around it has a delimiter row like `| --- | :-: |`.
 */
export function inTable(text: string, offset: number): boolean {
  const lineStart = (at: number) => text.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = (at: number) => {
    const end = text.indexOf("\n", at);
    return end === -1 ? text.length : end;
  };
  const isRow = (line: string) => line.includes("|");
  const isDelimiter = (line: string) => isRow(line) && TABLE_DELIMITER.test(stripQuote(line));

  const start = lineStart(offset);
  if (!isRow(text.slice(start, lineEnd(start)))) return false;

  // Up from this line, then down from the next, while lines still look like rows.
  for (let at = start; ; at = lineStart(at - 1)) {
    const line = text.slice(at, lineEnd(at));
    if (!isRow(line)) break;
    if (isDelimiter(line)) return true;
    if (at === 0) break;
  }
  for (let at = lineEnd(start) + 1; at <= text.length; at = lineEnd(at) + 1) {
    const line = text.slice(at, lineEnd(at));
    if (!isRow(line)) break;
    if (isDelimiter(line)) return true;
  }
  return false;
}

/** A line without its blockquote or callout markers, since tables nest in those. */
function stripQuote(line: string): string {
  return line.replace(/^(?:[ \t]*>)+/, "");
}

const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

interface Hit {
  start: number;
  end: number;
  candidate: Candidate;
}

/**
 * Offsets of whole-word occurrences that fall outside every blocked range.
 * Case-insensitive, matching Obsidian's own unlinked mentions.
 */
function findOccurrences(
  text: string,
  lower: string,
  candidate: Candidate,
  blocked: Range[]
): number[] {
  const needle = candidate.lower;

  const hits: number[] = [];
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

export type Range = [number, number];

/**
 * Lowercase without moving any offset. `"\u0130".toLowerCase()` is two code
 * units, which would shift every offset after it and silently kill matching
 * for the rest of the note. A character that grows keeps only its leading
 * units, so "\u0130" lowers to a plain "i" and still matches one.
 */
function toLowerKeepingOffsets(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;

  let result = "";
  for (const char of text) {
    const low = char.toLowerCase();
    result += low.length === char.length ? low : low.length > char.length ? low.slice(0, char.length) : char;
  }
  return result;
}

/**
 * Block-level regions: fenced code of either marker, raw HTML blocks, and
 * indented code. These are what the metadata cache used to supply, found from
 * the text instead so they hold for unsaved text too.
 *
 * A fence can sit inside a callout, a blockquote or a list item, so it is
 * looked for after the container markers and indentation are stripped. That
 * errs towards blocking: a fence that only looks nested still hides its body.
 */
function blockRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const lines = text.split("\n");

  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const endOf = (index: number) => starts[index] + lines[index].length;

  let i = 0;
  while (i < lines.length) {
    // Checked before fences: a fence marker inside indented code is code, not
    // a fence. A list continuation is never indented code, so a fence under a
    // list item still reaches the fence check below.
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

    const fence = stripContainers(lines[i]).match(FENCE);
    if (fence) {
      const closing = new RegExp(`^${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !closing.test(stripContainers(lines[j]))) j += 1;
      ranges.push([starts[i], j < lines.length ? endOf(j) : text.length]);
      i = j + 1;
      continue;
    }

    // CommonMark ends an HTML block at a blank line.
    if (HTML_BLOCK.test(lines[i])) {
      let j = i;
      while (j < lines.length && lines[j].trim() !== "") j += 1;
      ranges.push([starts[i], endOf(j - 1)]);
      i = j;
      continue;
    }

    i += 1;
  }

  return ranges;
}

/**
 * A line with its blockquote and callout markers, list markers and
 * indentation removed, which is where a nested fence starts.
 */
function stripContainers(line: string): string {
  return line.replace(CONTAINERS, "");
}

/**
 * An indented line is code only when it is not a list continuation. Nested
 * bullets are indented too, and treating those as code would quietly stop
 * matching inside every outline.
 */
function startsIndentedCode(lines: string[], index: number): boolean {
  if (index > 0 && lines[index - 1].trim() !== "") return false;

  for (let j = index - 2; j >= 0; j -= 1) {
    if (lines[j].trim() === "") continue;
    return !LIST_ITEM.test(lines[j]) && !INDENTED.test(lines[j]);
  }

  return true;
}

/** Inline constructs where a mention is not a mention. */
const BLOCKED_PATTERNS = [
  /`[^`\n]*`/g, // inline code
  /\$\$[\s\S]*?(?:\$\$|$)/g, // display math
  // Inline math: `$` hugging non-space on both sides, and no digit after the
  // closing one, so "$5 and $10" stays prose.
  /(?<![\\$])\$(?!\$)[^\s$](?:[^$\n]*[^\s$\\])?\$(?!\d)/g,
  /%%[\s\S]*?(?:%%|$)/g, // comments
  /<!--[\s\S]*?(?:-->|$)/g, // html comments
  /<\/?[a-zA-Z][^>\n]*>/g, // html tags, so a name inside an attribute is safe
  /https?:\/\/[^\s)<>]+/g, // bare URLs
  /\[[^\]\n]*\]\([^)\n]*\)/g, // markdown links, both halves
  /\[\[[^\]\n]*\]\]/g, // wikilinks, including unresolved ones
  /\[[^\]\n]*\]\[[^\]\n]*\]/g, // reference links, both halves
  /\[\^[^\]\n]*\]/g, // footnote references
  /^ {0,3}\[(?!\^)[^\]\n]+\]:.*$/gm, // link reference definitions
  /#[\p{L}\p{N}/_-]+/gu, // tags
];

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/;
const FENCE = /^(`{3,}|~{3,})/;
const CONTAINERS = /^(?:[ \t]*(?:>|[-*+][ \t]|\d+[.)][ \t]))*[ \t]*/;
const HTML_BLOCK = /^ {0,3}<[a-zA-Z!/]/;
const INDENTED = /^(?: {4}|\t)/;
const LIST_ITEM = /^ *(?:[-*+]|\d+[.)])\s/;

/**
 * Sorted, merged offset ranges the matcher must stay out of.
 *
 * Everything is derived from the text passed in, never from the metadata
 * cache. The list scans the file as saved, but the link button and auto-link
 * work on text the cache has not parsed yet, and cache offsets against fresher
 * text are wrong offsets. One source means the three genuinely agree, which is
 * what stops the button linking something the list refused to show.
 */
export function blockedRanges(text: string): Range[] {
  const ranges: Range[] = blockRanges(text);

  const frontmatter = text.match(FRONTMATTER);
  if (frontmatter) ranges.push([0, frontmatter[0].length]);

  for (const pattern of BLOCKED_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);

  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  return merged;
}

function isBlocked(ranges: Range[], start: number, end: number): boolean {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const [rangeStart, rangeEnd] = ranges[mid];
    if (end <= rangeStart) high = mid - 1;
    else if (start >= rangeEnd) low = mid + 1;
    else return true;
  }

  return false;
}

export interface LinkResult {
  /** Occurrences turned into links. */
  links: number;
  /** Notes those links point at. */
  notes: number;
}

/**
 * Link mentions in `source`, in one step. Occurrences are re-derived from the
 * note's current text with the same matcher the list uses, rather than
 * trusting offsets captured at render time, so an edit between render and
 * click cannot corrupt the note.
 *
 * When the note is open in any pane the edit goes through that editor: it lands
 * in one undo step, and keystrokes the editor has not saved yet cannot be clobbered by a
 * disk-level write that never saw them.
 */
export async function linkMentions(
  app: App,
  source: TFile,
  index: MentionIndex,
  scope: MentionScope,
  select: (mention: Mention) => boolean
): Promise<LinkResult> {
  const groupsIn = (text: string): Group[] => {
    // resolvedLinks lags the text until the note is saved and parsed, so in
    // "first" scope a target linked moments ago, by a double click say, is
    // checked against the text itself.
    const linkedInText = scope === "first" ? linkTargetsIn(app, source, text) : null;
    return scanMentions(app, source, text, blockedRanges(text), index)
      .filter(select)
      .filter((mention) => !linkedInText?.has(mention.file.path))
      .map((mention) => ({ target: mention.file, spans: spansToLink(mention, scope) }))
      .filter((group) => group.spans.length > 0);
  };

  const open = openEditor(app, source);

  if (open) {
    const { editor } = open;
    const text = editor.getValue();
    const groups = groupsIn(text);
    if (groups.length === 0) return { links: 0, notes: 0 };

    const changes = groups.flatMap((group) =>
      group.spans.map((span) => ({
        from: editor.offsetToPos(span.start),
        to: editor.offsetToPos(span.end),
        text: linkForSpan(app, source, group.target, text, span),
      }))
    );

    editor.transaction({ changes });
    // The list is built from the saved note and its parsed links, which would
    // otherwise wait out the editor's autosave delay before the row turns solid.
    await open.save?.();
    return { links: changes.length, notes: groups.length };
  }

  // Nothing to link means nothing to write: `process` saves unconditionally,
  // and a pointless save costs an mtime bump and a re-index.
  if (groupsIn(await app.vault.cachedRead(source)).length === 0) return { links: 0, notes: 0 };

  let result: LinkResult = { links: 0, notes: 0 };

  await app.vault.process(source, (data) => {
    const groups = groupsIn(data);
    result = {
      links: groups.reduce((total, group) => total + group.spans.length, 0),
      notes: groups.length,
    };

    // Back to front, so earlier offsets stay valid as the text grows.
    const edits = groups.flatMap((group) =>
      group.spans.map((span) => ({ span, link: linkForSpan(app, source, group.target, data, span) }))
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

interface Group {
  target: TFile;
  spans: Span[];
}

/** Paths of the notes `text` links to, wikilinks and markdown links alike. */
function linkTargetsIn(app: App, source: TFile, text: string): Set<string> {
  const targets = new Set<string>();
  for (const match of text.matchAll(LINK_TARGET)) {
    const raw = match[1] ?? match[2];
    let linkpath = raw.split(/[#|^]/)[0].trim();
    if (match[2] !== undefined) {
      try {
        linkpath = decodeURIComponent(linkpath);
      } catch {
        // Keep the raw path when it is not valid percent-encoding.
      }
    }
    if (!linkpath) continue;
    const target = app.metadataCache.getFirstLinkpathDest(linkpath, source.path);
    if (target) targets.add(target.path);
  }
  return targets;
}

const LINK_TARGET = /\[\[([^\]\n]+)\]\]|\]\(<?([^)>\s]+)>?\)/g;

interface OpenEditor {
  editor: Editor;
  /** Writes the editor's text to disk now, when the view can. */
  save?: () => Promise<void>;
}

/**
 * An editor showing `file`, wherever it is open: the active one first, then
 * any other pane, split or popout. A disk write while any of them holds unsaved
 * text would be overwritten by that editor's next save, or overwrite it.
 */
function openEditor(app: App, file: TFile): OpenEditor | null {
  const active = app.workspace.activeEditor;
  if (active?.file?.path === file.path && active.editor) {
    return { editor: active.editor, save: saverFor(active) };
  }

  const views: MarkdownView[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
      views.push(leaf.view);
    }
  });
  const view = views[0];
  return view?.editor ? { editor: view.editor, save: saverFor(view) } : null;
}

function saverFor(view: unknown): (() => Promise<void>) | undefined {
  if (!(view instanceof MarkdownView) || typeof view.save !== "function") return undefined;
  return () => view.save();
}

/** One target's mentions, from the row's link button. Returns how many linked. */
export async function linkMention(
  app: App,
  source: TFile,
  target: TFile,
  index: MentionIndex,
  scope: MentionScope
): Promise<number> {
  const result = await linkMentions(
    app,
    source,
    index,
    scope,
    (mention) => mention.file.path === target.path
  );
  return result.links;
}
