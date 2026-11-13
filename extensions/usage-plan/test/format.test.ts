// How the session pace is worked out, and how time spans are worded.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  WEEK_MS,
  elapsedPercent,
  extraLimits,
  failureLine,
  paceHours,
  sessionPace,
  span,
  weekForecast,
  weekTone,
  when,
} from "../src/format.ts";
import type { Pace, Plan } from "../src/format.ts";

const plan = (_: unknown[], average: Pace | null = null): Plan => ({
  status: "ok",
  week: {
    used: 30,
    resets: "2026-10-08T02:00:00.000Z",
    rolled: false,
    budget: 12,
    average,
    recent: null,
  },
});

const cases: [string, () => void][] = [
  [
    "session pace: 40% left over 2 hours is 20% an hour, next to the pace now",
    () =>
      assert.deepEqual(
        sessionPace(
          {
            status: "ok",
            five: {
              open: true,
              used: 60,
              resets: "2026-10-03T04:00:00.000Z",
              perHour: 31.26,
              atReset: 122.5,
              full: "2026-10-03T03:17:00.000Z",
            },
          },
          Date.parse("2026-10-03T02:00:00.000Z"),
        ),
        {
          budget: 20,
          perHour: 31.3,
          atReset: 122.5,
          full: "2026-10-03T03:17:00.000Z",
        },
      ),
  ],
  [
    "session pace: nothing while no window is open",
    () =>
      assert.equal(
        sessionPace({ status: "ok", five: { open: false } }, 0),
        null,
      ),
  ],
  [
    "errors: a kill, a crash or silence gives the plain sentence, a real last line stays",
    () =>
      assert.deepEqual(
        [
          failureLine('Command failed: node -e "x"', "plain"),
          failureLine("boom\nNode.js v24.13.0\n", "plain"),
          failureLine("", "plain"),
          failureLine("no such log", "plain"),
        ],
        ["plain", "plain", "plain", "no such log"],
      ),
  ],
  [
    "spans",
    () =>
      assert.deepEqual(
        [span(130 * 3_600_000), span(125 * 60_000), span(12 * 60_000)],
        ["5 d 10 h", "2 h 5 m", "12 m"],
      ),
  ],
  [
    "tone",
    () =>
      assert.deepEqual(
        [
          weekTone(
            plan([], {
              perDay: 20,
              atReset: 150,
              full: "2026-10-05T00:00:00.000Z",
            }),
          ),
          weekTone(plan([], { perDay: 13, atReset: 95, full: null })),
          weekTone(plan([], { perDay: 8, atReset: 60, full: null })),
        ],
        ["error", "warning", "success"],
      ),
  ],
  [
    'spans: spaced like the plain sentence "6 d 8 h left"',
    () => assert.equal(span(152 * 3_600_000), "6 d 8 h"),
  ],
  [
    "tick: how much of the week has passed, in whole percent, kept inside the bar",
    () => {
      const resets = "2026-11-12T02:00:00.000Z";
      const at = (h: number) => Date.parse(resets) - h * 3_600_000;
      assert.deepEqual(
        [
          elapsedPercent(resets, WEEK_MS, at(152)),
          elapsedPercent(resets, WEEK_MS, at(168)),
          elapsedPercent(resets, WEEK_MS, at(200)),
          elapsedPercent(resets, WEEK_MS, at(-5)),
        ],
        [10, 0, 0, 100],
      );
    },
  ],
  [
    "pace basis: the average says its hours through the used share, the recent pace says its own",
    () => {
      const base = {
        status: "ok",
        week: {
          used: 11,
          resets: "2026-11-12T02:00:00.000Z",
          rolled: false,
          budget: 13,
          average: { perDay: 41.1, perHour: 1.711, atReset: 287, full: null },
          recent: { perDay: 41, atReset: 289, full: null, hours: 6 },
        },
      } as Plan;
      assert.equal(paceHours(base), 6);
      assert.equal(
        paceHours({ ...base, week: { ...base.week!, average: null } }),
        6,
      );
      assert.equal(
        paceHours({
          ...base,
          week: { ...base.week!, average: null, recent: null },
        }),
        null,
      );
    },
  ],
  [
    "forecast: runs out with the time before the reset, ends near with its tone, new week",
    () => {
      const w = (average: Pace | null, rolled = false) =>
        ({
          status: "ok",
          week: {
            used: 30,
            resets: "2026-10-08T02:00:00.000Z",
            rolled,
            budget: 12,
            average,
            recent: null,
          },
        }) as Plan;
      assert.deepEqual(
        weekForecast(
          w({ perDay: 20, atReset: 150, full: "2026-10-05T00:00:00.000Z" }),
        ),
        {
          kind: "runsOut",
          full: "2026-10-05T00:00:00.000Z",
          before:
            Date.parse("2026-10-08T02:00:00.000Z") -
            Date.parse("2026-10-05T00:00:00.000Z"),
        },
      );
      assert.deepEqual(
        weekForecast(w({ perDay: 13, atReset: 95, full: null })),
        { kind: "ends", percent: 95, tone: "warning" },
      );
      assert.deepEqual(
        weekForecast(w({ perDay: 8, atReset: 60, full: null })),
        { kind: "ends", percent: 60, tone: "success" },
      );
      assert.deepEqual(weekForecast(w(null, true)), { kind: "new" });
      assert.equal(weekForecast(w(null)), null);
    },
  ],
  [
    "extra limits: per-model lines when the reading has them, none otherwise",
    () => {
      assert.deepEqual(extraLimits({ status: "ok" }), []);
      assert.deepEqual(
        extraLimits({
          status: "ok",
          models: [{ model: "Fable", u: 5, r: "2026-11-06T01:59:00.000Z" }],
        }),
        [{ name: "Fable", used: 5, resets: "2026-11-06T01:59:00.000Z" }],
      );
    },
  ],
  [
    "times: 24-hour weekday and clock, no am/pm",
    () => assert.match(when("2026-11-11T20:22:00"), /20:22/),
  ],
  [
    'copy: no "% of time" and no 5-hour wording outside the window block',
    () => {
      const strings = fs.readFileSync(
        new URL("../src/strings.ts", import.meta.url),
        "utf8",
      );
      assert.ok(!/% of time/.test(strings));
      assert.deepEqual(strings.match(/5.hour|5 hours|5 часов/gi)?.length, 4); // english: five, tickFive; russian: five, tickFive
      assert.ok(
        !/5-hour/.test(
          fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
        ),
      );
    },
  ],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
process.exitCode = failed ? 1 : 0;
