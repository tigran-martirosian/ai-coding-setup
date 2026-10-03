#!/usr/bin/env node
// read-digests: has the Codex worker read each digest that chat-scan.mjs wrote and answer the fixed
// questions in reader-task.txt. One Codex run per digest, all at the same time. Writes
// <project>.findings.md next to each digest and prints one line per project.
//   node read-digests.mjs <digest folder>
// A project with fewer than 5 requests is skipped. Codex runs read-only and without web search.
// Switches: CHAT_REVIEW_EFFORT (default low), CHAT_REVIEW_TIMEOUT_MS (per run, default 300000).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = Number(process.env.CHAT_REVIEW_TIMEOUT_MS || 300000);
const EFFORT = process.env.CHAT_REVIEW_EFFORT || "low";
const MIN_REQUESTS = 5;

const dir = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!dir || !fs.existsSync(dir)) { console.log("Usage: node read-digests.mjs <digest folder made by chat-scan.mjs>"); process.exit(1); }
const task = fs.readFileSync(path.join(HERE, "reader-task.txt"), "utf8");

// Codex takes the prompt on stdin ("-") and writes its last message to a file, so nothing needs quoting
function ask(prompt, outFile) {
  return new Promise((done) => {
    let log = "", settled = false;
    const finish = (ok, why) => { if (!settled) { settled = true; clearTimeout(timer); done({ ok, why }); } };
    const cmd = `codex exec --skip-git-repo-check -s read-only -c windows.sandbox=unelevated -c model_reasoning_effort=${EFFORT} -o "${outFile}" -`;
    const child = spawn(cmd, [], { shell: true, windowsHide: true });
    const timer = setTimeout(() => { child.kill(); finish(false, `timed out after ${TIMEOUT_MS / 1000} s`); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    child.on("error", (e) => finish(false, e.message));
    child.on("close", (code) => {
      const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim() : "";
      finish(code === 0 && text.length > 0, text ? `exit code ${code}` : log.trim().slice(-300) || "empty answer");
    });
    child.stdin.end(prompt);
  });
}

const digests = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.endsWith(".findings.md"));
if (!digests.length) { console.log(`No digests in ${dir}. Run chat-scan.mjs first.`); process.exit(1); }
let failed = 0;
await Promise.all(digests.map(async (f) => {
  const file = path.join(dir, f);
  const requests = Number(fs.readFileSync(file, "utf8").match(/chats, (\d+) requests/)?.[1] || 0);
  if (requests < MIN_REQUESTS) { console.log(`${f}: skipped, only ${requests} requests`); return; }
  const outFile = path.join(dir, f.replace(/\.md$/, ".findings.md"));
  fs.rmSync(outFile, { force: true });
  const started = Date.now();
  const r = await ask(`Read the file ${file}.\n\n${task}`, outFile);
  if (!r.ok) { failed++; fs.rmSync(outFile, { force: true }); }
  console.log(`${f}: ${r.ok ? `read in ${Math.round((Date.now() - started) / 1000)} s -> ${path.basename(outFile)}` : `FAILED (${r.why})`}`);
}));
process.exit(failed ? 1 : 0);
