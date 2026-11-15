#!/usr/bin/env node
// map-prompt: UserPromptSubmit hook. The person's own message arrives with the parts of the project's Systems map it names, each as its
// name and its first files, so the main chat starts from those files instead of searching blind. A part of the code counts by its name
// only; a how-to thing or topic also by its words ("do a web search" -> How to: web research) (skills/systems-map/map.mjs promptFind),
// on the person's own words: pasted blocks and code fences are left out. A long message (dictation) is full of passing words, so over
// LONG characters a thing needs two hits. A thing whose first file the session holds from its start (a skill, rules file, CLAUDE.md,
// agent, MEMORY.md: map.mjs heldAtStart) is left out and not remembered as shown, since the note would only repeat it.
// Small on purpose: at most MAX_THINGS things and MAX_CHARS characters, and a thing already shown in this session is not shown again
// (~/.claude/hooks/state/map-prompt/<session_id>.json, swept after 2 days; no session id, no memory). A file too big to read whole
// (the big-read-gate limits) is marked "big: grep it", unless it is code (a script is run, not read). Silent when the project ($CLAUDE_PROJECT_DIR, else the event's cwd) has no map or
// nothing new matches, and for /commands. Fails open. MAP_PROMPT=off disables it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emit, runHook } from "./lib/hook-io.mjs";
import { loadMap } from "./lib/map-file.mjs";
import { sessionKey } from "./lib/paths.mjs";
import { readJson, stateFile, sweep, writeJson } from "./lib/state.mjs";

export const MAX_CHARS = 600;
export const MAX_THINGS = 3;
export const LONG = 1500;
const BIG_LINES = 350; // big-read-gate refuses a whole read over these
const BIG_BYTES = 80 * 1024;
const HEAD =
  "[map-prompt] Parts of this project's systems map that this message names (skip one that doesn't fit); start from these files:";
const MAP_JS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "skills",
  "systems-map",
  "map.mjs",
);

// The person's own words: no <pasted_content> blocks, no code fences.
const ownWords = (text) =>
  text
    .replace(/<pasted_content\b[\s\S]*?<\/pasted_content>/gi, " ")
    .replace(/```[\s\S]*?(```|$)/g, " ");

function big(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (st.size > BIG_BYTES) return true;
    if (st.size <= BIG_LINES) return false; // fewer bytes than lines it would need
    return fs.readFileSync(file, "utf8").split("\n").length > BIG_LINES;
  } catch {
    return false;
  }
}

runHook("map-prompt", async (event) => {
  const raw = String(event.prompt ?? "");
  if (!raw.trim() || raw.trim().startsWith("/")) return;
  const prompt = ownWords(raw);
  const project = process.env.CLAUDE_PROJECT_DIR || event.cwd;
  if (!project) return;
  const dir = path.resolve(project);
  const map = loadMap(dir);
  if (!Array.isArray(map?.nodes) || !map.nodes.length) return;

  const { promptFind, isCode } = await import(pathToFileURL(MAP_JS).href);
  const remember = Boolean(event.session_id);
  sweep("map-prompt", 2);
  const file = stateFile("map-prompt", sessionKey(event.session_id));
  const seen = new Set(remember ? (readJson(file)?.shown ?? []) : []);
  const least = prompt.length > LONG ? 2 : 1;
  const fresh = promptFind(prompt, map, dir).filter(
    (h) => h.score >= least && !h.held && !seen.has(h.id),
  );
  if (!fresh.length) return;

  let text = HEAD;
  const shown = [];
  for (const h of fresh) {
    if (shown.length >= MAX_THINGS) break;
    const files = h.files.map((f) =>
      !isCode(f) && big(path.resolve(dir, f)) ? `${f} (big: grep it)` : f,
    );
    // Fewer files when the line is too long, then the name alone, then nothing.
    const line = files
      .map(
        (_, i) =>
          `\n- ${h.name}: ${files.slice(0, files.length - i).join(", ")}`,
      )
      .concat(`\n- ${h.name}`)
      .find((l) => text.length + l.length <= MAX_CHARS);
    if (!line) continue;
    text += line;
    shown.push(h.id);
  }
  if (!shown.length) return;
  if (remember) writeJson(file, { shown: [...seen, ...shown] });
  emit.context("UserPromptSubmit", text);
});
