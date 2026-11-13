// What the chat scanners share about Claude Code's transcripts (~/.claude/projects/<folder>/<chat>.jsonl): the
// walk over the chat files of a window, a chat's helper records, the tool-name patterns, the lines a program
// wrote instead of the user, and the small text helpers. A pattern changed here changes it in every scanner.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TURN_LIMIT_RE } from "../../../../hooks/lib/texts.mjs";

// Fewer cases than this and a figure is "too few to judge": no percentage is printed (outcomes, usage-scan's quality counters)
export const TOO_FEW = 10;

export const defaultRoot = () => path.join(os.homedir(), ".claude", "projects");

// Every chat file whose last write is inside the window: { file, dir (folder name), name }. `dirOk(folderName)`
// leaves out whole folders before they are read.
export function* walkChats(root, since, dirOk = () => true) {
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dirOk(dir.name)) continue;
    for (const name of fs.readdirSync(path.join(root, dir.name))) {
      const file = path.join(root, dir.name, name);
      if (!name.endsWith(".jsonl") || fs.statSync(file).mtimeMs < since)
        continue;
      yield { file, dir: dir.name, name };
    }
  }
}

// A chat's helper records: <chat>/subagents/*.meta.json, found by the toolUseId inside. Map toolUseId -> { ...meta, base }
// (base = file name without .meta.json). `onBad(file)` hears of a meta file that could not be parsed.
export function subagentMetas(chatFile, onBad = () => {}) {
  const sdir = path.join(
    path.dirname(chatFile),
    path.basename(chatFile, ".jsonl"),
    "subagents",
  );
  const metas = new Map();
  if (fs.existsSync(sdir))
    for (const f of fs.readdirSync(sdir)) {
      if (!f.endsWith(".meta.json")) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(sdir, f), "utf8"));
        if (m.toolUseId)
          metas.set(m.toolUseId, {
            ...m,
            base: f.replace(/\.meta\.json$/, ""),
          });
      } catch {
        onBad(path.join(sdir, f));
      }
    }
  return { sdir, metas };
}

// Tool names
export const EDIT = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
export const AGENT = /^(Agent|Task)$/;
export const SHELL = /^(Bash|PowerShell)$/;
export const QUESTION_TOOL = /(AskUserQuestion|PromptForUserInput)$/;
export const CAPPED = TURN_LIMIT_RE; // a helper's report that ends at its turn limit

// Lines that look like something the user typed but were written by a program (a hook, a skill load, a notification)
export const MACHINE =
  /^(<(?!command-)[a-z-]+[ >]|\[System:|\[Child Session|\[\d+ messages? arrived|Stop hook feedback|The PermissionDeni|Another Claude ses|Base directory for|Condense the tool|Caveat: |\[Image: |Use the Bash tool )/;
export const INTERRUPTED = /^\[Request interrupted by user/;
export const REFUSED = /^The user doesn't want to (take this action|proceed)/;
export const HOOK =
  /^(?:Pre|Post)ToolUse:\S+ hook (?:blocking )?error:\s*\[?([\w-]+)\]?/; // hook name in group 1
// First words of a message that look like a correction. A lead for the reader, not a verdict.
export const FILLER =
  /^(?:ok(?:ay)?|well|hmm+|so|but|and|yeah|alright|bro)[,.! ]+/i;
export const PUSH =
  /^(?:no[,.! ]|nope|wrong|incorrect|not what|that'?s not|this is not|it'?s not|i said|i told|i asked|i meant|again[,.! ]|still |why did(?:n'?t)? (?:you|u)\b|why (?:are|do|would) (?:you|u)\b|(?:you|u) (?:didn'?t|did not|haven'?t|missed|forgot|ignored|still)\b|(?:it )?did(?:n'?t| not) work|(?:it )?does(?:n'?t| not) work|not working|stop[,.! ]|wtf|нет[,.! ]|не то|не так|я же|опять|снова|не работает|почему ты)/i;

// Text helpers
export const one = (s) =>
  String(s ?? "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((b) =>
            typeof b === "string"
              ? b
              : (b?.text ?? (typeof b?.content === "string" ? b.content : "")),
          )
          .join("\n")
      : "";
export const normFile = (p) =>
  p ? String(p).replace(/\\/g, "/").toLowerCase() : "";
// The file an Edit, Write or NotebookEdit call changed, normalised
export const editedFile = (input) =>
  normFile(input?.file_path ?? input?.notebook_path ?? input?.path);
