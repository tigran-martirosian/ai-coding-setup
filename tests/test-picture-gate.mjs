// Tests for the picture gate (projects/shared/hooks/picture-gate.mjs) and the shared `picture` skill.
// Nothing here calls Codex or the network. Run: node tests/test-picture-gate.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SHARED = fileURLToPath(new URL("../projects/shared", import.meta.url));
const HOOK = path.join(SHARED, "hooks", "picture-gate.mjs");
const SKILL = path.join(SHARED, "shared-skills", "picture");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "picture-gate-test-"));
const gen = path.join(dir, "generated", "session-1");
fs.mkdirSync(gen, { recursive: true });

const ENV = { ...process.env, PICTURE_GATE: "", PICTURE_GATE_DIR: path.join(dir, "generated") };
const run = (input, env = {}) => spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...ENV, ...env } }).stdout;
const denies = (out, re) => { try { const h = JSON.parse(out).hookSpecificOutput; return h.permissionDecision === "deny" && re.test(h.permissionDecisionReason); } catch { return false; } };
const blocks = (out, re) => { try { const j = JSON.parse(out); return j.decision === "block" && re.test(j.reason); } catch { return false; } };
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const past = (f, ms = 600_000) => { const t = new Date(Date.now() - ms); fs.utimesSync(f, t, t); };

const FACTS = ["## In use", "- yt/use-1.jpg: 1:12 of https://youtu.be/abcdefghijk, the cane goes in on the tray side", "## Facts",
  "- The cane is fed from the tray side. source: yt/use-1.jpg", "- The tray sticks out 6 cm. source: https://example.com/manual", "- The table is 75 cm high. source: user"];
const CHECKLIST = ["1. [view] flat front view", "2. [sizes] the tray is 6 cm, the press 27 cm", "3. [physical] the fibre comes out between the rollers",
  "4. [fasteners] both clamps grip the board and the table", "5. the crank is on the lower shaft"];

// A job folder with facts.md, checklist.md and one real frame; older than anything written afterwards
const jobFolder = (name, { facts = FACTS, checklist = CHECKLIST } = {}) => {
  const job = path.join(dir, name);
  fs.mkdirSync(path.join(job, "tries"), { recursive: true });
  fs.mkdirSync(path.join(job, "yt"), { recursive: true });
  fs.writeFileSync(path.join(job, "yt", "use-1.jpg"), "a real frame");
  for (const [f, lines] of [["facts.md", facts], ["checklist.md", checklist]]) {
    if (!lines) continue;
    fs.writeFileSync(path.join(job, f), lines.join("\n") + "\n");
    past(path.join(job, f));
  }
  return job;
};
const job = jobFolder("job folder");

// A "generated" picture and its copy in a job folder
let n = 0;
const picture = (name, folder = job) => {
  const bytes = Buffer.from(`fake png ${++n} ${"x".repeat(200)}`);
  fs.writeFileSync(path.join(gen, `call_${n}.png`), bytes);
  const f = path.join(folder, "tries", name);
  fs.writeFileSync(f, bytes);
  return f;
};
const checkFile = (img, lines, ageMs = 0) => {
  const f = img.replace(/\.png$/, ".check.md");
  fs.writeFileSync(f, `# Check: ${path.basename(img)}\n\n${lines.join("\n")}\n`);
  if (ageMs) { const t = new Date(fs.statSync(img).mtimeMs - ageMs); fs.utimesSync(f, t, t); }
  return f;
};
const review = (img, points = [], of = img) => fs.writeFileSync(img.replace(/\.png$/, ".review.md"),
  [`# Independent review of ${path.basename(img)}`, "", `sha256: ${crypto.createHash("sha256").update(fs.readFileSync(of)).digest("hex")}`, "",
    ...(points.length ? points.map((p, i) => `R${i + 1}: ${p}`) : ["No faults found."])].join("\n") + "\n");
const STAND = ["- PASS [view]: flat front view (front edge horizontal)", "- PASS [sizes]: the tray is 6 cm against a 27 cm press (about a fifth)",
  "- PASS [physical]: the fibre comes out between the rollers", "- PASS [fasteners]: both clamps grip the board and the table top"];
const OWN = [1, 2, 3, 4].map((i) => `- PASS: line ${i} (seen)`);
const GOOD = [...STAND, ...OWN];
// A picture with a review and a check file
const made = (name, lines, { points = [], folder = job } = {}) => { const img = picture(name, folder); review(img, points); checkFile(img, lines); return img; };
const show = (img, extra = {}) => run({ hook_event_name: "PreToolUse", tool_name: "mcp__nimbalyst__display_to_user", tool_input: { items: [{ description: "x", image: { path: img } }] }, ...extra });

const noCheck = picture("try-1.png");
check("denies: generated picture with no check file", denies(show(noCheck), /has no check file/));
check("denies: the message says what to do", denies(show(noCheck), /Don't show or link this picture.*picture skill/s));

const failing = made("try-2.png", [...GOOD, "- FAIL: the crank is attached to the top roller (it floats below the table)"]);
check("denies: one FAIL line, even with every PASS", denies(show(failing), /fails 1 line/));

check("denies: fewer than 4 PASS lines of its own", denies(show(made("try-3.png", [...STAND, ...OWN.slice(0, 3)])), /3 PASS lines of its own/));

const stale = picture("try-4.png");
review(stale);
checkFile(stale, GOOD, 60_000);
check("denies: check file older than the picture", denies(show(stale), /older than/));

const good = made("try-5.png", [...GOOD, "- MINOR: the label font is small"]);
check("allows: standing lines, 4 own PASS, a harmless MINOR, a review with no faults", show(good) === "");
check("allows: bold PASS words", show(made("try-6.png", GOOD.map((l) => l.replace("- PASS", "- **PASS**")))) === "");

// Round 2: standing lines, MINOR, the independent review
check("denies: a standing line is missing", denies(show(made("s1.png", [...STAND.slice(0, 3), ...OWN])), /no PASS line for the standing line\(s\) \[fasteners\]/));
check("denies: [sizes] names no real size", denies(show(made("s2.png", [...GOOD.filter((l) => !l.includes("[sizes]")), "- PASS [sizes]: the proportions look right"])), /names no real size/));
check("denies: a wrong size written as MINOR", denies(show(made("m1.png", [...GOOD, "- MINOR: the juice chute is too long"])), /calls this MINOR.*is a FAIL/s));
check("denies: a wrong exit point written as MINOR", denies(show(made("m2.png", [...GOOD, "- MINOR: the fibre comes out of the side plate"])), /calls this MINOR/));
check("denies: three MINOR lines", denies(show(made("m3.png", [...GOOD, "- MINOR: a", "- MINOR: b", "- MINOR: c"])), /3 MINOR lines/));

const noReview = picture("r1.png");
checkFile(noReview, GOOD);
check("allows: no review file (the review is optional since the 5-minute rule)", show(noReview) === "");
const otherReview = picture("r2.png");
review(otherReview, [], good);
checkFile(otherReview, GOOD);
check("denies: the review was made for another picture", denies(show(otherReview), /not made for this picture/));
const POINTS = ["the table's right legs are not vertical", "the right clamp grips nothing"];
check("denies: a reviewer point is not answered", denies(show(made("r3.png", [...GOOD, "- PASS R1: the legs are vertical, measured against the frame"], { points: POINTS })), /does not answer the reviewer's point\(s\) R2/));
check("denies: a reviewer point answered FAIL", denies(show(made("r4.png", [...GOOD, "- PASS R1: vertical", "- FAIL R2: true, the screw pad touches nothing"], { points: POINTS })), /fails 1 line/));
check("allows: every reviewer point answered PASS", show(made("r5.png", [...GOOD, "- PASS R1: vertical", "- PASS (R2): the pad is on the underside of the top"], { points: POINTS })) === "");

// Round 2: facts.md and checklist.md
const inJob = (name, opts) => made("try-1.png", GOOD, { folder: jobFolder(name, opts) });
check("denies: no facts.md", denies(show(inJob("no facts", { facts: null })), /has no facts\.md/));
check("denies: a fact without a source", denies(show(inJob("no source", { facts: [...FACTS, "- The cane goes in on the gear side (not confirmed)"] })), /no source for "The cane goes in on the gear side/));
check("denies: a source file that does not exist", denies(show(inJob("lost source", { facts: [...FACTS, "- The crank is on the lower shaft. source: yt/use-9.jpg"] })), /is not a link, "user" or a file that exists/));
check("denies: no In use section", denies(show(inJob("no use", { facts: FACTS.slice(2) })), /no "## In use" section/));
check("denies: the in-use frame was never saved", denies(show(inJob("lost frame", { facts: FACTS.map((l) => l.replace("yt/use-1.jpg:", "yt/use-2.jpg:")) })), /names no picture file that exists/));
check("denies: fewer than 3 facts", denies(show(inJob("few facts", { facts: FACTS.slice(0, 5) })), /2 fact line\(s\)/));
check("allows: no footage, with the reason", show(inJob("none", { facts: ["## In use", "- none: the shelf is not built yet, only the user's sketch exists", ...FACTS.slice(2)] })) === "");
check("denies: no checklist.md", denies(show(inJob("no checklist", { checklist: null })), /no checklist\.md/));
check("denies: checklist without a standing line", denies(show(inJob("thin checklist", { checklist: CHECKLIST.slice(1) })), /checklist\.md lacks the standing line\(s\) \[view\]/));
const rewritten = jobFolder("rewritten");
const oldTry = made("try-1.png", GOOD, { folder: rewritten });
const later = new Date(Date.now() + 60_000);
fs.utimesSync(path.join(rewritten, "checklist.md"), later, later);
check("denies: the checklist changed after the check", denies(show(oldTry), /checklist\.md changed after try-1\.check\.md was written/));

// A copy kept outside the job folder
const answers = path.join(dir, "answers");
fs.mkdirSync(answers);
const copy = path.join(answers, "setup.png");
fs.copyFileSync(good, copy);
for (const ext of [".check.md", ".review.md"]) fs.copyFileSync(good.replace(/\.png$/, ext), copy.replace(/\.png$/, ext));
check("denies: a copy elsewhere that does not name its job folder", denies(show(copy), /has no facts\.md/));
fs.appendFileSync(copy.replace(/\.png$/, ".check.md"), `\nJob folder: ${job}\n`);
check("allows: a copy with its check, its review and a Job folder line", show(copy) === "");

const own = path.join(job, "tries", "photo.png");
fs.writeFileSync(own, "a real photo, not generated");
check("silent: a picture Codex did not make", show(own) === "");
check("silent: a chart item", run({ hook_event_name: "PreToolUse", tool_input: { items: [{ description: "c", chart: { chartType: "bar" } }] } }) === "");
check("silent: missing file", show(path.join(job, "tries", "nope.png")) === "");
check("denies: second item is the bad one", denies(run({ hook_event_name: "PreToolUse", tool_input: { items: [{ image: { path: good } }, { image: { path: noCheck } }] } }), /try-1\.png has no check file/));

// The picture must have been opened with Read (when there is a transcript to look in)
const line = (o) => JSON.stringify(o);
const asst = (content) => line({ type: "assistant", message: { role: "assistant", content } });
const tFile = (name, lines) => { const f = path.join(dir, name); fs.writeFileSync(f, lines.join("\n") + "\n"); return f; };
const user = line({ type: "user", message: { role: "user", content: "show me" } });
const read = (p) => asst([{ type: "tool_use", name: "Read", input: { file_path: p } }]);
check("denies: checked but never opened with Read", denies(show(good, { transcript_path: tFile("a.jsonl", [user, asst([{ type: "text", text: "try-5.png looks fine" }])]) }), /never opened with Read/));
check("allows: opened with Read", show(good, { transcript_path: tFile("b.jsonl", [user, read(good)]) }) === "");
check("allows: the original under generated_images was opened", show(good, { transcript_path: tFile("c.jsonl", [user, read(path.join(gen, "call_5.png"))]) }) === "");
check("allows: transcript missing", show(good, { transcript_path: path.join(dir, "nope.jsonl") }) === "");

// Stop: the reply links a picture
const stop = (m, extra = {}) => run({ hook_event_name: "Stop", last_assistant_message: m, stop_hook_active: false, cwd: job, ...extra });
const url = (p) => "/" + p.replace(/\\/g, "/").replace(/ /g, "%20");
check("stop blocks: link to an unchecked picture", blocks(stop(`Here it is: [try-1.png](${url(noCheck)})`), /has no check file/));
check("stop blocks: inline image with a failing check", blocks(stop(`![setup](${url(failing)})\n\nKnown problems: the crank floats.`), /fails 1 line/));
check("stop blocks: relative link", blocks(stop("See [the picture](tries/try-1.png)."), /has no check file/));
check("stop silent: link to a passing picture", stop(`[the setup](${url(good)})`) === "");
check("stop silent: no picture links", stop("Done. See [notes](notes.md) and https://example.com/a.png") === "");
check("stop silent: stop_hook_active", stop(`[x](${url(noCheck)})`, { stop_hook_active: true }) === "");
check("stop: reply read from the transcript", blocks(run({ hook_event_name: "Stop", cwd: dir, transcript_path: tFile("d.jsonl", [user, asst([{ type: "text", text: `[x](${url(noCheck)})` }])]) }), /has no check file/));

check("silent: PICTURE_GATE=off", show(noCheck, {}) !== "" && run({ hook_event_name: "PreToolUse", tool_input: { items: [{ image: { path: noCheck } }] } }, { PICTURE_GATE: "off" }) === "");
check("silent: bad input", run("not json") === "");

// picture.mjs: gen refuses before Codex is called; PICTURE_FAKE_CODEX keeps Codex out of the tests
const fake = path.join(dir, "answer.txt");
fs.writeFileSync(fake, "- FAULT: bottom left: the clamp's screw pad touches nothing\nFAULT: the tray is twice as long as in photo 2\n");
const tool = (cwd, ...a) => { const r = spawnSync(process.execPath, [path.join(SKILL, "picture.mjs"), ...a], { cwd, encoding: "utf8", env: { ...ENV, PICTURE_FAKE_CODEX: fake } }); return `${r.status}|${r.stdout}${r.stderr}`; };
const genIn = (folder, ...refs) => { fs.writeFileSync(path.join(folder, "prompt.txt"), "a picture"); return tool(folder, "gen", "prompt.txt", `tries/new-${++n}.png`, ...refs); };
check("gen refuses: no facts.md", /^2\|not generated: there is no facts\.md/.test(genIn(path.join(dir, "no facts"))));
check("gen refuses: a fact without a source", /^2\|not generated: facts\.md: no source for/.test(genIn(path.join(dir, "no source"))));
check("gen refuses: checklist without the standing lines", /^2\|not generated: checklist\.md lacks/.test(genIn(path.join(dir, "thin checklist"))));
check("gen refuses: no real in-use frame attached", /^2\|not generated: attach at least one of the real in-use frames.*use-1\.jpg/.test(genIn(job)));
check("gen refuses: starting from a generated picture that was never checked", /^2\|not generated: try-1\.png is a generated picture that was never checked/.test(genIn(job, "yt/use-1.jpg", "tries/try-1.png")));
const badView = made("v1.png", [...GOOD.slice(1), "- FAIL: [view] the table is skewed"]);
check("gen refuses: editing a try whose view failed", /^2\|not generated: the view of v1\.png did not pass/.test(genIn(job, "yt/use-1.jpg", badView)));
const rejected = made("v2.png", [...GOOD, "- FAIL: rejected by the user: the chute is far too long"]);
check("gen refuses: starting from a picture the user rejected", /^2\|not generated: v2\.png was rejected by the user/.test(genIn(job, "yt/use-1.jpg", rejected)));
check("gen accepts: facts, checklist, a real frame, and an edit of a try whose view passed", /^0\|would generate/.test(genIn(job, "yt/use-1.jpg", failing)));

const reviewed = picture("rv.png");
const rv = tool(job, "review", "tries/rv.png");
const rvFile = fs.existsSync(reviewed.replace(/\.png$/, ".review.md")) ? fs.readFileSync(reviewed.replace(/\.png$/, ".review.md"), "utf8") : "";
check("review: writes the points as R1, R2 with the picture's hash", /^0\|/.test(rv) && /^sha256: [0-9a-f]{64}$/m.test(rvFile) && /^R1: bottom left/m.test(rvFile) && /^R2: the tray is twice/m.test(rvFile));
checkFile(reviewed, GOOD);
check("review: the gate then wants each point answered", denies(show(reviewed), /does not answer the reviewer's point\(s\) R1, R2/));
fs.writeFileSync(fake, "I looked at the picture and it seems fine.\n");
check("review: an answer in the wrong form is not accepted", /^1\|The reviewer gave no usable answer/.test(tool(job, "review", "tries/rv.png")));

// picture.mjs cut: one frame out of a 3 x 3 sheet (needs ffmpeg)
const yt = path.join(job, "yt");
const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
if (!haveFfmpeg) console.log("skip  cut checks (2): ffmpeg is not installed");
if (haveFfmpeg) spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=960x540:rate=1", "-frames:v", "1", path.join(yt, "abcdefghijk-sb0.jpg")]);
fs.writeFileSync(path.join(yt, "abcdefghijk-sb.json"), JSON.stringify({ id: "abcdefghijk", rows: 3, columns: 3, width: 320, height: 180, sheets: [{ file: "abcdefghijk-sb0.jpg", start: 0, end: 90 }] }));
const cut = haveFfmpeg ? tool(job, "cut", "yt/abcdefghijk-sb0.jpg", "2", "3", "yt/use-cut.jpg") : "";
if (haveFfmpeg) check("cut: saves the frame and says when in the video it is", /^0\|.*use-cut\.jpg, at about 0:50 of https:\/\/youtu\.be\/abcdefghijk/.test(cut) && fs.statSync(path.join(yt, "use-cut.jpg")).size > 1000);
if (haveFfmpeg) check("cut refuses: a row the sheet does not have", /^2\|this sheet has rows 1 to 3/.test(tool(job, "cut", "yt/abcdefghijk-sb0.jpg", "4", "1", "yt/x.jpg")));

// The skill's text (tests/test-install.mjs checks its wiring in the two projects)
const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
check("skill: facts, checklist, check file, never shown, 4 tries, fallback", [/Facts first/, /checklist\.md/, /\.check\.md/, /is not shown/, /up to 4 tries/, /drawn diagram/].every((re) => re.test(skill)));
check("skill: in-use frames, sources, standing lines, flat view, review, narrow MINOR, no old pictures", [/picture\.mjs/, / frames /, /## In use/, /source:/, /\[view\]/, /\[sizes\]/, /\[physical\]/, /\[fasteners\]/, /No\s+three-quarter view/, / review tries\//, /changes nothing the user would do or believe/, /Never start from/, /rejected by the user/].every((re) => re.test(skill)));
check("skill: picture.mjs is there", fs.existsSync(path.join(SKILL, "picture.mjs")));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
