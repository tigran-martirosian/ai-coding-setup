// Skill linter: checks each <folder>/*/SKILL.md for the shape that makes a skill run the same way every time.
// Run: node skill-lint.mjs [skills folder]   (default: the skills folder this script sits in, two levels up)
// Rules (one output line per failure, `<skill>: <rule>: <detail>`, then a total; exit 1 on any failure, 2 when the
// folder is missing or holds no skills):
//   frontmatter   the file opens with --- frontmatter, `name` equals the folder name, `description` is set
//   steps         the skill has at least 2 numbered steps (`1. ...` or `## Step 1 ...`); a reference-only skill
//                 fails here and is listed in the audit report rather than forced into steps
//   step-command  a step that acts (Run, Delete, Install, Commit, Open, ...) names the command or tool it uses
//   step-check    a step that names a command also says how to tell it worked (prints, says, check, until, ...)
//   error-table   a skill with steps has an error/recovery table or a section on what to do when a step fails
// The checks are word patterns, not understanding: a pass means the shape is there, not that the content is right.
import fs from "node:fs";
import path from "node:path";

const folder = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, "..", ".."),
);
if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
  console.error(`skill-lint: no such folder: ${folder}`);
  process.exit(2);
}
const skills = fs
  .readdirSync(folder, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() && fs.existsSync(path.join(folder, d.name, "SKILL.md")),
  )
  .map((d) => d.name)
  .sort();
if (!skills.length) {
  console.error(`skill-lint: no */SKILL.md in ${folder}`);
  process.exit(2);
}

// Programs and tools whose name in a code span marks it as a command.
const PROGRAMS =
  /^(node|npx|npm|pnpm|git|gh|python3?|py|pip|uv|uvx|powershell|pwsh|bash|sh|cmd|curl|restic|ffmpeg|ffprobe|yt-dlp|opencli|claude|taskkill|tasklist|winget|choco|brew|docker|rg|grep|find|ls|cat|mkdir|cp|mv|rm|cd|start|code|cygpath|schtasks|reg|setx|robocopy|tar|unzip|wsl)(\s|$)/;
const TOOL_WORDS =
  /\b(Write|Edit|Read|Grep|Glob|Bash|Agent|Skill|ToolSearch|WebFetch|WebSearch|Monitor)\b`?\s+tool\b|\btool\s+`?(Write|Edit|Read|Grep|Glob|Bash|Agent|Skill|ToolSearch|WebFetch|WebSearch|Monitor)\b/;
// A named agent or skill (`reviewer` agent, the skill `watch`) is run through the Agent or Skill tool.
const AGENT_OR_SKILL =
  /`[\w:-]+`\s+(agent|skill|subagent)\b|\b(agent|skill)\s+`[\w:-]+`/i;
const isCommand = (code) =>
  PROGRAMS.test(code) ||
  /^\/[a-z][\w-]*/.test(code) || // a slash command
  /^--?[a-zA-Z]/.test(code) || // a flag of the skill's own script (`--check`)
  /mcp__/.test(code) || // an MCP tool
  /^[a-z]+(_[a-z]+)+(\b|\()/.test(code) || // a tool call such as tracker_update
  /^[~./\w-]*\.(mjs|js|ps1|sh|py|cmd|bat)(\s|$)/.test(code) || // a script run by path
  /\$\(/.test(code);
const hasCommand = (text) =>
  /^\s*(```|~~~)/m.test(text) ||
  TOOL_WORDS.test(text) ||
  AGENT_OR_SKILL.test(text) ||
  [...text.matchAll(/`([^`\n]+)`/g)].some((m) => isCommand(m[1].trim()));

// A step acts when one of its sentences starts with a verb that changes or runs something ("Stop and tell",
// "Open no folder" do not act).
const ACTS =
  /(?:^|[.!?;:]\s+|\*\*\s+)(Run|Execute|Call|Install|Uninstall|Delete|Remove|Copy|Move|Rename|Commit|Push|Pull|Download|Upload|Start|Stop|Restart|Kill|Build|Deploy|Launch|Open|Sync|Fetch|Clone|Merge|Create|Apply|Restore|Schedule)\b(?![.,]|\s+(?:and|here|there|no|nothing|none)\b)/;
const CHECK =
  /\b(checks?|checked|verif(y|ies|ied)|confirms?|expect(s|ed)?|should (say|show|print|list|be|return|exit|pass|read|end)|must (say|show|print|list|be|return|pass|end)|prints?|printed|shows?|says|said|lists?|returns?|reports|exit(s| code)|pass(es|ed)?|green|until|done when|succeed(s|ed)?|fails?|failed|if it|if that|if nothing|if none|if no |reads? (it )?back|read back)|→|=>/i;
const ERROR_HEADING =
  /\b(errors?|fail\w*|recover\w*|troubleshoot\w*|problems?|goes wrong|went wrong|breaks)\b/i;

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { fields, body: text.slice(m[0].length) };
}

// Split a body into numbered steps: `1. ...` list items (indent under 4) or `## Step 1` / `## 1.` headings.
// A list step ends at the next step, a heading, or a top-level paragraph after a blank line.
function steps(body) {
  const out = [];
  let cur = null,
    fence = false,
    blank = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      if (cur) cur.text += `\n${line}`;
      continue;
    }
    if (fence) {
      if (cur) cur.text += `\n${line}`;
      continue;
    }
    const item = line.match(/^ {0,3}(\d+)[.)]\s+(.*)$/);
    const head = line.match(/^#{2,6}\s+(?:step\s+)?(\d+)\b[.):]?\s*(.*)$/i);
    if (item || head) {
      const [, n, rest] = item ?? head;
      cur = { n: Number(n), text: rest, heading: !!head };
      out.push(cur);
    } else if (/^#/.test(line)) cur = null;
    else if (cur && !cur.heading && blank && /^\S/.test(line)) cur = null;
    else if (cur) cur.text += `\n${line}`;
    blank = !line.trim();
  }
  return out;
}

function hasErrorSection(body) {
  const lines = body.split(/\r?\n/);
  return lines.some(
    (l, i) =>
      (/^#{1,6}\s/.test(l) && ERROR_HEADING.test(l)) ||
      /^\*\*[^*]*(fail|error|goes wrong|recover)[^*]*\*\*/i.test(l) ||
      // a table whose header row names errors or failures
      (/^\s*\|/.test(l) &&
        /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "") &&
        /\b(errors?|fail\w*|problems?|symptoms?|goes wrong|recover\w*)\b/i.test(
          l,
        )),
  );
}

const short = (t) => {
  const s = t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return s.length > 50 ? `${s.slice(0, 47)}...` : s;
};

const failures = [];
for (const name of skills) {
  const fail = (rule, detail) => failures.push(`${name}: ${rule}: ${detail}`);
  const text = fs.readFileSync(path.join(folder, name, "SKILL.md"), "utf8");
  const fm = frontmatter(text);
  let body = text;
  if (!fm) fail("frontmatter", "no frontmatter (the first line must be ---)");
  else {
    body = fm.body;
    if (!fm.fields.name) fail("frontmatter", "no name");
    else if (fm.fields.name !== name)
      fail(
        "frontmatter",
        `name "${fm.fields.name}" differs from its folder "${name}"`,
      );
    if (!fm.fields.description) fail("frontmatter", "no description");
  }
  const list = steps(body);
  if (list.length < 2) {
    fail(
      "steps",
      list.length
        ? "only one numbered step"
        : "no numbered steps (a reference-only skill is listed, not forced)",
    );
    continue;
  }
  for (const s of list) {
    const cmd = hasCommand(s.text);
    if (!cmd && ACTS.test(s.text))
      fail(
        "step-command",
        `step ${s.n} ("${short(s.text)}") acts but names no command`,
      );
    if (cmd && !CHECK.test(s.text.replace(/`[^`\n]*`/g, "")))
      fail(
        "step-check",
        `step ${s.n} ("${short(s.text)}") runs a command but says no way to check it`,
      );
  }
  if (!hasErrorSection(body))
    fail(
      "error-table",
      "no error/recovery table or section on what to do when a step fails",
    );
}

for (const f of failures) console.log(f);
const failed = new Set(failures.map((f) => f.split(": ")[0])).size;
console.log(
  `skill-lint: ${failures.length} failure${failures.length === 1 ? "" : "s"} in ${failed} of ${skills.length} skills (${folder})`,
);
process.exit(failures.length ? 1 : 0);
