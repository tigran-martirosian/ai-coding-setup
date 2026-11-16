// Forms answered on the phone (PC program design, "Forms answered on the phone"; DS2 screens 7 and 8): the open
// PromptForUserInput form of a session, answered through the door patch's answer_form. Every answer is checked
// against the form's own fields first, so a wrong pick never reaches Nimbalyst. The phone draws five field kinds;
// a form with any other kind is answered on the PC.
//   form.answer   { session, promptId, answers }  answers: JSON text, field id -> the value Nimbalyst's own form
//                 sends: singleSelect { selectedId }, multiSelect { selectedIds }, reorder { orderedIds,
//                 removedIds }, editText { text, edited }, confirm { value } (each with its `type`)
//   form.instead  { session, promptId, text }     cancels the form, then sends the words as the next message
import { knownSession, openForm } from "../core/db.mjs";
import {
  answerForm,
  needTool,
  SESSION_INPUT,
  sendPrompt,
  watchDoor,
} from "../core/door.mjs";
import { ActionError } from "../core/registry.mjs";
import { TEXT_INPUT } from "./session.mjs";

export const PHONE_KINDS = [
  "singleSelect",
  "multiSelect",
  "reorder",
  "editText",
  "confirm",
];
const SETTLE_MS = 3000;
const STEP_MS = 500;
const PROMPT_ID = { type: "string", min: 1, max: 200 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = (field) => new ActionError("bad-answer", { field });
const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const ids = (list) => (Array.isArray(list) ? list.map((x) => x?.id) : []);
const strings = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

// Checks one field's value; throws bad-answer naming the field. An editText or confirm left out is refused, as
// Nimbalyst's own form keeps Send off until every field has its answer.
function checkValue(f, v) {
  if (!isObject(v) || v.type !== f.type) throw bad(f.id);
  if (f.type === "singleSelect") {
    if (v.selectedId === "__other__" && f.allowOther) {
      if (typeof v.otherText !== "string" || !v.otherText.trim())
        throw bad(f.id);
    } else if (!ids(f.options).includes(v.selectedId)) throw bad(f.id);
  } else if (f.type === "multiSelect") {
    const all = ids(f.items);
    const n = strings(v.selectedIds) ? v.selectedIds.length : -1;
    if (n < 0 || v.selectedIds.some((id) => !all.includes(id))) throw bad(f.id);
    if (new Set(v.selectedIds).size !== n) throw bad(f.id);
    if (n < (f.minSelected ?? 0) || n > (f.maxSelected ?? all.length))
      throw bad(f.id);
  } else if (f.type === "reorder") {
    const all = ids(f.items);
    if (!strings(v.orderedIds) || !strings(v.removedIds)) throw bad(f.id);
    const both = [...v.orderedIds, ...v.removedIds];
    if (both.length !== all.length || new Set(both).size !== all.length)
      throw bad(f.id);
    if (both.some((id) => !all.includes(id))) throw bad(f.id);
    const removable = new Set(
      f.items.filter((i) => i.removable).map((i) => i.id),
    );
    if (v.removedIds.some((id) => !removable.has(id))) throw bad(f.id);
    if (v.orderedIds.length < (f.minItems ?? 0)) throw bad(f.id);
  } else if (f.type === "editText") {
    if (typeof v.text !== "string" || typeof v.edited !== "boolean")
      throw bad(f.id);
    if (v.text.length < (f.minLength ?? 0)) throw bad(f.id);
    if (f.maxLength && v.text.length > f.maxLength) throw bad(f.id);
  } else if (f.type === "confirm") {
    if (typeof v.value !== "boolean") throw bad(f.id);
  } else throw new ActionError("form-on-pc", { field: f.id });
}

// The answers for `fields`, checked: every field answered, nothing else sent.
export function checkAnswers(fields, answers) {
  if (!isObject(answers)) throw bad("answers");
  const known = new Set(fields.map((f) => f.id));
  for (const k of Object.keys(answers)) if (!known.has(k)) throw bad(k);
  for (const f of fields) {
    if (!PHONE_KINDS.includes(f.type))
      throw new ActionError("form-on-pc", { field: f.id });
    if (!Object.hasOwn(answers, f.id)) throw bad(f.id);
    checkValue(f, answers[f.id]);
  }
  return answers;
}

// The session's open form when it is `promptId`; no-prompt otherwise.
function theForm(sessionId, promptId) {
  const form = openForm(sessionId);
  if (!form || form.promptId !== promptId) throw new ActionError("no-prompt");
  return form;
}

// True once the form has its result in the database, checked for up to 3 s.
async function closed(sessionId, promptId) {
  const until = Date.now() + SETTLE_MS;
  for (;;) {
    const now = openForm(sessionId);
    if (!now || now.promptId !== promptId) return true;
    if (Date.now() >= until) return false;
    await sleep(STEP_MS);
  }
}

export function register(registry) {
  watchDoor();

  registry.add({
    name: "form.answer",
    input: {
      session: SESSION_INPUT,
      promptId: PROMPT_ID,
      answers: { type: "string", min: 2, max: 50000 },
    },
    run: async (d) => {
      const { project } = knownSession(d.session);
      let answers;
      try {
        answers = JSON.parse(d.answers);
      } catch {
        throw bad("answers");
      }
      const form = theForm(d.session, d.promptId);
      checkAnswers(form.body.fields, answers);
      await needTool("answer_form");
      await answerForm(project.path, d.session, d.promptId, answers);
      return { cleared: await closed(d.session, d.promptId) };
    },
  });

  registry.add({
    name: "form.instead",
    input: { session: SESSION_INPUT, promptId: PROMPT_ID, text: TEXT_INPUT },
    run: async (d) => {
      const { project } = knownSession(d.session);
      theForm(d.session, d.promptId);
      await needTool("answer_form");
      await answerForm(project.path, d.session, d.promptId, "cancelled");
      const r = await sendPrompt(project.path, d.session, d.text);
      return { started: r.processingTriggered === true };
    },
  });
}
