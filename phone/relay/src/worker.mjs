// The relay on Cloudflare: wiring only, all rules are in hub.mjs. The page files are Workers static assets and
// never reach this code; `/ws`, `/tg/hook` and the file routes (`/pc/send`, `/pc/dl/<link>`, `/dl/<token>`) go to
// the one Hub object. Needs the binding HUB (this file's Hub
// class, SQLite-backed) and the secrets BOT_TOKEN, BOT_ID, OWNER_TG_ID and WEBHOOK_SECRET.
import { DurableObject } from "cloudflare:workers";
import { makeBot } from "../bot/bot.mjs";
import { telegramApi } from "../bot/telegram.mjs";
import { createHub, PING, PONG } from "./hub.mjs";

// Telegram's production key for checking initData (Mini Apps, "Validating data for Third-Party Use").
const TELEGRAM_KEY =
  "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";

function secret(env, name) {
  if (!env[name]) throw new Error(`relay: the secret ${name} is not set`);
  return env[name];
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const api = telegramApi({
      token: secret(env, "BOT_TOKEN"),
      fetch: (url, init) => fetch(url, init),
    });
    const kv = ctx.storage.kv;
    this.hub = createHub({
      store: {
        get: (key) => kv.get(key),
        put: (key, value) => kv.put(key, value),
        delete: (key) => kv.delete(key),
        list: (prefix) => [...kv.list({ prefix })],
      },
      sockets: {
        accept: (ws) => ctx.acceptWebSocket(ws),
        all: () => ctx.getWebSockets(),
        attachment: (ws) => ws.deserializeAttachment(),
        setAttachment: (ws, value) => ws.serializeAttachment(value),
        send: (ws, text) => ws.send(text),
        close: (ws, code, reason) => ws.close(code, reason),
        // The time of the last PING the auto-response below answered; null when the socket never pinged.
        lastPing: (ws) => ctx.getWebSocketAutoResponseTimestamp(ws),
      },
      telegram: api.telegram,
      upload: api.upload,
      fixedStream: (length) => new FixedLengthStream(length),
      download: api.download,
      now: Date.now,
      log: (line) => console.log(line),
      botId: Number(secret(env, "BOT_ID")),
      ownerTgId: Number(secret(env, "OWNER_TG_ID")),
      telegramKey: TELEGRAM_KEY,
      // Set only on the test copy (deploy-test.mjs): " (test)" after the topic names.
      topicSuffix: env.TOPIC_SUFFIX ?? "",
      bot: makeBot({ webhookSecret: secret(env, "WEBHOOK_SECRET") }),
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("WebSocket only", { status: 426 });
      const [client, server] = Object.values(new WebSocketPair());
      await this.hub.open(server, { origin: url.origin });
      return new Response(null, { status: 101, webSocket: client });
    }
    // The file routes keep their bodies as streams: a file passes through, never held whole.
    const fileCall = {
      headers: Object.fromEntries(request.headers),
      body: request.body,
    };
    let r = null;
    if (url.pathname === "/pc/send") r = await this.hub.pcSend(fileCall);
    else if (url.pathname.startsWith("/pc/dl/"))
      r = await this.hub.pcDl(url.pathname.slice(7), fileCall);
    else if (url.pathname.startsWith("/dl/"))
      r = await this.hub.download(url.pathname.slice(4), request.method);
    if (r)
      return new Response(r.body, { status: r.status, headers: r.headers });
    const hook = await this.hub.webhook({
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
      origin: url.origin,
    });
    return new Response(hook.body, { status: hook.status });
  }

  webSocketMessage(ws, message) {
    return this.hub.message(ws, typeof message === "string" ? message : null);
  }

  webSocketClose(ws) {
    return this.hub.closed(ws);
  }
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    const { method } = request;
    const hookCall = pathname === "/tg/hook" && method === "POST";
    const pcFile =
      (pathname === "/pc/send" || pathname.startsWith("/pc/dl/")) &&
      method === "POST";
    const download =
      pathname.startsWith("/dl/") && (method === "GET" || method === "HEAD");
    if (pathname !== "/ws" && !hookCall && !pcFile && !download)
      return new Response("not found", { status: 404 });
    return env.HUB.get(env.HUB.idFromName("hub")).fetch(request);
  },
};
