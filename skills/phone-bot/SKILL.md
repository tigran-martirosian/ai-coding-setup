---
name: phone-bot
description: Join this Windows PC to the phone app (a Telegram Mini App that shows and drives your Nimbalyst sessions from your phone), pair the phone, and check, stop or remove the PC program. Use when the user pastes "join the phone app at https://..." from the bot, says "pair my phone", asks to set up, pair, check or stop the phone app on this PC, or runs /phone-bot.
---

# Phone app: join and pair

The phone app is a page in Telegram. It talks to a small program on this PC through the bot owner's relay. The page and the PC seal what they send each other, so the relay cannot read it (the relay also serves the page, so its owner is trusted). What the PC sends to Telegram is the exception: an alert's text (the project name and the session title) and a file sent to the chat pass the relay unsealed. A person joins with an invite link from the bot owner. Windows only.

Below, `setup.mjs` means `node ~/.claude/skills/phone-bot/pc/setup.mjs`. If a command fails, give its message as it is and stop.

1. **Already joined?** Run `setup.mjs status`. If it says `joined: yes`, `owner: bound` and `running: yes`, and the user wants another device or a new pairing, go to step 6. If the user wants nothing new, show the status and go to step 8. Done when you know what is missing.
2. **The add-on is complete.** This skill is installed only with the setup's phone add-on (the bot's line asks for that first), so check that the add-on is whole. If `~/.claude/skills/phone-bot/pc/setup.mjs` is missing, the add-on install is incomplete: run `node "<repo>/install.mjs" --with phone-bot`, where `<repo>` is the `repo` value in `~/.claude/setup-state.json`. `/update-setup` does not add it, but it keeps an installed add-on up to date. If the setup is older than 26.3, run `/update-setup` first. Done when `setup.mjs` exists.
3. **The address.** The user needs the relay address. It comes from the bot: the user opens the invite link from the bot owner on the phone and taps **Start**. The bot answers with a warning and a line that ends with `join the phone app at https://...`. Take the address from that line. If the user has no invite, say so and stop: only the bot owner can make one. Done when you have an address that starts with `https://`.
4. **Join.** Run `setup.mjs join <address>`. It makes this PC's keys, sets the start at log-on, starts the program and prints a pairing code. It also opens a page on this PC with the code as a QR code and a Copy button. The code works once, for 10 minutes. A PC that joined before gets new keys, so its phone must pair again. If the old phone inbox bot ran on this PC, `join` also stops it and removes its start entries. Done when it prints `Pairing code`.
5. **Pair the phone.** Tell the user: in the bot's chat on the phone, tap **Open**. On the pairing screen, tap **Use the code from my PC**, then **Scan the code on your PC** and point the phone at the QR code on the PC. On a device with no scanner (Telegram Desktop), paste the code into the field and tap **Pair with this code**. The first Telegram account that pairs becomes this PC's owner. If the code ran out, run `setup.mjs pair` for a new one. Done when the app shows this PC's sessions.
6. **Another device or a new pairing.** For a PC that already joined: run `setup.mjs pair`. It prints a new code and opens the page with the QR code, as in step 4. Then pair as in step 5. A paired device can also let a new one in: on the new device tap **OK it on my other device**, then tap OK on the paired one. Up to 4 devices. Done when the new device shows this PC's sessions.
7. **Check.** Run `setup.mjs status`. Done when it shows `joined: yes`, `owner: bound`, at least `paired devices: 1 of 4`, and `running: yes`. Then run `node ~/.claude/scripts/nimbalyst-patch/deliver.mjs --status`. The phone's controls to stop a session, answer a form or a plan, remove a queued message and pin a session need Stratus's patched Nimbalyst, and a first install does not patch it. When the line does not start with `nimbalyst: on`, say that these controls are missing until Nimbalyst is patched, and offer `/update-setup`.
8. **Voice.** The app's record button needs `uv` and a speech model of about 480 MB. The install and `/update-setup` start their download in the background while `~/.phone-app/voice.json` is missing (`uv` comes from winget); its output is in `~/.phone-app/voice-setup.log`. If the phone says voice is not set up, run `setup.mjs voice`. Done when `voice.json` exists or the log shows the download running.
9. **Reply**, short:
   - the app shows your Nimbalyst sessions and works while Nimbalyst is open on this PC;
   - the program starts at log-on and starts again when it ends, so nothing has to be started by hand;
   - the link mends itself: after a short drop, a network switch, sleep or a restart of this PC's program, the phone connects again within seconds (after a long outage, within 30 seconds of the internet coming back), and the app says the PC is off only after 20 seconds of no PC;
   - another phone or tablet: tap OK on a paired device when it asks, or run `setup.mjs pair` for a new code (up to 4 devices);
   - to stop it and remove the start at log-on: `setup.mjs remove`. The keys stay, so it comes back without a new pairing: `setup.mjs start-logon`, then `setup.mjs start`;
   - to leave the app for good: `setup.mjs remove`, and ask the bot owner to remove you.

## For the bot owner

The owner runs the relay and the bot. How to deploy them is in `phone/README.md` in the setup's repo. To invite a person, send `/invite` to the bot: it answers with a link that works once, for 7 days. Send the link by hand. `/invites` lists the open invites and can cancel one. `/people` lists who is invited and can remove a person. The owner joins their own PC the same way: send `/start` to the bot, then follow steps 2 to 5 and 7.

Budget: about 10 tool calls.
