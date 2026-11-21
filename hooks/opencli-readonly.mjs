#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// opencli-readonly: a PreToolUse hook for Bash and PowerShell. OpenCLI drives the user's own
// signed-in Chrome (Reddit, X, Facebook, Instagram, Amazon). The user allowed searching and reading
// with their accounts, never posting, liking, following, deleting or logging in. OpenCLI tags every
// site command [read] or [write] in `opencli <site> --help`; this hook asks OpenCLI itself and lets
// only [read] commands through, so new commands are covered without a list here.
// A site command it cannot verify (help failed or timed out, odd words) is denied; when OpenCLI is
// not installed the call is let through, since it cannot act. OPENCLI_READONLY=off disables it.
// `opencli browser <session> <click|fill|type|...>` passes: it drives the open page step by step for a job the
// person asked for (joining, filling a form; user decision 2026-11-19), with a reminder to confirm before a click
// that publishes or sends in their name. Only the listed page steps pass: `eval` (any script in the signed-in
// page, so a post with no click), `init` and `verify` stay denied, as do the site commands that post, like,
// follow or delete.
import { emit, runHook } from "./lib/hook-io.mjs";

// Not site commands: they don't act on an account.
const OWN = new Set([
  "doctor",
  "list",
  "daemon",
  "help",
  "update",
  "completion",
]);
// OpenCLI's global options that take a value (`opencli --profile me reddit ...`).
const VALUE_FLAGS = new Set(["--profile"]);

// `opencli browser` steps that look at or drive the open page. Anything else under `browser` is denied.
const BROWSER_STEPS = new Set(
  "bind unbind tab open back scroll state frames screenshot console analyze find get click type hover focus dblclick check uncheck upload drag fill select keys dialog wait extract network close help".split(
    " ",
  ),
);
// Steps that change the page: these get the confirm-before-publishing reminder.
const BROWSER_ACTS = new Set(
  "click type dblclick check uncheck upload drag fill select keys dialog".split(
    " ",
  ),
);
const BROWSER_DENIED = new Set(["eval", "init", "verify"]);
const ACT_NOTE =
  "opencli-readonly: this drives the user's signed-in Chrome. Before a click that publishes or sends in their name (post, comment, message, pay, submit an application), say what it sends and wait for their yes.";

const deny = (reason) => emit.deny(`opencli-readonly: ${reason}`);

// The words after one `opencli`, up to the end of that shell command, quotes and escapes removed.
// A redirection holding `&` (`2>&1`, `&>file`) is blanked first, so it does not end the command early.
function wordsAfter(rest) {
  const segment = rest.replace(/\d*>&\d*-?|&>>?/g, " ").split(/[;&|\n`)]/)[0];
  return [...segment.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((m) =>
    m[0].replace(/["'`\\^]/g, ""),
  );
}

// The site and its command, flags skipped wherever they sit.
function siteAndSub(words, n = 2) {
  const plain = [];
  for (let i = 0; i < words.length && plain.length < n; i++) {
    const w = words[i];
    if (w.startsWith("-")) {
      if (VALUE_FLAGS.has(w.toLowerCase())) i++;
      continue;
    }
    // A redirection (`2>`, `>out.txt`, `2>/dev/null`) is the shell's, not a word for OpenCLI;
    // a bare operator takes the next word (its file) with it.
    if (/^\d*[<>]/.test(w)) {
      if (/^\d*[<>]+$/.test(w)) i++;
      continue;
    }
    if (w) plain.push(w);
  }
  return plain;
}

runHook(
  "opencli-readonly",
  (event) => {
    if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
    // Whole-line shell comments (`# ...`) run nothing, so their words are not read.
    const command = String((event.tool_input || {}).command || "").replace(
      /^[ \t]*#.*$/gm,
      "",
    );
    if (!/\bopencli\b/i.test(command)) return;

    const helpCache = new Map();
    let acts = false;
    // A longer name (`opencli-readonly`, `test-opencli`) is not the program and is skipped. Any other
    // word holding `opencli` may run it (`opencli.ps1`, `npx @jackwener/opencli@latest`,
    // `node .../opencli/dist/src/main.js`): the rest of that word is dropped and the words after it
    // are read as the site and command.
    for (const m of command.matchAll(/\bopencli/gi)) {
      let rest = command.slice(m.index + m[0].length);
      if (command[m.index - 1] === "-" || /^[-_]\w/.test(rest)) continue;
      rest = rest.replace(/^[^\s"';&|)<>]*["']?/, "");
      const [site, sub] = siteAndSub(wordsAfter(rest));
      if (!site || OWN.has(site.toLowerCase())) continue;
      if (site.toLowerCase() === "browser") {
        // `opencli browser <session> <step>`; an older form leaves the session out. A denied step name in
        // either place is refused, so a session named after a step cannot hide `eval`.
        const [, a, b] = siteAndSub(wordsAfter(rest), 3).map((w) =>
          w.toLowerCase(),
        );
        if (!a) continue; // `opencli browser --help`
        const step = BROWSER_STEPS.has(b) ? b : BROWSER_STEPS.has(a) ? a : null;
        if (!step || BROWSER_DENIED.has(a) || BROWSER_DENIED.has(b))
          return deny(
            `\`opencli browser ${[a, b].filter(Boolean).join(" ")}\` is not one of the page steps allowed in the user's signed-in Chrome (${[...BROWSER_STEPS].join(", ")}). \`eval\` would run a script in the signed-in page, which could post with no click. Drive the page with \`state\`, then click, fill, type, select or upload by ref.`,
          );
        if (BROWSER_ACTS.has(step)) acts = true;
        continue;
      }
      if (!sub) continue; // `opencli reddit --help`
      if (!/^[A-Za-z0-9-]+$/.test(site) || !/^[A-Za-z0-9-]+$/.test(sub)) {
        return deny(
          `could not read the site and command in \`opencli ${site} ${sub}\`. Write it plainly as \`opencli <site> <command> ...\` with a [read] command. If this command runs no opencli at all (the word is only in a file name or a list), write that word another way (a glob such as open*) and send it again.`,
        );
      }
      if (!helpCache.has(site)) {
        const r = spawnSync(`opencli ${site} --help`, {
          shell: true,
          encoding: "utf8",
          timeout: 8000,
          windowsHide: true,
        });
        const missing =
          !r.error &&
          (r.status === 127 ||
            r.status === 9009 ||
            /not recognized|not found/i.test(r.stderr || ""));
        helpCache.set(
          site,
          r.status === 0 ? r.stdout : missing ? "missing" : null,
        );
      }
      const help = helpCache.get(site);
      if (help === "missing") return; // OpenCLI not installed: it cannot act
      if (help === null) {
        return deny(
          `\`opencli ${site} --help\` failed or timed out, so \`${sub}\` could not be verified as a [read] command. Check \`opencli doctor\`, then try again.`,
        );
      }
      const line = help
        .split(/\r?\n/)
        .find((l) => new RegExp(`^\\s+${sub}(\\s|$)`, "i").test(l));
      const tag = line && (line.match(/\[(read|write)\]/) || [])[1];
      if (tag === "read") continue;
      return deny(
        tag === "write"
          ? `\`opencli ${site} ${sub}\` is a [write] command. Site commands on the user's accounts are for searching and reading only: never post, comment, like, follow, save, delete or log in. For a job the user asked for, drive the page with \`opencli browser <session> state\`, then click or fill by ref. Otherwise use a [read] command (see \`opencli ${site} --help\`), or tell the user what you wanted to do.`
          : `\`opencli ${site} ${sub}\` is not listed as a [read] command in \`opencli ${site} --help\`. Use a [read] command from that list, or tell the user what you wanted to do. If this command runs no opencli at all (the word is only in a file name or a list), write that word another way (a glob such as open*) and send it again.`,
      );
    }
    if (acts) emit.context("PreToolUse", ACT_NOTE);
  },
  { failClosed: true },
);
