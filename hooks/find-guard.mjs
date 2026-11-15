// find-guard: a PreToolUse hook (Bash|PowerShell) that refuses a search through a whole drive or the whole home
// folder: `find /`, `find /c`, `find C:/`, `find ~`, `grep -r` / `rg` from a drive root or home, `Get-ChildItem C:\
// -Recurse`, `dir /s C:\`, `where /r C:\`, `ls -R ~`. Such a walk runs for minutes (node_modules, AppData caches, Git
// objects), and its output floods the conversation. The message says to search the project folder or name the folder.
// The limit: a drive root or the home folder may be searched to a depth of 3 or less (find -maxdepth 3, rg
// --max-depth 3, Get-ChildItem -Depth 3). Depth 3 still reaches ~/Projects/<name>/<file> and ~/.claude/skills/<name>,
// a few thousand entries read in seconds; depth 4 and more is where the caches and dependency folders start.
// `grep -r`, `dir /s`, `where /r` and `ls -R` have no depth option, so from a root or home they are always refused.
// A folder below home (~/Projects, C:/Users/<name>/AppData) is named, so it passes.
// Quoted text, heredoc and here-string bodies are not commands: `echo "find /"` passes. A search inside
// `bash -c "..."`, `cmd /c "..."` or `powershell -Command "..."` is read as a command. Fails open. FIND_GUARD=off
// disables it.
import { emit, runHook } from "./lib/hook-io.mjs";

const MAX_DEPTH = 3;
// Words in front of the command itself
const LEAD = /^(do|then|else|elif|!|time|nohup|sudo|command|exec|env)$/i;
// `cmd //c` is how Git Bash passes /c
const SHELL_C = {
  cmd: /^\/\/?[ck]$/i,
  "cmd.exe": /^\/\/?[ck]$/i,
  bash: /^-c$/,
  sh: /^-c$/,
  powershell: /^-c(ommand)?$/i,
  "powershell.exe": /^-c(ommand)?$/i,
  pwsh: /^-c(ommand)?$/i,
};
// A drive root: /, \, /c, /c/, /mnt/c, C:, C:/, C:\ (also C:\\, /* and C:/*). A bare * is the current folder's files.
const ROOT = /^(([A-Za-z]:|\/[A-Za-z]|\/mnt\/[A-Za-z])[\\/]*|[\\/]+)\*?$/;
// The home folder, or the folder of all users: ~, $HOME, ${HOME}, $env:USERPROFILE, %USERPROFILE%, C:/Users/<name>, /home/<name>
const HOME =
  /^(~|\$HOME|\$\{HOME\}|\$env:(USERPROFILE|HOME)|%USERPROFILE%|\$USERPROFILE|([A-Za-z]:|\/[A-Za-z]|\/mnt\/[A-Za-z])?[\\/]+Users([\\/]+[^\\/*]+)?|\/home([\\/]+[^\\/*]+)?)[\\/]*\*?$/i;
const wide = (p) => p !== "" && (ROOT.test(p) || HOME.test(p));
// dir /s, where /r and Get-ChildItem take a file name at the end of the folder (C:\nimbalyst.exe, ~/*.log): that
// folder is searched
const wideOrIn = (p) =>
  wide(p) || (/[*?.][^\\/]*$/.test(p) && wide(p.replace(/[^\\/]*$/, "")));

// The command's simple commands as word lists. Quoted text stays inside one word, heredoc and here-string bodies
// are dropped, and ; & | newline ( ) { } end a command (`${HOME}` stays one word).
function commands(cmd) {
  const text = cmd
    .replace(
      /<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g,
      " $3",
    )
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "''");
  const out = [];
  let words = [],
    word = null,
    quote = null,
    brace = false;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCmd = () => {
    endWord();
    while (words.length > 1 && (LEAD.test(words[0]) || /^\w+=/.test(words[0])))
      words.shift();
    const inner = SHELL_C[(words[0] ?? "").toLowerCase()];
    const at = inner ? words.findIndex((w, i) => i > 0 && inner.test(w)) : -1; // after -NoProfile and the like
    // what powershell -Command runs is read as PowerShell (its dir and ls are Get-ChildItem), what cmd /c and bash -c
    // run is not
    const ps = /^(powershell|pwsh)/i.test(words[0] ?? "");
    if (at > 0 && words.length > at + 1)
      out.push(
        ...commands(words.slice(at + 1).join(" ")).map((w) =>
          Object.assign(w, { ps: w.ps ?? ps }),
        ),
      );
    else if (words.length) out.push(words);
    words = [];
  };
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
      continue;
    }
    if (brace) {
      word += c;
      if (c === "}") brace = false;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
      continue;
    }
    if (c === "{" && word?.endsWith("$")) {
      word += c;
      brace = true;
      continue;
    }
    if (c === "\n") {
      endCmd();
      continue;
    }
    if (/\s/.test(c)) {
      endWord();
      continue;
    }
    if (";&|(){}".includes(c)) {
      endCmd();
      continue;
    }
    word = (word ?? "") + c;
  }
  endCmd();
  return out;
}

// The value of a depth option (`-maxdepth 3`, `--max-depth=3`, `-Depth 3`), or Infinity without one
function depth(args, names) {
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^(-{1,2}[\w-]+)(?:[=:](\d+))?$/);
    if (m && names.test(m[1])) return Number(m[2] ?? args[i + 1]);
  }
  return Infinity;
}

// The folder one command searches through all the way down, when that is a drive root or home; else null
function wideSearch([name, ...args], powershell) {
  name = name.toLowerCase().replace(/\.exe$/, "");
  const hit = (paths) => paths.find(wide) ?? null;
  const hitIn = (paths) => paths.find(wideOrIn) ?? null;
  // find.exe in PowerShell or cmd searches text in files, not folders
  if (name === "find" && !powershell) {
    // the folders come after -H / -L / -P and before the first test (-name, !, ...)
    const rest = args.slice(args.findIndex((a) => !/^-[HLP]$/.test(a)) >>> 0);
    const first = rest.findIndex((a) => /^[-(!]/.test(a));
    return depth(args, /^-maxdepth$/) <= MAX_DEPTH
      ? null
      : hit(first < 0 ? rest : rest.slice(0, first));
  }
  if (["grep", "egrep", "fgrep", "rg"].includes(name)) {
    const recursive =
      name === "rg" ||
      args.some(
        (a) =>
          /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(a) ||
          /^--(recursive|dereference-recursive)$/.test(a),
      );
    if (
      !recursive ||
      (name === "rg" &&
        depth(args, /^(-d|--max-depth|--maxdepth)$/) <= MAX_DEPTH)
    )
      return null;
    // the first word that is no option is the pattern, unless -e / -f / --files gives it
    const positional = [];
    let given = false;
    for (let i = 0; i < args.length; i++) {
      if (/^(-e|-f|--regexp|--file)$/.test(args[i])) {
        given = true;
        i++;
        continue;
      }
      if (/^(--regexp|--file)=/.test(args[i]) || args[i] === "--files") {
        given = true;
        continue;
      }
      if (!args[i].startsWith("-")) positional.push(args[i]);
    }
    return hit(given ? positional : positional.slice(1));
  }
  if (powershell && ["get-childitem", "gci", "ls", "dir"].includes(name)) {
    const d = depth(args, /^-depth$/i);
    if (
      d <= MAX_DEPTH ||
      (d === Infinity &&
        !args.some((a) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(a)))
    )
      return null;
    return hitIn(
      args.filter(
        (a, i) =>
          !a.startsWith("-") &&
          !/^-(depth|filter|include|exclude|name)$/i.test(args[i - 1] ?? ""),
      ),
    );
  }
  if (
    ["dir", "where"].includes(name) &&
    args.some((a) => /^\/{1,2}[sr]$/i.test(a))
  )
    return hitIn(args.filter((a) => !/^\/{1,2}[a-z]$/i.test(a)));
  if (
    name === "ls" &&
    args.some((a) => /^-[a-zA-Z]*R[a-zA-Z]*$|^--recursive$/.test(a))
  )
    return hit(args.filter((a) => !a.startsWith("-")));
  return null;
}

runHook("find-guard", (event) => {
  if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
  const powershell = event.tool_name === "PowerShell";
  for (const words of commands(
    String((event.tool_input || {}).command ?? ""),
  )) {
    const folder = wideSearch(words, words.ps ?? powershell);
    if (folder === null) continue;
    emit.deny(
      `[find-guard] Refused: \`${words[0]}\` here searches all of ${folder}, every folder below a drive root or the home folder. That runs for minutes and floods the conversation. Search the project folder, or name the folder that holds what you look for (~/.claude, ~/Projects/<name>, C:/Program Files/<program>). To see what is near the top, limit the depth to ${MAX_DEPTH} or less (find -maxdepth ${MAX_DEPTH}, rg --max-depth ${MAX_DEPTH}, Get-ChildItem -Depth ${MAX_DEPTH}). A program's install folder: ask \`where\` / \`which\` / \`Get-Command\` first.`,
    );
    return;
  }
});
