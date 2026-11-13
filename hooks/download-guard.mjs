// download-guard: a PreToolUse hook (Bash|PowerShell) that sends a plain big download through
// workers/download.mjs, which fetches 32 byte ranges side by side (measured 2026-11-11 from Hugging Face:
// one curl ~1.5 MB/s, 32 ranges ~37 MB/s). It rewrites the command with updatedInput and does not refuse it;
// no permissionDecision goes with it, so the normal permission prompt still decides.
// It looks at `curl -o <file> <url>` / `curl -O <url>`, `wget [-O <file>] <url>` and
// `Invoke-WebRequest [-Uri] <url> -OutFile <file>` (iwr too). Only flags the downloader can stand in for are
// taken (curl -L -s -S -f -#, --retry, -C -; wget -q -c -nv; -UseBasicParsing); a command with any other flag
// (headers, a login, a method, stdout output), a variable or a pipe is left as it is.
// "Big" is over 50 MB by a HEAD request's Content-Length (3 s limit): at one stream's 1.5 MB/s that is over
// half a minute of waiting, where 32 ranges take a few seconds. When the size cannot be learned, the command
// is left as it is. Fails open. DOWNLOAD_GUARD=off disables it.
// command-explain runs on the same call at the same time and also returns updatedInput, each from the command
// Claude sent; Claude Code takes one whole input, so one rewrite would be lost. This hook therefore adds the same
// stand-in "# WHAT THIS DOES:" line command-explain would add (same check, same text), unless COMMAND_EXPLAIN=off.
import { runHook } from "./lib/hook-io.mjs";
import { NOTE_LINE_RE, NO_NOTE, WHAT_THIS_DOES } from "./lib/texts.mjs";
import { fileURLToPath } from "node:url";

const BIG = 50e6;
const HEAD_MS = 3000;
const WORKER = fileURLToPath(
  new URL("../workers/download.mjs", import.meta.url),
).replace(/\\/g, "/");

// The command cut into simple commands: [start, end, separator after], quotes respected
function segments(command) {
  const out = [];
  let start = 0,
    quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"') i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    const two = command.slice(i, i + 2);
    const sep =
      two === "&&" || two === "||" ? two : "\n;|".includes(c) ? c : "";
    if (sep) {
      out.push([start, i, sep]);
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push([start, command.length, ""]);
  return out;
}

// Words of one simple command as { raw, value }, or null when it holds a variable or other shell code
function words(text) {
  if (
    /[$`]/.test(text) ||
    /[(){}<>&]/.test(text.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, ""))
  )
    return null;
  const list = [];
  const re = /\s*((?:'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"])+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1].startsWith("#")) break;
    list.push({
      raw: m[1],
      value: m[1].replace(
        /'([^']*)'|"((?:\\.|[^"\\])*)"/g,
        (_, a, b) => a ?? b.replace(/\\(.)/g, "$1"),
      ),
    });
  }
  return list;
}

const nameFrom = (url) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop());
  } catch {
    return "";
  }
};
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);

// { url, outRaw | outName } for a download the downloader can do, or null
function curl(ws) {
  const NO_ARG = new Set([
    "--location",
    "--silent",
    "--show-error",
    "--fail",
    "--fail-with-body",
    "--progress-bar",
    "--no-progress-meter",
    "--globoff",
    "--create-dirs",
    "--remote-name",
  ]);
  const urls = [];
  let out = null,
    remote = false;
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i].value;
    if (w === "--output") {
      if (!ws[i + 1]) return null;
      out = ws[++i];
    } else if (w === "--url") {
      if (!ws[i + 1]) return null;
      urls.push(ws[++i]);
    } else if (w === "--retry" || w === "--retry-delay") i++;
    else if (w === "--continue-at") {
      if (ws[++i]?.value !== "-") return null;
    } else if (NO_ARG.has(w)) remote ||= w === "--remote-name";
    else if (/^-[^-]/.test(w)) {
      for (let k = 1; k < w.length; k++) {
        const c = w[k];
        if ("sSLfg#".includes(c)) continue;
        if (c === "O") {
          remote = true;
          continue;
        }
        if (c !== "o" && c !== "C") return null;
        const rest = w.slice(k + 1);
        const arg = rest ? { raw: null, value: rest } : ws[++i];
        if (!arg) return null;
        if (c === "C" && arg.value !== "-") return null;
        if (c === "o") out = arg;
        break;
      }
    } else if (isUrl(w)) urls.push(ws[i]);
    else return null;
  }
  if (urls.length !== 1 || (out ? remote : !remote) || out?.value === "-")
    return null;
  return out
    ? { url: urls[0], out }
    : { url: urls[0], outName: nameFrom(urls[0].value) };
}

function wget(ws) {
  const NO_ARG = new Set([
    "-q",
    "--quiet",
    "-c",
    "--continue",
    "-nv",
    "--no-verbose",
    "--show-progress",
  ]);
  const urls = [];
  let out = null;
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i].value;
    if (w === "-O" || w === "--output-document") {
      if (!ws[i + 1]) return null;
      out = ws[++i];
    } else if (/^-O./.test(w)) out = { raw: null, value: w.slice(2) };
    else if (w.startsWith("--output-document="))
      out = { raw: null, value: w.slice(18) };
    else if (NO_ARG.has(w) || w.startsWith("--progress=")) continue;
    else if (isUrl(w)) urls.push(ws[i]);
    else return null;
  }
  if (urls.length !== 1 || out?.value === "-") return null;
  return out
    ? { url: urls[0], out }
    : { url: urls[0], outName: nameFrom(urls[0].value) };
}

function iwr(ws) {
  let url = null,
    out = null;
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i].value.toLowerCase();
    if (w === "-uri") {
      if (!ws[i + 1]) return null;
      url = ws[++i];
    } else if (w === "-outfile") {
      if (!ws[i + 1]) return null;
      out = ws[++i];
    } else if (w === "-usebasicparsing") continue;
    else if (!url && isUrl(ws[i].value)) url = ws[i];
    else return null;
  }
  return url && out && isUrl(url.value) ? { url, out } : null;
}

const TOOLS = {
  curl,
  "curl.exe": curl,
  wget,
  "wget.exe": wget,
  "invoke-webrequest": iwr,
  iwr,
};

async function size(url) {
  try {
    const r = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "claude-download-guard" },
      signal: AbortSignal.timeout(HEAD_MS),
    });
    const len = Number(r.headers.get("content-length"));
    return r.ok && len > 0 ? len : null;
  } catch {
    return null;
  }
}

runHook("download-guard", async (event) => {
  const shell = event.tool_name;
  const command = (event.tool_input || {}).command;
  if (!["Bash", "PowerShell"].includes(shell) || typeof command !== "string")
    return;
  const quote = (v) =>
    `'${v.replace(/'/g, shell === "PowerShell" ? "''" : "'\\''")}'`;

  const found = [];
  const segs = segments(command);
  segs.forEach(([start, end, sep], i) => {
    if (sep === "|" || segs[i - 1]?.[2] === "|") return; // piped: the output goes somewhere else
    const ws = words(command.slice(start, end));
    const parse = ws?.length && TOOLS[ws[0].value.toLowerCase()];
    const dl = parse && parse(ws);
    if (!dl) return;
    if (dl.outName !== undefined && !/^[\w.+%-]+$/.test(dl.outName)) return;
    if (/^(\/dev\/null|nul(\.\w*)?:?|\\\\\.\\nul)$/i.test(dl.out?.value ?? ""))
      return; // thrown away: a speed or reach test, not a download
    found.push({ start, end, dl });
  });
  if (!found.length) return;

  const sizes = await Promise.all(found.map((f) => size(f.dl.url.value)));
  const big = found
    .map((f, i) => ({ ...f, bytes: sizes[i] }))
    .filter((f) => f.bytes > BIG);
  if (!big.length) return;

  let rewritten = command;
  for (const { start, end, dl } of [...big].reverse()) {
    const text = command.slice(start, end);
    const lead = text.match(/^\s*/)[0];
    const out = dl.out
      ? (dl.out.raw ?? quote(dl.out.value))
      : quote(dl.outName);
    rewritten =
      rewritten.slice(0, start) +
      `${lead}node "${WORKER}" ${dl.url.raw} ${out}` +
      rewritten.slice(end);
  }
  // command-explain's check: a last line of at least 3 words after an empty line, else its stand-in
  const lines = command.trim().split(/\r?\n/);
  const note =
    (lines[lines.length - 1].trim().match(NOTE_LINE_RE) || [])[1] || "";
  const noted =
    note.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 3 &&
    lines.length > 1 &&
    lines[lines.length - 2].trim() === "";
  if (!noted && (process.env.COMMAND_EXPLAIN || "").toLowerCase() !== "off") {
    rewritten = `${rewritten.trimEnd()}\n\n${WHAT_THIS_DOES} ${NO_NOTE} ${command.replace(/\s+/g, " ").trim().slice(0, 60)}`;
  }
  const what = big
    .map((f) => `${f.dl.url.value} (${(f.bytes / 1e6).toFixed(0)} MB)`)
    .join(", ");
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...event.tool_input, command: rewritten },
        additionalContext: `[download-guard] The download of ${what} was rewritten to run through workers/download.mjs, which fetches byte ranges side by side and prints the sha256. Use it directly for big files: node "${WORKER}" <url> <out> [--sha256 <hex>].`,
      },
    }),
  );
});
