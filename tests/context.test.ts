import assert from "node:assert/strict";
import test from "node:test";
import { snippetAt, snippetFor } from "../src/context";

/** Snippet around the first occurrence of `needle`. */
function around(text: string, needle: string, radius?: number) {
  const start = text.indexOf(needle);
  return snippetAt(text, start, start + needle.length, radius, radius);
}

test("the snippet is the link's own line, split around the link", () => {
  const text = "# Heading\nFirst line.\nWe talked to [[Ritu Goel]] about CKG.\nLast line.";
  assert.deepEqual(around(text, "[[Ritu Goel]]"), {
    before: "We talked to ",
    match: "Ritu Goel",
    after: " about CKG.",
  });
});

test("list markers, task boxes and headings are dropped from the front", () => {
  assert.equal(around("  - [ ] ask [[Brian]] tomorrow", "[[Brian]]").before, "ask ");
  assert.equal(around("1. see [[CKG]]", "[[CKG]]").before, "see ");
  assert.equal(around("## About [[CKG]]", "[[CKG]]").before, "About ");
  assert.equal(around("> quoted [[CKG]]", "[[CKG]]").before, "quoted ");
});

test("links read as their display text, and inline styling is dropped", () => {
  const snippet = around("With [[Eshan Trivedi|Eshan]], **re** [[CKG#Intro]] and [docs](http://x)", "[[CKG#Intro]]");
  assert.equal(snippet.before, "With Eshan, re ");
  assert.equal(snippet.match, "CKG");
  assert.equal(snippet.after, " and docs");
  assert.equal(around("an alias [[Notes/A|Alpha]] here", "[[Notes/A|Alpha]]").match, "Alpha");
});

test("table rows lose their outer pipes and keep cells apart", () => {
  const snippet = around("| GAR | [[ACL]] 2021 | Generate |", "[[ACL]]");
  assert.equal(snippet.before, "GAR · ");
  assert.equal(snippet.after, " 2021 · Generate");
});

test("an unlinked mention keeps its text as written", () => {
  assert.equal(around("talk to brian about it", "brian").match, "brian");
});

test("long lines are cut at a word either side, with an ellipsis", () => {
  const words = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");
  const text = `${words(30, "before")} [[Target]] ${words(30, "after")}`;
  const snippet = around(text, "[[Target]]", 40);
  assert.ok(snippet.before.startsWith("…before"));
  assert.ok(snippet.before.length <= 41);
  assert.ok(snippet.after.endsWith("after…"));
  assert.ok(snippet.after.length <= 41);
});

test("frontmatter links read as key: value", () => {
  assert.deepEqual(snippetFor("", { key: "related", display: "CKG" }), {
    before: "related: ",
    match: "CKG",
    after: "",
  });
});
