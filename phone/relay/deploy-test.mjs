// The test copy beside the real relay, deployed from the owner's PC (pipe design, section 10): reads the owner's
// secrets file and runs the shared deploy (deploy.mjs) for the Worker phone-relay-test, always `beside`: the Worker
// and the page (built as a test copy) only, no bot-wide call, so the real relay keeps the webhook, the menus and
// the Open button. The owner gets one "Test copy" message with a button to the test address. Its topics are named
// "Inbox (test)", "Alerts (test)" and "Files (test)" (TOPIC_SUFFIX). After a deploy the test relay's address and webhook secret are
// kept in the secrets file (testRelayAddress, testRelayWebhookSecret) for --remove-topics. Prints only the relay's
// address and those lines; no message holds a secret value.
//   node phone/relay/deploy-test.mjs [--dry-run] [--checks] [--secrets <file>]
//   node phone/relay/deploy-test.mjs --remove-topics [--dry-run] [--secrets <file>]
//   node phone/relay/deploy-test.mjs --setup [--secrets <file>]
// --dry-run: checks the file and the page, then shows each step without writing, deploying or calling anyone.
// --checks: deploys the test build with the Checks screen (build.mjs --checks) for a probe on the phone, and serves
// /version.json as a download; run a plain deploy once the probe is done.
// --remove-topics: asks the test relay to delete its topics in every chat and forget them (files contract, section
// 7): `POST <test relay>/tg/hook` with the kept webhook secret and { "relay_command": "remove-topics" }.
// --setup: asks for the Cloudflare token and account id as hidden input and writes them into the secrets file,
// keeping its other keys; the file's access list is then this Windows user only.
// --secrets: another secrets file than ~/.phone-app/owner-secrets.json (the tests use one in a temp folder).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkValues, deployRelay } from "./deploy.mjs";

const TEST_WORKER = "phone-relay-test";
// The secrets file's keys -> the deploy's values.
const KEYS = {
  cloudflareApiToken: "apiToken",
  cloudflareAccountId: "accountId",
  botToken: "botToken",
  ownerTelegramId: "ownerTgId",
};
// The keys a test deploy writes for --remove-topics.
export const ADDRESS_KEY = "testRelayAddress";
export const HOOK_SECRET_KEY = "testRelayWebhookSecret";
const REMOVE_BODY = JSON.stringify({ relay_command: "remove-topics" });

function fail(message) {
  console.error(`deploy-test: ${message}`);
  process.exit(1);
}

// The secrets file as an object; an error names the file and what is wrong, never its text.
export function readSecrets(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT")
      throw new Error(
        `no secrets file at ${file}. Make it with: node phone/relay/deploy-test.mjs --setup (see phone/README.md)`,
      );
    throw new Error(`cannot read ${file}: ${e.message}`);
  }
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("not a JSON object");
    return data;
  } catch (e) {
    // The parse error can quote the file's text, so only its kind is shown.
    throw new Error(
      `${file} is not a JSON object (${e instanceof SyntaxError ? "bad JSON" : e.message})`,
    );
  }
}

// Writes the secrets file whole, keeping its other keys. An existing file keeps its access list.
function writeSecrets(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function lockFile(file) {
  if (process.platform !== "win32") {
    fs.chmodSync(file, 0o600);
    return;
  }
  const r = spawnSync(
    "icacls",
    [file, "/inheritance:r", "/grant:r", `${os.userInfo().username}:F`],
    { encoding: "utf8" },
  );
  if (r.error || r.status !== 0)
    fail(
      `icacls could not limit ${file} to this user: ${(r.error?.message || r.stderr || r.stdout).trim()}`,
    );
}

// Reads a line from the terminal without showing it.
function askHidden(question) {
  if (!process.stdin.isTTY)
    fail("--setup reads hidden input, so run it in a terminal");
  process.stdout.write(question);
  return new Promise((resolve) => {
    let text = "";
    const stop = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stop();
          resolve(text.trim());
          return;
        }
        if (ch === "\u0003") {
          stop();
          fail("stopped, nothing written");
        }
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1);
        else text += ch;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function setup(file) {
  const data = fs.existsSync(file) ? readSecrets(file) : {};
  data.cloudflareApiToken = await askHidden("Cloudflare deploy token: ");
  data.cloudflareAccountId = await askHidden("Cloudflare account id: ");
  for (const key of ["cloudflareApiToken", "cloudflareAccountId"])
    if (!data[key]) fail(`${key} was empty, nothing written`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeSecrets(file, data);
  lockFile(file);
  const missing = Object.keys(KEYS).filter((k) => !data[k]);
  console.log(
    `written: ${file}${missing.length ? `; still to add: ${missing.join(", ")}` : ""}`,
  );
}

// The test deploy. After a real one, the relay's address and webhook secret go into the secrets file.
// `fetch` and `wrangler` are deployRelay's (stand-ins in the tests).
export async function deployTest({
  file,
  dryRun = false,
  checks = false,
  say = console.log,
  fetch = globalThis.fetch,
  wrangler,
}) {
  const data = readSecrets(file);
  const missing = Object.keys(KEYS).filter(
    (k) => data[k] === undefined || data[k] === null || data[k] === "",
  );
  if (missing.length) throw new Error(`${file} has no ${missing.join(", ")}`);
  const values = Object.fromEntries(
    Object.entries(KEYS).map(([k, v]) => [v, String(data[k])]),
  );
  checkValues(values);
  const done = await deployRelay({
    name: TEST_WORKER,
    values,
    dryRun,
    checks,
    beside: true,
    say,
    fetch,
    ...(wrangler ? { wrangler } : {}),
  });
  if (dryRun) {
    say(
      `would keep the test relay's address and webhook secret in ${file} (${ADDRESS_KEY}, ${HOOK_SECRET_KEY})`,
    );
    return null;
  }
  writeSecrets(file, {
    ...readSecrets(file),
    [ADDRESS_KEY]: done.origin,
    [HOOK_SECRET_KEY]: done.webhookSecret,
  });
  say(`kept the test relay's address and webhook secret in ${file}`);
  return done;
}

// Asks the test relay to delete its topics. Returns the number of topics it removed, or null on a dry run.
export async function removeTopics({
  file,
  dryRun = false,
  say = console.log,
  fetch = globalThis.fetch,
}) {
  const data = readSecrets(file);
  const address = data[ADDRESS_KEY];
  const secret = data[HOOK_SECRET_KEY];
  if (!address || !secret)
    throw new Error(
      `${file} has no ${ADDRESS_KEY} or ${HOOK_SECRET_KEY}: run a test deploy (node phone/relay/deploy-test.mjs) first`,
    );
  const url = `${address}/tg/hook`;
  if (dryRun) {
    say("dry run: nothing is sent");
    say(
      `would send: POST ${url} with the kept webhook secret in X-Telegram-Bot-Api-Secret-Token and ${REMOVE_BODY}`,
    );
    return null;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret,
    },
    body: REMOVE_BODY,
  });
  const text = await res.text();
  if (res.status === 400 && text === "no update_id") {
    say("this relay has no topic removal");
    return null;
  }
  if (res.status !== 200)
    throw new Error(
      `the test relay answered ${res.status} ${text.slice(0, 200)}`,
    );
  const { removed } = JSON.parse(text);
  if (!Number.isSafeInteger(removed))
    throw new Error(
      `the test relay answered without a count: ${text.slice(0, 200)}`,
    );
  say(`topics removed: ${removed}`);
  return removed;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--secrets");
  if (at >= 0 && !args[at + 1])
    fail(
      "usage: node phone/relay/deploy-test.mjs [--dry-run [--checks] | --remove-topics [--dry-run] | --setup] [--secrets <file>]",
    );
  const file = path.resolve(
    at >= 0
      ? args[at + 1]
      : path.join(os.homedir(), ".phone-app", "owner-secrets.json"),
  );
  const dryRun = args.includes("--dry-run");
  try {
    if (args.includes("--setup")) await setup(file);
    else if (args.includes("--remove-topics"))
      await removeTopics({ file, dryRun });
    else await deployTest({ file, dryRun, checks: args.includes("--checks") });
  } catch (e) {
    fail(e.message.replace(/^deploy: /, ""));
  }
}
