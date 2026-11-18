// The bot the Hub runs (pipe design, sections 3, 5 and 7): the webhook with its secret header, the owner's invite
// commands, redeeming an invite, the per-chat Open button, and forwards held sealed for the PC (held.mjs).
// Alert sending and deleting is the Hub's own (hub.mjs, pcAlert); /clear deletes the alerts the Hub keeps. A stranger gets no answer and nothing is stored about him:
// a reply would tell him the bot is alive.
//   makeBot({ webhookSecret }) -> the Hub's `bot` option: (ctx) -> { webhook, pcConnected, pcFrame }.
// webhook({ headers, body, origin }) needs `origin`, the relay's own address, for the Open button and the join line.
// The body `{ "relay_command": "remove-topics" }` with the webhook secret (deploy-test.mjs --remove-topics) deletes
// every kept topic at Telegram and forgets the `topics:<chat>` keys (files contract, section 7).
import { randomBytes, sha256, toB64u, toHex } from "../../shared/seal.mjs";
import { createHeld } from "./held.mjs";

const DAY = 24 * 60 * 60_000;
const INVITE_LIFE = 7 * DAY;
const ALERT_LIFE = 2 * DAY;
const DELETE_BATCH = 100;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{32}$/;
const SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const ORIGIN = /^https?:\/\/[^/]+$/;
const OK = { status: 200, body: "ok" };
const CLOSE_REMOVED = 4403;

const WARNING =
  "Before you join: the app page comes from the owner's relay. Whoever controls that relay can make your PC do " +
  "anything this app can do, and that includes running commands through a Claude session. Your PC checks the " +
  "page and goes read-only when it changes, but it cannot catch every change. Join only if you trust the owner.";

export function makeBot({ webhookSecret }) {
  if (typeof webhookSecret !== "string" || !SECRET.test(webhookSecret))
    throw new Error(
      "bot: the webhook secret must be 32 to 256 characters of A-Z a-z 0-9 _ -",
    );

  return (ctx) => {
    for (const name of ["store", "telegram", "now", "log", "ownerTgId"]) {
      if (ctx[name] === undefined) throw new Error(`bot: ctx has no ${name}`);
    }
    const { store, telegram, now, log, ownerTgId } = ctx;
    const held = createHeld(ctx);
    let username = null;

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
      await held.cleanUp();
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
        for (const thread of [kept.alerts, kept.files]) {
          if (thread === null) continue;
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
      await held.forward(msg, user);
      return true;
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
      if (typeof cb.id === "string")
        await telegram("answerCallbackQuery", { callback_query_id: cb.id });
      if (cb.from?.id !== ownerTgId || typeof cb.data !== "string")
        return false;
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

    return {
      webhook,
      pcConnected: held.pcConnected,
      pcFrame: held.pcFrame,
    };
  };
}

const firstName = (msg) => String(msg.from.first_name || "").slice(0, 64);

// Compares two texts in a time that does not depend on where they differ.
function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
