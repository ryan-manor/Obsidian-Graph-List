import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, type App, type TFile } from "obsidian";
import {
  blockedRanges,
  buildMentionIndex,
  inTable,
  linkForSpan,
  linkMentions,
  scanMentions,
  spansToLink,
  type Mention,
} from "../src/mentions";

/**
 * These cover the matcher, which decides where the plugin writes links into
 * prose. A false positive here edits a note in a place the user did not mean,
 * so the blocked-range cases are the ones worth keeping honest.
 */

const LIGHTROOM = file("Notes/Adobe Lightroom.md");
const CLASSIC = file("Notes/Lightroom Classic.md");
const PHOTOSHOP = file("Notes/Photoshop.md");
const SHORT = file("Notes/Pc.md");
const ADOBE = file("Notes/Adobe.md");
const SOURCE = file("Notes/Source.md");
const STYLE = file("Notes/Style.md");
const IZMIR = file("Notes/\u0130zmir.md");

function file(path: string): TFile {
  const basename = path.slice(path.lastIndexOf("/") + 1, -3);
  return { path, basename, extension: "md" } as unknown as TFile;
}

/** Every title, plus the aliases each note carries. */
const SUGGESTIONS = [
  { file: LIGHTROOM },
  { file: LIGHTROOM, alias: "Lightroom" },
  { file: LIGHTROOM, alias: "Lr" },
  { file: CLASSIC },
  { file: PHOTOSHOP },
  { file: PHOTOSHOP, alias: "ps" },
  { file: SHORT },
  { file: ADOBE },
  { file: STYLE },
  { file: IZMIR },
];

function app(
  resolvedLinks: Record<string, Record<string, number>> = {},
  extra: Record<string, unknown> = {}
): App {
  return {
    metadataCache: {
      getLinkSuggestions: () => SUGGESTIONS,
      isUserIgnored: () => false,
      resolvedLinks,
      getFirstLinkpathDest: (linkpath: string) =>
        SUGGESTIONS.find((entry) => entry.file.basename === linkpath)?.file ?? null,
    },
    vault: { getConfig: () => [] },
    fileManager: {
      // Wikilink with an alias, the way Obsidian writes one by default.
      generateMarkdownLink: (target: TFile, _source: string, _sub?: string, alias?: string) =>
        alias ? `[[${target.basename}|${alias}]]` : `[[${target.basename}]]`,
    },
    ...extra,
  } as unknown as App;
}

function scan(text: string, resolvedLinks?: Record<string, Record<string, number>>): Mention[] {
  const instance = app(resolvedLinks);
  return scanMentions(instance, SOURCE, text, blockedRanges(text), buildMentionIndex(instance));
}

function found(text: string, basename = "Adobe Lightroom"): Mention | undefined {
  return scan(text).find((mention) => mention.file.basename === basename);
}

function matched(text: string): string[] {
  return (found(text)?.spans ?? []).map((span) => text.slice(span.start, span.end));
}

test("matches a plain mention, and counts one row per target", () => {
  const mention = found("Lightroom here, and Lightroom again, and Lr too.");
  assert.equal(mention?.count, 3);
  // The longest name that actually matched, not the note's title.
  assert.equal(mention?.name, "Lightroom");
  assert.deepEqual(mention?.names, ["Lightroom", "Lr"]);
});

test("matches case-insensitively, like Obsidian's own pane", () => {
  assert.deepEqual(matched("lightroom and LIGHTROOM and lr"), ["lightroom", "LIGHTROOM", "lr"]);
});

test("needs whole words", () => {
  // A hyphen joins words, so "Bases-style" is not a mention of a Style note.
  assert.equal(found("Lightroomish and Lightrooms and pre-Lightroom and Lightroom-shaped"), undefined);
});

test("skips frontmatter", () => {
  assert.equal(found("---\naliases:\n  - Lightroom\n---\n\nnothing here"), undefined);
});

test("skips inline code and both fence markers", () => {
  assert.equal(found("`Lightroom`"), undefined);
  assert.equal(found("```\nLightroom\n```"), undefined);
  assert.equal(found("~~~\nLightroom\n~~~"), undefined);
  assert.equal(found("````\n```\nLightroom\n```\n````"), undefined);
  assert.deepEqual(matched("```\nLightroom\n```\n\nThen Lightroom."), ["Lightroom"]);
});

test("skips an unterminated fence to the end of the note", () => {
  assert.equal(found("```\nLightroom\n\nstill code, Lightroom"), undefined);
});

test("skips indented code but not indented list items", () => {
  assert.equal(found("Paragraph:\n\n    x = Lightroom\n"), undefined);
  assert.deepEqual(matched("- item\n\t- Lightroom nested\n"), ["Lightroom"]);
  assert.deepEqual(matched("1. item\n\n    Lightroom continues the item\n"), ["Lightroom"]);
});

test("skips html blocks, tags and comments", () => {
  assert.equal(found('<div class="x">\nLightroom inside\n</div>'), undefined);
  assert.equal(found('<img alt="Lightroom">'), undefined);
  assert.equal(found("<!-- Lightroom -->"), undefined);
  assert.deepEqual(matched("<div>\nLightroom\n</div>\n\nThen Lightroom."), ["Lightroom"]);
});

test("skips math and Obsidian comments", () => {
  assert.equal(found("$$\na = Lightroom\n$$"), undefined);
  assert.equal(found("%% Lightroom %%"), undefined);
});

test("skips URLs, link destinations and existing links", () => {
  assert.equal(found("https://example.com/Lightroom-guide"), undefined);
  assert.equal(found("[the guide](https://example.com/Lightroom)"), undefined);
  assert.equal(found("[Lightroom](https://example.com/x)"), undefined);
  assert.equal(found("[[Adobe Lightroom]]"), undefined);
  assert.equal(found("[[Adobe Lightroom|Lightroom]]"), undefined);
  assert.equal(found("#Lightroom"), undefined);
});

test("longest match wins an overlap, so no name is left stranded", () => {
  assert.deepEqual(matched("Adobe Lightroom ships today"), ["Adobe Lightroom"]);

  const classic = found("Lightroom Classic ships today", "Lightroom Classic");
  assert.equal(classic?.count, 1);
  assert.equal(found("Lightroom Classic ships today"), undefined);
});

test("a linked target still owns its full name", () => {
  // Adobe Lightroom is linked already, so it is not offered here, but it must
  // still win the overlap: otherwise the shorter "Adobe" note claims the front
  // of its name and linking that strands "Lightroom".
  const text = "Adobe Lightroom ships today";
  const linked = { "Notes/Source.md": { "Notes/Adobe Lightroom.md": 1 } };

  assert.equal(
    scan(text, linked).find((mention) => mention.file.basename === "Adobe"),
    undefined
  );
  // Unlinked, the same overlap resolves the same way.
  assert.equal(
    scan(text).find((mention) => mention.file.basename === "Adobe"),
    undefined
  );
});

test("overlap is resolved span by span, so a leftover word can still match", () => {
  // "Adobe Lightroom Classic" reads as the Classic product, so that name takes
  // the overlap. "Adobe" is then a separate, non-overlapping span and gets its
  // own row rather than being swallowed: two suggestions, both the user's call.
  const mentions = scan("Adobe Lightroom Classic ships today");
  assert.deepEqual(
    mentions.map((mention) => mention.file.basename),
    ["Lightroom Classic", "Adobe"]
  );
});

test("flags targets the note already links", () => {
  const mention = scan("Lightroom twice: Lightroom", {
    "Notes/Source.md": { "Notes/Adobe Lightroom.md": 1 },
  }).find((entry) => entry.file.basename === "Adobe Lightroom");
  assert.equal(mention?.linked, true);
  assert.equal(mention?.count, 2);
});

test("never mentions itself", () => {
  const mentions = scan("Source is this note", {});
  assert.equal(
    mentions.find((mention) => mention.file.path === SOURCE.path),
    undefined
  );
});

test("indexes two-character aliases but not two-character titles", () => {
  assert.deepEqual(matched("lr today"), ["lr"]);
  assert.equal(found("Pc today", "Pc"), undefined);
});

test("offsets survive characters that grow when lowercased", () => {
  // "İ".toLowerCase() is two code units, which used to shift every later
  // offset and kill matching for the rest of the note.
  assert.deepEqual(matched("İ Lightroom and Lightroom end."), ["Lightroom", "Lightroom"]);
});

test("first scope takes the first mention in the document, all takes every one", () => {
  const text = "lr, then Lr, then Lightroom.";
  const mention = found(text);
  assert.ok(mention);

  const first = spansToLink(mention, "first");
  assert.equal(first.length, 1);
  assert.equal(text.slice(first[0].start, first[0].end), "lr");

  assert.equal(spansToLink(mention, "all").length, 3);
});

test("blocked ranges come back sorted and merged", () => {
  const ranges = blockedRanges("`a` and `b`\n\n```\ncode\n```\n");
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(ranges, sorted);
  for (let i = 1; i < ranges.length; i += 1) assert.ok(ranges[i][0] > ranges[i - 1][1]);
});

test("skips fences nested in list items and callouts", () => {
  assert.equal(found("- Step\n\t```js\n\tconst Style = 1;\n\t```", "Style"), undefined);
  assert.equal(found("- Step\n\n    ```js\n    const Style = 1;\n    ```", "Style"), undefined);
  assert.equal(found("> [!note]\n> ```js\n> const Style = 1;\n> ```", "Style"), undefined);
  assert.equal(found("> [!note]\n> > ```\n> > Style\n> > ```", "Style"), undefined);

  // The fence closes where it should, so prose after it still matches.
  const after = "> [!note]\n> ```js\n> const x = 1;\n> ```\n> Style is here";
  assert.deepEqual(
    found(after, "Style")?.spans.map((span) => after.slice(span.start, span.end)),
    ["Style"]
  );
  assert.equal(found("> [!note]\n> Style is here", "Style")?.count, 1);
});

test("a fence marker inside indented code does not open a fence", () => {
  const text = "Paragraph:\n\n    ```\n    code\n\nStyle after.";
  assert.equal(found(text, "Style")?.count, 1);
});

test("spans cover the whole name when lowercasing changes its length", () => {
  // "\u0130".toLowerCase() is two code units, so a span measured on the
  // lowercased name would run one character past the word.
  const text = "\u0130zmir, then izmir.";
  const mention = found(text, "\u0130zmir");
  assert.deepEqual(
    mention?.spans.map((span) => text.slice(span.start, span.end)),
    ["\u0130zmir", "izmir"]
  );
});

test("skips inline math but not currency", () => {
  assert.equal(found("where $x = Style$ holds", "Style"), undefined);
  assert.equal(found("$Style$", "Style"), undefined);
  assert.equal(found("costs $5 and Style costs $10", "Style")?.count, 1);
  assert.equal(found("$$\nStyle\n$$", "Style"), undefined);
});

test("skips reference links, footnotes and link definitions", () => {
  assert.equal(found("see [Style][1]", "Style"), undefined);
  assert.equal(found("see [the guide][Style]", "Style"), undefined);
  assert.equal(found("a claim[^Style]", "Style"), undefined);
  assert.equal(found("[guide]: https://example.com \"Style\"", "Style"), undefined);
  // A footnote's text is prose, only its marker is skipped.
  assert.equal(found("[^1]: Style is here", "Style")?.count, 1);
});

test("escapes the alias pipe inside a table row", () => {
  const instance = app();
  const table = "| Name | Note |\n| --- | --- |\n| a | style |\n";
  const start = table.indexOf("style");
  const span = { start, end: start + 5, name: "Style" };

  assert.ok(inTable(table, start));
  assert.equal(linkForSpan(instance, SOURCE, STYLE, table, span), "[[Style\\|style]]");

  const prose = "A | in prose, then style.";
  const proseStart = prose.indexOf("style");
  assert.equal(inTable(prose, proseStart), false);
  assert.equal(
    linkForSpan(instance, SOURCE, STYLE, prose, { start: proseStart, end: proseStart + 5, name: "Style" }),
    "[[Style|style]]"
  );
});

test("links through an editor open in a background pane, not the disk", async () => {
  let value = "Style here.";
  const editor = {
    getValue: () => value,
    offsetToPos: (offset: number) => offset,
    transaction: ({ changes }: { changes: { from: number; to: number; text: string }[] }) => {
      for (const change of [...changes].sort((a, b) => b.from - a.from)) {
        value = value.slice(0, change.from) + change.text + value.slice(change.to);
      }
    },
  };
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file: SOURCE, editor });

  const instance = app({}, {
    workspace: {
      activeEditor: null,
      iterateAllLeaves: (visit: (leaf: { view: unknown }) => void) => visit({ view }),
    },
  });
  (instance.vault as unknown as { process: () => never }).process = () => {
    throw new Error("wrote to disk while the note was open");
  };

  const result = await linkMentions(instance, SOURCE, buildMentionIndex(instance), "all", () => true);
  assert.equal(result.links, 1);
  assert.equal(value, "[[Style]] here.");
});

test("builds the index from public APIs when the link suggester is missing", () => {
  const instance = {
    metadataCache: {
      isUserIgnored: () => false,
      resolvedLinks: {},
      getFileCache: (target: TFile) =>
        target === LIGHTROOM ? { frontmatter: { aliases: ["Lr"] } } : null,
    },
    vault: { getConfig: () => [], getMarkdownFiles: () => [LIGHTROOM, STYLE] },
  } as unknown as App;

  const text = "Lr and Style and Adobe Lightroom";
  const mentions = scanMentions(instance, SOURCE, text, blockedRanges(text), buildMentionIndex(instance));
  assert.deepEqual(
    mentions.map((mention) => [mention.file.basename, mention.count]),
    [["Adobe Lightroom", 2], ["Style", 1]]
  );
});

test("first scope does not link again once the text already links the target", async () => {
  // A double click runs the writer twice before the metadata cache catches up,
  // so resolvedLinks still says unlinked the second time.
  let value = "Style here, and Style there.";
  const editor = {
    getValue: () => value,
    offsetToPos: (offset: number) => offset,
    transaction: ({ changes }: { changes: { from: number; to: number; text: string }[] }) => {
      for (const change of [...changes].sort((a, b) => b.from - a.from)) {
        value = value.slice(0, change.from) + change.text + value.slice(change.to);
      }
    },
  };
  const instance = app({}, {
    workspace: { activeEditor: { file: SOURCE, editor }, iterateAllLeaves: () => undefined },
  });
  const index = buildMentionIndex(instance);
  const style = (mention: Mention) => mention.file.path === STYLE.path;

  assert.equal((await linkMentions(instance, SOURCE, index, "first", style)).links, 1);
  assert.equal((await linkMentions(instance, SOURCE, index, "first", style)).links, 0);
  assert.equal(value, "[[Style]] here, and Style there.");
});
