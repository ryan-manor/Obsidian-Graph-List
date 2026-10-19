# Graph List

The local graph, rendered as a list instead of a force-directed blob, with the
unlinked mentions pane folded into the same list.

A sidebar is tall and narrow, so a graph canvas wastes most of it and a table
view needs horizontal scrolling. This view takes the same data the local graph
uses — resolved inbound and outbound links for the active note — and renders it
the way a Bases list view does: title, then the properties you picked
underneath.

## What it shows

- **Links to** / **Linked from** groups with counts, outbound first. Turn the
  split off for one flat, de-duplicated list.
- **Unresolved**, links to notes that do not exist yet. Clicking one creates the
  note, same as anywhere else in Obsidian. With these, the four surfaces this
  replaces are all accounted for: outgoing, inbound, unlinked mentions, broken.
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

Every control is a real button, so the pane is usable from the keyboard, and the
link button is always visible where there is no hover to reveal it.

## Controls

Everything is global, configured once under Settings → Community plugins →
Graph List, with no per-note overrides. The sort control in the view header
writes to the same settings.

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
| Link | Whether the link button links the first mention or all of them |

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
with a mention count and a link button. Accepting one re-renders the list, so the row
turns solid and sorts with the rest. If the target already has a row (an inbound link in
the flat list), the button goes on that row instead of a duplicate ghost.

The **Link** setting decides what the button converts:

- **First mention** (default). Once a note is linked, its other mentions stay plain text.
- **All mentions**. Every clean occurrence is linked. Mention a linked note again later and
  its row gets the button back with an "N unlinked mentions" count.
The command **Link remaining mentions of linked notes** does a whole note at once: every
leftover mention of every note this one already links, in one undo step. Notes you have
not linked yourself stay suggestions with their own button, so a bulk action never accepts
a guess for you.

An earlier version did this in the background as you typed. It was cut: a pane that also
rewrites your prose unprompted is two tools sharing a manifest, and the command gets the
same work done when you ask for it.

The list and both link actions run the same matcher over the same text, so they agree on
what counts as a mention. Blocked ranges come from the text rather than the metadata cache
for that reason: the link actions work on text the cache has not parsed yet, where cache
offsets would point at the wrong characters.

When the note is open in any pane, split or popout window, the button edits through that
editor, so its links land in one undo step and unsaved keystrokes cannot be lost. Only a
note that is not open anywhere is written on disk.

Matching is case-insensitive like Obsidian's own, so a lowercase "style" still nudges
towards the Style page. What differs is everything around the match. Obsidian renders
one row per occurrence and filters nothing. Measured on a working note, that fires 37 times across 17 targets where 4
across 3 survive here. The filtering is structural, not a ranking:

- Whole words only, so `Bases-style` is not a mention of "Style Understanding Home".
- Longest match wins an overlap, so the alias "Lightroom" cannot claim the tail of
  "Adobe Lightroom" and strand the first word. "First mention" then means first in the
  document, whichever name matched there.
- Titles shorter than three characters are ignored, aliases shorter than two. An alias
  was written by hand to stand for the note, so a two-letter one like "Lr" is meant.
- Frontmatter, code blocks (including ones inside callouts and list items), inline code,
  math, comments, HTML, URLs, existing links, reference links, footnote markers, link
  definitions and tags are skipped. These are the places where linking would break the
  formatting. In a table row the alias pipe is escaped, so the link does not split the cell.
- Only markdown notes are scanned. A canvas or a base is JSON, where a note name inside a
  file path would otherwise match and take a wikilink.
- Targets this note already links are dropped in first-mention mode, so a note linked
  once does not keep suggesting itself for every other time it appears. They still own
  their names in overlap resolution.
- One row per target rather than per occurrence, with all occurrences counted.
- Notes under Obsidian's "Excluded files" setting are never suggested, matching what
  its own link suggester does. Links you already made to them still show.
What survives that is either specific enough to be right or ambiguous in a way only
meaning can settle, for example "ACL" meaning Andersen-Chung-Lang in a note about
PageRank rather than the Adobe Context Layer wiki. Proximity does not help there:
an unlinked candidate usually shares no neighbours with the note, so it scores zero.

## Development

```
npm install
npm run dev        # watch, copies main.js + styles.css + manifest.json to the vault
npm run build      # production
npm run typecheck
npm test           # bundles tests/ and runs them on node:test
```

The tests cover the matcher: blocked ranges, word boundaries, overlap resolution,
the alias floor and link scope. That is the code that decides where the plugin
writes into prose, so it is the part worth pinning down. Nothing in it touches
Obsidian at runtime, which is what makes it testable outside the app.

`esbuild.config.mjs` hardcodes the vault plugin directory — change it there if
your vault lives elsewhere.
