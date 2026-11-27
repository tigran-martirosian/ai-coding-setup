// Tests for hooks/social-route.mjs. Run: node tests/test-social-route.mjs
// The hook sends WebFetch and WebSearch calls for Reddit and X to ~/.claude/workers/social/social.mjs. Each case
// runs the hook alone with a JSON event; the last one runs it through the pre-tool dispatcher, as installed.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/social-route.mjs", import.meta.url),
);
const DISPATCH = fileURLToPath(
  new URL("../hooks/dispatch.mjs", import.meta.url),
);
const home = mkdtempSync(join(tmpdir(), "social-route-home-"));
const TOOL = `node "${home.replace(/\\/g, "/")}/.claude/workers/social/social.mjs"`;

let pass = 0,
  fail = 0;
// The hook's answer: { kind: "deny" | "note" | "silent", text }
function run(
  tool_name,
  tool_input,
  { env = {}, script = HOOK, args = [] } = {},
) {
  const r = spawnSync(process.execPath, [script, ...args], {
    input:
      typeof tool_input === "string"
        ? tool_input
        : JSON.stringify({ tool_name, tool_input }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SOCIAL_ROUTE: "",
      ...env,
    },
  });
  if (r.status !== 0) return { kind: `exit ${r.status}`, text: r.stderr };
  if (!r.stdout.trim()) return { kind: "silent", text: "" };
  const o = JSON.parse(r.stdout).hookSpecificOutput || {};
  if (o.permissionDecision === "deny")
    return { kind: "deny", text: o.permissionDecisionReason };
  if (o.additionalContext) return { kind: "note", text: o.additionalContext };
  return { kind: "other", text: r.stdout };
}
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${got}, want ${want}`}`,
  );
}
const has = (r, ...parts) =>
  `${r.kind} ${parts.every((p) => r.text.includes(p))}`;

// ---- WebFetch of a Reddit or X page: refused, with the social.mjs command for that link
for (const url of [
  "https://www.reddit.com/r/juicing/comments/1abcde/best_hand_juicer/",
  "https://redd.it/1abcde",
  "https://x.com/jack/status/20",
  "https://mobile.twitter.com/jack/status/20",
])
  check(
    `a WebFetch of ${url} is refused with the social.mjs command for that link, under ~/.claude/workers/social/`,
    has(
      run("WebFetch", { url, prompt: "x" }),
      `${TOOL} '${url}' --comments 15`,
    ),
    "deny true",
  );
check(
  "a WebFetch of another site passes",
  run("WebFetch", { url: "https://example.com/reddit.com", prompt: "x" }).kind,
  "silent",
);
check(
  "a site whose name only ends in reddit.com is not Reddit",
  run("WebFetch", { url: "https://notreddit.com/a", prompt: "x" }).kind,
  "silent",
);

// A link or query is pasted into the suggested command single-quoted, so shell syntax in it stays plain text
check(
  "a link with $(...) and a quote in it is single-quoted in the suggested command",
  has(
    run("WebFetch", {
      url: "https://x.com/a/status/1?q=$(touch pwned)'x",
      prompt: "x",
    }),
    `${TOOL} 'https://x.com/a/status/1?q=$(touch pwned)'\\''x' --comments 15`,
  ),
  "deny true",
);
check(
  "a query with backticks and a quote is single-quoted in the suggested search",
  has(
    run("WebSearch", {
      query: "it's `id` fun",
      allowed_domains: ["reddit.com"],
    }),
    `${TOOL} search reddit 'it'\\''s \`id\` fun' --limit 8`,
  ),
  "deny true",
);

// ---- WebSearch limited to Reddit or X: refused, with the search command and the way back to a plain search
check(
  "a WebSearch with allowed_domains on Reddit is refused with social.mjs search reddit and the plain-search way out",
  has(
    run("WebSearch", {
      query: "best hand juicer",
      allowed_domains: ["reddit.com"],
    }),
    `${TOOL} search reddit 'best hand juicer' --limit 8`,
    "If social.mjs fails, run the WebSearch again without allowed_domains",
  ),
  "deny true",
);
check(
  "a WebSearch with allowed_domains on X is refused with social.mjs search x",
  has(
    run("WebSearch", {
      query: "claude code hooks",
      allowed_domains: ["x.com"],
    }),
    `${TOOL} search x 'claude code hooks'`,
  ),
  "deny true",
);

// ---- site: in the query: the search runs, with a note naming social.mjs
check(
  "a WebSearch with site:reddit.com runs with a note giving social.mjs search reddit, not a refusal",
  has(
    run("WebSearch", { query: "site:reddit.com best hand juicer" }),
    `${TOOL} search reddit 'best hand juicer' --limit 8`,
    "[social-route]",
  ),
  "note true",
);
check(
  "a WebSearch with site:x.com runs with a note giving social.mjs search x",
  has(
    run("WebSearch", { query: "claude code site:x.com" }),
    `${TOOL} search x 'claude code'`,
  ),
  "note true",
);

// ---- the words Reddit or X in the query: refused, and the plain search without the word stays open
check(
  "a WebSearch naming Reddit is refused with social.mjs search reddit and 'run the WebSearch again without the word Reddit'",
  has(
    run("WebSearch", { query: "what do people use on reddit for juicing" }),
    `${TOOL} search reddit`,
    "run the WebSearch again without the word Reddit",
  ),
  "deny true",
);
check(
  "a WebSearch naming r/<sub> is refused as a Reddit search",
  has(
    run("WebSearch", { query: "r/juicing hand juicer" }),
    `${TOOL} search reddit`,
  ),
  "deny true",
);
check(
  "a WebSearch about tweets is refused with social.mjs search x and 'without the word X'",
  has(
    run("WebSearch", { query: "tweets about claude code" }),
    `${TOOL} search x`,
    "without the word X",
  ),
  "deny true",
);
check(
  "a WebSearch that leaves Reddit out with -site:reddit.com passes",
  run("WebSearch", { query: "best hand juicer -site:reddit.com" }).kind,
  "silent",
);
check(
  "a plain WebSearch passes",
  run("WebSearch", { query: "best hand juicer 2026" }).kind,
  "silent",
);

// ---- the frame: other tools, the off switch, bad input
check(
  "another tool with a Reddit link passes",
  run("Bash", { command: "curl https://www.reddit.com/r/a/comments/1abcde/" })
    .kind,
  "silent",
);
check(
  "SOCIAL_ROUTE=off lets a WebFetch of Reddit through",
  run(
    "WebFetch",
    { url: "https://www.reddit.com/r/a/comments/1abcde/" },
    { env: { SOCIAL_ROUTE: "off" } },
  ).kind,
  "silent",
);
check(
  "bad input fails open: no answer, exit 0",
  run("", "not json").kind,
  "silent",
);

// ---- as installed: the pre-tool dispatcher runs it for WebFetch
const viaDispatch = run(
  "WebFetch",
  { url: "https://x.com/jack/status/20", prompt: "x" },
  { script: DISPATCH, args: ["pre-tool"] },
);
check(
  "the pre-tool dispatcher (hooks/dispatch-groups.json) runs social-route on WebFetch and passes its refusal on",
  has(viaDispatch, "social-route:", `${TOOL} 'https://x.com/jack/status/20'`),
  "deny true",
);

rmSync(home, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
