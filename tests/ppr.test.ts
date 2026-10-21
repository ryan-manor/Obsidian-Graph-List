import assert from "node:assert/strict";
import test from "node:test";
import {
  adamicAdar,
  buildAdjacency,
  proximityScores,
  pushPPR,
  resourceAllocation,
  suggestNotes,
  type AdjMap,
} from "../src/ppr";

/**
 * These cover the ranking behind the default sort. The push approximation is
 * checked against exact PageRank by power iteration, and the blend is checked
 * for the property its doc comment promises: Adamic-Adar orders, PPR only
 * breaks ties.
 */

/** Undirected adjacency from edge pairs. */
function graph(edges: [string, string][]): AdjMap {
  const links: Record<string, Record<string, number>> = {};
  for (const [a, b] of edges) {
    (links[a] ??= {})[b] = 1;
  }
  return buildAdjacency(links);
}

/** Exact Personalized PageRank by power iteration, for graphs with no isolated nodes. */
function exactPPR(adj: AdjMap, source: string, alpha = 0.15): Map<string, number> {
  let x = new Map<string, number>([[source, 1]]);
  for (let i = 0; i < 500; i++) {
    const next = new Map<string, number>([[source, alpha]]);
    for (const [u, xu] of x) {
      const nbrs = adj.get(u) as Set<string>;
      const share = ((1 - alpha) * xu) / nbrs.size;
      for (const v of nbrs) next.set(v, (next.get(v) ?? 0) + share);
    }
    x = next;
  }
  return x;
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** A small vault-shaped graph: two clusters joined through one bridge note. */
const CLUSTERS = graph([
  ["s", "a"], ["s", "b"], ["s", "c"], ["a", "b"], ["b", "c"],
  ["c", "bridge"], ["bridge", "x"], ["x", "y"], ["y", "z"], ["x", "z"],
]);

test("adjacency is undirected, deduplicated, and drops self-links", () => {
  const adj = buildAdjacency({
    "A.md": { "B.md": 1, "A.md": 2 },
    "B.md": { "A.md": 3 },
    "Self.md": { "Self.md": 1 },
  });

  assert.deepEqual([...(adj.get("A.md") as Set<string>)], ["B.md"]);
  assert.deepEqual([...(adj.get("B.md") as Set<string>)], ["A.md"]);
  // A note that only links itself is still a node, just an isolated one.
  assert.equal(adj.get("Self.md")?.size, 0);
});

test("a link target with no outgoing links still becomes a node", () => {
  const adj = buildAdjacency({ "A.md": { "Leaf.md": 1 } });
  assert.deepEqual([...(adj.get("Leaf.md") as Set<string>)], ["A.md"]);
});

test("push PPR matches exact PageRank within its residual bound", () => {
  const approx = pushPPR(CLUSTERS, "s");
  const exact = exactPPR(CLUSTERS, "s");

  for (const [node, value] of exact) {
    const degree = (CLUSTERS.get(node) as Set<string>).size;
    // Leftover residual per node is below eps * degree, so that bounds the gap.
    assert.ok(
      Math.abs((approx.get(node) ?? 0) - value) < 1e-3,
      `${node}: push ${approx.get(node)} vs exact ${value} (degree ${degree})`
    );
  }
});

test("push PPR conserves probability mass up to the leftover residual", () => {
  const mass = pushPPR(CLUSTERS, "s");
  const total = sum(mass);
  assert.ok(total <= 1 + 1e-12, `total ${total} exceeds 1`);
  assert.ok(total > 0.99, `total ${total} lost too much mass`);
});

test("push PPR gives symmetric positions equal mass", () => {
  const mass = pushPPR(graph([["a", "hub"], ["hub", "b"]]), "hub");
  assert.ok(Math.abs((mass.get("a") ?? 0) - (mass.get("b") ?? 0)) < 1e-12);
});

test("push PPR stays local: a coarse threshold never reaches far nodes", () => {
  const edges: [string, string][] = [];
  for (let i = 0; i < 50; i++) edges.push([`n${i}`, `n${i + 1}`]);
  const mass = pushPPR(graph(edges), "n0", 0.15, 1e-2);

  assert.ok(mass.has("n1"));
  assert.ok(!mass.has("n40"), "a far node was touched");
  assert.ok(mass.size < 20, `touched ${mass.size} of 51 nodes`);
});

test("an isolated source keeps all of its mass", () => {
  assert.deepEqual([...pushPPR(new Map(), "alone")], [["alone", 1]]);
  assert.deepEqual([...pushPPR(new Map([["alone", new Set()]]), "alone")], [["alone", 1]]);
});

test("Adamic-Adar discounts connections routed through a hub", () => {
  // `quiet` shares a two-link note with the source; `busy` shares a daily note
  // that links to everything.
  const edges: [string, string][] = [
    ["s", "small"], ["small", "quiet"],
    ["s", "daily"], ["daily", "busy"],
  ];
  for (let i = 0; i < 8; i++) edges.push(["daily", `other${i}`]);
  const aa = adamicAdar(graph(edges), "s");

  assert.ok(Math.abs((aa.get("quiet") as number) - 1 / Math.log(2)) < 1e-12);
  assert.ok(Math.abs((aa.get("busy") as number) - 1 / Math.log(10)) < 1e-12);
  assert.ok((aa.get("quiet") as number) > (aa.get("busy") as number));
});

test("Adamic-Adar sums every shared neighbour and never scores the source", () => {
  const aa = adamicAdar(graph([["s", "z1"], ["s", "z2"], ["z1", "v"], ["z2", "v"]]), "s");
  assert.ok(Math.abs((aa.get("v") as number) - 2 / Math.log(2)) < 1e-12);
  assert.ok(!aa.has("s"));
});

test("Adamic-Adar is empty for a note outside the graph", () => {
  assert.equal(adamicAdar(CLUSTERS, "missing").size, 0);
});

test("proximity excludes the source and scales the strongest note to 1", () => {
  const scores = proximityScores(CLUSTERS, "s");
  assert.ok(!scores.has("s"));

  const top = Math.max(...scores.values());
  // AA is scaled to 1; the PPR tiebreak may add at most 1e-3 on top.
  assert.ok(top >= 1 && top <= 1.001, `top score ${top}`);
});

test("proximity orders by Adamic-Adar whenever it differs", () => {
  const scores = proximityScores(CLUSTERS, "s");
  const aa = adamicAdar(CLUSTERS, "s");
  const aaMax = Math.max(...aa.values());
  const nodes = [...scores.keys()];

  for (const i of nodes) {
    for (const j of nodes) {
      const gap = ((aa.get(i) ?? 0) - (aa.get(j) ?? 0)) / aaMax;
      if (gap > 1e-3) {
        assert.ok(
          (scores.get(i) as number) > (scores.get(j) as number),
          `${i} (AA ${aa.get(i)}) should outrank ${j} (AA ${aa.get(j)})`
        );
      }
    }
  }
});

test("proximity breaks Adamic-Adar ties by PPR mass", () => {
  // p and q each share one two-link note with the source, so their AA ties;
  // q has an extra link, which changes its PPR mass.
  const adj = graph([["s", "a"], ["s", "b"], ["a", "p"], ["b", "q"], ["q", "r"]]);
  const aa = adamicAdar(adj, "s");
  assert.equal(aa.get("p"), aa.get("q"));

  const mass = pushPPR(adj, "s");
  const scores = proximityScores(adj, "s");
  assert.notEqual(scores.get("p"), scores.get("q"));
  assert.equal(
    (scores.get("p") as number) > (scores.get("q") as number),
    (mass.get("p") as number) > (mass.get("q") as number)
  );
});

test("direct neighbours that share nothing are still ordered, not all zero", () => {
  const adj = graph([["s", "x"], ["s", "y"], ["x", "t"], ["y", "t"], ["x", "w"]]);
  const scores = proximityScores(adj, "s");
  assert.ok((scores.get("x") as number) > 0);
  assert.ok((scores.get("y") as number) > 0);
  assert.notEqual(scores.get("x"), scores.get("y"));
});

test("with no shared neighbours at all, PPR alone orders the list", () => {
  const adj = graph([["s", "only"]]);
  assert.deepEqual([...proximityScores(adj, "s")], [["only", 1]]);
});

test("notes in another component get no score", () => {
  const adj = graph([["s", "a"], ["a", "b"], ["far", "away"]]);
  const scores = proximityScores(adj, "s");
  assert.ok(!scores.has("far"));
  assert.ok(!scores.has("away"));
});

test("extra notes are floored like direct neighbours", () => {
  const adj = graph([["s", "a"], ["s", "b"], ["a", "b"], ["far", "away"]]);
  const scores = proximityScores(adj, "s", "adamic-adar", ["far"]);
  assert.ok((scores.get("far") ?? 0) > 0);
  assert.ok(!scores.has("away"));
});

test("an isolated source gets an empty list", () => {
  assert.equal(proximityScores(new Map([["s", new Set()]]), "s").size, 0);
});

test("a hub neighbour the push never reaches still gets a score", () => {
  // The hub's share of the source's residual, spread over 20,000 links, is
  // below the push threshold, and it shares no neighbours with the source.
  const edges: [string, string][] = [["s", "a"], ["s", "b"], ["a", "b"], ["s", "hub"]];
  for (let i = 0; i < 20000; i++) edges.push(["hub", `leaf${i}`]);
  const adj = graph(edges);
  assert.ok(!pushPPR(adj, "s").has("hub"));

  const scores = proximityScores(adj, "s");
  const hub = scores.get("hub") as number;
  assert.ok(hub > 0, "the hub was left blank");

  // Floored below every real score, so it sorts last without overtaking any.
  for (const [path, score] of scores) {
    if (path !== "hub") assert.ok(hub < score, `hub ${hub} vs ${path} ${score}`);
  }
});

test("Resource Allocation weighs a shared neighbour by 1/degree", () => {
  const edges: [string, string][] = [
    ["s", "small"], ["small", "quiet"],
    ["s", "daily"], ["daily", "busy"],
  ];
  for (let i = 0; i < 8; i++) edges.push(["daily", `other${i}`]);
  const ra = resourceAllocation(graph(edges), "s");

  assert.ok(Math.abs((ra.get("quiet") as number) - 1 / 2) < 1e-12);
  assert.ok(Math.abs((ra.get("busy") as number) - 1 / 10) < 1e-12);
});

test("Resource Allocation discounts hubs harder than Adamic-Adar", () => {
  // `niche` shares two small notes; `popular` shares one small note and a hub.
  const edges: [string, string][] = [
    ["s", "a"], ["a", "niche"], ["s", "b"], ["b", "niche"],
    ["s", "c"], ["c", "popular"], ["s", "hub"], ["hub", "popular"],
  ];
  for (let i = 0; i < 6; i++) edges.push(["hub", `leaf${i}`]);
  const adj = graph(edges);
  const ra = resourceAllocation(adj, "s");
  const aa = adamicAdar(adj, "s");

  const raShare = (1 / 8) / (ra.get("popular") as number);
  const aaShare = (1 / Math.log(8)) / (aa.get("popular") as number);
  assert.ok(raShare < aaShare, `hub share RA ${raShare} vs AA ${aaShare}`);
});

test("proximity follows the chosen algorithm", () => {
  const ra = proximityScores(CLUSTERS, "s", "resource-allocation");
  const raw = resourceAllocation(CLUSTERS, "s");
  const max = Math.max(...raw.values());
  assert.ok(Math.abs((ra.get("b") as number) - (raw.get("b") as number) / max) <= 1e-3);
});

test("suggestions are unlinked notes with at least two shared neighbours", () => {
  // `two` shares a and b with s; `one` shares only a; `linked` is a neighbour.
  const adj = graph([
    ["s", "a"], ["s", "b"], ["s", "linked"],
    ["a", "two"], ["b", "two"], ["a", "one"], ["a", "linked"], ["b", "linked"],
  ]);
  const paths = suggestNotes(adj, "s", "adamic-adar").map((suggestion) => suggestion.path);
  assert.deepEqual(paths, ["two"]);
});

test("suggestions rank by score and list shared neighbours strongest first", () => {
  const edges: [string, string][] = [
    ["s", "small"], ["s", "mid"], ["s", "hub"],
    ["small", "best"], ["mid", "best"],
    ["mid", "next"], ["hub", "next"],
  ];
  for (let i = 0; i < 10; i++) edges.push(["hub", `leaf${i}`]);
  const suggestions = suggestNotes(graph(edges), "s", "resource-allocation");

  assert.deepEqual(suggestions.map((suggestion) => suggestion.path), ["best", "next"]);
  assert.deepEqual(suggestions[0].via, ["small", "mid"]);
  assert.deepEqual(suggestions[1].via, ["mid", "hub"]);
});

test("a note outside the graph gets no suggestions", () => {
  assert.deepEqual(suggestNotes(CLUSTERS, "missing", "resource-allocation"), []);
});
