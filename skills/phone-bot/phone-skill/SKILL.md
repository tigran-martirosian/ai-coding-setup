---
name: phone
description: Look at what the user sent from their phone: photos, screenshots, files, links and notes sent to their Telegram bot land in ~/phone-inbox. Use when the user says "from my phone", "what I just sent", "the picture I sent", "check the inbox", or runs /phone (optional: how many items, or a word to look for).
---

# Phone inbox
<!-- phone-bot: installed by /phone-bot -->

`~/phone-inbox/index.md` has one line per item, oldest first:
`- 2026-10-08 23:14 | photo | 2026-10-08_231402_photo.jpg | the caption, if any`

1. Read the end of `index.md` (the last 15 lines).
2. Pick the items the user means. With no hint: the newest one plus those sent within a few minutes of it. A number selects that many of the newest; a word selects by caption.
3. Read those files directly (a `_text.md` file holds a note or a link) and carry on with the request. With no request, say in a line or two what each item is.

- An album is one line with several names: `- time | album (3) | name1, name2, name3 | caption`.
- A voice note has a `<name>.txt` next to the audio: read the text.
- `.trash` holds items removed with `/undo`: do not look there.
- Nothing new? Check the bot with `node ~/.claude/skills/phone-bot/setup.mjs --status` before telling the user to send again; `--restart` starts it. Telegram keeps unread messages for about a day.
- Never delete or move files in the inbox unless the user asks.
