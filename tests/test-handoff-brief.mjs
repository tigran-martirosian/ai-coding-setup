// Tests for hooks/handoff-brief.mjs. Run: node tests/test-handoff-brief.mjs
// Uses a throwaway home folder, so the real ~/.claude/handoffs is never touched.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT =
  process.env.HANDOFF_BRIEF ||
  fileURLToPath(new URL("../hooks/handoff-brief.mjs", import.meta.url));
// resolved: on macOS the temp folder is a symlink (/var -> /private/var), and a child run in it sees the resolved
// path, so a project key built from the unresolved one would never match
const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "handoff-test-")),
);
const home = path.join(tmp, "home");
const handoffs = path.join(home, ".claude", "handoffs");
fs.mkdirSync(home, { recursive: true });
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  HANDOFF_HOOK: "",
  CLAUDE_CODE_SESSION_ID: "",
};

// Two projects with the same folder name, and one with its own name
const projA = path.join(tmp, "a", "proj");
const projB = path.join(tmp, "b", "proj");
const projC = path.join(tmp, "other");
for (const p of [projA, projB, projC]) fs.mkdirSync(p, { recursive: true });

function transcript(id, cwd, request, reply) {
  const file = path.join(tmp, `${id}.jsonl`);
  const lines = [
    { type: "user", cwd, message: { content: request } },
    {
      type: "assistant",
      cwd,
      message: {
        model: "m",
        usage: { input_tokens: 1200 },
        content: [{ type: "text", text: reply }],
      },
    },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}
const hook = (file, cwd) =>
  spawnSync(process.execPath, [SCRIPT, "--hook"], {
    input: JSON.stringify({ transcript_path: file, cwd }),
    env,
  });
const read = (name) => {
  try {
    return fs.readFileSync(path.join(handoffs, name), "utf8");
  } catch {
    return null;
  }
};
const names = () => fs.readdirSync(handoffs).sort();

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`);
};

const tA = transcript(
  "aaaaaaaa-1111",
  projA,
  "request from project A",
  "reply A",
);
const tA2 = transcript(
  "eeeeeeee-1111",
  projA,
  "second session in project A",
  "reply A2",
);
const tB = transcript(
  "bbbbbbbb-1111",
  projB,
  "request from project B",
  "reply B",
);
const tC = transcript("cccccccc-1111", projC, "x".repeat(2000), "reply C");

check("hook run exits 0", hook(tA, projA).status === 0);
check(
  "first project gets the plain name",
  read("proj-latest.md")?.includes("request from project A"),
  names().join(", "),
);
check(
  "its per-session brief exists",
  names().includes("proj-auto-aaaaaaaa.md"),
  names().join(", "),
);

hook(tB, projB);
const bLatest = names().find((n) => /^proj-[0-9a-f]{6}-latest\.md$/.test(n));
check(
  "same-named project gets its own latest file",
  !!bLatest,
  names().join(", "),
);
check(
  "that file holds project B",
  !!bLatest && read(bLatest).includes("request from project B"),
);
check(
  "project A's latest is not overwritten",
  read("proj-latest.md")?.includes("request from project A") &&
    !read("proj-latest.md").includes("project B"),
);
check(
  "project B's per-session brief has the same prefix",
  names().some((n) => /^proj-[0-9a-f]{6}-auto-bbbbbbbb\.md$/.test(n)),
  names().join(", "),
);

hook(tB, projB);
check(
  "a second run for B reuses its name",
  names().filter((n) => /^proj-[0-9a-f]{6}-latest\.md$/.test(n)).length === 1,
  names().join(", "),
);

hook(tA2, projA);
const aLatest = read("proj-latest.md") ?? "";
check(
  "A's latest follows A's newest session",
  aLatest.includes("second session in project A"),
);
check(
  "A's latest lists A's other session",
  aLatest.includes("proj-auto-aaaaaaaa.md"),
);
check("A's latest does not list B's session", !aLatest.includes("bbbbbbbb"));

// A brief written under the plain prefix by project B before the names were split
fs.writeFileSync(
  path.join(handoffs, "proj-auto-dddddddd.md"),
  `# Handoff: proj\n\nFrom session \`d\`.\nProject folder: \`${projB}\`. Follow its CLAUDE.md.\n\n## First request (the goal)\n\nold request from B\n`,
);
hook(tA2, projA);
check(
  "an old same-prefix brief from B is left out of A's list",
  !read("proj-latest.md").includes("dddddddd"),
);

// A manual brief needs the summary first: without one, or with a nearly empty one, nothing is written
const briefs = () =>
  names().filter((n) => /-\d{8}-\d{4}-[\w-]{8}\.md$/.test(n)).length;
// The session writes its summary with the Write tool, so its transcript shows it (as /handoff does)
const writeLine = (cwd, file, content) =>
  JSON.stringify({
    type: "assistant",
    cwd,
    message: {
      model: "m",
      content: [
        {
          type: "tool_use",
          name: "Write",
          input: { file_path: file, content },
        },
      ],
    },
  }) + "\n";
const summarise = (file, t, cwd, text) => {
  fs.writeFileSync(file, text);
  fs.appendFileSync(t, writeLine(cwd, file, text));
};
const bare = spawnSync(
  process.execPath,
  [SCRIPT, "--transcript", tB, "--cwd", projB],
  { env },
);
check(
  "a manual run without a summary writes no brief and says why",
  bare.status === 1 &&
    briefs() === 0 &&
    /summary is missing.*--summary/.test(bare.stdout.toString()),
  bare.stdout.toString(),
);
const summaryFile = path.join(tmp, "summary.md");
fs.writeFileSync(summaryFile, "- todo\n");
const thin = spawnSync(
  process.execPath,
  [SCRIPT, "--summary", summaryFile, "--transcript", tB, "--cwd", projB],
  { env },
);
check(
  "a nearly empty summary writes no brief either",
  thin.status === 1 &&
    briefs() === 0 &&
    thin.stdout.toString().includes("nearly empty"),
  thin.stdout.toString(),
);
fs.writeFileSync(
  summaryFile,
  "- Goal: move the orders importer to the new schema.\n- Done: the reader, 12 tests pass.\n",
);
const notMine = spawnSync(
  process.execPath,
  [SCRIPT, "--summary", summaryFile, "--transcript", tB, "--cwd", projB],
  { env },
);
check(
  "a summary this session's transcript never wrote writes no brief",
  notMine.status === 1 &&
    briefs() === 0 &&
    /was not written by session bbbbbbbb/.test(notMine.stderr.toString()),
  notMine.stderr.toString(),
);
summarise(
  summaryFile,
  tB,
  projB,
  "- Goal: move the orders importer to the new schema.\n- Done: the reader, 12 tests pass.\n",
);
const manual = spawnSync(
  process.execPath,
  [SCRIPT, "--summary", summaryFile, "--transcript", tB, "--cwd", projB],
  { env },
);
const printed = manual.stdout.toString().trim();
check(
  "manual run for B prints a path with B's name and session",
  /proj-[0-9a-f]{6}-\d{8}-\d{4}-bbbbbbbb\.md$/.test(printed),
  printed + manual.stderr.toString(),
);
const manualBrief = fs.existsSync(printed)
  ? fs.readFileSync(printed, "utf8")
  : "";
check(
  "the summary is in the brief under Where we are, with no placeholder left",
  /## Where we are\n\n- Goal: move the orders importer[^\n]*\n- Done: the reader, 12 tests pass\.\n\n## First request/.test(
    manualBrief,
  ) && !manualBrief.includes("<!--"),
  manualBrief.slice(0, 400),
);
check("the summary file is gone afterwards", !fs.existsSync(summaryFile));
check(
  "a summary with nothing owed gets no Ask the user first section",
  !manualBrief.includes("## Ask the user first"),
);

// The case behind it: an untangle job trimmed to 12 of 23 fixes asked "all 23 or the trim?" and handed
// off; the next session read past the question, asked other things and called the job finished.
summarise(
  summaryFile,
  tB,
  projB,
  [
    "- **Goal:** untangle the whole mod per the decision log (F1-F23).",
    "- **Done and verified:** F2, F4-F10, F21, F23; 865 game tests ran, one known failure.",
    "- **Proposed by Claude, not confirmed:** the trim to F2, F4-F10, F21, F23 (F11-F20, F22 not started).",
    "- **User still owes:** (1) all 23 fixes or the trim;",
    "  (2) approval to delete the old tools/ logs.",
    "- **Next step:** WF5, then one reviewer.",
  ].join("\n") + "\n",
);
const owedRun = spawnSync(
  process.execPath,
  [SCRIPT, "--summary", summaryFile, "--transcript", tB, "--cwd", projB],
  { env },
);
const owedPath = owedRun.stdout.toString().trim();
const owedBrief = fs.existsSync(owedPath)
  ? fs.readFileSync(owedPath, "utf8")
  : "";
const askAt = owedBrief.indexOf("## Ask the user first"),
  whereAt = owedBrief.indexOf("## Where we are");
check(
  "an unanswered question goes to an Ask the user first section above Where we are",
  askAt > 0 && askAt < whereAt,
  owedBrief.slice(0, 600),
);
const askPart = owedBrief.slice(askAt, whereAt);
check(
  "the section holds every owed item, the indented one too, and forbids a finished claim",
  askPart.includes("all 23 fixes or the trim") &&
    askPart.includes("approval to delete the old tools/ logs") &&
    /don't call the work finished/.test(askPart),
  askPart,
);
summarise(
  summaryFile,
  tB,
  projB,
  "- Goal: move the orders importer to the new schema.\n- User still owes: nothing.\n",
);
const noneRun = spawnSync(
  process.execPath,
  [SCRIPT, "--summary", summaryFile, "--transcript", tB, "--cwd", projB],
  { env },
);
const nonePath = noneRun.stdout.toString().trim();
check(
  '"User still owes: nothing" adds no section',
  fs.existsSync(nonePath) &&
    !fs.readFileSync(nonePath, "utf8").includes("## Ask the user first"),
);
const skillText = fs.readFileSync(
  path.join(path.dirname(SCRIPT), "..", "skills", "handoff", "SKILL.md"),
  "utf8",
);
check(
  "the handoff skill's continue prompt asks the owed items first",
  /Ask the user everything under "Ask the user first" before any other question, and don't call the work finished while one is open/.test(
    skillText,
  ),
);

hook(tC, projC);
const c = read("other-latest.md") ?? "";
check(
  "a project with its own name keeps <folder>-latest.md",
  c.includes("Project folder: `" + projC + "`"),
);
check(
  "a long request is cut with a single … character",
  c.includes("x".repeat(1500) + " …\n") && !c.includes("�"),
);

const off = spawnSync(process.execPath, [SCRIPT, "--hook"], {
  input: JSON.stringify({ transcript_path: tA, cwd: projA }),
  env: {
    ...env,
    HANDOFF_HOOK: "off",
    USERPROFILE: path.join(tmp, "home2"),
    HOME: path.join(tmp, "home2"),
  },
});
check(
  "HANDOFF_HOOK=off writes nothing",
  off.status === 0 && !fs.existsSync(path.join(tmp, "home2", ".claude")),
);
check(
  "bad hook input is ignored",
  spawnSync(process.execPath, [SCRIPT, "--hook"], { input: "not json", env })
    .status === 0,
);

// Latest requests hold only what the user typed: child reports, forwarded reports, task notifications and system injections are left out
const projD = path.join(tmp, "d", "typed");
fs.mkdirSync(projD, { recursive: true });
const tD = path.join(tmp, "dddddddd-1111.jsonl");
const userLine = (text) => ({
  type: "user",
  cwd: projD,
  message: { content: text },
});
fs.writeFileSync(
  tD,
  [
    userLine("first goal typed by the user"),
    userLine(
      "[Child Session Update]\nSession: lane 2\nDone: the deploy script works.",
    ),
    userLine("typed follow-up one"),
    userLine("[report] a forwarded child report"),
    userLine("<task-notification>job finished</task-notification>"),
    userLine("[SYSTEM NOTIFICATION - not from the user] x"),
    userLine("<system-reminder>hook text</system-reminder>"),
    userLine("typed follow-up two"),
    userLine(
      "A child session's report was forwarded to you from the session you took over from. It reaches you as a note at your first step.",
    ),
    userLine(
      "A message that reached the session you took over from was forwarded to you; most likely the user typed it there. It reaches you as a note at your first step.",
    ),
    {
      type: "assistant",
      cwd: projD,
      message: {
        model: "m",
        usage: { input_tokens: 1200 },
        content: [{ type: "text", text: "reply D" }],
      },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n") + "\n",
);
hook(tD, projD);
const d = read("typed-latest.md") ?? "";
const latestPart =
  d
    .split("## Latest requests (oldest first)")[1]
    ?.split("## Files edited")[0] ?? "";
check(
  "typed prompts are in the latest requests",
  latestPart.includes("typed follow-up one") &&
    latestPart.includes("typed follow-up two"),
  latestPart,
);
check(
  "the first request is the user's own",
  d
    .split("## First request (the goal)")[1]
    ?.startsWith("\n\nfirst goal typed by the user"),
);
check(
  "no child update, report, notification or reminder is in the brief",
  !/Child Session Update|forwarded child report|task-notification|SYSTEM NOTIFICATION|hook text|deploy script works/.test(
    d,
  ),
  d,
);

check(
  "steer's own wake prompts are not in the brief",
  !/was forwarded to you/.test(d),
  d,
);

// Two chats in one folder hand off in the same minute (before the fix one brief
// came from the other chat's transcript, both new sessions did the same work and the first chat's work was lost). Each run knows its
// session from CLAUDE_CODE_SESSION_ID, as Claude Code sets it for Bash commands.
const projE = path.join(tmp, "e", "both");
const keyDir = path.join(
  home,
  ".claude",
  "projects",
  projE.replace(/[^A-Za-z0-9]/g, "-"),
);
for (const p of [projE, keyDir]) fs.mkdirSync(p, { recursive: true });
const chats = [
  ["aaaa1111-1111-2222", "poster", "draw the event poster"],
  ["bbbb2222-3333-4444", "report", "write the monthly report"],
].map(([id, word, goal]) => {
  const t = path.join(keyDir, `${id}.jsonl`),
    summary = path.join(handoffs, `summary-${word}.md`);
  const text = `- Goal: ${goal}.\n- Next step: the ${word} part, ${word} only.\n`;
  fs.writeFileSync(
    t,
    JSON.stringify({ type: "user", cwd: projE, message: { content: goal } }) +
      "\n",
  );
  summarise(summary, t, projE, text);
  return { id, goal, summary, text };
});
const runAsync = (argv, extraEnv) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...argv], {
      cwd: projE,
      env: { ...env, ...extraEnv },
    });
    let out = "",
      err = "";
    p.stdout.on("data", (b) => {
      out += b;
    });
    p.stderr.on("data", (b) => {
      err += b;
    });
    p.on("close", (status) => resolve({ status, out: out.trim(), err }));
  });
const both = await Promise.all(
  chats.map((c) =>
    runAsync(["--summary", c.summary], { CLAUDE_CODE_SESSION_ID: c.id }),
  ),
);
check(
  "two handoffs at once both write a brief",
  both.every((r) => r.status === 0 && fs.existsSync(r.out)),
  both.map((r) => r.out + r.err).join(" | "),
);
check(
  "the two briefs are separate files",
  both[0].out !== both[1].out,
  both.map((r) => r.out).join(" | "),
);
both.forEach((r, i) => {
  const c = chats[i],
    other = chats[1 - i],
    text = fs.existsSync(r.out) ? fs.readFileSync(r.out, "utf8") : "";
  check(
    `chat ${c.id.slice(0, 8)}'s brief is named after its session`,
    path.basename(r.out).includes(c.id.slice(0, 8)),
    r.out,
  );
  check(
    `chat ${c.id.slice(0, 8)}'s brief has its own transcript and First request`,
    text.includes(`From session \`${c.id}\``) &&
      text.split("## First request (the goal)\n\n")[1]?.startsWith(c.goal),
    text.slice(0, 500),
  );
  check(
    `chat ${c.id.slice(0, 8)}'s brief has its own summary only`,
    text.includes(c.text.trim()) && !text.includes(other.text.trim()),
    text.slice(0, 500),
  );
  check(
    `chat ${c.id.slice(0, 8)}'s summary file is gone`,
    !fs.existsSync(c.summary),
  );
});

// The session unknown and two live transcripts in the folder: no guess, a clear error
summarise(
  chats[0].summary,
  path.join(keyDir, `${chats[0].id}.jsonl`),
  projE,
  chats[0].text,
);
const before = briefs();
const unknown = spawnSync(
  process.execPath,
  [SCRIPT, "--summary", chats[0].summary],
  { cwd: projE, env },
);
check(
  "with no session id and two live chats in the folder, no brief and a clear error",
  unknown.status === 1 &&
    briefs() === before &&
    /this session is unknown.*2 sessions.*--session/.test(
      unknown.stderr.toString(),
    ),
  unknown.stderr.toString(),
);
// One summary file shared by both chats: the other chat's text in it is refused, not used
const shared = path.join(handoffs, "summary.md");
summarise(
  shared,
  path.join(keyDir, `${chats[0].id}.jsonl`),
  projE,
  chats[0].text,
);
summarise(
  shared,
  path.join(keyDir, `${chats[1].id}.jsonl`),
  projE,
  chats[1].text,
);
const swapped = spawnSync(
  process.execPath,
  [SCRIPT, "--summary", shared, "--session", "aaaa1111"],
  { cwd: projE, env },
);
check(
  "--session picks the chat; a summary the other chat overwrote writes no brief",
  swapped.status === 1 &&
    briefs() === before &&
    /another session wrote the same file/.test(swapped.stderr.toString()),
  swapped.stderr.toString(),
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
