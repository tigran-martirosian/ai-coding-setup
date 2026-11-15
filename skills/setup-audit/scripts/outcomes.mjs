#!/usr/bin/env node
// outcomes: what the setup's checks led to, counted from this computer's chat transcripts
// (~/.claude/projects/*/*.jsonl, and each chat's subagents/ folder). Prints markdown. It counts and prints; it draws no conclusions.
// Every figure carries its sample size; fewer than 10 is printed as "too few to judge" and gets no percentage.
//
//   rec-check  forms with a recommended option, before rec-check first ran and after; how often the recommended option was taken;
//              how often rec-check said change, and what was chosen then
//   reviews    reviewer helpers and code-review runs, and whether a code change came after
//   verify     the verify gate's blocks, and whether a passing build or test followed in the same turn
//   map        helpers briefed with Systems map lines against helpers without: edits outside the brief, stopped helpers
//
// Options:
//   --days N          events from the last N days (default 14)
//   --project TEXT    only project folders whose name contains TEXT (case-insensitive)
//   --rec-start ISO   count forms from this time as "after rec-check began" (default: the first rec-check call found)
//   --root DIR        transcripts folder (default ~/.claude/projects)
import fs from "node:fs";
import path from "node:path";
import { isBuildCode as isCode } from "../../../hooks/lib/code-files.mjs";
import {
  REPORT_FOLLOWS,
  STOP_HOOK_FEEDBACK,
  VERIFY_GATE,
} from "../../../hooks/lib/texts.mjs";
import {
  AGENT,
  CAPPED,
  defaultRoot,
  EDIT,
  editedFile,
  QUESTION_TOOL as FORM,
  SHELL,
  subagentMetas,
  TOO_FEW,
  textOf,
  walkChats,
} from "./lib/chats.mjs";
import { daysWindow } from "./lib/days.mjs";
import { opt } from "./lib/opt.mjs";

const root = opt("root", defaultRoot());
const project = (opt("project", "") ?? "").toLowerCase();
const { days, since } = daysWindow();

const BUILD =
  /^(?:\S+=\S*\s+)*(?:(?:bash|sh|call|cmd\s+\/c)\s+)?(?:\S*[\\/])?(?:gradlew(?:\.bat)?|mvnw?|qbuild(?:\.\w+)?|run[_-]all\.\w+|run-tests?\.\w+|make|pytest|tox|tsc|vitest|jest|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build)\b|npx\s+(?:tsc|vitest|jest|playwright)\b|cargo\s+(?:build|test|check|clippy)\b|go\s+(?:build|test|vet)\b|dotnet\s+(?:build|test)\b|cmake\s+--build\b|(?:python3?|py)\s+(?:-3\s+)?-m\s+(?:pytest|unittest)\b|node\s+(?:--test\b|(?:\S*[\\/])?(?:test-[\w.-]*|[\w.-]*-tests?|run-tests?[\w.-]*|run-all)\.[cm]?js\b))(?:\s|$)/i;
const isBuild = (cmd) =>
  String(cmd ?? "")
    .split(/&&|\|\||;|\||\r?\n/)
    .some((s) => BUILD.test(s.trim()));

const MAP_MARK = "SYSTEMS MAP:";
const MAP_TYPES = new Set([
  "worker",
  "worker-full",
  "worker-code",
  "worker-refactor",
  "reviewer",
  "planner",
  "plan-reviewer",
]);
const INJECTED =
  /^(<(?!command-)[a-z-]+[ >]|\[(Request interrupted|System:|SYSTEM NOTIFICATION|Child Session))/;

const recommended = (o) =>
  o &&
  (/\(recommended\)/i.test(`${o.label ?? ""} ${o.title ?? ""}`) ||
    /^recommended$/i.test(String(o.badge ?? "").trim()));
const parse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

// One chat file -> its tool calls, their results, the messages typed by the user and the stop-hook feedback, in file order.
function readChat(file) {
  const c = {
    file,
    uses: new Map(),
    results: new Map(),
    notes: new Map(),
    typed: [],
    stops: [],
    seq: 0,
  };
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    if (!raw) continue;
    const e = parse(raw);
    if (!e || e.isSidechain) continue;
    const seq = ++c.seq,
      t = Date.parse(e.timestamp ?? "") || 0;
    const content = e.message?.content;
    if (e.type === "assistant" && Array.isArray(content)) {
      for (const b of content)
        if (b.type === "tool_use" && !c.uses.has(b.id))
          c.uses.set(b.id, {
            id: b.id,
            name: b.name,
            input: b.input ?? {},
            seq,
            t,
          });
    } else if (e.type === "user") {
      const blocks = Array.isArray(content) ? content : [];
      for (const b of blocks)
        if (b.type === "tool_result")
          c.results.set(b.tool_use_id, {
            text: textOf(b.content),
            error: !!b.is_error,
            seq,
            t,
          });
      if (blocks.some((b) => b.type === "tool_result")) continue;
      const text = textOf(content).trim();
      const note = text.match(
        /<task-notification>[\s\S]*?<tool-use-id>([\w-]+)<\/tool-use-id>/,
      ); // a background helper's report
      if (note) c.notes.set(note[1], text);
      if (typeof content === "string" && content.startsWith(STOP_HOOK_FEEDBACK))
        c.stops.push({ text, seq, t });
      else if (
        !e.isMeta &&
        !e.isCompactSummary &&
        e.promptSource !== "system" &&
        e.origin?.kind !== "task-notification" &&
        text &&
        !INJECTED.test(text)
      )
        c.typed.push({ seq, t });
    }
  }
  return c;
}

// The files: main chats of the last days, and the helper records next to each.
if (!fs.existsSync(root)) {
  console.error(`outcomes: no transcripts folder at ${root}`);
  process.exit(2);
}
const chats = [];
for (const { file } of walkChats(
  root,
  since,
  (d) => !project || d.toLowerCase().includes(project),
))
  chats.push(readChat(file));

const share = (k, n) =>
  n < TOO_FEW ? `${k} of ${n}` : `${k} of ${n} (${Math.round((100 * k) / n)}%)`;
const sample = (n) => (n < TOO_FEW ? `${n}, too few to judge` : `${n}`);
const turnEnd = (c, seq) => c.typed.find((m) => m.seq > seq)?.seq ?? Infinity;
const out = [];
const p = (s = "") => out.push(s);

p(`# Outcomes, last ${days} days`);
p(
  `${chats.length} chats read from ${root}${project ? ` (projects containing "${project}")` : ""}. Counts only. A figure from fewer than ${TOO_FEW} cases is marked "too few to judge" and has no percentage.`,
);

// ---------- rec-check
const rcCalls = [];
for (const c of chats)
  for (const u of c.uses.values())
    if (AGENT.test(u.name) && u.input.subagent_type === "rec-check") {
      const r = c.results.get(u.id);
      const first =
        r?.text
          .split(REPORT_FOLLOWS)
          .pop()
          .split("\n")
          .map((l) => l.trim())
          .find(Boolean) ?? ""; // the app wraps a helper's report in a frame
      const verdict =
        !r || r.error
          ? "no result"
          : /^change/i.test(first)
            ? "change"
            : /^keep/i.test(first)
              ? "keep"
              : "unclear";
      rcCalls.push({ c, u, r, verdict });
    }
const optStart = opt("rec-start");
const rcStart = optStart
  ? Date.parse(optStart)
  : Math.min(Infinity, ...rcCalls.filter((x) => x.u.t).map((x) => x.u.t));

const fields = []; // one per question that had a recommended option and an answer
let unanswered = 0;
for (const c of chats) {
  const forms = [...c.uses.values()]
    .filter((u) => FORM.test(u.name))
    .sort((a, b) => a.seq - b.seq);
  let prev = 0;
  for (const u of forms) {
    const qs = Array.isArray(u.input.fields)
      ? u.input.fields
          .filter((f) => Array.isArray(f.options))
          .map((f) => ({
            id: f.id,
            question: f.label,
            options: f.options,
            multi: f.type === "multiSelect",
          }))
      : (u.input.questions ?? []).map((q) => ({
          id: q.question,
          question: q.question,
          options: q.options ?? [],
          multi: !!q.multiSelect,
        }));
    const r = c.results.get(u.id);
    const lo = prev;
    prev = u.seq;
    if (u.t < since) continue;
    const rec = (q) => q.options.filter(recommended);
    const withRec = qs.filter((q) => rec(q).length === 1);
    if (!withRec.length) continue;
    if (!r) {
      unanswered += withRec.length;
      continue;
    }
    let answers = null;
    const j = parse(r.text);
    if (j?.answers) answers = j.answers;
    const check = rcCalls
      .filter((x) => x.c === c && x.r && x.r.seq < u.seq && x.r.seq > lo)
      .sort((a, b) => b.r.seq - a.r.seq)[0];
    for (const q of withRec) {
      const pick = rec(q)[0];
      let took;
      if (answers) {
        const a = answers[q.id];
        if (!a) {
          unanswered++;
          continue;
        }
        const ids =
          a.selectedIds ?? (a.selectedId != null ? [a.selectedId] : []);
        took = ids.includes(pick.id)
          ? "rec"
          : !ids.length || ids.includes("__other__") || a.otherText
            ? "own text"
            : "other option";
      } else {
        const m = r.text.match(
          new RegExp(
            `"${q.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*=\\s*"([^"]*)"`,
          ),
        );
        if (!m) {
          unanswered++;
          continue;
        }
        took =
          m[1] === pick.label
            ? "rec"
            : q.options.some((o) => o.label === m[1])
              ? "other option"
              : "own text";
      }
      fields.push({ t: u.t, took, verdict: check?.verdict ?? "none" });
    }
  }
}
const row = (name, list) => {
  const n = list.length,
    k = (w) => list.filter((f) => f.took === w).length;
  return `| ${name} | ${sample(n)} | ${share(k("rec"), n)} | ${share(k("other option"), n)} | ${share(k("own text"), n)} |`;
};
const before = fields.filter((f) => f.t < rcStart),
  after = fields.filter((f) => f.t >= rcStart);
p();
p("## rec-check");
p(
  Number.isFinite(rcStart)
    ? `rec-check counted from ${new Date(rcStart).toISOString().slice(0, 10)} ${optStart ? "(--rec-start)" : "(its first call found in these chats)"}.`
    : "No rec-check call found in these chats, so every form counts as before.",
);
const verdicts = ["keep", "change", "unclear", "no result"].map((v) => [
  v,
  rcCalls.filter((x) => x.verdict === v && x.u.t >= since).length,
]);
const calls = verdicts.reduce((s, [, n]) => s + n, 0);
p(
  `rec-check runs in the window: ${sample(calls)}${
    calls
      ? `; ${verdicts
          .filter(([, n]) => n)
          .map(([v, n]) => `${v} ${n}`)
          .join(", ")}`
      : ""
  }. Said change: ${share(verdicts[1][1], calls)}.`,
);
p(
  `Questions with one recommended option and an answer; ${unanswered} more had none (form closed or answer not recorded).`,
);
p();
p(
  "| Group (questions) | n | took the recommended option | chose another listed option | wrote their own |",
);
p("|---|---|---|---|---|");
p(row("before rec-check began", before));
p(row("after, all", after));
p(
  row(
    "after, rec-check said keep",
    after.filter((f) => f.verdict === "keep"),
  ),
);
p(
  row(
    "after, rec-check said change",
    after.filter((f) => f.verdict === "change"),
  ),
);
p(
  row(
    "after, no rec-check ran",
    after.filter((f) => f.verdict === "none" || f.verdict === "unclear"),
  ),
);

// ---------- reviews
const reviews = [];
for (const c of chats) {
  const edits = [...c.uses.values()].filter(
    (u) =>
      EDIT.test(u.name) &&
      isCode(u.input.file_path ?? u.input.notebook_path ?? u.input.path),
  );
  for (const u of c.uses.values()) {
    const kind =
      AGENT.test(u.name) && u.input.subagent_type === "reviewer"
        ? "reviewer helper"
        : u.name === "Skill" && u.input.skill === "code-review"
          ? "code-review skill"
          : null;
    if (!kind || u.t < since) continue;
    const r = c.results.get(u.id);
    const at = r?.seq ?? u.seq;
    reviews.push({
      kind,
      session: !!edits.find((e) => e.seq > at),
      turn: !!edits.find((e) => e.seq > at && e.seq < turnEnd(c, at)),
    });
  }
}
p();
p("## Reviews");
p(
  "A code change = an Edit or Write of a code file in the main chat after the review came back.",
);
p();
p(
  "| Review | n | followed by a code change in the session | before the user's next message |",
);
p("|---|---|---|---|");
for (const kind of ["reviewer helper", "code-review skill"]) {
  const list = reviews.filter((x) => x.kind === kind);
  p(
    `| ${kind} | ${sample(list.length)} | ${share(list.filter((x) => x.session).length, list.length)} | ${share(list.filter((x) => x.turn).length, list.length)} |`,
  );
}

// ---------- verify gate
const gate = [];
for (const c of chats)
  for (const s of c.stops) {
    if (
      !new RegExp("^" + STOP_HOOK_FEEDBACK + "\\s*" + VERIFY_GATE).test(
        s.text,
      ) ||
      s.t < since
    )
      continue;
    const end = turnEnd(c, s.seq);
    const runs = [...c.uses.values()].filter(
      (u) =>
        SHELL.test(u.name) &&
        u.seq > s.seq &&
        u.seq < end &&
        isBuild(u.input.command),
    );
    const results = runs.map((u) => c.results.get(u.id)).filter(Boolean);
    gate.push({ ran: runs.length > 0, passed: results.some((r) => !r.error) });
  }
p();
p("## Verify gate");
p(
  "A block counts as followed when a build or test command ran after it in the same turn; passing = its result was not an error.",
);
p();
p("| Blocks | n | followed by a build or test | followed by a passing one |");
p("|---|---|---|---|");
p(
  `| verify-gate | ${sample(gate.length)} | ${share(gate.filter((g) => g.ran).length, gate.length)} | ${share(gate.filter((g) => g.passed).length, gate.length)} |`,
);

// ---------- map
const helpers = [];
for (const c of chats) {
  const { sdir, metas } = subagentMetas(c.file);
  for (const u of c.uses.values()) {
    if (
      !AGENT.test(u.name) ||
      u.t < since ||
      !MAP_TYPES.has(u.input.subagent_type)
    )
      continue;
    const base = metas.get(u.id)?.base,
      rec = base && path.join(sdir, base + ".jsonl");
    if (!rec || !fs.existsSync(rec)) continue;
    let brief = "";
    const files = new Set();
    for (const raw of fs.readFileSync(rec, "utf8").split("\n")) {
      if (!raw) continue;
      const e = parse(raw);
      if (!e) continue;
      if (!brief && e.type === "user") brief = textOf(e.message?.content);
      if (e.type === "assistant" && Array.isArray(e.message?.content))
        for (const b of e.message.content) {
          if (b.type === "tool_use" && EDIT.test(b.name))
            files.add(editedFile(b.input));
        }
    }
    brief = brief || String(u.input.prompt ?? "");
    const withMap =
      brief.includes(MAP_MARK) ||
      String(u.input.prompt ?? "").includes(MAP_MARK);
    const cut = brief.indexOf(MAP_MARK);
    const own = (cut >= 0 ? brief.slice(0, cut) : brief)
      .replace(/\\/g, "/")
      .toLowerCase(); // the map lines name files too, so they are not part of "the brief"
    const outside = [...files].filter(
      (f) => f && !own.includes(path.basename(f)),
    );
    const r = c.results.get(u.id);
    helpers.push({
      withMap,
      changed: files.size > 0,
      outside: outside.length,
      stopped:
        CAPPED.test(r?.text.slice(0, 300) ?? "") ||
        CAPPED.test(c.notes.get(u.id) ?? ""),
    });
  }
}
p();
p("## Map");
p(
  `Helpers of type ${[...MAP_TYPES].join(", ")} that have a record of their own. "With map" = the brief held "${MAP_MARK}". An edit outside the brief = a file the helper wrote whose file name the brief (without the map lines) does not name. Stopped = ended at its turn limit.`,
);
p();
p("| Helpers | n | changed files | with an edit outside the brief | stopped |");
p("|---|---|---|---|---|");
for (const [name, list] of [
  ["with map", helpers.filter((h) => h.withMap)],
  ["without map", helpers.filter((h) => !h.withMap)],
]) {
  const changed = list.filter((h) => h.changed);
  p(
    `| ${name} | ${sample(list.length)} | ${share(changed.length, list.length)} | ${share(changed.filter((h) => h.outside).length, changed.length)} | ${share(list.filter((h) => h.stopped).length, list.length)} |`,
  );
}
console.log(out.join("\n"));
