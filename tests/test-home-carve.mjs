// Tests for the carve of a home folder's CLAUDE.md in install.mjs (scripts/projects.mjs), on a temporary
// home folder. Design check 21 (docs/2026-11-09-b8b-design.md) on quick-tasks, and a second run that
// changes nothing. Run: node tests/test-home-carve.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.SETUP_CC_CHECK = "off";
const REPO = fileURLToPath(new URL("..", import.meta.url));
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "home-carve-test-"));
const emptyPath = path.join(tmp, "empty-path");
fs.mkdirSync(emptyPath);
const install = (home, ...flags) => {
  const r = spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", home, ...flags], { encoding: "utf8", env: { ...process.env, PATH: emptyPath, Path: emptyPath } });
  return { code: r.status, out: r.stdout + r.stderr };
};
const read = (f) => fs.readFileSync(f, "utf8");
const json = (f) => JSON.parse(read(f));
const fwd = (p) => p.replace(/\\/g, "/");
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const snap = (dir) => files(dir).sort().map((f) => [f, read(f)]);

const home = path.join(tmp, "a");
const projects = path.join(home, "Projects");
const dir = path.join(projects, "quick-tasks");
const notes = path.join(dir, "CLAUDE.md");
const myRules = path.join(dir, ".claude", "rules", "my-rules.md");
const stateFile = path.join(home, ".claude", "setup-state.json");
// a project folder of the person's own, which no run may touch
const mine = path.join(projects, "my-project");
fs.mkdirSync(mine, { recursive: true });
fs.writeFileSync(path.join(mine, "CLAUDE.md"), "# my-project\n\n- My own line.\n");
ok("install exits cleanly", install(home).code, 0);
const fresh = read(notes);
ok("the installed notes have the Workers note and the real projects folder", [fresh.includes("## Workers on this computer"), fresh.includes(path.join(projects, "ask-anything"))], [true, true]);

// Check 21: an own line (naming the real projects folder) under a shipped heading, with CRLF endings and
// the Workers note left as it was; the shipped lines with the real folder in them count as shipped text
const OWN = `- My own line: inputs come from ${path.join(projects, "inbox")}.`;
const person = fresh.replace("## Not for here\n", `## Not for here\n\n${OWN}\n`).replace(/\n/g, "\r\n");
ok("the test's file has its own line", person.includes(OWN));
fs.writeFileSync(notes, person);
const run = install(home);
ok("the run with the changed notes exits cleanly", run.code, 0);
ok("check 21: the notes are this version's whole", read(notes), fresh);
ok("check 21: the own line moved to the folder's my-rules.md under its heading, with the real folder kept", fs.existsSync(myRules) && read(myRules), `## Not for here\n\n${OWN}\n`);
ok("check 21: the run says what it did", run.out.includes(`notes: brought ${fwd(notes)} up to this version: 0 old setup lines removed, 1 of yours moved to ${fwd(myRules)}`));
const copies = fs.readdirSync(dir).filter((f) => f !== "CLAUDE.md" && f.startsWith("CLAUDE"));
ok("check 21: the file before the run is kept as one dated copy", copies.length === 1 && read(path.join(dir, copies[0])), person);
const undo = json(stateFile).rulesUndo;
ok("check 21: both files are on the undo record, my-rules.md as created by the run",
  [undo?.by, undo?.files.filter((f) => f.file.includes("/quick-tasks/"))], ["carve", [{ file: fwd(notes), copy: fwd(path.join(dir, copies[0])) }, { file: fwd(myRules), copy: null }]]);
ok("no other home was carved", undo.files.filter((f) => !f.file.includes("/quick-tasks/")), []);

// A second run changes nothing: the notes, my-rules.md, the copy and the undo record stay as they are
const before = snap(projects);
const again = install(home);
ok("the second run exits cleanly", again.code, 0);
ok("the second run carves nothing", again.out.includes("notes: brought"), false);
ok("the second run leaves every project file as it was", snap(projects), before);
ok("the second run keeps the undo record", json(stateFile).rulesUndo, undo);
ok("the person's own project folder is untouched", fs.readdirSync(mine).length === 1 && read(path.join(mine, "CLAUDE.md")), "# my-project\n\n- My own line.\n");

// A line the person appended after the Workers note (the file's last section) is theirs: it moves to
// my-rules.md, and the installer's own note lines do not
const LAST = "- Always answer my quick tasks in French.";
fs.writeFileSync(notes, read(notes) + `${LAST}\n`);
const after = install(home);
ok("the run with a line after the note exits cleanly", after.code, 0);
ok("the line after the note moved to my-rules.md under the note's heading", read(myRules).includes(`## Workers on this computer\n\n${LAST}\n`));
ok("the installer's note line did not move", read(myRules).includes("No generated pictures here"), false);
ok("the notes are this version's whole again", read(notes), fresh);
ok("the run counts the line as one of yours", after.out.includes(`1 of yours moved to ${fwd(myRules)}`));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
