// Tests for hooks/big-read-gate.mjs on made-up files in a temp folder. Run: node test-big-read-gate.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/big-read-gate.mjs", import.meta.url),
);
const dir = mkdtempSync(join(tmpdir(), "big-read-gate-test-"));
const bigText = Array.from({ length: 7500 }, (_, i) => `line ${i + 1}`).join(
  "\n",
);
const B = join(dir, "big.txt");
writeFileSync(B, bigText);
writeFileSync(join(dir, "small.md"), "a few\nshort\nlines\n");
writeFileSync(join(dir, "picture.png"), Buffer.alloc(100000));
// a project that switched the gate off in its own settings
const optOut = join(dir, "opted-out");
mkdirSync(join(optOut, ".claude"), { recursive: true });
mkdirSync(join(optOut, "tools"));
writeFileSync(
  join(optOut, ".claude", "settings.json"),
  JSON.stringify({ env: { BIG_READ_GATE: "off" } }),
);
writeFileSync(join(optOut, "big.txt"), bigText);
const F = B.replace(/\\/g, "/"); // the same file, written the way Bash takes it
// Files with a space in the name: one big, one under 350 lines but over 80000 bytes (100 x 1000), and two under
// both limits (100 x 300, 100 x 150)
const SPACED = join(dir, "gate test big.txt").replace(/\\/g, "/");
const MID = join(dir, "gate test mid.txt").replace(/\\/g, "/");
const WIDE = join(dir, "gate test wide.txt").replace(/\\/g, "/");
const LOW = join(dir, "gate test low.txt").replace(/\\/g, "/");
writeFileSync(SPACED, "line\n".repeat(900));
writeFileSync(MID, ("x".repeat(999) + "\n").repeat(100));
writeFileSync(WIDE, ("x".repeat(299) + "\n").repeat(100));
writeFileSync(LOW, ("x".repeat(149) + "\n").repeat(100));
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const ps = (command) => ({ tool_name: "PowerShell", tool_input: { command } });
// Git Bash writes C:\ as /c/
const gitBashDir =
  process.platform === "win32"
    ? dir
        .replace(/^([A-Za-z]):/, (_, d) => "/" + d.toLowerCase())
        .replace(/\\/g, "/")
    : dir;

const cases = [
  [
    "Read big whole",
    "cap",
    { tool_name: "Read", tool_input: { file_path: B } },
  ],
  [
    "Read big targeted 100",
    "pass",
    {
      tool_name: "Read",
      tool_input: { file_path: B, offset: 100, limit: 100 },
    },
  ],
  [
    "Read big offset-only",
    "cap",
    { tool_name: "Read", tool_input: { file_path: B, offset: 100 } },
  ],
  [
    "Read big tail via offset 7400",
    "pass",
    { tool_name: "Read", tool_input: { file_path: B, offset: 7400 } },
  ],
  [
    "Read small",
    "pass",
    { tool_name: "Read", tool_input: { file_path: join(dir, "small.md") } },
  ],
  [
    "Read png",
    "pass",
    { tool_name: "Read", tool_input: { file_path: join(dir, "picture.png") } },
  ],
  [
    "Read missing",
    "pass",
    { tool_name: "Read", tool_input: { file_path: join(dir, "nope.txt") } },
  ],
  [
    "relative cat in opted-out project",
    "pass",
    { tool_name: "Bash", tool_input: { command: "cat big.txt" }, cwd: optOut },
  ],
  [
    "PS Get-Content -Path quoted",
    "deny",
    {
      tool_name: "PowerShell",
      tool_input: { command: `Get-Content -Path "${B}"` },
    },
  ],
  [
    "PS Get-Content -TotalCount 40",
    "pass",
    {
      tool_name: "PowerShell",
      tool_input: { command: "Get-Content big.txt -TotalCount 40" },
    },
  ],
  [
    "PS type big",
    "deny",
    { tool_name: "PowerShell", tool_input: { command: `type "${B}"` } },
  ],
  [
    "Grep tool ignored",
    "pass",
    { tool_name: "Grep", tool_input: { pattern: "x", path: B } },
  ],
  [
    "opted-out project Read",
    "pass",
    {
      tool_name: "Read",
      tool_input: { file_path: join(optOut, "big.txt") },
      cwd: join(optOut, "tools"),
    },
  ],
  [
    "relative Read big",
    "cap",
    { tool_name: "Read", tool_input: { file_path: "big.txt" } },
  ],
  [
    "Git Bash cwd, relative cat",
    "deny",
    {
      tool_name: "Bash",
      tool_input: { command: "cat big.txt" },
      cwd: gitBashDir,
    },
  ],
  // pipes and redirects: only a filter, a line limit or a file as the target lets a dump through
  [
    "cat piped into grep",
    "pass",
    {
      tool_name: "Bash",
      tool_input: { command: "cat big.txt | grep 'line 7'" },
    },
  ],
  [
    "cat piped into head -20",
    "pass",
    { tool_name: "Bash", tool_input: { command: "cat big.txt | head -20" } },
  ],
  [
    "cat redirected to a file",
    "pass",
    { tool_name: "Bash", tool_input: { command: "cat big.txt > copy.txt" } },
  ],
  [
    "cat piped into tee",
    "deny",
    {
      tool_name: "Bash",
      tool_input: { command: "cat big.txt | tee copy.txt" },
    },
  ],
  [
    "cat with only errors redirected",
    "deny",
    { tool_name: "Bash", tool_input: { command: "cat big.txt 2>/dev/null" } },
  ],
  [
    "cat with input redirect",
    "deny",
    { tool_name: "Bash", tool_input: { command: "cat < big.txt" } },
  ],
  [
    "tail -n +5 (to the end)",
    "deny",
    { tool_name: "Bash", tool_input: { command: "tail -n +5 big.txt" } },
  ],
  [
    "tail -n 30",
    "pass",
    { tool_name: "Bash", tool_input: { command: "tail -n 30 big.txt" } },
  ],
  [
    "cat after && and a variable",
    "deny",
    {
      tool_name: "Bash",
      tool_input: { command: "cd . && LANG=C cat big.txt" },
    },
  ],
  [
    "semicolon inside a string is not a new command",
    "pass",
    { tool_name: "Bash", tool_input: { command: 'echo "done; cat big.txt"' } },
  ],
  [
    "cat inside a heredoc body is text",
    "pass",
    {
      tool_name: "Bash",
      tool_input: { command: "node - <<'EOF'\ncat big.txt\nEOF" },
    },
  ],
  [
    "cat of a missing file",
    "pass",
    { tool_name: "Bash", tool_input: { command: "cat nope.txt" } },
  ],
  [
    "bash -c carries a dump",
    "deny",
    { tool_name: "Bash", tool_input: { command: "bash -c 'cat big.txt'" } },
  ],
  [
    "powershell -Command carries a dump",
    "deny",
    {
      tool_name: "Bash",
      tool_input: {
        command: "powershell -NoProfile -Command 'Get-Content big.txt'",
      },
    },
  ],
  [
    "powershell -Command with a line limit",
    "pass",
    {
      tool_name: "Bash",
      tool_input: {
        command:
          "powershell -NoProfile -Command 'Get-Content big.txt -TotalCount 40'",
      },
    },
  ],
  [
    "PS Get-Content piped into Select-Object -First",
    "pass",
    {
      tool_name: "PowerShell",
      tool_input: { command: "Get-Content big.txt | Select-Object -First 20" },
    },
  ],
  [
    "PS Get-Content piped into Out-Host",
    "deny",
    {
      tool_name: "PowerShell",
      tool_input: { command: "Get-Content big.txt | Out-Host" },
    },
  ],
  // absolute paths: filters, limits, quoting, comments, heredocs, options, nested shells
  ["pipe into head -2000", "deny", bash(`cat ${F} | head -2000`)],
  ["pipe into tail -n +2", "deny", bash(`cat ${F} | tail -n +2`)],
  [
    "tee, then to /dev/null",
    "pass",
    bash(`cat ${F} | tee copy.txt > /dev/null`),
  ],
  ["2>&1", "deny", bash(`cat ${F} 2>&1`)],
  [
    "PS pipe into Select-String",
    "pass",
    ps(`Get-Content ${B} | Select-String import`),
  ],
  ["pipe inside quotes, then cat", "deny", bash(`echo "a | b" && cat ${F}`)],
  ["quoted name with a space", "deny", bash(`cat "${SPACED}"`)],
  ["escaped spaces", "deny", bash(`cat ${SPACED.replace(/ /g, "\\ ")}`)],
  ["PS quoted name with a space", "deny", ps(`Get-Content '${SPACED}'`)],
  [
    "note with an apostrophe after a big cat",
    "deny",
    bash(`cat ${F}\n\n# WHAT THIS DOES: Shows the file; it's big.`),
  ],
  [
    "note that names a big file",
    "pass",
    bash(`ls\n\n# WHAT THIS DOES: Doesn't cat ${F}; only lists the folder.`),
  ],
  [
    "heredoc body is not a command (absolute)",
    "pass",
    bash(`node - <<'EOF'\ncat ${F}\nEOF`),
  ],
  [
    "command after a heredoc",
    "deny",
    bash(`node - <<'EOF'\nconsole.log(1)\nEOF\ncat ${F}`),
  ],
  [
    "VAR=value and a path before cat",
    "deny",
    bash(`LC_ALL=C /usr/bin/cat ${F}`),
  ],
  ["inside a loop", "deny", bash(`for i in 1 2; do cat ${F}; done`)],
  ["cat -n is not a line count", "deny", bash(`cat -n ${F}`)],
  ["head -n -5 is nearly the whole file", "deny", bash(`head -n -5 ${F}`)],
  ["head -n 40", "pass", bash(`head -n 40 ${F}`)],
  ["head --lines=2000", "deny", bash(`head --lines=2000 ${F}`)],
  ["head -c 2000", "pass", bash(`head -c 2000 ${F}`)],
  ["missing file before a big one", "deny", bash(`cat nope.txt ${F}`)],
  ["PS -TotalCount:40", "pass", ps(`Get-Content ${B} -TotalCount:40`)],
  ["PS -Tail 2000", "deny", ps(`Get-Content ${B} -Tail 2000`)],
  [
    "powershell -Command piped to grep",
    "pass",
    bash(`powershell -NoProfile -Command 'Get-Content ${F}' | grep import`),
  ],
  ["bash -c with an absolute path", "deny", bash(`bash -c "cat ${F}"`)],
  [
    "Read 100 lines of 1000 bytes (100 KB) whole",
    "cap",
    { tool_name: "Read", tool_input: { file_path: MID } },
  ],
  [
    "Read 100 KB file, limit 20",
    "pass",
    { tool_name: "Read", tool_input: { file_path: MID, limit: 20 } },
  ],
  [
    "Read 100 lines of 300 bytes (30 KB) whole",
    "pass",
    { tool_name: "Read", tool_input: { file_path: WIDE } },
  ],
  [
    "Read 15 KB file whole",
    "pass",
    { tool_name: "Read", tool_input: { file_path: LOW } },
  ],
  ["cat of the 100 KB file", "deny", bash(`cat "${MID}"`)],
];
let fail = 0;
for (const [name, want, ev] of cases) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: dir, ...ev }),
  });
  // cap: a too-big Read runs with its limit cut to what fits (updatedInput), not refused
  const out = r.stdout.toString();
  const got = out.includes('"deny"')
    ? "deny"
    : out.includes("updatedInput")
      ? "cap"
      : "pass";
  if (got !== want) fail++;
  console.log(`${got === want ? "ok  " : "FAIL"} ${name}: ${got}`);
}
// The cap note: a worker subagent with a type, no Codex, no free worker, and a limit that fits the byte limit
const capOut = JSON.parse(
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: MID },
    }),
  }).stdout.toString(),
).hookSpecificOutput;
const denyText = capOut.additionalContext;
// A ranged Read whose limit is over 350 lines: the text names the range, not a whole-file read
const rangeText = JSON.parse(
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: B, offset: 100, limit: 600 },
    }),
  }).stdout.toString(),
).hookSpecificOutput;
for (const [name, ok] of [
  [
    "FAIL if a ranged Read over 350 lines is refused, not cut to lines 100-449",
    rangeText.updatedInput?.limit === 350 &&
      rangeText.updatedInput?.offset === 100 &&
      /returns only lines 100-449/.test(rangeText.additionalContext),
  ],
  [
    "FAIL if a whole Read of the 100 KB file is not cut to the 80 lines that fit",
    capOut.updatedInput?.limit === 80 &&
      /returns only lines 1-80/.test(denyText),
  ],
  [
    "FAIL if a whole Read of a big file returns more than the 120-line preview",
    JSON.parse(
      spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify({
          tool_name: "Read",
          tool_input: { file_path: B },
        }),
      }).stdout.toString(),
    ).hookSpecificOutput.updatedInput?.limit === 120,
  ],
  [
    "text: subagent_type worker on its own model (Opus), no sonnet",
    /subagent_type: "worker" \(Agent tool\)/.test(denyText) &&
      !/model: "sonnet"/.test(denyText),
  ],
  ["text: no ask.mjs or free worker", !/ask.mjs|free worker/.test(denyText)],
  ["text: no Codex", !/codex/i.test(denyText)],
]) {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
// A big .md refusal lists its headings with line numbers (none from inside ``` fences, at most 40); other types don't
const reasonFor = (file) =>
  JSON.parse(
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        tool_name: "Read",
        tool_input: { file_path: file },
      }),
    }).stdout.toString(),
  ).hookSpecificOutput.additionalContext;
const filler = "text\n".repeat(200);
const MD = join(dir, "doc.md");
writeFileSync(
  MD,
  `# Title\n${filler}## Part one\n\`\`\`sh\n# a shell comment\n\`\`\`\n${filler}### Part two\n${filler}`,
);
const mdText = reasonFor(MD);
const MANY = join(dir, "many.md");
writeFileSync(
  MANY,
  Array.from(
    { length: 45 },
    (_, i) => `## H${i + 1}\n${"text\n".repeat(9)}`,
  ).join(""),
);
const manyText = reasonFor(MANY);
for (const [name, ok] of [
  [
    "md: headings with line numbers",
    /\nHeadings:\n1: # Title\n202: ## Part one\n406: ### Part two$/.test(
      mdText,
    ),
  ],
  ["md: no heading from inside a fence", !/a shell comment/.test(mdText)],
  [
    "md: capped at 40 headings, then (5 more)",
    /\n391: ## H40\n\(5 more\)$/.test(manyText) && !/H41/.test(manyText),
  ],
  [
    "txt: no headings list",
    !/Headings:/.test(reasonFor(B)) &&
      reasonFor(B).endsWith("confirm them with a targeted Read."),
  ],
]) {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
// A Read of a file that does not exist passes and logs no crash (the Read tool reports it itself)
const LOG = join(dir, "crash.log");
const gone = spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({
    tool_name: "Read",
    tool_input: { file_path: join(dir, "no-such-dir", "none.txt") },
  }),
  env: { ...process.env, HOOK_ERRORS_LOG: LOG },
});
const goneOk = !gone.stdout.toString().includes('"deny"') && !existsSync(LOG);
if (!goneOk) fail++;
console.log(`${goneOk ? "ok  " : "FAIL"} missing file: pass, no crash logged`);
// Office documents: refused with the markitdown command when uvx is on the PATH, passed without it; a PDF and a
// small .md pass either way. The PATH holds only a folder with a stand-in uvx, or only an empty folder.
const withUvx = join(dir, "with-uvx"),
  noUvx = join(dir, "no-uvx");
mkdirSync(withUvx);
mkdirSync(noUvx);
writeFileSync(
  join(withUvx, process.platform === "win32" ? "uvx.exe" : "uvx"),
  "",
  { mode: 0o755 },
);
const DOCX = join(dir, "report.docx");
writeFileSync(DOCX, Buffer.alloc(5000));
writeFileSync(join(dir, "paper.pdf"), Buffer.alloc(5000));
const envNoPath = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"),
); // Windows names it Path
const readWith = (file, pathDir) =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      cwd: dir,
      tool_name: "Read",
      tool_input: { file_path: file },
    }),
    env: { ...envNoPath, PATH: pathDir },
  }).stdout.toString();
const docDeny = readWith(DOCX, withUvx);
let docReason = "";
try {
  docReason = JSON.parse(docDeny).hookSpecificOutput.permissionDecisionReason;
} catch {}
for (const [name, ok] of [
  [
    ".docx with uvx: refused, names markitdown and the file",
    /"deny"/.test(docDeny) &&
      docReason.includes('uvx --from "markitdown[all]" markitdown') &&
      docReason.includes(`"${DOCX}.md"`),
  ],
  [".docx without uvx: passes, no note", readWith(DOCX, noUvx) === ""],
  [".pdf with uvx: passes", readWith(join(dir, "paper.pdf"), withUvx) === ""],
  [
    ".md with uvx: unchanged (small file passes)",
    readWith(join(dir, "small.md"), withUvx) === "",
  ],
]) {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
