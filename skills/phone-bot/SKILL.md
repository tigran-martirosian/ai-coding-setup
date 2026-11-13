---
name: phone-bot
description: Your own Telegram bot that saves what you send from the phone and passes requests to your sessions.
disable-model-invocation: true
---

# Phone bot

You create your own Telegram bot and it runs on this computer. Everything you send it (photos, files, links, notes, voice notes) is saved in `~/phone-inbox`, and a request you write can be handed to a Nimbalyst session. Only you can use it: the first person who writes to the bot becomes its owner and everyone else is ignored.

1. **Already set up?** Run `node ~/.claude/skills/phone-bot/setup.mjs --status`. If the bot is running, show the status and stop. Done when you have either shown a running status or know the bot is not set up.
2. **Say what it does and what leaves the computer, then ask.** First these three sentences: "What you send to the bot passes through Telegram's servers. A text message is read by Claude Haiku on your own Claude subscription, about 1,500 tokens a message. Files, the bot token and the inbox stay on this computer." Then the steps only the user can do: in Telegram open @BotFather, send `/newbot`, pick a name and a username ending in `bot`, and copy the token it gives. Ask for the token in a form with one text field. Done when you have the token.
3. **Set it up.** Run `node ~/.claude/skills/phone-bot/setup.mjs --token <token>`. If it fails, give its message as it is and stop. Done when it prints the bot's @username.
4. **Become the owner.** Tell the user to send the bot any message now: the first person who writes becomes the owner. Then run `node ~/.claude/skills/phone-bot/setup.mjs --status`. Done when it says the owner is locked.
5. **Reply**, short:
   - anything sent is saved to `~/phone-inbox`; `/help` in the bot lists the commands;
   - plain text is a chat with Claude Haiku that can hand work to a session after a tap on Send; `/chat off` makes the bot save-only;
   - a session's answer comes back to the phone, and a question with options or a permission prompt comes as buttons to tap; a form still has to be answered at the computer;
   - `/phone` in any session looks at what was sent;
   - voice notes become text only when `uv` is installed (the first use downloads a 480 MB speech model);
   - the session parts need Nimbalyst running; saving works without it;
   - to stop: `node ~/.claude/skills/phone-bot/setup.mjs --remove`.

   Say once that the macOS start at log-on is written but was not tested on a Mac.

Budget: about 8 tool calls.
