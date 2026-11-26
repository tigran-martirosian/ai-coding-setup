// Tests for `brief.mjs --should` (skills/handoff), which tells a lead session at a merged slice whether to hand off
// to a fresh session: once the chat has compacted, or its context reached 150k tokens.
// Run: node tests/test-handoff-should.mjs
// Uses a throwaway home folder and small transcripts built here; the real ~/.claude is never read.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT =
  process.env.HANDOFF_BRIEF ||
  fileURLToPath(new URL("../skills/handoff/brief.mjs", import.meta.url));
const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "handoff-should-test-")),
);
const home = path.join(tmp, "home");
const proj = path.join(tmp, "proj");
fs.mkdirSync(proj, { recursive: true });
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  CLAUDE_CODE_SESSION_ID: "",
};

// A transcript of `turns` user/assistant pairs; the last reply sent `usage`, earlier ones less. `compacted` puts
// Claude Code's compaction marker and its summary in the middle.
function transcript(file, { turns, usage, compacted = false }) {
  const lines = [];
  for (let i = 0; i < turns; i++) {
    if (compacted && i === Math.floor(turns / 2))
      lines.push(
        {
          type: "system",
          subtype: "compact_boundary",
          compactMetadata: { trigger: "auto", preTokens: 197000 },
        },
        { type: "user", isCompactSummary: true, message: { content: "sum" } },
      );
    lines.push(
      { type: "user", cwd: proj, message: { content: `request ${i}` } },
      {
        type: "assistant",
        cwd: proj,
        message: {
          model: "m",
          usage: i === turns - 1 ? usage : { input_tokens: 1000 + i },
          content: [{ type: "text", text: `reply ${i}` }],
        },
      },
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}
const should = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--should", ...args], {
    cwd: proj,
    env: { ...env, ...extraEnv },
  });
  return {
    status: r.status,
    out: r.stdout.toString().trim(),
    err: r.stderr.toString().trim(),
  };
};
// One line: the verdict, then its reason
const verdict = (r, word) =>
  r.status === 0 &&
  !r.out.includes("\n") &&
  new RegExp(`^${word}: \\S.*`).test(r.out);

let fails = 0;
const check = (name, ok, r) => {
  if (!ok) fails++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: exit ${r.status}, out "${r.out}", err "${r.err}"`}`,
  );
};

const compacted = should([
  transcript(path.join(tmp, "compacted.jsonl"), {
    turns: 6,
    usage: { input_tokens: 30000 },
    compacted: true,
  }),
]);
check(
  "a chat that compacted once hands off at a merged slice, though its context is small",
  verdict(compacted, "hand off") && /compact/i.test(compacted.out),
  compacted,
);

// input + cache read + cache creation: 2k + 150k + 8k
const big = should([
  transcript(path.join(tmp, "big.jsonl"), {
    turns: 10,
    usage: {
      input_tokens: 2000,
      cache_read_input_tokens: 150000,
      cache_creation_input_tokens: 8000,
    },
  }),
]);
check(
  "a chat whose last turn sent 160k tokens (input + cache read + cache creation) hands off with no compaction",
  verdict(big, "hand off") && /160k/.test(big.out),
  big,
);

const small = should([
  transcript(path.join(tmp, "small.jsonl"), {
    turns: 20,
    usage: { input_tokens: 1000, cache_read_input_tokens: 89000 },
  }),
]);
check(
  "a 40-message chat at 90k with no compaction stays",
  verdict(small, "stay") && /90k/.test(small.out),
  small,
);

const missing = should([path.join(tmp, "nope.jsonl")]);
check(
  "a missing transcript stops with exit 1 and an error naming it, with no verdict",
  missing.status === 1 &&
    missing.err.includes("nope.jsonl") &&
    !/^(hand off|stay)/m.test(missing.out),
  missing,
);

// No path given: this session's own transcript, found by CLAUDE_CODE_SESSION_ID as the brief finds it
const id = "dddddddd-2222-3333";
transcript(
  path.join(
    home,
    ".claude",
    "projects",
    proj.replace(/[^A-Za-z0-9]/g, "-"),
    `${id}.jsonl`,
  ),
  {
    turns: 3,
    usage: { input_tokens: 1000, cache_read_input_tokens: 170000 },
  },
);
const own = should([], { CLAUDE_CODE_SESSION_ID: id });
check(
  "with no path it reads this session's own transcript, found by its session id",
  verdict(own, "hand off") && /171k/.test(own.out),
  own,
);
const unknown = should([], { CLAUDE_CODE_SESSION_ID: "eeeeeeee-9999" });
check(
  "with no path and no transcript for this session it stops with exit 1 instead of guessing",
  unknown.status === 1 &&
    unknown.err.includes("eeeeeeee-9999") &&
    !/^(hand off|stay)/m.test(unknown.out),
  unknown,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
