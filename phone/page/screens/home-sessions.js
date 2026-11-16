// Home's session groups (DS1 section 3): Needs you (order 30) above Working (order 40), from home.sessions. With
// Nimbalyst closed or the PC out of reach both give way to one "Last known" group: the last answer the page kept,
// in grey, opening nothing. A row opens its session once the session screen is in the build; until then it has no
// chevron, as a row without one opens nothing.
import { el } from "../frame/dom.js";
import { hasScreen, registerHomePart } from "../frame/screens.js";
import { hhmm } from "./home.js";

export const KIND = {
  question: "1 question",
  permission: "permission",
  plan: "plan to approve",
  form: "form",
  "on-pc": "answer on the PC",
};

export function age(since, now = Date.now()) {
  const m = Math.floor((now - new Date(since).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / (24 * 60))}d`;
}

// "live", "closed" (Nimbalyst not open), "pc-off" (no link to the PC) or null (nothing to show).
function modeOf(ctx) {
  const { kept, fresh } = ctx.home;
  if (!ctx.connected) return kept.sessions ? "pc-off" : null;
  if (!fresh) return null;
  if (kept.status.nimbalyst !== "open") return kept.sessions ? "closed" : null;
  if (!ctx.offered("home.sessions") || !kept.sessions) return null;
  return "live";
}

const chev = () => el("i.chev", { "aria-hidden": "true" });

function row(ctx, item, { cls, mark, meta, right }) {
  const opens = hasScreen("session");
  const props = opens
    ? {
        role: "button",
        tabindex: "0",
        "data-session": item.session,
        onclick: () =>
          ctx.go("session", { session: item.session, project: item.project }),
      }
    : { "data-session": item.session };
  return el(
    `div.row.${cls}`,
    props,
    el(`span.orb.${mark}`, { "aria-hidden": "true" }),
    el("div.row-text", el("div.name", item.title), el("div.meta", meta)),
    el("div.right", right, opens ? chev() : null),
  );
}

function group(head, count, block, foot) {
  return el(
    "div.group",
    el("div.g-head", head, count !== null ? el("span.n", String(count)) : null),
    block,
    foot,
  );
}

const projectOf = (ctx, item) => ctx.home.kept.names?.[item.project] ?? null;

// The meta line's parts with " · " between them; parts may be elements.
const joined = (parts) =>
  parts.filter(Boolean).flatMap((p, i) => (i ? [" · ", p] : [p]));

function renderNeeds(ctx) {
  const mode = modeOf(ctx);
  if (mode === "closed" || mode === "pc-off") return lastKnown(ctx, mode);
  if (mode !== "live") return null;
  const items = ctx.home.kept.sessions.needsYou;
  if (!items.length)
    return group(
      "Needs you",
      null,
      el(
        "div.block",
        el(
          "div.empty",
          "Nothing needs you. When a session asks you something, it shows here and the bot tells you.",
        ),
      ),
    );
  return group(
    "Needs you",
    items.length,
    el(
      "div.block.needs-block",
      items.map((s) =>
        row(ctx, s, {
          cls: "needs",
          mark: "listen",
          meta: joined([
            projectOf(ctx, s),
            el("span.w", KIND[s.kind] ?? s.kind),
          ]),
          right: age(s.since),
        }),
      ),
    ),
  );
}

function renderWorking(ctx) {
  if (modeOf(ctx) !== "live") return null;
  const { working, finishedToday } = ctx.home.kept.sessions;
  const block = working.length
    ? el(
        "div.block",
        working.map((s) =>
          row(ctx, s, {
            cls: "running",
            mark: "think",
            meta: joined([
              projectOf(ctx, s),
              s.doing ? el("span.w", s.doing) : null,
              s.helpers
                ? `${s.helpers} helper${s.helpers === 1 ? "" : "s"}`
                : null,
            ]),
            right: age(s.since),
          }),
        ),
      )
    : el(
        "div.block",
        el("div.empty", "Nothing working. Start a session from a project."),
      );
  const words = `${finishedToday} finished today`;
  const foot = hasScreen("finished")
    ? el(
        "div.g-link-row",
        { role: "button", tabindex: "0", onclick: () => ctx.go("finished") },
        words,
        chev(),
      )
    : el("div.g-foot", words);
  return group("Working", working.length || null, block, foot);
}

// The kept sessions, grey, with their state word and the time the page last saw them; they open nothing.
function lastKnown(ctx, mode) {
  const { sessions, sessionsAt } = ctx.home.kept;
  const items = [
    ...sessions.needsYou.map((s) => ({
      ...s,
      word: "Needs you",
      mark: "listen",
    })),
    ...sessions.working.map((s) => ({ ...s, word: "Working", mark: "think" })),
  ];
  const foot =
    mode === "closed"
      ? "Start Nimbalyst and these sessions come back where they were."
      : "Answers and new sessions need the PC on.";
  return el(
    "div.group",
    el("div.g-head", "Last known", el("span.n", `as of ${hhmm(sessionsAt)}`)),
    el(
      "div.block",
      items.length
        ? items.map((s) =>
            el(
              "div.row.muted",
              { "data-session": s.session },
              el(`span.orb.was.${s.mark}`, { "aria-hidden": "true" }),
              el(
                "div.row-text",
                el("div.name", s.title),
                el("div.meta", joined([projectOf(ctx, s), s.word])),
              ),
              el("div.right", hhmm(sessionsAt)),
            ),
          )
        : el("div.empty", "Nothing needed you or was working."),
    ),
    el("div.g-foot", foot),
  );
}

registerHomePart({ id: "needs-you", order: 30, render: renderNeeds });
registerHomePart({ id: "working", order: 40, render: renderWorking });
