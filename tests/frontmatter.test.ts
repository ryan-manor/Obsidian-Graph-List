import assert from "node:assert/strict";
import test from "node:test";
import { addLinkToProperty } from "../src/frontmatter";

test("a list property gains the link, created when missing", () => {
  const fm: Record<string, unknown> = {};
  assert.equal(addLinkToProperty(fm, "related", "[[A]]", true), "added");
  assert.equal(addLinkToProperty(fm, "related", "[[B]]", true), "added");
  assert.deepEqual(fm.related, ["[[A]]", "[[B]]"]);
});

test("a list property never takes the same link twice", () => {
  const fm: Record<string, unknown> = { related: ["[[A]]"] };
  assert.equal(addLinkToProperty(fm, "related", "[[A]]", true), "present");
  assert.deepEqual(fm.related, ["[[A]]"]);
});

test("a single value in a list property is kept", () => {
  const fm: Record<string, unknown> = { related: "[[A]]" };
  addLinkToProperty(fm, "related", "[[B]]", true);
  assert.deepEqual(fm.related, ["[[A]]", "[[B]]"]);
});

test("a text property takes the link only while empty", () => {
  const fm: Record<string, unknown> = { parent: "" };
  assert.equal(addLinkToProperty(fm, "parent", "[[A]]", false), "added");
  assert.equal(fm.parent, "[[A]]");
  assert.equal(addLinkToProperty(fm, "parent", "[[A]]", false), "present");
  assert.equal(addLinkToProperty(fm, "parent", "[[B]]", false), "full");
  assert.equal(fm.parent, "[[A]]");
});

test("an unknown type follows the value already there", () => {
  const fm: Record<string, unknown> = { parent: "[[A]]", related: ["[[A]]"] };
  assert.equal(addLinkToProperty(fm, "parent", "[[B]]"), "full");
  assert.equal(fm.parent, "[[A]]");
  addLinkToProperty(fm, "related", "[[B]]");
  assert.deepEqual(fm.related, ["[[A]]", "[[B]]"]);
  addLinkToProperty(fm, "new", "[[B]]");
  assert.deepEqual(fm.new, ["[[B]]"]);
});

test("an existing key is matched case-insensitively", () => {
  const fm: Record<string, unknown> = { "Related Pages": ["[[A]]"] };
  addLinkToProperty(fm, "related pages", "[[B]]", true);
  assert.deepEqual(fm, { "Related Pages": ["[[A]]", "[[B]]"] });
});
