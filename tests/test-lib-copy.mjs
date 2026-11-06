// The Usage Plan panel carries its own copy of the usage dashboard's number logic
// (extensions/usage-plan/src/usage-dashboard-lib.mjs). It must stay byte-identical to the skill's file.
// Run: node tests/test-lib-copy.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const skill = read("../skills/setup-audit/scripts/usage-dashboard-lib.mjs");
const panel = read("../extensions/usage-plan/src/usage-dashboard-lib.mjs");
if (skill !== panel) {
  console.error("FAIL  extensions/usage-plan/src/usage-dashboard-lib.mjs differs from skills/setup-audit/scripts/usage-dashboard-lib.mjs\nCopy the skill file over the extension copy.");
  process.exit(1);
}
console.log("ok  the panel's copy of usage-dashboard-lib.mjs matches the skill's");
