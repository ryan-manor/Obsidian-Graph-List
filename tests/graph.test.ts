import assert from "node:assert/strict";
import test from "node:test";
import { TFile, type App } from "obsidian";
import {
  buildGroups,
  collectNeighbors,
  getPropertyValue,
  sortFiles,
  unwrapLink,
} from "../src/graph";
import { DEFAULT_SETTINGS, type LocalGraphListSettings } from "../src/settings";

/**
 * These cover which notes the list shows and the order it shows them in. The
 * app is faked down to the three things graph.ts reads: resolvedLinks, the
 * file lookup, and each file's frontmatter.
 */

interface Fixture {
  path: string;
  ctime?: number;
  frontmatter?: Record<string, unknown>;
}

function file({ path, ctime = 0 }: Fixture): TFile {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return Object.assign(new TFile(), {
    path,
    basename: name.slice(0, dot),
    extension: name.slice(dot + 1),
    parent: { path: folder },
    stat: { ctime, mtime: ctime + 1, size: 100 },
  });
}

function fakeApp(
  fixtures: Fixture[],
  resolvedLinks: Record<string, Record<string, number>>
): { app: App; files: Record<string, TFile> } {
  const files: Record<string, TFile> = {};
  const frontmatter: Record<string, Record<string, unknown> | undefined> = {};
  for (const fixture of fixtures) {
    files[fixture.path] = file(fixture);
    frontmatter[fixture.path] = fixture.frontmatter;
  }
  const app = {
    metadataCache: {
      resolvedLinks,
      getFileCache: (f: TFile) => ({ frontmatter: frontmatter[f.path] }),
    },
    vault: { getAbstractFileByPath: (path: string) => files[path] ?? null },
  } as unknown as App;
  return { app, files };
}

const settings = (overrides: Partial<LocalGraphListSettings> = {}) => ({
  ...DEFAULT_SETTINGS,
  ...overrides,
});

const names = (files: TFile[]) => files.map((f) => f.basename);

const VAULT = fakeApp(
  [
    { path: "Active.md" },
    { path: "Out.md" },
    { path: "In.md" },
    { path: "Both.md" },
    { path: "Board.canvas" },
    { path: "img/Photo.png" },
  ],
  {
    "Active.md": {
      "Active.md": 1,
      "Out.md": 1,
      "Both.md": 1,
      "Board.canvas": 1,
      "img/Photo.png": 1,
      "Deleted.md": 1,
    },
    "In.md": { "Active.md": 1 },
    "Both.md": { "Active.md": 1 },
  }
);

test("neighbours split into out and in, with self-links dropped", () => {
  const { app, files } = VAULT;
  const { out, in: inbound } = collectNeighbors(app, files["Active.md"], settings());

  assert.deepEqual(names(out), ["Out", "Both", "Board"]);
  assert.deepEqual(names(inbound), ["In", "Both"]);
});

test("attachments are left out", () => {
  const { app, files } = VAULT;
  const without = collectNeighbors(app, files["Active.md"], settings());
  assert.ok(!names(without.out).includes("Photo"));
  // Canvases and bases are notes, not attachments.
  assert.ok(names(without.out).includes("Board"));
});

test("a resolved path with no file behind it is skipped", () => {
  const { app, files } = VAULT;
  const { out } = collectNeighbors(app, files["Active.md"], settings());
  assert.ok(!names(out).includes("Deleted"));
});

test("separate directions gives two groups; merged gives one, deduplicated", () => {
  const { app, files } = VAULT;
  const active = files["Active.md"];

  const split = buildGroups(app, active, settings({ sortKey: "title", sortDirection: "asc" }), new Map());
  assert.deepEqual(split.map((g) => g.label), ["Links to", "Linked from"]);

  const merged = buildGroups(
    app,
    active,
    settings({ separateDirections: false, sortKey: "title", sortDirection: "asc" }),
    new Map()
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "Linked notes");
  assert.deepEqual(names(merged[0].files), ["Board", "Both", "In", "Out"]);
});

test("unlinked notes sort in with the linked ones, each in its own direction", () => {
  const { app, files } = VAULT;
  const active = files["Active.md"];
  const unlinked = {
    out: [file({ path: "Named.md" }), files["Out.md"]],
    in: [file({ path: "Mentioner.md" })],
  };

  const [merged] = buildGroups(
    app,
    active,
    settings({ separateDirections: false, sortKey: "title", sortDirection: "asc" }),
    new Map(),
    unlinked
  );
  assert.deepEqual(names(merged.files), ["Board", "Both", "In", "Mentioner", "Named", "Out"]);

  const [linksTo, linkedFrom] = buildGroups(
    app,
    active,
    settings({ separateDirections: true, sortKey: "title", sortDirection: "asc" }),
    new Map(),
    unlinked
  );
  assert.equal(linksTo.direction, "out");
  assert.deepEqual(names(linksTo.files), ["Board", "Both", "Named", "Out"]);
  assert.deepEqual(names(linkedFrom.files), ["Both", "In", "Mentioner"]);
});

test("proximity sorts strongest first, and unscored notes sort last", () => {
  const { app, files } = VAULT;
  const list = [files["Out.md"], files["In.md"], files["Both.md"]];
  const proximity = new Map([["In.md", 0.4], ["Both.md", 1]]);

  assert.deepEqual(names(sortFiles(app, list, settings(), proximity)), ["Both", "In", "Out"]);
});

test("missing values sort last in either direction, alphabetically among themselves", () => {
  const { app, files } = fakeApp(
    [
      { path: "Zed.md" },
      { path: "Alpha.md" },
      { path: "High.md", frontmatter: { rank: 9 } },
      { path: "Low.md", frontmatter: { rank: 1 } },
    ],
    {}
  );
  const list = Object.values(files);

  for (const sortDirection of ["asc", "desc"] as const) {
    const sorted = names(sortFiles(app, list, settings({ sortKey: "property", sortProperty: "rank", sortDirection })));
    assert.deepEqual(sorted.slice(2), ["Alpha", "Zed"], sortDirection);
  }
  assert.deepEqual(
    names(sortFiles(app, list, settings({ sortKey: "property", sortProperty: "rank", sortDirection: "asc" }))).slice(0, 2),
    ["Low", "High"]
  );
});

test("date properties sort as dates, including wikilinked daily notes", () => {
  const { app, files } = fakeApp(
    [
      { path: "A.md", frontmatter: { created: "[[2026-09-16|today]]" } },
      { path: "B.md", frontmatter: { created: "2026-01-02" } },
      { path: "C.md", frontmatter: { created: "2025-12-31T09:00" } },
    ],
    {}
  );
  const sorted = sortFiles(app, Object.values(files), settings({ sortKey: "property", sortProperty: "created" }));
  assert.deepEqual(names(sorted), ["A", "B", "C"]);
});

test("list properties sort by their first value", () => {
  const { app, files } = fakeApp(
    [
      { path: "A.md", frontmatter: { area: ["zoology", "art"] } },
      { path: "B.md", frontmatter: { area: ["botany"] } },
      { path: "C.md", frontmatter: { area: [] } },
    ],
    {}
  );
  const sorted = sortFiles(
    app,
    Object.values(files),
    settings({ sortKey: "property", sortProperty: "area", sortDirection: "asc" })
  );
  assert.deepEqual(names(sorted), ["B", "A", "C"]);
});

test("title sort ignores case", () => {
  const { app, files } = fakeApp([{ path: "beta.md" }, { path: "Alpha.md" }, { path: "Gamma.md" }], {});
  const sorted = sortFiles(app, Object.values(files), settings({ sortKey: "title", sortDirection: "asc" }));
  assert.deepEqual(names(sorted), ["Alpha", "beta", "Gamma"]);
});

test("created and modified sort by file timestamps", () => {
  const { app, files } = fakeApp(
    [{ path: "Old.md", ctime: 1 }, { path: "New.md", ctime: 3 }, { path: "Mid.md", ctime: 2 }],
    {}
  );
  const list = Object.values(files);
  assert.deepEqual(names(sortFiles(app, list, settings({ sortKey: "created" }))), ["New", "Mid", "Old"]);
  assert.deepEqual(
    names(sortFiles(app, list, settings({ sortKey: "modified", sortDirection: "asc" }))),
    ["Old", "Mid", "New"]
  );
});

test("file pseudo-properties read the file, others read frontmatter", () => {
  const { app, files } = fakeApp(
    [{ path: "Notes/Deep/Page.md", ctime: 5, frontmatter: { status: "draft", tags: ["a"] } }],
    {}
  );
  const page = files["Notes/Deep/Page.md"];

  assert.equal(getPropertyValue(app, page, "file.name"), "Page");
  assert.equal(getPropertyValue(app, page, "file.path"), "Notes/Deep/Page.md");
  assert.equal(getPropertyValue(app, page, "file.folder"), "Notes/Deep");
  assert.equal(getPropertyValue(app, page, "file.ext"), "md");
  assert.deepEqual(getPropertyValue(app, page, "file.ctime"), new Date(5));
  assert.equal(getPropertyValue(app, page, "file.size"), 100);
  assert.deepEqual(getPropertyValue(app, page, "file.tags"), ["#a"]);
  assert.equal(getPropertyValue(app, page, "status"), "draft");
  assert.equal(getPropertyValue(app, page, "missing"), undefined);
});

test("unwrapLink strips brackets, embeds and aliases", () => {
  assert.equal(unwrapLink("[[2026-09-16|today]]"), "2026-09-16");
  assert.equal(unwrapLink("![[Diagram]]"), "Diagram");
  assert.equal(unwrapLink("[[Note]]"), "Note");
  assert.equal(unwrapLink("plain text"), "plain text");
});
