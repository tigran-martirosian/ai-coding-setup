# Agents Panel

A Nimbalyst extension for the **Agents & commands** list in the right sidebar, where helper agents and
background commands show up while Claude works.

- Running items sit on top and are highlighted; finished ones fold away behind an "N finished" line
  (click it to open or close the list; the choice is remembered).
- The list is taller (up to 45% of the window) and can be resized by dragging its bottom edge.
- Each row gets a plain title: for a shell command, its `# WHAT THIS DOES:` line; for a long task, its first
  line. The full text shows when you hover the row.
- The commit panel at the bottom of the same sidebar shrinks with it, so the **Manual / Smart** switch no
  longer slides off the right edge when the sidebar is narrow.

## Install

The setup's installer does this for you. By hand: `node build.mjs --install`, then quit Nimbalyst and
open it again. `node test.mjs` checks the build.

No build tools are needed: `src/` is plain JavaScript and CSS, copied to `dist/`. Nimbalyst owns the rows
and rewrites their class names, so the extension only adds its own `data-ap-*` attributes and `.ap-*`
elements.
