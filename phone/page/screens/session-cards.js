// The cards docked in place of the typing box while a session needs the user (DS2, "Question cards", "Answer on
// the PC"): option and multi-pick questions, a permission, a plan, a form (session-form.js), and the grey "answer on
// the PC" card for a form or any prompt the phone cannot answer, which has no input. A single tap and Deny send after a 5-second Undo;
// the main buttons send at once. Every answerable card ends with "Type instead". Each card's head has Hide / Show,
// which folds the card to that one row so the chat above can be read. Used by session.js.
import { el, ICONS, icon } from "../frame/dom.js";
import { markdown } from "../frame/markdown.js";
import { folder, formCard, formDrawable } from "./session-form.js";

// recheckMs: after an answer the PC took, session.pending is asked again at each of these; the last is L, the larger
// of 10 s and 3 x the measured gap between a form's result line and its database row (0.001 s on 2026-11-17).
export const timing = { undoMs: 5000, recheckMs: [2000, 5000, 10000] };

// replaceChildren writes an empty slot as the text "null": the empty slots are left out first.
const fill = (node, ...kids) =>
  node.replaceChildren(
    ...kids.filter((k) => k !== null && k !== undefined && k !== false),
  );

const head = (words, right, fold) =>
  el(
    "div.qhead",
    el("span.orb.listen", { "aria-hidden": "true" }),
    words,
    right ? el("span.of", right) : null,
    fold,
  );

const link = (words, onclick) =>
  el("button.link", { type: "button", onclick }, words);

// A card's sending: the Undo countdown, then the answer; a failure stays in the card with Try again.
function sender(v, box, redraw) {
  const s = { undo: null, line: null, busy: false };
  s.send = async (kind, answer) => {
    s.busy = true;
    s.line = { text: "Sending…" };
    redraw();
    const r = await v.answer(kind, answer);
    s.busy = false;
    // The PC took the answer: v.answer has put the typing box with "Answer sent." in the card's place.
    if (r?.ok) s.line = null;
    else
      s.line = {
        text: `Not sent: ${v.why(r)}`,
        bad: true,
        retry: () => s.send(kind, answer),
      };
    redraw();
  };
  s.later = (kind, answer, words) => {
    let left = Math.ceil(timing.undoMs / 1000);
    const timer = setInterval(() => {
      left--;
      if (s.undo) s.undo.left = left;
      redraw();
    }, 1000);
    const go = setTimeout(() => {
      stop();
      s.send(kind, answer);
    }, timing.undoMs);
    // Hiding the app closes the link: an answer still in its Undo goes out first, as the user already saw "Sent".
    const off = v.ctx.beforeSleep(() => {
      stop();
      return s.send(kind, answer);
    });
    function stop() {
      clearTimeout(go);
      clearInterval(timer);
      off();
      s.undo = null;
    }
    s.undo = {
      words,
      left,
      cancel: () => {
        stop();
        redraw();
      },
    };
    redraw();
  };
  s.view = () => {
    if (s.undo)
      return el(
        "div.undo",
        el("span", s.undo.words),
        el("span.sp"),
        link(`Undo · ${s.undo.left}s`, s.undo.cancel),
      );
    if (!s.line) return null;
    return el(
      `div.undo${s.line.bad ? ".bad" : ""}`,
      el("span", s.line.text),
      s.line.retry
        ? el(
            "button.btn",
            { type: "button", onclick: s.line.retry },
            "Try again",
          )
        : null,
    );
  };
  s.locked = () => Boolean(s.undo || s.busy || (s.line && !s.line.bad));
  box.sender = s;
  return s;
}

// "Recommended" is part of an option's label; the card shows it as a tag and sends the label unchanged.
const RECOMMENDED = /\s*\(recommended\)\s*/i;

function optionRow(o, on, multi, disabled, onclick) {
  return el(
    `button.opt${on ? ".sel" : ""}`,
    { type: "button", disabled, "data-label": o.label, onclick },
    multi ? el(`span.box${on ? ".on" : ""}`, { "aria-hidden": "true" }) : null,
    el(
      "span.opt-text",
      el(
        "span.l",
        o.label.replace(RECOMMENDED, " ").trim(),
        RECOMMENDED.test(o.label) ? el("span.rec-tag", "Recommended") : null,
      ),
      o.description ? el("span.d", o.description) : null,
    ),
  );
}

// One question: a single tap sends after the Undo; a multi-pick sends with "Send N picks" (DS2).
function questionCard(v, p) {
  if (p.body.questions.length > 1) return questionForm(v, p);
  const box = el("div.qcard", { "data-kind": "question" });
  const fold = folder(box, p.promptId);
  const q = p.body.questions[0];
  let chosen = [];
  const s = sender(v, box, () => draw());
  const answer = (picks) => ({
    [q.question]: q.multiSelect ? picks : picks[0],
  });

  function draw() {
    const locked = s.locked();
    const options = q.options.map((o) => {
      const on = chosen.includes(o.label);
      return optionRow(o, on, q.multiSelect, locked, () => {
        v.ctx.haptic("select");
        if (q.multiSelect) {
          chosen = on
            ? chosen.filter((l) => l !== o.label)
            : [...chosen, o.label];
          return draw();
        }
        chosen = [o.label];
        s.later("question", answer(chosen), `Sent: ${o.label}`);
      });
    });
    const n = chosen.length;
    fill(
      box,
      head("Needs you", q.multiSelect ? "Pick any" : "One tap sends", fold()),
      el("div.qtext", q.question),
      ...options,
      s.view(),
      el(
        "div.qfoot",
        locked
          ? null
          : link("Type instead", () =>
              v.openTypeInstead({
                head: "Answer in your own words",
                button: "Send answer",
                send: (text) => v.answer("question", answer([text])),
              }),
            ),
        el("span.sp"),
        q.multiSelect && !locked
          ? el(
              "button.btn.fill",
              {
                type: "button",
                disabled: n === 0,
                "data-action": "send-picks",
                onclick: () => s.send("question", answer(chosen)),
              },
              `Send ${n} pick${n === 1 ? "" : "s"}`,
            )
          : null,
      ),
    );
  }
  draw();
  return box;
}

// A card's answers so far, by its prompt id: "Type instead" and "Back" build the card again, and a refresh may too.
const forms = new Map();

// Several questions: one form (FQ1). Every question shows at once, a pick can be changed or taken back, a typed
// answer stands for its own question, and one "Send answers" sends them all once each question has an answer.
function questionForm(v, p) {
  const box = el("div.qcard.qform", { "data-kind": "question" });
  const fold = folder(box, p.promptId);
  const qs = p.body.questions;
  if (!forms.has(p.promptId))
    forms.set(p.promptId, { picks: new Map(), typed: new Set(), scroll: 0 });
  const f = forms.get(p.promptId);
  const got = (q) => f.picks.get(q.question) ?? [];
  const answer = () =>
    Object.fromEntries(
      qs.map((q) => [q.question, q.multiSelect ? got(q) : got(q)[0]]),
    );
  const s = sender(v, box, () => draw());
  // Always the answers as they stand: "Try again" after a changed pick sends the change.
  const send = s.send;
  s.send = async (kind) => {
    await send(kind, answer());
    if (s.line && !s.line.bad) forms.delete(p.promptId);
  };
  let list = null;

  function set(q, picks, typed) {
    if (s.line?.bad) s.line = null;
    f.picks.set(q.question, picks);
    if (typed) f.typed.add(q.question);
    else f.typed.delete(q.question);
  }

  function item(q, locked) {
    const typed = f.typed.has(q.question);
    const chosen = typed ? [] : got(q);
    const options = q.options.map((o) => {
      const on = chosen.includes(o.label);
      return optionRow(o, on, q.multiSelect, locked, () => {
        v.ctx.haptic("select");
        if (q.multiSelect)
          set(
            q,
            on ? chosen.filter((l) => l !== o.label) : [...chosen, o.label],
          );
        else set(q, on ? [] : [o.label]);
        draw();
      });
    });
    return el(
      "div.qitem",
      { "data-question": q.question },
      el("div.qtext", q.question),
      el("div.qhint", q.multiSelect ? "Pick any" : "Pick one"),
      ...options,
      typed
        ? el(
            "button.opt.sel.typed",
            {
              type: "button",
              disabled: locked,
              "data-action": "unset-typed",
              onclick: () => {
                set(q, []);
                draw();
              },
            },
            el(
              "span.opt-text",
              el("span.l", got(q)[0]),
              el("span.d", "Your words · tap to take back"),
            ),
          )
        : null,
      locked
        ? null
        : el(
            "div.qfoot",
            link(typed ? "Type again" : "Type instead", () =>
              v.openTypeInstead({
                head: q.question,
                button: "Use this answer",
                send: async (text) => {
                  set(q, [text], true);
                  return { ok: true, d: {} };
                },
              }),
            ),
          ),
    );
  }

  function draw() {
    if (list) f.scroll = list.scrollTop;
    const locked = s.locked();
    const n = qs.filter((q) => got(q).length > 0).length;
    list = el(
      "div.qlist",
      {
        onscroll: () => {
          f.scroll = list.scrollTop;
        },
      },
      ...qs.map((q) => item(q, locked)),
    );
    fill(
      box,
      head("Needs you", `${qs.length} questions`, fold()),
      list,
      s.view(),
      locked
        ? null
        : el(
            "div.qfoot",
            el("span.sp"),
            el(
              "button.btn.fill",
              {
                type: "button",
                disabled: n < qs.length,
                "data-action": "send-answers",
                onclick: () => s.send("question", answer()),
              },
              n < qs.length ? `${n} of ${qs.length} answered` : "Send answers",
            ),
          ),
    );
    // Built again after "Type instead" or "Back", the card is not in the page yet: the scroll waits for it.
    const shown = list;
    shown.scrollTop = f.scroll;
    requestAnimationFrame(() => {
      if (shown === list) shown.scrollTop = f.scroll;
    });
  }
  draw();
  return box;
}

function permissionCard(v, p) {
  const b = p.body;
  const box = el("div.qcard", { "data-kind": "permission" });
  const fold = folder(box, p.promptId);
  const s = sender(v, box, () => draw());
  function draw() {
    const locked = s.locked();
    fill(
      box,
      head("Needs you · Permission", null, fold()),
      el(
        "div.qtext",
        b.toolName === "Bash" ? "Run this command?" : `Allow ${b.toolName}?`,
      ),
      b.rawCommand ? el("div.cmd", b.rawCommand) : null,
      el("div.cmdmeta", `In ${v.name()} · ${b.toolName}`),
      b.isDestructive
        ? el("div.cmdmeta.bad", "It may delete or overwrite things.")
        : null,
      ...b.warnings.map((w) => el("div.cmdmeta.bad", String(w))),
      locked
        ? null
        : el(
            "div.pair",
            el(
              "button.btn",
              {
                type: "button",
                "data-action": "deny",
                onclick: () => s.later("permission", "deny", "Denied"),
              },
              "Deny",
            ),
            el(
              "button.btn.fill",
              {
                type: "button",
                "data-action": "allow",
                onclick: () => s.send("permission", "allow"),
              },
              "Allow once",
            ),
          ),
      s.view(),
      locked
        ? null
        : el(
            "div.qfoot",
            link("Type instead", () =>
              v.openTypeInstead({
                head: `Deny ${b.rawCommand ?? b.toolName} and say:`,
                button: "Deny and send",
                send: async (text) => {
                  const r = await v.answer("permission", "deny");
                  if (!r?.ok) return r;
                  return v.ctx.ask("session.queue", {
                    session: v.params.session,
                    text,
                  });
                },
              }),
            ),
          ),
    );
  }
  draw();
  return box;
}

function planCard(v, p) {
  const box = el("div.qcard", { "data-kind": "plan" });
  const fold = folder(box, p.promptId);
  const s = sender(v, box, () => draw());
  let whole = false;
  function draw() {
    const locked = s.locked();
    fill(
      box,
      head("Needs you · Plan", null, fold()),
      el("div.qtext", "Approve this plan?"),
      el(
        `div.plan${whole ? ".whole" : ""}`,
        p.body.plan ? markdown(p.body.plan) : "The plan has no text.",
      ),
      locked
        ? null
        : el(
            "button.btn.fill.wide",
            {
              type: "button",
              "data-action": "approve",
              onclick: () => s.send("plan", { approved: true }),
            },
            "Approve",
          ),
      s.view(),
      locked
        ? null
        : el(
            "div.qfoot",
            link("Type instead", () =>
              v.openTypeInstead({
                head: "Ask for changes · it keeps planning",
                button: "Send changes",
                send: (text) =>
                  v.answer("plan", { approved: false, feedback: text }),
              }),
            ),
            el("span.sp"),
            whole
              ? null
              : link("Read the whole plan", () => {
                  whole = true;
                  draw();
                }),
          ),
    );
  }
  draw();
  return box;
}

// A form with a field kind the phone cannot draw, or a prompt kind the phone cannot answer: no input, the PC
// answers it.
function pcCard(p) {
  const fields = p.kind === "form" ? p.body.fields : [];
  const box = el("div.pc-card", { "data-kind": p.kind });
  const fold = folder(box, p.promptId);
  let shown = false;
  function draw() {
    fill(
      box,
      el(
        "div.qhead",
        icon(ICONS.pc, 20),
        "Needs you · Answer on the PC",
        fold(),
      ),
      el(
        "div.qtext",
        p.kind === "form"
          ? (p.body.title ?? "A form")
          : "A question the phone can't show",
      ),
      el(
        "p",
        p.kind === "form"
          ? "This form needs the PC: it has a kind of question the phone can't show. The session waits until you answer there."
          : "This question needs the PC: the phone can't show this kind. The session waits until you answer there.",
      ),
      fields.length && !shown
        ? el(
            "button.btn.wide",
            {
              type: "button",
              onclick: () => {
                shown = true;
                draw();
              },
            },
            "Show the questions",
          )
        : null,
      shown
        ? el(
            "ol.pc-fields",
            fields.map((f) =>
              el("li", String(f.label ?? f.question ?? f.title ?? f.id)),
            ),
          )
        : null,
    );
  }
  draw();
  return box;
}

export function cardFor(v, p) {
  if (p.kind === "question") return questionCard(v, p);
  if (p.kind === "permission") return permissionCard(v, p);
  if (p.kind === "plan") return planCard(v, p);
  if (p.kind === "form" && formDrawable(p.body)) return formCard(v, p);
  if (p.kind === "form" || p.kind === "on-pc") return pcCard(p);
  throw new Error(`session.pending: unknown kind ${p.kind}`);
}
