// The four folds under the page top (tracker one-page design 3.7, second and third pass, which win): Needs you,
// Running, To do, Done, in that order, each its own panel with a hairline border and a 16/600 heading with its count.
// Needs you sits on the needs tint with a filled count pill. Needs you, Running and To do are open at start, Done is
// closed; a click on a heading opens or closes its fold. An empty fold is its heading with "0" and its sentence on
// the same line, no chevron. Done shows its newest rows first, the dropped ones last and muted, and the first
// DONE_SHOWN of them behind "Show N more". The folds and counts are model.js foldsOf's; the rows are row.js's.

import { fillIn, renderRow, rowView } from "./row.js";

const ORDER = ["needs", "running", "todo", "done"];

// Done shows this many rows, then "Show N more"
const DONE_SHOWN = 20;

/** A step's stage name, trimmed; "" when it has none. */
const stageText = (r) =>
  String((r.item.customFields && r.item.customFields.stage) || "").trim();

/**
 * To do's row views under stage headings (user, 2026-11-23: steps come in stages): when any row has a stage, the
 * first row of each stage carries `stageHead` (the stage name, or S.otherStage for rows with none) and no row shows
 * the stage again as its plan chip. With no stages at all, the rows are as rowView draws them.
 */
function staged(S, rows, ctx) {
  const views = rows.map((r) =>
    rowView(S, r, { ...ctx, session: ctx.sessionOf(r.item.id) }),
  );
  if (!rows.some((r) => stageText(r))) return views;
  let last = null;
  return views.map((v, i) => {
    const name = stageText(rows[i]) || S.otherStage;
    const head = name !== last ? name : null;
    last = name;
    return { ...v, plan: null, stageHead: head };
  });
}

/**
 * The folds' view for `folds` (model.js foldsOf). `ui`: open (the set of open folds) and doneAll (the Done fold's
 * rows all shown). `ctx`: open, now and sessionOf(id) (the row's session or null), as row.js rowView takes them.
 */
function foldsView(S, folds, ui, ctx) {
  return ORDER.map((key) => {
    const rows = folds[key];
    const shown =
      key === "done" && !ui.doneAll ? rows.slice(0, DONE_SHOWN) : rows;
    return {
      key,
      word: S.folds[key],
      count: rows.length,
      empty: rows.length ? null : S.foldEmpty[key],
      open: rows.length > 0 && ui.open.has(key),
      rows:
        key === "todo"
          ? staged(S, shown, ctx)
          : shown.map((r) =>
              rowView(S, r, { ...ctx, session: ctx.sessionOf(r.item.id) }),
            ),
      more:
        shown.length < rows.length
          ? fillIn(S.showMore, { n: rows.length - shown.length })
          : null,
    };
  });
}

/**
 * Draws the folds as one <div class="rt-folds">. `on`: toggle(key), more() (Done's rows all shown), and item(id),
 * file(path) and session(id) for the rows (row.js renderRow).
 */
function renderFolds(doc, view, on) {
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const box = el("div", "rt-folds");
  for (const f of view) {
    const fold = el("section", `rt-fold rt-fold-${f.key}`);
    fold.dataset.fold = f.key;
    const bodyId = `rt-fold-body-${f.key}`;
    const head = el(f.empty ? "div" : "button", "rt-fold-head");
    const h = el("h2", "rt-fold-title");
    head.append(
      el("span", "rt-fold-word", f.word),
      el("span", "rt-count", String(f.count)),
    );
    if (f.empty) {
      fold.classList.add("rt-fold-empty");
      head.append(el("span", "rt-fold-hint", f.empty));
    } else {
      head.type = "button";
      head.setAttribute("aria-expanded", String(f.open));
      head.setAttribute("aria-controls", bodyId);
      head.append(el("span", "rt-chev"));
      head.addEventListener("click", () => on.toggle(f.key));
    }
    h.append(head);
    fold.append(h);
    if (!f.empty) {
      const body = el("div", "rt-fold-body");
      body.id = bodyId;
      body.hidden = !f.open;
      for (const r of f.rows) {
        if (r.stageHead) body.append(el("h3", "rt-stage", r.stageHead));
        body.append(renderRow(doc, r, on));
      }
      if (f.more) {
        const more = el("button", "rt-more", f.more);
        more.type = "button";
        more.addEventListener("click", () => on.more());
        body.append(more);
      }
      fold.append(body);
    }
    box.append(fold);
  }
  return box;
}

export { DONE_SHOWN, foldsView, ORDER, renderFolds };
