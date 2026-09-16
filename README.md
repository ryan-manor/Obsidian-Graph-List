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
| Show unlinked mentions | Append notes this one names but does not link |

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

## Unlinked mentions

Notes named in the text but not linked are appended to the outbound group as ghost rows,
with a mention count and a link button that turns the first occurrence into a wikilink.
Accepting one re-renders the list, so the row turns solid and sorts with the rest.

Obsidian's own pane matches case-insensitive substrings and renders one row per
occurrence. Measured on a working note, that fires 37 times across 17 targets where 4
across 3 survive here. The filtering is structural, not a ranking:

- Whole words only, so `Bases-style` is not a mention of "Style Understanding Home".
- Longest match wins an overlap, so the alias "Lightroom" cannot claim the tail of
  "Adobe Lightroom" and strand the first word.
- Frontmatter, code blocks, inline code, URLs, existing links and tags are skipped.
  These are the places where linking would break the formatting.
- Targets this note already links are dropped, so a note linked once does not keep
  suggesting itself for every other time it appears.
- One row per target rather than per occurrence, with all occurrences counted.
- Single-word names must match case. Without that, every note titled with a common
  noun fires on ordinary prose: "Style" matched "a list style view", "Home" matched
  "project home page".

What survives that is either specific enough to be right or ambiguous in a way only
meaning can settle, for example "ACL" meaning Andersen-Chung-Lang in a note about
PageRank rather than the Adobe Context Layer wiki. Proximity does not help there:
an unlinked candidate usually shares no neighbours with the note, so it scores zero.

## Development

```
npm install
npm run dev      # watch, copies main.js + styles.css + manifest.json to the vault
npm run build    # production
```

`esbuild.config.mjs` hardcodes the vault plugin directory — change it there if
your vault lives elsewhere.
