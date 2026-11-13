// Test for hooks/nimbalyst-notes.mjs: notes in Nimbalyst (sdk entrypoint), silent in the
// terminal and when switched off.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(
  new URL("../hooks/nimbalyst-notes.mjs", import.meta.url),
);
let fail = 0;
const run = (env, event = {}) =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, NIMBALYST_NOTES: "", ...env },
  });
const contextOf = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  } catch {
    return "";
  }
};
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) fail++;
};

const sdk = run({ CLAUDE_CODE_ENTRYPOINT: "sdk-ts" });
let ctx = "";
try {
  ctx = JSON.parse(sdk.stdout).hookSpecificOutput.additionalContext;
} catch {}
check(
  "sdk: quirks note",
  ctx.includes("UnknownVizError") && ctx.includes("`shown` folder"),
);
check(
  "sdk: board note",
  ctx.includes("Keep the Nimbalyst board honest") &&
    ctx.includes("isolated: true"),
);
check(
  "sdk: helper-name note",
  ctx.includes("Kind: what exactly") && ctx.includes("# WHAT THIS DOES:"),
);
check(
  "sdk: board call goes with another call",
  ctx.includes("never alone before the final reply"),
);
check(
  "sdk: browser note stays",
  ctx.includes("The Nimbalyst browser never shows a window") &&
    ctx.includes("site-login"),
);
// One question line (user, 2026-11-12): a card for a quick yes/no or pick-one, the big form for a draft, a reorder or
// many fields, anything else in the reply; the card layout rule stays in the same line
const questionLines = ctx
  .split("\n")
  .filter((l) => l.includes("AskUserQuestion") || l.includes("wall of text"));
check(
  "sdk: question note: a card for a quick yes/no or pick-one, the form only for a draft, a reorder or many fields, the rest in the reply",
  ctx.includes(
    "quick yes/no or pick-one goes on `mcp__nimbalyst__AskUserQuestion`",
  ) &&
    ctx.includes("only for a draft to edit, a reorder or many fields") &&
    ctx.includes("Anything else is written in the reply"),
);
check(
  "sdk: question note: a typing box on every form question",
  ctx.includes("allowOther: true") &&
    ctx.includes("right after each multiSelect"),
);
check(
  "sdk: the card and layout notes are one line now",
  questionLines.length === 1 &&
    !ctx.includes("Ask on the question card") &&
    !ctx.includes("Lay a card out"),
);
// A form without a typing box is no longer refused (user, 2026-11-12), and there is no cap on questions per card
check(
  "sdk: no refusal, no cap",
  !ctx.includes("is refused") &&
    !ctx.includes("sees it twice") &&
    !/at most \d+ questions/.test(ctx),
);
check(
  "sdk: card layout: a short question line, context in a few short sentences, never a wall of text, no bullets promised",
  ctx.includes("never a wall of text") &&
    ctx.includes("one short sentence") &&
    ctx.includes("a card shows no line breaks or bullets"),
);

// The unrelated-requests note: the home path from the folder holding quick-tasks, found from a worktree inside a project
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nimbalyst-notes-"));
const projects = path.join(tmp, "Projects");
fs.mkdirSync(path.join(projects, "quick-tasks"), { recursive: true });
const worktree = path.join(projects, "game", ".claude", "worktrees", "lane");
fs.mkdirSync(worktree, { recursive: true });
const homes = contextOf(
  run({ CLAUDE_CODE_ENTRYPOINT: "sdk-ts" }, { cwd: worktree }),
);
check(
  "sdk: unrelated requests go to Quick Tasks",
  homes.includes("Unrelated requests go to Quick Tasks") &&
    homes.includes("`workspace_open`") &&
    homes.includes("writes no files there") &&
    homes.includes(
      "General questions, finding things on the internet and one-off file jobs all go there",
    ),
);
check(
  "sdk: the home path from the projects folder",
  homes.includes("`" + path.join(projects, "quick-tasks") + "`"),
);
check(
  "sdk: handoff with the exact prompt",
  homes.includes("`~/.claude/handoffs/`") &&
    homes.includes("exact prompt to paste"),
);
const outside = path.join(tmp, "elsewhere");
fs.mkdirSync(outside);
const fakeHome = path.join(tmp, "home");
fs.mkdirSync(path.join(fakeHome, ".claude"), { recursive: true });
const homeEnv = {
  CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
  HOME: fakeHome,
  USERPROFILE: fakeHome,
};
const noRoot = contextOf(run(homeEnv, { cwd: outside }));
check(
  "sdk: no homes installed -> no unrelated-requests line, other notes stay",
  !noRoot.includes("Unrelated requests") && noRoot.includes("UnknownVizError"),
);
fs.writeFileSync(
  path.join(fakeHome, ".claude", "setup-state.json"),
  JSON.stringify({ projects }),
);
const fromState = contextOf(run(homeEnv, { cwd: outside }));
check(
  "sdk: projects folder from the installer's setup-state.json",
  fromState.includes("`" + path.join(projects, "quick-tasks") + "`"),
);
fs.rmSync(tmp, { recursive: true, force: true });
check("cli: silent", run({ CLAUDE_CODE_ENTRYPOINT: "cli" }).stdout === "");
check(
  "off: silent",
  run({ CLAUDE_CODE_ENTRYPOINT: "sdk-ts", NIMBALYST_NOTES: "off" }).stdout ===
    "",
);

console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
