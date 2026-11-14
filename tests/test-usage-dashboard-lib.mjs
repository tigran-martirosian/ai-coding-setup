// Tests for skills/setup-audit/scripts/usage-dashboard-lib.mjs (number logic of the usage
// dashboard) and for the build writing usage-dashboard.json next to the page.
// Run: node tests/test-usage-dashboard-lib.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPTS = fileURLToPath(
  new URL("../skills/setup-audit/scripts", import.meta.url),
);
const L = await import(
  pathToFileURL(path.join(SCRIPTS, "usage-dashboard-lib.mjs")).href
);
let n = 0;
const test = (name, f) => {
  f();
  n++;
  console.log("ok  " + name);
};

test("esc escapes html characters", () => {
  assert.equal(
    L.esc(`<a href="x">&'`),
    "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
  );
  assert.equal(L.esc(null), "");
});
test("fmt", () => {
  assert.deepEqual(
    [0, 999, 1500, 1_234_567, 12_345_678, 2_500_000_000].map(L.fmt),
    ["0", "999", "2k", "1.23M", "12.3M", "2.50B"],
  );
});
test("pct, plural, sum, pad", () => {
  assert.equal(L.pct(1, 3), "33%");
  assert.equal(L.pct(1, 0), "0%");
  assert.equal(L.plural(1, "chat"), "1 chat");
  assert.equal(L.plural(2, "chat"), "2 chats");
  assert.equal(
    L.sum([{ v: 1 }, { v: 4 }], (x) => x.v),
    5,
  );
  assert.equal(L.pad(7), "07");
});
test("dayKey uses local date", () => {
  assert.equal(L.dayKey(new Date(2026, 10, 5, 23, 59)), "2026-11-05");
});
test("date formatters return text", () => {
  assert.match(L.fmtDay("2026-11-05"), /5/);
  assert.equal(L.fmtTime(""), "");
  assert.match(L.fmtTime("2026-11-05T12:00:00Z"), /\d/);
  assert.match(L.fmtWhen("2026-11-05T12:00:00Z"), /\d/);
});
test("modelName, topModel, leaf", () => {
  assert.equal(L.modelName("claude-opus-5-5-20261001"), "opus-5-5");
  assert.equal(L.topModel({ "claude-a": 1, "claude-b": 9 }), "b");
  assert.equal(L.topModel(undefined), "");
  assert.equal(L.leaf("C:\\Projects\\demo\\"), "demo");
  assert.equal(L.leaf("/a/b/c"), "c");
  assert.equal(L.leaf(null), "");
});
test("fmtUsd, pts", () => {
  assert.equal(L.fmtUsd(5), "$5.00");
  assert.equal(L.fmtUsd(1234.5), "$1,235");
  assert.deepEqual([12.4, 3, 3.26].map(L.pts), ["12", "3", "3.3"]);
});
test("niceMax", () => {
  assert.deepEqual([0.9, 1.5, 2.2, 3, 7].map(L.niceMax), [1, 2, 2.5, 5, 10]);
});
test("flat sums models per day", () => {
  assert.deepEqual(
    L.flat({ "2026-11-01": { a: 1, b: 2 }, "2026-11-02": { a: 5 } }),
    { "2026-11-01": 3, "2026-11-02": 5 },
  );
  assert.deepEqual(L.flat(undefined), {});
});

// fixture: two chats, one subagent, one codex session, one gemini conversation, around "now"
const now = new Date(2026, 10, 5, 12, 0, 0);
const d0 = L.dayKey(now),
  d1 = L.dayKey(new Date(2026, 10, 4, 12)),
  d2 = L.dayKey(new Date(2026, 10, 3, 12));
const mk = () => ({
  sessions: [
    {
      id: "s1abcdef",
      title: "Alpha chat",
      name: "",
      project: "p1",
      days: { [d1]: { m: 100 }, [d0]: { m: 50 } },
      usd: { [d0]: 1.5 },
      subagents: [
        { type: "worker", days: { [d0]: { m: 25 } }, usd: { [d0]: 0.5 } },
      ],
      workers: [
        {
          worker: "codex",
          at: new Date(2026, 10, 5, 9).toISOString(),
          what: "w",
          tokens: 7,
          processes: 1,
          ok: true,
        },
      ],
    },
    {
      id: "s2abcdef",
      title: "Beta",
      name: "",
      project: "p2",
      days: { [d2]: { m: 10 } },
      subagents: [],
      workers: [],
    },
  ],
  codex: {
    sessions: [
      {
        id: "c1",
        title: "Direct",
        cwd: "C:\\x\\proj",
        at: new Date(2026, 10, 5, 8).toISOString(),
        origin: "",
        tokens: 9,
      },
    ],
  },
  gemini: {
    conversations: [
      {
        id: "g1",
        title: "Gem",
        folder: "f",
        at: new Date(2026, 10, 4, 8).toISOString(),
        steps: 3,
      },
    ],
  },
});
const D = mk();
const allDays = L.prepareData(D, now);

test("prepareData fills dayTot, day and returns days up to today", () => {
  assert.deepEqual(allDays, [d2, d1, d0]);
  assert.deepEqual(D.sessions[0].dayTot, { [d1]: 100, [d0]: 50 });
  assert.deepEqual(D.sessions[0].subagents[0].dayTot, { [d0]: 25 });
  assert.equal(D.sessions[0].workers[0].day, d0);
  assert.equal(D.codex.sessions[0].day, d0);
  assert.equal(D.gemini.conversations[0].day, d1);
});
test("rangeDaysOf", () => {
  assert.deepEqual(L.rangeDaysOf(allDays, 1), [d0]);
  assert.deepEqual(L.rangeDaysOf(allDays, 2), [d1, d0]);
  assert.deepEqual(L.rangeDaysOf(allDays, "all"), allDays);
});
test("tok and usd count only days in the range", () => {
  const s = D.sessions[0];
  assert.equal(L.tok(s, new Set([d0])), 50);
  assert.equal(L.tok(s, new Set([d0, d1])), 150);
  assert.equal(L.usd(s, new Set([d0])), 1.5);
  assert.equal(L.usd(s, new Set([d1])), 0);
});
test("chatRows filters by range, project, type and search", () => {
  const all = new Set(allDays),
    today = new Set([d0]);
  const none = { project: null, type: null, q: "" };
  const r = L.chatRows(D.sessions, all, none);
  assert.deepEqual(
    r.map((x) => [x.s.id, x.main, x.sub, x.total]),
    [
      ["s1abcdef", 150, 25, 175],
      ["s2abcdef", 10, 0, 10],
    ],
  );
  assert.equal(r[0].usd, 2);
  assert.deepEqual(
    L.chatRows(D.sessions, today, none).map((x) => x.s.id),
    ["s1abcdef"],
  );
  assert.deepEqual(
    L.chatRows(D.sessions, all, { ...none, project: "p2" }).map((x) => x.s.id),
    ["s2abcdef"],
  );
  assert.deepEqual(
    L.chatRows(D.sessions, all, { ...none, type: "worker" }).map((x) => x.s.id),
    ["s1abcdef"],
  );
  assert.deepEqual(
    L.chatRows(D.sessions, all, { ...none, q: "beta" }).map((x) => x.s.id),
    ["s2abcdef"],
  );
  // skip ignores one filter
  assert.equal(
    L.chatRows(D.sessions, all, { ...none, project: "p2" }, "project").length,
    2,
  );
  assert.equal(
    L.chatRows(D.sessions, all, { ...none, type: "worker" }, "type").length,
    2,
  );
});
test("codexRunsOf joins claude-started runs and direct sessions, newest first", () => {
  const days = new Set(allDays);
  const rs = L.chatRows(D.sessions, days, { project: null, type: null, q: "" });
  const runs = L.codexRunsOf(rs, D.codex.sessions, days, "");
  assert.deepEqual(
    runs.map((r) => [r.what, r.from, r.direct ?? false]),
    [
      ["w", "Alpha chat", false],
      ["Direct", "Codex", true],
    ],
  );
  assert.equal(L.codexRunsOf(rs, D.codex.sessions, days, "nomatch").length, 1);
  assert.equal(
    L.codexRunsOf(rs, D.codex.sessions, new Set([d2]), "").length,
    0,
  );
});
test("geminiRunsOf filters by day and search", () => {
  assert.equal(
    L.geminiRunsOf(D.gemini.conversations, new Set([d1]), "").length,
    1,
  );
  assert.equal(
    L.geminiRunsOf(D.gemini.conversations, new Set([d0]), "").length,
    0,
  );
  assert.equal(
    L.geminiRunsOf(D.gemini.conversations, new Set([d1]), "zzz").length,
    0,
  );
});
test("planFor sums days and clamps", () => {
  const P = {
    days: {
      a: { total: 10, other: 4, idle: 1 },
      b: { total: 5, other: 9, idle: 0 },
      c: { total: 99, other: 0, idle: 0 },
    },
  };
  const t = L.planFor(P, new Set(["a", "b"]));
  assert.deepEqual(
    [t.total, t.other, t.idle, t.mine, t.any],
    [15, 13, 1, 2, true],
  );
  assert.equal(L.planFor({ status: "none" }, new Set(["a"])).any, false);
  assert.equal(
    L.planFor(
      { days: { a: { total: -1, other: -1, idle: 0 } } },
      new Set(["a"]),
    ).total,
    0,
  );
});
test("otherTokensFor hides the estimate when not shared, not ok or filtered", () => {
  const P = { status: "ok", tokensPerPoint: 1000, days: { a: { other: 2 } } };
  assert.equal(L.otherTokensFor(P, true, false, "a"), 2000);
  assert.equal(L.otherTokensFor(P, false, false, "a"), 0);
  assert.equal(L.otherTokensFor(P, true, true, "a"), 0);
  assert.equal(L.otherTokensFor({ status: "none" }, true, false, "a"), 0);
  assert.equal(L.otherTokensFor(P, true, false, "zz"), 0);
});

// plan weeks fixture (ms times); Oct 22-26 and Oct 26-29 share the end of the old window
const T = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const W = (start, end, o = {}) => ({
  start,
  end,
  first: start,
  last: end,
  samples: 10,
  total: 50,
  mine: 20,
  other: 30,
  idle: 2,
  partial: false,
  era: 1,
  ...o,
});
const wNow = new Date(2026, 10, 6, 12);
const weeks = [
  W(T(2026, 10, 29, 20), T(2026, 11, 5, 20), {
    total: 99,
    mine: null,
    other: null,
  }),
  W(T(2026, 10, 26, 20), T(2026, 10, 29, 20)),
  W(T(2026, 10, 22, 20), T(2026, 10, 26, 20)),
  W(T(2026, 10, 15, 20), T(2026, 10, 22, 20), {
    partial: true,
    first: T(2026, 10, 16, 20),
  }),
];
test("weekRanges labels, keys and titles", () => {
  const r = L.weekRanges({ weeks }, new Date(2026, 10, 3, 12));
  assert.deepEqual(
    r.map((x) => x.label),
    ["This week", "Last week", "Oct 22 – 26", "Oct 15 – 22"],
  );
  assert.equal(new Set(r.map((x) => x.key)).size, 4);
  assert.match(r[0].title, /Oct/);
  assert.match(r[0].title, /Nov/);
  assert.deepEqual(
    L.weekRanges({ weeks }, wNow)
      .map((x) => x.label)
      .slice(0, 2),
    ["Last week", "Oct 26 – 29"],
  );
  assert.equal(
    L.weekRanges({ weeks: Array(9).fill(weeks[3]) }, wNow).length,
    6,
  );
});
test("weekRanges: 'Last week' is the week before the newest reset, not a cut part or an old week", () => {
  const cutWeeks = [
    W(T(2026, 10, 26, 8), T(2026, 10, 29, 20)),
    W(T(2026, 10, 22, 20), T(2026, 10, 29, 20), { stop: T(2026, 10, 26, 8) }),
    W(T(2026, 10, 15, 20), T(2026, 10, 22, 20)),
  ];
  assert.deepEqual(
    L.weekRanges({ weeks: cutWeeks }, new Date(2026, 9, 27, 12)).map(
      (x) => x.label,
    ),
    ["This week", "Oct 22 – 26", "Last week"],
  );
  assert.deepEqual(
    L.weekRanges({ weeks: cutWeeks }, new Date(2026, 9, 30, 12)).map(
      (x) => x.label,
    ),
    ["Last week", "Oct 22 – 26", "Oct 15 – 22"],
  );
  assert.deepEqual(
    L.weekRanges(
      { weeks: [W(T(2026, 10, 1, 20), T(2026, 10, 8, 20))] },
      wNow,
    ).map((x) => x.label),
    ["Oct 1 – 8"],
  );
});
test("weekRanges is empty without weeks", () => {
  assert.deepEqual(L.weekRanges({ status: "none" }, wNow), []);
  assert.deepEqual(L.weekRanges({ weeks: [] }, wNow), []);
  assert.deepEqual(L.weekRanges(undefined, wNow), []);
});
test("weekNote and partial notes", () => {
  assert.equal(L.weekNote(weeks[0]), "Oct 29 – Nov 5, 99% used");
  assert.equal(
    L.weekNote(weeks[3]),
    "Oct 15 – 22, 50% used, recorded from Oct 16",
  );
  assert.equal(
    L.weekNote(
      W(T(2026, 10, 15, 20), T(2026, 10, 22, 20), {
        partial: true,
        last: T(2026, 10, 18, 20),
      }),
    ),
    "Oct 15 – 22, 50% used, recorded until Oct 18",
  );
});
test("weekDaysOf uses local noon in [start, end)", () => {
  const days = [
    "2026-10-25",
    "2026-10-26",
    "2026-10-27",
    "2026-10-29",
    "2026-10-30",
  ];
  assert.deepEqual(L.weekDaysOf(days, weeks[2]), ["2026-10-25", "2026-10-26"]);
  assert.deepEqual(L.weekDaysOf(days, weeks[1]), ["2026-10-27", "2026-10-29"]);
  assert.deepEqual(
    L.weekDaysOf(days, {
      start: T(2026, 10, 26, 12),
      end: T(2026, 10, 27, 12),
    }),
    ["2026-10-26"],
  );
});
test("a window cut by an early reset ends at its stop, not its end", () => {
  const days = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
  const cut = {
    start: T(2026, 10, 22, 0),
    end: T(2026, 10, 29, 0),
    stop: T(2026, 10, 26, 6),
    total: 98,
    first: T(2026, 10, 22, 0),
    last: T(2026, 10, 26, 5),
    partial: false,
  };
  assert.deepEqual(L.weekDaysOf(days, cut), ["2026-10-24", "2026-10-25"]);
  assert.equal(L.weekSpan(cut), "Oct 22 – 26");
});
test("rangeDaysOf with a week key", () => {
  const days = ["2026-10-25", "2026-10-26", "2026-10-27"];
  assert.deepEqual(
    L.rangeDaysOf(days, L.weekRanges({ weeks }, wNow)[2].key, { weeks }),
    ["2026-10-25", "2026-10-26"],
  );
  assert.deepEqual(L.rangeDaysOf(days, 2, { weeks }), [
    "2026-10-26",
    "2026-10-27",
  ]);
  assert.throws(() => L.rangeDaysOf(days, "w1", { weeks }));
});
test("planFor with a week is exact, without it sums days", () => {
  const t = L.planFor(
    { days: { a: { total: 1, other: 0, idle: 0 } } },
    new Set(["a"]),
    weeks[1],
  );
  assert.deepEqual(
    [t.total, t.mine, t.other, t.idle, t.split],
    [50, 20, 30, 2, true],
  );
  const u = L.planFor({}, new Set(), weeks[0]);
  assert.deepEqual([u.total, u.split], [99, false]);
  assert.equal(
    L.planFor({ days: { a: { total: 1, other: 0, idle: 0 } } }, new Set(["a"]))
      .total,
    1,
  );
});

// the build: empty transcripts folder, so it is fast; checks the page and the JSON
test("build inlines the lib and writes usage-dashboard.json with builtAt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-dash-test-"));
  const root = path.join(dir, "projects"),
    empty = path.join(dir, "empty");
  fs.mkdirSync(root);
  fs.mkdirSync(empty);
  const out = path.join(dir, "reports", "usage-dashboard.html");
  const run = () =>
    execFileSync(
      process.execPath,
      [
        path.join(SCRIPTS, "usage-dashboard.mjs"),
        "--no-open",
        "--days",
        "7",
        "--root",
        root,
        "--out",
        out,
        "--codex",
        empty,
        "--gemini",
        empty,
        "--plan",
        path.join(dir, "none.jsonl"),
        "--ahead",
        path.join(dir, "none.json"),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: dir, USERPROFILE: dir },
      },
    );
  run();
  const html = fs.readFileSync(out, "utf8");
  assert.ok(
    html.includes("function chatRows(") && html.includes("const fmt = "),
    "lib inlined",
  );
  assert.ok(
    !html.includes("/*__LIB__*/") &&
      !html.includes("__DATA__") &&
      !/^export /m.test(html),
    "placeholders and exports gone",
  );
  const jsonFile = path.join(dir, "reports", "usage-dashboard.json");
  const j = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  assert.ok(!Number.isNaN(Date.parse(j.builtAt)), "builtAt is an ISO time");
  for (const k of [
    "generated",
    "computer",
    "sessions",
    "plan",
    "shared",
    "ahead",
    "codex",
    "gemini",
  ])
    assert.ok(k in j, "key " + k);
  run(); // second run: same file name, no temp file left
  assert.deepEqual(fs.readdirSync(path.join(dir, "reports")).sort(), [
    "usage-dashboard.html",
    "usage-dashboard.json",
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${n} tests passed`);
