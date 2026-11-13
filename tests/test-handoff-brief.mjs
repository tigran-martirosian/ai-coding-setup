// Tests for hooks/handoff-brief.mjs. Run: node tests/test-handoff-brief.mjs
// Uses a throwaway home folder, so the real ~/.claude/handoffs is never touched.
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = process.env.HANDOFF_BRIEF || fileURLToPath(new URL("../hooks/handoff-brief.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-test-"));
const home = path.join(tmp, "home");
const handoffs = path.join(home, ".claude", "handoffs");
fs.mkdirSync(home, { recursive: true });
const env = { ...process.env, USERPROFILE: home, HOME: home, HANDOFF_HOOK: "" };

// Two projects with the same folder name, and one with its own name
const projA = path.join(tmp, "a", "proj");
const projB = path.join(tmp, "b", "proj");
const projC = path.join(tmp, "other");
for (const p of [projA, projB, projC]) fs.mkdirSync(p, { recursive: true });

function transcript(id, cwd, request, reply) {
  const file = path.join(tmp, `${id}.jsonl`);
  const lines = [
    { type: "user", cwd, message: { content: request } },
    { type: "assistant", cwd, message: { model: "m", usage: { input_tokens: 1200 }, content: [{ type: "text", text: reply }] } },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}
const hook = (file, cwd) =>
  spawnSync(process.execPath, [SCRIPT, "--hook"], { input: JSON.stringify({ transcript_path: file, cwd }), env });
const read = (name) => { try { return fs.readFileSync(path.join(handoffs, name), "utf8"); } catch { return null; } };
const names = () => fs.readdirSync(handoffs).sort();

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`);
};

const tA = transcript("aaaaaaaa-1111", projA, "request from project A", "reply A");
const tA2 = transcript("eeeeeeee-1111", projA, "second session in project A", "reply A2");
const tB = transcript("bbbbbbbb-1111", projB, "request from project B", "reply B");
const tC = transcript("cccccccc-1111", projC, "x".repeat(2000), "reply C");

check("hook run exits 0", hook(tA, projA).status === 0);
check("first project gets the plain name", read("proj-latest.md")?.includes("request from project A"), names().join(", "));
check("its per-session brief exists", names().includes("proj-auto-aaaaaaaa.md"), names().join(", "));

hook(tB, projB);
const bLatest = names().find((n) => /^proj-[0-9a-f]{6}-latest\.md$/.test(n));
check("same-named project gets its own latest file", !!bLatest, names().join(", "));
check("that file holds project B", !!bLatest && read(bLatest).includes("request from project B"));
check("project A's latest is not overwritten", read("proj-latest.md")?.includes("request from project A") && !read("proj-latest.md").includes("project B"));
check("project B's per-session brief has the same prefix", names().some((n) => /^proj-[0-9a-f]{6}-auto-bbbbbbbb\.md$/.test(n)), names().join(", "));

hook(tB, projB);
check("a second run for B reuses its name", names().filter((n) => /^proj-[0-9a-f]{6}-latest\.md$/.test(n)).length === 1, names().join(", "));

hook(tA2, projA);
const aLatest = read("proj-latest.md") ?? "";
check("A's latest follows A's newest session", aLatest.includes("second session in project A"));
check("A's latest lists A's other session", aLatest.includes("proj-auto-aaaaaaaa.md"));
check("A's latest does not list B's session", !aLatest.includes("bbbbbbbb"));

// A brief written under the plain prefix by project B before the names were split
fs.writeFileSync(path.join(handoffs, "proj-auto-dddddddd.md"),
  `# Handoff: proj\n\nFrom session \`d\`.\nProject folder: \`${projB}\`. Follow its CLAUDE.md.\n\n## First request (the goal)\n\nold request from B\n`);
hook(tA2, projA);
check("an old same-prefix brief from B is left out of A's list", !read("proj-latest.md").includes("dddddddd"));

// A manual brief needs the summary first: without one, or with a nearly empty one, nothing is written
const briefs = () => names().filter((n) => /-\d{8}-\d{4}\.md$/.test(n)).length;
const bare = spawnSync(process.execPath, [SCRIPT, "--transcript", tB, "--cwd", projB], { env });
check("a manual run without a summary writes no brief and says why", bare.status === 1 && briefs() === 0 && /summary is missing.*--summary/.test(bare.stdout.toString()), bare.stdout.toString());
const summaryFile = path.join(tmp, "summary.md");
fs.writeFileSync(summaryFile, "- todo\n");
const thin = spawnSync(process.execPath, [SCRIPT, "--summary", summaryFile, "--transcript", tB, "--cwd", projB], { env });
check("a nearly empty summary writes no brief either", thin.status === 1 && briefs() === 0 && thin.stdout.toString().includes("nearly empty"), thin.stdout.toString());
fs.writeFileSync(summaryFile, "- Goal: move the orders importer to the new schema.\n- Done: the reader, 12 tests pass.\n");
const manual = spawnSync(process.execPath, [SCRIPT, "--summary", summaryFile, "--transcript", tB, "--cwd", projB], { env });
const printed = manual.stdout.toString().trim();
check("manual run for B prints a path with B's name", /proj-[0-9a-f]{6}-\d{8}-\d{4}\.md$/.test(printed), printed);
const manualBrief = fs.existsSync(printed) ? fs.readFileSync(printed, "utf8") : "";
check("the summary is in the brief under Where we are, with no placeholder left",
  /## Where we are\n\n- Goal: move the orders importer[^\n]*\n- Done: the reader, 12 tests pass\.\n\n## First request/.test(manualBrief) && !manualBrief.includes("<!--"), manualBrief.slice(0, 400));
check("the summary file is gone afterwards", !fs.existsSync(summaryFile));

hook(tC, projC);
const c = read("other-latest.md") ?? "";
check("a project with its own name keeps <folder>-latest.md", c.includes("Project folder: `" + projC + "`"));
check("a long request is cut with a single … character", c.includes("x".repeat(1500) + " …\n") && !c.includes("�"));

const off = spawnSync(process.execPath, [SCRIPT, "--hook"], { input: JSON.stringify({ transcript_path: tA, cwd: projA }), env: { ...env, HANDOFF_HOOK: "off", USERPROFILE: path.join(tmp, "home2"), HOME: path.join(tmp, "home2") } });
check("HANDOFF_HOOK=off writes nothing", off.status === 0 && !fs.existsSync(path.join(tmp, "home2", ".claude")));
check("bad hook input is ignored", spawnSync(process.execPath, [SCRIPT, "--hook"], { input: "not json", env }).status === 0);

// Latest requests hold only what the user typed: child reports, forwarded reports, task notifications and system injections are left out
const projD = path.join(tmp, "d", "typed");
fs.mkdirSync(projD, { recursive: true });
const tD = path.join(tmp, "dddddddd-1111.jsonl");
const userLine = (text) => ({ type: "user", cwd: projD, message: { content: text } });
fs.writeFileSync(tD, [
  userLine("first goal typed by the user"),
  userLine("[Child Session Update]\nSession: lane 2\nDone: the deploy script works."),
  userLine("typed follow-up one"),
  userLine("[report] a forwarded child report"),
  userLine("<task-notification>job finished</task-notification>"),
  userLine("[SYSTEM NOTIFICATION - not from the user] x"),
  userLine("<system-reminder>hook text</system-reminder>"),
  userLine("typed follow-up two"),
  userLine("A child session's report was forwarded to you from the session you took over from. It reaches you as a note at your first step."),
  userLine("A message that reached the session you took over from was forwarded to you; most likely the user typed it there. It reaches you as a note at your first step."),
  { type: "assistant", cwd: projD, message: { model: "m", usage: { input_tokens: 1200 }, content: [{ type: "text", text: "reply D" }] } },
].map((l) => JSON.stringify(l)).join("\n") + "\n");
hook(tD, projD);
const d = read("typed-latest.md") ?? "";
const latestPart = d.split("## Latest requests (oldest first)")[1]?.split("## Files edited")[0] ?? "";
check("typed prompts are in the latest requests", latestPart.includes("typed follow-up one") && latestPart.includes("typed follow-up two"), latestPart);
check("the first request is the user's own", d.split("## First request (the goal)")[1]?.startsWith("\n\nfirst goal typed by the user"));
check("no child update, report, notification or reminder is in the brief", !/Child Session Update|forwarded child report|task-notification|SYSTEM NOTIFICATION|hook text|deploy script works/.test(d), d);

check("steer's own wake prompts are not in the brief", !/was forwarded to you/.test(d), d);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
