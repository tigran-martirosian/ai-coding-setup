#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(
  new URL("../workers/usage-report.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "usage-report-test-"));
const HOME = path.join(tmp, ".claude");
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  ${extra}`}`);
};

// ---- build a fake home with one transcript ----
const proj = path.join(HOME, "projects", "C--work");
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(path.join(HOME, "skills", "my-skill"), { recursive: true }); // a skill the person added
fs.mkdirSync(path.join(HOME, "skills", "handoff"), { recursive: true }); // shipped: must NOT count as added
// the person's own command, and a project whose own command carries the project's name: neither may be reported
fs.mkdirSync(path.join(HOME, "commands"), { recursive: true });
fs.writeFileSync(path.join(HOME, "commands", "my-command.md"), "x");
const PROJECT = path.join(tmp, "acme-project");
fs.mkdirSync(path.join(PROJECT, ".claude", "commands"), { recursive: true });
fs.writeFileSync(
  path.join(PROJECT, ".claude", "commands", "acme-deploy.md"),
  "x",
);
fs.mkdirSync(path.join(PROJECT, ".claude", "skills", "acme-build"), {
  recursive: true,
});
// harder ones: a nested command, a capitalised file name, a linked skill folder, all typed from a subfolder
fs.mkdirSync(path.join(PROJECT, ".claude", "commands", "team"), {
  recursive: true,
});
fs.writeFileSync(
  path.join(PROJECT, ".claude", "commands", "team", "acme-nested.md"),
  "x",
);
fs.writeFileSync(
  path.join(PROJECT, ".claude", "commands", "Acme-Caps.md"),
  "x",
);
const LINKED = path.join(tmp, "elsewhere", "acme-linked");
fs.mkdirSync(LINKED, { recursive: true });
fs.symlinkSync(
  LINKED,
  path.join(PROJECT, ".claude", "skills", "acme-linked"),
  "junction",
);
const SUB = path.join(PROJECT, "src", "deep");
fs.mkdirSync(SUB, { recursive: true });
// an MCP server the person added in the Claude config beside the home
fs.writeFileSync(
  path.join(tmp, ".claude.json"),
  JSON.stringify({ mcpServers: { "some-server": {}, "notes-mcp": {} } }),
);
// a guard switched off (DELETE_GUARD is a real setup switch); SOMETHING_ELSE is on; MY_PRIVATE_FLAG is off but is
// NOT a setup switch, so it must never be reported (the allow-list keeps a user's own env var names private).
fs.writeFileSync(
  path.join(HOME, "settings.json"),
  JSON.stringify({
    env: { DELETE_GUARD: "off", SOMETHING_ELSE: "on", MY_PRIVATE_FLAG: "off" },
  }),
);

const t0 = "2026-11-27T10:00:00.000Z";
const t1 = "2026-11-27T10:02:00.000Z"; // 2 min later → "1to5m" wait bucket
const lines = [
  {
    type: "user",
    cwd: SUB,
    message: { role: "user", content: "/excel build me a sheet" },
  }, // unknown command
  ...["/acme-nested", "/ACME-CAPS", "/acme-linked"].map((content) => ({
    type: "user",
    cwd: SUB,
    message: { role: "user", content },
  })), // the project's own, found from a subfolder: nested, any case, linked
  { type: "user", message: { role: "user", content: "/acme-nocwd" } }, // no folder: can't be checked, never sent
  { type: "user", cwd: SUB, message: { role: "user", content: "/handoff" } }, // shipped command: not missing
  { type: "user", cwd: SUB, message: { role: "user", content: "/my-command" } }, // the person's own command
  {
    type: "user",
    cwd: PROJECT,
    message: { role: "user", content: "/acme-deploy now" },
  }, // the project's own command
  {
    type: "user",
    cwd: PROJECT,
    message: { role: "user", content: "/acme-build" },
  }, // the project's own skill
  {
    type: "user",
    message: { role: "user", content: "/acmeplugin:release" },
  }, // a plugin command: the plugin's name is never sent
  {
    type: "user",
    message: { role: "user", content: "/tmp/scratch/notes.txt has it" },
  }, // a pasted path, NOT a command
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "r1",
          name: "Read",
          input: { file_path: "C:/secret/budget.xlsx" },
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "w1",
          name: "Write",
          input: { file_path: "/home/someone/report.sql" },
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "b1",
          name: "Bash",
          // listed: python, excel (via start), excel (via COM), docker; NOT listed: cd, grep, a project script
          input: {
            command:
              "cd C:/secret && FOO=1 python tools/q.py | grep x; ./budget-tool --run; start excel; " +
              'powershell -c "New-Object -ComObject Excel.Application"\n"C:/Program Files/Docker/docker.exe" ps',
          },
        },
      ],
    },
  },
  {
    type: "assistant",
    timestamp: t0,
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "q1", name: "AskUserQuestion", input: {} },
      ],
    },
  },
  {
    type: "user",
    timestamp: t1,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "q1", content: "answered" },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "e1",
          is_error: true,
          content: "boom",
        },
      ],
    },
    toolUseResult: { exitCode: 2, stderr: "nope" },
  },
];
fs.writeFileSync(
  path.join(proj, "sess-aaaa.jsonl"),
  lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
);

// Neutralise an ambient USAGE_REPORT=off (the real machine may set it) so the base env never pre-disables the
// collector; a case that wants it off passes USAGE_REPORT:"off" in extraEnv, which overrides this.
function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [WORKER, ...args], {
    env: {
      ...process.env,
      USAGE_REPORT: "",
      USAGE_REPORT_URL: "http://127.0.0.1:9/usage",
      USAGE_REPORT_HOME: HOME,
      USAGE_REPORT_NOW: String(Date.parse("2026-11-27T20:00:00Z")),
      ...extraEnv,
    },
    encoding: "utf8",
  });
}
// Async run: a parent-hosted server can only answer the child while the parent's event loop runs, so the send
// step (which talks to the local sink) must NOT use the blocking spawnSync.
function runAsync(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [WORKER, ...args], {
      env: {
        ...process.env,
        USAGE_REPORT: "",
        USAGE_REPORT_URL: "http://127.0.0.1:9/usage",
        USAGE_REPORT_HOME: HOME,
        ...extraEnv,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ status: code, stderr: err }));
  });
}
const pending = () =>
  JSON.parse(
    fs.readFileSync(path.join(HOME, "usage-report", "pending.json"), "utf8"),
  );

// ---- scan ----
run(["--scan"]);
const p = pending();
const day = p.byDate["2026-11-27"];
check(
  "scan wrote one day bucket",
  !!day,
  JSON.stringify(Object.keys(p.byDate)),
);
check(
  "unknown command /excel counted",
  day.missing.excel === 1,
  JSON.stringify(day.missing),
);
check(
  "shipped command /handoff not counted as missing",
  day.missing.handoff === undefined,
);
check(
  "the person's own, project and plugin commands are not reported",
  ["my-command", "acme-deploy", "acme-build", "acmeplugin"].every(
    (n) => day.missing[n] === undefined,
  ),
  JSON.stringify(day.missing),
);
check(
  "nested, capitalised and linked project commands, and a line with no folder, are not reported",
  ["acme-nested", "acme-caps", "acme-linked", "acme-nocwd"].every(
    (n) => day.missing[n] === undefined,
  ),
  JSON.stringify(day.missing),
);
check(
  "a pasted path is not read as a missing command",
  day.missing.tmp === undefined,
  JSON.stringify(day.missing),
);
check(
  "file extensions counted, no paths",
  day.fileTypes[".xlsx"] === 1 && day.fileTypes[".sql"] === 1,
  JSON.stringify(day.fileTypes),
);
check(
  "listed programs from shell commands counted by name",
  day.programs?.python === 1 && day.programs?.excel === 2,
  JSON.stringify(day.programs),
);
check(
  "unlisted words (cd, grep, a project script) never counted",
  Object.keys(day.programs || {}).every((k) =>
    ["python", "excel", "docker"].includes(k),
  ),
  JSON.stringify(day.programs),
);
check(
  "a quoted path to a listed program counts as its bare name",
  day.programs?.docker === 1,
  JSON.stringify(day.programs),
);
check(
  "a question wait is counted",
  day.friction.waits === 1,
  JSON.stringify(day.friction),
);
check(
  "the wait lands in the 1to5m bucket",
  day.friction.waitBuckets["1to5m"] === 1,
  JSON.stringify(day.friction.waitBuckets),
);
check("a tool error is counted", day.friction.toolErrors === 1);
check("a non-zero shell exit is counted", day.friction.shellFails === 1);
check(
  "guard switched off is reported by name",
  day.friction.guardsOff.includes("delete-guard"),
  JSON.stringify(day.friction.guardsOff),
);
check(
  "an on-switch is not reported",
  !day.friction.guardsOff.includes("something-else"),
);
check(
  "a non-setup key set to off is not reported (allow-list)",
  !day.friction.guardsOff.includes("my-private-flag"),
  JSON.stringify(day.friction.guardsOff),
);
check(
  "an added skill is reported, shipped one is not",
  day.added.skills.includes("my-skill") &&
    !day.added.skills.includes("handoff"),
  JSON.stringify(day.added.skills),
);
check(
  "added MCP servers are reported by name",
  day.added.mcp.includes("some-server") && day.added.mcp.includes("notes-mcp"),
  JSON.stringify(day.added.mcp),
);
check(
  "a label is assigned once for the session",
  Object.values(day.labels).reduce((a, b) => a + b, 0) === 1,
  JSON.stringify(day.labels),
);
check(
  "the label is content-free (spreadsheet/sql/coding...)",
  day.labels.spreadsheet === 1 || day.labels.sql === 1,
  JSON.stringify(day.labels),
);

// No stored string anywhere may look like a path, URL, email or account. The aggregate's JSON has no "/", "\" or
// "@" of its own, so any such character would be leaked content; the source words must not appear either.
const flat = JSON.stringify(day);
check(
  "no path, URL, email or account anywhere in the aggregate",
  !/[\\/@]|budget|secret|query|\bhim\b/.test(flat),
  flat,
);

// ---- send to a fake sink ----
let received = null;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received = {
      path: req.url,
      key: req.headers["x-usage-key"],
      body: JSON.parse(body),
    };
    res.writeHead(200).end("stored");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/usage`;

// Send with "now" one day later so 2026-11-27 is a finished, unsent day.
const sendRes = await runAsync(["--send"], {
  USAGE_REPORT_URL: url,
  USAGE_REPORT_KEY: "test-key",
  USAGE_REPORT_NOW: String(Date.parse("2026-11-28T20:00:00Z")),
});
server.close();

check("send exited cleanly", sendRes.status === 0, sendRes.stderr);
check(
  "the sink received a POST to /usage with the key",
  received?.path === "/usage" && received?.key === "test-key",
  JSON.stringify(received?.path),
);
check(
  "the sent body carries v:1, a uuid id and the date",
  received?.body?.v === 1 &&
    /^[0-9a-f-]{36}$/.test(received?.body?.id || "") &&
    received?.body?.date === "2026-11-27",
);
check(
  "the sent body carries the counts",
  received?.body?.missing?.excel === 1 &&
    received?.body?.fileTypes?.[".xlsx"] === 1 &&
    received?.body?.programs?.python === 1,
);
const p2 = pending();
check(
  "the sent day is rolled out of pending",
  p2.byDate["2026-11-27"] === undefined && p2.sentDates.includes("2026-11-27"),
);

// ---- off switch ----
fs.rmSync(path.join(HOME, "usage-report"), { recursive: true, force: true });
run(["--scan"], { USAGE_REPORT: "off" });
check(
  "USAGE_REPORT=off: no scan, no pending file written",
  !fs.existsSync(path.join(HOME, "usage-report", "pending.json")),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
