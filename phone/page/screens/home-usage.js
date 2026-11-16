// Home's Usage (DS1 section 3, item 6, and `usage-limit`; plan row C4): this week's percent of the Claude plan as
// the one hero figure, today's use beside it, the usage bar with its labelled "now" tick (how much of the week has
// gone) and when the week starts again. From 85% the figure and the bar turn amber, with when it runs out at this
// pace. The PC reads its own usage log (usage.get), so this shows with Nimbalyst closed too; with the PC out of
// reach the last answer stays, with its "as of" time.
import { el } from "../frame/dom.js";
import { registerHomePart } from "../frame/screens.js";
import { hhmm } from "./home.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const WARN_AT = 85;
// An answer older than this shows its "as of" time (the PC's logger writes at most every 5 minutes)
const STALE_MS = 10 * 60 * 1000;

// The last usage.get answer: { d, error, key, box }, asked once per pc.status answer, as the jobs are.
export const usageKept = { d: null, error: null, key: null, box: null };

// The PC's own words when its answer has them ({ err, message }), else its error word.
const errWord = (r) => r?.message ?? r?.err ?? r?.code ?? "no answer";

const dayTime = (t) =>
  `${new Date(t).toLocaleDateString([], { weekday: "short" })} ${hhmm(t)}`;

/**
 * The block's words and figures from a usage.get answer at `now`: { percent, today, gone, warn, line, runsOut,
 * stale }. `gone` is the share of the week passed (the week ends at resetsAt and is 7 days long); `runsOut` is set
 * from 85% when, at the week's pace so far, the limit is reached before the reset.
 */
export function usageView(d, now = Date.now()) {
  const reset = Date.parse(d.resetsAt);
  const asOf = Date.parse(d.asOf);
  const elapsed = Math.min(WEEK_MS, Math.max(0, now - (reset - WEEK_MS)));
  const gone = Math.round((elapsed / WEEK_MS) * 100);
  const percent = d.weekPercent;
  const warn = percent >= WARN_AT;
  let runsOut = null;
  if (percent >= 100) runsOut = `Limit reached until ${dayTime(reset)}`;
  else if (warn) {
    const used = asOf - (reset - WEEK_MS);
    const at = asOf + ((100 - percent) / percent) * used;
    if (used > 0 && at < reset)
      runsOut = `At this pace it runs out ${dayTime(at)}`;
  }
  const pace = percent <= gone ? "on pace" : "above pace";
  return {
    percent,
    today: d.today,
    gone,
    warn,
    line: `${gone}% of the week gone · resets ${dayTime(reset)}${warn ? "" : ` · ${pace}`}`,
    runsOut,
    stale: now - asOf > STALE_MS ? `as of ${hhmm(asOf)}` : null,
  };
}

function usageBlock(d, offline) {
  const v = usageView(d);
  const fill = el(`div.fill${v.warn ? ".warn" : ""}`);
  fill.style.width = `${Math.min(100, v.percent)}%`;
  const tick = el("div.tick", el("span", "now"));
  tick.style.left = `${v.gone}%`;
  return el(
    "div.block",
    el(
      "div.usage",
      el(
        "div.u-top",
        el(
          `div.u-hero${v.warn ? ".warn" : ""}`,
          `${v.percent}%`,
          el("small", "used"),
        ),
        v.today === null
          ? null
          : el(
              "div.u-today",
              el("div.u-fig", `${v.today}%`),
              el("div.u-cap", "today"),
            ),
      ),
      el("div.ubar", { "aria-hidden": "true" }, fill, tick),
      el("div.u-cap", v.line),
      v.runsOut ? el("div.u-warn", v.runsOut) : null,
      v.stale || offline ? el("div.u-cap", `as of ${hhmm(d.asOf)}`) : null,
    ),
  );
}

function fill(offline) {
  const { box, d, error } = usageKept;
  if (!box) return;
  box.replaceChildren(
    el("div.g-head", "Usage"),
    el("div.g-sub", "Your Claude plan's limit for this week"),
    d
      ? usageBlock(d, offline)
      : el(
          "div.block",
          el(
            "div.empty",
            error ? `Could not read the usage: ${error}` : "Asking the PC…",
          ),
        ),
    ...(d && error
      ? [el("p.err", `Could not read the usage again: ${error}`)]
      : []),
  );
}

async function load(ctx) {
  let r;
  try {
    r = await ctx.ask("usage.get", {});
  } catch (e) {
    r = e;
  }
  if (r?.ok) {
    usageKept.d = r.d;
    usageKept.error = null;
  } else usageKept.error = errWord(r);
  fill(false);
}

function renderUsage(ctx) {
  const { home } = ctx;
  if (!ctx.connected) {
    if (!usageKept.d) return null;
    usageKept.box = el("div.group.usage-g");
    fill(true);
    return usageKept.box;
  }
  if (!home.fresh || !ctx.offered("usage.get")) return null;
  usageKept.box = el("div.group.usage-g");
  const key = home.kept.status.asOf;
  if (usageKept.key !== key) {
    usageKept.key = key;
    load(ctx);
  }
  fill(false);
  return usageKept.box;
}

registerHomePart({ id: "usage", order: 60, render: renderUsage });
