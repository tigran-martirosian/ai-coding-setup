# Voice and phone

Type by speaking, hear replies read aloud, and follow your Nimbalyst sessions from your phone. Read Aloud and the
phone app are add-ons that a default install leaves out.

## Voice typing

![A key held while speaking, then the words typed into the chat box](../img/clip-voice.gif)

[Handy](https://handy.computer) is a free program that types what you say where the cursor is: hold a key, talk,
release. The speech model runs on your computer, and there is no account. On Windows the full install sets Handy up;
it asks once whether you want voice typing and keeps the answer.

To set it up by hand on Windows:

```
winget install --id cjpais.Handy -e
```

On a Mac: `brew install --cask handy` (the Mac side is untested). Open Handy once, allow the microphone and download
the **Whisper Large v3 Turbo** model. In its settings choose push to talk on Right Alt, pasting with Ctrl+V with the
clipboard left as it was, and keeping the model loaded. Then click into a chat box, hold Right Alt, speak and
release. You should see your words appear there.

Right Alt is AltGr on many non-US keyboards, and typing breaks while it is bound: pick another key to hold, such as
Right Ctrl.

## Read Aloud

The `read-aloud` extension (Windows only) reads replies aloud with Kokoro, a voice model that runs on your
computer. It cleans a reply for speech (no code, no Markdown), and a Python worker speaks it sentence by sentence.
Add it with `node install.mjs --with read-aloud`.

## The phone app

There is no hosted Stratus relay. To use the phone app on your own, first set up your own Telegram bot and relay
on Cloudflare's free Workers plan ([Phone app](../../phone/README.md)), then join your PC. Skip that only when
someone who runs a relay sent you an invite link.

The phone app shows your Nimbalyst sessions on this PC in a Telegram page and lets you follow and drive them from
the phone. Windows only.

- **How it connects.** The page talks to a small program on your PC through a relay. The page and the PC seal what
  they send, so the relay cannot read it. The relay also serves the page, so its owner is trusted. Two things pass the
  relay unsealed, because Telegram itself shows them: alert text (project name and session title) and files the PC
  sends to your chat.
- **After the first install.** The controls to stop a session, answer a form or a plan, remove a queued message and
  pin a session need Stratus's patched Nimbalyst. A first install leaves Nimbalyst as it is. Run `/update-setup`
  once, even when Stratus is already the newest version: it gets the patched Nimbalyst, which goes in when
  Nimbalyst closes ([How a version gets in](../how-it-works/nimbalyst-patches.md#how-a-version-gets-in)).
- **To join.** Add it with `node install.mjs --with phone-bot`. You need an invite link from the bot's owner (you, when you run your own). Open
  it on your phone, tap Start, and paste the line the bot sends into a session on your PC: the `phone-bot` skill
  joins the PC and shows a QR code, which you scan from the app's pairing screen.
- **It keeps running.** The PC program starts at log-on and starts again when it ends.
- **To stop.** `node ~/.claude/skills/phone-bot/pc/setup.mjs remove`. The keys stay, so `start-logon` then `start`
  bring it back without a new pairing.
- **The bot's owner** deploys the relay and the bot ([phone/README.md](../../phone/README.md)) and invites people
  with `/invite`.
