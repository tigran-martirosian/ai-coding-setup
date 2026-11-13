// Tests for hooks/opencli-readonly.mjs. Run: node tests/test-opencli-readonly.mjs
// The hook asks `opencli <site> --help` which commands are [read]. A fake opencli on the PATH answers
// here, so the test needs no OpenCLI, no browser and no account.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/opencli-readonly.mjs", import.meta.url),
);
const bin = mkdtempSync(join(tmpdir(), "opencli-fake-"));
const empty = mkdtempSync(join(tmpdir(), "opencli-none-"));
const HELP = {
  amazon: `Commands:
  product <asin> [options]            [read] Read an Amazon product page`,
  facebook: `Commands:
  add-friend <user>                   [write] Send a friend request
  login [options]                     [write] Open Facebook login`,
  reddit: `Commands:
  comment <post-id> <text>            [write] Post a comment on a Reddit post
  login [options]                     [write] Open reddit login
  read <post-id> [options]            [read] Read a Reddit post and its comments
  search <query> [options]            [read] Search Reddit Posts
  upvote <post-id> [options]          [write] Upvote or downvote a Reddit post`,
  twitter: `Commands:
  delete <url>                        [write] Delete a post
  follow <user>                       [write] Follow a user
  like <url>                          [write] Like a post
  search <query>                      [read] Search posts`,
};
writeFileSync(
  join(bin, "fake.mjs"),
  `const help = ${JSON.stringify(HELP)};
const [site, flag] = process.argv.slice(2);
if (flag !== "--help" || !help[site]) process.exit(1);
console.log(help[site]);
`,
);
writeFileSync(
  join(bin, "opencli.cmd"),
  `@"${process.execPath}" "%~dp0fake.mjs" %*\r\n`,
);
writeFileSync(
  join(bin, "opencli"),
  `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake.mjs" "$@"\n`,
);
chmodSync(join(bin, "opencli"), 0o755);

// The PATH variable is spelled "Path" on Windows; replace it whatever its spelling.
const withPath = (dir, env) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"),
  ),
  PATH: dir + delimiter + process.env.PATH,
  ...env,
});
let pass = 0,
  fail = 0;
function run(command, { tool = "Bash", env = {}, dir = bin } = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: { command } }),
    encoding: "utf8",
    env:
      dir === empty
        ? { ...withPath(empty, env), PATH: empty }
        : withPath(dir, env),
  });
  return r.stdout.includes('"deny"') ? "deny" : "allow";
}
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${got}, want ${want}`}`,
  );
}

check(
  "read: reddit search",
  run('opencli reddit search "hand juicer" -f yaml'),
  "allow",
);
check("read: reddit read", run("opencli reddit read 1abcde -f yaml"), "allow");
check(
  "write: reddit comment",
  run('opencli reddit comment 1abcde "nice"'),
  "deny",
);
check("write: reddit upvote", run("opencli reddit upvote 1abcde"), "deny");
check("write: reddit login", run("opencli reddit login"), "deny");
check(
  "write: twitter like",
  run("opencli twitter like https://x.com/a/status/1"),
  "deny",
);
check(
  "write: twitter delete",
  run("opencli twitter delete https://x.com/a/status/1"),
  "deny",
);
check(
  "read: amazon product",
  run("opencli amazon product B0TEST -f yaml"),
  "allow",
);
check("write: facebook login", run("opencli facebook login"), "deny");
check(
  "write: facebook add-friend",
  run("opencli facebook add-friend someone"),
  "deny",
);
check("own command: list", run("opencli list"), "allow");
check(
  "a command the help doesn't list",
  run("opencli reddit nuke-everything"),
  "deny",
);
check(
  "a write hidden after a read",
  run('opencli reddit search "x" && opencli reddit comment abc "hi"'),
  "deny",
);
check(
  "a write through PowerShell",
  run("opencli twitter follow someone", { tool: "PowerShell" }),
  "deny",
);
check("own command: doctor", run("opencli doctor"), "allow");
check("site help", run("opencli reddit --help"), "allow");
check("no opencli at all", run("ls -la"), "allow");
check(
  "other tool",
  run("opencli reddit comment a b", { tool: "Read" }),
  "allow",
);
check(
  "off switch",
  run('opencli reddit comment a "b"', { env: { OPENCLI_READONLY: "off" } }),
  "allow",
);
check(
  "OpenCLI not installed: fails open",
  run('opencli reddit comment a "b"', { dir: empty }),
  "allow",
);
check(
  "bad input fails open",
  spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" })
    .stdout,
  "",
);
check(
  "write with the command in quotes",
  run('opencli reddit "comment" abc'),
  "deny",
);
check(
  "write with --profile before the site",
  run("opencli --profile me reddit comment abc"),
  "deny",
);
check(
  "write with a flag between site and command",
  run("opencli reddit --json comment abc"),
  "deny",
);
check(
  "read with --profile before the site",
  run('opencli --profile me reddit search "x"'),
  "allow",
);
check(
  "site help that fails: denied, not let through",
  run("opencli broken comment abc"),
  "deny",
);
check(
  "a comment line naming it",
  run("ls\n\n# Runs the opencli gate test"),
  "allow",
);
check(
  "odd characters in the command word",
  run("opencli reddit com$ment abc"),
  "deny",
);

rmSync(bin, { recursive: true, force: true });
rmSync(empty, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
