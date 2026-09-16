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
- `file.*` pseudo-properties: `file.name`, `file.path`, `file.folder`,
  `file.ext`, `file.ctime`, `file.mtime`, `file.size`, `file.tags`.
- Tags as clickable pills, wikilink values as working links.

## Controls

Everything is global — configured once in settings, no per-note overrides. The
sort control in the view header writes to the same settings.

| Setting | What it does |
| --- | --- |
| Sort by | Created time, modified time, a property, or title |
| Sort direction | Ascending / descending. Notes missing the sort value always land last |
| Separate inbound and outbound | Two groups, or one flat list |
| Properties | Which properties appear, in which order |
| Show property names | Label each value with its key |
| Number rows | Running count beside each title |
| Include attachments | Show linked images and PDFs alongside notes |

## Development

```
npm install
npm run dev      # watch, copies main.js + styles.css + manifest.json to the vault
npm run build    # production
```

`esbuild.config.mjs` hardcodes the vault plugin directory — change it there if
your vault lives elsewhere.
