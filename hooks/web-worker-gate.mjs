#!/usr/bin/env node
// web-worker-gate: PreToolUse hook on Bash and PowerShell. Refuses `ask.mjs --web`, the free Gemini
// worker used for web research, and names what to use instead.
//
// Why (measured over 30 days of real use, 2026-10):
// 141 `ask.mjs --web` calls. 69 were launched in the background; of the 72 actually waited on, 43 gave
// a clean answer and 29 gave nothing usable (13 errors, 10 "no free worker", 1 partial, 5 near-empty).
// Median 224s, p90 307s, worst 509s, and 20 runs were cut off mid-search by agy's 5-minute ceiling.
// A head-to-head the same day: a version question took it 2m33s and still came back without the current
// minor version, while one WebFetch of the project's own page gave it exactly in seconds; a "find 12
// Forge 1.20.1 minimap mods" question burned 280s and returned nothing, while one Modrinth API call
// listed 30 in a second. It is better than WebSearch at breadth (10/10 named tools with URLs vs 3 and 6),
// so the lane worth reconsidering is a background run for breadth only - never for an exact fact.
//
// The worker keeps local file reading (`ask.mjs` with no --web), where it works and costs nothing.
// Off switch: WEB_WORKER_GATE=off.
const CMD = /(?:^|[\s;&|`(])(?:node\s+)?(?:[^\s;&|]*[\\/])?ask\.mjs(?:\s|$)/;
const WEB = /(?:^|\s)--web(?:\s|$)/;
// Text tools only ever mention the command, they never run it: `grep "ask.mjs --web" docs/`
const TEXT_TOOL = /^\s*(?:grep|rg|egrep|fgrep|echo|printf|cat|sed|awk|head|tail|less|more|wc|find|ls|dir|git\s+grep)\b/;

// Quoted runs are arguments, not commands, so they are taken out before the match - unless the quoted
// text is itself the path of the script being run (`node "C:/.../ask.mjs" --web ...`), which is kept.
export const stripQuotes = (s) =>
  s.replace(/"([^"]*)"|'([^']*)'/g, (whole, dq, sq) => {
    const inner = dq ?? sq ?? "";
    return /ask\.mjs$/.test(inner.trim()) ? inner : " ";
  });

// A command this hook refuses, or "" when it is fine.
// A shell line can hold several commands (`echo hi && node ask.mjs --web "x"`), so each part is judged
// on its own: exempting the whole line because it starts with `echo` let the real call through.
export function offending(command) {
  if (typeof command !== "string" || !command) return "";
  const bare = stripQuotes(command);
  for (const part of bare.split(/&&|\|\||[;|&\n]/)) {
    if (!part.trim() || TEXT_TOOL.test(part)) continue;
    if (!CMD.test(part) || !WEB.test(part)) continue;
    // `--status` only reports which workers exist; it runs no research
    if (/(?:^|\s)--status(?:\s|$)/.test(part)) continue;
    return command.length > 160 ? `${command.slice(0, 160)}...` : command;
  }
  return "";
}

export const reason = (cmd) => [
  `[web-worker-gate] This runs web research through the free Gemini worker, which is switched off for web work.`,
  `  blocked: ${cmd}`,
  ``,
  `Measured over 30 days here: of the 72 such calls that were waited on, 29 gave nothing usable and 20 were`,
  `cut off mid-search by its 5-minute ceiling; the median took 224s. Do the research yourself instead:`,
  ``,
  `1. A version, release or "does X exist" question -> never a search engine, never memory:`,
  `   node ~/.claude/workers/versions.mjs <target> [--has <version>]`,
  `   (postgresql | gh:owner/repo | npm:name | pypi:name | crates:name | docker:image | mvn:g:a | nuget:name)`,
  `2. A list of things from one site (mods, packages, packs, plugins) -> that site's own catalogue API,`,
  `   which returns every match at once: Modrinth, CurseForge, the npm/PyPI/crates registries, GitHub search.`,
  `3. A page whose answer you need -> WebFetch that URL.`,
  `4. Open-ended research -> WebSearch with mode "extended", several differently-worded queries in one`,
  `   message. A page that blocks a plain fetch: https://r.jina.ai/<full URL> returns it as text.`,
  `   Community opinion needs real forum threads, and a site like Reddit needs your own signed-in browser.`,
  `5. A genuinely long bulk job you are not waiting on -> the worker is still allowed without --web for`,
  `   local files, or run this same research in a background Bash command and carry on meanwhile.`,
  ``,
  `Off switch if you ever need the old path: WEB_WORKER_GATE=off`,
].join("\n");

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if ((process.env.WEB_WORKER_GATE || "").toLowerCase() === "off") return;
      const input = JSON.parse(raw);
      const cmd = offending(input.tool_input?.command);
      if (!cmd) return;
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason(cmd),
        },
      }));
    } catch {
      // fail open
    }
  });
}
