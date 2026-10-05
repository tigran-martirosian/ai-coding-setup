// Tests for hooks/picture-in-project.mjs. Run: node tests/test-picture-in-project.mjs
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/picture-in-project.mjs", import.meta.url));
const PROJECT = join(homedir(), "projects", "my-app");
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), env: { ...process.env, PICTURE_IN_PROJECT: "", ...env }, encoding: "utf8" }).stdout;
const show = (items, tool = "mcp__nimbalyst__display_to_user", cwd = PROJECT) => ({ tool_name: tool, cwd, tool_input: { items } });
const pic = (path) => ({ description: "A picture", image: { path } });
const chart = { description: "A chart", chart: { chartType: "bar", data: [{ a: 1, b: 2 }], xAxisKey: "a", yAxisKey: "b" } };
const OUTSIDE = "outside the open project";

const cases = [
  ["picture inside the project passes", show([pic(join(PROJECT, "out", "a.png"))]), false],
  ["picture in a deep folder of the project passes", show([pic(join(PROJECT, "docs", "img", "2026", "a.png"))]), false],
  ["picture in the temp folder is denied", show([pic(join(tmpdir(), "claude", "a.png"))]), OUTSIDE],
  ["picture in the home folder is denied", show([pic(join(homedir(), "a.png"))]), OUTSIDE],
  ["picture in a folder next to the project is denied", show([pic(join(homedir(), "projects", "my-app-2", "a.png"))]), OUTSIDE],
  ["a path that climbs out of the project is denied", show([pic(join(PROJECT, "..", "other", "a.png"))]), OUTSIDE],
  ["one picture outside among several is denied and named", show([pic(join(PROJECT, "a.png")), pic(join(tmpdir(), "b.png"))]), "b.png"],
  ["two pictures outside are both named", show([pic(join(tmpdir(), "b.png")), pic(join(tmpdir(), "c.png"))]), "these pictures are"],
  ["the message says to copy the file in", show([pic(join(tmpdir(), "b.png"))]), "Copy the file into the project"],
  ["a chart passes", show([chart]), false],
  ["a chart with a picture inside the project passes", show([chart, pic(join(PROJECT, "a.png"))]), false],
  ["the tool under another server name is checked too", show([pic(join(tmpdir(), "a.png"))], "mcp__other__display_to_user"), OUTSIDE],
  ["another tool passes", show([pic(join(tmpdir(), "a.png"))], "Read"), false],
  ["a relative path is left to the tool", show([pic("out/a.png")]), false],
  ["no project folder in the input passes", { tool_name: "mcp__nimbalyst__display_to_user", tool_input: { items: [pic(join(tmpdir(), "a.png"))] } }, false],
  ["no items passes", show(undefined), false],
  ["broken input passes", "not json", false],
  ["PICTURE_IN_PROJECT=off passes", show([pic(join(tmpdir(), "a.png"))]), false, { PICTURE_IN_PROJECT: "off" }],
];
if (process.platform === "win32") {
  cases.push(["on Windows the letter case of the path does not matter", show([pic(join(PROJECT, "a.png").toUpperCase())]), false]);
  cases.push(["on Windows forward slashes work", show([pic(join(PROJECT, "out", "a.png").replace(/\\/g, "/"))]), false]);
}

let failed = 0;
for (const [name, input, want, env] of cases) {
  const out = run(input, env);
  const ok = want === false ? out === "" : out.includes('"deny"') && out.includes(want);
  if (!ok) { failed++; console.log(`FAIL ${name}\n     got: ${out.slice(0, 300) || "(nothing)"}`); } else console.log(`ok   ${name}`);
}
console.log(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} passed`);
process.exit(failed ? 1 : 0);
