// What a session waits on, and the answer to it (actions 11 and 12 of the PC program design).
// Questions, permissions and plans come from the door; forms (PromptForUserInput / RequestUserInput) and the
// questions of Nimbalyst's own tool (mcp__nimbalyst__AskUserQuestion) from the database, since the door does not
// report them. A session that waits on nothing either can show is "on-pc": the page says "answer on the PC".
//
// session.answer's `answer` is JSON text, by kind:
//   question:   { "<question text>": "label" | ["label", ...] } for every question
//   permission: "allow" | "deny"
//   plan:       { "approved": true | false, "feedback": "..." (optional) }
//   form:       { "<field id>": value, ... } or "cancelled"
import { knownSession, openDb, openForm } from "../core/db.mjs";
import {
  answerForm,
  answerPlan,
  doorPending,
  hasTool,
  mapQuestions,
  needTool,
  respondToPrompt,
  SESSION_INPUT,
  watchDoor,
} from "../core/door.mjs";
import { ActionError } from "../core/registry.mjs";

const SETTLE_MS = 3000;
const STEP_MS = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUESTION_TOOL = /(^|__)AskUserQuestion$/;

function json(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function parts(content, type) {
  const all = json(content)?.message?.content;
  return Array.isArray(all) ? all.filter((p) => p?.type === type) : [];
}

// An answer row names the call in questionId, or (from Nimbalyst's mobile path) in rawQuestionId or waiterIds;
// Nimbalyst's own waiter matches all three.
const answers = (c, id) =>
  c?.type === "ask_user_question_response" &&
  (c.questionId === id ||
    c.rawQuestionId === id ||
    (Array.isArray(c.waiterIds) && c.waiterIds.includes(id)));

// A call is closed by its answer row, by its tool result, or by a new user message after it: when the user writes
// instead of answering, the turn ends and Nimbalyst writes neither of the other two.
function closed(db, sessionId, rowId, id) {
  const later = db
    .prepare(
      `SELECT direction, content FROM ai_agent_messages
       WHERE session_id = ? AND id > ? AND (direction = 'input' OR content LIKE ?)`,
    )
    .iterate(sessionId, rowId, `%${id}%`);
  for (const r of later) {
    if (r.direction === "input") return true;
    if (answers(json(r.content), id)) return true;
    if (parts(r.content, "tool_result").some((p) => p.tool_use_id === id))
      return true;
  }
  return false;
}

// The door finds a question only by the nimbalyst_tool_use row the built-in AskUserQuestion leaves; Nimbalyst's
// own tool (mcp__nimbalyst__AskUserQuestion) leaves just the raw tool call, so the door reports nothing for it.
// Its answer goes through the same respond_to_prompt as the built-in one, on the tool call id. The newest such
// call, if it is not closed: a door-shaped question prompt, or null.
function openQuestion(sessionId) {
  const db = openDb();
  const calls = db
    .prepare(
      `SELECT id, content FROM ai_agent_messages
       WHERE session_id = ? AND message_kind = 'tool' AND content LIKE '%AskUserQuestion%' ORDER BY id DESC`,
    )
    .iterate(sessionId);
  for (const row of calls) {
    const use = parts(row.content, "tool_use")
      .filter((p) => QUESTION_TOOL.test(String(p.name)))
      .pop();
    if (!use) continue;
    if (closed(db, sessionId, row.id, use.id)) return null;
    const qs = Array.isArray(use.input?.questions) ? use.input.questions : [];
    if (!qs.length) return null;
    return {
      kind: "question",
      promptId: use.id,
      promptType: "ask_user_question_request",
      body: { questions: mapQuestions(qs) },
    };
  }
  return null;
}

// null, or { kind, promptId, body, promptType (door prompts only) }.
export async function pending(projectPath, sessionId) {
  const door = await doorPending(projectPath, sessionId);
  if (door.prompt) return door.prompt;
  if (door.status !== "waiting_for_input" && door.status !== "running")
    return null;
  const question = openQuestion(sessionId);
  if (question) return question;
  const form = openForm(sessionId);
  if (form) return { kind: "form", promptId: form.promptId, body: form.body };
  if (door.status === "waiting_for_input")
    return { kind: "on-pc", promptId: null, body: null };
  return null;
}

const bad = () => new ActionError("bad-input", { field: "answer" });
const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function questionResponse(p, a) {
  if (!isObject(a)) throw bad();
  const answers = {};
  for (const q of p.body.questions) {
    const v = a[q.question];
    const labels = Array.isArray(v) ? v : [v];
    if (!labels.length || labels.some((l) => typeof l !== "string" || !l))
      throw bad();
    if (labels.length > 1 && !q.multiSelect) throw bad();
    answers[q.question] = labels.join(", ");
  }
  return { answers };
}

// True once the session no longer waits on `promptId`, checked for up to 3 s (the door's `success` proves
// nothing, probe 2).
async function cleared(projectPath, sessionId, promptId) {
  const until = Date.now() + SETTLE_MS;
  for (;;) {
    const now = await pending(projectPath, sessionId);
    if (!now || now.promptId !== promptId) return true;
    if (Date.now() >= until) return false;
    await sleep(STEP_MS);
  }
}

export function register(registry) {
  watchDoor();

  registry.add({
    name: "session.pending",
    input: { session: SESSION_INPUT },
    run: async (d) => {
      const { project } = knownSession(d.session);
      const p = await pending(project.path, d.session);
      return p && { kind: p.kind, promptId: p.promptId, body: p.body };
    },
  });

  registry.add({
    name: "session.answer",
    input: {
      session: SESSION_INPUT,
      promptId: { type: "string", min: 1, max: 200 },
      kind: {
        type: "string",
        max: 10,
        pattern: /^(question|permission|plan|form)$/,
      },
      answer: { type: "string", min: 1, max: 20000 },
    },
    run: async (d) => {
      const { project } = knownSession(d.session);
      let a;
      try {
        a = JSON.parse(d.answer);
      } catch {
        throw bad();
      }
      const p = await pending(project.path, d.session);
      if (!p || p.promptId !== d.promptId || p.kind !== d.kind)
        throw new ActionError("no-prompt");
      const path = project.path;
      if (p.kind === "question") {
        await respondToPrompt(
          path,
          d.session,
          p.promptId,
          p.promptType,
          questionResponse(p, a),
        );
      } else if (p.kind === "permission") {
        if (a !== "allow" && a !== "deny") throw bad();
        await respondToPrompt(path, d.session, p.promptId, p.promptType, {
          decision: a,
          scope: "once",
        });
      } else if (p.kind === "plan") {
        if (!isObject(a) || typeof a.approved !== "boolean") throw bad();
        if (a.feedback !== undefined && typeof a.feedback !== "string")
          throw bad();
        const plan = { approved: a.approved, feedback: a.feedback };
        if (await hasTool("answer_plan"))
          await answerPlan(path, d.session, p.promptId, plan);
        else
          await respondToPrompt(
            path,
            d.session,
            p.promptId,
            "exit_plan_mode_request",
            plan,
          );
      } else {
        if (a !== "cancelled" && !isObject(a)) throw bad();
        await needTool("answer_form");
        await answerForm(path, d.session, p.promptId, a);
      }
      return { cleared: await cleared(path, d.session, p.promptId) };
    },
  });
}
