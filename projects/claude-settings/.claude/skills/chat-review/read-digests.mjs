#!/usr/bin/env node
// read-digests: has a free worker read each digest that chat-scan.mjs wrote and answer the fixed
// questions in reader-task.txt. It goes through the worker command (~/.claude/workers/ask.mjs), which
// uses the first worker that is set up and working (Codex, then Gemini). One digest at a time. Writes
// <project>.findings.md next to each digest and prints one line per project.
//   node read-digests.mjs <digest folder>
// A project with fewer than 5 requests is skipped. The worker reads files only, with no web search.
// Switches: CHAT_REVIEW_TIMEOUT_MS (per digest, default 300000), CHAT_REVIEW_ASK (another worker
// command, for the test).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = Number(process.env.CHAT_REVIEW_TIMEOUT_MS || 300000);
const ASK = process.env.CHAT_REVIEW_ASK || path.join(os.homedir(), ".claude", "workers", "ask.mjs");
const MIN_REQUESTS = 5;

const dir = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!dir || !fs.existsSync(dir)) { console.log("Usage: node read-digests.mjs <digest folder made by chat-scan.mjs>"); process.exit(1); }
if (!fs.existsSync(ASK)) { console.log(`The worker command is not there: ${ASK}`); process.exit(1); }
const task = fs.readFileSync(path.join(HERE, "reader-task.txt"), "utf8");

// The worker command takes the task from a file and prints the answer, so nothing needs quoting
function ask(prompt, outFile) {
  return new Promise((done) => {
    const taskFile = outFile.replace(/\.findings\.md$/, ".task.txt");
    fs.writeFileSync(taskFile, prompt);
    let out = "", log = "", settled = false;
    const finish = (ok, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rmSync(taskFile, { force: true });
      done({ ok, why });
    };
    const child = spawn(process.execPath, [ASK, taskFile], { windowsHide: true });
    const timer = setTimeout(() => { child.kill(); finish(false, `timed out after ${TIMEOUT_MS / 1000} s`); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { log += d; });
    child.on("error", (e) => finish(false, e.message));
    child.on("close", (code) => {
      const text = out.trim();
      const ok = code === 0 && text.length > 0;
      if (ok) fs.writeFileSync(outFile, text + "\n");
      finish(ok, code === 3 ? "no free worker could answer" : log.trim().slice(-300) || (text ? `exit code ${code}` : "empty answer"));
    });
  });
}

const digests = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.endsWith(".findings.md"));
if (!digests.length) { console.log(`No digests in ${dir}. Run chat-scan.mjs first.`); process.exit(1); }
let failed = 0;
for (const f of digests) {
  const file = path.join(dir, f);
  const requests = Number(fs.readFileSync(file, "utf8").match(/chats, (\d+) requests/)?.[1] || 0);
  if (requests < MIN_REQUESTS) { console.log(`${f}: skipped, only ${requests} requests`); continue; }
  const outFile = path.join(dir, f.replace(/\.md$/, ".findings.md"));
  fs.rmSync(outFile, { force: true });
  const started = Date.now();
  const r = await ask(`Read the file ${file}.\n\n${task}`, outFile);
  if (!r.ok) failed++;
  console.log(`${f}: ${r.ok ? `read in ${Math.round((Date.now() - started) / 1000)} s -> ${path.basename(outFile)}` : `FAILED (${r.why})`}`);
}
process.exit(failed ? 1 : 0);
