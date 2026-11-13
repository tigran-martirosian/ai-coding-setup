// Tests for hooks/browser-visible-gate.mjs: headless:false is refused, everything else passes. Run: node tests/test-browser-visible-gate.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verdict } from "../hooks/browser-visible-gate.mjs";

assert.match(verdict({ url: "https://www.linkedin.com/login", headless: false }), /site-login/);
assert.match(verdict({ url: "https://example.com", headless: false }, "win32"), /cmd \/\/c start "" "<url>"/); // the way to really show a page
assert.match(verdict({ url: "https://example.com", headless: false }, "darwin"), /open "<url>"/);
assert.match(verdict({ url: "https://example.com", headless: false }, "linux"), /xdg-open "<url>"/);
assert.match(verdict({ url: "https://example.com", headless: false }), /never say a page is open/);
assert.equal(verdict({ url: "https://x.com" }), null);
assert.equal(verdict({ url: "https://x.com", headless: true }), null);
assert.equal(verdict(undefined), null);

const run = (input) => execFileSync(process.execPath, [fileURLToPath(new URL("../hooks/browser-visible-gate.mjs", import.meta.url))],
  { input: JSON.stringify({ tool_name: "mcp__nimbalyst-browser__browser_open_session", tool_input: input }) }).toString();
assert.match(run({ url: "https://a", headless: false }), /"permissionDecision":"deny"/);
assert.equal(run({ url: "https://a" }), "");
console.log("browser-visible-gate tests passed");
