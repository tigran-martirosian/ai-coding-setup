// long-sleep-guard: a PreToolUse hook (Bash|PowerShell) that refuses a long blind sleep. A poll loop must notice
// a dead process or an error in a log soon ("silence is not success"); one long sleep only waits blind.
//   - Main session and helpers, foreground and background: one sleep over 60 s that is not a loop round
//     (`sleep 300`, `sleep 2m`, `Start-Sleep 90`, `Start-Sleep -Seconds 90`, `timeout /t 120`). Sleeps up to 60 s pass.
//   - Helpers (agent_id): a poll loop (until / while / for / do / foreach) whose sleep per round is over 60 s.
//     Rounds up to 60 s pass, and the whole call may run up to its Bash timeout (600000), as worker.md says.
// How it splits the job with background-tasks.mjs: background-tasks measures how long one main-session call can
// hold the session (the whole foreground wait, over 120 s refused) and refuses a main-session background sleep
// that polls nothing; it lets helpers pass. This hook measures each single sleep (over 60 s refused) wherever it
// runs, and the rounds of a helper's loop. A main-session loop is left to background-tasks. So a bare `sleep 300`
// in the main session is refused by both, in the foreground and in the background, with the same way out; a bare
// sleep up to 60 s passes both in the foreground and is refused by background-tasks alone in the background.
// Quoted text, heredoc and here-string bodies are not commands: `echo "sleep 300"` passes. A sleep inside
// `bash -c "..."`, `cmd /c "..."` or `powershell -Command "..."` is read as a command; one inside a script file or
// `python -c` is not seen. Fails open. LONG_SLEEP_GUARD=off disables it; =warn turns a refusal into a note.
import { emit, runHook } from "./lib/hook-io.mjs";

const LIMIT = 60;
const UNIT = { "": 1, s: 1, m: 60, h: 3600, d: 86400 };
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
    if (at > 0 && words.length > at + 1)
      out.push(...commands(words.slice(at + 1).join(" ")));
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

// Seconds one command sleeps, or null when it is no sleep: `sleep 5 1m` (GNU sleep adds them up), `Start-Sleep 5`,
// `Start-Sleep -Seconds 5` / `-s 5` / `-Seconds:5`, `-Milliseconds 500`, `timeout /t 5` (cmd; -1 waits for a key)
function sleepSeconds([name, ...args]) {
  name = name.toLowerCase();
  if (name === "timeout" || name === "timeout.exe") {
    const i = args.findIndex((a) => /^[/-]t$/i.test(a));
    if (i < 0) return null; // GNU timeout runs a command with a time limit: not a sleep
    const n = Number(args[i + 1]);
    return n < 0 ? Infinity : n || 0;
  }
  if (!["sleep", "start-sleep"].includes(name)) return null;
  let total = 0,
    scale = 1;
  for (let arg of args) {
    const named = arg.match(/^-(\w+)(?::(.+))?$/);
    if (named && !/^\d/.test(named[1])) {
      scale = /^m(s|illiseconds?)?$/i.test(named[1]) ? 0.001 : 1;
      if (named[2] === undefined) continue;
      arg = named[2];
    }
    if (/^inf(inity)?$/i.test(arg)) return Infinity; // GNU `sleep infinity` never ends
    const m = String(arg).match(/^(\d+(?:\.\d+)?)([smhd]?)$/i);
    if (m) total += Number(m[1]) * UNIT[m[2].toLowerCase()] * scale;
    scale = 1;
  }
  return total;
}

// The longest single sleep and the longest loop round of a command line
function longest(cmd) {
  let single = 0,
    round = 0,
    loops = 0,
    opener = false;
  for (const words of commands(cmd)) {
    const first = words[0].toLowerCase();
    // bash: `while x; do` opens one loop, `done` closes it; PowerShell: `do { } while ()`, and its loops stay open
    const opens =
      /^(while|until|for|foreach|select|foreach-object|%)$/.test(first) ||
      (first === "do" && words.length === 1 && !opener);
    if (opens) loops++;
    else if (first === "done") loops = Math.max(0, loops - 1);
    opener = opens;
    const s = sleepSeconds(words);
    if (s === null) continue;
    if (loops) round = Math.max(round, s);
    else single = Math.max(single, s);
  }
  return { single, round };
}

const WAY_OUT_MAIN =
  "Waiting for a process, a file or a log line: run a loop of sleeps of 60 s or less that checks it each round and ends on success, when the process is gone, or when its log shows an error, with run_in_background: true; tell the user in one line what you wait for and end your turn: its finish notice wakes you. A wait with nothing to check goes in ScheduleWakeup.";
const WAY_OUT_HELPER =
  "Wait in the foreground with a loop of sleeps of 60 s or less that checks the process and its log each round and ends on success, when the process is gone, or when the log shows an error; the whole call may run up to its Bash timeout (600000 ms).";
const WHY =
  "a long sleep waits blind and can't notice a dead process or an error in a log.";
const secs = (n) => (n === Infinity ? "without end" : `${Math.round(n)} s`);

runHook("long-sleep-guard", (event) => {
  if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
  const { single, round } = longest(
    String((event.tool_input || {}).command ?? ""),
  );
  const helper = Boolean(event.agent_id);
  let text = "";
  if (single > LIMIT)
    text = `[long-sleep-guard] Refused: this sleeps ${secs(single)} in one go, and the limit is ${LIMIT} s per sleep: ${WHY} ${helper ? WAY_OUT_HELPER : WAY_OUT_MAIN}`;
  else if (helper && round > LIMIT)
    text = `[long-sleep-guard] Refused: each round of this loop sleeps ${secs(round)}, and the limit is ${LIMIT} s per round: ${WHY} ${WAY_OUT_HELPER}`;
  if (!text) return;
  if ((process.env.LONG_SLEEP_GUARD || "").toLowerCase() === "warn")
    emit.context(
      "PreToolUse",
      text.replace("Refused:", "Note (not refused, LONG_SLEEP_GUARD=warn):"),
    );
  else emit.deny(text);
});
