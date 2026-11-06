`tokens.css` holds the shared design tokens (`--x-*`) that give every extension the same look.
agents-panel and ink-themes read it in `build.mjs` (agents-panel prepends it, ink-themes wraps it inside the theme scope); the vite extensions import it from `src`. All of them need the repo layout, so `../shared` must exist.
`build-lib.mjs` (language choice, STRINGS swap, tokens, install into Nimbalyst's folder), `vite-base.ts` (vite config with the language define), `host.ts` (typed calls into the app) and `check.mjs` (test counter, build step) are the code the extensions share.
A theme changes colour only, because every token derives from the app's `--nim-*` variables.
`--x-font-ui` follows the Ink theme font (`--ink-sans`) when an Ink theme is on, and falls back to the app's UI stack otherwise.
`--x-success` and `--x-warning` sit next to the other colour tokens and derive from `--nim-success` and `--nim-warning`.
`DESIGN.md` describes the shared look (colours, type, layout, components, do's and don'ts) in words; every new extension screen starts from it.
