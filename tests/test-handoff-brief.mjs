// Tests for hooks/handoff-brief.mjs. Run: node test-handoff-brief.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/handoff-brief.mjs", import.meta.url));
// A made-up home folder, so the briefs land in a temp folder and not in the real ~/.claude
const home = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-brief-test-"));
const outDir = path.join(home, ".claude", "handoffs");
const env = { ...process.env, HOME: home, USERPROFILE: home };

const user = (text, extra = {}) => JSON.stringify({ type: "user", cwd: "/work/demo-project", message: { content: text }, ...extra });
const asst = (content, ctx = 42000, extra = {}) => JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5", usage: { input_tokens: 2, cache_read_input_tokens: ctx - 2, cache_creation_input_tokens: 0 }, content }, ...extra });
const transcript = (name, lines) => { const f = path.join(home, name); fs.writeFileSync(f, lines.join("\n") + "\n"); return f; };

const first = transcript("aaaaaaaa-1111.jsonl", [
  user("Build the price table"),
  asst([{ type: "text", text: "Started." }, { type: "tool_use", name: "Edit", input: { file_path: "src/table.js" } }]),
  user("<system-reminder>ignore me</system-reminder>"),
  user("Now add sorting"),
  asst([{ type: "tool_use", name: "Read", input: { file_path: "src/other.js" } }, { type: "text", text: "Sorting is in." }]),
  asst([{ type: "text", text: "A subagent's reply" }], 900000, { isSidechain: true }),
]);
const second = transcript("bbbbbbbb-2222.jsonl", [user("Fix the footer"), asst([{ type: "text", text: "Fixed." }])]);

const run = (args, input, extraEnv = {}) => spawnSync("node", [HOOK, ...args], { input, encoding: "utf8", env: { ...env, ...extraEnv } });
const hook = (transcriptPath, extraEnv) => run(["--hook"], JSON.stringify({ transcript_path: transcriptPath }), extraEnv);
const files = () => (fs.existsSync(outDir) ? fs.readdirSync(outDir).sort() : []);
const read = (name) => { try { return fs.readFileSync(path.join(outDir, name), "utf8"); } catch { return ""; } };
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

check("bad input: silent, nothing written", run(["--hook"], "not json").status === 0 && files().length === 0);
check("no transcript path: nothing written", run(["--hook"], "{}").status === 0 && files().length === 0);
check("missing transcript: nothing written", hook(path.join(home, "nope.jsonl")).status === 0 && files().length === 0);
check("HANDOFF_HOOK=off: nothing written", hook(first, { HANDOFF_HOOK: "off" }).status === 0 && files().length === 0);

const r = hook(first);
check("hook mode prints nothing", r.status === 0 && r.stdout === "");
check("writes one brief per session and a latest one", files().join() === "demo-project-auto-aaaaaaaa.md,demo-project-latest.md");
const brief = read("demo-project-auto-aaaaaaaa.md");
check("first request is the goal", /## First request \(the goal\)\n\nBuild the price table\n/.test(brief));
check("later requests listed, system text skipped", /- Now add sorting/.test(brief) && !/ignore me/.test(brief));
check("edited files listed, read files not", /- `src\/table\.js`/.test(brief) && !/other\.js/.test(brief));
check("last reply kept, subagent reply ignored", /## Claude's last reply\n\nSorting is in\.\n/.test(brief) && !/subagent/.test(brief));
check("context size from the main session", /~42k tokens/.test(brief));

hook(second);
const latest = read("demo-project-latest.md");
check("latest is the newest session", /^# Handoff: demo-project/.test(latest) && /Fix the footer/.test(latest));
check("latest lists the other session", /## Other sessions in this folder/.test(latest) && /demo-project-auto-aaaaaaaa\.md.*Build the price table/.test(latest));

const manual = run(["--transcript", first, "--cwd", home], "");
const manualFile = manual.stdout.trim();
check("manual mode prints the brief's path", manual.status === 0 && /demo-project-\d{8}-\d{4}\.md$/.test(manualFile));
check("manual brief leaves room for the summary", fs.existsSync(manualFile) && /<!-- summary/.test(fs.readFileSync(manualFile, "utf8")));

// Two projects with the same folder name must not overwrite each other's briefs
const projA = path.join(home, "a", "proj");
const projB = path.join(home, "b", "proj");
for (const p of [projA, projB]) fs.mkdirSync(p, { recursive: true });
const session = (id, cwd, request) => transcript(`${id}.jsonl`, [
  JSON.stringify({ type: "user", cwd, message: { content: request } }),
  JSON.stringify({ type: "assistant", cwd, message: { model: "m", usage: { input_tokens: 1200 }, content: [{ type: "text", text: "Done." }] } }),
]);
const hookIn = (file, cwd) => run(["--hook"], JSON.stringify({ transcript_path: file, cwd }));
const tA = session("cccccccc-1111", projA, "request from project A");
const tA2 = session("eeeeeeee-1111", projA, "second session in project A");
const tB = session("dddddddd-1111", projB, "request from project B");

hookIn(tA, projA);
check("first project gets the plain name", read("proj-latest.md").includes("request from project A") && files().includes("proj-auto-cccccccc.md"));
hookIn(tB, projB);
const bLatest = files().find((n) => /^proj-[0-9a-f]{6}-latest\.md$/.test(n));
check("same-named project gets its own latest file", !!bLatest && read(bLatest).includes("request from project B"));
check("the first project's latest is not overwritten", read("proj-latest.md").includes("request from project A") && !read("proj-latest.md").includes("project B"));
check("its per-session brief has the same prefix", files().some((n) => /^proj-[0-9a-f]{6}-auto-dddddddd\.md$/.test(n)));
hookIn(tB, projB);
check("a second run reuses the name", files().filter((n) => /^proj-[0-9a-f]{6}-latest\.md$/.test(n)).length === 1);
hookIn(tA2, projA);
const aLatest = read("proj-latest.md");
check("latest lists only its own project's sessions", aLatest.includes("second session in project A") && aLatest.includes("proj-auto-cccccccc.md") && !aLatest.includes("dddddddd"));
// a brief written under the plain prefix by the other project before the names were split
fs.writeFileSync(path.join(outDir, "proj-auto-ffffffff.md"),
  `# Handoff: proj\n\nFrom session \`f\`.\nProject folder: \`${projB}\`. Follow its CLAUDE.md.\n\n## First request (the goal)\n\nold request from B\n`);
hookIn(tA2, projA);
check("an old same-prefix brief from the other project is left out", !read("proj-latest.md").includes("ffffffff"));
const manualB = run(["--transcript", tB, "--cwd", projB], "").stdout.trim();
check("manual brief for the second project carries its name", /proj-[0-9a-f]{6}-\d{8}-\d{4}\.md$/.test(manualB));

fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
