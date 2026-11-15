// The item view's page script (tracker design, "Item view, second round"). Style does most of the work (style.css,
// "The item view"); this script only marks the body's groups that have no class of their own (`data-ink-part`),
// adds the "More fields" pill at the end of the field pills and the "History and details · N" fold line before the
// activity, keeps the two folds' open state on the view (`data-rt-more`, `data-rt-history`) and says which button
// is the main one (`data-rt-main`). Its marks are data attributes only, so the page watcher (which listens to class
// changes) comes to rest after one pass.
// Structure read from the app's code (Nimbalyst 0.83.0, TrackerItemDetail and its parts):
//   D = [data-testid="tracker-item-detail"]; its header H = .tracker-item-detail-header holds the type icon in
//   `span.mt-1 > .material-symbols-outlined`, then `div.flex-1` (the title textarea and the meta line), then the
//   buttons. The body B = D > div.overflow-y-auto; its direct children, in order: .tracker-sessions-section,
//   div.tracker-detail-fields (holding P = [data-testid="tracker-detail-field-pills"]), .tracker-detail-tags,
//   .tracker-type-tags-editor, the content group (a div with label "Content" and .tracker-content-editor), the
//   linked commits, .tracker-links-section, the comments group (div.space-y-2 with h4 "Comments" and
//   .tracker-comments-section), the activity group (div.space-y-2 with h4 "Activity") and last the "Created by"
//   block (div.pt-1 > div.grid). Several linked sessions are one `button[title^="Open session: "]` each in a
//   div.space-y-1, so the main button is that div's first child.

import { CATEGORY } from "./model.js";

// The rule "Open session is the main button" (design, "The one main button"). Its click is not proven by this
// build (the lead proves it on the live app); if it fails there, set this to false: "Launch Session" is then the
// filled button in every state and the session entry a quiet row.
const OPEN_SESSION_IS_MAIN = true;

const IV = {
  detail: '[data-testid="tracker-item-detail"]',
  body: ":scope > .overflow-y-auto",
  pills: '[data-testid="tracker-detail-field-pills"]',
  comments: ".tracker-comments-section",
  // Ours
  more: "rt-more",
  history: "rt-history",
};

// Open states kept while the window lives (design rows 22 and 32), the same for every item
const ivState = { moreOpen: false, historyOpen: false, doneOpen: false };

/** The part a direct child of the body is, by its own class or its heading text; null when it needs no mark. */
function partOf(child) {
  if (child.querySelector(":scope > .tracker-content-editor")) return "content";
  if (child.querySelector(`:scope > ${IV.comments}`)) return "comments";
  const head = child.querySelector(":scope > h4");
  if (head && head.textContent.trim() === "Activity") return "activity";
  if (child.querySelector(":scope > .grid")) return "created";
  return null;
}

/** Sets an attribute only when it differs, so the page watcher comes to rest. */
function setAttr(el, name, value) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** A quiet button of ours that flips one open state and draws the view again. */
function foldButton(doc, cls, key, redraw) {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = cls;
  b.addEventListener("click", () => {
    ivState[key] = !ivState[key];
    redraw();
  });
  return b;
}

// A Links line with more targets than this is a long list: its finished targets fold behind one "N done" line
const LONG = 6;

/** Item title -> true when finished (done or dropped), false when open, null when two items of that title differ. */
function finishedByTitle(items) {
  const out = new Map();
  for (const i of items) {
    const cat = CATEGORY[i.status];
    const fin = cat === "done" || cat === "dropped";
    out.set(i.title, out.has(i.title) && out.get(i.title) !== fin ? null : fin);
  }
  return out;
}

/**
 * The Links group (design row 28). Each line (`.tracker-links-line`) is [triangle, label, count, targets], each
 * target a `button.tracker-links-page` with its type word and its title (live page, 2026-11-14). Marks: "In
 * collection" toward releases only (`data-rt-label`), the type word "Task" (`data-rt-quiet`), and on a long list
 * the finished targets (`data-rt-done`, found by title in `items`) with one "N done" button after the line's targets.
 */
function drawLinks(doc, detail, S, items, redraw) {
  const finished = finishedByTitle(items);
  for (const line of detail.querySelectorAll(".tracker-links-line")) {
    const label = line.children[1];
    const targets = [...line.querySelectorAll(".tracker-links-page")];
    const types = targets.map((t) =>
      t.firstElementChild ? t.firstElementChild.textContent.trim() : "",
    );
    const toRelease =
      label &&
      label.textContent.trim() === "In collection" &&
      targets.length > 0 &&
      types.every((w) => w === "Release");
    setAttr(line, "data-rt-label", toRelease ? "job" : null);
    targets.forEach((t, k) => {
      if (t.firstElementChild)
        setAttr(
          t.firstElementChild,
          "data-rt-quiet",
          types[k] === "Task" ? "" : null,
        );
    });
    let fold = line.querySelector(":scope > .rt-done-fold");
    const done = targets.filter((t) => {
      const title = t.querySelector(".truncate");
      return title && finished.get(title.textContent.trim()) === true;
    });
    if (targets.length <= LONG || !done.length) {
      for (const t of targets) setAttr(t, "data-rt-done", null);
      setAttr(line, "data-rt-fold", null);
      if (fold) fold.remove();
      continue;
    }
    for (const t of targets)
      setAttr(t, "data-rt-done", done.includes(t) ? "" : null);
    setAttr(line, "data-rt-fold", ivState.doneOpen ? "open" : "closed");
    if (!fold) {
      fold = doc.createElement("button");
      fold.type = "button";
      fold.className = "rt-done-fold";
      // The line itself opens and closes on a click; this button's click is its own
      fold.addEventListener("click", (e) => {
        e.stopPropagation();
        ivState.doneOpen = !ivState.doneOpen;
        redraw();
      });
    }
    if (line.lastElementChild !== fold) line.append(fold);
    const words = S.foldDone.replace("{n}", String(done.length));
    if (fold.textContent !== words) fold.textContent = words;
    setAttr(fold, "aria-expanded", String(ivState.doneOpen));
  }
}

/** Marks and adds our parts in the item view `detail`; `S` holds the words, `items` the tracker items read last. */
function drawItemView(doc, detail, S, items) {
  const redraw = () => drawItemView(doc, detail, S, items);
  drawLinks(doc, detail, S, items, redraw);
  setAttr(detail, "data-rt-main", OPEN_SESSION_IS_MAIN ? "session" : "launch");
  setAttr(detail, "data-rt-more", ivState.moreOpen ? "open" : "closed");
  setAttr(detail, "data-rt-history", ivState.historyOpen ? "open" : "closed");
  const body = detail.querySelector(IV.body);
  if (!body) return;
  let folded = null;
  let entries = 0;
  for (const child of body.children) {
    const part = partOf(child);
    if (part) setAttr(child, "data-ink-part", part);
    if (part === "activity") {
      entries = child.querySelectorAll(":scope > div > div").length;
      folded = folded || child;
    }
    if (part === "created") folded = folded || child;
  }
  // "More fields": one quiet pill at the end of the pills, opening the folded fields in place
  const pills = detail.querySelector(IV.pills);
  if (pills) {
    let more = pills.querySelector(`:scope > .${IV.more}`);
    if (!more) {
      more = foldButton(doc, IV.more, "moreOpen", redraw);
      pills.append(more);
    }
    const label = ivState.moreOpen ? S.fewerFields : S.moreFields;
    if (more.textContent !== label) more.textContent = label;
    setAttr(more, "aria-expanded", String(ivState.moreOpen));
  }
  // "History and details · N": just before the activity (or the "Created by" block), folding both
  let fold = body.querySelector(`:scope > .${IV.history}`);
  if (!folded) {
    if (fold) fold.remove();
    return;
  }
  if (!fold) fold = foldButton(doc, IV.history, "historyOpen", redraw);
  if (fold.nextElementSibling !== folded) folded.before(fold);
  const label = entries
    ? S.historyCount.replace("{n}", String(entries))
    : S.history;
  if (fold.textContent !== label) fold.textContent = label;
  setAttr(fold, "aria-expanded", String(ivState.historyOpen));
}

/** Draws every item view in the page; `items`: the tracker items read last ([] before the first read). */
function drawItemViews(doc, S, items) {
  for (const d of doc.querySelectorAll(IV.detail))
    drawItemView(doc, d, S, items);
}

/** Takes our parts out of every item view. */
function clearItemViews(doc) {
  for (const d of doc.querySelectorAll(IV.detail)) {
    for (const e of d.querySelectorAll(
      `.${IV.more}, .${IV.history}, .rt-done-fold`,
    ))
      e.remove();
    for (const a of [
      "data-ink-part",
      "data-rt-label",
      "data-rt-quiet",
      "data-rt-done",
      "data-rt-fold",
    ])
      for (const e of d.querySelectorAll(`[${a}]`)) e.removeAttribute(a);
    for (const a of ["data-rt-main", "data-rt-more", "data-rt-history"])
      d.removeAttribute(a);
  }
}

export { clearItemViews, drawItemViews, IV, OPEN_SESSION_IS_MAIN, partOf };
