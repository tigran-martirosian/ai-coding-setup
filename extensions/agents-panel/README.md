# Agents Panel

A Nimbalyst extension for the **Agents & commands** list in the right sidebar, where helper agents and
background commands show up while Claude works.

- Running rows sit on top in their own cards, then failed, then stopped; finished ones fold away behind
  an "N done" line (click it to open or close; the choice is remembered).
- The header says what is going on in words: "2 running · 1 failed", "1 failed" or "Nothing running".
- Each row gets a plain title: for a shell command, its `# WHAT THIS DOES:` line; for a multi-line text,
  its first line. The full text shows when you hover the row.
- Under the title, one line: the kind, the state, the time, the tool count and, while it runs, what it is
  doing now ("searching files (Grep)").
- After the kind, a sub-agent's model and effort ("Sub-agent · Sonnet, medium · 4m 24s"). The app does not
  expose them, so they come from `~/.claude/state/agent-runs.jsonl`, which the `agent-run-log.mjs` hook
  writes for each helper call (`AGENT_RUN_LOG=off` turns the hook off). The panel reads the last 200 lines
  when the rows change and every 5 s while one runs, and matches a row to the newest line with the same
  description; a row with no line (a command, a helper from before the hook) shows nothing extra. It needs
  the filesystem permission. A leading `Worker:` / `Reviewer:` / `Sub-agent:` / `Helper:` is dropped from
  the title, which also ends at the first ` · `, ` | ` or `;` (the tooltip keeps the full text).
- The list is taller (up to 45% of the window) and can be resized by dragging its bottom edge.
- In the Russian build every word of the panel is in Russian.
- The commit panel at the bottom of the same sidebar shrinks with it, so the **Manual / Smart** switch no
  longer slides off the right edge when the sidebar is narrow.
- A chat you scroll up in stays where you put it while the agent keeps writing. Nimbalyst follows the
  end of the chat and treats anything within 50 px of it as "at the end", so the first small steps of a
  touchpad or a smooth-scrolling mouse wheel got undone by the next line of text. Now a scroll up (wheel,
  PageUp / Arrow up / Home, the scrollbar, touch) holds the view; scrolling back to the end, the **Scroll
  to bottom** arrow, sending a message or switching sessions makes it follow again. A wheel inside a
  tool's output box that scrolls on its own, or keys in a text field, leave it alone.

## Install

The setup's installer does this for you. By hand: `node build.mjs --install`, then quit Nimbalyst and
open it again. `node test.mjs` checks the build.

No build tools are needed: `src/` is plain JavaScript and CSS, copied to `dist/`. Nimbalyst owns the rows
and rewrites their class names, so the extension only adds its own `data-ap-*` attributes and `.ap-*`
elements.
