#!/usr/bin/env node
// web-answer-gate: Stop hook. Two checks on the reply you are about to read, for the two ways a web
// answer goes wrong: a confident "that version is probably not available" that nobody checked, and an
// answer that lists two or three things when you asked for ten.
//
// 1. HEDGE: the reply says something may not be available, may not exist, or could not be confirmed,
//    and nothing in this turn actually checked a source and no source URL is given. A version or
//    release fact has a place that knows it, so saying "might not be available" from memory is a guess
//    dressed as an answer. Blocked once, with the command that answers it exactly.
// 2. COUNT: the user asked for a number of things ("find 10 examples", "8-12 mods") and the reply
//    lists fewer, without saying how many it found and where it looked.
//
// Both fail open, both are silent when stop_hook_active is set, and each has its own off switch:
// WEB_ANSWER_GATE=off turns off the file, HEDGE_CHECK=off and COUNT_CHECK=off turn off one check.
import fs from "node:fs";

const TAIL_BYTES = 8 * 1024 * 1024;

// Text outside fenced blocks and inline code spans (a hedge inside a quoted log is not this reply's claim)
export const visibleProse = (text) => {
  const out = [];
  let fence = null;
  for (const line of String(text || "").split("\n")) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      continue;
    }
    if (!fence) out.push(line.replace(/(`+)[^`\n]*?\1/g, " "));
  }
  return out.join("\n");
};

// A user entry the harness or a script made, not a person: a finished background task's notification
// (origin.kind "task-notification", promptSource "system", text opening <task-notification>) and the
// setup-replay judge runs. The judge runs carry no marker: they are `claude -p` runs whose first entry
// looks like a typed prompt (promptSource "sdk", turnOrigin "sdk", entrypoint "sdk-cli", the same as a
// Nimbalyst session), so only their opening words identify them.
export const harnessPrompt = (e, text) =>
  e.promptSource === "system" || e.origin?.kind === "task-notification" ||
  /^\s*<task-notification>/i.test(text) || /^\s*You are judging two assistant repl(?:y|ies)\b/i.test(text);

// This turn: the assistant's visible text, the tools it called, and the user's prompt that started it
export function turn(transcriptPath) {
  const fd = fs.openSync(transcriptPath, "r");
  let chunk;
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    chunk = buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
  const lines = chunk.split("\n");
  const parts = [], tools = [];
  let prompt = "", harness = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"user"') && !line.includes('"assistant"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    const c = e.message?.content;
    if (e.type === "user") {
      // Injected entries are not the user's words: a Stop hook's own feedback, a skill's prompt, the
      // synthetic "No response requested." Reading one as the prompt makes both checks judge the
      // wrong text, and the newest transcripts carry several per turn.
      if (e.isMeta || e.isCompactSummary) continue;
      const text = typeof c === "string" ? c
        : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
      if (!text) continue;
      if (/^\s*(?:<synthetic>|\[(?:Stop hook|System|Child Session|Request interrupted)|Stop hook feedback:|Caveat: The messages below)/i.test(text)) continue;
      // A notification or a judge prompt is not an ask: skip it and keep reading back to the last typed
      // prompt, so the text and tools gathered so far stay, and note that the harness started this turn.
      if (harnessPrompt(e, text)) { harness = true; continue; }
      prompt = text;
      break;
    }
    if (e.type !== "assistant" || !Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === "text" && typeof b.text === "string") parts.unshift(b.text);
      else if (b.type === "tool_use") tools.unshift({ name: b.name || "", input: b.input || {} });
    }
  }
  return { prose: parts.join("\n"), tools, prompt, harness };
}

// ---------- check 1: a hedge about availability with nothing behind it ----------

const HEDGES = [
  /\b(?:may|might|could|probably)\s+not\s+(?:be\s+)?(?:available|released|out|published|exist|supported|compatible)\b/i,
  /\b(?:may|might)\s+not\s+have\s+(?:a|an|any)\s+\S*\s*(?:build|release|version|port)\b/i,
  /\bdoes(?:n't|\s+not)\s+(?:appear|seem)\s+to\s+(?:be\s+(?:available|released)|exist)\b/i,
  /\b(?:is|are)\s+(?:probably\s+|likely\s+)?not\s+available\s+(?:for|on|in|yet)\b/i,
  /\bI\s+(?:couldn't|could\s+not|was\s+unable\s+to)\s+(?:confirm|verify|establish)\s+(?:whether|if|that|the|its|which)\b/i,
  /\bnot\s+sure\s+(?:whether|if)\s+(?:it|that|this|there)\b[^.\n]{0,40}\b(?:available|exists?|released|version)\b/i,
  /\bthere\s+(?:may|might)\s+not\s+be\s+(?:a|an|any)\b/i,
];

// A hedge only counts when the sentence is about something that has a release to look up. Without this,
// ordinary coding prose ("the directory may not exist", "I could not confirm whether the hook fired")
// is blocked and told to run a version checker, which is worse than the problem this hook was built for.
const RELEASE_SUBJECT = /\b(?:versions?|releases?d?|builds?|stable|LTS|majors?|minors?|betas?|rc\d*|pre-?release|packages?|mods?|plugins?|extensions?|librar(?:y|ies)|crates?|gems?|images?|distros?|npm|pypi|pip|crates\.io|nuget|maven|modrinth|curseforge|forge|fabric|neoforge|upstream|node|python|postgres(?:ql)?|docker)\b/i;
// A version-ish number is the other way a sentence shows it is about a release ("PostgreSQL 18 may not...")
const NUMBERISH = /\b\d{1,4}(?:\.\d+)*(?:-[a-z0-9.]+)?\b/;
// These are the subjects that made it a false positive: code and data, not published artefacts
const CODE_SUBJECT = /\b(?:director(?:y|ies)|folders?|files?|paths?|tables?|columns?|rows?|cells?|fields?|keys?|values?|propert(?:y|ies)|methods?|functions?|variables?|params?|arguments?|tests?|hooks?|branch(?:es)?|commits?|endpoints?|records?|logs?|caches?|sessions?|transcripts?|env(?:ironment)?\s+vars?)\b/i;

const sentences = (text) => text.split(/(?<=[.!?:;])\s+|\n+/);

// Tool calls that actually looked something up
const FACT_HOSTS = /(?:endoflife\.date|api\.github\.com|registry\.npmjs\.org|pypi\.org|crates\.io|hub\.docker\.com|api\.modrinth\.com|search\.maven\.org|api\.nuget\.org|api\.curseforge\.com)/i;
const FACT_CMD = /\bversions\.mjs\b|\bgh\s+(?:release|api)\b|\bnpm\s+(?:view|info|dist-tag)\b|\bpip\s+index\b|\bcargo\s+search\b|\bapt-cache\s+policy\b|\bpeek\.mjs\b|\breddit\.mjs\b/i;

export function checkedASource(tools) {
  for (const t of tools) {
    if (/^(?:WebFetch|WebSearch)$/.test(t.name)) return true;
    if (/browser_navigate|browser_evaluate|browser_get_page_info/.test(t.name)) return true;
    const cmd = typeof t.input?.command === "string" ? t.input.command : "";
    if (cmd && (FACT_HOSTS.test(cmd) || FACT_CMD.test(cmd))) return true;
  }
  return false;
}

export function hedgeProblem(prose, tools) {
  const text = visibleProse(prose);
  if (!text.trim()) return null;
  if (checkedASource(tools)) return null;
  // A reply that cites where it looked is showing its work, not guessing
  if (/https?:\/\/\S+/.test(text)) return null;
  for (const s of sentences(text)) {
    const hit = HEDGES.map((re) => re.exec(s)).find(Boolean);
    if (!hit) continue;
    if (CODE_SUBJECT.test(s)) continue;
    if (!RELEASE_SUBJECT.test(s) && !NUMBERISH.test(s)) continue;
    return hit[0].trim();
  }
  return null;
}

// ---------- check 2: fewer things than were asked for ----------

const FIND_VERB = /\b(?:find|list|give|show|get|need|want|recommend|suggest|name|gather|collect)\b/i;
const FIND_NOUN = /\b(?:examples?|options?|alternatives?|ideas?|candidates?|choices?|suggestions?|recommendations?|links?|sources?|results?|names?)\b/i;
// Things a number can refer to that are not a research request
const NOT_RESEARCH = /\b(?:tests?|bugs?|errors?|failures?|warnings?|commits?|edits?|lines?|files?|typos?|hooks?|steps?|times?|minutes?|hours?|days?|tokens?|dollars?|rows?|columns?|cells?|reasons?|causes?|points?|paragraphs?|sentences?|words?|questions?|fields?|keys?|values?|%)\b/i;
// This hook is about web research, so the ask has to look like research. Without this, "show me 5 rows"
// and "give me 10 reasons this is slow" are blocked and pointed at a mod catalogue API.
const RESEARCH_SIGNAL = /\b(?:find|search|searching|look\s+up|looking\s+for|online|web|internet|google|github|reddit|npm|pypi|crates|modrinth|curseforge|mods?|packs?|plugins?|extensions?|tools?|librar(?:y|ies)|packages?|apps?|sites?|websites?|services?|products?|brands?|models?|examples?|options?|alternatives?|candidates?|recommendations?|suggestions?|links?|sources?|articles?|videos?|repos?|repositories)\b/i;

// How many things the prompt asks for, or 0
export function wantedCount(prompt) {
  const p = String(prompt || "");
  if (!FIND_VERB.test(p) && !FIND_NOUN.test(p)) return 0;
  if (!RESEARCH_SIGNAL.test(p)) return 0;
  const patterns = [
    /\b(?:find|list|give(?:\s+me)?|show(?:\s+me)?|get(?:\s+me)?|need|want|gather|collect)\b[^.?!\n]{0,30}?\b(\d{1,2})\s*(?:-|to|–|or)?\s*(\d{1,2})?\s+([a-z][a-z'’ -]{2,28})/i,
    /\b(\d{1,2})\s*(?:-|to|–|or)?\s*(\d{1,2})?\s+(examples?|options?|alternatives?|ideas?|candidates?|choices?|suggestions?|recommendations?|links?|sources?|results?|names?)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(p);
    if (!m) continue;
    const noun = (m[3] || "").trim();
    if (NOT_RESEARCH.test(noun)) continue;
    // A range ("8-12 mods") is met at its lower end
    const n = Math.min(...[m[1], m[2]].filter(Boolean).map(Number));
    if (n >= 3 && n <= 40) return n;
  }
  return 0;
}

// How many separate things the reply lists
export function listedCount(prose) {
  const text = visibleProse(prose);
  let bullets = 0, tableRows = 0, inTable = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^(?:[-*+]|\d{1,2}[.)])\s+\S/.test(line)) bullets++;
    if (/^\|/.test(line)) {
      if (/^\|[\s:|-]+\|?\s*$/.test(line)) { inTable = true; continue; } // the ---|--- separator
      if (inTable) tableRows++;
    } else {
      inTable = false;
    }
  }
  return Math.max(bullets, tableRows);
}

const SAID_HOW_MANY = /\b(?:found|turned\s+up|there\s+(?:are|were)|got|lists?)\s+(?:only\s+)?(?:just\s+)?\d{1,2}\b|\bonly\s+\d{1,2}\b|\b\d{1,2}\s+of\s+the\s+\d{1,2}\b/i;
const SAID_WHERE = /\b(?:searched|checked|looked\s+(?:at|in|through|on)|I\s+went\s+through|sources?\s*:|queries\s*:|what\s+I\s+searched)\b/i;

export function countProblem(prompt, prose, tools, harness = false) {
  const want = wantedCount(prompt);
  if (!want) return null;
  // A turn that stops to ask the user is not an answer yet
  if (tools.some((t) => /AskUserQuestion|PromptForUserInput|ExitPlanMode/.test(t.name))) return null;
  const got = listedCount(prose);
  if (got >= want) return null;
  // A turn a notification started that lists nothing is a status line, not an answer
  if (harness && got < 1) return null;
  const text = visibleProse(prose);
  if (SAID_HOW_MANY.test(text) && SAID_WHERE.test(text)) return null;
  return { want, got };
}

export function reason({ hedge, count }) {
  const out = [];
  if (hedge) {
    out.push(
      `[web-answer-gate] This reply hedges about whether something is available - "${hedge}" - and nothing in this turn checked a source.`,
      `That is the exact failure the user called out: five minutes of searching, a "probably not available", and it was available all along.`,
      `A version, release or existence question has a place that knows the answer. Check it, then answer:`,
      `  node ~/.claude/workers/versions.mjs <target> [--has <version>]`,
      `  targets: postgresql | gh:owner/repo | npm:name | pypi:name | crates:name | docker:image | mvn:g:a | nuget:name`,
      `  anything else: WebFetch the project's own download or releases page.`,
      `Then say the exact version and the URL it came from. If it really is absent, say which source you read and on what date - never "may not be available".`,
    );
  }
  if (count) {
    if (out.length) out.push("");
    out.push(
      `[web-answer-gate] The user asked for ${count.want}; this reply lists ${count.got}.`,
      `Go and find the rest before answering. What works, in order:`,
      `  1. The site's own catalogue API returns every match at once - Modrinth, CurseForge, npm, PyPI, crates, GitHub search.`,
      `     e.g. curl -s 'https://api.modrinth.com/v2/search?query=<words>&facets=[["categories:forge"],["versions:1.20.1"]]&limit=20'`,
      `  2. Several WebSearch calls in one message, differently worded, mode "extended".`,
      `  3. For community opinion, real forum threads through your own signed-in browser.`,
      `If ${count.want} really do not exist, the reply must say how many you found and what you searched, in those words.`,
    );
  }
  return out.join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if ((process.env.WEB_ANSWER_GATE || "").toLowerCase() === "off") return;
      const input = JSON.parse(raw);
      if (input.stop_hook_active) return;
      let t = { prose: "", tools: [], prompt: "", harness: false };
      if (input.transcript_path) {
        try { t = turn(input.transcript_path); } catch {}
      }
      const last = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
      if (last && !t.prose.includes(last)) t.prose = t.prose ? `${t.prose}\n${last}` : last;
      const off = (name) => (process.env[name] || "").toLowerCase() === "off";
      const hedge = off("HEDGE_CHECK") ? null : hedgeProblem(t.prose, t.tools);
      const count = off("COUNT_CHECK") ? null : countProblem(t.prompt, t.prose, t.tools, t.harness);
      if (hedge || count) {
        process.stdout.write(JSON.stringify({ decision: "block", reason: reason({ hedge, count }) }));
      }
    } catch {
      // fail open
    }
  });
}
