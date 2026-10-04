// Tests workers/ask-codex.sh in dry-run mode (ASK_CODEX_DRY=1 prints the command, runs nothing).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../workers/ask-codex.sh", import.meta.url)).replace(/\\/g, "/");
const run = (...args) => {
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, ASK_CODEX_DRY: "1" } });
  return { code: r.status, out: r.stdout.split("\n").map((l) => l.trim()).filter(Boolean), err: r.stderr };
};

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.log("FAIL " + name)); };

let r = run("Reply OK");
ok("plain: exit 0", r.code === 0);
ok("plain: codex exec with the needed flags", r.out.join(" ").startsWith(
  `codex exec --skip-git-repo-check -s read-only -c windows.sandbox="unelevated" -c model_reasoning_effort="low"`));
ok("plain: task passed through", r.out.at(-1) === "TASK: Reply OK");
ok("plain: no --search", !r.out.includes("--search"));

r = run("--web", "find x");
ok("web: --search comes before exec", r.out.indexOf("--search") === 1 && r.out.indexOf("exec") === 2);

r = run("--think", "hard one");
ok("think: no effort flag", !r.out.join(" ").includes("model_reasoning_effort"));

r = run("--web", "--think", "both");
ok("both flags", r.out.includes("--search") && !r.out.join(" ").includes("model_reasoning_effort"));

const tmp = path.join(os.tmpdir(), `ask-codex-test-${process.pid}.txt`);
fs.writeFileSync(tmp, "line one\nline two\n");
r = run(tmp.replace(/\\/g, "/"));
ok("file: task is read from the file", r.out.includes("TASK: line one") && r.out.at(-1) === "line two");
fs.writeFileSync(tmp, "");
r = run(tmp.replace(/\\/g, "/"));
ok("empty file: refused with an error", r.code === 2 && /is empty/.test(r.err));
fs.unlinkSync(tmp);

r = run();
ok("no task: refused with an error", r.code === 2 && /give one task/.test(r.err));
r = run("a", "b");
ok("two tasks: refused", r.code === 2);

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
