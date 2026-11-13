// Every word of the tour film, in order, and how long each shot lasts. The film follows one job through the setup,
// from the ask to the checked result: you ask, helpers build, every claim is checked, you add notes as it works,
// and you see what it touched and what it cost. Each shot is one step, in one diagram, for about six seconds.
// Lengths are set by hand: a shot lasts as long as its motion needs. `node check-reading.mjs` prints them.
import { LINK } from "./credit.ts";

export const FPS = 60;
/** Timing in the film's code is in ticks, 24 to the second. */
export const TICKS = 24;

/** The chapters, in the order the film reaches them. The opening shot belongs to none. A chapter's shots follow
 * each other: the chapter bar fills one segment per chapter. */
export const PARTS = ["Ask", "Checks", "Steer", "Cost", "Overview", "Install"] as const;
export type Part = (typeof PARTS)[number];

export type Tile = { name: string; note: string };
export type Body =
  | { kind: "open"; lines: string[]; name: string }
  /** A reply, the session log beside it, the line the log lacks, and the reply once the agent has done the step. */
  | { kind: "claim"; reply: string[]; claim: number; fixed: string[]; log: string[]; missing: string; found: string; reason: string }
  /** A plain chat message, under its label, that the planner takes up and splits into steps. */
  | { kind: "lead"; label: string; ask: string; steps: string[]; helper: string; reviewer: string; done: string }
  | { kind: "review"; flaws: string[]; rounds: string[]; clean: string }
  | { kind: "usage"; days: string[]; used: number[]; ahead: number[]; limit: string; forecast: string; note: string }
  | { kind: "map"; parts: string[]; links: [number, number][]; changed: number; check: string }
  | { kind: "btw"; work: string[]; note: string; picked: string }
  | { kind: "compare"; rows: { topic: string; alone: string; setup: string }[] }
  | { kind: "tiles"; tiles: Tile[] }
  | { kind: "install"; code: string; output: string[]; update: string; link: string };

export type Shot = { id: string; part: Part | null; title: string; sub?: string; ticks: number; body: Body };

export const ALONE_LABEL = "Claude Code with a few skills";
export const SETUP_LABEL = "With this setup";

export const REPLY_LABEL = "The agent's reply";
export const LOG_LABEL = "Session log: what it actually did";
export const SENT_BACK = "Sent back";
export const PASSED = "Passed";

/** When the two claim shots turn, in ticks from the shot's start: the wire reaches the log, the reply is sent
 * back, the agent does the step, and the reply passes. */
export const CLAIM_AT = { wire: 14, sent: 46, fixed: 84, passed: 104 } as const;

export const SCRIPT: Shot[] = [
  {
    id: "open",
    part: null,
    title: "AI coding setup for Claude Code",
    ticks: 144,
    body: { kind: "open", lines: ["Coding agents say done when they aren't.", "This setup checks."], name: "AI coding setup for Claude Code" },
  },
  {
    id: "lead",
    part: "Ask",
    title: "Ask for a big change. A planner splits it up.",
    sub: "Helpers build the steps. One reviewer checks the result. (/lead starts it by hand.)",
    ticks: 168,
    body: {
      kind: "lead",
      label: "Your message",
      ask: "Add rate limits to the API",
      steps: ["Find the API routes", "Add the limiter", "Write the tests", "Update the docs"],
      helper: "helper",
      reviewer: "Reviewer",
      done: "Checked",
    },
  },
  {
    id: "verify",
    part: "Checks",
    title: "Every claim is checked against the log",
    sub: "It says the tests pass. The log shows no test run.",
    ticks: 156,
    body: {
      kind: "claim",
      reply: ["Done.", "Tests pass."],
      claim: 1,
      fixed: ["Done.", "Tests pass: 12 of 12."],
      log: ["Read   src/limits.ts", "Edit   src/limits.ts", "Edit   tests/limits.test.ts"],
      missing: "no test run",
      found: "Ran    npm test   12 passed",
      reason: "Run the tests first.",
    },
  },
  {
    id: "link",
    part: "Checks",
    title: "A page it quotes has to be opened",
    sub: "It quotes a page the log shows it never opened.",
    ticks: 156,
    body: {
      kind: "claim",
      reply: ["The docs say the limit", "is 500 a minute.", "api.example.com/limits"],
      claim: 2,
      fixed: ["The docs say the limit", "is 300 a minute.", "api.example.com/limits"],
      log: ["Read   src/client.ts", "Search \"limit\" in src"],
      missing: "page never opened",
      found: "Opened api.example.com/limits",
      reason: "Open the page first.",
    },
  },
  {
    id: "blind",
    part: "Checks",
    title: "A fresh reviewer sees only the screen",
    sub: "It marks what looks wrong. Each round fixes the worst.",
    ticks: 144,
    body: { kind: "review", flaws: ["Button off screen", "Text cut off", "Hard to read"], rounds: ["Round 1", "Round 2", "Round 3"], clean: "Nothing serious left" },
  },
  {
    id: "btw",
    part: "Steer",
    title: "Add a note without stopping it",
    sub: "Type it with /btw, or the Note button in Nimbalyst. The work goes on.",
    ticks: 144,
    body: {
      kind: "btw",
      work: ["Read   src/routes.ts", "Edit   src/limits.ts", "Ran    npm test   9 passed", "Edit   src/login.ts", "Read   src/session.ts", "Edit   tests/login.test.ts", "Ran    npm test   12 passed"],
      note: "also update the docs",
      picked: "Edit   docs/limits.md   (your note)",
    },
  },
  {
    id: "map",
    part: "Steer",
    title: "See what the change touched",
    sub: "A map of what connects to what. It shows what to check next.",
    ticks: 144,
    body: {
      kind: "map",
      parts: ["Login page", "Login API", "Rate limiter", "User database", "Session store", "Tests", "Docs"],
      links: [[0, 1], [1, 2], [1, 3], [1, 4], [2, 5], [2, 6], [3, 5]],
      changed: 1,
      check: "Check next: Tests, Docs",
    },
  },
  {
    id: "usage",
    part: "Cost",
    title: "See what it cost and how long your week lasts",
    sub: "By plan week, day by day. Checking it uses no tokens.",
    ticks: 144,
    body: {
      kind: "usage",
      days: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
      used: [9, 14, 36, 58],
      ahead: [80, 100],
      limit: "Weekly limit",
      forecast: "At this pace it lasts until Thursday.",
      note: "Sample numbers",
    },
  },
  {
    id: "compare",
    part: "Overview",
    title: "What it adds to Claude Code",
    sub: "Claude Code has hooks, subagents, /compact and /usage. This is built on them.",
    ticks: 168,
    body: {
      kind: "compare",
      rows: [
        { topic: "Its claims", alone: "You check them", setup: "Checked against its log" },
        { topic: "Commands", alone: "It may ask you to run them", setup: "It runs them itself" },
        { topic: "Long chats", alone: "/compact when full, or by hand", setup: "Compact themselves early" },
        { topic: "Big jobs", alone: "Subagents you arrange", setup: "Planned, built, one review" },
        { topic: "Usage", alone: "/usage: how much of your limits is used", setup: "By project, with a forecast" },
      ],
    },
  },
  {
    id: "also",
    part: "Overview",
    title: "Also in it",
    ticks: 144,
    body: {
      kind: "tiles",
      tiles: [
        { name: "40 hooks", note: "Small checks on each step" },
        { name: "19 skills", note: "Commands like /lead" },
        { name: "7 extensions", note: "Panels for the editor" },
        { name: "5 agents", note: "Planner, helpers, reviewer" },
        { name: "Handoff", note: "A fresh session picks up" },
        { name: "Board cleanup", note: "Tidies the session board" },
        { name: "Phone inbox", note: "Send work from your phone" },
        { name: "Ink themes", note: "Eleven editor themes" },
      ],
    },
  },
  {
    id: "install",
    part: "Install",
    title: "Install with one command",
    sub: "Add --dry-run to see what it changes first.",
    ticks: 156,
    body: {
      kind: "install",
      code: "node install.mjs",
      output: ["Copied 40 hooks", "Copied 19 skills", "Copied 5 agents", "Added 7 editor extensions", "Kept your own settings", "Done. Start Claude Code."],
      update: "Updates itself: /update-setup",
      link: LINK,
    },
  },
];

export const toFrames = (ticks: number): number => Math.round((ticks * FPS) / TICKS);
export const frames = (shot: Shot): number => toFrames(shot.ticks);

export type Item = { id: string; from: number; frames: number; part: Part | null; shot: Shot };

/** Every shot of the film, or only the named shots for a clip, with the frame each starts on. Shots follow each
 * other end to end: no chapter cards between them and no overlaps. */
export const timeline = (ids?: string[]): Item[] => {
  const items: Item[] = [];
  let at = 0;
  for (const shot of SCRIPT.filter((s) => !ids || ids.includes(s.id))) {
    items.push({ id: shot.id, from: at, frames: frames(shot), part: shot.part, shot });
    at += frames(shot);
  }
  return items;
};

export const totalFrames = (ids?: string[]): number => {
  const items = timeline(ids);
  const last = items[items.length - 1];
  return last.from + last.frames;
};

/** The text of a shot, in reading order, for the printout of its pace. */
export const blocks = (shot: Shot): string[] => {
  const head = shot.sub ? [shot.title, shot.sub] : [shot.title];
  const b = shot.body;
  switch (b.kind) {
    case "open":
      return [...b.lines, b.name];
    case "claim":
      return [...head, REPLY_LABEL, ...b.reply, LOG_LABEL, ...b.log, b.missing, SENT_BACK, b.reason, b.found, b.fixed[b.claim], PASSED];
    case "lead":
      return [...head, b.label, b.ask, ...b.steps, b.helper, b.reviewer, b.done];
    case "review":
      return [...head, ...b.flaws, ...b.rounds, b.clean];
    case "usage":
      return [...head, ...b.days, b.limit, b.forecast, b.note];
    case "map":
      return [...head, ...b.parts, b.check];
    case "btw":
      return [...head, ...b.work, b.note, b.picked];
    case "compare":
      return [...head, `${ALONE_LABEL} ${SETUP_LABEL}`, ...b.rows.map((r) => `${r.topic} ${r.alone} ${r.setup}`)];
    case "tiles":
      return [...head, ...b.tiles.map((t) => `${t.name} ${t.note}`)];
    case "install":
      return [...head, b.code, ...b.output, b.update, b.link];
  }
};
