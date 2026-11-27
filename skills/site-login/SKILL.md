---
name: site-login
description: Get the user signed in to a website so Claude can work there - pages the user's own Chrome is signed in to are read through it with no window (where OpenCLI is set up); otherwise one visible Chromium window for the password that closes itself once the user is in, then headless reuse of the saved login. Use when a site job (LinkedIn, GitHub, any account page) finds the browser signed out, when a password is needed, or on /site-login [name] [url].
argument-hint: "[name] [url]"
---

# Site login

Needs Python and `pip install playwright` + `playwright install chromium`. The window it opens is Windows-first: on other systems the window may stay behind other apps.

The Nimbalyst browser tool's `headless: false` tab does not open a window the user can see. The
`browser-visible-gate` hook refuses it. Sign-ins go through a real window instead.

**Any site, first, where OpenCLI is set up** (`opencli doctor` says connected): read the page in the user's own
signed-in Chrome, `opencli web read --url "<url>" --window background -f md` in a new temp folder. It needs no
window and no password. The page came back signed in: use it and stop here; never ask the user to sign in for a
page their Chrome already opens. **An action they asked for in their account** (join, fill a form, click a button,
upload) is done by you: `opencli browser <session> open <url>`, then `opencli browser <session> state` to see the
page's elements, then `opencli browser <session> click|fill|type|select|upload <n>` (one session name for the whole
job; `opencli browser --help`). Before a click that publishes or sends in their name (post, comment, message, pay),
say what it sends and wait for their yes. Site commands that post, like or follow and `browser eval` stay blocked
(opencli-readonly). OpenCLI not installed or not connected: go on below.

**The user's own Google accounts (and any page with a Google sign-in): their own Chrome, never the Chromium
window.** Google blocks the window ("This browser or app may not be secure"). When their Chrome is not signed in
there either, open the page in it (Windows: `cmd //c start chrome "<url>"`) and say which account to pick. Other
sites go on with step 1.

1. Check first, headless, no window:
   `python ~/.claude/skills/site-login/login.py <name> <url> <signed-in-url-prefix> --check`
   Prints `SIGNED_IN` or `SIGNED_OUT`. Signed in: skip to step 3.
2. Tell the user in one line that a Chromium window titled with the site opens now, on top, for them to type their
   password, and that it closes itself once they are in. Then run the same command without `--check`, with
   `run_in_background: true`. It prints `SIGNED_IN` and closes, or `TIMEOUT` after 10 minutes, or
   `WINDOW_CLOSED`.
3. Do the work headless with Playwright on the same profile:
   `p.chromium.launch_persistent_context(str(Path.home()/".claude/browser-profiles/<name>"), headless=True)`.
   The Nimbalyst browser tool does not share this login.

Examples (the last argument is a plain address prefix, not a regex):

- **LinkedIn:** name `linkedin`, url `https://www.linkedin.com/login` (with `--check`: `https://www.linkedin.com/feed/`),
  prefix `https://www.linkedin.com/feed`. Not `/in/`: public profiles load signed out too.
- **GitHub:** name `github`, url `https://github.com/login`, prefix `https://github.com/` with `--check` on
  `https://github.com/settings/profile` (signed out lands on /login).

Output to act on: `WINDOW_OPEN ... IN_FRONT`, or `NOT_IN_FRONT`, in which case tell the user to look on the taskbar.
`PROFILE_IN_USE` (exit 4) means another run holds the profile: wait for it, never open a second window.

A human check (CAPTCHA, puzzle) inside the window is the user's to pass; never solve or route around it.
