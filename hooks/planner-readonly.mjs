#!/usr/bin/env node
// planner-readonly: a PreToolUse hook for Bash and PowerShell that keeps the planner agent's shell to reading.
// The planner may look at live state (git status, git log, file listings, the systems map) but never change a
// file: a plan is trusted as read-only. Acts only when the event names the planner, the plan-reviewer or the reviewer
// (agent_type, which a subagent's PreToolUse event carries; probe 2026-11-08, Claude Code 2.1.318).
// It is wired twice, in the
// planner's frontmatter and in settings.json, so a skipped frontmatter hook still leaves a guard.
// Each segment of the command (split on && || ; | and new lines) must be one of the allowed commands below;
// everything else is denied, and so is anything the hook cannot read: $(...), backticks, redirects other than
// 2>&1 and >/dev/null, a lone &, an env assignment before a command (a variable set on its own passes unless it is
// PATH, GIT_* and the like), and an error inside the hook (it fails closed).
// Flags that make an allowed command run another program (rg --pre, git grep -O, git -c, --ext-diff,
// --textconv, sort --compress-program) or write a file (--output, sort -o) are denied too.
// The plan-reviewer (agent_type "plan-reviewer") gets the same reading list plus test runs, since it runs a plan's
// Expect before and Done when checks: node on a file whose name has "test" in it, npm test / npm run test*, pytest,
// python on a test file (user, 2026-11-09: "Hook like the planner's, plus the project's test commands"; a test may
// still write caches).
// Off switch: PLANNER_READONLY=off.
import { emit, runHook } from "./lib/hook-io.mjs";

const ALLOWED_TEXT =
  "git status/diff/log/show/rev-parse/ls-files/ls-tree/blame/grep, git branch (list), git worktree list, " +
  'git remote -v, git stash list, cd, pwd, echo, a plain variable on its own (R="C:/x"), ls, dir, wc, stat, du, file, head, tail, sort, uniq, cut, tr, grep, rg, and node <...>/skills/systems-map/map.mjs';
const TEST_TEXT =
  "; and test runs: node <a file named *test* or in a tests folder>.mjs/.js, npm test, npm run test*, pytest, python [-m pytest | <a file named *test*>.py]";
const agentName = (event) =>
  String(event.agent_type || "")
    .split(":")
    .pop()
    .toLowerCase();
const denyPlanner = (reason) =>
  emit.deny(
    `planner-readonly: ${reason}. The planner reads only (allowed: ${ALLOWED_TEXT}). ` +
      "To have a check run, name it in the row's Expect before; the plan-reviewer runs it.",
  );
const denyReviewer = (reason, who) =>
  emit.deny(
    `planner-readonly: ${reason}. The ${who} reads and runs tests only (allowed: ${ALLOWED_TEXT}${TEST_TEXT}). ` +
      "A check that deploys, installs, pushes or writes: list it as not run, with why.",
  );

// The planner reads only; plan-reviewer and reviewer also run tests (user, 2026-11-12, D7 item 1).
const isPlanner = (event) =>
  /(^|:)planner$/i.test(String(event.agent_type || ""));
const isPlanReviewer = (event) =>
  /(^|:)(plan-reviewer|reviewer)$/i.test(String(event.agent_type || ""));
const NULL_TARGETS = new Set(["/dev/null", "$null", "nul"]);

// Split a command into segments of words. Returns { segments } or { error }.
export function lex(command) {
  const segments = [[]];
  const unquoted = new Set();
  let word = null; // null = no word open
  const seg = () => segments[segments.length - 1];
  const end = () => {
    if (word !== null) {
      seg().push(word);
      word = null;
    }
  };
  const cut = () => {
    end();
    segments.push([]);
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i],
      next = command[i + 1];
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close < 0) return { error: "an unclosed quote" };
      word = (word ?? "") + command.slice(i + 1, close);
      i = close;
      continue;
    }
    if (c === '"') {
      let j = i + 1,
        text = "";
      for (; j < command.length && command[j] !== '"'; j++) {
        if (
          command[j] === "`" ||
          (command[j] === "$" && "({".includes(command[j + 1]))
        )
          return {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: names the shell's ${...} syntax
            error: "a command inside the command ($(...), ${...} or backticks)",
          };
        if (command[j] === "\\" && j + 1 < command.length) {
          text += command[++j];
          continue;
        }
        text += command[j];
      }
      if (j >= command.length) return { error: "an unclosed quote" };
      word = (word ?? "") + text;
      i = j;
      continue;
    }
    if (c === "`" || (c === "$" && (next === "(" || next === "{")))
      return {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: names the shell's ${...} syntax
        error: "a command inside the command ($(...), ${...} or backticks)",
      };
    if ((c === "<" || c === ">") && next === "(")
      return { error: "a process substitution" };
    if (c === "#" && word === null) {
      const nl = command.indexOf("\n", i);
      if (nl < 0) break;
      i = nl - 1;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      if (next === "\n") {
        i++;
        continue;
      }
      word = (word ?? "") + next;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      end();
      continue;
    }
    if (c === "\n" || c === ";") {
      cut();
      continue;
    }
    if (c === "&" && next === "&") {
      cut();
      i++;
      continue;
    }
    if (c === "|") {
      cut();
      if (next === "|") i++;
      continue;
    }
    if (c === "&") return { error: "a command sent to the background (&)" };
    if (c === "<") return { error: "an input redirect (<)" };
    if (c === ">") {
      if (word !== null && /^[12]$/.test(word))
        word = null; // the fd before > (2>...)
      else end();
      let j = i + 1;
      if (command[j] === ">") j++;
      if (command[j] === "&" && /[12]/.test(command[j + 1] || "")) {
        i = j + 1;
        continue;
      } // 2>&1
      while (command[j] === " " || command[j] === "\t") j++;
      const m = /^[^\s;&|<>]+/.exec(command.slice(j));
      if (
        !m ||
        !NULL_TARGETS.has(m[0].replace(/^["']|["']$/g, "").toLowerCase())
      )
        return { error: "a redirect that writes a file (>)" };
      i = j + m[0].length - 1;
      continue;
    }
    if (c === "(" || c === ")")
      return {
        error:
          "an unquoted bracket (a subshell, or in PowerShell a command run inside the command)",
      };
    if (c === "$") {
      const m = /^[A-Za-z_]\w*/.exec(command.slice(i + 1));
      if (m) unquoted.add(m[0]); // an unquoted $R splits on spaces in its value
    }
    word = (word ?? "") + c;
  }
  end();
  return { segments: segments.filter((s) => s.length), unquoted };
}

const flag = (args, re) => args.find((a) => re.test(a));
// git and GNU tools take any unambiguous start of a long option (--open=vi is --open-files-in-pager=vi), so a long
// flag is caught when its name is the start of a dangerous option's name. Names in "exact" are real options of their own.
const longHit = (args, names, exact = []) =>
  args.find((a) => {
    const m = /^--([^=]+)/.exec(a);
    return m && !exact.includes(m[1]) && names.some((n) => n.startsWith(m[1]));
  });
const GIT_SUBS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "blame",
  "grep",
  "branch",
  "worktree",
  "remote",
  "stash",
]);
const GIT_RUNS = ["open-files-in-pager", "ext-diff", "textconv"];

function checkGit(args) {
  let i = 0;
  for (; i < args.length && args[i].startsWith("-"); i++) {
    const a = args[i];
    if (a === "-C") {
      if (!args[i + 1]) return "git -C needs a folder";
      i++;
      continue;
    }
    if (a === "--no-pager" || a === "-P") continue;
    return `git ${a} is not allowed before the subcommand (-c and --exec-path run configured programs)`;
  }
  const sub = args[i],
    rest = args.slice(i + 1);
  if (!sub || !GIT_SUBS.has(sub))
    return `git ${sub || "with no subcommand"} is not a reading command`;
  const bad =
    longHit(rest, ["output"]) ||
    (["diff", "log", "show"].includes(sub) && flag(rest, /^-o$/));
  if (bad) return `git ${sub} ${bad} writes a file`;
  const runs = flag(rest, /^-[a-zA-Z]*O/) || longHit(rest, GIT_RUNS, ["text"]);
  if (runs) return `git ${sub} ${runs} runs another program`;
  if (
    sub === "branch" &&
    !rest.every((a) => ["--list", "-a", "--all", "-r", "-v", "-vv"].includes(a))
  )
    return "git branch only lists (no name, no -d/-m)";
  if (
    sub === "worktree" &&
    (rest[0] !== "list" ||
      !rest.slice(1).every((a) => ["--porcelain", "-v"].includes(a)))
  )
    return "only git worktree list";
  if (
    sub === "remote" &&
    !(rest.length === 0 || (rest.length === 1 && rest[0] === "-v"))
  )
    return "only git remote -v";
  if (sub === "stash" && rest[0] !== "list") return "only git stash list";
  return null;
}

const SIMPLE = new Set([
  "ls",
  "dir",
  "wc",
  "stat",
  "du",
  "cut",
  "tr",
  "grep",
  "head",
  "cd", // 1258 refusals in 7 days were mostly cd, echo and R=... (2026-11-13); a redirect is still refused
  "pwd",
  "echo",
]);

// A test file: named test-x, test_x, x.test, x-tests, x.spec..., or inside a test(s) folder; never with a .. step.
const TEST_NAME =
  /^(tests?([-_.][^\\/]*)?|[^\\/]*[-_.](tests?|spec))\.(m?js|cjs|py)$/i;
function isTestFile(p, ext) {
  if (!p || /(^|[\\/])\.\.([\\/]|$)/.test(p) || !ext.test(p)) return false;
  return (
    TEST_NAME.test(p.split(/[\\/]/).pop()) || /(^|[\\/])tests?[\\/]/i.test(p)
  );
}
// pytest flags that only choose or show tests (-p, --basetemp, --junitxml, -o and the rest load code or write files).
const PYTEST_OK =
  /^(-[qvxsl]+|-[km]|-r[a-zA-Z]*|--tb=\w+|--maxfail=\d+|--co|--collect-only|--lf|--ff|--durations=\d+)$/;
const pytestOk = (args) =>
  args.every((a) => !a.startsWith("-") || PYTEST_OK.test(a));

// A test run the plan-reviewer may start; null when the segment is not one.
function isTestRun(name, args) {
  if (name === "node") return isTestFile(args[0], /\.(m?js|cjs)$/i); // no node flags at all (--eval, --watch, --require)
  if (name === "npm")
    return (
      (args.length === 1 && (args[0] === "test" || args[0] === "t")) ||
      (args.length === 2 &&
        args[0] === "run" &&
        /^test(:[\w:-]+)?$/.test(args[1]))
    );
  if (name === "pytest") return pytestOk(args);
  if (name === "python" || name === "python3" || name === "py") {
    const rest = args.filter((a) => a !== "-I" && a !== "-u" && a !== "-B");
    if (rest[0] === "-m")
      return rest[1] === "pytest" && pytestOk(rest.slice(2));
    return isTestFile(rest[0], /\.py$/i);
  }
  return false;
}

// A variable set on its own (R="C:/x", then ls "$R") only names a path; these names change what a later command runs.
const RISKY_VAR =
  /^(PATH|IFS|CDPATH|ENV|BASH_ENV|PS4|PROMPT_COMMAND|SHELLOPTS|BASHOPTS|HOME|GIT_\w*|NODE_\w*|NPM_\w*|PYTHON\w*|LD_\w*|RG_\w*)$/i;

export function checkSegment(words, { tests = false } = {}) {
  const [first, ...args] = words;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
    const name = first.split("=")[0];
    if (args.length) return `setting a variable (${name}=) before a command`;
    return RISKY_VAR.test(name)
      ? `setting ${name}, which changes what later commands run`
      : null;
  }
  if (/[\\/]/.test(first))
    return `${first} is a command with a path (only the plain names below are allowed)`;
  const name = first.replace(/\.exe$/i, "").toLowerCase();
  if (tests && isTestRun(name, args)) return null;
  if (name === "git") return checkGit(args);
  if (SIMPLE.has(name)) return null;
  if (name === "tail") {
    const f = flag(args, /^-[a-zA-Z0-9]*[fF]/) || longHit(args, ["follow"]);
    return f ? `tail ${f} never ends` : null;
  }
  if (name === "sort") {
    const f =
      flag(args, /^-[a-zA-Z]*o/) ||
      longHit(args, ["output", "compress-program"]);
    return f ? `sort ${f} writes a file or runs a program` : null;
  }
  if (name === "uniq") {
    const files = [];
    for (let i = 0; i < args.length; i++) {
      if (["-f", "-s", "-w"].includes(args[i])) {
        i++;
        continue;
      }
      if (!args[i].startsWith("-")) files.push(args[i]);
    }
    return files.length > 1 ? "uniq with an output file writes it" : null;
  }
  if (name === "file") {
    const f = flag(args, /^-[a-zA-Z]*C/) || longHit(args, ["compile"]);
    return f ? `file ${f} writes a file` : null;
  }
  if (name === "rg") {
    const f =
      flag(args, /^-[a-zA-Z]*z/) ||
      longHit(args, ["pre", "pre-glob", "hostname-bin", "search-zip"]);
    return f ? `rg ${f} runs another program` : null;
  }
  if (name === "node") {
    return args[0] && /[\\/]skills[\\/]systems-map[\\/]map\.mjs$/i.test(args[0])
      ? null
      : "node runs only the systems map reader (skills/systems-map/map.mjs)";
  }
  return `${first} is not a reading command the planner may run`;
}

export function decide(command, opts) {
  const { segments, unquoted, error } = lex(command);
  if (error) return `the command has ${error}`;
  // Each later $R is checked as its value, so a flag hidden in a variable is seen (R=--open=vi; git grep "$R").
  const vars = {};
  const expand = (w) =>
    w.replace(/\$([A-Za-z_]\w*)/g, (m, n) => (n in vars ? vars[n] : m));
  for (const raw of segments) {
    const words = raw.map(expand);
    const why = checkSegment(words, opts);
    if (why) return why;
    const set = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(words[0]);
    if (set && words.length === 1) {
      if (/\s/.test(set[2]) && unquoted.has(set[1]))
        return `$${set[1]} is used without quotes and its value has a space`;
      vars[set[1]] = set[2];
    }
  }
  return null;
}

runHook("planner-readonly", (event) => {
  if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
  const reviewer = isPlanReviewer(event);
  if (!reviewer && !isPlanner(event)) return;
  let why;
  try {
    why = decide(String((event.tool_input || {}).command || ""), {
      tests: reviewer,
    });
  } catch (err) {
    why = `the hook could not read the command (${err.message})`;
  } // fails closed inside a planner
  if (why) (reviewer ? denyReviewer : denyPlanner)(why, agentName(event));
});
