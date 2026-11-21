# Commands (Nimbalyst extension)

A gutter button that opens a small pop-up list of the commands I use most, fourteen in four groups set apart
by a hairline, most-used first: lead, grill me, next move, where are we, board cleanup; new project, update
project, systems map, untangle; setup audit, update setup, backup; PC tidy, disk tidy. Setup audit opens its
checks in place: health, usage report, prompt audit, project scan, and in the `claude-settings` folder chat
review and full review. Pressing one starts a new session in the open
project, with the command as its first message.

The commands are the skills in [skills](../../skills); the extension only starts them. The list is in
`src/commands.ts`. To add a button, add a line there, then build and install. A
button can be tied to one project folder (`only`). Buttons for skills that exist on one computer only go
in `src/own.ts`, and `npm run build:share` builds the extension without them, which is the build I give
to other people.

What a button cannot do: reach a session that is already running. The app has no call for that, so
commands that belong to a running chat stay typed. The Note button below does reach one.

### Long lines in tool cards

`src/chat-wrap.css` wraps long lines in the chat's tool cards (new-file previews, diffs, any code or preformatted text). The app draws them
on one line and hides what sticks out, so the end of a long line could not be read.

### Note button and wake bridge

A host component (`NoteBridge`, `src/host.tsx`, mounted by the app outside any panel) puts a **Note** button
beside the Send button of every chat box. Type text, press Note: it is written to
`~/.claude/steer/button-note-<session id>.txt` and sent with `steer.mjs send --to <session id>`, so a busy session reads
it before its next step without being interrupted; if the session is idle (exit code 3) the text is sent
to it as a queued prompt (`ai:createQueuedPrompt`), which starts it at once. A file in the chat box (a pasted image, say) goes along: its path is added to the note, and an idle session also gets it as an attachment. A
press shows "Sending…" at once and dims the button. Steer runs with `--nowait`, so the box clears as soon as the
note is in the inbox; a dot on the button stays until `~/.claude/steer/receipts.json` holds the note's id, then
"Note delivered" shows, or "Not confirmed" with the start of the note, kept for when a tab that was left is opened again. The session is the `data-session-id` of the
chat box's nearest ancestor. This reads the app's own page markup (`src/find.ts` lists the selectors), so an
app update may break it: then the button does not appear and the console says why. It needs
`~/.claude/skills/steer/steer.mjs`; without it the status shows the error.

A **Try it** button sits beside Note (`src/try-it.ts`). It sends, the way Note does, a fixed note asking the session to run the project's `verify` skill and, when the change has a local page, to run `node ~/.claude/workers/try-page.mjs <url> --session <id>`. For 130 minutes after the press (as long as Note waits) it polls `~/.claude/state/try-it/<session id>.browser.json`, and opens a newer file on `localhost`, `127.0.0.1` or `[::1]` with `workspace:open-file`, so the page shows in a browser tab beside the chat. A successful open ends the watch; a failed one is said in the bubble, and a newer file can still open. What is typed in the box stays, and a press does not light Note's dot.

The same component polls `~/.claude/steer/outbox.jsonl` every 3 seconds. Each line
`{"id","ts","session","prompt"}` newer than 10 minutes and not yet delivered goes to `ai:createQueuedPrompt`
(up to 3 tries; failures are logged to the console). Delivered ids are kept in `outbox-done.json` (2 hours),
so a restart does not deliver twice. The extension never writes `outbox.jsonl`. Two app windows open at once
would each poll it.

The button calls the app's `extensions:ai-send-prompt` directly, the same call the SDK's `sendPrompt`
makes, because the pop-up is drawn outside a panel (see `src/popover.tsx`). If an app update changes that
call, the pop-up shows the app's error under the list.

The button calls the app's `extensions:ai-send-prompt` directly, the same call the SDK's `sendPrompt`
makes, because the pop-up is drawn outside a panel (see `src/popover.tsx`). If an app update changes that
call, the pop-up shows the app's error under the list.

### Diff line comments

In the Agent view's Review panel, a "+" by a diff line opens a comment box (Shift+click a second "+" for a range); the bar at the panel's foot sends all comments of the shown session as one message through the Note button's send, and keeps them per session in localStorage until sent or cleared (`src/diff-comments.ts`).

## Build and install

```
npm install
npm run build
npm run install-ext   # validates the bundle, copies to %APPDATA%\@nimbalyst\electron\extensions\commandbuttons
```

Then restart Nimbalyst: it loads new and changed extensions only at startup.

## Checks

- `npm test`: every button names a skill, a button tied to one project shows only there, a button sends
  the right call and does not wait for the reply.
- In the running app: `node ../read-aloud/scripts/cdp.mjs --file test/panel-check.js` clicks the gutter
  button and prints the pop-up's text. It starts no session.
- In the running app: `node ../read-aloud/scripts/cdp.mjs --file test/send-check.js` starts one real
  `/next-move` session, to prove the call.
