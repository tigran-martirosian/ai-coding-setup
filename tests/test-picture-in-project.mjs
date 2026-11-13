// Tests for hooks/picture-in-project.mjs. Run: node tests/test-picture-in-project.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/picture-in-project.mjs", import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "picture-in-project-"));
const PROJECT = join(ROOT, "my-app");
const SHOWN = join(PROJECT, "shown");
mkdirSync(join(PROJECT, "scratch"), { recursive: true });
const run = (input, env = {}) => {
  const out = spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), env: { ...process.env, PICTURE_IN_PROJECT: "", ...env }, encoding: "utf8" }).stdout;
  return out ? JSON.parse(out).hookSpecificOutput : null;
};
const show = (items, tool = "mcp__nimbalyst__display_to_user", cwd = PROJECT) => ({ tool_name: tool, cwd, tool_input: { items } });
const pic = (path) => ({ description: "A picture", image: { path } });
const chart = { description: "A chart", chart: { chartType: "bar", data: [{ a: 1, b: 2 }], xAxisKey: "a", yAxisKey: "b" } };
const file = (path, bytes = "picture bytes") => { writeFileSync(path, bytes); return path; };
const copied = (out, i = 0) => out.permissionDecisionReason.split("\n").filter((l) => l.includes(" -> "))[i].split(" -> ")[1];

let failed = 0, count = 0;
const check = (name, ok, got) => {
  count++;
  if (ok) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}\n     got: ${JSON.stringify(got)?.slice(0, 300) ?? "(nothing)"}`); }
};

let out = run(show([pic(file(join(ROOT, "outside.png")))]));
check("a picture outside the project is denied, with its copy in shown/", out?.permissionDecision === "deny" && copied(out).startsWith(SHOWN), out);
check("no call is rewritten: the card keeps the path Claude wrote", out && !("updatedInput" in out), out);
check("the copy has the same bytes", out && readFileSync(copied(out), "utf8") === "picture bytes", out);
check("the copy keeps the file's name and type", out && /outside-[0-9a-f]{8}\.png$/.test(copied(out)), out);
check("shown/ ignores itself in git", readFileSync(join(SHOWN, ".gitignore"), "utf8") === "*\n");

out = run(show([pic(file(join(PROJECT, "scratch", "inside.png"), "other bytes"))]));
check("a picture in a scratch folder of the project is denied and copied too", out?.permissionDecision === "deny" && copied(out).startsWith(SHOWN), out);
rmSync(join(PROJECT, "scratch", "inside.png"));
check("the copy outlives the original", out && existsSync(copied(out)), out);

const before = readdirSync(SHOWN).length;
const again = [run(show([pic(file(join(ROOT, "same.png"), "same"))])), run(show([pic(join(ROOT, "same.png"))]))];
check("the same picture twice gives one copy", copied(again[0]) === copied(again[1]) && readdirSync(SHOWN).length === before + 1, again);
const a = run(show([pic(file(join(ROOT, "changed.png"), "first"))]));
const b = run(show([pic(file(join(ROOT, "changed.png"), "second"))]));
check("a file redrawn under the same name gets its own copy", copied(a) !== copied(b) && readFileSync(copied(a), "utf8") === "first", [a, b]);

const kept = file(join(SHOWN, "kept.png"));
check("a picture already in shown/ passes", run(show([pic(kept)])) === null);

out = run(show([chart, pic(join(ROOT, "same.png"))]));
check("a picture next to a chart is still handled", out?.permissionDecision === "deny" && copied(out).startsWith(SHOWN), out);
check("the retry with the copy's path passes", run(show([chart, pic(copied(out))])) === null, out);
check("a chart alone passes", run(show([chart])) === null);

check("a missing picture inside the project is left to the tool", run(show([pic(join(PROJECT, "gone.png"))])) === null);
out = run(show([pic(join(ROOT, "gone.png"))]));
check("a missing picture outside the project is denied and named", out?.permissionDecision === "deny" && out.permissionDecisionReason.includes("gone.png"), out);
out = run(show([pic(join(ROOT, "same.png")), pic(join(ROOT, "gone.png"))]));
check("one missing among several is named, the other is copied", out?.permissionDecisionReason.includes("not copied: " + join(ROOT, "gone.png")) && copied(out).startsWith(SHOWN), out);
out = run(show([pic(join(ROOT, "gone.png")), pic(join(ROOT, "gone2.png"))]));
check("two missing are both named", out?.permissionDecisionReason.includes("gone.png") && out.permissionDecisionReason.includes("gone2.png"), out);

out = run(show([pic(join(ROOT, "same.png"))], "mcp__other__display_to_user"));
check("the tool under another server name is handled too", out?.permissionDecision === "deny", out);
check("another tool passes", run(show([pic(join(ROOT, "same.png"))], "Read")) === null);
check("a relative path is left to the tool", run(show([pic("out/a.png")])) === null);
check("no project folder in the input passes", run({ tool_name: "mcp__nimbalyst__display_to_user", tool_input: { items: [pic(join(ROOT, "same.png"))] } }) === null);
check("no items passes", run(show(undefined)) === null);
check("broken input passes", run("not json") === null);
check("PICTURE_IN_PROJECT=off passes", run(show([pic(join(ROOT, "same.png"))]), { PICTURE_IN_PROJECT: "off" }) === null);
if (process.platform === "win32") {
  check("on Windows the letter case of the path does not matter", run(show([pic(kept.toUpperCase())])) === null);
  out = run(show([pic(join(ROOT, "same.png").replace(/\\/g, "/"))]));
  check("on Windows forward slashes work", out?.permissionDecision === "deny" && copied(out).startsWith(SHOWN), out);
}

rmSync(ROOT, { recursive: true, force: true });
console.log(failed ? `${failed} of ${count} failed` : `all ${count} passed`);
process.exit(failed ? 1 : 0);
