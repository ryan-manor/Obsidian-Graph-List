# Graph List

The local graph, rendered as a list instead of a force-directed blob, with the
outgoing links and backlinks panes, unlinked mentions in both directions
included, folded into the same list.

A sidebar is tall and narrow, so a graph canvas wastes most of it and a table
view needs horizontal scrolling. This view takes the same data the local graph
uses (resolved inbound and outbound links for the active note) and renders it
the way a Bases list view does: title, then the properties you picked
underneath, or the line each link sits on.

## What it shows

- **Links to** / **Linked from** groups with counts, outbound first. Turn the
  split off for one flat, de-duplicated list.
- **Unresolved**, links to notes that do not exist yet. Clicking one creates the
  note, same as anywhere else in Obsidian. With these, the four surfaces this
  replaces are all accounted for: outgoing, inbound, unlinked mentions, broken.
- Unlinked mentions both ways, ranked in the list as if they were linked: notes
  this one names, and notes that name this one (the backlinks pane's unlinked
  mentions). Each row's button writes the link where it belongs.
- Under each title, either chosen frontmatter properties (empty values are
  skipped, so rows stay tight) or the link's context: the line the link sits
  on, with the link picked out. The first link when there are several, the
  mention itself for an unlinked row. Clicking the line opens that note there.
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
| Algorithm | Adamic-Adar or Resource Allocation, for proximity and suggestions |
| Depth | 1 lists linked notes; 2 adds a Suggested group of notes two links away |
| Separate inbound and outbound | Two groups, or one flat list |
| Under each title | Properties, or the line the link sits on |
| Shown under each title | Which properties appear; drag to reorder |
| Show property names | Label each value with its key |
| Number rows | Running count beside each title |
| Show unlinked mentions | Notes this one names but does not link, ranked as ghost rows |
| Show mentions in other notes | Notes that name this one but do not link it, as ghost rows |
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
- **Push-PPR** breaks its ties, since Adamic-Adar ties are exact and common.
  Personalized PageRank seeded at the source, approximated by Andersen-Chung-Lang
  local push (*Local Graph Partitioning using PageRank Vectors*, FOCS 2006),
  which only touches the seed's neighbourhood, so cost does not scale with the
  vault. Ported from Seek's parked `feature/active-note-anchoring` branch.

Scores are scaled so the strongest neighbour is 1.00, and shown on the row.

Two alternatives were measured on a real vault and rejected. Raw PPR mass alone
tracks degree closely enough to read as "sort by how busy the note is". The ACL
sweep quantity, mass/degree, inverts that: on a note about Seek's specificity
boost it put a two-link daily note first and buried the project home page last
at 0.09. Sweep order is built for finding cluster boundaries, not for ranking
inside a neighbourhood.

### Resource Allocation and suggestions

Resource Allocation (Zhou, Lü and Zhang, 2009) is the same sum with `1/degree` in place of
`1/log(degree)`. A shared note with 72 links counts for a quarter under Adamic-Adar and a
seventy-second under RA, so on a vault full of daily notes and MOCs it leans on the small,
specific notes two pages have in common.

At depth 2 the same score is read as link prediction: notes this one does not link, that
share at least two neighbours with it, top eight, each labelled with the notes it shares.
Notes already showing as unlinked mentions are left to their ghost rows. Nothing is written
to the note.

## Unlinked mentions

Notes named in the text but not linked join the outbound group (or the flat list) as ghost
rows, sorted with the linked ones as if the link already existed, with a mention count and
a link button. Accepting one only turns the row solid. If the target already has a row (an
inbound link in the flat list), the button goes on that row instead of a duplicate ghost.

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
an unlinked candidate usually shares no neighbours with the note. For ranking it gets the
same floor as a direct link that shares nothing.

### Inbound

Inbound mentions are the same matcher run from the other side: every other note is scanned
for this note's title and aliases, and each note with a clean match joins the Linked from
group (or the flat list) as a ghost row, with an "N mentions of this" count and a link
button that writes into that note (through its editor if it is open). A row can carry both
buttons when the two notes name each other. Nothing is capped, so a note with a common alias like "Style" lists every note
that says it, the way the backlinks pane does. The Link setting applies here too: in
first-mention mode a note that already links this one is done.

A common name turns up in hundreds of notes, mostly inside longer words, links or code, so
each note is tested cheaply against the target's own names first and only clean matches get
the full scan. The first render of a note reads the vault (about 20ms typically, 160ms for
a hub with a one-word alias, on 3,700 notes); after that only notes that changed are
rescanned.

## Development

```
npm install
npm run dev        # watch, copies main.js + styles.css + manifest.json to the vault
npm run build      # production: main.js and styles.css next to manifest.json
npm run typecheck
npm test           # bundles tests/ and runs them on node:test
```

The tests cover the matcher: blocked ranges, word boundaries, overlap resolution,
the alias floor and link scope. That is the code that decides where the plugin
writes into prose, so it is the part worth pinning down. Nothing in it touches
Obsidian at runtime, which is what makes it testable outside the app.

`esbuild.config.mjs` hardcodes the vault plugin directory; change it there if
your vault lives elsewhere.

A release attaches `main.js`, `manifest.json` and `styles.css` to a GitHub release
tagged with the manifest version; the built files are not committed. `versions.json`
maps each plugin version to the minimum Obsidian version it needs.

## License

MIT, see [LICENSE](LICENSE).
