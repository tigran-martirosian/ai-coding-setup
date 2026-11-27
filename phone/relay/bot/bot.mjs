// The bot the Hub runs (pipe design, sections 3, 5 and 7): the webhook with its secret header, the owner's invite
// commands, redeeming an invite, the per-chat Open button, and forwards held sealed for the PC (held.mjs).
// Alert sending and deleting is the Hub's own (hub.mjs, pcAlert); /clear deletes the alerts the Hub keeps. A stranger gets no answer and nothing is stored about him:
// a reply would tell him the bot is alive.
//   makeBot({ webhookSecret, buttonForwardUrl, buttonForwardSecret, fetch }) -> the Hub's `bot` option:
//   (ctx) -> { webhook, pcConnected, pcFrame }.
// webhook({ headers, body, origin }) needs `origin`, the relay's own address, for the Open button and the join line.
// Button forward: the relay is the bot's one webhook, so another tool that sends buttons through the same bot gets
// their presses from here. The owner's press of a button whose callback_data starts with `x:` is POSTed to
// buttonForwardUrl (https) with the header `X-Button-Secret: <buttonForwardSecret>` and the JSON body
// { data, callbackId, chatId, messageId }; the receiver answers the callback itself. With either setting missing
// such a press is answered empty and dropped, like any unknown button; `fetch` is needed only when both are set.
// The body `{ "relay_command": "remove-topics" }` with the webhook secret (deploy-test.mjs --remove-topics) deletes
// every kept topic at Telegram and forgets the `topics:<chat>` keys (files contract, section 7).
import { randomBytes, sha256, toB64u, toHex } from "../../shared/seal.mjs";
import { createHeld } from "./held.mjs";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const INVITE_LIFE = 7 * DAY;
const ALERT_LIFE = 2 * DAY;
const DELETE_BATCH = 100;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{32}$/;
const SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const ORIGIN = /^https?:\/\/[^/]+$/;
const OK = { status: 200, body: "ok" };
const CLOSE_REMOVED = 4403;
const HTTPS_URL = /^https:\/\/[^/\s]+(\/\S*)?$/;
const FORWARD_PREFIX = "x:";
// Short: the webhook allows one connection, so a slow receiver holds up the bot's other updates this long.
const FORWARD_TIMEOUT = 3000;
const FORWARD_FAILED = "Couldn't reach the tool; try again";
const FORWARD_SLOW = "The tool is slow; check before pressing again";
const FORWARD_BAD_URL =
  "The button forward address is not https; fix BUTTON_FORWARD_URL";

const WARNING =
  "Before you join: the app page comes from the owner's relay. Whoever controls that relay can make your PC do " +
  "anything this app can do, and that includes running commands through a Claude session. Your PC checks the " +
  "page and goes read-only when it changes, but it cannot catch every change. Join only if you trust the owner.";

export function makeBot({
  webhookSecret,
  buttonForwardUrl,
  buttonForwardSecret,
  fetch,
}) {
  if (typeof webhookSecret !== "string" || !SECRET.test(webhookSecret))
    throw new Error(
      "bot: the webhook secret must be 32 to 256 characters of A-Z a-z 0-9 _ -",
    );
  // A bad forward address turns only the forward off: the phone app keeps running.
  const forwardUrl =
    typeof buttonForwardUrl === "string"
      ? buttonForwardUrl.trim()
      : buttonForwardUrl;
  const badUrl = Boolean(
    forwardUrl && buttonForwardSecret && !HTTPS_URL.test(forwardUrl),
  );
  if (badUrl)
    console.log(
      "bot: the button forward address is not an https URL; the forward is off",
    );
  const forward =
    forwardUrl && buttonForwardSecret && !badUrl
      ? { url: forwardUrl, secret: buttonForwardSecret, fetch }
      : null;
  if (forward && typeof fetch !== "function")
    throw new Error("bot: the button forward needs fetch");

  return (ctx) => {
    for (const name of ["store", "telegram", "now", "log", "ownerTgId"]) {
      if (ctx[name] === undefined) throw new Error(`bot: ctx has no ${name}`);
    }
    const { store, telegram, now, log, ownerTgId } = ctx;
    const held = createHeld(ctx);
    let username = null;
    let lastCleanUp = -Infinity; // in memory: a restarted Hub cleans up once more, which is harmless

    const say = (chatId, text, extra = {}) =>
      telegram("sendMessage", { chat_id: chatId, text, ...extra });
    const day = (t) => new Date(t).toISOString().slice(0, 10);

    async function botName() {
      if (username) return username;
      const me = await telegram("getMe", {});
      if (!me || typeof me.username !== "string")
        throw new Error("bot: getMe gave no username");
      username = me.username;
      return username;
    }

    const openButton = (chatId, origin) =>
      telegram("setChatMenuButton", {
        chat_id: chatId,
        menu_button: {
          type: "web_app",
          text: "Open",
          web_app: { url: `${origin}/` },
        },
      });

    async function welcome(chatId, origin) {
      await openButton(chatId, origin);
      await say(
        chatId,
        `${WARNING}\n\nPaste this into a session on your PC: install the setup's phone add-on (node <setup folder>/install.mjs --with phone-bot; the folder is "repo" in ~/.claude/setup-state.json), then join the phone app at ${origin}`,
      );
    }

    // ---- the webhook ----

    async function webhook(req) {
      const given = req.headers?.["x-telegram-bot-api-secret-token"];
      if (!sameText(given, webhookSecret)) {
        log("webhook refused: bad secret");
        return { status: 401, body: "unauthorized" };
      }
      if (typeof req.origin !== "string" || !ORIGIN.test(req.origin))
        throw new Error(
          `bot: the webhook needs the relay's origin, got ${req.origin}`,
        );
      let update;
      try {
        update = JSON.parse(req.body);
      } catch {
        return { status: 400, body: "not JSON" };
      }
      if (update?.relay_command === "remove-topics") return removeTopics();
      if (!update || !Number.isSafeInteger(update.update_id))
        return { status: 400, body: "no update_id" };
      const last = await store.get("tg:last-update");
      if (last !== undefined && update.update_id <= last) return OK;
      // The clean-up reads every held item: only an invited sender starts it, and at most once an hour.
      const from = (update.message ?? update.callback_query)?.from?.id;
      if (
        now() >= lastCleanUp + HOUR &&
        Number.isSafeInteger(from) &&
        (from === ownerTgId || (await store.get(`user:${from}`)))
      ) {
        // Counted once it has finished: a clean-up that fails part way runs again on the next message.
        await held.cleanUp();
        lastCleanUp = now();
      }
      let handled = false;
      if (update.message) handled = await onMessage(update.message, req.origin);
      else if (update.callback_query)
        handled = await onButton(update.callback_query);
      if (handled) await store.put("tg:last-update", update.update_id);
      return OK;
    }

    // Deletes each kept topic of each chat at Telegram, then its key; answers { removed: <topics deleted> }. A topic
    // the user already deleted counts as none; any other refusal stops the run with the key kept for a second run.
    async function removeTopics() {
      let removed = 0;
      for (const [key, kept] of await store.list("topics:")) {
        const chatId = Number(key.slice("topics:".length));
        for (const thread of [kept.inbox, kept.alerts, kept.files]) {
          if (!Number.isSafeInteger(thread)) continue;
          try {
            await telegram("deleteForumTopic", {
              chat_id: chatId,
              message_thread_id: thread,
            });
            removed += 1;
          } catch (e) {
            if (!/message thread not found/i.test(e.message)) throw e;
          }
        }
        await store.delete(key);
      }
      log(`topics removed: ${removed}`);
      return { status: 200, body: JSON.stringify({ removed }) };
    }

    // Returns true when the update came from an invited user (or redeemed an invite) and was handled.
    async function onMessage(msg, origin) {
      const from = msg.from?.id;
      if (
        !Number.isSafeInteger(from) ||
        msg.chat?.type !== "private" ||
        msg.chat.id !== from
      )
        return false;
      const text = typeof msg.text === "string" ? msg.text : null;
      const start = text && /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text);
      let user = await store.get(`user:${from}`);
      if (!user && from === ownerTgId) {
        user = { invitedAt: now(), firstName: firstName(msg), pcId: null };
        await store.put(`user:${from}`, user);
        log("owner record made");
      }
      if (!user) return start?.[1] ? redeem(msg, start[1], origin) : false;
      if (start) {
        await welcome(from, origin);
        return true;
      }
      const cmd =
        text &&
        /^\/(clear|invite|invites|people|remove)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(
          text,
        );
      if (cmd) {
        if (cmd[1] === "clear") {
          await clearAlerts(from, msg.message_id);
          return true;
        }
        if (from !== ownerTgId) return false;
        await ownerCommand(cmd[1], (cmd[2] || "").trim());
        return true;
      }
      // Telegram's own notes about topics are not the user's items.
      if (TOPIC_NOTES.some((k) => msg[k])) {
        if (msg.forum_topic_created?.is_name_implicit === true)
          await store.put(
            strayKey(from, msg.message_thread_id ?? msg.message_id),
            {
              at: now(),
            },
          );
        return true;
      }
      await nameStray(msg);
      await held.forward(msg, user);
      return true;
    }

    // A message sent outside the bot's topics makes Telegram open a topic it names itself ("New Chat"). Telegram
    // says so with a forum_topic_created note whose is_name_implicit is true, either as its own update (kept as
    // `stray:<chat>:<thread>`) or as the reply_to_message of the topic's first messages. The topic is renamed once,
    // after what its first item is; a refused rename is logged and the item still goes to the PC.
    async function nameStray(msg) {
      const thread = msg.message_thread_id;
      if (!Number.isSafeInteger(thread)) return;
      const key = strayKey(msg.chat.id, thread);
      const noted = await store.get(key);
      const implicit =
        msg.reply_to_message?.forum_topic_created?.is_name_implicit === true &&
        (await store.get(namedKey(msg.chat.id, thread))) === undefined;
      if (noted === undefined && !implicit) return;
      await store.delete(key);
      await store.put(namedKey(msg.chat.id, thread), { at: now() });
      try {
        await telegram("editForumTopic", {
          chat_id: msg.chat.id,
          message_thread_id: thread,
          name: strayName(msg),
        });
        log("stray topic named");
      } catch (e) {
        log(`stray topic name refused: ${e.message}`);
      }
    }

    async function redeem(msg, token, origin) {
      if (!INVITE_TOKEN.test(token)) return false;
      const key = `invite:${toHex(await sha256(token))}`;
      const invite = await store.get(key);
      if (!invite || now() >= invite.expiresAt) return false;
      await store.delete(key);
      const tgId = msg.from.id;
      await store.put(`user:${tgId}`, {
        invitedAt: now(),
        firstName: firstName(msg),
        pcId: null,
      });
      log("invite redeemed");
      await welcome(tgId, origin);
      return true;
    }

    // ---- /clear, for the owner and each invited person ----

    // Every alert the Hub keeps for this chat (`alert:<chat>:<handle>` -> { msg, at }) goes, and the command with
    // it; nothing is sent back. One older than 48 hours is only forgotten: Telegram no longer deletes it. Telegram
    // takes 1 to 100 ids a call; a call it refuses is logged and not tried again.
    async function clearAlerts(chatId, commandId) {
      if (!Number.isSafeInteger(commandId))
        throw new Error("bot: the /clear message has no message_id");
      const kept = await store.list(`alert:${chatId}:`);
      for (const [key] of kept) await store.delete(key);
      const ids = [
        ...kept
          .filter(([, v]) => now() < v.at + ALERT_LIFE)
          .map(([, v]) => v.msg),
        commandId,
      ];
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        try {
          await telegram("deleteMessages", {
            chat_id: chatId,
            message_ids: ids.slice(i, i + DELETE_BATCH),
          });
        } catch (e) {
          log(`clear refused: ${e.message}`);
        }
      }
      log(`alerts cleared: ${kept.length}`);
    }

    // ---- the owner's commands ----

    async function ownerCommand(name, arg) {
      if (name === "invite") return makeInvite();
      if (name === "invites") return listInvites();
      if (name === "people") return listPeople();
      const tgId = Number(arg);
      if (!/^\d{1,16}$/.test(arg) || !Number.isSafeInteger(tgId))
        return say(ownerTgId, "Usage: /remove <Telegram id>");
      return removeUser(tgId);
    }

    async function makeInvite() {
      const token = toB64u(randomBytes(24));
      const t = now();
      await store.put(`invite:${toHex(await sha256(token))}`, {
        createdAt: t,
        expiresAt: t + INVITE_LIFE,
      });
      log("invite made");
      await say(
        ownerTgId,
        `Invite link, good once and for 7 days. Send it by hand:\nhttps://t.me/${await botName()}?start=${token}`,
      );
    }

    async function listInvites() {
      const invites = (await store.list("invite:")).filter(
        ([, v]) => now() < v.expiresAt,
      );
      if (!invites.length) return say(ownerTgId, "No open invites.");
      const lines = invites.map(
        ([, v], i) =>
          `${i + 1}. made ${day(v.createdAt)}, ends ${day(v.expiresAt)}`,
      );
      return say(ownerTgId, `Open invites:\n${lines.join("\n")}`, {
        reply_markup: {
          inline_keyboard: invites.map(([key], i) => [
            {
              text: `Cancel ${i + 1}`,
              callback_data: `cancel:${key.slice(7, 39)}`,
            },
          ]),
        },
      });
    }

    async function listPeople() {
      const users = await store.list("user:");
      if (!users.length) return say(ownerTgId, "No one is invited yet.");
      const lines = [];
      for (const [key, u] of users) {
        const pc = u.pcId ? await store.get(`pc:${u.pcId}`) : null;
        const seen = pc ? `PC paired, last seen ${day(pc.lastSeen)}` : "no PC";
        lines.push(`${u.firstName || "(no name)"} (${key.slice(5)}): ${seen}`);
      }
      const others = users.filter(([key]) => key !== `user:${ownerTgId}`);
      return say(ownerTgId, `Invited:\n${lines.join("\n")}`, {
        reply_markup: {
          inline_keyboard: others.map(([key, u]) => [
            {
              text: `Remove ${(u.firstName || key.slice(5)).slice(0, 30)}`,
              callback_data: `rm:${key.slice(5)}`,
            },
          ]),
        },
      });
    }

    // Section 3: the user record, the PC's record, held items and file keys go; sockets close; the chat's menu
    // button goes back to the default.
    async function removeUser(tgId) {
      if (tgId === ownerTgId)
        return say(ownerTgId, "The owner cannot be removed.");
      const user = await store.get(`user:${tgId}`);
      if (!user) return say(ownerTgId, `No invited user ${tgId}.`);
      await store.delete(`user:${tgId}`);
      if (user.pcId) await held.dropPc(user.pcId);
      ctx.closeUser(tgId, CLOSE_REMOVED, "removed");
      await telegram("setChatMenuButton", {
        chat_id: tgId,
        menu_button: { type: "default" },
      });
      log("user removed");
      await say(ownerTgId, `Removed ${user.firstName || "user"} (${tgId}).`);
    }

    // ---- buttons ----

    async function onButton(cb) {
      const owner = cb.from?.id === ownerTgId && typeof cb.data === "string";
      if (owner && (forward || badUrl) && cb.data.startsWith(FORWARD_PREFIX))
        return forwardButton(cb);
      if (typeof cb.id === "string")
        await telegram("answerCallbackQuery", { callback_query_id: cb.id });
      if (!owner) return false;
      const rm = /^rm:(\d{1,16})$/.exec(cb.data);
      if (rm) {
        await removeUser(Number(rm[1]));
        return true;
      }
      const cancel = /^cancel:([0-9a-f]{32})$/.exec(cb.data);
      if (cancel) {
        const found = (await store.list(`invite:${cancel[1]}`))[0];
        if (!found) await say(ownerTgId, "That invite is already gone.");
        else {
          await store.delete(found[0]);
          log("invite cancelled");
          await say(ownerTgId, "Invite cancelled.");
        }
        return true;
      }
      return false;
    }

    // Sends the owner's `x:` press on (see the top of this file) and leaves its answer to the receiver. A receiver
    // that is not reached in time or does not answer 2xx gets the press answered with a short text here; the update
    // still counts as handled, so Telegram does not send it again. The log never holds the secret.
    async function forwardButton(cb) {
      if (!forward) {
        // Set but not an https address: the owner is told, since the press does nothing.
        if (typeof cb.id === "string")
          await telegram("answerCallbackQuery", {
            callback_query_id: cb.id,
            text: FORWARD_BAD_URL,
          }).catch((e) => log(`button forward answer refused: ${e.message}`));
        return true;
      }
      let problem = null;
      let text = FORWARD_FAILED;
      try {
        const res = await forward.fetch(forward.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Button-Secret": forward.secret,
          },
          body: JSON.stringify({
            data: cb.data,
            callbackId: cb.id,
            chatId: cb.message?.chat?.id ?? null,
            messageId: cb.message?.message_id ?? null,
            threadId: cb.message?.message_thread_id ?? null,
            inlineMessageId: cb.inline_message_id ?? null,
          }),
          signal: AbortSignal.timeout(FORWARD_TIMEOUT),
        });
        Promise.resolve(res.body?.cancel?.()).catch(() => {});
        if (!res.ok) problem = `status ${res.status}`;
      } catch (e) {
        // A fixed category, never e.message: it can quote the address.
        if (e.name === "TimeoutError") {
          problem = `no answer in ${FORWARD_TIMEOUT / 1000} s`;
          text = FORWARD_SLOW; // it may have acted: a second press could repeat it
        } else problem = "unreachable";
      }
      if (!problem) return true;
      log(`button forward failed: ${problem}`);
      if (typeof cb.id === "string") {
        try {
          await telegram("answerCallbackQuery", {
            callback_query_id: cb.id,
            text,
          });
        } catch (e) {
          log(`button forward answer refused: ${e.message}`);
        }
      }
      return true;
    }

    return {
      webhook,
      pcConnected: held.pcConnected,
      pcFrame: held.pcFrame,
    };
  };
}

const firstName = (msg) => String(msg.from.first_name || "").slice(0, 64);

// Telegram's service notes about topics in a private chat with topics on.
const TOPIC_NOTES = [
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "general_forum_topic_hidden",
  "general_forum_topic_unhidden",
];
const strayKey = (chatId, thread) => `stray:${chatId}:${thread}`;
const namedKey = (chatId, thread) => `named:${chatId}:${thread}`;
const NAME_MAX = 40;

// A stray topic's name after what the message holds: "Photo", a file's name, "Link: example.com", or the text's
// first words; at most NAME_MAX characters.
export function strayName(msg) {
  const cut = (s) => {
    const one = s.replace(/\s+/g, " ").trim();
    return one.length > NAME_MAX ? `${one.slice(0, NAME_MAX - 1)}…` : one;
  };
  if (msg.photo) return "Photo";
  if (msg.video) return "Video";
  if (msg.animation) return "GIF";
  if (msg.voice) return "Voice note";
  if (msg.video_note) return "Video note";
  if (msg.sticker) return "Sticker";
  if (msg.audio)
    return cut(msg.audio.title || msg.audio.file_name || "") || "Audio";
  if (msg.document) return cut(msg.document.file_name || "") || "File";
  const text = typeof msg.text === "string" ? msg.text : msg.caption || "";
  const url = /https?:\/\/([^\s/?#]+)/i.exec(text);
  if (url) return cut(`Link: ${url[1].replace(/^www\./i, "")}`);
  return cut(text) || "Note";
}

// Compares two texts in a time that does not depend on where they differ.
function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
