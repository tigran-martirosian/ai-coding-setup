// Tests for skills/court/court.mjs without calling any model. Run: node tests/test-court.mjs
// The script runs with a PATH that has neither codex nor agy on it, so no seat can call out.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoles } from "../skills/court/court.mjs";

const COURT = fileURLToPath(new URL("../skills/court/court.mjs", import.meta.url));
const ROLES = fileURLToPath(new URL("../skills/court/roles.md", import.meta.url));
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// ---- roles.md
const roles = loadRoles(fs.readFileSync(ROLES, "utf8"));
const byId = Object.fromEntries(roles.map((r) => [r.id, r]));
ok("the GPT and Gemini seats sit by default", [byId.researcher?.runsOn, byId.researcher?.isDefault, byId.analyst?.runsOn], ["gpt", true, "gemini"]);
ok("five seats sit by default", roles.filter((r) => r.isDefault).map((r) => r.id), ["researcher", "analyst", "sceptic", "pragmatist", "wildcard"]);
ok("a seat's brief leaves out its settings lines", /runs on:|default:|model:/i.test(byId.sceptic.brief), false);

// ---- the script as a process, with no outside tool on the PATH
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "court-test-"));
const noTools = fs.mkdtempSync(path.join(os.tmpdir(), "court-path-"));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH")), PATH: noTools };
const court = (mode, dir) => {
  const r = spawnSync(process.execPath, [COURT, mode, dir], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout };
};
const runFolder = (answers) => {
  const dir = fs.mkdtempSync(path.join(tmp, "run-"));
  fs.writeFileSync(path.join(dir, "question.txt"), "Should a small team write its own job queue?");
  for (const [seat, text] of Object.entries(answers)) fs.writeFileSync(path.join(dir, `${seat}.md`), text);
  return dir;
};

const empty = runFolder({});
const opened = court("open", empty);
ok("open with neither tool: the Claude seats sit alone", [opened.code, opened.out.includes("Claude seats sit alone")], [0, true]);
ok("open with neither tool writes no seat file", fs.readdirSync(empty), ["question.txt"]);

const dir = runFolder({
  sceptic: "No. Use the database's own queue.\nConfidence: high",
  pragmatist: "No, buy one.\nConfidence: medium",
  researcher: "SEAT FAILED: timed out after 420s",
});
const b = court("bundle", dir);
const bundle = fs.readFileSync(path.join(dir, "bundle.md"), "utf8");
const keyMap = JSON.parse(fs.readFileSync(path.join(dir, "key.json"), "utf8"));
ok("bundle exits cleanly", b.code, 0);
ok("bundle holds the question and the two good answers as A and B",
  [bundle.startsWith("QUESTION:\nShould a small team"), (bundle.match(/--- ANSWER [A-Z] ---/g) || []).length, Object.keys(keyMap).sort()], [true, 2, ["A", "B"]]);
ok("the key maps the letters to the seats", Object.values(keyMap).sort(), ["pragmatist", "sceptic"]);
ok("bundle.md names no seat", /sceptic|pragmatist|researcher/i.test(bundle), false);
ok("a failed seat is left out and named", [bundle.includes("SEAT FAILED"), b.out.includes("SEATS THAT FAILED: researcher")], [false, true]);
ok("the quick court's bundle has no reviews", bundle.includes("REVIEWER"), false);

const r = court("review", dir);
ok("review with neither tool writes the bundle without reviews", [r.code, r.out.includes("without reviews")], [0, true]);

const lonely = runFolder({ sceptic: "No.\nConfidence: low" });
ok("one answer is not a court", court("bundle", lonely).code, 1);
const noQuestion = fs.mkdtempSync(path.join(tmp, "run-"));
ok("a folder without question.txt gets the usage line", court("bundle", noQuestion).out.startsWith("Usage:"));

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(noTools, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
