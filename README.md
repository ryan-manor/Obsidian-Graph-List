# Local Graph List

The local graph, rendered as a list instead of a force-directed blob.

A sidebar is tall and narrow, so a graph canvas wastes most of it and a table
view needs horizontal scrolling. This view takes the same data the local graph
uses — resolved inbound and outbound links for the active note — and renders it
the way a Bases list view does: title, then the properties you picked
underneath.

## What it shows

- **Links to** / **Linked from** groups with counts, outbound first. Turn the
  split off for one flat, de-duplicated list.
- Any frontmatter property under each title. Empty values are skipped, so rows
  stay tight.
- `sort`, a pseudo-property that always shows the value the list is ordered by,
  so the date on the row is the date it sorted on. It follows the sort setting,
  including changes made from the view header.
- `proximity`, the graph score described below, available as a column even when
  you are sorting on something else.
- `file.*` pseudo-properties: `file.name`, `file.path`, `file.folder`,
  `file.ext`, `file.ctime`, `file.mtime`, `file.size`, `file.tags`.
- Tags as clickable pills, wikilink values as working links.

## Controls

Everything is global — configured once in settings, no per-note overrides. The
sort control in the view header writes to the same settings.

| Setting | What it does |
| --- | --- |
| Sort by | Graph proximity, created time, modified time, a property, or title |
| Sort direction | Ascending / descending. Notes missing the sort value always land last |
| Separate inbound and outbound | Two groups, or one flat list |
| Properties | Which properties appear, in which order. `sort` tracks the sort key |
| Show property names | Label each value with its key |
| Number rows | Running count beside each title |
| Include attachments | Show linked images and PDFs alongside notes |

## Ranking by graph proximity

The default sort asks which links matter to *this* note rather than which are
newest. Two signals, both seeded at the open note, both cheap enough to run on
every render (~12ms on a 3,400-note vault):

- **Adamic-Adar** carries the ordering: for each neighbour, the sum of
  `1/log(degree)` over the neighbours they share with the source. It answers
  "how much of this note's world does that note also live in", and the
  `1/log(degree)` discount means a connection routed through a busy daily note
  or MOC counts for almost nothing.
- **Push-PPR** breaks its ties — Adamic-Adar ties are exact and common.
  Personalized PageRank seeded at the source, approximated by Andersen-Chung-Lang
  local push (*Local Graph Partitioning using PageRank Vectors*, FOCS 2006),
  which only touches the seed's neighbourhood, so cost does not scale with the
  vault. Ported from Seek's parked `feature/active-note-anchoring` branch.

Scores are scaled so the strongest neighbour is 1.00, and shown on the row.

Two alternatives were measured on a real vault and rejected. Raw PPR mass alone
tracks degree closely enough to read as "sort by how busy the note is". The ACL
sweep quantity, mass/degree, inverts that: on a note about Seek's specificity
boost it put a two-link daily note first and buried the project home page last
at 0.09 — sweep order is built for finding cluster boundaries, not for ranking
inside a neighbourhood.

## Development

```
npm install
npm run dev      # watch, copies main.js + styles.css + manifest.json to the vault
npm run build    # production
```

`esbuild.config.mjs` hardcodes the vault plugin directory — change it there if
your vault lives elsewhere.
