# Commands (Nimbalyst extension)

A gutter button that opens a small pop-up list of the commands I use most: board cleanup, next move,
project scan, setup audit, usage report and new project. Pressing one starts a new session in the open
project, on Sonnet, with the command as its first message.

The commands are skills from my private setup and are not in this repository; the extension only starts
them. The list is in `src/commands.ts`. To add a button, add a line there, then build and install. A
button can be tied to one project folder (`only`). Buttons for skills that exist on one computer only go
in `src/own.ts`, and `npm run build:share` builds the extension without them, which is the build I give
to other people.

What a button cannot do: reach a session that is already running. The app has no call for that, so
commands that belong to a running chat stay typed.

The button calls the app's `extensions:ai-send-prompt` directly, the same call the SDK's `sendPrompt`
makes, because the pop-up is drawn outside a panel (see `src/popover.tsx`). If an app update changes that
call, the pop-up shows the app's error under the list.

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
