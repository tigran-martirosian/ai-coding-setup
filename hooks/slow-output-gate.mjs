#!/usr/bin/env node
// slow-output-gate: PreToolUse hook on Bash and PowerShell. Refuses a command that will run for
// minutes (its own `timeout N` says so) when its output goes straight into a truncating filter
// (`| head`, `| tail`, `| Select-Object -First`) and nothing saves the full output first.
//
// Why (measured 2026-10-27): a one-line status question - is the server up, and on which build -
// was answered with `timeout 420 python deploy.py plan | tail -40`. The tail cut off the part that
// mattered, so the same multi-minute command was run again from scratch: six minutes of waiting for
// an answer two API calls could give in seconds. Output that cost minutes is written to a file once and then read as
// often as needed; a filter put in front of the file costs nothing to rerun.
//
// This gate is only about not throwing expensive output away. Picking the cheap call in the first
// place is a rule, not a hook: a status or read question is answered with the cheapest call that
// answers it, and a project that owns a slow script records its fast read in its own CLAUDE.md.
//
// Off switch: SLOW_OUTPUT_GATE=off. Threshold: SLOW_OUTPUT_GATE_SECONDS (default 120).

const DEFAULT_SECONDS = 120;
const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

// `timeout 420 cmd`, `timeout 7m cmd`, `timeout -k 10 300 cmd`, `timeout --signal=KILL 600 cmd`.
const TIMEOUT = /(?:^|[\s;&|(])timeout\s+((?:-\S+(?:\s+\S+)?\s+)*)(\d+)([smhd])?(?=\s|$)/i;

// Filters that keep only part of what they are given: rerunning the slow command is the only way back.
// `tail -n +N` and `tail +N` start at line N and keep the rest, so they throw nothing away.
const TRUNCATING = /(?:^|\s)head\b|(?:^|\s)tail\b(?!\s+(?:-n\s*)?\+\d)|(?:^|\s)(?:Select-Object|Select)\s+(?:-\w+\s+)*-(?:First|Last)\b/i;

// A redirect or tee that keeps the whole output somewhere readable. `/dev/null` and `$null` keep nothing.
const SAVES = /(?:&>>?|\d?>>?)\s*(?!\/dev\/null|NUL\b|\$null)[^\s|&;]+|(?:^|\s)tee\s+(?:-a\s+)?(?!\/dev\/null)[^\s|&;]+|(?:^|\s)Tee-Object\b/i;

// A group, subshell or loop whose own output is redirected to a file keeps everything its statements
// print, however each one is filtered inside: `{ for f in *; do slow | tail -3; done; } > all.txt`.
const GROUP_SAVES = /(?:\}|\)|done|fi)\s*(?:&>>?|\d?>>?)\s*(?!\/dev\/null|\$null|NUL\b)[^\s|&;]+/i;

export const limit = () => {
  const n = Number(process.env.SLOW_OUTPUT_GATE_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SECONDS;
};

// Seconds the command gives itself, or 0 when it sets no timeout.
export function declaredSeconds(statement) {
  const m = TIMEOUT.exec(statement);
  if (!m) return 0;
  return Number(m[2]) * (UNITS[(m[3] || "s").toLowerCase()] ?? 1);
}

// The offending statement, or "" when the command is fine.
// A shell line holds several statements (`a && b; c`), and only the slow one is judged.
export function offending(command, seconds = limit()) {
  if (typeof command !== "string" || !command) return "";
  if (GROUP_SAVES.test(command)) return "";
  for (const statement of command.split(/&&|\|\||[;\n]/)) {
    if (!statement.trim()) continue;
    if (declaredSeconds(statement) < seconds) continue;
    const segments = statement.split("|");
    const cut = segments.findIndex((seg, i) => i > 0 && TRUNCATING.test(seg));
    if (cut === -1) continue;
    // Only a save that happens before the filter keeps the whole output: `slow | tail -5 > out.txt`
    // saves the five lines, not the run.
    if (segments.slice(0, cut).some((seg) => SAVES.test(seg))) continue;
    const s = statement.trim();
    return s.length > 160 ? `${s.slice(0, 160)}...` : s;
  }
  return "";
}

export const reason = (stmt, seconds = limit()) => [
  `[slow-output-gate] This command gives itself ${seconds}s or more and then pipes its output into a`,
  `filter that keeps only part of it. If the kept part turns out to be the wrong part, the only way`,
  `back is to run the whole thing again.`,
  `  blocked: ${stmt}`,
  ``,
  `Save it once, then read it as often as you like:`,
  `  <the slow command> > out.txt 2>&1; echo "exit $?"; grep -nE "<what you want>" out.txt | head -40`,
  `(PowerShell: ... | Tee-Object out.txt | Select-Object -First 40)`,
  ``,
  `Before rerunning it at all: is this the cheapest call that answers the question? A status or read`,
  `question usually has a one-call answer, and a project with a slow script names its fast read in its`,
  `own CLAUDE.md. A full diff or deploy dry run is not a status check.`,
  ``,
  `Off switch: SLOW_OUTPUT_GATE=off (threshold: SLOW_OUTPUT_GATE_SECONDS)`,
].join("\n");

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if ((process.env.SLOW_OUTPUT_GATE || "").toLowerCase() === "off") return;
      const input = JSON.parse(raw);
      const stmt = offending(input.tool_input?.command);
      if (!stmt) return;
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason(stmt),
        },
      }));
    } catch {
      // fail open
    }
  });
}
