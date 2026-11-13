// background-tasks: UserPromptSubmit, PreToolUse and Stop hook. Every wake-up of the main session re-sends the whole
// conversation, so this cuts wake-ups: it lets a settled-notice prompt through with a note, refuses a background launch
// that has nothing running beside it, and sends back a reply that ends while a helper still runs.
// BACKGROUND_TASKS=off disables it, BACKGROUND_TASKS=warn turns refusals into notes. Fails open.
//
// UserPromptSubmit: when every task in a Nimbalyst "[System: background task(s) you launched have settled: ...]" prompt
//   already had its task-notification, it passes with a note (one line while work still runs, else one complete answer
//   to the user's message). One unknown or unnotified task passes with no note. It is not blocked: a blocked prompt
//   shows in Nimbalyst as a warning quoting the whole raw list, and that warning, not a reply, is what the user reads.
//   A turn that follows a task notification answered "No response requested." (Claude Code marks the wake-up
//   "NOT USER INPUT") is sent back on Stop to carry on, because the settled prompt carries the job's next steps.
// PreToolUse (main session only): refuses a background launch, which costs a notification turn plus a settled turn.
//   Agent/Task are background unless `run_in_background: false`, and a background helper is always refused: when the
//   main turn ends while it runs, the app may end the idle process and the helper with it ("Background agent ...
//   didn't finish before the previous session ended", seen mid-build in Nimbalyst). Helpers that run side by side go
//   as several foreground Agent calls in one message: they run in parallel and the turn waits for all of them.
//   Bash/PowerShell count only with `run_in_background: true`. A shell launch passes when
//   - its description has the word `beside` (the caller says another step runs meanwhile; two launches in one message
//     arrive as separate PreToolUse calls, and whether the later tool_use blocks are on disk is not known, so the
//     transcript is not asked),
//   - another background task of the session is still running: a launch result with a task id ("agentId: X",
//     "Command running in background with ID: X", "moved to the background (ID: X)") with no task-notification
//     or TaskStop after it; a server or watcher doesn't count, it never ends,
//   - or it is a Bash/PowerShell server or watcher (SERVER below), which is what background is for.
//   Subagents (agent_id) pass: worker.md lets workers start a long build in the background and wait for it
//   in a foreground polling loop (a worker that ends its turn to wait is never woken).
//   A foreground Bash/PowerShell wait in the main session (WAIT: a CI watch, a poll loop, a sleep) that can run over
//   2 minutes is refused: notes and typed messages only land between tool calls (2026-11-11: three 10-minute
//   `gh run watch` calls kept a note out for 9 min and the user had to stop the session). A background wait passes,
//   and so does a build or test command whose poll sleeps at most 5 s (wait for a local server, then run the tests).
// Stop (main session, blocks once), first: in a turn the user did not start (a settled notice, a task's notice, Stop
//   hook feedback), a tool call that came back "The user doesn't want to take this action" and was not sent again.
//   The user refused nothing: the app denies the first call of a turn it starts itself (about 140 in 4 days, nearly
//   all the turn's first call; the same call sent again runs). Obeying its "STOP" left the session idle for minutes.
// Stop (main session, blocks once): a reply that says a helper still runs or that it waits for one, while no background
//   task of the session is live (servers count as live here), is sent back to check ListAgents. Since the last typed
//   prompt, a scheduled wake-up, a Monitor or cron, or a message to another session lets it pass: this transcript
//   doesn't track those.
// How a settled item maps to its notification: an item is `- "<text>" <status>\n  Summary: ...`, where <text> is the
// Agent `description`, or the Bash `description` when the call has one, else its `command`. The notification carries
// `<task-id>` and only sometimes `<tool-use-id>` (a resumed agent's notice has none), so the key is the task id: text ->
// the latest main-chain Bash/Agent call with that text -> the task id in its tool result -> a task-notification with that
// id after the launch or after a SendMessage that resumed the agent. The notification is a turn of its own (origin
// task-notification) or, when it lands mid-turn, a queued_command attachment. Nimbalyst also lists every Bash call a
// background agent made (foreground ones too); such an item is found in <session>/subagents/agent-<id>.jsonl and counts
// as handled once that agent's own notification came. A "<task-notification>" without a task id (Stop hook feedback)
// is not a task's.
import { runHook, emit } from "./lib/hook-io.mjs";
import {
  agentLaunches,
  currentTurn,
  entries,
  userText,
} from "./lib/transcript.mjs";
import { SETTLED_NOTE, STAND_IN_RE } from "./lib/texts.mjs";
import fs from "node:fs";
import path from "node:path";

const SETTLED = /^\[System: background task\(s\)[^\n]*settled/;
const ITEM_END = /" [a-z][a-z ()0-9-]{0,30}\n  Summary:/g;
// A whole item header on one line with no Summary line under it: this parser can't check that item
const BARE_ITEM = /^- "[^\n]*" [a-z][a-z ()0-9-]{0,30}$(?!\n  Summary:)/m;
// A command that doesn't end by itself: dev server, game server, watcher, follow-mode log read, endless loop
const SERVER =
  /\b(runServer|runClient|nodemon|http-server|live-server|webpack-dev-server|http\.server|uvicorn|gunicorn)\b|\bflask\s+run\b|\bmanage\.py\s+runserver\b|\bnode\s[^|;&\n]*server|\bnpx\s+(serve|vite)\b|\bserve\s+-s\b|\bdocker[ -]compose\s+up\b(?![^|;&\n]*\s-\w*d)|\b(npm|pnpm|yarn)\s+run\s+preview\b|\bstreamlit\s+run\b|\brails\s+(s|server)\b|--watch\b|\btsc\b[^|;&\n]*\s-w\b|-Wait\b|\btail\b[^|;&\n]*\s-\w*[fF]\b|(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b|(^|[\s;&|(])(vite|next|nuxt|astro)(\s+dev)?\s*$|(^|[\s;&|(])watch\s|\bwhile\s+(true|:)/im;
const BESIDE = /\bbeside\b/i;
// A command that waits for something outside this session: a CI watch, a poll loop, a sleep
const WAIT =
  /\bgh\s+run\s+watch\b|\bgh\s+pr\s+checks\b[^|;&\n]*--watch\b|(^|[\s;&|(])(sleep|Start-Sleep)\s+(-Seconds\s+)?\d|\b(until|while|for)\b[^\n]*\bsleep\b/i;
// A wait that polls or watches, not one fixed sleep
const LOOP_OR_WATCH = /\b(until|while|for)\b|\bwatch\b/;
// A build or test command: a short poll inside one (wait for a local server, then test) is part of the work
const WORK_CMD =
  /(^|[\s;&|(])((npm|pnpm|yarn|bun)\s+(run\s+\S|test\b|build\b)|pytest\b|cargo\s+(build|test)\b|gradlew?\b|make\b|mvn\b|dotnet\s+(build|test)\b|go\s+(build|test)\b)/;
const CI_WATCH = /\bgh\s+(run\s+watch|pr\s+checks)\b/;
// Each sleep's length in seconds: `sleep 5`, `sleep 5m`, `Start-Sleep -Seconds 5`
const UNIT = { "": 1, s: 1, m: 60, h: 3600, d: 86400 };
const sleeps = (cmd) =>
  [
    ...cmd.matchAll(
      /\b(?:sleep|Start-Sleep(?:\s+-Seconds)?)\s+(\d+(?:\.\d+)?)([smhd]?)\b/gi,
    ),
  ].map((m) => Number(m[1]) * UNIT[m[2].toLowerCase()]);
// A wait for something outside this session; a build or test command whose poll sleeps at most 5 s is not one
const outsideWait = (cmd) =>
  WAIT.test(cmd) &&
  !(
    WORK_CMD.test(cmd) &&
    !CI_WATCH.test(cmd) &&
    sleeps(cmd).every((s) => s <= 5)
  );
// The longest a foreground wait may hold the main session: notes and typed messages land only between tool calls
const WAIT_MAX = 120000;
const LONG_WAIT = (min) =>
  `[background-tasks] Refused: this holds the main session up to ${min} min waiting for something outside it, and while one tool call runs nothing reaches you: not the user's notes, not a message typed in the app (that one queues until your whole turn ends). Send the same command with run_in_background: true, tell the user in one line what you wait for, and end your turn: its finish notice wakes you, and the user can reach you meanwhile. A wait with nothing to poll ("check again in an hour") goes in ScheduleWakeup. A foreground wait up to 2 minutes is fine.`;
const OUTSIDE_WAIT =
  " A wait for something outside this session (a CI run, a deploy, another session) is the exception: send it in the background as a loop that checks it each round (until/while with a sleep of 60 s or less), or put a wait with nothing to check in ScheduleWakeup; then end your turn, so the user can reach you while it runs.";
const NUDGE =
  "[background-tasks] Background costs two extra full-context turns (the notification and the settled notice) plus every check-in read, and a background helper can die when this turn ends. Run it in the foreground (several helpers side by side: several calls in one message) (Bash: `timeout` up to 600000 ms; Agent: no `run_in_background`) and read the result once." +
  OUTSIDE_WAIT +
  " When its notification comes while other work for the same ask still runs, write no reply for it: carry on, and answer once, completely, when everything has finished (a server or watcher that never ends doesn't count) (a string of small updates doesn't read like an answer). A wait loop on a background command ends on success, and also when the process is gone or its log shows an error: silence is not success.";
const REFUSE_AGENT =
  '[background-tasks] Refused: this helper would run in the background (the default unless run_in_background is false). A background helper dies when this turn ends and the app stops the idle session ("didn\'t finish before the previous session ended"), and its finish re-sends the whole conversation twice. Re-send the same call with run_in_background: false. Helpers that should run side by side go as several Agent calls in one message, each with run_in_background: false: they run in parallel and this turn waits for all of them.';
const DENIED = "The user doesn't want to take this action";
const RETRY_DENIED =
  "[background-tasks] A tool call in this turn came back \"The user doesn't want to take this action\", but the user did not start this turn and refused nothing: the app denies the first call of a turn it starts itself (a settled notice, a task's notice, hook feedback). Send that call again now and carry on with the work it was part of; this new turn's first call may be denied the same way, so when it is, send it once more (the second try runs). Report the work as if that first call had run.";
const DENIED_AHEAD =
  "[background-tasks] The app started this turn, not the user. If this turn's first tool call comes back \"The user doesn't want to take this action\", the user refused nothing: send the same call again (it runs the second time) and carry on.";
const REFUSE_SHELL =
  "[background-tasks] Refused: nothing else of this session runs meanwhile, so this background command only wakes the main session again when it ends, re-sending the whole conversation twice (notification and settled notice). Run it in the foreground with `timeout` up to 600000 (10 minutes) and read its output once." +
  OUTSIDE_WAIT +
  " If it is a server or watcher that never ends, re-send it with `beside` in its description. Background is also for when another step runs meanwhile: then put the word `beside` in the description. A wait loop on a background command ends on success, and also when the process is gone or its log shows an error: silence is not success.";

const DUPLICATE =
  SETTLED_NOTE +
  " results you already had in their task-notifications, and the user sees it as a raw list. Don't re-read or redo anything: no status snippet (a string of small updates doesn't read like an answer). If work for the user's last message still runs (ListAgents shows it running), reply with one line naming what still runs. When it is all finished, reply with one complete answer to that whole message, readable alone: every ask and its outcome, what was checked, what is left, any decision last. Never answer it with \"No response requested\".";

// A reply that says a helper of this session runs now or will report back. Only claims count: a sentence that
// starts with the helper doing something now, a first-person wait or promise, a "will notify" line. A
// description ("the hook blocks when the task is finished", "reload once the build is done") does not match.
const NOUN = String.raw`the (?:planner|agent|helper|worker|reviewer|subagent|build|job|task|command|tests?|run|search|script|scan|research)`;
const HELPER = String.raw`(?:it|they|${NOUN})`;
const START = String.raw`(?:^|[.!:;]\s+|\n\s*(?:[-*]\s+)?)`;
const DONE = String.raw`(?:once|when|after) ${HELPER}(?:'s| is| are| has)? (?:done|finished|finish|finishes|returns|reports|completes|comes back|ready)\b`;
const WAITING = new RegExp(
  [
    String.raw`${START}${HELPER}(?:'s|'re| is| are)(?: still| now)* (?:running|working|busy|adding|writing|building|checking|reviewing|searching|reading|finishing|processing|planning)\b(?![^.!\n]*\?)`,
    String.raw`${START}(?:I'm |I am |I'll be |still )?(?:waiting|standing by) (?:for|on) (?:it|them|its|their|${NOUN})`,
    String.raw`\bI(?:'ll| will)\b[^.!?\n]{0,100}${DONE}`,
    String.raw`\b${HELPER}(?: will|'ll) (?:notify|report back|let me know|come back|ping)\b`,
    String.raw`\b(?:was|is being|has been) resumed\b[^.!?\n]{0,60}\bwill notify\b`,
  ].join("|"),
  "i",
);
// Tools whose wait this transcript doesn't track
const OTHER_WAIT =
  /^(ScheduleWakeup|Monitor|CronCreate|RemoteTrigger|mcp__nimbalyst-host__(schedule_wakeup|spawn_session|send_prompt|create_session))$/;
const WAITING_ON_NOTHING =
  '[background-tasks] Your reply says a helper still runs or that you wait for it, but no helper or background command of this session is live: each one has sent its finish notice (a notice\'s "is being resumed" / "will notify again" starts nothing, and a helper whose notice says it still waits on its own background work has stopped). Call ListAgents now. If it shows the helper running, or the wait is for the user or another session, or the reply only describes how something works: end the turn as it is. If nothing runs: do the waited-for work in this turn (SendMessage the finished helper with what is left, which resumes it, or do it yourself), or, when nothing is left, reply plainly that nothing runs and what is done.';

// A reply with nothing in it for the user
const SILENT = /^(No response requested\.?)?$/i;
const SILENT_TO_NOTICE =
  "[background-tasks] This turn began with a finished task's notice (or the settled notice) and nothing else of this session still runs, so \"No response requested.\" leaves the user with only the raw notice and stops the job that waited on it. Carry on with the work that was waiting on that result in this turn; when nothing is left, reply with one complete answer to the user's last message: every ask and its outcome, what was checked, what is left. A helper whose notice says it is still waiting on its own background work has stopped: SendMessage it once to finish.";

// What started the current turn: "settled" (Nimbalyst's settled notice), "finished" (a task's own
// task-notification, which has a task id), or null (a typed prompt, Stop hook feedback, anything else)
function noticeTurn(file) {
  const { opener } = currentTurn(entries(fs.readFileSync(file, "utf8")));
  const t = opener ? userText(opener).trimStart() : "";
  return SETTLED.test(t)
    ? "settled"
    : /<task-notification>[\s\S]*<task-id>[^<\s]+<\/task-id>/.test(t)
      ? "finished"
      : null;
}

// Whether this turn was started by something other than the user and holds a denied call that was not sent again
function unretriedDenial(file) {
  const {
    start,
    opener,
    entries: turn,
  } = currentTurn(entries(fs.readFileSync(file, "utf8")));
  if (start || !opener) return false;
  const calls = new Map(); // tool_use id -> name + input
  const order = []; // { sig, denied } in turn order
  for (const e of turn) {
    const c = e.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (e.type === "assistant" && b.type === "tool_use")
        calls.set(b.id, b.name + JSON.stringify(b.input));
      if (
        e.type === "user" &&
        b.type === "tool_result" &&
        calls.has(b.tool_use_id)
      ) {
        const t =
          typeof b.content === "string"
            ? b.content
            : texts(b.content).join("\n");
        order.push({
          sig: calls.get(b.tool_use_id),
          denied: b.is_error === true && t.trimStart().startsWith(DENIED),
        });
      }
    }
  }
  return order.some(
    (o, i) =>
      o.denied && !order.slice(i + 1).some((p) => p.sig === o.sig && !p.denied),
  );
}

// Tool calls since the last prompt the user typed (a task notice or a settled notice starts no new wait)
function turnTools(file) {
  const names = [];
  for (const e of currentTurn(entries(fs.readFileSync(file, "utf8")), {
    typed: true,
  }).entries) {
    if (e.type === "assistant" && Array.isArray(e.message?.content))
      for (const b of e.message.content)
        if (b.type === "tool_use") names.push(b.name);
  }
  return names;
}

const texts = (c) =>
  typeof c === "string"
    ? [c]
    : Array.isArray(c)
      ? c.filter((b) => b.type === "text").map((b) => b.text || "")
      : [];
const key = (text) => text.replace(STAND_IN_RE, "").trimEnd();

// What the main chain of the transcript says about background tasks
function readMain(file) {
  const launches = new Map(); // key of a command or description -> tool_use ids, oldest first
  const taskOf = new Map(); // tool_use id -> task id
  const servers = new Set(); // tool_use ids of Bash/PowerShell calls that look like a server or watcher
  const startedAt = new Map(); // task id -> line of its launch result or of a SendMessage that resumed it
  const notified = new Map(); // task id -> lines of its task-notifications (or of a TaskStop that ended it)
  const named = new Map(); // Agent `name` -> tool_use id, so a SendMessage to the name resumes its task
  const later = (map, k, line) => map.set(k, Math.max(map.get(k) ?? -1, line));
  const note = (task, line) => {
    if (!notified.has(task)) notified.set(task, []);
    notified.get(task).push(line);
  };
  // line: an entry's place in the main chain, so a later entry has a higher number
  const list = entries(fs.readFileSync(file, "utf8"));
  // launches first, so a SendMessage to an agent's name below finds its task id
  for (const l of agentLaunches(list)) {
    taskOf.set(l.toolUseId, l.task);
    later(startedAt, l.task, l.index);
  }
  list.forEach((e, line) => {
    const c = e.message?.content;
    if (e.type === "assistant") {
      for (const b of Array.isArray(c) ? c : []) {
        if (b.type !== "tool_use" || !b.input) continue;
        if (b.name === "SendMessage" && b.input.to)
          later(
            startedAt,
            taskOf.get(named.get(b.input.to)) ?? b.input.to,
            line,
          );
        if (
          ["Agent", "Task"].includes(b.name) &&
          typeof b.input.name === "string"
        )
          named.set(b.input.name, b.id);
        if (b.name === "TaskStop" && b.input.task_id)
          note(b.input.task_id, line);
        if (!["Bash", "PowerShell", "Agent", "Task"].includes(b.name)) continue;
        if (typeof b.input.command === "string" && SERVER.test(b.input.command))
          servers.add(b.id);
        // Nimbalyst quotes a Bash call's description when it has one, else its command
        for (const t of [b.input.command, b.input.description]) {
          if (typeof t !== "string" || !t.trim()) continue;
          if (!launches.has(key(t))) launches.set(key(t), []);
          launches.get(key(t)).push(b.id);
        }
      }
      return;
    }
    // A notification comes as its own turn, or as a queued_command attachment when it lands mid-turn
    const notices =
      e.type === "user"
        ? texts(c)
        : e.type === "attachment" && e.attachment?.type === "queued_command"
          ? texts(e.attachment.prompt)
          : [];
    for (const t of notices) {
      if (!t.trimStart().startsWith("<task-notification>")) continue;
      const task = t.match(/<task-id>([^<\s]+)<\/task-id>/)?.[1];
      if (task) note(task, line);
    }
  });
  return { launches, taskOf, servers, startedAt, notified };
}

// Whether a task had a task-notification after its launch or last resume
const handledIn = (main) => (task) => {
  const start = main.startedAt.get(task);
  return (
    start !== undefined &&
    (main.notified.get(task) || []).some((l) => l > start)
  );
};

// Whether another background task of the session still runs (a server or watcher doesn't count)
function othersRunning(transcript) {
  const main = readMain(transcript);
  const handled = handledIn(main);
  return [...main.taskOf].some(
    ([use, task]) => !main.servers.has(use) && !handled(task),
  );
}

// Task ids of this session's agents whose own transcript holds a call with this text (a prefix match, so a
// command quoted with the stand-in note still matches; more owners only make the check stricter)
function ownersInSubagents(dir, text, cache) {
  if (!cache.files)
    cache.files = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => /^agent-\w+\.jsonl$/.test(f))
          .map((f) => ({
            id: f.slice(6, -6),
            raw: fs.readFileSync(path.join(dir, f), "utf8"),
          }))
      : [];
  const q = JSON.stringify(key(text)).slice(0, -1);
  return cache.files
    .filter(
      (f) =>
        f.raw.includes(`"command":${q}`) ||
        f.raw.includes(`"description":${q}`),
    )
    .map((f) => f.id);
}

// Whether every task in the settled prompt already had a task-notification after its launch
function allNotified(prompt, transcript, sessionId) {
  const main = readMain(transcript);
  const subDir = path.join(
    path.dirname(transcript),
    String(sessionId || path.basename(transcript, ".jsonl")),
    "subagents",
  );
  const cache = {};
  const handled = handledIn(main);
  const ends = [...prompt.matchAll(ITEM_END)].map((m) => m.index);
  if (!ends.length) return false;
  // An item this parser does not see (no Summary line) must not be blocked along with the rest
  if (BARE_ITEM.test(prompt)) return false;
  let prevEnd = 0;
  for (const end of ends) {
    // The item's text starts after a `- "` at a line start: try the nearest first, back to the last item
    let found = false;
    for (
      let s = prompt.lastIndexOf('\n- "', end);
      s >= prevEnd && !found;
      s = s > 0 ? prompt.lastIndexOf('\n- "', s - 1) : -1
    ) {
      const text = prompt.slice(s + 4, end);
      const own = main.launches.get(key(text));
      let tasks;
      if (own) {
        const task = main.taskOf.get(own[own.length - 1]);
        if (!task) return false;
        tasks = [task];
      } else tasks = ownersInSubagents(subDir, text, cache);
      if (!tasks.length) continue;
      if (!tasks.every(handled)) return false;
      found = true;
    }
    if (!found) return false;
    prevEnd = end;
  }
  return true;
}

// The longest this foreground call can wait: its timeout (default 2 min), a `timeout N` prefix, or, with no loop
// or watch in it, the sum of its sleeps
function waitMs(input) {
  const cmd = String(input.command ?? "");
  let ms = Number(input.timeout) || 120000;
  const t = cmd.match(/(^|[\s;&|(])timeout\s+(\d+)\b/);
  if (t) ms = Math.min(ms, Number(t[2]) * 1000);
  if (!LOOP_OR_WATCH.test(cmd))
    ms = Math.min(
      ms,
      sleeps(cmd).reduce((a, s) => a + s * 1000, 0),
    );
  return ms;
}

runHook("background-tasks", (event) => {
  const mode = (process.env.BACKGROUND_TASKS || "").toLowerCase();
  if (event.hook_event_name === "PreToolUse") {
    const input = event.tool_input || {};
    const agentCall = ["Agent", "Task"].includes(event.tool_name);
    const shellCall = ["Bash", "PowerShell"].includes(event.tool_name);
    const background = agentCall
      ? input.run_in_background !== false
      : shellCall && input.run_in_background === true;
    // A helper waits in a foreground polling loop by design (worker.md): only the main session is held to WAIT_MAX
    if (
      shellCall &&
      !background &&
      !event.agent_id &&
      outsideWait(String(input.command ?? "")) &&
      waitMs(input) > WAIT_MAX
    ) {
      const text = LONG_WAIT(Math.round(waitMs(input) / 60000));
      if (mode === "warn") emit.context("PreToolUse", text);
      else emit.deny(text);
      return;
    }
    if (!background || event.agent_id) return;
    // The desktop app and VS Code always run the main conversation's helpers in the background (Claude Code
    // 2.1.302), so a refusal there could never be met: a note only.
    const alwaysBackground =
      agentCall &&
      /^claude-(desktop|vscode)/.test(process.env.CLAUDE_CODE_ENTRYPOINT || "");
    if (agentCall) {
      // map-nudge's map builder is a side job that must not hold up the user's request; if it dies with the turn,
      // the next session's nudge starts it again
      if (/^Systems map:/.test(String(input.description ?? ""))) return;
      if (mode === "warn" || alwaysBackground)
        emit.context("PreToolUse", NUDGE);
      else emit.deny(REFUSE_AGENT);
      return;
    }
    if (BESIDE.test(String(input.description ?? ""))) return;
    // A background wait that polls or watches is what the long-wait refusal above asks for; a bare sleep is not
    // (a wait with nothing to poll goes in ScheduleWakeup)
    const cmd = String(input.command ?? "");
    if (
      shellCall &&
      (SERVER.test(cmd) || (WAIT.test(cmd) && LOOP_OR_WATCH.test(cmd)))
    )
      return;
    if (
      event.transcript_path &&
      fs.existsSync(event.transcript_path) &&
      othersRunning(event.transcript_path)
    )
      return;
    if (mode === "warn") emit.context("PreToolUse", NUDGE);
    else emit.deny(REFUSE_SHELL);
    return;
  }
  if (event.agent_id) return;
  if (event.hook_event_name === "Stop") {
    if (
      event.stop_hook_active ||
      !event.transcript_path ||
      !fs.existsSync(event.transcript_path)
    )
      return;
    if (unretriedDenial(event.transcript_path)) {
      emit.block(RETRY_DENIED);
      return;
    }
    if (SILENT.test(String(event.last_assistant_message ?? "").trim())) {
      const notice = noticeTurn(event.transcript_path);
      if (
        notice === "settled" ||
        (notice === "finished" && !othersRunning(event.transcript_path))
      ) {
        emit.block(SILENT_TO_NOTICE);
      }
      return;
    }
    if (
      !WAITING.test(
        String(event.last_assistant_message ?? "").replace(/[‘’]/g, "'"),
      )
    )
      return;
    if (turnTools(event.transcript_path).some((n) => OTHER_WAIT.test(n)))
      return;
    // A dev server left up earlier is not the helper the reply waits on
    if (othersRunning(event.transcript_path)) return;
    emit.block(WAITING_ON_NOTHING);
    return;
  }
  const prompt = String(event.prompt ?? "");
  if (!SETTLED.test(prompt)) return;
  if (!event.transcript_path || !fs.existsSync(event.transcript_path)) return;
  emit.context(
    "UserPromptSubmit",
    allNotified(prompt, event.transcript_path, event.session_id)
      ? DUPLICATE + "\n" + DENIED_AHEAD
      : DENIED_AHEAD,
  );
});
