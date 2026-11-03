// Test for hooks/nimbalyst-notes.mjs: notes in Nimbalyst (sdk entrypoint), silent in the
// terminal and when switched off.
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/nimbalyst-notes.mjs", import.meta.url));
let fail = 0;
const run = (env) =>
  spawnSync(process.execPath, [HOOK], { input: "{}", encoding: "utf8", env: { ...process.env, NIMBALYST_NOTES: "", ...env } });
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}: ${name}`); if (!ok) fail++; };

const sdk = run({ CLAUDE_CODE_ENTRYPOINT: "sdk-ts" });
let ctx = "";
try { ctx = JSON.parse(sdk.stdout).hookSpecificOutput.additionalContext; } catch {}
check("sdk: quirks note", ctx.includes("UnknownVizError") && ctx.includes("`shown` folder"));
check("sdk: board note", ctx.includes("Keep the Nimbalyst board honest") && ctx.includes("isolated: true"));
check("sdk: helper-name note", ctx.includes("Kind: what exactly") && ctx.includes("# WHAT THIS DOES:"));
check("sdk: board call goes with another call", ctx.includes("never alone before the final reply"));
check("sdk: question-form note", ctx.includes("mcp__nimbalyst__PromptForUserInput") && ctx.includes("allowOther: true"));
check("cli: silent", run({ CLAUDE_CODE_ENTRYPOINT: "cli" }).stdout === "");
check("off: silent", run({ CLAUDE_CODE_ENTRYPOINT: "sdk-ts", NIMBALYST_NOTES: "off" }).stdout === "");

console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
