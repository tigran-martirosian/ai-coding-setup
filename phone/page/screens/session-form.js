// A form the session waits on (DS2 screens 7 and 8): the card docked in place of the typing box, and the
// full-screen sheet it opens, in the app's own controls. The phone draws Nimbalyst's five field kinds (pick one,
// pick any, order, edit text, yes/no); a form with any other kind gets session-cards.js's "answer on the PC" card.
// "Send answers" stays off until every field has its answer; closing the sheet keeps the answers. The answer goes
// through form.answer (the door patch's answer_form); "Type instead" cancels the form and sends the words.
import { el, icon } from "../frame/dom.js";

const fill = (node, ...kids) =>
  node.replaceChildren(
    ...kids.filter((k) => k !== null && k !== undefined && k !== false),
  );

const KINDS = ["singleSelect", "multiSelect", "reorder", "editText", "confirm"];
export const formDrawable = (body) =>
  body.fields.length > 0 && body.fields.every((f) => KINDS.includes(f.type));

const GLYPHS = {
  x: ["M6 6l12 12M18 6L6 18"],
  up: ["M12 19V5M6 11l6-6 6 6"],
  down: ["M12 5v14M6 13l6 6 6-6"],
  tick: ["M5 12l5 5 9-10"],
};
const HELP = {
  singleSelect: "Pick one",
  multiSelect: "Pick any",
  reorder: "Move a row up or down",
  editText: "Edit the draft",
  confirm: "Yes or no",
};
const NEEDS = {
  singleSelect: "needs a pick",
  multiSelect: "needs more picks",
  editText: "needs more text",
  confirm: "needs a yes or no",
};

// The value Nimbalyst's own form starts each field with: nothing picked, the items in their order, the draft.
function seed(f) {
  if (f.type === "multiSelect")
    return {
      type: f.type,
      selectedIds: f.items.filter((i) => i.defaultChecked).map((i) => i.id),
    };
  if (f.type === "reorder")
    return {
      type: f.type,
      orderedIds: f.items.map((i) => i.id),
      removedIds: [],
    };
  if (f.type === "editText")
    return { type: f.type, text: f.initialText, edited: false };
  if (f.type === "confirm")
    return typeof f.defaultValue === "boolean"
      ? { type: f.type, value: f.defaultValue }
      : null;
  return null;
}

function answered(f, a) {
  if (!a) return false;
  if (f.type === "multiSelect") {
    const n = a.selectedIds.length;
    return n >= (f.minSelected ?? 0) && n <= (f.maxSelected ?? f.items.length);
  }
  if (f.type === "editText") return a.text.length >= (f.minLength ?? 0);
  if (f.type === "singleSelect" && a.selectedId === OTHER)
    return a.otherText.trim().length > 0;
  return true;
}

// A pick-one field with allowOther gets an "Other" row and its own-answer box; the PC takes it as this id plus
// otherText (pc/actions/forms.mjs checkValue).
const OTHER = "__other__";

const label = (f) => String(f.label ?? f.id);

// The prompt ids of the docked cards folded to their head row, so the chat above them can be read. Kept here, so a
// card built again ("Type instead", "Back") stays folded; folding only hides, so the answers so far stay.
const foldedIds = new Set();
const FOLD_GLYPHS = { open: ["M6 9l6 6 6-6"], folded: ["M6 15l6-6 6 6"] };

// The head's Hide / Show button for `box`, the card of prompt `id`, for this file's card and session-cards.js's.
// Call the returned maker in every draw, as the head is drawn again.
export function folder(box, id) {
  const base = box.className;
  const set = () => {
    box.className = foldedIds.has(id) ? `${base} folded` : base;
  };
  set();
  return () => {
    const b = el("button.qfold", { type: "button", "data-action": "fold" });
    const show = () => {
      const folded = foldedIds.has(id);
      b.setAttribute("aria-expanded", folded ? "false" : "true");
      b.replaceChildren(
        el("span", folded ? "Show" : "Hide"),
        icon(folded ? FOLD_GLYPHS.folded : FOLD_GLYPHS.open, 18),
      );
    };
    b.addEventListener("click", () => {
      if (foldedIds.has(id)) foldedIds.delete(id);
      else foldedIds.add(id);
      set();
      show();
    });
    show();
    return b;
  };
}

export function formCard(v, p) {
  const fields = p.body.fields;
  const answers = Object.fromEntries(fields.map((f) => [f.id, seed(f)]));
  const box = el("div.qcard", { "data-kind": "form" });
  const fold = folder(box, p.promptId);
  const sheet = el("div.fsheet", { role: "dialog", "aria-modal": "true" });
  const blocks = new Map();
  const otherBoxes = new Map(); // field id -> its own-answer box, while "Other" is picked
  let open = false;
  let busy = false;
  let line = null; // { text, bad }

  const title = p.body.title ?? "A form";
  const count = `${fields.length} question${fields.length === 1 ? "" : "s"}`;

  function drawCard() {
    fill(
      box,
      el(
        "div.qhead",
        el("span.orb.listen", { "aria-hidden": "true" }),
        "Needs you · Form",
        fold(),
      ),
      el("div.qtext", `${title}: ${count}`),
      el("div.qmeta", fields.map(label).join(" · ")),
      el(
        "button.btn.fill.wide",
        {
          type: "button",
          "data-action": "open-form",
          onclick: () => {
            open = true;
            draw();
          },
        },
        "Open the form",
      ),
      line && !open
        ? el(`div.undo${line.bad ? ".bad" : ""}`, el("span", line.text))
        : null,
      el(
        "div.qfoot",
        el(
          "button.link",
          {
            type: "button",
            onclick: () =>
              v.openTypeInstead({
                head: "Skip the form and say:",
                button: "Send",
                send: (text) =>
                  v.ctx
                    .ask("form.instead", {
                      session: v.params.session,
                      promptId: p.promptId,
                      text,
                    })
                    .catch((e) => e),
              }),
          },
          "Type instead",
        ),
      ),
      open ? sheet : null,
    );
  }

  const set = (f, a) => {
    answers[f.id] = a;
    drawSheet();
  };

  function control(f) {
    const a = answers[f.id];
    if (f.type === "singleSelect") {
      const pick = (id, text, sub, pickIt) =>
        el(
          `button.opt${a?.selectedId === id ? ".sel" : ""}`,
          {
            type: "button",
            "data-option": id,
            "aria-pressed": a?.selectedId === id ? "true" : "false",
            onclick: pickIt,
          },
          el(`span.radio${a?.selectedId === id ? ".on" : ""}`),
          el(
            "span.ol",
            el("span.l", text),
            sub ? el("span.d", String(sub)) : null,
          ),
        );
      const rows = f.options.map((o) =>
        pick(o.id, String(o.label), o.description, () =>
          set(f, { type: f.type, selectedId: o.id }),
        ),
      );
      if (!f.allowOther) return rows;
      const other = a?.selectedId === OTHER;
      rows.push(
        pick(OTHER, "Other", null, () => {
          if (other) return;
          set(f, { type: f.type, selectedId: OTHER, otherText: "" });
          otherBoxes.get(f.id).focus();
        }),
      );
      if (other) {
        // Typing only updates the answer and the foot, so the box keeps its focus and caret.
        const field = el("textarea.ffield", {
          rows: "2",
          "aria-label": `${label(f)}: your own answer`,
          placeholder: "Your own answer",
          "data-other": f.id,
          oninput: () => {
            answers[f.id] = {
              type: f.type,
              selectedId: OTHER,
              otherText: field.value,
            };
            drawFoot();
          },
        });
        field.value = a.otherText;
        otherBoxes.set(f.id, field);
        rows.push(field);
      }
      return rows;
    }
    if (f.type === "multiSelect")
      return f.items.map((i) => {
        const on = a.selectedIds.includes(i.id);
        return el(
          `button.opt${on ? ".sel" : ""}`,
          {
            type: "button",
            "data-option": i.id,
            "aria-pressed": on ? "true" : "false",
            onclick: () =>
              set(f, {
                type: f.type,
                selectedIds: on
                  ? a.selectedIds.filter((x) => x !== i.id)
                  : [...a.selectedIds, i.id],
              }),
          },
          el(`span.box${on ? ".on" : ""}`, on ? icon(GLYPHS.tick, 16) : null),
          el(
            "span.ol",
            el("span.l", String(i.title)),
            i.subtitle ? el("span.d", String(i.subtitle)) : null,
          ),
        );
      });
    if (f.type === "reorder") {
      const order = a.orderedIds;
      const move = (k, by) => {
        const next = [...order];
        [next[k], next[k + by]] = [next[k + by], next[k]];
        set(f, { ...a, orderedIds: next });
      };
      return order.map((id, k) =>
        el(
          "div.ord",
          { "data-item": id },
          el("span.k", String(k + 1)),
          el("span.l", String(f.items.find((i) => i.id === id).title)),
          el(
            "button.sb",
            {
              type: "button",
              "aria-label": "Move up",
              disabled: k === 0,
              onclick: () => move(k, -1),
            },
            icon(GLYPHS.up, 20),
          ),
          el(
            "button.sb",
            {
              type: "button",
              "aria-label": "Move down",
              disabled: k === order.length - 1,
              onclick: () => move(k, 1),
            },
            icon(GLYPHS.down, 20),
          ),
        ),
      );
    }
    if (f.type === "editText") {
      const field = el("textarea.ffield", {
        rows: "3",
        "aria-label": label(f),
        placeholder: f.placeholder ?? "",
        oninput: () => {
          answers[f.id] = {
            type: f.type,
            text: field.value,
            edited: field.value !== f.initialText,
          };
          drawFoot();
        },
      });
      field.value = a.text;
      if (f.maxLength) field.setAttribute("maxlength", String(f.maxLength));
      return [field];
    }
    return [
      el(
        "div.seg2",
        ...[true, false].map((yes) =>
          el(
            `button.btn${a?.value === yes ? ".fill" : ""}`,
            {
              type: "button",
              "data-option": yes ? "yes" : "no",
              "aria-pressed": a?.value === yes ? "true" : "false",
              onclick: () => set(f, { type: f.type, value: yes }),
            },
            yes ? "Yes" : "No",
          ),
        ),
      ),
    ];
  }

  const foot = el("div.fsend");
  const body = el("div.fbody");

  function drawFoot() {
    const missing = fields.filter((f) => !answered(f, answers[f.id]));
    const first = missing[0];
    fill(
      foot,
      el(
        "div.fmeta",
        `${fields.length - missing.length} of ${fields.length} answered`,
        first
          ? [
              " · ",
              el(
                "button.link",
                {
                  type: "button",
                  onclick: () =>
                    blocks.get(first.id)?.scrollIntoView({ block: "center" }),
                },
                `Question ${fields.indexOf(first) + 1} ${NEEDS[first.type]}`,
              ),
            ]
          : null,
      ),
      line ? el(`p.dock-line${line.bad ? ".bad" : ""}`, line.text) : null,
      el(
        "button.btn.fill.wide",
        {
          type: "button",
          "data-action": "form.answer",
          disabled: busy || missing.length > 0,
          onclick: send,
        },
        busy ? "Sending…" : "Send answers",
      ),
    );
  }

  function drawSheet() {
    fill(
      body,
      ...fields.map((f, k) => {
        const b = el(
          "div.fq",
          { "data-field": f.id },
          el("div.lab", el("span.num", String(k + 1)), label(f)),
          f.description ? el("div.help", String(f.description)) : null,
          el("div.help", HELP[f.type]),
          ...control(f),
        );
        blocks.set(f.id, b);
        return b;
      }),
    );
    drawFoot();
  }

  fill(
    sheet,
    el(
      "div.formhead",
      el(
        "button.sb",
        {
          type: "button",
          "aria-label": "Close",
          onclick: () => {
            open = false;
            draw();
          },
        },
        icon(GLYPHS.x, 20),
      ),
      el("div.ft", title, el("small", `${count} · ${v.name()}`)),
    ),
    p.body.intro ? el("p.fintro", String(p.body.intro)) : null,
    body,
    foot,
  );

  async function send() {
    v.ctx.haptic("impact");
    busy = true;
    line = null;
    drawFoot();
    let r;
    try {
      r = await v.ctx.ask("form.answer", {
        session: v.params.session,
        promptId: p.promptId,
        answers: JSON.stringify(answers),
      });
    } catch (e) {
      r = e;
    }
    busy = false;
    if (r?.ok) {
      open = false;
      line = {
        text: r.d.cleared
          ? "Sent."
          : "Sent, but the session still waits on it. Answer on the PC.",
      };
      draw();
      v.reload();
      return;
    }
    line = { text: `Not sent: ${v.why(r)}`, bad: true };
    drawFoot();
    if (r?.err === "no-prompt") v.reload();
  }

  function draw() {
    drawCard();
    if (open) drawSheet();
  }
  draw();
  return box;
}
