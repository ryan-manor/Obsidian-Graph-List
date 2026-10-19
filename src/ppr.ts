// Graph-proximity ranking for the link list.
//
// Ported from Seek's parked active-note-anchoring branch (`src/graph.ts`,
// commit 862ad05), which in turn ports the validated read-only probe at
// ~/seek-graph-probe/probe.py. The method is Andersen-Chung-Lang local push
// (Andersen, Chung & Lang, "Local Graph Partitioning using PageRank Vectors",
// FOCS 2006): an approximation of Personalized PageRank seeded at one node
// that only touches the seed's neighborhood, so cost is O(1/(alpha*eps))
// pushes regardless of how big the vault is.
//
// This module is pure (adjacency in, scores out), so it can be reasoned about
// and tested without Obsidian.

/** Undirected adjacency: note path -> set of neighbour note paths. */
export type AdjMap = Map<string, Set<string>>;

/** ACL teleport probability. Higher = sharper locality. Probe default. */
const PPR_ALPHA = 0.15;

/** ACL residual threshold. Lower = wider frontier / more pushes. Probe default. */
const PPR_EPS = 1e-4;

/**
 * Undirected adjacency from Obsidian's directed resolvedLinks. Each link is an
 * edge in both directions: for relatedness, an out-link and a backlink say the
 * same thing. Self-links are dropped.
 */
export function buildAdjacency(
  resolvedLinks: Record<string, Record<string, number>>
): AdjMap {
  const adj: AdjMap = new Map();

  const ensure = (path: string): Set<string> => {
    let set = adj.get(path);
    if (!set) {
      set = new Set();
      adj.set(path, set);
    }
    return set;
  };

  for (const source in resolvedLinks) {
    const sourceSet = ensure(source);
    for (const target in resolvedLinks[source]) {
      if (target === source) continue;
      sourceSet.add(target);
      ensure(target).add(source);
    }
  }

  return adj;
}

/**
 * ACL local push approximation of Personalized PageRank seeded at `source`.
 * Returns raw, un-normalized mass per node.
 */
export function pushPPR(
  adj: AdjMap,
  source: string,
  alpha = PPR_ALPHA,
  eps = PPR_EPS
): Map<string, number> {
  const mass = new Map<string, number>();
  const residual = new Map<string, number>([[source, 1]]);
  const queue: string[] = [source];
  const queued = new Set<string>([source]);

  const degree = (node: string): number => adj.get(node)?.size ?? 0;

  while (queue.length > 0) {
    const u = queue.pop() as string;
    queued.delete(u);

    const ru = residual.get(u) ?? 0;
    const du = degree(u);

    if (du === 0) {
      // Dangling node: absorb its residual into its own mass.
      mass.set(u, (mass.get(u) ?? 0) + ru);
      residual.set(u, 0);
      continue;
    }

    if (ru / du < eps) continue;

    mass.set(u, (mass.get(u) ?? 0) + alpha * ru);
    const spread = ((1 - alpha) * ru) / du;
    residual.set(u, 0);

    for (const v of adj.get(u) as Set<string>) {
      const rv = (residual.get(v) ?? 0) + spread;
      residual.set(v, rv);
      const dv = degree(v);
      if (!queued.has(v) && dv > 0 && rv / dv >= eps) {
        queue.push(v);
        queued.add(v);
      }
    }
  }

  return mass;
}

/**
 * Adamic-Adar proximity from `source`: for every note v reachable through a
 * shared neighbour z, AA(v) = sum over z of 1/log(deg z). The 1/log(deg) term
 * discounts hub intermediaries, so a connection routed through a busy daily
 * note or MOC counts for almost nothing. Strictly a 2-hop signal.
 */
export function adamicAdar(adj: AdjMap, source: string): Map<string, number> {
  const aa = new Map<string, number>();
  const neighbors = adj.get(source);
  if (!neighbors) return aa;

  for (const z of neighbors) {
    const dz = adj.get(z)?.size ?? 0;
    const weight = dz > 1 ? 1 / Math.log(dz) : 0;
    if (weight === 0) continue;
    for (const v of adj.get(z) as Set<string>) {
      if (v === source) continue;
      aa.set(v, (aa.get(v) ?? 0) + weight);
    }
  }

  return aa;
}

/** How much a PPR tiebreak may move a score. Below the two decimals on display. */
const PPR_TIEBREAK = 1e-3;

/**
 * Proximity score per note, seeded at `source` and scaled so the strongest
 * neighbour is 1. Adamic-Adar ranks; push-PPR breaks its ties.
 *
 * Adamic-Adar carries the ordering because it asks the question the list cares
 * about: how much of this note's neighbourhood does that note also sit in? Ties
 * are exact and common, so push-PPR mass, which sees paths of any length, not
 * just the 2-hop ones AA counts, separates them, including the neighbours that
 * share nothing and would otherwise all sit at zero.
 *
 * Two alternatives were measured on this vault and rejected:
 *
 *   Raw PPR mass alone tracks degree closely enough to read as "sort by how
 *   busy the note is", which the list already conveys.
 *
 *   The ACL sweep quantity, mass/degree, inverts it: on a note about Seek's
 *   specificity boost it put a two-link daily note first and buried the project
 *   home page (degree 69) last at 0.09. Sweep order is built for finding
 *   cluster boundaries, not for ranking within a neighbourhood.
 *
 * The source itself is excluded throughout: it is the teleport target and
 * hoards the PPR mass.
 *
 * Every direct neighbour gets a score. A hub that shares no neighbours with
 * the source can sit below the push threshold and collect no mass at all; it
 * is floored just under the weakest real score rather than left blank, since
 * a direct link is still closer than nothing.
 */
export function proximityScores(adj: AdjMap, source: string): Map<string, number> {
  const aa = adamicAdar(adj, source);
  const mass = pushPPR(adj, source);

  let aaMax = 0;
  for (const [path, score] of aa) {
    if (path !== source && score > aaMax) aaMax = score;
  }

  let pprMax = 0;
  for (const [path, m] of mass) {
    if (path !== source && m > pprMax) pprMax = m;
  }

  const scores = new Map<string, number>();
  const neighbors = adj.get(source) ?? new Set<string>();
  if (pprMax <= 0 && aaMax <= 0) {
    // Nothing reached past the source: its neighbours are all equally close.
    for (const path of neighbors) if (path !== source) scores.set(path, 1);
    return scores;
  }

  const paths = new Set<string>([...aa.keys(), ...mass.keys()]);
  for (const path of paths) {
    if (path === source) continue;
    const near = pprMax > 0 ? (mass.get(path) ?? 0) / pprMax : 0;
    if (aaMax <= 0) {
      // No shared neighbours anywhere: PPR is the only ordering left.
      if (near > 0) scores.set(path, near);
      continue;
    }
    scores.set(path, (aa.get(path) ?? 0) / aaMax + PPR_TIEBREAK * near);
  }

  let weakest = Infinity;
  for (const score of scores.values()) if (score > 0 && score < weakest) weakest = score;
  const floor = Number.isFinite(weakest) ? weakest / 2 : 1;
  for (const path of neighbors) {
    if (path !== source && !((scores.get(path) ?? 0) > 0)) scores.set(path, floor);
  }

  return scores;
}
