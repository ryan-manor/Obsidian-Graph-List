import { App, TFile, getAllTags } from "obsidian";
import type { LocalGraphListSettings } from "./settings";

export type Direction = "out" | "in";

export interface LinkGroup {
  label: string;
  files: TFile[];
  /** The one direction this group holds, or undefined when merged. */
  direction?: Direction;
}

/** Canvases and bases count as notes; images, PDFs and other attachments do not. */
export const NOTE_EXTENSIONS = new Set(["md", "canvas", "base"]);

/**
 * Resolved outbound and inbound links for a file. Self-links are dropped, and
 * a note that is both linked-to and linked-from appears in each group.
 */
export function collectNeighbors(
  app: App,
  file: TFile,
  settings: LocalGraphListSettings
): Record<Direction, TFile[]> {
  const resolved = app.metadataCache.resolvedLinks;

  const outPaths = Object.keys(resolved[file.path] ?? {});
  const inPaths: string[] = [];
  for (const source of Object.keys(resolved)) {
    if (source === file.path) continue;
    if (resolved[source][file.path]) inPaths.push(source);
  }

  const toFiles = (paths: string[]) => {
    const files: TFile[] = [];
    for (const path of paths) {
      if (path === file.path) continue;
      const target = app.vault.getAbstractFileByPath(path);
      if (!(target instanceof TFile)) continue;
      if (!NOTE_EXTENSIONS.has(target.extension)) continue;
      files.push(target);
    }
    return files;
  };

  return { out: toFiles(outPaths), in: toFiles(inPaths) };
}

/**
 * Groups to render, honouring the separate-directions setting. `unlinked`
 * holds notes named but not linked in each direction; they sort in with the
 * linked ones as if the link were there.
 */
export function buildGroups(
  app: App,
  file: TFile,
  settings: LocalGraphListSettings,
  proximity: Map<string, number>,
  unlinked: Record<Direction, TFile[]> = { out: [], in: [] }
): LinkGroup[] {
  const linked = collectNeighbors(app, file, settings);
  const out = dedupe([...linked.out, ...unlinked.out]);
  const inbound = dedupe([...linked.in, ...unlinked.in]);

  if (!settings.separateDirections) {
    const merged = dedupe([...out, ...inbound]);
    return [
      { label: "Linked notes", files: sortFiles(app, merged, settings, proximity) },
    ];
  }

  return [
    { label: "Links to", files: sortFiles(app, out, settings, proximity), direction: "out" },
    { label: "Linked from", files: sortFiles(app, inbound, settings, proximity), direction: "in" },
  ];
}

function dedupe(files: TFile[]): TFile[] {
  const seen = new Set<string>();
  return files.filter((file) => !seen.has(file.path) && Boolean(seen.add(file.path)));
}

/**
 * Value of a property for a file. Handles `file.*` pseudo-properties, which
 * read the file itself rather than frontmatter.
 */
export function getPropertyValue(app: App, file: TFile, key: string): unknown {
  switch (key) {
    case "file.name":
      return file.basename;
    case "file.path":
      return file.path;
    case "file.folder":
      return file.parent?.path ?? "";
    case "file.ext":
      return file.extension;
    case "file.ctime":
      return new Date(file.stat.ctime);
    case "file.mtime":
      return new Date(file.stat.mtime);
    case "file.size":
      return file.stat.size;
    case "file.tags":
      return getAllTags(app.metadataCache.getFileCache(file) ?? {}) ?? [];
  }

  return app.metadataCache.getFileCache(file)?.frontmatter?.[key];
}

/** Strip wikilink brackets and any alias, e.g. `[[2026-09-16|today]]` -> `2026-09-16`. */
export function unwrapLink(value: string): string {
  const match = value.match(/^!?\[\[([^\]]+)\]\]$/);
  const inner = match ? match[1] : value;
  return inner.split("|")[0].trim();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/;

/** Reduce a property value to something orderable: a number or a lowercase string. */
function toComparable(value: unknown): number | string | null {
  if (value === null || value === undefined || value === "") return null;
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

function sortValue(
  app: App,
  file: TFile,
  settings: LocalGraphListSettings,
  proximity: Map<string, number>
): number | string | null {
  switch (settings.sortKey) {
    case "proximity":
      return proximity.get(file.path) ?? null;
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

/** Sort by the configured key. Files missing the value always sort last. */
export function sortFiles(
  app: App,
  files: TFile[],
  settings: LocalGraphListSettings,
  proximity: Map<string, number> = new Map()
): TFile[] {
  const sign = settings.sortDirection === "asc" ? 1 : -1;

  const keyed = files.map((file) => ({
    file,
    value: sortValue(app, file, settings, proximity),
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
