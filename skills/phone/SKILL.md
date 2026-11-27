---
name: phone
description: Look at what the user sent from their phone - photos, screenshots, files, links and notes sent to the phone app's Inbox topic land in ~/phone-inbox. Use when the user says "from my phone", "what I just sent", "the picture I sent", "check the inbox", or runs /phone (optional - how many items, or a word to look for).
---

# Phone inbox

What the user sends to the phone app's bot chat (its "📥 Inbox" topic, when the chat has topics) is saved on this
PC by the phone app's PC program into `~/phone-inbox`. `index.md` there has one line per item, oldest first:

`- 2026-10-08 23:14 | photo | 2026-10-08_231402_photo.jpg | the caption, if any`

## Steps

1. Read the end of `~/phone-inbox/index.md` (the last 15 lines are enough unless the user asks for older items).
2. Pick the items meant: with no other hint, the most recent one, plus the ones sent within a few minutes of it (a
   photo and a note sent after it arrive as separate lines). A number or a word in the request selects by count or
   by caption and file name.
3. Read those files directly (pictures with Read; a `_text.md` holds a note, a `_link.md` a link, which is then
   opened the usual way) and carry on with what the user asked. With no request beyond "look", say in a line or two
   what each item is.
4. A picture the user wants to see goes to them with `display_to_user` (in Nimbalyst).

Done when each picked item was read and the user's request about it is answered.

## Index lines

- An album is one line with several file names: `- time | album (3) | name1, name2, name3 | caption`.
- A kind ending in `, too big` (over 20 MB) or `, gone` (the relay could no longer fetch it) has only a short `.md`
  note saved: the file itself stays in the Telegram chat; say so. A location, contact or poll is a note naming the
  kind.
- A voice note is saved as audio. Its words are not in the inbox: transcribe it only when the user asks.

## When nothing new is there

Check the phone app's PC program before telling the user to send again: `node ~/.claude/skills/phone-bot/pc/setup.mjs
status` should say `running: yes`. Not running: `setup.mjs start` (the `phone-bot` skill has the rest). What was sent
while the PC was off waits on the relay and is saved when the program connects again.

Leave the inbox's files where they are unless the user asks to move or delete them.
