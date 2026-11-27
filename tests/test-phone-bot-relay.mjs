// Tests the relay's bot (phone/relay/bot) and the PC's intake of held forwards (skills/phone-bot/pc/actions/
// saved.mjs) together: the local relay runs the Hub with the bot, Telegram is a stand-in fetch (nothing reaches
// the network), and the PC side is the real PC link with keys in a temp home, saving into that home's
// phone-inbox. Checks: pipe design section 5, row B5.   node tests/test-phone-bot-relay.mjs
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The PC code reads its home and test mode when loaded, so both are set before the imports below.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "phone-bot-relay-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PHONE_PC_TEST = "1";

const at = (p) => new URL(`../${p}`, import.meta.url).href;
const { startLocalRelay } = await import(at("phone/relay/local/server.mjs"));
const { makeBot } = await import(at("phone/relay/bot/bot.mjs"));
const { telegramApi } = await import(at("phone/relay/bot/telegram.mjs"));
const { toB64u } = await import(at("phone/shared/seal.mjs"));
const { createKeys, saveKeys } = await import(
  at("skills/phone-bot/pc/core/keys.mjs")
);
const { openLink } = await import(at("skills/phone-bot/pc/core/link.mjs"));
const { createRegistry } = await import(
  at("skills/phone-bot/pc/core/registry.mjs")
);
const saved = await import(at("skills/phone-bot/pc/actions/saved.mjs"));

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
}
const same = (name, got, want) =>
  check(
    name,
    JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );

const random = (n) => new Uint8Array(randomBytes(n));
const BOT_ID = 4242;
const BOT_TOKEN = `${BOT_ID}:${toB64u(random(24))}`;
const OWNER = 1001;
const FRIEND = 2002;
const THIRD = 3003;
const STRANGER = 9009;
const DAY = 24 * 60 * 60_000;
// Words that travel only sealed: the relay's store and log must never hold them.
const MARKER = `plain-marker-${toB64u(random(9))}`;
const LINK = `https://example.com/${toB64u(random(6))}`;
const DOC_NAME = `notes-${toB64u(random(4))}.txt`;

let clock = Date.UTC(2026, 10, 14, 12, 0, 0);
const logLines = [];

// ---- Telegram, as a stand-in fetch ----

const calls = [];
const fileBytes = new Map();
let refuse = null;
let sentId = 900;
async function telegramFetch(url, init) {
  const u = String(url);
  if (!u.startsWith("https://api.telegram.org/"))
    throw new Error(`test fetch: not a Telegram address: ${u}`);
  const file = /\/file\/bot[^/]+\/files\/(.+)$/.exec(u);
  if (file) {
    const bytes = fileBytes.get(file[1]);
    calls.push({ method: "download", params: { fileId: file[1] } });
    return {
      ok: Boolean(bytes),
      status: bytes ? 200 : 404,
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }
  const method = u.split("/").pop();
  const params = JSON.parse(init.body);
  calls.push({ method, params });
  // Like Telegram: a sent message has an id; the method named in `refuse` fails.
  if (method === refuse)
    return {
      json: async () => ({
        ok: false,
        description: "Bad Request: message can't be deleted",
      }),
    };
  const result =
    method === "getMe"
      ? { username: "example_bot" }
      : method === "getFile"
        ? { file_path: `files/${params.file_id}` }
        : method === "sendMessage"
          ? { message_id: ++sentId }
          : true;
  return { json: async () => ({ ok: true, result }) };
}
const api = telegramApi({
  token: BOT_TOKEN,
  fetch: telegramFetch,
});
const take = () => calls.splice(0);

// ---- the relay ----

const SECRET = toB64u(random(36));
const tgKey = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);
const pageDir = path.join(home, "page");
fs.mkdirSync(pageDir);
fs.writeFileSync(
  path.join(pageDir, "index.html"),
  "<!doctype html><p>page</p>",
);
// Sockets the relay has seen end (its test hook), so pcOff() waits for that and not a fixed time.
let socketsEnded = 0;
const relay = await startLocalRelay({
  countFrame: (_url, way) => {
    if (way === "end") socketsEnded += 1;
  },
  port: 0,
  pageDir,
  botId: BOT_ID,
  botToken: BOT_TOKEN,
  ownerTgId: OWNER,
  telegramKey: Buffer.from(
    await crypto.subtle.exportKey("raw", tgKey.publicKey),
  ).toString("hex"),
  telegram: api.telegram,
  download: api.download,
  now: () => clock,
  log: (line) => logLines.push(line),
  bot: makeBot({ webhookSecret: SECRET }),
});
const dump = () => JSON.stringify([...relay.map]);
const keysOf = (prefix) =>
  [...relay.map.keys()].filter((k) => k.startsWith(prefix));
// The store without the Hub's daily request count, which every request moves.
const kept = () =>
  JSON.stringify([...relay.map].filter(([k]) => !k.startsWith("day:")));

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(what, test, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await pause(25);
  }
  check(`in time: ${what}`, false, "timed out");
  return false;
}

let updateId = 100;
let messageId = 500;
async function hook(update, secret = SECRET) {
  const headers = { "Content-Type": "application/json" };
  if (secret !== null) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  const res = await fetch(`${relay.url}/tg/hook`, {
    method: "POST",
    headers,
    body: JSON.stringify({ update_id: ++updateId, ...update }),
  });
  await relay.idle();
  return res.status;
}
const message = (from, fields) => ({
  message: {
    message_id: ++messageId,
    date: Math.floor(clock / 1000),
    from: { id: from, is_bot: false, first_name: "Tester" },
    chat: { id: from, type: "private" },
    ...fields,
  },
});
const say = (from, text) => hook(message(from, { text }));
const sent = (list, chatId) =>
  list.filter((c) => c.method === "sendMessage" && c.params.chat_id === chatId);

// ---- the PC: the real link and intake, keys and inbox in the temp home ----

const inbox = path.join(home, "phone-inbox");
const keys = await createKeys(relay.url);
let ready = 0;
const intake = saved.createIntake({
  keys,
  send: (o) => link.send(o),
  dir: inbox,
  albumWaitMs: 150,
});
const link = openLink({
  keys,
  version: "26.3",
  saveKeys,
  onReady: () => {
    ready += 1;
  },
  onFrame: (f) => {
    if (f.t === "held" || f.t === "file") intake.onFrame(f);
  },
});
const registry = createRegistry();
saved.register(registry);
async function savedItems() {
  const r = await registry.handle(
    { k: "req", id: "r1", a: "saved.list", d: { page: 1 } },
    { page: "ok" },
  );
  if (!r.ok) throw new Error(`saved.list answered ${JSON.stringify(r)}`);
  return r.d.items;
}
const indexCount = () =>
  fs.existsSync(path.join(inbox, "index.md"))
    ? fs
        .readFileSync(path.join(inbox, "index.md"), "utf8")
        .split("\n")
        .filter(Boolean).length
    : 0;
async function pcOff() {
  const before = socketsEnded;
  link.stop();
  await until("the PC socket closes", () => !link.send({ t: "ping" }));
  await until("the relay sees the PC socket end", () => socketsEnded > before);
  await relay.idle();
}
async function pcOn() {
  const before = ready;
  link.start();
  await until("the relay accepts the PC", () => ready > before);
}

// ---- the webhook secret (section 3) ----

const empty = kept();
same(
  "a wrong webhook secret is refused",
  await hook(message(OWNER, { text: "/invite" }), "x"),
  401,
);
check(
  "a wrong secret is refused before anything is read",
  (await hook(message(OWNER, { text: "/invite" }), toB64u(random(36)))) ===
    401 &&
    (await hook(message(OWNER, { text: "/invite" }), null)) === 401 &&
    take().length === 0 &&
    kept() === empty,
);

// ---- a stranger (section 3) ----

same("a stranger's message is answered 200", await say(STRANGER, "hello"), 200);
await say(STRANGER, `/start ${toB64u(random(24))}`);
await say(STRANGER, "/invite");
await hook(message(STRANGER, { photo: [{ file_id: "S1", file_size: 10 }] }));
same("a stranger gets no answer from the bot", take(), []);
check("nothing is stored for a stranger", kept() === empty, kept());

// ---- the owner's invite and redeeming it (sections 5 and 7) ----

await say(OWNER, "/invite");
let out = take();
const inviteText = sent(out, OWNER)[0]?.params.text || "";
const token = /\?start=([A-Za-z0-9_-]+)/.exec(inviteText)?.[1];
check(
  "/invite answers the owner with a one-time link",
  token?.length === 32 &&
    inviteText.includes("https://t.me/example_bot?start="),
  inviteText,
);
check(
  "only the invite's hash is stored",
  keysOf("invite:").length === 1 && !dump().includes(token),
);

await say(FRIEND, "/invite");
same("/invite from someone else is ignored", take(), []);
check("and makes no invite", keysOf("invite:").length === 1);

await say(FRIEND, `/start ${token}`);
out = take();
const button = out.find((c) => c.method === "setChatMenuButton");
check(
  "redeeming sets that chat's Open button to the relay's page",
  button?.params.chat_id === FRIEND &&
    button.params.menu_button.type === "web_app" &&
    button.params.menu_button.web_app.url === `${relay.url}/`,
  JSON.stringify(button),
);
const join = sent(out, FRIEND)[0]?.params.text || "";
check(
  "the join message warns first, then gives the line to paste: install the phone add-on, then join",
  join.startsWith("Before you join") &&
    join.includes("install.mjs --with phone-bot") &&
    join.endsWith(`then join the phone app at ${relay.url}`),
  join,
);
check(
  "the invite is used up and the user is listed",
  keysOf("invite:").length === 0 && relay.map.has(`user:${FRIEND}`),
);
await say(THIRD, `/start ${token}`);
same("a used invite gets no answer", take(), []);
check("and invites no one", !relay.map.has(`user:${THIRD}`));

await say(FRIEND, "before pairing");
same(
  "an invited user without a paired PC is told to pair first",
  sent(take(), FRIEND).map((c) => c.params.text),
  ["Not saved: pair your PC first"],
);
check("and nothing is held", keysOf("held:").length === 0);

// ---- the PC joins and pairs (pairing itself is the relay test's; here the records are set as it leaves them) ----

await pcOn();
const pc = relay.map.get(`pc:${keys.pcId}`);
relay.map.set(`pc:${keys.pcId}`, { ...pc, tgId: FRIEND });
relay.map.set(`user:${FRIEND}`, {
  ...relay.map.get(`user:${FRIEND}`),
  pcId: keys.pcId,
});
await pcOff();

// ---- forwards while the PC is off: held sealed, saved at the next connect (section 5) ----

const docBytes = random(300_000); // two file pieces
fileBytes.set("DOC1", docBytes);
for (const id of ["P1", "P2", "P3"]) fileBytes.set(id, random(2_000));
take();
await say(FRIEND, `Remember ${MARKER}`);
await say(FRIEND, LINK);
await hook(
  message(FRIEND, {
    document: {
      file_id: "DOC1",
      file_name: DOC_NAME,
      file_size: docBytes.length,
    },
    caption: `about ${MARKER}`,
  }),
);
for (const id of ["P1", "P2", "P3"])
  await hook(
    message(FRIEND, {
      media_group_id: "G1",
      photo: [
        { file_id: `${id}small`, file_size: 100 },
        { file_id: id, file_size: 2_000 },
      ],
      ...(id === "P1" ? { caption: "three photos" } : {}),
    }),
  );
await hook(
  message(FRIEND, {
    video: {
      file_id: "BIG1",
      file_name: "long.mp4",
      file_size: 25 * 1024 * 1024,
    },
  }),
);
out = take();
same(
  "each good forward gets a thumbs-up and nothing else",
  out.filter((c) => c.method === "setMessageReaction").length,
  6,
);
same(
  "a file over 20 MB is answered that it stays in the chat",
  sent(out, FRIEND).map((c) => c.params.text),
  [
    "Saved as a note. The file is over 20 MB, so it stays here; open it from this chat.",
  ],
);
same("7 forwards are held", keysOf(`held:${keys.pcId}:`).length, 7);
same(
  "files of at most 20 MB may be fetched later",
  keysOf(`file:${keys.pcId}:`)
    .map((k) => k.split(":")[2])
    .sort(),
  ["DOC1", "P1", "P2", "P3"],
);
for (const [what, text] of [
  ["the marker words", MARKER],
  ["the link", LINK],
  ["the file name", DOC_NAME],
  ["the album caption", "three photos"],
]) {
  check(`the relay's store holds no plain ${what}`, !dump().includes(text));
  check(
    `the relay's log holds no plain ${what}`,
    !logLines.join("\n").includes(text),
  );
}

await pcOn();
await until(
  "the held forwards are saved and acknowledged",
  () => indexCount() === 5 && keysOf("held:").length === 0,
);
let items = await savedItems();
same(
  "the PC saved them as 5 items (an album line is written when the album closes)",
  items.map((i) => i.kind).sort(),
  ["album (3)", "file", "link", "text", "video, too big"],
);
const album = items.find((i) => i.kind === "album (3)");
check(
  "an album is one item with its three photos and its caption",
  album?.name.split(", ").length === 3 && album.caption === "three photos",
  JSON.stringify(album),
);
check(
  "every album photo is on disk",
  album?.name
    .split(", ")
    .every((n) => fs.statSync(path.join(inbox, n)).size === 2_000),
);
const doc = items.find((i) => i.kind === "file");
check(
  "a file arrives whole from its pieces under its own name",
  doc?.name.endsWith(DOC_NAME) &&
    Buffer.compare(
      fs.readFileSync(path.join(inbox, doc.name)),
      Buffer.from(docBytes),
    ) === 0,
  JSON.stringify(doc),
);
same("its caption is kept", doc?.caption, `about ${MARKER}`);
const link1 = items.find((i) => i.kind === "link");
check(
  "a link is kept as a link",
  link1?.caption === LINK &&
    fs.readFileSync(path.join(inbox, link1.name), "utf8").trim() === LINK,
  JSON.stringify(link1),
);
const text1 = items.find((i) => i.kind === "text");
check(
  "the text opened on the PC is the text sent",
  fs.readFileSync(path.join(inbox, text1.name), "utf8").includes(MARKER),
);
check(
  "the big file's item says it stays in the chat",
  fs
    .readFileSync(
      path.join(inbox, items.find((i) => i.kind === "video, too big").name),
      "utf8",
    )
    .includes(
      "Too big for the bot (over 20 MB); it stays in the Telegram chat",
    ),
);
same("fetched files leave no file key", keysOf("file:").length, 0);
check(
  "the big file was never fetched",
  !take().some((c) => c.method === "getFile" && c.params.file_id === "BIG1"),
);

// ---- a batch of 15 while the PC is on ----

for (let i = 0; i < 15; i++) {
  if (i % 5 === 4) {
    fileBytes.set(`B${i}`, random(500));
    await hook(
      message(FRIEND, {
        document: { file_id: `B${i}`, file_name: `b${i}.bin`, file_size: 500 },
      }),
    );
  } else await say(FRIEND, `batch item ${i}`);
}
await until(
  "the batch is saved and acknowledged",
  () => indexCount() === 20 && keysOf("held:").length === 0,
);
items = await savedItems();
same("a 15-item batch gives 15 saved items", items.length - 5, 15);
same(
  "in the order sent",
  items
    .slice(0, 15)
    .reverse()
    .map((i) => (i.kind === "file" ? i.name.split("_").pop() : i.caption)),
  Array.from({ length: 15 }, (_, i) =>
    i % 5 === 4 ? `b${i}.bin` : `batch item ${i}`,
  ),
);

// ---- files whose names the file rules refuse: saved under a neutral name and acknowledged ----

for (const [id, name] of [
  ["T1", "api-token.txt"],
  ["K1", "server.pem"],
]) {
  fileBytes.set(id, random(400));
  await hook(
    message(FRIEND, {
      document: { file_id: id, file_name: name, file_size: 400 },
    }),
  );
}
await until(
  "the refused names are saved and acknowledged",
  () => indexCount() === 22 && keysOf("held:").length === 0,
);
items = await savedItems();
const neutral = items.slice(0, 2).reverse();
check(
  "a file whose name the rules refuse is saved under a neutral name that says where it came from",
  neutral.every(
    (i, n) =>
      i.kind === "file" &&
      /_document(_\d+)?$/.test(i.name) &&
      fs.statSync(path.join(inbox, i.name)).size === 400 &&
      i.caption === `sent as ${["api-token.txt", "server.pem"][n]}`,
  ),
  JSON.stringify(neutral),
);

// ---- a Telegram service message (a new thread in the bot chat): acknowledged, nothing saved ----

const filesBefore = fs.readdirSync(inbox).sort();
await hook(
  message(FRIEND, {
    message_thread_id: 7,
    is_topic_message: true,
    forum_topic_created: { name: "New thread", icon_color: 7322096 },
  }),
);
same(
  "a topic-made service note is not held for the PC (FAIL: Telegram's thread notes reach the inbox as items)",
  keysOf("held:").length,
  0,
);
await until(
  "the service message is acknowledged",
  () => keysOf("held:").length === 0,
);
check(
  "a held forum_topic_created service message writes no file and no index line",
  indexCount() === 22 &&
    JSON.stringify(fs.readdirSync(inbox).sort()) ===
      JSON.stringify(filesBefore),
  JSON.stringify(fs.readdirSync(inbox).filter((f) => !filesBefore.includes(f))),
);

// ---- an alert with the silent flag as asked (the Hub sends it; section 5) ----

take();
for (const silent of [true, false]) {
  link.send({
    v: 1,
    t: "alert",
    text: "my-project · Release notes draft: handed off, continuing",
    silent,
    open: "h1",
  });
  await until("the alert is sent", () => calls.length > 0);
  await relay.idle();
  const alerts = take();
  check(
    `an alert call sends one message${silent ? " with" : " without"} the silent flag`,
    alerts.length === 1 &&
      alerts[0].method === "sendMessage" &&
      alerts[0].params.chat_id === FRIEND &&
      alerts[0].params.text ===
        "my-project · Release notes draft: handed off, continuing" &&
      alerts[0].params.disable_notification === silent &&
      alerts[0].params.reply_markup.inline_keyboard[0][0].web_app.url ===
        `${relay.url}/?o=h1`,
    JSON.stringify(alerts),
  );
}

// ---- one alert per session: the PC removes the old one before the next, so the chat keeps one ----

const msgOf = (key) => relay.map.get(key)?.msg;
link.send({
  v: 1,
  t: "alert",
  text: "demo: needs you",
  silent: false,
  open: "h7",
});
await until("the first alert is kept", () =>
  relay.map.has(`alert:${FRIEND}:h7`),
);
const first = msgOf(`alert:${FRIEND}:h7`);
take();
link.send({ v: 1, t: "alert-done", open: "h7" });
link.send({
  v: 1,
  t: "alert",
  text: "demo: needs you",
  silent: false,
  open: "h8",
});
await until("the second alert is kept", () =>
  relay.map.has(`alert:${FRIEND}:h8`),
);
await relay.idle();
same(
  "a session that needs you twice leaves one alert in the chat",
  [
    take().map((c) => [
      c.method,
      c.params.chat_id,
      c.params.message_id ?? null,
    ]),
    keysOf(`alert:${FRIEND}:`).filter((k) => /:h[78]$/.test(k)),
  ],
  [
    [
      ["deleteMessage", FRIEND, first],
      ["sendMessage", FRIEND, null],
    ],
    [`alert:${FRIEND}:h8`],
  ],
);

// ---- /clear: each person's own chat, the command too, nothing sent back ----

relay.map.set(`alert:${OWNER}:o1`, { msg: 77, at: clock });
const friendIds = keysOf(`alert:${FRIEND}:`).map(msgOf);
await say(FRIEND, "/clear");
same(
  "an invited person's /clear deletes that chat's alerts and the command, and sends nothing",
  [take(), keysOf(`alert:${FRIEND}:`)],
  [
    [
      {
        method: "deleteMessages",
        params: { chat_id: FRIEND, message_ids: [...friendIds, messageId] },
      },
    ],
    [],
  ],
);
check(
  "and leaves the owner's alerts",
  msgOf(`alert:${OWNER}:o1`) === 77,
  keysOf("alert:").join(", "),
);
await say(OWNER, "/clear");
same(
  "the owner's /clear deletes every alert the relay keeps for his chat and the command",
  [take(), keysOf("alert:")],
  [
    [
      {
        method: "deleteMessages",
        params: { chat_id: OWNER, message_ids: [77, messageId] },
      },
    ],
    [],
  ],
);
relay.map.set(`alert:${FRIEND}:h9`, { msg: 99, at: clock });
refuse = "deleteMessages";
await say(FRIEND, "/clear");
refuse = null;
same(
  "a /clear Telegram refuses is tried once, logged, and the list is empty",
  [
    take().map((c) => c.method),
    keysOf("alert:"),
    logLines.filter((l) => l.startsWith("clear refused")).length,
  ],
  [["deleteMessages"], [], 1],
);

// ---- held items older than 30 days are cleaned (section 5) ----

await pcOff();
fileBytes.set("OLD1", random(100));
await hook(
  message(FRIEND, {
    document: { file_id: "OLD1", file_name: "old.bin", file_size: 100 },
  }),
);
check(
  "a forward to an absent PC is held with its file key",
  keysOf("held:").length === 1 && keysOf("file:").length === 1,
);
take();
const heldPc = keysOf("held:")[0].split(":").slice(0, 2).join(":");
clock += 29 * DAY;
await say(OWNER, "/invites");
check("after 29 days it is still held", keysOf("held:").length === 1);
clock += 2 * DAY;
await say(STRANGER, "hello");
check(
  "a stranger's message starts no clean-up (FAIL: a stranger makes the relay read every held item)",
  keysOf("held:").length === 1 && keysOf("file:").length === 1,
);
await say(OWNER, "/invites");
check(
  "after 30 days the held item and its file key are deleted",
  keysOf("held:").length === 0 && keysOf("file:").length === 0,
);
same(
  "the user's chat gets one line saying so",
  sent(take(), FRIEND).map((c) => c.params.text),
  ["1 saved item waited over 30 days for your PC and was deleted."],
);
// An old item put straight in the store: the next clean-up comes an hour after the last one.
const planted = `${heldPc}:${clock - 31 * DAY}:000000000001`;
relay.map.set(planted, "x");
clock += 30 * 60_000;
await say(OWNER, "/invites");
check(
  "the clean-up runs at most once an hour (FAIL: every message makes the relay read every held item)",
  keysOf("held:").includes(planted),
  keysOf("held:"),
);
relay.map.delete(planted);
// A clean-up that fails part way does not count: the next message an hour after the last finished one tries again.
clock += 31 * 60_000;
relay.map.set("file:0-unreadable", null);
relay.map.set("file:zz-expired", { expiresAt: clock - 1 });
const failedStatus = await say(OWNER, "/invites");
relay.map.delete("file:0-unreadable");
clock += 60_000;
await say(OWNER, "/invites");
check(
  "a clean-up that failed runs again on the next message, not an hour later (FAIL: one failed clean-up leaves expired items for an hour more)",
  failedStatus !== 200 && !relay.map.has("file:zz-expired"),
  { failedStatus, files: keysOf("file:") },
);
relay.map.delete("file:zz-expired");
take();
await pcOn();
await pause(300);
same("the PC gets nothing more to save", indexCount(), 22);

// ---- the owner's list and removing a person (sections 3 and 5) ----

await say(OWNER, "/people");
out = take();
const people = sent(out, OWNER)[0]?.params;
check(
  "/people lists the friend with a Remove button",
  people?.text.includes(`(${FRIEND}): PC paired`) &&
    people.reply_markup.inline_keyboard[0][0].callback_data === `rm:${FRIEND}`,
  JSON.stringify(people),
);
await hook({
  callback_query: { id: "cb1", from: { id: STRANGER }, data: `rm:${FRIEND}` },
});
same(
  "a stranger's button tap gets only an empty answer",
  take().map((c) => c.method),
  ["answerCallbackQuery"],
);
check("and removes no one", relay.map.has(`user:${FRIEND}`));
await hook({
  callback_query: { id: "cb2", from: { id: OWNER }, data: `rm:${FRIEND}` },
});
out = take();
check(
  "the owner's Remove deletes the user and the PC record",
  !relay.map.has(`user:${FRIEND}`) && !relay.map.has(`pc:${keys.pcId}`),
);
check(
  "and puts that chat's menu button back to the default",
  out.some(
    (c) =>
      c.method === "setChatMenuButton" &&
      c.params.chat_id === FRIEND &&
      c.params.menu_button.type === "default",
  ),
);
await say(FRIEND, "after removal");
same("a removed user is a stranger again", take(), []);

// ---- the button forward: the owner's `x:` presses go to another tool ----

// This relay has no forward settings: an `x:` press is answered empty and dropped, like an unknown button.
await hook({
  callback_query: {
    id: "cbx0",
    from: { id: OWNER },
    data: "x:job:1",
    message: { message_id: 77, chat: { id: OWNER } },
  },
});
same(
  "with no forward settings an x: press gets only an empty answer (FAIL: a relay without the settings tries to forward or ignores the press)",
  take(),
  [{ method: "answerCallbackQuery", params: { callback_query_id: "cbx0" } }],
);

// A bot with the forward on, run straight on a store of its own; the receiver is a stand-in fetch.
const FORWARD_URL = "https://tool.example.com/buttons";
const FORWARD_SECRET = `fwd-${toB64u(random(18))}`;
const posts = [];
let receiver = { status: 200 };
async function receiverFetch(url, init) {
  posts.push({ url, init });
  if (receiver.throws)
    throw Object.assign(new Error(receiver.throws), {
      name: receiver.name ?? "TypeError",
    });
  return { ok: receiver.status < 300, status: receiver.status };
}
function forwardBot(options) {
  const map = new Map();
  const bot = makeBot({
    webhookSecret: SECRET,
    fetch: receiverFetch,
    ...options,
  })({
    store: {
      get: (k) => map.get(k),
      put: (k, v) => map.set(k, v),
      delete: (k) => map.delete(k),
      list: (p) => [...map].filter(([k]) => k.startsWith(p)),
    },
    telegram: api.telegram,
    download: api.download,
    now: () => clock,
    log: (line) => logLines.push(line),
    ownerTgId: OWNER,
    sendToPc: () => false,
    closeUser: () => {},
  });
  const press = async (from, data, id) => {
    const r = await bot.webhook({
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify({
        update_id: ++updateId,
        callback_query: {
          id,
          from: { id: from },
          data,
          message: { message_id: 88, chat: { id: from } },
        },
      }),
      origin: "https://relay.example.com",
    });
    return { status: r.status, last: map.get("tg:last-update") };
  };
  return { press };
}
const on = forwardBot({
  buttonForwardUrl: FORWARD_URL,
  buttonForwardSecret: FORWARD_SECRET,
});

take();
let pressed = await on.press(OWNER, "x:job:42:approve", "cbx1");
same(
  "the owner's x: press is POSTed once to the forward address with the secret header and the press (FAIL: the other tool never gets its button presses)",
  posts.splice(0).map((p) => ({
    url: p.url,
    method: p.init.method,
    headers: p.init.headers,
    body: JSON.parse(p.init.body),
  })),
  [
    {
      url: FORWARD_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Button-Secret": FORWARD_SECRET,
      },
      body: {
        data: "x:job:42:approve",
        callbackId: "cbx1",
        chatId: OWNER,
        messageId: 88,
        threadId: null,
        inlineMessageId: null,
      },
    },
  ],
);
same(
  "and the relay does not answer that press itself (FAIL: the relay's empty answer takes the receiver's own toast)",
  take(),
  [],
);
check(
  "and the update counts as handled",
  pressed.status === 200 && pressed.last === updateId,
  JSON.stringify(pressed),
);

await on.press(FRIEND, "x:job:42:approve", "cbx2");
same(
  "a non-owner's x: press sends nothing to the tool (FAIL: anyone who can press a button reaches the tool)",
  posts.splice(0),
  [],
);
same(
  "and gets only the empty answer, as before",
  take().map((c) => c.method),
  ["answerCallbackQuery"],
);

for (const [name, half] of [
  ["the secret", { buttonForwardUrl: FORWARD_URL }],
  ["the address", { buttonForwardSecret: FORWARD_SECRET }],
]) {
  await forwardBot(half).press(OWNER, "x:job:42:approve", "cbx3");
  check(
    `with ${name} missing an x: press is answered empty and nothing is sent (FAIL: a half-set forward still sends)`,
    posts.splice(0).length === 0 &&
      JSON.stringify(take()) ===
        JSON.stringify([
          {
            method: "answerCallbackQuery",
            params: { callback_query_id: "cbx3" },
          },
        ]),
  );
}

const failText = [
  {
    method: "answerCallbackQuery",
    params: {
      callback_query_id: "cbx4",
      text: "Couldn't reach the tool; try again",
    },
  },
];
for (const [name, how] of [
  ["answers 503", { status: 503 }],
  ["cannot be reached", { status: 200, throws: "fetch failed" }],
]) {
  receiver = how;
  const logFrom = logLines.length;
  pressed = await on.press(OWNER, "x:job:42:approve", "cbx4");
  const lines = logLines.slice(logFrom);
  posts.splice(0);
  same(
    `a receiver that ${name} gets the press answered with the short text (FAIL: a failed forward leaves the owner's button spinning)`,
    take(),
    failText,
  );
  check(
    `and the failure is logged without the secret, the update handled (${name})`,
    lines.some((l) => l.startsWith("button forward failed")) &&
      !lines.join("\n").includes(FORWARD_SECRET) &&
      pressed.last === updateId,
    JSON.stringify({ lines, pressed }),
  );
}
// No answer in time: the tool may have acted, so the owner is told to check, not to press again.
receiver = {
  status: 200,
  throws: "The operation timed out",
  name: "TimeoutError",
};
{
  const logFrom = logLines.length;
  await on.press(OWNER, "x:job:42:approve", "cbx7");
  posts.splice(0);
  same(
    "a receiver that does not answer in time gets the press answered with the check-first text (FAIL: a slow tool that acted gets pressed twice)",
    take(),
    [
      {
        method: "answerCallbackQuery",
        params: {
          callback_query_id: "cbx7",
          text: "The tool is slow; check before pressing again",
        },
      },
    ],
  );
  check(
    "and the log names the wait, not the error text",
    logLines.slice(logFrom).includes("button forward failed: no answer in 3 s"),
    JSON.stringify(logLines.slice(logFrom)),
  );
}
receiver = { status: 200 };

await on.press(OWNER, `cancel:${"0".repeat(32)}`, "cbx5");
await on.press(OWNER, `rm:${THIRD}`, "cbx6");
check(
  "with the forward on, the owner's cancel: and rm: buttons are answered and handled as before, nothing forwarded (FAIL: the forward takes other buttons)",
  posts.splice(0).length === 0 &&
    JSON.stringify(
      take().map((c) => [
        c.method,
        c.params.text ?? c.params.callback_query_id,
      ]),
    ) ===
      JSON.stringify([
        ["answerCallbackQuery", "cbx5"],
        ["sendMessage", "That invite is already gone."],
        ["answerCallbackQuery", "cbx6"],
        ["sendMessage", `No invited user ${THIRD}.`],
      ]),
);

// A bad address turns only the forward off (the phone app keeps running) and sends nothing in the clear.
let badUrl = "";
let plain;
try {
  plain = forwardBot({
    buttonForwardUrl: "http://tool.example.com/buttons",
    buttonForwardSecret: FORWARD_SECRET,
  });
  posts.splice(0);
  await plain.press(OWNER, "x:job:42:approve", "cbx9");
} catch (e) {
  badUrl = e.message;
}
check(
  "a forward address that is not https keeps the bot running and sends nothing (FAIL: one typo stops the phone app, or presses with the secret go out unencrypted)",
  !badUrl && plain && posts.splice(0).length === 0,
  badUrl,
);
same(
  "and the owner's x: press is answered with the fix-the-address text (FAIL: a bad address leaves the button doing nothing, silently)",
  take(),
  [
    {
      method: "answerCallbackQuery",
      params: {
        callback_query_id: "cbx9",
        text: "The button forward address is not https; fix BUTTON_FORWARD_URL",
      },
    },
  ],
);

// ---- what the relay kept ----

check(
  "the relay's store holds no plain forward text at the end",
  !dump().includes(MARKER),
);
check(
  "the relay's log holds no plain forward text at the end",
  !logLines.join("\n").includes(MARKER),
);

link.stop();
await relay.close();
fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
