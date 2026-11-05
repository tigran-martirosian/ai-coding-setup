# Systems Map (Nimbalyst extension)

A sidebar button that opens the project's systems map full screen. The map is `.claude/systems-map.json`,
built by the `systems-map` skill: the parts of the project, the files of each, and the links between them.

- A graph with pan (drag) and zoom (wheel, or the buttons at the bottom left). A part is as large as it has links.
  Hover or select a part and everything but it and its neighbours dims.
- A search box that matches the way `map.mjs --near <word>` does (id, name, a word of the description, a file),
  and dims everything but the matches and their neighbours. Enter selects the first match.
- A card for the selected part: what it is, its files (a click opens the file), and its links with what each says
  and the files that show it. Esc clears the selection.
- No map: a "Build a map" button starts a session with the prompt `/systems-map`.
- A map kept by another tool (`handledBy`): one sentence. A read error: the text and "Try again".
- Paths that `map.mjs --check` cannot find are listed in one quiet line in the error colour.
- Optional map fields (a map without them looks as before): a part's `group` colours it from a fixed list of eight
  colour tokens (the slot comes from the name, so a group keeps its colour) and pulls it toward its group; a small
  legend sits bottom left only when groups exist. `words` are read but not shown. A link's `type` (`uses` by default,
  `feeds`, `spends`, `opens`, `boosts`, `limits`) sets its dash: `uses` solid, the rest each their own. Evidence is
  a path or `{ "file": path, "token": text }`.
- Drift: a `DRIFT <file>  (link <from> -> <to>): no longer has: <token>` line of `--check` draws that link in the error
  colour, flags it in the card (`feeds → Pricing`, "code changed", the token it lost) and shows a banner
  "N links whose code changed, M paths gone".

The file is read when the panel opens and every 60 seconds while it is on screen. The path check runs
`~/.claude/skills/systems-map/map.mjs --project <folder> --check` through `host.exec`.

The layout is computed once for a map (`src/layout.ts`, seeded, no animation), so the picture does not move.
Groups pull weakly toward their centre and parts are kept from touching; 134 parts with 603 links take well under a second.

## Build and install

```
npm install
npm run build
npm run install-ext   # validates the bundle, copies to %APPDATA%\@nimbalyst\electron\extensions\systemsmap
```

Then restart Nimbalyst: it loads new and changed extensions only at startup.

## Checks

- `npm test` (`node test.mjs`): parse, which screen a file means, the `--check` output, the search rule,
  typed and tokened links, group colours and legend, the DRIFT line, the layout (inside the box, the same for a seed,
  no touching parts, the group pull, 134 parts and 603 links in under a second), the reads and the "Build a map" call.
- `npm run typecheck`.
