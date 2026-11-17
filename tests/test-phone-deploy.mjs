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
import {
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
  CI_SECRETS,
  OUT,
  OWNER_COMMANDS,
  pointBot,
  RELAY_SECRETS,
  START_COMMANDS,
  WRANGLER_VERSION,
} from "../phone/relay/deploy.mjs";

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
try {
  const full = path.join(tmp, "owner-secrets.json");
  fs.writeFileSync(full, JSON.stringify(fake));
  const outBefore = fs.existsSync(OUT);
  const r = run(full, ["--dry-run"]);
  const text = `${r.stdout}${r.stderr}`;
  check("the dry run ends well", r.status === 0, text);
  check(
    "the dry run shows the deploy, the four relay secrets and the bot step",
    text.includes(
      `npx wrangler@${WRANGLER_VERSION} deploy --name phone-relay-test`,
    ) &&
      RELAY_SECRETS.every((n) => text.includes(`secret put ${n} `)) &&
      text.includes("setWebhook"),
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
