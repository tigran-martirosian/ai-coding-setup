// Prints the current context size of Claude sessions, read from their saved transcripts.
// Usage: node context-size.cjs "<words from the child's brief>" ["<words from another brief>" ...]
//   Each argument is a short plain phrase (no quotes or backslashes) taken from the start of
//   the brief the child was given, for example its "Goal: ..." line. Nimbalyst session ids do
//   not match transcript file names, so sessions are found by their first prompt. A transcript
//   id (the .jsonl file name) also works.
// Looks at transcripts changed in the last 24 hours (LEAD_CONTEXT_HOURS to change).
// Exit code 1 if any session is at or above the limit (default 150k, or LEAD_CONTEXT_LIMIT_K).
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.join(os.homedir(), ".claude", "projects");
const limitK = Number(process.env.LEAD_CONTEXT_LIMIT_K || 150);
const maxAgeMs = Number(process.env.LEAD_CONTEXT_HOURS || 24) * 3600 * 1000;
const HEAD_BYTES = 400 * 1024;

function recentTranscripts() {
  const out = [];
  for (const dir of fs.readdirSync(root)) {
    const full = path.join(root, dir);
    let names;
    try { names = fs.readdirSync(full); } catch (e) { continue; }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(full, name);
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs <= maxAgeMs) out.push({ file, mtime: stat.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function head(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(HEAD_BYTES);
  const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
  fs.closeSync(fd);
  return buf.toString("utf8", 0, n);
}

// The first prompt of a session, as raw JSON text (enough for a plain-phrase match).
function firstPrompt(file) {
  for (const line of head(file).split("\n")) {
    if (line.includes('"type":"user"') && line.includes('"role":"user"')) return line;
  }
  return "";
}

function contextTokens(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      const u = row.message && row.message.usage;
      if (u && !row.isSidechain) {
        return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
    } catch (e) {
      // a partly written last line is skipped
    }
  }
  return null;
}

const transcripts = recentTranscripts();
let over = false;
for (const arg of process.argv.slice(2)) {
  const label = arg.length > 50 ? arg.slice(0, 50) + "..." : arg;
  const hit = transcripts.find((t) => path.basename(t.file, ".jsonl") === arg)
    || transcripts.find((t) => firstPrompt(t.file).includes(arg));
  if (!hit) { console.log(`"${label}": no transcript found`); continue; }
  const tokens = contextTokens(hit.file);
  if (tokens === null) { console.log(`"${label}": no usage recorded yet`); continue; }
  const k = Math.round(tokens / 1000);
  const flag = k >= limitK ? `  OVER ${limitK}k: send further work to a fresh session` : "";
  if (k >= limitK) over = true;
  console.log(`"${label}": ${k}k tokens${flag}`);
}
process.exit(over ? 1 : 0);
