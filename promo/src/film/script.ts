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
export const PARTS = [
  "Ask",
  "Checks",
  "Steer",
  "Cost",
  "Overview",
  "Install",
] as const;
export type Part = (typeof PARTS)[number];

export type Tile = { name: string; note: string };
export type Body =
  | { kind: "open"; lines: string[]; name: string }
  /** A reply, the session log beside it, the line the log lacks, and the reply once the agent has done the step. */
  | {
      kind: "claim";
      reply: string[];
      claim: number;
      fixed: string[];
      log: string[];
      missing: string;
      found: string;
      reason: string;
    }
  /** A plain chat message, under its label, that the planner takes up and splits into steps. */
  | {
      kind: "lead";
      label: string;
      ask: string;
      steps: string[];
      helper: string;
      reviewer: string;
      done: string;
    }
  | { kind: "review"; flaws: string[]; rounds: string[]; clean: string }
  | {
      kind: "usage";
      days: string[];
      used: number[];
      ahead: number[];
      limit: string;
      forecast: string;
      note: string;
      /** Names the filled bars, the days used so far. */
      axis: string;
      /** Names the dashed bars, the days still to come. */
      aheadLabel: string;
    }
  /** `changed` is the index into `parts` of the one part that changed; the parts linked to it are the ones to check. */
  | {
      kind: "map";
      parts: string[];
      links: [number, number][];
      changed: number;
      check: string;
      howTo: string;
    }
  | { kind: "btw"; work: string[]; note: string; picked: string }
  | { kind: "compare"; rows: { topic: string; alone: string; setup: string }[] }
  | { kind: "tiles"; tiles: Tile[] }
  /** Measured figures, strongest first: each counts up to `to`, then shows `suffix`. */
  | {
      kind: "results";
      figures: { to: number; suffix: string; head: string; note: string }[];
    }
  | {
      kind: "install";
      code: string;
      output: string[];
      update: string;
      link: string;
    };

export type Shot = {
  id: string;
  part: Part | null;
  title: string;
  sub?: string;
  ticks: number;
  body: Body;
};

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
    body: {
      kind: "open",
      lines: ["Coding agents say done when they aren't.", "This setup checks."],
      name: "AI coding setup for Claude Code",
    },
  },
  {
    id: "lead",
    part: "Ask",
    title: "Ask for a big change. A planner splits it up.",
    sub: "Helpers build the steps. One reviewer checks the result.",
    ticks: 168,
    body: {
      kind: "lead",
      label: "Your message",
      ask: "Add rate limits to the API",
      steps: [
        "Find the API routes",
        "Add the limiter",
        "Write the tests",
        "Update the docs",
      ],
      helper: "helper",
      reviewer: "Reviewer",
      done: "Checked",
    },
  },
  {
    id: "verify",
    part: "Checks",
    title: "Every claim is checked against the log",
    sub: "It says tests pass, but the log has no test run. It's sent back to run them.",
    ticks: 156,
    body: {
      kind: "claim",
      reply: ["Done.", "Tests pass."],
      claim: 1,
      fixed: ["Done.", "Tests pass: 12 of 12."],
      log: [
        "Read   src/limits.ts",
        "Edit   src/limits.ts",
        "Edit   tests/limits.test.ts",
      ],
      missing: "no test run",
      found: "Ran    npm test   12 passed",
      reason: "Run the tests first.",
    },
  },
  {
    id: "link",
    part: "Checks",
    title: "A page it quotes has to be opened",
    sub: "It quotes a page it never opened. When it opens it, the page says 300.",
    ticks: 156,
    body: {
      kind: "claim",
      reply: [
        "The docs say the limit",
        "is 500 a minute.",
        "api.example.com/limits",
      ],
      claim: 2,
      fixed: [
        "The docs say the limit",
        "is 300 a minute.",
        "api.example.com/limits",
      ],
      log: ["Read   src/client.ts", 'Search "limit" in src'],
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
    body: {
      kind: "review",
      flaws: ["Button off screen", "Text cut off", "Hard to read"],
      rounds: ["Round 1", "Round 2", "Round 3"],
      clean: "Nothing serious left",
    },
  },
  {
    id: "btw",
    part: "Steer",
    title: "Add a note without stopping it",
    sub: "Type /btw, or press Note in Nimbalyst (a desktop app for Claude Code). The work goes on.",
    ticks: 144,
    body: {
      kind: "btw",
      work: [
        "Read   src/routes.ts",
        "Edit   src/limits.ts",
        "Ran    npm test   9 passed",
        "Edit   src/login.ts",
        "Read   src/session.ts",
        "Edit   tests/login.test.ts",
        "Ran    npm test   12 passed",
      ],
      note: "also update the docs",
      picked: "Edit   docs/limits.md   (your note)",
    },
  },
  {
    id: "map",
    part: "Steer",
    title: "See what the change touched",
    sub: "A map of the project's parts, topics and how-to notes. It says what to check next.",
    ticks: 144,
    body: {
      kind: "map",
      parts: [
        "Login page",
        "Login API",
        "Rate limiter",
        "User database",
        "Session store",
        "Tests",
        "Docs",
      ],
      links: [
        [0, 1],
        [1, 2],
        [1, 3],
        [1, 4],
        [2, 5],
        [2, 6],
        [3, 5],
      ],
      changed: 2,
      check: "Check next: Login API, Tests, Docs",
      howTo: "How to test it: npm test",
    },
  },
  {
    id: "usage",
    part: "Cost",
    title: "See how long your plan week will last",
    sub: "Used so far, day by day, and when it runs out. Checking it uses no tokens.",
    ticks: 144,
    body: {
      kind: "usage",
      days: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
      used: [9, 14, 36, 58],
      ahead: [80, 100],
      limit: "Weekly limit",
      forecast: "At this pace it lasts until Thursday.",
      note: "Sample numbers",
      axis: "Used so far this week",
      aheadLabel: "Forecast",
    },
  },
  {
    id: "compare",
    part: "Overview",
    title: "What it adds to Claude Code",
    sub: "Claude Code has hooks, subagents, /compact and /usage. This is built on them.",
    ticks: 192,
    body: {
      kind: "compare",
      rows: [
        {
          topic: "Its claims",
          alone: "You check them",
          setup: "Checked against its log",
        },
        {
          topic: "Commands",
          alone: "It may ask you to run them",
          setup: "It runs them itself",
        },
        {
          topic: "Long chats",
          alone: "/compact when full, or by hand",
          setup: "Compact themselves early",
        },
        {
          topic: "Big jobs",
          alone: "Subagents you arrange",
          setup: "Planned, built, one review",
        },
        {
          topic: "Usage",
          alone: "/usage: how much of your limits is used",
          setup: "Day by day, with a forecast",
        },
      ],
    },
  },
  {
    id: "also",
    part: "Overview",
    title: "What's in it",
    sub: "The hooks, skills and agents work in any terminal. The extensions need Nimbalyst.",
    ticks: 168,
    body: {
      kind: "tiles",
      tiles: [
        { name: "50 hooks", note: "Small checks on each step" },
        { name: "20 skills", note: "Commands like /lead" },
        { name: "7 extensions", note: "Panels for the Nimbalyst app" },
        { name: "9 agents", note: "Planner, workers, reviewers" },
        { name: "Handoff", note: "Next session picks up where you stopped" },
        { name: "Board cleanup", note: "Tidies Nimbalyst's board of chats" },
        { name: "Phone inbox", note: "Send work from your phone" },
        { name: "Ink themes", note: "11 colour themes for Nimbalyst" },
      ],
    },
  },
  {
    id: "results",
    part: "Overview",
    title: "Tested before this release",
    sub: "Three results from two tests, November 2026. Details: docs/test-results.md",
    ticks: 168,
    body: {
      kind: "results",
      figures: [
        {
          to: 40,
          suffix: "%",
          head: "fewer tokens than a plain review",
          note: "The reviewer agent found as many planted bugs, with the same model.",
        },
        {
          to: 30,
          suffix: "/30",
          head: "commands judged right",
          note: "Each risky command was stopped; each look-alike was let through.",
        },
        {
          to: 12000,
          suffix: "+",
          head: "hook runs, 0 crashes or errors",
          note: "Every hook ran on saved logs of real past sessions.",
        },
      ],
    },
  },
  {
    id: "install",
    part: "Install",
    title: "Clone it, then run one command",
    sub: "Add --dry-run to see what it changes first.",
    ticks: 156,
    body: {
      kind: "install",
      code: "node install.mjs",
      output: [
        "Copied 50 hooks",
        "Copied 20 skills",
        "Copied 9 agents",
        "Added 7 extensions for Nimbalyst",
        "Kept your own settings",
        "Done. Start Claude Code.",
      ],
      update: "Small updates install themselves. Big ones: /update-setup",
      link: LINK,
    },
  },
];

export const toFrames = (ticks: number): number =>
  Math.round((ticks * FPS) / TICKS);
export const frames = (shot: Shot): number => toFrames(shot.ticks);

export type Item = {
  id: string;
  from: number;
  frames: number;
  part: Part | null;
  shot: Shot;
};

/** Every shot of the film, or only the named shots for a clip, with the frame each starts on. Shots follow each
 * other end to end: no chapter cards between them and no overlaps. */
export const timeline = (ids?: string[]): Item[] => {
  const items: Item[] = [];
  let at = 0;
  for (const shot of SCRIPT.filter((s) => !ids || ids.includes(s.id))) {
    items.push({
      id: shot.id,
      from: at,
      frames: frames(shot),
      part: shot.part,
      shot,
    });
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
      return [
        ...head,
        REPLY_LABEL,
        ...b.reply,
        LOG_LABEL,
        ...b.log,
        b.missing,
        SENT_BACK,
        b.reason,
        b.found,
        b.fixed[b.claim],
        PASSED,
      ];
    case "lead":
      return [
        ...head,
        b.label,
        b.ask,
        ...b.steps,
        b.helper,
        b.reviewer,
        b.done,
      ];
    case "review":
      return [...head, ...b.flaws, ...b.rounds, b.clean];
    case "usage":
      return [
        ...head,
        ...b.days,
        b.axis,
        b.aheadLabel,
        b.limit,
        b.forecast,
        b.note,
      ];
    case "map":
      return [...head, ...b.parts, b.check, b.howTo];
    case "btw":
      return [...head, ...b.work, b.note, b.picked];
    case "compare":
      return [
        ...head,
        `${ALONE_LABEL} ${SETUP_LABEL}`,
        ...b.rows.map((r) => `${r.topic} ${r.alone} ${r.setup}`),
      ];
    case "tiles":
      return [...head, ...b.tiles.map((t) => `${t.name} ${t.note}`)];
    case "results":
      return [
        ...head,
        ...b.figures.map((f) => `${f.to}${f.suffix} ${f.head} ${f.note}`),
      ];
    case "install":
      return [
        ...head,
        `git clone https://${b.link}`,
        `cd ${b.link.split("/").pop()}`,
        b.code,
        ...b.output,
        b.update,
      ];
  }
};
