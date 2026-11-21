// Tests for hooks/browser-visible-gate.mjs: headless:false is refused and points to try-page, everything else passes. Run: node tests/test-browser-visible-gate.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verdict } from "../hooks/browser-visible-gate.mjs";

assert.match(
  verdict({ url: "https://www.linkedin.com/login", headless: false }),
  /site-login/,
);
assert.match(
  verdict({ url: "https://example.com", headless: false }, "win32"),
  /cmd \/\/c start "" "<url>"/,
); // the way to really show a page
assert.match(
  verdict({ url: "https://example.com", headless: false }, "darwin"),
  /open "<url>"/,
);
assert.match(
  verdict({ url: "https://example.com", headless: false }, "linux"),
  /xdg-open "<url>"/,
);
assert.match(
  verdict({ url: "https://example.com", headless: false }),
  /Refused: headless: false/,
);
assert.match(
  verdict({ url: "http://localhost:3000", headless: false }),
  /node ~\/\.claude\/workers\/try-page\.mjs <url> --session <id>/,
); // a local dev server opens in a tab beside the chat
assert.doesNotMatch(
  verdict({ url: "https://example.com", headless: false }),
  /never shows the user a window/,
); // a .browser.json file opened in Nimbalyst is a visible tab
const local = verdict({ url: "http://localhost:3000", headless: false });
assert.match(
  local,
  /prints a link that opens the page in a Nimbalyst browser tab beside the chat/,
); // the worker gives a link; only the Try it button's watcher opens the tab by itself
assert.match(local, /give the user that link/);
assert.match(
  local,
  /Nimbalyst session id when you know it, else any short name/,
); // what --session takes
assert.doesNotMatch(local, /it opens in a Nimbalyst browser tab/); // no claim it opens by itself
assert.equal(verdict({ url: "https://x.com" }), null);
assert.equal(verdict({ url: "https://x.com", headless: true }), null);
assert.equal(verdict(undefined), null);

const run = (input) =>
  execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../hooks/browser-visible-gate.mjs", import.meta.url),
      ),
    ],
    {
      input: JSON.stringify({
        tool_name: "mcp__nimbalyst-browser__browser_open_session",
        tool_input: input,
      }),
    },
  ).toString();
assert.match(
  run({ url: "https://a", headless: false }),
  /"permissionDecision":"deny"/,
);
assert.equal(run({ url: "https://a" }), "");
console.log("browser-visible-gate tests passed");
