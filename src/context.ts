// Link context: the line a link (or an unlinked mention) sits on, cleaned up
// for a one-glance preview under the row's title.
//
// The text work is pure, so it is tested without Obsidian; `findLinkRange`
// is the only part that reads the metadata cache.

import { App, TFile, getLinkpath } from "obsidian";

/** The line around a link, split so the link itself can be highlighted. */
export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** Where a link sits: a text range, or a frontmatter property with no range. */
export type LinkRange =
  | { start: number; end: number }
  | { key: string; display: string };

/**
 * Characters kept before and after the link. Less before, so the link stays
 * inside the two lines the row shows.
 */
const BEFORE = 50;
const AFTER = 90;

/** List bullets, task boxes, numbering, heading hashes, quote markers, a table's first pipe. */
const LINE_PREFIX = /^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?|#{1,6}\s+|>\s?|\|\s*)*/;

/** A table row's last pipe. */
const LINE_SUFFIX = /\s*\|\s*$/;

/** Wikilinks and markdown links read as their display text. */
function plain(text: string): string {
  return text
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) =>
      alias?.trim() || target.split("#")[0].trim() || target
    )
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|==|~~)/g, "")
    // Table cells stay apart; the outer pipes are dropped by the caller.
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s+/g, " ");
}

/** Keep the last `max` characters, cut at a word and marked with an ellipsis. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const space = cut.indexOf(" ");
  return "…" + (space >= 0 && space < 20 ? cut.slice(space + 1) : cut);
}

function head(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max - 20 ? cut.slice(0, space) : cut) + "…";
}

/** The line holding `text[start, end)`, cleaned and cut to the link's surroundings. */
export function snippetAt(
  text: string,
  start: number,
  end: number,
  before = BEFORE,
  after = AFTER
): Snippet {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline < 0 ? text.length : newline;

  return {
    before: tail(plain(text.slice(lineStart, start).replace(LINE_PREFIX, "")).trimStart(), before),
    match: plain(text.slice(start, end)).trim(),
    after: head(plain(text.slice(end, lineEnd).replace(LINE_SUFFIX, "")).trimEnd(), after),
  };
}

/** A frontmatter link has no line worth quoting, so it reads as `key: value`. */
export function snippetFor(text: string, range: LinkRange): Snippet {
  if ("key" in range) return { before: `${range.key}: `, match: range.display, after: "" };
  return snippetAt(text, range.start, range.end);
}

/**
 * The first link in `from` that resolves to `to`, body links before
 * frontmatter. Null when the cache has none, such as for a canvas.
 */
export function findLinkRange(app: App, from: TFile, to: TFile): LinkRange | null {
  const cache = app.metadataCache.getFileCache(from);
  if (!cache) return null;

  const resolves = (link: string) =>
    app.metadataCache.getFirstLinkpathDest(getLinkpath(link), from.path)?.path === to.path;

  let first: { start: number; end: number } | null = null;
  for (const ref of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
    const { start, end } = ref.position;
    if (first && start.offset >= first.start) continue;
    if (resolves(ref.link)) first = { start: start.offset, end: end.offset };
  }
  if (first) return first;

  for (const ref of cache.frontmatterLinks ?? []) {
    if (resolves(ref.link)) return { key: ref.key, display: ref.displayText || ref.link };
  }
  return null;
}
