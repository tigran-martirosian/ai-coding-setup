// delete-guard: a PreToolUse hook (Bash|PowerShell) that stops deletes which can take many files at once.
//   Refused: rm with -r/-R/--recursive (rm -rf, rm -fr, rm -r ...), rm with an unquoted wildcard (* ? [),
//   rm fed by xargs, find ... -delete and find ... -exec rm, git clean with -f/--force, and Remove-Item (or
//   its aliases rm, del, rd, ri, rmdir, erase) with -Recurse, a wildcard, -Filter/-Include/-Exclude or no path
//   (fed by a pipe). The refusal tells the agent to name the files, or to ask the user (a helper reports it).
//   Passed without asking (user, 2026-11-12: unattended runs must not stall): rm or Remove-Item of named
//   files, no recursion, no wildcard. Also passed: every target inside a temp, cache or worktree folder: $TEMP/$TMP/$TMPDIR, %TEMP%, $env:TEMP,
//   AppData/Local/Temp, /tmp, a mktemp folder kept in a variable earlier in the command (strictly inside
//   these), node_modules, .cache, __pycache__ (the folder itself too), and worktrees under cch-wt/ or
//   .claude/worktrees/ (strictly inside). Relative paths resolve from the event's cwd and any cd before them.
// The command is split into simple commands on ; && || | & ( ) and new lines (PowerShell also { }), with quotes and
// comments read the shell way, and lead words (then, do, else, elif, if, while, until, !, { }) dropped from the front,
// so a delete inside quoted text (echo "rm -rf /", a grep pattern) is not a command and passes.
// bash/sh -c "..." and powershell/pwsh -Command "..." are read inside. Heredoc bodies are skipped.
// Not seen: deletes done by a script (node, python), a variable holding the command, eval. The setup's own
// cleanup (workers/disk-tidy.mjs, file-check.mjs) deletes from Node, so it passes.
// Helpers (agent_id set) get the same verdicts; their refusal says to report instead of asking.
// Fails open. DELETE_GUARD=off disables it.

import os from "node:os";
import path from "node:path";
import { emit, runHook } from "./lib/hook-io.mjs";

// The texts, here and nowhere else
const TAG = "[delete-guard]";
const INSTEAD_MAIN =
  "If the user asked for this delete, ask them in a form to confirm the exact paths, or tell them the command to run themselves.";
const INSTEAD_HELPER =
  "You are a helper: leave the files in place, name them in your report and say why they should go; the user decides.";
const refuseText = (what, helper) =>
  `${TAG} Refused: ${what} can delete many files at once and cannot be undone. ` +
  `Delete only files you name one by one (rm "path/a.txt" "path/b.txt"), or move scratch work to the temp folder, where deletes pass. ` +
  (helper ? INSTEAD_HELPER : INSTEAD_MAIN);

// Split a command into simple commands (arrays of words) the shell way. A word is { text, glob }: glob when an
// unquoted * ? [ is in it. Redirections are dropped, heredoc bodies skipped, comments dropped. The inside of each
// $( ) or backtick substitution goes to subs, to be read as commands too. ps: PowerShell quoting (` escapes).
function closeParen(src, from) {
  let depth = 1;
  for (let k = from; k < src.length; k++) {
    const ch = src[k];
    if (ch === "'" || ch === '"') {
      const e = src.indexOf(ch, k + 1);
      if (e < 0) return src.length;
      k = e;
    } else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return k;
  }
  return src.length;
}

function lex(src, ps) {
  const cmds = [],
    subs = [];
  let cur = [],
    tok = null,
    heredocs = [],
    redirect = false,
    i = 0;
  const add = (s, glob = false) => {
    tok ??= { text: "", glob: false };
    tok.text += s;
    if (glob) tok.glob = true;
  };
  const endTok = () => {
    if (tok && !redirect) cur.push(tok);
    else if (tok) redirect = false;
    tok = null;
  };
  const endCmd = () => {
    endTok();
    if (cur.length) cmds.push(cur);
    cur = [];
  };
  const sub = () => {
    const e = closeParen(src, i + 2);
    subs.push(src.slice(i + 2, e));
    add(src.slice(i, e + 1));
    i = e + 1;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      endCmd();
      i++;
      for (const h of heredocs) {
        while (i < src.length) {
          const nl = src.indexOf("\n", i),
            end = nl < 0 ? src.length : nl;
          const line = src.slice(i, end).replace(/\r$/, "");
          i = end + 1;
          if ((h.dash ? line.replace(/^\t+/, "") : line) === h.word) break;
        }
      }
      heredocs = [];
    } else if (c === " " || c === "\t" || c === "\r") {
      endTok();
      i++;
    } else if (c === "#" && !tok) {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
    } else if (";|&()".includes(c) || (ps && !tok && "{}".includes(c))) {
      endCmd();
      i++;
    } // ${env:X} keeps its braces
    else if (c === "<" || c === ">") {
      if (!ps && src.startsWith("<<", i) && src[i + 2] !== "<") {
        endTok();
        i += 2;
        const dash = src[i] === "-";
        if (dash) i++;
        while (src[i] === " " || src[i] === "\t") i++;
        const m = /^(['"]?)([^\s;|&<>'"]+)\1/.exec(src.slice(i));
        if (m) {
          heredocs.push({ word: m[2], dash });
          i += m[0].length;
        }
        continue;
      }
      if (tok && /^\d*$/.test(tok.text)) tok = null;
      else endTok();
      while (src[i] === "<" || src[i] === ">" || src[i] === "&") i++;
      redirect = true;
    } else if (c === "'") {
      let e = src.indexOf("'", i + 1);
      if (ps) while (e >= 0 && src[e + 1] === "'") e = src.indexOf("'", e + 2);
      if (e < 0) e = src.length;
      add(ps ? src.slice(i + 1, e).replace(/''/g, "'") : src.slice(i + 1, e));
      i = e + 1;
    } else if (c === '"') {
      add("");
      i++;
      while (i < src.length && src[i] !== '"') {
        if (
          ps
            ? src[i] === "`"
            : src[i] === "\\" && '$`"\\\n'.includes(src[i + 1])
        ) {
          add(src[i + 1] ?? "");
          i += 2;
        } else if (src[i] === "$" && src[i + 1] === "(") sub();
        else add(src[i++]);
      }
      i++;
    } else if (c === (ps ? "`" : "\\")) {
      if (src[i + 1] !== "\n") add(src[i + 1] ?? "");
      i += 2;
    } else if (c === "$" && src[i + 1] === "(") sub();
    else if (!ps && c === "`") {
      let e = src.indexOf("`", i + 1);
      if (e < 0) e = src.length;
      subs.push(src.slice(i + 1, e));
      add(src.slice(i, e + 1));
      i = e + 1;
    } else {
      add(c, "*?[".includes(c));
      i++;
    }
  }
  endCmd();
  return { cmds, subs };
}

// Paths are compared lower-case with forward slashes; Git Bash's /c/... is read as c:/...
const HOME = os.homedir();
function norm(p, cwd) {
  let t = p.replace(/\\/g, "/").replace(/^\/([a-z])(?=\/|$)/i, "$1:");
  if (/^[a-z]:$/i.test(t)) t += "/";
  if (!t.startsWith("/") && !/^[a-z]:\//i.test(t)) {
    if (cwd == null) return null;
    t = `${cwd}/${t}`;
  }
  return path.posix
    .normalize(t)
    .toLowerCase()
    .replace(/(.)\/+$/, "$1");
}
const TEMP_ROOTS = [
  "/tmp",
  ...[os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR]
    .filter(Boolean)
    .map((p) => norm(p, null)),
];
const INSIDE = ["appdata/local/temp", "cch-wt", ".claude/worktrees"]; // strictly inside these
const CACHES = ["node_modules", ".cache", "__pycache__"]; // these themselves too
function safe(p) {
  if (!p) return false;
  if (p.split("/").some((s) => CACHES.includes(s))) return true;
  return (
    TEMP_ROOTS.some((r) => p.startsWith(`${r}/`)) ||
    INSIDE.some((m) => p.includes(`/${m}/`))
  );
}

// A word as a path: ~, the temp and home variables, mktemp and variables set earlier in the command are filled in;
// any other variable or substitution leaves the path unknown (null), which is never safe
const KNOWN = {
  TEMP: "/tmp",
  TMP: "/tmp",
  TMPDIR: "/tmp",
  HOME,
  USERPROFILE: HOME,
  LOCALAPPDATA: `${HOME}/AppData/Local`,
};
function fill(text, st) {
  let unknown = false;
  const t = text
    .replace(/^~(?=[/\\]|$)/, HOME)
    .replace(/\$\(\s*mktemp\b[^)]*\)|`\s*mktemp\b[^`]*`/g, "/tmp/mktemp")
    .replace(
      /\$env:(\w+)|\$\{(\w+)(?::?[-=+?][^}]*)?\}|\$(\w+)|%(\w+)%/gi,
      (_, a, b, c, d) => {
        const name = a ?? b ?? c ?? d;
        const v =
          name in st.vars
            ? st.vars[name]
            : (KNOWN[name.toUpperCase()] ??
              (name.toUpperCase() === "PWD" ? st.cwd : undefined));
        if (v == null) unknown = true;
        return v ?? "";
      },
    );
  return unknown || /[$`]/.test(t) ? null : t;
}
const where = (text, st) => {
  const t = fill(text, st);
  return t == null ? null : norm(t, st.cwd);
};

const LEAD = new Set([
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "!",
  "{",
  "}",
]);
const PREFIX = new Set([
  "sudo",
  "doas",
  "command",
  "builtin",
  "exec",
  "nohup",
  "time",
  "nice",
  "env",
  "export",
  "local",
  "declare",
  "readonly",
]);
const PS_REMOVE = new Set([
  "remove-item",
  "rm",
  "del",
  "rd",
  "ri",
  "rmdir",
  "erase",
]);
const XARGS_VALUE = new Set(["-I", "-n", "-P", "-d", "-L", "-s", "-E", "-a"]);
const PS_SKIP_VALUE =
  /^(erroraction|ea|warningaction|wa|informationaction|ia|errorvariable|ev|outvariable|ov|credential|stream)$/;

// One verdict per delete: out.deny gets what is refused; named files with no recursion or wildcard pass.
function judge(targets, st, out, { recursive, bulk, verb }) {
  const unsafe = targets.filter((t) => !safe(where(t.text, st)));
  if (targets.length && !unsafe.length) return;
  if (bulk) out.deny.push(bulk);
  else if (!unsafe.length) return;
  else if (recursive) out.deny.push(`${verb} on ${unsafe[0].text}`);
  else if (unsafe.some((t) => t.glob))
    out.deny.push(
      `the wildcard delete ${verb.split(" ")[0]} ${unsafe.find((t) => t.glob).text}`,
    );
}

function rm(args, piped, st, out) {
  let recursive = false,
    ends = false;
  const targets = [];
  for (const a of args) {
    if (!ends && a.text === "--") ends = true;
    else if (!ends && /^-./.test(a.text))
      recursive ||= a.text === "--recursive" || /^-[a-zA-Z]*[rR]/.test(a.text);
    else targets.push(a);
  }
  if (targets.length || piped)
    judge(targets, st, out, {
      recursive,
      bulk: piped && "rm fed by xargs",
      verb: "rm -r",
    });
}

function removeItem(args, st, out) {
  let recursive = false,
    bulk = "",
    whatIf = false;
  const targets = [];
  const push = (text, literal) => {
    for (const p of text.split(","))
      if (p) targets.push({ text: p, glob: !literal && /[*?[]/.test(p) });
  };
  for (let k = 0; k < args.length; k++) {
    const a = args[k].text;
    if (!/^-[a-z]/i.test(a)) {
      push(a, false);
      continue;
    }
    const colon = a.indexOf(":"),
      n = (colon < 0 ? a.slice(1) : a.slice(1, colon)).toLowerCase(),
      val = colon < 0 ? null : a.slice(colon + 1);
    if (/^(path|p|literalpath|lp|pspath)$/.test(n))
      push(val ?? args[++k]?.text ?? "", n.startsWith("l"));
    else if (
      n.length >= 2 &&
      ["filter", "include", "exclude"].some((f) => f.startsWith(n))
    ) {
      bulk = `Remove-Item ${a}`;
      if (val == null) k++;
    } else if (PS_SKIP_VALUE.test(n)) {
      if (val == null) k++;
    } else if (n.length >= 2 && "whatif".startsWith(n)) whatIf = true;
    else if (n.startsWith("r") || (n.length <= 3 && n.includes("r")))
      recursive = true;
  }
  if (whatIf) return;
  if (!targets.length) bulk ||= "Remove-Item fed by a pipe (no path named)";
  judge(targets, st, out, { recursive, bulk, verb: "Remove-Item -Recurse" });
}

function find(args, st, out) {
  let k = 0;
  while (["-H", "-L", "-P"].includes(args[k]?.text)) k++;
  const starts = [];
  for (; k < args.length && !/^[-(!]/.test(args[k].text); k++)
    starts.push(args[k]);
  const rest = args.slice(k).map((a) => a.text);
  const del =
    rest.includes("-delete") ||
    rest.some(
      (t, j) =>
        /^-(exec|execdir|ok|okdir)$/.test(t) &&
        /^(rm|unlink|shred)$/.test(path.basename(rest[j + 1] ?? "")),
    );
  if (!del) return;
  if (!starts.length) starts.push({ text: "." });
  if (!starts.every((s) => safe(where(s.text, st))))
    out.deny.push(`find ${starts.map((s) => s.text).join(" ")} ... -delete`);
}

function git(args, st, out) {
  let dir = st.cwd,
    k = 0;
  for (; k < args.length && args[k].text.startsWith("-"); k++) {
    const t = args[k].text;
    if (t === "-C") dir = where(args[++k]?.text ?? "", { ...st, cwd: dir });
    else if (t === "-c") k++;
    else if (t.startsWith("--work-tree="))
      dir = where(t.slice(12), { ...st, cwd: dir });
  }
  if (args[k]?.text !== "clean") return;
  const rest = args.slice(k + 1).map((a) => a.text),
    flags = rest.filter((t) => t.startsWith("-"));
  if (flags.some((t) => t === "--dry-run" || /^-[a-zA-Z]*n/.test(t))) return;
  if (!flags.some((t) => t === "--force" || /^-[a-zA-Z]*f/.test(t))) return;
  const specs = rest.filter((t) => !t.startsWith("-"));
  const places = specs.length
    ? specs.map((t) => where(t, { ...st, cwd: dir }))
    : [dir];
  if (!places.every(safe)) out.deny.push(`git clean ${flags.join(" ")}`);
}

function one(words, ps, st, out) {
  let w = words,
    piped = false;
  for (;;) {
    const t = w[0]?.text ?? "";
    if (!ps && /^[A-Za-z_]\w*=/.test(t)) {
      const e = t.indexOf("=");
      st.vars[t.slice(0, e)] = fill(t.slice(e + 1), st);
      w = w.slice(1);
    } else if (!ps && LEAD.has(t)) w = w.slice(1);
    else if (PREFIX.has(t)) {
      w = w.slice(1);
      while (w[0]?.text.startsWith("-")) w = w.slice(1);
    } else if (t === "xargs") {
      piped = true;
      w = w.slice(1);
      while (w[0]?.text.startsWith("-"))
        w = w.slice(XARGS_VALUE.has(w[0].text) ? 2 : 1);
    } else break;
  }
  if (!w.length) return;
  const name = path.posix
    .basename(w[0].text.replace(/\\/g, "/"))
    .toLowerCase()
    .replace(/\.exe$/, "");
  const args = w.slice(1);
  if (["cd", "pushd", "chdir", "set-location", "sl"].includes(name)) {
    const to = args.find((a) => !a.text.startsWith("-"));
    st.cwd = to ? where(to.text, st) : norm(HOME, null);
  } else if (["bash", "sh", "zsh", "dash"].includes(name)) {
    const k = args.findIndex((a) => /^-[a-z]*c$/.test(a.text));
    if (k >= 0 && args[k + 1])
      check(args[k + 1].text, false, { ...st, vars: { ...st.vars } }, out);
  } else if (["powershell", "pwsh"].includes(name)) {
    const k = args.findIndex((a) => /^-(c|command)$/i.test(a.text));
    if (k >= 0)
      check(
        args
          .slice(k + 1)
          .map((a) => a.text)
          .join(" "),
        true,
        { ...st, vars: {} },
        out,
      );
  } else if (ps ? PS_REMOVE.has(name) : name === "rm")
    ps ? removeItem(args, st, out) : rm(args, piped, st, out);
  else if (name === "find") find(args, st, out);
  else if (name === "git") git(args, st, out);
}

function check(src, ps, st, out) {
  const { cmds, subs } = lex(src, ps);
  for (const s of subs) check(s, ps, { ...st, vars: { ...st.vars } }, out);
  for (const words of cmds) one(words, ps, st, out);
}

runHook("delete-guard", (event) => {
  if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
  const command = String(event.tool_input?.command ?? "");
  const st = {
    cwd: event.cwd ? norm(String(event.cwd), null) : null,
    vars: {},
  };
  const out = { deny: [] };
  check(command, event.tool_name === "PowerShell", st, out);
  if (out.deny.length) {
    emit.deny(
      refuseText([...new Set(out.deny)].join("; "), Boolean(event.agent_id)),
    );
    return;
  } // emit returns the bytes written, which runHook would take as the exit code
});
