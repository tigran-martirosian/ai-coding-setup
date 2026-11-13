// Unit tests for the exports of hooks/verify-gate.mjs (unverified, runsEdited): running an edited script counts as its check; other commands do not. Run: node tests/test-verify-gate-unit.mjs
import assert from "node:assert/strict";
import { unverified, runsEdited } from "../hooks/verify-gate.mjs";

const edit = (id, p) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Edit", input: { file_path: p } }] } });
const bash = (id, command) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
const P = "C:\\Projects\\x\\tools\\grow-house\\melon_carts.py";

assert.equal(runsEdited("cd /c/x && python tools/grow-house/melon_carts.py > /dev/null", ["melon_carts.py"]), true);
assert.equal(runsEdited("python -I tools/melon_carts.py --out x", ["melon_carts.py"]), true);
assert.equal(runsEdited("node C:/a/b/gen.mjs", ["gen.mjs"]), true);
assert.equal(runsEdited("grep -n x tools/grow-house/melon_carts.py", ["melon_carts.py"]), false);
assert.equal(runsEdited("python tools/other_melon_carts.py", ["melon_carts.py"]), false);
assert.equal(runsEdited("cat melon_carts.py | python", ["melon_carts.py"]), false);

assert.equal(unverified([edit("1", P), bash("2", "python tools/grow-house/melon_carts.py")], null).due, false);
assert.equal(unverified([edit("1", P), bash("2", "grep x tools/grow-house/melon_carts.py")], null).due, true);
assert.equal(unverified([bash("0", "python tools/grow-house/melon_carts.py"), edit("1", P)], null).due, true); // run before the edit
assert.equal(unverified([edit("1", P), bash("2", "cd mdk && ./gradlew build")], null).due, false); // builds still count
const Q = "C:\\h\\hooks\\b.mjs";
assert.equal(unverified([edit("1", P), edit("2", Q), bash("3", "python tools/grow-house/melon_carts.py")], null).due, true); // b.mjs unrun
assert.equal(unverified([edit("1", P), edit("2", Q), bash("3", "python melon_carts.py"), bash("4", "node hooks/b.mjs")], null).due, false);
assert.equal(unverified([edit("1", P), bash("2", "python melon_carts.py"), edit("3", P)], null).due, true); // edited again after its run
assert.equal(unverified([edit("1", Q), edit("2", "C:\\h\\b.test.mjs"), bash("3", "node hooks/b.test.mjs")], null).due, false); // a *.test.mjs run is a test
console.log("verify-gate tests passed");
