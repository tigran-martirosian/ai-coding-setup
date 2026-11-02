#!/usr/bin/env node
// read-digests: has a free worker read each digest that chat-scan.mjs wrote and answer the fixed
// questions in reader-task.txt. It goes through the worker command (~/.claude/workers/ask.mjs), which
// uses the first worker that is set up and working (Codex, then Gemini). One digest at a time. Writes
// <project>.findings.md next to each digest and prints one line per project.
//   node read-digests.mjs <digest folder> [--earlier <findings file>]
// --earlier takes the findings-<date>.md of the last review: each ticked row of its "Decided" table is
// added to the task of the project it belongs to, so the reader says if the fix held, came back or did
// not come up in the chats after that date.
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

const args = process.argv.slice(2);
const earlierAt = args.indexOf("--earlier");
const earlierArg = earlierAt >= 0 ? args.splice(earlierAt, 2)[1] : "";
if (earlierAt >= 0 && !earlierArg) { console.log("--earlier needs a findings file"); process.exit(1); }
const dir = args[0] ? path.resolve(args[0]) : "";
if (!dir || !fs.existsSync(dir)) { console.log("Usage: node read-digests.mjs <digest folder made by chat-scan.mjs> [--earlier <findings file>]"); process.exit(1); }
if (!fs.existsSync(ASK)) { console.log(`The worker command is not there: ${ASK}`); process.exit(1); }
const task = fs.readFileSync(path.join(HERE, "reader-task.txt"), "utf8");

// The ticked rows of the last review's "Decided" table: [{ project (normalised), text }]
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
let earlierDate = "", earlierRows = [], noColon = [];
if (earlierArg) {
  const ef = path.resolve(earlierArg);
  if (!fs.existsSync(ef)) { console.log(`The earlier findings file is not there: ${ef}`); process.exit(1); }
  earlierDate = path.basename(ef).match(/^findings-(\d{4}-\d{2}-\d{2})\.md$/)?.[1];
  if (!earlierDate) { console.log(`No date in the file name (expected findings-YYYY-MM-DD.md): ${path.basename(ef)}`); process.exit(1); }
  const lines = fs.readFileSync(ef, "utf8").split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s+Decided\b/i.test(l));
  const table = [];
  for (let i = at + 1; at >= 0 && i < lines.length && !/^##\s/.test(lines[i]); i++) if (lines[i].trim().startsWith("|")) table.push(lines[i].trim());
  if (!table.length) { console.log(`No "## Decided" table in ${ef}`); process.exit(1); }
  for (const row of table.slice(1)) {
    const cells = row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c)) || !/^ticked/i.test(cells[1] || "")) continue;
    const colon = cells[0].indexOf(":");
    if (colon < 0) { noColon.push(cells[0]); continue; }
    earlierRows.push({ project: norm(cells[0].slice(0, colon)), text: cells[0] });
  }
  if (!earlierRows.length) console.log(`No ticked fixes in ${path.basename(ef)}; reading without the earlier-fixes question.`);
}

function earlierText(file) {
  const mine = earlierRows.filter((r) => r.project === "everywhere" || r.project === norm(file.replace(/\.md$/, "")));
  if (!mine.length) return "";
  return `\n\nOne more heading after H, outside the 80 lines:\n\n` +
    `I. EARLIER FIXES: on ${earlierDate} the fixes listed below were set up for this project. Look only at\n` +
    `   chats dated after ${earlierDate} (each chat's heading carries its date). One line per fix, starting\n` +
    `   with its number and one of: HELD (the situation came up and went right), CAME BACK (it came up\n` +
    `   and went wrong the same way), DID NOT COME UP. Give the chat label for HELD and CAME BACK.\n` +
    mine.map((r, i) => `   ${i + 1}. ${r.text}`).join("\n");
}

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
    // started in the digest folder: Antigravity may only read files under the folder it runs in
    const child = spawn(process.execPath, [ASK, taskFile], { windowsHide: true, cwd: dir });
    const timer = setTimeout(() => { child.kill(); finish(false, `timed out after ${TIMEOUT_MS / 1000} s`); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { log += d; });
    child.on("error", (e) => finish(false, e.message));
    child.on("close", (code) => {
      const text = out.trim();
      const ok = code === 0 && text.length > 0;
      if (ok) fs.writeFileSync(outFile, text + "\n");
      finish(ok, code === 3 ? `no free worker could answer: ${log.trim().replace(/\s+/g, " ").slice(-400)}` : log.trim().slice(-300) || (text ? `exit code ${code}` : "empty answer"));
    });
  });
}

const digests = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.endsWith(".findings.md"));
if (!digests.length) { console.log(`No digests in ${dir}. Run chat-scan.mjs first.`); process.exit(1); }
const digestKeys = digests.map((f) => norm(f.replace(/\.md$/, "")));
for (const r of earlierRows) if (r.project !== "everywhere" && !digestKeys.includes(r.project)) console.log(`Earlier fix not scored (no digest for it this time): ${r.text}`);
for (const t of noColon) console.log(`Earlier fix not scored (no project before a colon): ${t}`);
let failed = 0;
for (const f of digests) {
  const file = path.join(dir, f);
  const requests = Number(fs.readFileSync(file, "utf8").match(/chats, (\d+) requests/)?.[1] || 0);
  if (requests < MIN_REQUESTS) { console.log(`${f}: skipped, only ${requests} requests`); continue; }
  const outFile = path.join(dir, f.replace(/\.md$/, ".findings.md"));
  fs.rmSync(outFile, { force: true });
  const started = Date.now();
  const r = await ask(`Read the file ${file}.\n\n${earlierText(f) ? task.trimEnd() + earlierText(f) : task}`, outFile);
  if (!r.ok) failed++;
  console.log(`${f}: ${r.ok ? `read in ${Math.round((Date.now() - started) / 1000)} s -> ${path.basename(outFile)}` : `FAILED (${r.why})`}`);
}
process.exit(failed ? 1 : 0);
