import { App, CachedMetadata, TFile } from "obsidian";

/**
 * Outbound unlinked mentions: text in this note that names another note but
 * isn't a link yet.
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

  const suggestions =
    (app.metadataCache as unknown as {
      getLinkSuggestions?: () => LinkSuggestion[];
    }).getLinkSuggestions?.() ?? [];

  for (const suggestion of suggestions) {
    const file = suggestion.file;
    if (!file || file.extension !== "md") continue;
    if (ignored(file.path)) continue;

    const name = suggestion.alias ?? file.basename;
    if (name.length < (suggestion.alias ? MIN_ALIAS_LENGTH : MIN_TITLE_LENGTH)) continue;

    const key = `${file.path}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const lower = name.toLowerCase();
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
 * A test against Obsidian's "Excluded files" setting, which is what its own
 * link suggester and unlinked mentions honour. `isUserIgnored` lives on the
 * metadata cache at runtime but is not in obsidian.d.ts, so fall back to the
 * raw filter list: each entry is a path fragment, or a regex when slash-wrapped.
 */
function makeIgnoreTest(app: App): (path: string) => boolean {
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
  const cache = app.metadataCache.getFileCache(file);
  return scanMentions(app, file, text, blockedRanges(text, cache), index);
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
  const lower = text.toLowerCase();
  const words = new Set(lower.match(WORD) ?? []);

  const hits: Hit[] = [];

  for (const [first, candidates] of index) {
    if (!words.has(first)) continue;

    for (const candidate of candidates) {
      if (candidate.file.path === source.path) continue;

      for (const start of findOccurrences(text, lower, candidate, blocked)) {
        hits.push({ start, end: start + candidate.name.length, candidate });
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
 */
export function linkForSpan(
  app: App,
  source: TFile,
  target: TFile,
  text: string,
  span: Span
): string {
  const shown = text.slice(span.start, span.end);
  return app.fileManager.generateMarkdownLink(
    target,
    source.path,
    undefined,
    shown === target.basename ? undefined : shown
  );
}

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

/** Text where a mention is not a mention, and where linking would break formatting. */
const BLOCKED_PATTERNS = [
  /```[\s\S]*?(?:```|$)/g, // fenced code
  /`[^`\n]*`/g, // inline code
  /\$\$[\s\S]*?(?:\$\$|$)/g, // display math
  /%%[\s\S]*?(?:%%|$)/g, // comments
  /<!--[\s\S]*?(?:-->|$)/g, // html comments
  /<\/?[a-zA-Z][^>\n]*>/g, // html tags, so a name inside an attribute is safe
  /https?:\/\/[^\s)<>]+/g, // bare URLs
  /\[[^\]\n]*\]\([^)\n]*\)/g, // markdown links, both halves
  /\[\[[^\]\n]*\]\]/g, // wikilinks, including unresolved ones
  /#[\p{L}\p{N}/_-]+/gu, // tags
];

/** Section types that are never prose. Callouts and lists are, so they match. */
const BLOCKED_SECTIONS = new Set(["yaml", "code", "math", "html", "comment"]);

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/;

/**
 * Sorted, merged offset ranges the matcher must stay out of. The metadata
 * cache supplies frontmatter, code blocks and existing links; the patterns
 * cover the inline constructs it does not track as sections.
 */
export function blockedRanges(text: string, cache: CachedMetadata | null): Range[] {
  const ranges: Range[] = [];

  for (const section of cache?.sections ?? []) {
    if (BLOCKED_SECTIONS.has(section.type)) {
      ranges.push([section.position.start.offset, section.position.end.offset]);
    }
  }

  for (const ref of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
    ranges.push([ref.position.start.offset, ref.position.end.offset]);
  }

  // Offsets are also derived from the text itself, so this stays correct when
  // called against fresh file contents rather than the cached parse.
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

/**
 * Link a target's mentions: the first one, or all of them. Occurrences are
 * re-derived from the file's current contents with the same matcher the list
 * uses, rather than trusting offsets captured at render time, so an edit
 * between render and click cannot corrupt the note. Returns how many were
 * linked.
 */
export async function linkMention(
  app: App,
  source: TFile,
  target: TFile,
  index: MentionIndex,
  scope: MentionScope
): Promise<number> {
  let linked = 0;

  await app.vault.process(source, (data) => {
    const mention = scanMentions(app, source, data, blockedRanges(data, null), index).find(
      (entry) => entry.file.path === target.path
    );
    if (!mention) return data;

    const spans = spansToLink(mention, scope);
    linked = spans.length;

    // Back to front, so earlier offsets stay valid as the text grows.
    let result = data;
    for (const span of [...spans].reverse()) {
      const link = linkForSpan(app, source, target, data, span);
      result = result.slice(0, span.start) + link + result.slice(span.end);
    }
    return result;
  });

  return linked;
}
