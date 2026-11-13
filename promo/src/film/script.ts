// Every word of the tour film, in order, and how long each shot lasts. Lengths are set by hand: a shot lasts as
// long as its motion needs, not as long as its words would take to read aloud. `node check-reading.mjs` prints them.
import { LINK, NAME } from "./credit.ts";

export const FPS = 60;
/** Timing in the film's code is in ticks. Lowering this one number slows the whole film evenly; the springs keep their snap. */
export const TICKS = 24;

export const PARTS = ["Overview", "Checks", "Cost", "Big jobs", "Tools", "Install"] as const;
export type Part = (typeof PARTS)[number];

export type Tile = { name: string; note: string };
export type Row = { text: string; note?: string; big?: string };
export type Flow = string[][];
export type Body =
  | { kind: "open"; lines: string[] }
  | { kind: "tiles"; tiles: Tile[] }
  | { kind: "compare"; rows: { topic: string; alone: string; setup: string }[] }
  | { kind: "catch" }
  | { kind: "rows"; rows: Row[] }
  | { kind: "bars"; bars: { name: string; value: number; label: string }[]; times: string }
  | { kind: "usage"; projects: { name: string; share: number }[]; forecast: string }
  | { kind: "flow"; flow: Flow }
  | { kind: "review"; rounds: string[]; clean: string }
  | { kind: "note"; rows: { name: string; text: string }[] }
  | { kind: "board"; columns: string[]; cards: string[] }
  | { kind: "install"; code: string; rows: Row[] }
  | { kind: "stats"; stats: { value: number; unit: string }[]; line: string }
  | { kind: "end"; line: string; name: string; link: string };

export type Enter = "cut" | "up" | "left";
export type Shot = { id: string; part: Part | null; title: string; sub?: string; ticks: number; enter?: Enter; body: Body };

export const ALONE_LABEL = "Claude Code with a few skills";
export const SETUP_LABEL = "With this setup";

export const USAGE_LABEL = "The page it opens (sample numbers)";
export const LOG_LABEL = "What the agent did";

export const CATCH = {
  source: "A real send-back, address changed",
  reason: "It has to open the page first.",
  corrected: "The page said 300.",
  claim: ["Its docs say the limit is ", "500", " requests a minute."],
  fixed: "300",
  address: "api.example.com/docs/limits",
  log: ["Read a file", "Ran a search"],
  missing: "Opened that page",
  found: "Opened the page",
  verdict: "Sent back",
  passed: "Passed",
  /** The ticks the story turns on. */
  at: { caught: 54, fixed: 92, passed: 116 },
} as const;

/** What the film calls each part of the repo, listed inside the contents shot. */
export const HOOKS = [
  "big-read-gate", "board-nudge", "code-review-gate", "cold-cache", "command-explain", "context-guard", "decided-quote", "file-link-gate",
  "handoff-brief", "link-gate", "loop-warn", "opencli-readonly", "picture-in-project", "plan-usage-logger", "question-other", "repeat-guard",
  "run-yourself", "slow-output-gate", "sql-guard", "update-check", "usage-dashboard-hook", "web-answer-gate", "web-worker-gate", "worker-nudge",
];
export const SKILLS = [
  "/ask", "/blind-review", "/board-cleanup", "/btw", "/court", "/handoff", "/lead", "/new-project", "/next-move",
  "/phone-bot", "/plan-first", "/project-scan", "/setup-audit", "/shared-usage", "/steer", "/update-setup", "/usage-report", "/watch",
];
export const EXTENSIONS = ["usage-plan", "commands", "agents-panel", "ink-themes", "read-aloud"];
export const PROJECTS = ["internet-search", "ask-anything", "quick-tasks", "claude-settings"];
export const AGENTS = ["planner", "worker"];
export const RULES = ["CLAUDE.md"];
export const COMMANDS = ["Board cleanup", "Next move", "Project scan", "Setup audit", "Usage report", "New project", "Update setup"];

/** The eleven editor themes, with the colours from their manifest: dark first, so the screen never strobes between dark and light. */
export const THEMES = [
  { name: "Aurora", bg: "#14121c", panel: "#1f1c2c", text: "#ebe9f3", muted: "#958fa9", primary: "#7a6dc9" },
  { name: "Ivy", bg: "#171b19", panel: "#222826", text: "#e7ece8", muted: "#8d9a92", primary: "#3f8a5f" },
  { name: "Graphite", bg: "#2b2a29", panel: "#383634", text: "#f1ede7", muted: "#aca499", primary: "#b98452" },
  { name: "Tide", bg: "#111a20", panel: "#1a272f", text: "#e6eef1", muted: "#8a9ca4", primary: "#26818e" },
  { name: "Ember", bg: "#1b1517", panel: "#282023", text: "#f1e9ea", muted: "#a39397", primary: "#b0506a" },
  { name: "Noir", bg: "#101010", panel: "#1c1c1c", text: "#e6e6e6", muted: "#8f8f8f", primary: "#ececec" },
  { name: "Cobalt", bg: "#12151f", panel: "#1c2130", text: "#e8ebf5", muted: "#8e96b0", primary: "#3f6fd8" },
  { name: "Neon", bg: "#170f1a", panel: "#241829", text: "#f4ecf6", muted: "#a08fa6", primary: "#d6249f" },
  { name: "Bone", bg: "#f6f1e6", panel: "#fdfaf3", text: "#2b2620", muted: "#6f6558", primary: "#9a5a3c" },
  { name: "Frost", bg: "#f1f4f7", panel: "#fbfcfd", text: "#1c232c", muted: "#586473", primary: "#35609a" },
  { name: "Blossom", bg: "#f8f1f2", panel: "#fefbfb", text: "#2a1f23", muted: "#6a585e", primary: "#a8406a" },
];

export const SCRIPT: Shot[] = [
  {
    id: "title",
    part: "Overview",
    title: "AI coding setup for Claude Code",
    ticks: 140,
    body: { kind: "open", lines: ["Coding agents skip steps", "and claim things they never checked.", "I built this to catch that."] },
  },
  {
    id: "contents",
    part: "Overview",
    title: "What's in it",
    ticks: 158,
    enter: "left",
    body: {
      kind: "tiles",
      tiles: [
        { name: "24 hooks", note: "Small scripts that check each step" },
        { name: "18 skills", note: "Commands like /lead and /court" },
        { name: "5 extensions", note: "Panels for the Nimbalyst editor" },
        { name: "4 projects", note: "Ready-made folders" },
        { name: "2 agents", note: "A planner and a capped helper" },
        { name: "1 rules file", note: "How the agent should work" },
      ],
    },
  },
  {
    id: "compare",
    part: "Overview",
    title: "How it compares",
    sub: "Claude Code gives you hooks and skills. This is what I built with them.",
    ticks: 170,
    enter: "up",
    body: {
      kind: "compare",
      rows: [
        { topic: "Its claims", alone: "Nothing checks them", setup: "Hooks compare them with its log" },
        { topic: "Commands", alone: "It may ask you to run them", setup: "It runs them itself" },
        { topic: "Long chats", alone: "Compact when nearly full, or by hand", setup: "Compact themselves early" },
        { topic: "Big jobs", alone: "Subagents you arrange", setup: "/lead: sessions side by side, then a review" },
        { topic: "Spending", alone: "/usage: the last 7 days", setup: "Per project, with a forecast" },
      ],
    },
  },
  {
    id: "catch",
    part: "Checks",
    title: "Every reply is checked against the log",
    sub: "Claude Code logs every step. This reply cites a page it never opened.",
    ticks: 156,
    body: { kind: "catch" },
  },
  {
    id: "sentback",
    part: "Checks",
    title: "What else it catches",
    ticks: 96,
    body: {
      kind: "rows",
      rows: [
        { text: "“Now run this yourself”", note: "It runs it" },
        { text: "Three files changed, no review", note: "Review first" },
        { text: "“May not be available”", note: "Looks it up" },
        { text: "DELETE without WHERE", note: "Asks you first" },
      ],
    },
  },
  {
    id: "habits",
    part: "Checks",
    title: "How it works with you",
    ticks: 112,
    enter: "up",
    body: {
      kind: "rows",
      rows: [
        { text: "Replies lead with the answer" },
        { text: "Each shell command says what it does" },
        { text: "You can always type your own answer" },
        { text: "Your decisions get written down" },
      ],
    },
  },
  {
    id: "compact",
    part: "Cost",
    title: "Long chats compact while it's cheap",
    sub: "After a long pause it cost about 13× more. Estimated from two chats of the same size.",
    ticks: 100,
    body: {
      kind: "bars",
      bars: [
        { name: "Right away", value: 44, label: "k tokens" },
        { name: "After a long pause", value: 590, label: "k tokens" },
      ],
      times: "13×",
    },
  },
  {
    id: "reads",
    part: "Cost",
    title: "What wastes tokens gets refused",
    ticks: 112,
    enter: "left",
    body: {
      kind: "rows",
      rows: [
        { text: "Reading a whole big file", big: "607", note: "Refused 607 times in 30 days" },
        { text: "Helpers with no limit", big: "4.3M", note: "One used 4.3M tokens. Now 25 turns" },
        { text: "Long file reading", big: "GPT", note: "Goes to GPT or Gemini, if you have them" },
      ],
    },
  },
  {
    id: "usage",
    part: "Cost",
    title: "Type usage to see where the week went",
    sub: "By project, model and day. Typing it uses no tokens.",
    ticks: 92,
    enter: "up",
    body: {
      kind: "usage",
      projects: [
        { name: "API", share: 0.41 },
        { name: "Website", share: 0.33 },
        { name: "Data jobs", share: 0.26 },
      ],
      forecast: "At this pace the limit runs out Saturday 14:00.",
    },
  },
  {
    id: "lead",
    part: "Big jobs",
    title: "/lead runs a big job across sessions",
    sub: "In the Nimbalyst editor, you hand it the job. A separate session reviews the result.",
    ticks: 118,
    body: { kind: "flow", flow: [["/lead"], ["Search", "Build", "Tests"], ["Separate review"]] },
  },
  {
    id: "court",
    part: "Big jobs",
    title: "/court asks three models one question",
    sub: "Each answers alone. They review each other blind.",
    ticks: 96,
    enter: "left",
    body: { kind: "flow", flow: [["/court"], ["Claude", "GPT", "Gemini"], ["Verdict: you decide"]] },
  },
  {
    id: "review",
    part: "Big jobs",
    title: "/blind-review checks any big work",
    sub: "Fresh reviewers see only the request and the result. You fix what they rank serious.",
    ticks: 116,
    enter: "up",
    body: { kind: "review", rounds: ["Round 1", "Round 2", "Round 3"], clean: "Nothing serious left" },
  },
  {
    id: "handoff",
    part: "Big jobs",
    title: "A new session picks up the work",
    sub: "A handoff note is rewritten after every reply.",
    ticks: 72,
    enter: "left",
    body: {
      kind: "note",
      rows: [
        { name: "Goal", text: "New login API" },
        { name: "Done", text: "3 of 5 endpoints" },
        { name: "Next", text: "The last two" },
      ],
    },
  },
  {
    id: "board",
    part: "Big jobs",
    title: "Every chat is a card on a board",
    sub: "Cards move as the work goes. The board is part of Nimbalyst.",
    ticks: 72,
    enter: "up",
    body: {
      kind: "board",
      columns: ["Backlog", "Planning", "Implementing", "Validating", "Complete"],
      cards: ["New login API", "Fix the slow query", "Rate limit docs", "Billing page", "Nightly data job", "Upgrade the SDK", "Flaky test"],
    },
  },
  {
    id: "everyday",
    part: "Tools",
    title: "What else it lets you do",
    ticks: 76,
    body: {
      kind: "tiles",
      tiles: [
        { name: "/btw", note: "Note a busy session" },
        { name: "/watch", note: "Ask about a video" },
        { name: "/new-project", note: "Set up a folder" },
        { name: "Phone bot", note: "Send work from Telegram" },
        { name: "Voice typing", note: "Talk instead of typing" },
        { name: "Read Aloud", note: "Hear the replies" },
      ],
    },
  },
  {
    id: "audits",
    part: "Tools",
    title: "It reviews how the work went",
    ticks: 108,
    enter: "up",
    body: {
      kind: "rows",
      rows: [
        { text: "/setup-audit", note: "Token costs, hook blocks, unused parts" },
        { text: "/chat-review", note: "Where the agent got in your way" },
        { text: "/full-review", note: "What to change, as a list to tick" },
        { text: "/usage-report", note: "Where the tokens went, per session" },
      ],
    },
  },
  {
    id: "projects",
    part: "Tools",
    title: "Four projects, ready to open",
    ticks: 70,
    enter: "left",
    body: {
      kind: "tiles",
      tiles: [
        { name: "internet-search", note: "Finds things online, cites only pages it opened" },
        { name: "ask-anything", note: "General questions, /court and pictures" },
        { name: "quick-tasks", note: "One-off file jobs, done on copies" },
        { name: "claude-settings", note: "Change and check the setup itself" },
      ],
    },
  },
  {
    id: "editor",
    part: "Tools",
    title: "Extensions for the editor",
    ticks: 104,
    body: {
      kind: "tiles",
      tiles: [
        { name: "Usage ring", note: "The week's use on the side bar" },
        { name: "Commands", note: "Seven commands behind one button" },
        { name: "Agents list", note: "Running helpers, in plain words" },
        { name: "11 themes", note: "Eight dark, three light" },
      ],
    },
  },
  {
    id: "install",
    part: "Install",
    title: "See what it changes first",
    sub: "Nimbalyst is optional. It adds /lead and the session board.",
    ticks: 96,
    body: {
      kind: "install",
      code: "node install.mjs --dry-run",
      rows: [
        { text: "--dry-run", note: "Shows what would change" },
        { text: "--uninstall", note: "Takes it out" },
        { text: "Every hook", note: "Has an off switch" },
        { text: "/update-setup", note: "Updates, and keeps your changes" },
      ],
    },
  },
  {
    id: "proof",
    part: "Install",
    title: "All my work runs through it",
    ticks: 100,
    enter: "up",
    body: {
      kind: "stats",
      stats: [
        { value: 11042, unit: "replies checked in 30 days" },
        { value: 360, unit: "sent back" },
        { value: 53, unit: "test files, run on every push" },
      ],
      line: "People in finance, data engineering and government IT use it at work too.",
    },
  },
  {
    id: "end",
    part: null,
    title: "ai-coding-setup",
    ticks: 96,
    body: {
      kind: "end",
      line: "Rules, checks and tools for Claude Code",
      name: NAME,
      link: LINK,
    },
  },
];

/** A full-screen chapter card sits between two chapters. It wipes in over the shot before it. */
export const CHAPTER_TICKS = 22;
export const WIPE_TICKS = 9;
/** How long a shot that enters by sliding overlaps the shot before it. */
export const PUSH_TICKS = 8;

export const toFrames = (ticks: number): number => Math.round((ticks * FPS) / TICKS);
export const frames = (shot: Shot): number => toFrames(shot.ticks);

export type Item = { id: string; from: number; frames: number; part: Part | null; shot?: Shot; wipe?: boolean };

/** Every shot and chapter card of the film, or only the named shots for a clip, with the frame each starts on. */
export const timeline = (ids?: string[]): Item[] => {
  const items: Item[] = [];
  let at = 0;
  let previous: Part | null = null;
  for (const shot of SCRIPT.filter((s) => !ids || ids.includes(s.id))) {
    if (!ids && previous && shot.part && shot.part !== previous) {
      at -= toFrames(WIPE_TICKS);
      items.push({ id: `chapter-${shot.part}`, from: at, frames: toFrames(CHAPTER_TICKS), part: shot.part, wipe: true });
      at += toFrames(CHAPTER_TICKS);
    }
    if (shot.enter && shot.enter !== "cut") at -= toFrames(PUSH_TICKS);
    items.push({ id: shot.id, from: at, frames: frames(shot), part: shot.part, shot });
    at += frames(shot);
    previous = shot.part;
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
      return [...b.lines, ...head];
    case "catch":
      return [...head, CATCH.claim.join(""), CATCH.address, LOG_LABEL, ...CATCH.log, CATCH.missing, CATCH.verdict, CATCH.reason, CATCH.found, CATCH.corrected, CATCH.passed];
    case "tiles":
      return [...head, ...b.tiles.map((t) => `${t.name} ${t.note}`)];
    case "compare":
      return [...head, `${ALONE_LABEL} ${SETUP_LABEL}`, ...b.rows.map((r) => `${r.topic} ${r.alone} ${r.setup}`)];
    case "rows":
    case "install":
      return [...head, ...("code" in b ? [b.code] : []), ...b.rows.map((r) => `${r.text} ${r.note ?? ""}`.trim())];
    case "bars":
      return [...head, ...b.bars.map((r) => `${r.name} ${r.value}${r.label}`)];
    case "usage":
      return [...head, USAGE_LABEL, ...b.projects.map((p) => p.name), b.forecast];
    case "flow":
      return [...head, ...b.flow.map((column) => column.join(" "))];
    case "review":
      return [...head, ...b.rounds, b.clean];
    case "note":
      return [...head, ...b.rows.map((r) => `${r.name} ${r.text}`)];
    case "board":
      return [...head, ...b.columns, ...b.cards];
    case "stats":
      return [...head, ...b.stats.map((s) => `${s.value} ${s.unit}`), b.line];
    case "end":
      return [...head, b.line, b.name, b.link];
  }
};
