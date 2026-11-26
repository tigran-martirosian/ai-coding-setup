# Phone page

The phone app's page: a Telegram Mini App that shows and runs Nimbalyst sessions on your own Windows PC. Telegram
opens it from the bot's Open button. The page talks to the PC through the relay over a sealed channel; the relay
only passes sealed frames on. What the PC sends to Telegram (an alert's text, a file sent to the chat) is not
sealed: see the [phone README](../README.md). Plain JavaScript modules, no npm packages and no bundler.

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

It writes the served page to `phone/page/dist/` (git ignores it). The build is byte-for-byte repeatable.

    node phone/page/build.mjs --checks [--out <dir>]

The test build for a check on a real phone: it adds the Checks screen (what this Telegram can do: microphone,
recording formats, storage, crypto), and opens it first.
`--out` puts the page somewhere other than `dist/`.

## Local run

The local relay (`phone/relay/local/server.mjs`) is the same relay code as on Cloudflare, run in plain Node. It
serves the built page with the relay's content policy:

    node phone/page/build.mjs
    node phone/relay/local/server.mjs --page phone/page/dist --port 8791 --bot-id 1 --bot-token <token> --owner 1 --telegram-key <64 hex>

The page signs in only with Telegram initData whose `hash` is made with that bot token.

Then open `http://localhost:8791/`. A plain browser is not Telegram: the page has no place to keep a key, so it
shows the pairing screen and goes no further. Two other ways go further:

- `node tests/test-phone-e2e.mjs` runs the whole path without Telegram: the built page served by the local relay,
  the real PC program joined to it, and the page's channel code pairing and asking the PC.
- `node phone/page/pictures.mjs [pairing] [wide] [filestab] [comfort] [home] [settings] …` (no word: every set; the
  list is at the top of the script) takes pictures with Playwright's headless Chromium shell, muted, with no window
  on the screen (it must be installed, e.g. `npx playwright install chromium-headless-shell`, or named in
  `PHONE_PAGE_BROWSER`) into `%TEMP%/phone-app-shots/`, dark and light, with Telegram's theme colours in the page
  address. It swaps in a fake Telegram host, a stored pairing and a fake PC that answers from fixed answers, in a
  temp build only. The sizes: 390x844 (iPhone), 384x694 (Telegram Desktop as it opens), 1920x1080 and 2560x1440
  (Desktop full screen at 100%).
  - `wide`: every tab screen and the session view (Home, Projects, a project, Files, a Files folder, Settings, a
    session) at the four sizes. At 1920 and 2560 it prints the column, Home's columns, the tab group and the Files
    tiles and cards it measured beside the design's widths, and fails when one differs.
  - `filestab`: the Files tab's states at 390 and 1920: empty, an empty folder, drag over (also too big),
    uploading and waiting, failed and too big, the file menu, the move sheet, sending, sent and send failed, the PC
    without the folder actions, the PC off.
  - `comfort`: the skeletons of Home, Projects and Files, a reply's Copy menu and a sent message's "Sending…" mark,
    at the four sizes.
  - After each picture it prints a line with the shot's name and "no overflow", or the elements that reach past the
    window's sides. The run fails at its end when any shot overflows.

`wide.css`, linked last, holds every width rule: from 600 px the app spans the
window and its column is 640 (608 inside); from 1200 px 1104 with Home in 2 columns; from 2000 px 1440 with Home in
3; the session view stays a 760 column; the tab bar's buttons are a centred group 480 wide. The Files tiles and
cards are in `files.css`.

## The link

`frame/channel.js` holds the socket and the sealed session; `frame/app.js` decides when to connect and what the
screen says about the link.

- The page pings every 20 seconds. If no pong comes within 10 seconds, it drops the socket and connects again.
- A failed attempt waits a random time between 0.25 seconds and 2^n seconds, at most 30 seconds. A session that
  stayed up 45 seconds starts the waits over. A link that dies at its first ping (after 30 seconds) keeps the
  waits growing.
- When the PC no longer holds this device (it was removed at the PC or from another device), the PC answers the
  hello with `unknown-device`. The page tries no more: it forgets the pairing as Settings' Unpair does and shows
  pairing with "This device is no longer paired with your PC."
- `sendStream` refuses a stream over its caller's size limit before any piece goes out. With no limit it is 25 MB
  (message attachments); files and voice notes pass `FILES_STREAM_MAX`, 50 MB.
- The phone's `online` event and a page shown from the cache drop the old socket and open a new one at once: a
  socket that may have died silently on the old network is not trusted.
- A hidden page keeps a live session and its socket. A connection attempt under way stops, and a socket with no
  session closes. When the page is shown again, it sends one ping on a kept socket: a pong within 3 seconds keeps
  the session and draws the screen again; no pong, or no session, connects again.
- When the relay answers that the PC has no link, the page keeps its socket and says hello again on it: every 3 to
  7 seconds for the first 20 seconds, then every 10 to 20 seconds. It says the PC is off only after 20 seconds of
  those answers.
- When the PC authenticates again, the relay tells the page. The page ends its session and says hello again at once
  on the same socket, so a restarted PC program (as after `/update-setup`) gets a session it knows.
- For 2 seconds after a drop, the screen stays as it was. After that it shows that it is connecting. After
  30 seconds without reaching the relay, it asks the user to check the phone's internet.
- Two attempts in a row whose socket never opened reload the page, at most once in 5 minutes. This frees a web view
  whose network is stuck after a wake.
- An open page keeps working when the relay starts serving a newer page; the next open gets the new files.

`tests/test-phone-steady.mjs` runs the real `app.js` and `channel.js` headless against the local relay, with a
scaled clock. It checks the reconnects after drops, outages, half-open links, a network switch and restarts. It does
not check the reload, the cache or sleep.

## Screens

Each file in `screens/` registers what it draws when it is imported (`frame/screens.js`). The build writes
`screens.generated.js`: an import per first-wave file (one that registers a tab screen or a Home part), `LATER` (the
ids of the screens in the other files) and `loadRest()`, which imports the other files after the first draw. A new
screen is a new file and no frame file changes. Every `registerScreen` call starts with `id` and `tab`, as the build
reads them from the text.

- `registerScreen({ id, tab, title, render, actions, updateLine, keep })`: `tab` is `"home"`, `"projects"`,
  `"files"` or `"settings"` for that tab's top screen, or `null`; `title` is text or `(params) => text`; `render(ctx)` returns an
  element, or `{ content, bottom }` where `bottom` sits above Telegram's main button; `actions` lists the PC actions
  the screen uses, so the frame greys it when the PC does not offer them; `updateLine` is the screen's own words in
  place of the frame's read-only line then; `keep` is the `frame/cache.js` name the screen keeps its last answer
  under, so the frame draws it before the first hello.
- `registerHomePart({ id, order, render })`: one block on Home, drawn in `order` (PC status 10, version 20, needs
  you 30, working 40, jobs 50, usage 60). `render(ctx)` returns an element or `null`; `ctx.home` holds what the
  Home screen asked the PC.

`render` gets `ctx` from the frame: `ask(action, data)` to the PC, `offered(action)`, `onEvent(fn)` for what the PC
pushes, `go(id, params)` and `back()`, `mainButton(spec)`, `haptic(kind)`, `connected` and the PC's `hello`.

The screens and their helper files:

| File | What it draws |
|---|---|
| `screens/pairing.js` | Pairing with the PC: the code from the scanner or typed in |
| `screens/device-join.js` | A further device joining: the six-digit check number on the new device, and the OK or No card on a paired one |
| `screens/home.js`, `screens/home-sessions.js` | Home: PC status, the version line, Needs you and Working |
| `screens/home-jobs.js`, `screens/job.js` | Home's Jobs (one row per open job of the job tracker, "N of M steps") and one job's steps in the job tracker's four folds |
| `screens/home-usage.js` | Home's Usage: this week's share of the Claude plan, today's use and when the week starts again |
| `screens/projects.js` | The Projects tab (Pinned, Recent, a search field) and a project's sessions (New session, Needs you, Working, Earlier), 20 at a time; the next 20 load when the list's last line comes into view |
| `screens/session.js` | The session view: the session bar with its state and Stop, the conversation, and the dock with the typing box (Send, Queue while the session works, Note). With no session in its params it is a new session, started on the PC by the first Send. It asks the PC again every 5 seconds while the session works or needs you |
| `screens/session-cards.js` | The cards the dock shows in place of the typing box while a session needs you: a question (one tap sends after a 5-second Undo; a multi-pick question sends with "Send N picks"), a permission, a plan, and the grey "Answer on the PC" card for a form or a prompt the phone cannot show, which has no input. Not a screen: `session.js` uses it |
| `screens/session-live.js` | The live part of the session view: tool calls as they run, helpers, context and queued messages |
| `screens/session-attach.js`, `screens/session-voice.js` | Attach and voice in the typing box: picked files go to the PC at once; a recording becomes text |
| `screens/session-files.js` | File previews and diffs in a session: a command's output, an edit's diff, a file an answer links to |
| `screens/session-form.js` | A form the session waits on, in the phone's own controls; a form the phone cannot draw gets the "Answer on the PC" card |
| `screens/files.js` | The Files tab: folders made, entered, renamed and removed; files added by drop or the picker, and sent to a chat |
| `screens/settings.js` | Settings: alerts per kind, the paired PC |
| `frame/markdown.js` | Markdown to elements for the replies and plans, never HTML text; links open only for `http` and `https` |

The session view hides the large title and the tab bar (`:has(.session-view)` in `page.css`): its session bar and
dock take their places.

An alert's Open button opens the page as `/?o=<handle>`. Once linked, the frame asks the PC `alerts.resolve` for the
handle's project and session and opens the session view; a handle older than 7 days gives a line that says so.

## The instant open

The page shows something at once and the content as soon as it can:

- `index.html` holds the skeleton shapes of Home, Projects and Settings (`#sk-home`, `#sk-projects`,
  `#sk-settings`) and a tab bar; `screens/files.js` adds the Files tab's shapes (`#sk-files`), so the HTML file holds
  no Files markup. They are styled by `shell.css`, the only style file that holds the first paint. The other style files load as preloads, Telegram's
  script is `async`, and the build writes one `<link rel="modulepreload">` per first-wave module.
- `frame/boot.js` runs first (the content policy allows no inline script): it sets Telegram's theme colours from the
  page address, turns the preloads into style sheets, calls `ready()` once Telegram's script ran, and lets the
  skeleton's tab bar switch tabs until the frame takes over.
- Home, Projects and Files keep their last answer on the phone (`frame/cache.js`, names `home`, `projects` and
  `files`; Home's parts keep theirs with `keepPart` in `home.js`). On the next open a kept tab screen is drawn before Telegram's script
  and the pairing are read, with `ctx.updating` true: it draws as if fresh, asks nothing, and the title row says
  "Updating · as of 14:05" until the first hello. Where nothing is kept, the tab's shapes stand in its place.
- Unpair, and a missing pairing, clear everything kept.

    node phone/page/timing.mjs [--ref <tag>]

measures first paint and first content, cold and warm.

## Telegram's script

`telegram-web-app.js` is Telegram's `https://telegram.org/js/telegram-web-app.js`, fetched on 2026-11-14 and served
from the page itself, as the content policy allows scripts from the page's own address only. Its SHA-256:

    baa788a6f686f4238db1b82ce8e76470930af7411b18b521ebb95a2c1480a267

To move to a newer copy: fetch it, check what changed, replace the file, update the date and hash here, and run the
build.
