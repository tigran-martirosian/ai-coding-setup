`tokens.css` holds the shared design tokens (`--x-*`) that give every extension the same look.
Each extension's build copies it in, so the file is prepended to that extension's own stylesheet.
A theme changes colour only, because every token derives from the app's `--nim-*` variables.
`--x-font-ui` follows the Ink theme font (`--ink-sans`) when an Ink theme is on, and falls back to the app's UI stack otherwise.
`--x-success` and `--x-warning` sit next to the other colour tokens and derive from `--nim-success` and `--nim-warning`.
