// The relay's deploy (pipe design, section 10), shared by the test deploy on the owner's PC (deploy-test.mjs) and
// the release workflow (.github/workflows/phone-deploy.yml). In order: the page into ./dist with its _headers,
// `wrangler deploy`, the four relay secrets with `wrangler secret put` (each value on standard input), then the bot:
// the webhook with a fresh secret, its command lists, description and short description (which replace whatever
// the bot showed before), the default menu button back to the command list, the owner's Open button.
// Secret values go only into a child's environment or standard input and to Telegram; nothing printed holds one.
//   node phone/relay/deploy.mjs --name <worker> [--dry-run]
// This command line is the release workflow's: it reads the values from the environment names in CI_SECRETS.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPage, writePage } from "../page/build.mjs";
import { telegramApi } from "./bot/telegram.mjs";
import { PAGE_HEADERS } from "./local/server.mjs";

// One exact version for both deploys, never a range.
export const WRANGLER_VERSION = "4.162.0";
// The Worker's secrets, as worker.mjs reads them.
export const RELAY_SECRETS = [
  "BOT_TOKEN",
  "BOT_ID",
  "OWNER_TG_ID",
  "WEBHOOK_SECRET",
];
// The release workflow's environment names, filled from the phone-relay GitHub environment's secrets.
export const CI_SECRETS = {
  apiToken: "CLOUDFLARE_API_TOKEN",
  accountId: "CLOUDFLARE_ACCOUNT_ID",
  botToken: "PHONE_BOT_TOKEN",
  ownerTgId: "PHONE_OWNER_TG_ID",
};

const RELAY = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(RELAY, "dist");
const WORKER_NAME = /^[a-z0-9][a-z0-9-]{0,53}$/;
const BOT_TOKEN = /^\d+:[A-Za-z0-9_-]+$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const TG_ID = /^\d+$/;
const API_TOKEN = /^[A-Za-z0-9_-]{20,}$/;
// The address wrangler prints after a deploy on the account's free subdomain.
const ADDRESS = /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/;

// Checks the shape of each value; an error names what is wrong, never the value.
export function checkValues(values) {
  const bad = [];
  if (!API_TOKEN.test(values.apiToken ?? ""))
    bad.push("the Cloudflare token is empty or not a token");
  if (!ACCOUNT_ID.test(values.accountId ?? ""))
    bad.push("the Cloudflare account id is not 32 hex characters");
  if (!BOT_TOKEN.test(values.botToken ?? ""))
    bad.push("the bot token is not <digits>:<key>");
  if (!TG_ID.test(String(values.ownerTgId ?? "")))
    bad.push("the owner's Telegram id is not a number");
  if (bad.length) throw new Error(`deploy: ${bad.join("; ")}`);
}

const headersFile = () =>
  `/*\n${Object.entries(PAGE_HEADERS)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n")}\n`;

// Builds the page. `write` puts the page and _headers into ./dist. `checks` (the owner's test relay only): the
// test build with the Checks screen; a normal deploy afterwards takes it away.
export function preparePage({ write, checks = false }) {
  const build = buildPage({ checks });
  if (write) {
    writePage(OUT, build);
    fs.writeFileSync(path.join(OUT, "_headers"), headersFile());
  }
  return build;
}

// Hides a value in the GitHub Actions log; does nothing elsewhere.
function mask(value) {
  if (process.env.GITHUB_ACTIONS === "true")
    console.log(`::add-mask::${value}`);
}

function wrangler(args, { env, input }) {
  const win = process.platform === "win32";
  const childEnv = { ...process.env, ...env };
  for (const name of [CI_SECRETS.botToken, CI_SECRETS.ownerTgId])
    delete childEnv[name];
  // Windows starts npx through cmd; no argument holds a space or a secret.
  const r = spawnSync(
    "npx",
    ["--yes", `wrangler@${WRANGLER_VERSION}`, ...args],
    {
      cwd: RELAY,
      env: childEnv,
      input: input ?? "",
      encoding: "utf8",
      shell: win,
      maxBuffer: 1 << 26,
    },
  );
  if (r.error) throw new Error(`deploy: cannot start npx: ${r.error.message}`);
  if (r.status !== 0)
    throw new Error(
      `deploy: wrangler ${args.slice(0, 2).join(" ")} failed (exit code ${r.status}):\n${`${r.stderr}\n${r.stdout}`.trim()}`,
    );
  return r.stdout;
}

// The bot's menu, only the commands bot/bot.mjs answers. Everyone sees START_COMMANDS (with /clear, which removes
// the alerts in the caller's own chat); the owner's chat also lists the invite commands, which only the owner gets
// an answer to. Bot API: command 1-32 of a-z 0-9 _, description 1-256 characters.
export const START_COMMANDS = [
  { command: "start", description: "Show the Open button for the app" },
  { command: "clear", description: "Remove the alerts from this chat" },
];
export const OWNER_COMMANDS = [
  ...START_COMMANDS,
  { command: "invite", description: "Make a one-time invite link" },
  { command: "invites", description: "List the open invites" },
  { command: "people", description: "List the people who joined" },
  { command: "remove", description: "Remove a person: /remove <Telegram id>" },
];
// Shown in an empty chat with the bot (0-512 characters).
export const BOT_DESCRIPTION =
  "This bot sends alerts when a session on your PC needs you or has finished. Everything else happens in the " +
  "app: open it with the Open button next to the message field. The bot is private and answers only people " +
  "the owner has invited.";
// Shown on the bot's profile and with a shared link (0-120 characters).
export const BOT_SHORT_DESCRIPTION =
  "Alerts from the sessions on your PC. The app opens from the Open button.";

// Points the bot at the relay (pipe design, section 5). The private-chat command scope is deleted, as a list set
// there would hide the default list.
export async function pointBot({
  botToken,
  ownerTgId,
  origin,
  webhookSecret,
  fetch,
}) {
  const { telegram } = telegramApi({ token: botToken, fetch });
  await telegram("setWebhook", {
    url: `${origin}/tg/hook`,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
    max_connections: 1,
    drop_pending_updates: true,
  });
  await telegram("deleteMyCommands", {
    scope: { type: "all_private_chats" },
  });
  await telegram("setMyCommands", { commands: START_COMMANDS });
  await telegram("setMyCommands", {
    commands: OWNER_COMMANDS,
    scope: { type: "chat", chat_id: Number(ownerTgId) },
  });
  await telegram("setMyDescription", { description: BOT_DESCRIPTION });
  await telegram("setMyShortDescription", {
    short_description: BOT_SHORT_DESCRIPTION,
  });
  await telegram("setChatMenuButton", { menu_button: { type: "commands" } });
  await telegram("setChatMenuButton", {
    chat_id: Number(ownerTgId),
    menu_button: {
      type: "web_app",
      text: "Open",
      web_app: { url: `${origin}/` },
    },
  });
}

// Deploys the Worker `name` with the page; returns the relay's address, or null on a dry run.
export async function deployRelay({
  name,
  values,
  dryRun = false,
  checks = false,
  say = console.log,
  fetch = globalThis.fetch,
}) {
  if (!WORKER_NAME.test(name ?? ""))
    throw new Error(
      `deploy: the Worker name must be lower case letters, digits and dashes, got ${name}`,
    );
  checkValues(values);
  const env = {
    CLOUDFLARE_API_TOKEN: values.apiToken,
    CLOUDFLARE_ACCOUNT_ID: values.accountId,
    WRANGLER_SEND_METRICS: "false",
  };
  const secrets = {
    BOT_TOKEN: values.botToken,
    BOT_ID: values.botToken.split(":")[0],
    OWNER_TG_ID: String(values.ownerTgId),
    // 48 characters of A-Z a-z 0-9 _ -, new at each deploy (pipe design, section 5).
    WEBHOOK_SECRET: randomBytes(36).toString("base64url"),
  };
  const build = preparePage({ write: !dryRun, checks });
  if (checks)
    say(
      "test build with the Checks screen: it stays on the relay until a normal deploy",
    );
  const wr = `npx wrangler@${WRANGLER_VERSION}`;
  if (dryRun) {
    say("dry run: nothing is written, deployed or sent");
    say(
      `would write page ${build.version} (${build.files.length} files and _headers) to ${OUT}`,
    );
    say(
      `would run in ${RELAY}: ${wr} deploy --name ${name} (Cloudflare token and account id in its environment only)`,
    );
    for (const s of RELAY_SECRETS)
      say(
        `would run: ${wr} secret put ${s} --name ${name} (the value on standard input)`,
      );
    say(
      "would call Telegram: setWebhook to <relay>/tg/hook with a fresh secret, the command lists, description " +
        "and short description, the default menu button back to commands, the Open button in the owner's chat",
    );
    return null;
  }
  const origin = wrangler(["deploy", "--name", name], { env }).match(
    ADDRESS,
  )?.[0];
  if (!origin)
    throw new Error(
      "deploy: wrangler deploy printed no relay address. Has the account's free Workers subdomain been made " +
        "(Cloudflare dashboard, Workers and Pages, opened once)?",
    );
  mask(origin);
  for (const s of RELAY_SECRETS)
    wrangler(["secret", "put", s, "--name", name], {
      env,
      input: secrets[s],
    });
  await pointBot({
    botToken: values.botToken,
    ownerTgId: values.ownerTgId,
    origin,
    webhookSecret: secrets.WEBHOOK_SECRET,
    fetch,
  });
  say(`relay: ${origin}`);
  say("webhook set");
  return origin;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--name");
  const name = at >= 0 ? args[at + 1] : undefined;
  if (!name) {
    console.error(
      "Usage: node phone/relay/deploy.mjs --name <worker> [--dry-run]",
    );
    process.exit(2);
  }
  const missing = Object.values(CI_SECRETS).filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`deploy: not set in the environment: ${missing.join(", ")}`);
    process.exit(1);
  }
  try {
    await deployRelay({
      name,
      values: Object.fromEntries(
        Object.entries(CI_SECRETS).map(([k, env]) => [k, process.env[env]]),
      ),
      dryRun: args.includes("--dry-run"),
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
