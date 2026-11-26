// Tests the phone relay's deploy files without deploying anything (pipe design, section 12, row DP1): the release
// workflow starts on v* tags only, in the phone-relay environment, with read-only permissions; it and the README
// name the same secrets; the Wrangler config binds HUB to the SQLite-backed Hub and holds no name or account; the
// test deploy's dry run with a fake secrets file in a temp folder prints no secret value and writes nothing.
//   node tests/test-phone-deploy.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeBot } from "../phone/relay/bot/bot.mjs";
import * as deployMod from "../phone/relay/deploy.mjs";
import {
  announceTestCopy,
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
  CI_SECRETS,
  deployRelay,
  headersFile,
  OUT,
  OWNER_COMMANDS,
  PROBE_HEADERS,
  pointBot,
  preparePage,
  RELAY_SECRETS,
  START_COMMANDS,
  WRANGLER_VERSION,
} from "../phone/relay/deploy.mjs";
import * as deployTestMod from "../phone/relay/deploy-test.mjs";
import {
  ADDRESS_KEY,
  deployTest,
  HOOK_SECRET_KEY,
  removeTopics,
} from "../phone/relay/deploy-test.mjs";
import { PAGE_HEADERS, startLocalRelay } from "../phone/relay/local/server.mjs";
import { pcIdOf, toB64url } from "../phone/relay/src/hub.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

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

// ---- the workflow ----

const flow = read(".github/workflows/phone-deploy.yml");
// The lines of a top-level key's block, comments and blank lines left out.
function block(key) {
  const lines = flow.split("\n");
  const at = lines.indexOf(`${key}:`);
  if (at < 0) return null;
  const out = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;
    if (line.trim() && !line.trim().startsWith("#")) out.push(line.trim());
  }
  return out;
}
same("the workflow starts on v* tags only", block("on"), [
  "push:",
  'tags: ["v*"]',
]);
check(
  "no branch, pull request, manual or timed start anywhere in the workflow",
  !/\b(branches|pull_request|pull_request_target|workflow_dispatch|workflow_call|schedule|repository_dispatch)\b/.test(
    flow,
  ),
);
same("permissions: contents read, nothing else", block("permissions"), [
  "contents: read",
]);
check(
  "the job runs in the phone-relay environment",
  /^ {4}environment: phone-relay$/m.test(flow),
);
check(
  "the workflow checks the tag is on main and equals version.json",
  flow.includes('git merge-base --is-ancestor "$GITHUB_SHA" origin/main') &&
    flow.includes("process.env.GITHUB_REF_NAME"),
);
check(
  "the workflow deploys phone-relay through deploy.mjs",
  flow.includes("node phone/relay/deploy.mjs --name phone-relay\n"),
);
check(
  "every action is pinned by commit hash",
  [...flow.matchAll(/uses: (\S+)/g)].every(([, u]) => /@[0-9a-f]{40}$/.test(u)),
);
check(
  "Wrangler is pinned to one exact version, and only in deploy.mjs",
  /^\d+\.\d+\.\d+$/.test(WRANGLER_VERSION) && !/wrangler@/i.test(flow),
  WRANGLER_VERSION,
);

// ---- Wrangler's whole tree comes from a committed lock, installed with no secret near it ----

const relayJson = (name) => {
  try {
    return JSON.parse(read(`phone/relay/${name}`));
  } catch (e) {
    return { error: e.message };
  }
};
const pkg = relayJson("package.json");
const lock = relayJson("package-lock.json");
const lockedTree = Object.entries(lock.packages ?? {}).filter(([k]) => k);
check(
  "phone/relay pins Wrangler exactly and locks its whole tree with integrity hashes (FAIL: a deploy resolves new package versions next to the Cloudflare token)",
  pkg.private === true &&
    pkg.devDependencies?.wrangler === WRANGLER_VERSION &&
    lock.packages?.["node_modules/wrangler"]?.version === WRANGLER_VERSION &&
    lockedTree.length > 10 &&
    lockedTree.every(([, p]) => p.link || /^sha512-/.test(p.integrity ?? "")),
  JSON.stringify({
    pkg,
    wrangler: lock.packages?.["node_modules/wrangler"],
    unhashed: lockedTree.filter(([, p]) => !p.integrity).map(([k]) => k),
  }).slice(0, 600),
);
// The workflow's steps, each as its trimmed lines.
const steps = flow
  .split("\n    steps:\n")[1]
  .split(/\n {6}- /)
  .slice(1)
  .map((s) => s.split("\n").map((l) => l.trim()));
const installAt = steps.findIndex((s) =>
  s.includes("run: npm ci --ignore-scripts"),
);
const deployAt = steps.findIndex((s) =>
  s.some((l) => l.includes("node phone/relay/deploy.mjs")),
);
check(
  "the workflow installs the locked tree with npm ci --ignore-scripts in phone/relay, in a step with no secret, before the deploy (FAIL: install scripts run next to the Cloudflare token)",
  installAt >= 0 &&
    installAt < deployAt &&
    steps[installAt].includes("working-directory: phone/relay") &&
    !steps[installAt].some((l) => /secrets\.|^env:/.test(l)),
  JSON.stringify(steps),
);
const wranglerRun = deployMod.wranglerCommand?.(["deploy"]);
same(
  "the deploy runs the installed Wrangler with node and no shell, never npx (FAIL: npx fetches packages next to the Cloudflare token)",
  wranglerRun,
  {
    command: process.execPath,
    args: [
      path.join(ROOT, "phone/relay/node_modules/wrangler/bin/wrangler.js"),
      "deploy",
    ],
    shell: false,
  },
);

// ---- the secrets file is made private from its first byte ----

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-secrets-mode-"));
  const calls = [];
  const { mkdirSync, writeFileSync } = fs;
  fs.mkdirSync = (p, o) => {
    calls.push(["mkdir", o?.mode]);
    return mkdirSync(p, o);
  };
  fs.writeFileSync = (p, d, o) => {
    calls.push(["write", o?.mode]);
    return writeFileSync(p, d, o);
  };
  try {
    deployTestMod.writeSecrets?.(path.join(dir, "new", "owner-secrets.json"), {
      ownerTelegramId: "1",
    });
  } finally {
    fs.mkdirSync = mkdirSync;
    fs.writeFileSync = writeFileSync;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  same(
    "the secrets file's folder is made 0700 and the file 0600 as they are created (FAIL: another local account can read the deploy token)",
    calls,
    [
      ["mkdir", 0o700],
      ["write", 0o600],
    ],
  );
}

// ---- the README names the same secrets ----

const readme = read("phone/README.md");
// The backticked names in the first column of the table under a heading.
function tableNames(heading) {
  const at = readme.indexOf(`${heading}\n`);
  if (at < 0) return null;
  const rest = readme.slice(at + heading.length + 1).split("\n");
  const names = [];
  let inTable = false;
  for (const line of rest) {
    if (line.startsWith("|")) {
      inTable = true;
      const m = line.match(/^\| `([A-Z_]+)` \|/);
      if (m) names.push(m[1]);
    } else if (inTable) break;
  }
  return names.sort();
}
const ciNames = tableNames("#### CI secrets");
const relayNames = tableNames("#### Relay secrets");
const flowSecrets = [
  ...new Set([...flow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])),
].sort();
same(
  "the workflow reads exactly the CI secrets the README lists",
  flowSecrets,
  ciNames,
);
same(
  "the README's CI secrets are the ones deploy.mjs reads",
  ciNames,
  Object.values(CI_SECRETS).sort(),
);
check(
  "each CI secret reaches deploy.mjs under its own name",
  ciNames.every((n) => flow.includes(`${n}: \${{ secrets.${n} }}`)),
);
same(
  "the README's relay secrets are the ones the deploy puts",
  relayNames,
  [...RELAY_SECRETS].sort(),
);
check(
  "the relay secrets include WEBHOOK_SECRET, and worker.mjs reads each one",
  relayNames.includes("WEBHOOK_SECRET") &&
    RELAY_SECRETS.every((n) =>
      read("phone/relay/src/worker.mjs").includes(`secret(env, "${n}")`),
    ),
);

// ---- the Wrangler config ----

const configText = read("phone/relay/wrangler.jsonc");
const config = JSON.parse(configText.replace(/^\s*\/\/.*$/gm, ""));
same("HUB is bound to the class Hub", config.durable_objects?.bindings, [
  { name: "HUB", class_name: "Hub" },
]);
same("Hub is SQLite-backed", config.migrations, [
  { tag: "v1", new_sqlite_classes: ["Hub"] },
]);
check(
  "the page is served as static assets from the deploy's build folder",
  path.resolve(ROOT, "phone/relay", config.assets?.directory ?? "") === OUT,
);
check(
  "compatibility date 2026-04-07 or later",
  /^\d{4}-\d\d-\d\d$/.test(config.compatibility_date) &&
    config.compatibility_date >= "2026-04-07",
  config.compatibility_date,
);
check(
  "the config turns on enable_request_signal (FAIL: an aborted Send to chat keeps its Telegram upload running on Cloudflare)",
  config.compatibility_flags?.includes("enable_request_signal"),
  JSON.stringify(config.compatibility_flags),
);
check(
  "the config runs the webhook check every few minutes (FAIL: a lost webhook is never set again)",
  config.triggers?.crons?.length === 1 &&
    /^\*\/([1-9]|1[0-5]) \* \* \* \*$/.test(config.triggers.crons[0]),
  JSON.stringify(config.triggers),
);
check(
  "the config holds no Worker name, account, route or address",
  !["name", "account_id", "route", "routes", "vars"].some((k) => k in config) &&
    !/workers\.dev|https?:/.test(configText),
);

// ---- the test deploy's dry run ----

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-deploy-test-"));
const fake = {
  cloudflareApiToken: "fakeCfTokenNotRealAbCdEfGhIjKlMnOpQr12",
  cloudflareAccountId: "f00dbabef00dbabef00dbabef00dbabe",
  botToken: "4206917:fakeBotKeyNotReal_XyZ-aBcDeFgHiJ",
  ownerTelegramId: "6602207",
};
const values = [...Object.values(fake), fake.botToken.split(":")[1]];
const run = (file, extra = []) =>
  spawnSync(
    process.execPath,
    ["phone/relay/deploy-test.mjs", ...extra, "--secrets", file],
    { cwd: ROOT, encoding: "utf8" },
  );
let testDryRun = ""; // what the test copy's dry run printed
try {
  const full = path.join(tmp, "owner-secrets.json");
  fs.writeFileSync(full, JSON.stringify(fake));
  const outBefore = fs.existsSync(OUT);
  const r = run(full, ["--dry-run"]);
  const text = `${r.stdout}${r.stderr}`;
  testDryRun = text;
  check("the dry run ends well", r.status === 0, text);
  // Changed on purpose by row T1: a test deploy no longer points the bot at itself (it used to list setWebhook).
  check(
    "the dry run shows the deploy, the four relay secrets and the Test copy message",
    text.includes(
      "would run in " +
        `${path.join(ROOT, "phone", "relay")}: node node_modules/wrangler/bin/wrangler.js deploy --name phone-relay-test`,
    ) &&
      !/\bnpx\b/.test(text) &&
      RELAY_SECRETS.every((n) => text.includes(`secret put ${n} `)) &&
      text.includes('sendMessage "Test copy"'),
    text,
  );
  check(
    "a test deploy makes no bot-wide call (the real relay keeps the bot): no setWebhook, setMyCommands, " +
      "setChatMenuButton or description; one sendMessage with a web_app button",
    !/setWebhook|deleteMyCommands|setMyCommands|setMyDescription|setMyShortDescription|setChatMenuButton/.test(
      text,
    ) &&
      text.split("sendMessage").length === 2 &&
      text.includes("web_app button"),
    text,
  );
  check(
    "a test deploy builds the page as a test copy",
    text.includes("test copy beside the real relay"),
    text,
  );
  const leaked = values.filter((v) => text.includes(v));
  same("the dry run prints no secret value", leaked, []);
  check("the dry run writes no page build", fs.existsSync(OUT) === outBefore);

  const c = run(full, ["--dry-run", "--checks"]);
  const cText = `${c.stdout}${c.stderr}`;
  check(
    "a --checks dry run names the test build and holds one file more",
    c.status === 0 &&
      cText.includes("test build with the Checks screen") &&
      Number(cText.match(/page \S+ \((\d+) files/)?.[1]) ===
        Number(text.match(/page \S+ \((\d+) files/)?.[1]) + 1,
    cText,
  );
  same(
    "a --checks dry run prints no secret value",
    values.filter((v) => cText.includes(v)),
    [],
  );
  check(
    "a --checks test deploy serves /version.json as a download Telegram's web page may fetch",
    cText.includes(
      `would serve /version.json with Content-Disposition: attachment; filename="probe.json" and ` +
        "Access-Control-Allow-Origin: https://web.telegram.org",
    ) && !/setWebhook|setMyCommands|setChatMenuButton/.test(cText),
    cText,
  );

  const part = path.join(tmp, "part.json");
  fs.writeFileSync(
    part,
    JSON.stringify({ botToken: fake.botToken, cloudflareAccountId: "x" }),
  );
  const m = run(part, ["--dry-run"]);
  const mText = `${m.stdout}${m.stderr}`;
  check(
    "a missing key stops the run and is named",
    m.status === 1 &&
      mText.includes("cloudflareApiToken") &&
      mText.includes("ownerTelegramId"),
    mText,
  );
  same(
    "the missing-key error prints no value",
    values.filter((v) => mText.includes(v)),
    [],
  );

  const bad = path.join(tmp, "bad.json");
  fs.writeFileSync(bad, JSON.stringify({ ...fake, botToken: "nocolon" }));
  const b = run(bad, ["--dry-run"]);
  check(
    "a malformed value stops the run with what is wrong",
    b.status === 1 &&
      `${b.stdout}${b.stderr}`.includes("bot token is not") &&
      !`${b.stdout}${b.stderr}`.includes("nocolon"),
    `${b.stdout}${b.stderr}`,
  );

  const gone = run(path.join(tmp, "none.json"), ["--dry-run"]);
  check(
    "no secrets file: a clear error that names --setup",
    gone.status === 1 && gone.stderr.includes("--setup"),
    gone.stderr,
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- the release workflow's command line without its secrets ----

const env = { ...process.env };
for (const n of Object.values(CI_SECRETS)) delete env[n];
const ci = spawnSync(
  process.execPath,
  ["phone/relay/deploy.mjs", "--name", "phone-relay", "--dry-run"],
  { cwd: ROOT, encoding: "utf8", env },
);
check(
  "deploy.mjs without the CI secrets stops and names each one",
  ci.status === 1 &&
    Object.values(CI_SECRETS).every((n) => ci.stderr.includes(n)),
  ci.stderr,
);

// The real relay's deploy, with fake values: the same steps as before the test copy existed.
const ciFake = spawnSync(
  process.execPath,
  ["phone/relay/deploy.mjs", "--name", "phone-relay", "--dry-run"],
  {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...env,
      [CI_SECRETS.apiToken]: fake.cloudflareApiToken,
      [CI_SECRETS.accountId]: fake.cloudflareAccountId,
      [CI_SECRETS.botToken]: fake.botToken,
      [CI_SECRETS.ownerTgId]: fake.ownerTelegramId,
    },
  },
);
const ciText = `${ciFake.stdout}${ciFake.stderr}`;
check(
  "a --name phone-relay deploy still sets the webhook, menus, descriptions and Open button, and sends no " +
    "Test copy message",
  ciFake.status === 0 &&
    ciText.includes(
      "would call Telegram: setWebhook to <relay>/tg/hook with a fresh secret, the command lists, description " +
        "and short description, the default menu button back to commands, the Open button in the owner's chat",
    ) &&
    !/sendMessage|Test copy|test copy|version\.json/.test(ciText),
  ciText,
);
check(
  "a --name phone-relay deploy puts no TOPIC_SUFFIX (FAIL: the real relay's topics would be named (test))",
  !ciText.includes("TOPIC_SUFFIX"),
  ciText,
);

// ---- a whole test deploy with a stand-in wrangler; the kept address and secret; --remove-topics ----

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-deploy-topics-"));
  const outBefore = fs.existsSync(OUT);
  try {
    const file = path.join(dir, "owner-secrets.json");
    fs.writeFileSync(file, JSON.stringify(fake));
    const ORIGIN = "https://phone-relay-test.example-sub.workers.dev";
    const ran = [];
    const said = [];
    // The relay answers as a healthy one: the root page with the page headers, every hidden path 404. The fake
    // once had only json(), for Telegram: it could not answer the live probe the spec (D7) asks of the test copy too.
    const relayFetch = async (input, init) => {
      const url = String(input?.url ?? input);
      if (url.startsWith("https://api.telegram.org/"))
        return new Response(JSON.stringify({ ok: true, result: true }));
      const headers = {
        "Content-Type": "text/html; charset=utf-8",
        ...PAGE_HEADERS,
      };
      if (new URL(url).pathname === "/")
        return new Response(
          init?.method === "HEAD"
            ? null
            : "<!doctype html><title>Phone</title>",
          { status: 200, headers },
        );
      return new Response("not found", { status: 404, headers });
    };
    await deployTest({
      file,
      say: (line) => said.push(line),
      fetch: relayFetch,
      wrangler: (args, { input }) => {
        ran.push({ args, input });
        return args[0] === "deploy"
          ? `Deployed phone-relay-test\n  ${ORIGIN}\n`
          : "";
      },
    });
    const put = (n) => ran.find((r) => r.args[2] === n)?.input;
    const kept = JSON.parse(fs.readFileSync(file, "utf8"));
    same(
      "a test deploy keeps the test relay's address and its webhook secret in the secrets file, beside the bot token",
      [kept[ADDRESS_KEY], kept[HOOK_SECRET_KEY], kept.botToken],
      [ORIGIN, put("WEBHOOK_SECRET"), fake.botToken],
    );
    check(
      "the kept webhook secret is a real one (48 characters of A-Z a-z 0-9 _ -)",
      /^[A-Za-z0-9_-]{48}$/.test(kept[HOOK_SECRET_KEY] ?? ""),
    );
    same(
      'a test deploy puts TOPIC_SUFFIX " (test)" on the test Worker',
      put("TOPIC_SUFFIX"),
      " (test)",
    );
    same(
      "a test deploy prints no secret value, the webhook secret included",
      [...values, kept[HOOK_SECRET_KEY]].filter((v) =>
        said.join("\n").includes(v),
      ),
      [],
    );

    const r = spawnSync(
      process.execPath,
      [
        "phone/relay/deploy-test.mjs",
        "--remove-topics",
        "--dry-run",
        "--secrets",
        file,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    const rText = `${r.stdout}${r.stderr}`;
    check(
      "--remove-topics --dry-run reads the kept address and names POST <address>/tg/hook",
      r.status === 0 && rText.includes(`POST ${ORIGIN}/tg/hook`),
      rText,
    );
    same(
      "--remove-topics --dry-run prints no secret value",
      [...values, kept[HOOK_SECRET_KEY]].filter((v) => rText.includes(v)),
      [],
    );

    // The test relay, with the TOPIC_SUFFIX the deploy put: its topics carry "(test)", and --remove-topics,
    // pointed at it, deletes them.
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html>");
    const tgCalls = [];
    let thread = 10;
    // Frames the relay has received (its test hook), so settle() waits for the PC's frames, not a fixed time.
    let framesIn = 0;
    let framesSent = 0;
    const relay = await startLocalRelay({
      countFrame: (_url, way) => {
        if (way === "in") framesIn += 1;
      },
      port: 0,
      pageDir: dir,
      botId: 4206917,
      botToken: "4206917:local",
      ownerTgId: 6602207,
      telegramKey: "00".repeat(32),
      topicSuffix: put("TOPIC_SUFFIX"),
      telegram: async (method, params) => {
        tgCalls.push({ method, params });
        if (method === "getMe")
          return { username: "t_bot", has_topics_enabled: true };
        if (method === "createForumTopic")
          return { message_thread_id: ++thread };
        if (method === "sendMessage") return { message_id: 900 + thread };
        return true;
      },
      download: async () => {
        throw new Error("no download here");
      },
      now: Date.now,
      log: () => {},
      bot: makeBot({ webhookSecret: kept[HOOK_SECRET_KEY] }),
    });
    // One socket per first frame, as a PC opens a new link to sign in after its join.
    const open = async () => {
      const w = new WebSocket(`${relay.url.replace("http", "ws")}/ws`);
      await new Promise((ok, no) => {
        w.addEventListener("open", ok);
        w.addEventListener("error", no);
      });
      return w;
    };
    let ws = await open();
    const token = crypto.getRandomValues(new Uint8Array(32));
    const pcId = await pcIdOf(token);
    const frame = (f) => {
      ws.send(JSON.stringify({ v: 1, ...f }));
      framesSent += 1;
    };
    // Waits until the relay has every frame sent, then until the Hub has handled them.
    const settle = async () => {
      const deadline = Date.now() + 10_000;
      while (framesIn < framesSent) {
        if (Date.now() > deadline)
          throw new Error(
            `the relay got ${framesIn} of the PC's ${framesSent} frames in 10 s`,
          );
        await new Promise((ok) => setTimeout(ok, 2));
      }
      await relay.idle();
    };
    frame({
      t: "pc-join",
      pcId,
      token: toB64url(token),
      inboxPub: toB64url(crypto.getRandomValues(new Uint8Array(32))),
      pcVersion: "26.3",
    });
    await settle();
    relay.map.set(`pc:${pcId}`, {
      ...relay.map.get(`pc:${pcId}`),
      tgId: 6602207,
    });
    ws.close();
    ws = await open();
    frame({ t: "pc-auth", pcId, token: toB64url(token) });
    await settle();
    same(
      'a test relay creates its topics as "Inbox (test)", "Alerts (test)" and "Files (test)"',
      tgCalls
        .filter((c) => c.method === "createForumTopic")
        .map((c) => c.params.name),
      ["Inbox (test)", "Alerts (test)", "Files (test)"],
    );
    const local = path.join(dir, "local-secrets.json");
    fs.writeFileSync(
      local,
      JSON.stringify({ ...kept, [ADDRESS_KEY]: relay.url }),
    );
    const n = await removeTopics({ file: local, say: () => {} });
    same(
      "--remove-topics sends the kept secret to the test relay, which deletes all three topics",
      [n, tgCalls.filter((c) => c.method === "deleteForumTopic").length],
      [3, 3],
    );
    ws.close();
    await relay.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!outBefore) fs.rmSync(OUT, { recursive: true, force: true });
  }
}

// ---- a test deploy whose "Test copy" message fails still keeps the new webhook secret ----
// The relay has the new WEBHOOK_SECRET once the secrets are put; a secrets file left with the old one makes
// --remove-topics knock with a secret the relay refuses.

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-deploy-secret-"));
  const outBefore = fs.existsSync(OUT);
  try {
    const file = path.join(dir, "owner-secrets.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ ...fake, [HOOK_SECRET_KEY]: "old-secret" }),
    );
    const ORIGIN = "https://phone-relay-test.example-sub.workers.dev";
    const ran = [];
    const failingFetch = async (input, init) => {
      const url = String(input?.url ?? input);
      if (url.startsWith("https://api.telegram.org/"))
        return new Response(
          JSON.stringify({
            ok: false,
            description: "Bad Request: chat not found",
          }),
          { status: 400 },
        );
      const headers = {
        "Content-Type": "text/html; charset=utf-8",
        ...PAGE_HEADERS,
      };
      if (new URL(url).pathname === "/")
        return new Response(
          init?.method === "HEAD" ? null : "<!doctype html>",
          {
            status: 200,
            headers,
          },
        );
      return new Response("not found", { status: 404, headers });
    };
    let thrown = null;
    try {
      await deployTest({
        file,
        say: () => {},
        fetch: failingFetch,
        wrangler: (args, { input }) => {
          ran.push({ args, input });
          return args[0] === "deploy" ? `Deployed\n  ${ORIGIN}\n` : "";
        },
      });
    } catch (e) {
      thrown = e;
    }
    check(
      "a test deploy whose Test copy message fails still fails (FAIL: the owner is not told the message did not go)",
      thrown !== null,
    );
    const put = ran.find((r) => r.args[2] === "WEBHOOK_SECRET")?.input;
    const kept = JSON.parse(fs.readFileSync(file, "utf8"));
    same(
      "a failed Test copy message keeps the new webhook secret and address (FAIL: the secrets file keeps the old " +
        "secret the relay now refuses)",
      [kept[HOOK_SECRET_KEY], kept[ADDRESS_KEY]],
      [put, ORIGIN],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!outBefore) fs.rmSync(OUT, { recursive: true, force: true });
  }
}

// ---- job 9 D7 (docs/2026-11-20-safe-deploys-spec.md): the page sends HSTS, and the relay's deploy probes its live
// address after `wrangler deploy` (liveCheck of workers/ship-check.mjs) and fails on what the probe finds ----

check(
  "job 9 D7 the page headers hold Strict-Transport-Security (the live probe fails an address without it)",
  /max-age=\d+/.test(PAGE_HEADERS["Strict-Transport-Security"] ?? ""),
  JSON.stringify(PAGE_HEADERS),
);
{
  const outBefore = fs.existsSync(OUT);
  const ORIGIN = "https://phone-relay.example-sub.workers.dev";
  const PAGE = "<!doctype html><title>Phone</title>";
  // The page's headers before job 9 (no HSTS): what Cloudflare may still serve just after `wrangler deploy`.
  const OLD_HEADERS = Object.fromEntries(
    Object.entries(PAGE_HEADERS).filter(
      ([k]) => k !== "Strict-Transport-Security",
    ),
  );
  // One real deploy with stand-ins: `events` lists the wrangler calls and the requests to the relay, in order;
  // `waits` the probe's pauses (ms) between its tries, which return at once; `said` what the deploy printed.
  // `leaky`: the relay serves a .env file with KEY= lines at /.env, as a host that uploaded one would.
  // `staleRoots`: the first this many requests for the root get the old headers (Infinity: it never changes).
  // `beside`: the test copy's deploy (deploy-test.mjs) instead of the release's.
  const deployOnce = async ({
    leaky = false,
    staleRoots = 0,
    beside = false,
  }) => {
    const events = [];
    const waits = [];
    const said = [];
    const puts = {}; // secret name -> the value put
    let roots = 0;
    const fetch = async (input, init) => {
      const url = String(input?.url ?? input);
      if (url.startsWith("https://api.telegram.org/")) {
        events.push("telegram");
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      const at = new URL(url);
      if (at.origin !== ORIGIN)
        throw new Error(`the deploy fetched an unknown address: ${url}`);
      events.push(`probe ${at.pathname}`);
      const stale = at.pathname === "/" && roots++ < staleRoots;
      const headers = {
        "Content-Type": "text/html; charset=utf-8",
        ...(stale ? OLD_HEADERS : PAGE_HEADERS),
      };
      if (at.pathname === "/")
        return new Response(init?.method === "HEAD" ? null : PAGE, {
          status: 200,
          headers,
        });
      if (leaky && at.pathname === "/.env")
        return new Response("API_" + "KEY=not-real\nPORT=8787\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      return new Response("not found", { status: 404, headers });
    };
    let error = null;
    try {
      await deployRelay({
        name: beside ? "phone-relay-test" : "phone-relay",
        beside,
        values: {
          apiToken: fake.cloudflareApiToken,
          accountId: fake.cloudflareAccountId,
          botToken: fake.botToken,
          ownerTgId: fake.ownerTelegramId,
        },
        say: (line) => said.push(line),
        fetch,
        probeWait: async (ms) => {
          waits.push(ms);
        },
        wrangler: (args, { input }) => {
          events.push(`wrangler ${args.slice(0, 2).join(" ")}`);
          if (args[0] === "secret") puts[args[2]] = input;
          return args[0] === "deploy"
            ? `Deployed phone-relay\n  ${ORIGIN}\n`
            : "";
        },
      });
    } catch (e) {
      error = e;
    }
    return { events, waits, said, puts, error };
  };
  try {
    const clean = await deployOnce({ leaky: false });
    const cleanCopy = await deployOnce({ leaky: false, beside: true });
    same(
      "the real relay's deploy puts RELAY_ORIGIN (its address, which turns on the webhook check); the test copy's " +
        "never does (FAIL: the test copy would set the bot's webhook to itself)",
      [clean.puts.RELAY_ORIGIN, "RELAY_ORIGIN" in cleanCopy.puts],
      [ORIGIN, false],
    );
    check(
      "the real relay's dry run names RELAY_ORIGIN, the test copy's does not",
      ciText.includes("secret put RELAY_ORIGIN") &&
        !testDryRun.includes("RELAY_ORIGIN"),
      `${ciText}\n${testDryRun}`,
    );
    const deployed = clean.events.indexOf("wrangler deploy --name");
    const probed = clean.events.indexOf("probe /.env");
    check(
      "job 9 D7 the relay's deploy probes /.env and /.git/HEAD on the relay address after wrangler deploy",
      deployed >= 0 &&
        probed > deployed &&
        clean.events.includes("probe /.git/HEAD"),
      clean.events.join(", "),
    );
    check(
      "job 9 D7 a probe that finds nothing lets the deploy finish",
      clean.error === null,
      String(clean.error?.message),
    );
    const leaky = await deployOnce({ leaky: true });
    check(
      "job 9 D7 /.env answering 200 with KEY= lines fails the deploy run, with the probe's problem naming /.env",
      leaky.error !== null && /\/\.env\b/.test(String(leaky.error.message)),
      leaky.error
        ? String(leaky.error.message)
        : `no error; ${leaky.events.join(", ")}`,
    );
    check(
      "job 9 D7 a failed deploy's message says the new version is live and how to go back (wrangler rollback)",
      /new version is live/.test(String(leaky.error?.message)) &&
        /wrangler@?\S* rollback/.test(String(leaky.error?.message)),
      String(leaky.error?.message),
    );
    check(
      "job 9 D7 a probe that passes prints each path it asked with its status (a 403 or a page fallback passes too)",
      clean.said.some((l) => /\/\.env 404\b/.test(l)) &&
        clean.said.some((l) => /\/\.git\/HEAD 404\b/.test(l)),
      clean.said.join("\n"),
    );
    const leakyCopy = await deployOnce({ leaky: true, beside: true });
    check(
      "end review of job 9: the test copy's deploy is probed too; /.env answering 200 fails it, naming /.env",
      leakyCopy.error !== null &&
        /\/\.env\b/.test(String(leakyCopy.error.message)) &&
        !leakyCopy.events.includes("telegram"),
      leakyCopy.error
        ? String(leakyCopy.error.message)
        : `no error; ${leakyCopy.events.join(", ")}`,
    );
    const late = await deployOnce({ staleRoots: 2 });
    const lateRoots = late.events.filter((e) => e === "probe /").length;
    check(
      "job 9 D7 a relay that serves the old headers (no HSTS) for its first 2 answers passes: the probe asks again",
      late.error === null &&
        lateRoots === 3 &&
        late.events.includes("telegram"),
      `${late.error?.message ?? "no error"}; root asked ${lateRoots} times; waits ${late.waits.join(", ")}`,
    );
    const never = await deployOnce({ staleRoots: Number.POSITIVE_INFINITY });
    const waited = never.waits.reduce((a, b) => a + b, 0);
    check(
      "job 9 D7 a relay that keeps the old headers fails the deploy after about 60 s of tries, naming the missing header",
      never.error !== null &&
        /Strict-Transport-Security/.test(String(never.error.message)) &&
        never.waits.length >= 2 &&
        waited >= 50000 &&
        waited <= 70000 &&
        !never.events.includes("telegram") &&
        !never.events.some((e) => e.startsWith("wrangler secret")),
      `${never.error?.message ?? "no error"}; waits ${never.waits.join(", ")}`,
    );
  } finally {
    if (!outBefore) fs.rmSync(OUT, { recursive: true, force: true });
  }
}

// ---- the test copy's page, headers and message ----

same(
  "the real relay's _headers hold only the page headers",
  headersFile(),
  `/*\n${Object.entries(PAGE_HEADERS)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n")}\n`,
);
check(
  "a --checks _headers serves /version.json as probe.json to Telegram's web page",
  headersFile({ checks: true }) ===
    `${headersFile()}/version.json\n  Content-Disposition: ${PROBE_HEADERS["Content-Disposition"]}\n` +
      `  Access-Control-Allow-Origin: ${PROBE_HEADERS["Access-Control-Allow-Origin"]}\n` &&
    PROBE_HEADERS["Content-Disposition"] ===
      'attachment; filename="probe.json"' &&
    PROBE_HEADERS["Access-Control-Allow-Origin"] === "https://web.telegram.org",
  headersFile({ checks: true }),
);
// The storage names come from row A2's build (STORE_SUFFIX); before it is in this tree there is nothing to compare.
const plainPage = preparePage({ write: false }).files;
const testPage = preparePage({ write: false, testCopy: true }).files;
if (plainPage.some(([, t]) => t.includes("STORE_SUFFIX")))
  check(
    "the test deploy's page keeps its pairing under -test names, the real page under today's",
    testPage.some(([, t]) => t.includes('STORE_SUFFIX = "-test"')) &&
      !plainPage.some(([, t]) => t.includes('STORE_SUFFIX = "-test"')),
  );
else console.log("note the page build has no STORE_SUFFIX yet (row A2)");

const sent = [];
await announceTestCopy({
  botToken: fake.botToken,
  ownerTgId: fake.ownerTelegramId,
  origin: "https://test.example.com",
  fetch: async (url, init) => {
    sent.push({ method: url.split("/").pop(), params: JSON.parse(init.body) });
    return { json: async () => ({ ok: true, result: true }) };
  },
});
same("a test deploy's one bot call: Test copy with a web_app button", sent, [
  {
    method: "sendMessage",
    params: {
      chat_id: 6602207,
      text: "Test copy",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Open the test copy",
              web_app: { url: "https://test.example.com/" },
            },
          ],
        ],
      },
    },
  },
]);

// ---- the bot calls, against a fake Telegram ----

const calls = [];
await pointBot({
  botToken: fake.botToken,
  ownerTgId: fake.ownerTelegramId,
  origin: "https://relay.example.com",
  webhookSecret: "w".repeat(48),
  fetch: async (url, init) => {
    calls.push({
      method: url.split("/").pop(),
      params: JSON.parse(init.body),
    });
    return { json: async () => ({ ok: true, result: true }) };
  },
});
same(
  "the bot calls: webhook, command lists, description, short description, default menu button, Open button",
  calls,
  [
    {
      method: "setWebhook",
      params: {
        url: "https://relay.example.com/tg/hook",
        secret_token: "w".repeat(48),
        allowed_updates: ["message", "callback_query"],
        max_connections: 1,
        drop_pending_updates: true,
      },
    },
    {
      method: "deleteMyCommands",
      params: { scope: { type: "all_private_chats" } },
    },
    { method: "setMyCommands", params: { commands: START_COMMANDS } },
    {
      method: "setMyCommands",
      params: {
        commands: OWNER_COMMANDS,
        scope: { type: "chat", chat_id: 6602207 },
      },
    },
    { method: "setMyDescription", params: { description: BOT_DESCRIPTION } },
    {
      method: "setMyShortDescription",
      params: { short_description: BOT_SHORT_DESCRIPTION },
    },
    {
      method: "setChatMenuButton",
      params: { menu_button: { type: "commands" } },
    },
    {
      method: "setChatMenuButton",
      params: {
        chat_id: 6602207,
        menu_button: {
          type: "web_app",
          text: "Open",
          web_app: { url: "https://relay.example.com/" },
        },
      },
    },
  ],
);

// The menu lists only commands the relay's bot answers, none of the old inbox bot's, within the Bot API's limits.
const OLD_BOT_COMMANDS = ["last", "undo", "chat", "new", "help"];
const botSource = read("phone/relay/bot/bot.mjs");
const answered = [
  "start",
  .../\/\^\\\/\(([a-z|]+)\)/.exec(botSource)[1].split("|"),
];
const names = OWNER_COMMANDS.map((c) => c.command);
check(
  "the owner's menu holds the everyone menu and only answered commands",
  START_COMMANDS.every((c) => names.includes(c.command)) &&
    names.every((n) => answered.includes(n)),
  `menu ${names.join(", ")}; answered ${answered.join(", ")}`,
);
check(
  "everyone's menu lists /clear, which the bot answers",
  START_COMMANDS.some((c) => c.command === "clear") &&
    answered.includes("clear"),
  START_COMMANDS.map((c) => c.command).join(", "),
);
check(
  "no command of the old bot is listed",
  !names.some((n) => OLD_BOT_COMMANDS.includes(n)),
  names.join(", "),
);
check(
  "commands and descriptions fit the Bot API's limits",
  OWNER_COMMANDS.every(
    (c) =>
      /^[a-z0-9_]{1,32}$/.test(c.command) &&
      c.description.length >= 1 &&
      c.description.length <= 256,
  ) &&
    BOT_DESCRIPTION.length <= 512 &&
    BOT_SHORT_DESCRIPTION.length <= 120,
  `${BOT_DESCRIPTION.length} and ${BOT_SHORT_DESCRIPTION.length} characters`,
);

// ---- the second PC program ----

const PC = path.join(ROOT, "skills", "phone-bot", "pc");
const pcTmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-deploy-pc-"));
try {
  const own = path.join(pcTmp, "app");
  const pipe =
    process.platform === "win32"
      ? `\\\\.\\pipe\\phone-app-pc-deploy-test-${process.pid}`
      : path.join(pcTmp, "pc.sock");
  const base = { ...process.env };
  for (const n of Object.keys(base))
    if (n.startsWith("PHONE_PC_")) delete base[n];
  const second = {
    ...base,
    PHONE_PC_TEST: "1",
    PHONE_PC_APP_DIR: own,
    PHONE_PC_PIPE: pipe,
  };
  const paths = (env) => {
    const r = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const f = await import(${JSON.stringify(new URL("../skills/phone-bot/pc/core/files.mjs", import.meta.url).href)});
const l = await import(${JSON.stringify(new URL("../skills/phone-bot/pc/core/log.mjs", import.meta.url).href)});
const os = await import("node:os");
console.log(JSON.stringify({ app: f.appDir(), keys: f.keyFilePath(), log: l.logPath(), home: os.homedir() }));`,
      ],
      { cwd: ROOT, encoding: "utf8", env },
    );
    return r.status === 0
      ? JSON.parse(r.stdout)
      : { error: `${r.stdout}${r.stderr}` };
  };
  const p2 = paths(second);
  same(
    "the second PC program keeps its keys and its log in its own folder",
    [p2.app, p2.keys, p2.log],
    [own, path.join(own, "pc-keys.json"), path.join(own, "pc.log")],
  );
  const p1 = paths({ ...base, PHONE_PC_APP_DIR: own, PHONE_PC_PIPE: pipe });
  const real = p1.home && path.join(p1.home, ".phone-app");
  same(
    "without PHONE_PC_TEST the app folder and the log stay under ~/.phone-app",
    [p1.app, p1.log],
    [real, real && path.join(real, "pc.log")],
  );
  const half = paths({ ...base, PHONE_PC_TEST: "1", PHONE_PC_APP_DIR: own });
  check(
    "an own folder without an own pipe stops, so the second program never talks to the real one",
    (half.error ?? "").includes("PHONE_PC_PIPE"),
    JSON.stringify(half),
  );

  // join in dry mode, as on Windows. A plain join (home and APPDATA in the temp folder) shows the log-on entry
  // the second program's join must leave out.
  const join = (env) => {
    const r = spawnSync(
      process.execPath,
      [path.join(PC, "setup.mjs"), "join", "https://relay.example.com"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...env, PHONE_PC_DRY: "1", PHONE_PC_PLATFORM: "win32" },
      },
    );
    return { status: r.status, text: `${r.stdout}${r.stderr}` };
  };
  const home = path.join(pcTmp, "home");
  fs.mkdirSync(home);
  const sandbox = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData"),
  };
  const plain = join({ ...base, ...sandbox, PHONE_PC_TEST: "1" });
  const j = join({ ...second, ...sandbox });
  check(
    "a plain join plans the log-on entry (so the next check means something)",
    plain.status === 0 && plain.text.includes("phone-app-pc.vbs"),
    plain.text,
  );
  check(
    "the second program's join plans no log-on entry, no stop by command line and no old-bot removal, " +
      "makes its keys in its own folder and starts it hidden",
    j.status === 0 &&
      !/phone-app-pc\.vbs|Startup|powershell|schtasks/.test(j.text) &&
      j.text.includes(`Keys made: ${path.join(own, "pc-keys.json")}`) &&
      j.text.includes("would start hidden:") &&
      j.text.includes("keep.mjs"),
    j.text,
  );
} finally {
  fs.rmSync(pcTmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
