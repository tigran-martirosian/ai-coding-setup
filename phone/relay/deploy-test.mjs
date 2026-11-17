// The test relay, deployed from the owner's PC (pipe design, section 10): reads the owner's secrets file and runs
// the shared deploy (deploy.mjs) for the Worker phone-relay-test. Prints only the relay's address and
// "webhook set"; no message holds a secret value.
//   node phone/relay/deploy-test.mjs [--dry-run] [--checks] [--secrets <file>]
//   node phone/relay/deploy-test.mjs --setup [--secrets <file>]
// --dry-run: checks the file and the page, then shows each step without writing, deploying or calling anyone.
// --checks: deploys the test build with the Checks screen (build.mjs --checks) for a probe on the phone; run a
// plain deploy once the probe is done.
// --setup: asks for the Cloudflare token and account id as hidden input and writes them into the secrets file,
// keeping its other keys; the file's access list is then this Windows user only.
// --secrets: another secrets file than ~/.phone-app/owner-secrets.json (the tests use one in a temp folder).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkValues, deployRelay } from "./deploy.mjs";

const TEST_WORKER = "phone-relay-test";
// The secrets file's keys -> the deploy's values.
const KEYS = {
  cloudflareApiToken: "apiToken",
  cloudflareAccountId: "accountId",
  botToken: "botToken",
  ownerTelegramId: "ownerTgId",
};

function fail(message) {
  console.error(`deploy-test: ${message}`);
  process.exit(1);
}

function readSecrets(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT")
      fail(
        `no secrets file at ${file}. Make it with: node phone/relay/deploy-test.mjs --setup (see phone/README.md)`,
      );
    fail(`cannot read ${file}: ${e.message}`);
  }
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("not a JSON object");
    return data;
  } catch (e) {
    // The parse error can quote the file's text, so only its kind is shown.
    fail(
      `${file} is not a JSON object (${e instanceof SyntaxError ? "bad JSON" : e.message})`,
    );
  }
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
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  lockFile(file);
  const missing = Object.keys(KEYS).filter((k) => !data[k]);
  console.log(
    `written: ${file}${missing.length ? `; still to add: ${missing.join(", ")}` : ""}`,
  );
}

const args = process.argv.slice(2);
const at = args.indexOf("--secrets");
if (at >= 0 && !args[at + 1])
  fail(
    "usage: node phone/relay/deploy-test.mjs [--dry-run [--checks] | --setup] [--secrets <file>]",
  );
const file = path.resolve(
  at >= 0
    ? args[at + 1]
    : path.join(os.homedir(), ".phone-app", "owner-secrets.json"),
);

if (args.includes("--setup")) {
  await setup(file);
} else {
  const data = readSecrets(file);
  const missing = Object.keys(KEYS).filter(
    (k) => data[k] === undefined || data[k] === null || data[k] === "",
  );
  if (missing.length) fail(`${file} has no ${missing.join(", ")}`);
  const values = Object.fromEntries(
    Object.entries(KEYS).map(([k, v]) => [v, String(data[k])]),
  );
  try {
    checkValues(values);
    await deployRelay({
      name: TEST_WORKER,
      values,
      dryRun: args.includes("--dry-run"),
      checks: args.includes("--checks"),
    });
  } catch (e) {
    fail(e.message.replace(/^deploy: /, ""));
  }
}
