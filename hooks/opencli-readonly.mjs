#!/usr/bin/env node
// opencli-readonly: a PreToolUse hook for Bash and PowerShell. OpenCLI drives the user's own
// signed-in Chrome (Reddit, X, Facebook, Instagram, Amazon). The user allowed searching and reading
// with their accounts, never posting, liking, following, deleting or logging in. OpenCLI tags every
// site command [read] or [write] in `opencli <site> --help`; this hook asks OpenCLI itself and lets
// only [read] commands through, so new commands are covered without a list here.
// A site command it cannot verify (help failed or timed out, odd words) is denied; when OpenCLI is
// not installed the call is let through, since it cannot act. OPENCLI_READONLY=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import { spawnSync } from "node:child_process";

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

const deny = (reason) => emit.deny(`opencli-readonly: ${reason}`);

// The words after one `opencli`, up to the end of that shell command, quotes and escapes removed.
function wordsAfter(rest) {
  const segment = rest.split(/[;&|\n`)]/)[0];
  return [...segment.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((m) =>
    m[0].replace(/["'`\\^]/g, ""),
  );
}

// The site and its command, flags skipped wherever they sit.
function siteAndSub(words) {
  const plain = [];
  for (let i = 0; i < words.length && plain.length < 2; i++) {
    const w = words[i];
    if (w.startsWith("-")) {
      if (VALUE_FLAGS.has(w.toLowerCase())) i++;
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
    for (const m of command.matchAll(/\bopencli(?:\.cmd|\.exe)?["']?/gi)) {
      const [site, sub] = siteAndSub(
        wordsAfter(command.slice(m.index + m[0].length)),
      );
      if (!site || OWN.has(site.toLowerCase())) continue;
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
          ? `\`opencli ${site} ${sub}\` is a [write] command. The user's accounts are for searching and reading only: never post, comment, like, follow, save, delete or log in. Use a [read] command (see \`opencli ${site} --help\`), or tell the user what you wanted to do.`
          : `\`opencli ${site} ${sub}\` is not listed as a [read] command in \`opencli ${site} --help\`. Use a [read] command from that list, or tell the user what you wanted to do. If this command runs no opencli at all (the word is only in a file name or a list), write that word another way (a glob such as open*) and send it again.`,
      );
    }
  },
  { failClosed: true },
);
