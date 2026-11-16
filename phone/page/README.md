# Phone page

The phone app's page: a Telegram Mini App that shows and runs Nimbalyst sessions on your own Windows PC. Telegram
opens it from the bot's Open button. The page talks to the PC through the relay over a sealed channel; the relay
only passes sealed frames on. Plain JavaScript modules, no npm packages and no bundler.

| Place | What it holds |
|---|---|
| `index.html` | The one HTML file: Telegram's script, the styles, `frame/app.js` |
| `page.css` | The look: Telegram's theme mapped into the shared tokens, the type ladder, every screen's styles |
| `frame/` | Start-up, the link to the PC, pairing storage, the screen list, the tab bar |
| `screens/` | One file per screen or Home part; each registers itself |
| `checks/checks.js` | The Checks screen, only in the test build |
| `telegram-web-app.js` | Telegram's Mini App script, pinned (below) |
| `build.mjs` | The build |
| `pictures.mjs` | Pictures of the page for a look against the mock-ups |

The look follows `extensions/shared/DESIGN.md` (section "Phone app") and `extensions/shared/tokens.css`.

## Build

    node phone/page/build.mjs

It writes the served page to `phone/page/dist/` (git ignores it) and the SHA-256 of every served file to
`skills/phone-bot/pc/page-hashes.json`. The PC program trusts only a page whose files match that list, so run the
build after any change to a page file and commit the new list with it. The build is byte-for-byte repeatable.

    node phone/page/build.mjs --checks [--out <dir>]

The test build for a check on a real phone: it adds the Checks screen (what this Telegram can do: microphone,
recording formats, storage, crypto), opens it first, and writes no `page-hashes.json`, so a PC never trusts it.
`--out` puts the page somewhere other than `dist/`.

## Local run

The local relay (`phone/relay/local/server.mjs`) is the same relay code as on Cloudflare, run in plain Node. It
serves the built page with the relay's content policy:

    node phone/page/build.mjs
    node phone/relay/local/server.mjs --page phone/page/dist --port 8791 --bot-id 1 --owner 1 --telegram-key <64 hex>

Then open `http://localhost:8791/`. A plain browser is not Telegram: the page has no place to keep a key, so it
shows the pairing screen and goes no further. Two other ways go further:

- `node tests/test-phone-e2e.mjs` runs the whole path without Telegram: the built page served by the local relay,
  the real PC program joined to it, and the page's channel code pairing and asking the PC.
- `node phone/page/pictures.mjs [pairing] [home] [settings]` takes pictures with Playwright's headless Chromium
  shell (it must be installed, e.g. `npx playwright install chromium-headless-shell`, or named in
  `PHONE_PAGE_BROWSER`) into `%TEMP%/phone-app-shots/`: the pairing screen at 390 and 900 px, Home at 390 px against
  a fake PC (Nimbalyst open, Nimbalyst closed, PC off), and Settings at 390 px, dark and light. For Home and Settings
  it swaps in a fake Telegram host, a stored pairing and a channel that answers from fixed answers, in a temp build
  only.

## Screens

Each file in `screens/` registers what it draws when it is imported (`frame/screens.js`). The build writes
`screens.generated.js` with one import per file in `screens/`, so a new screen is a new file and no frame file
changes.

- `registerScreen({ id, tab, title, render, actions })`: `tab` is `"home"`, `"projects"` or `"settings"` for that
  tab's top screen, or `null`; `title` is text or `(params) => text`; `render(ctx)` returns an element, or
  `{ content, bottom }` where `bottom` sits above Telegram's main button; `actions` lists the PC actions the screen
  uses, so the frame greys it when the PC does not offer them.
- `registerHomePart({ id, order, render })`: one block on Home, drawn in `order` (PC status 10, version 20, needs
  you 30, working 40, jobs 50, usage 60). `render(ctx)` returns an element or `null`; `ctx.home` holds what the
  Home screen asked the PC.

`render` gets `ctx` from the frame: `ask(action, data)` to the PC, `offered(action)`, `onEvent(fn)` for what the PC
pushes, `go(id, params)` and `back()`, `mainButton(spec)`, `haptic(kind)`, `connected` and the PC's `hello`.

The screens and their helper files:

| File | What it draws |
|---|---|
| `screens/pairing.js` | Pairing with the PC: the code from the scanner or typed in |
| `screens/home.js`, `screens/home-sessions.js` | Home: PC status, the version line, Needs you and Working |
| `screens/projects.js` | The Projects tab (Pinned, Recent, a search field) and a project's sessions (New session, Needs you, Working, Earlier), 20 at a time; the next 20 load when the list's last line comes into view |
| `screens/session.js` | The session view: the session bar with its state and Stop, the conversation, and the dock with the typing box (Send, Queue while the session works, Note). With no session in its params it is a new session, started on the PC by the first Send. It asks the PC again every 5 seconds while the session works or needs you |
| `screens/session-cards.js` | The cards the dock shows in place of the typing box while a session needs you: a question (one tap sends after a 5-second Undo; a multi-pick question sends with "Send N picks"), a permission, a plan, and the grey "Answer on the PC" card for a form or a prompt the phone cannot show, which has no input. Not a screen: `session.js` uses it |
| `screens/settings.js` | Settings: alerts per kind, the paired PC |
| `frame/markdown.js` | Markdown to elements for the replies and plans, never HTML text; links open only for `http` and `https` |

The session view hides the large title and the tab bar (`:has(.session-view)` in `page.css`): its session bar and
dock take their places.

An alert's Open button opens the page as `/?o=<handle>`. Once linked, the frame asks the PC `alerts.resolve` for the
handle's project and session and opens the session view; a handle older than 7 days gives a line that says so.

## Telegram's script

`telegram-web-app.js` is Telegram's `https://telegram.org/js/telegram-web-app.js`, fetched on 2026-11-14 and served
from the page itself, as the content policy allows scripts from the page's own address only. Its SHA-256:

    baa788a6f686f4238db1b82ce8e76470930af7411b18b521ebb95a2c1480a267

To move to a newer copy: fetch it, check what changed, replace the file, update the date and hash here, and run the
build.
