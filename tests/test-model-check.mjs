// Tests for setup-audit's model-check.mjs (skills/setup-audit/scripts/model-check.mjs): it compares the model a
// helper really ran on (`message.model` in the run's log) with the model it should have run on (the agent
// file's `model:` for a default launch, else the `.meta.json` `model` field), so a Claude Code update that
// breaks agent `model:` is seen. Each case is a helper run in a temp home.
// Run: node tests/test-model-check.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "..",
  "skills",
  "setup-audit",
  "scripts",
  "model-check.mjs",
);
let fails = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "model-check-test-"));
const DAY = 86_400_000;

// A home with the given agent files ({ name: model }) and no runs yet
function home(name, agents = {}) {
  const h = path.join(tmp, name);
  fs.mkdirSync(path.join(h, "agents"), { recursive: true });
  fs.mkdirSync(path.join(h, "projects"), { recursive: true });
  for (const [a, model] of Object.entries(agents))
    fs.writeFileSync(
      path.join(h, "agents", `${a}.md`),
      `---\nname: ${a}\ndescription: x\nmodel: ${model}\n---\nbody\n`,
    );
  return h;
}

// One helper run: its .meta.json and a .jsonl log whose assistant lines carry `models`. `ageDays` sets both files' times.
function run(h, id, meta, models, ageDays = 1) {
  const dir = path.join(h, "projects", "C--proj", "chat-1", "subagents");
  fs.mkdirSync(dir, { recursive: true });
  const metaFile = path.join(dir, `agent-${id}.meta.json`);
  const log = path.join(dir, `agent-${id}.jsonl`);
  fs.writeFileSync(
    metaFile,
    JSON.stringify({ isBuiltIn: false, spawnDepth: 1, ...meta }),
  );
  const lines = [
    { type: "user", message: { role: "user", content: "go" } },
    // a tool result that only quotes a model name must not count as the run's model
    {
      type: "user",
      message: { role: "user", content: '{"model":"claude-haiku-5-5"}' },
    },
    ...models.map((m) => ({
      type: "assistant",
      message: { model: m, role: "assistant", content: [] },
    })),
  ];
  fs.writeFileSync(log, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const t = new Date(Date.now() - ageDays * DAY);
  fs.utimesSync(metaFile, t, t);
  fs.utimesSync(log, t, t);
}

const check = (h, ...args) =>
  spawnSync(process.execPath, [SCRIPT, "--home", h, ...args], {
    encoding: "utf8",
  });

// The five runs of the spec's D3, plus one run older than the window
const main = home("main", { "worker-code": "opus", worker: "sonnet" });
// 1. a matching run with a full id
run(
  main,
  "full",
  {
    agentType: "general-purpose",
    model: "claude-opus-5-5",
    pickedEffortModel: "claude-opus-5-5",
  },
  ["claude-opus-5-5", "claude-opus-5-5"],
);
// 2. "model":"sonnet" and the log says claude-sonnet-5-5: a short name matches its family
run(
  main,
  "short",
  {
    agentType: "general-purpose",
    model: "sonnet",
    pickedEffortModel: "claude-opus-5-5",
  },
  ["claude-sonnet-5-5"],
);
// 3. no model field and no agent file: skipped
run(main, "none", { agentType: "Explore", isBuiltIn: true }, [
  "claude-haiku-5-5",
]);
// 4. a default launch: the agent file says opus, the log says sonnet: mismatch (the meta's model is not trusted)
run(
  main,
  "broken",
  {
    agentType: "worker-code",
    launchedWithDefaults: true,
    model: "claude-opus-5-5",
    pickedEffortModel: "claude-opus-5-5",
  },
  ["claude-sonnet-5-5"],
);
// 5. pickedEffortModel names the session's model, message.model matches: match
run(
  main,
  "picked",
  {
    agentType: "worker",
    launchedWithDefaults: true,
    model: "claude-sonnet-5-5",
    pickedEffortModel: "claude-opus-5-5",
  },
  ["claude-sonnet-5-5"],
);
// outside the 30-day window: a mismatch that must not be read
run(
  main,
  "old",
  { agentType: "worker-code", launchedWithDefaults: true },
  ["claude-haiku-5-5"],
  40,
);

{
  const r = check(main);
  const out = r.stdout + r.stderr;
  ok(
    "a mismatch makes the check exit 1",
    r.status === 1,
    `exit ${r.status}\n${out}`,
  );
  const lines = out.split("\n").filter((l) => /^MISMATCH/.test(l));
  ok(
    "exactly one mismatch line: the default worker-code run whose log says sonnet",
    lines.length === 1 &&
      /agent-broken/.test(lines[0]) &&
      /opus/.test(lines[0]) &&
      /claude-sonnet-5-5/.test(lines[0]),
    `\n${out}`,
  );
  ok(
    "counts: 4 checked, 3 matched (full id, short name, pickedEffortModel ignored), 1 skipped (no expected model)",
    /checked 4\b/.test(out) &&
      /matched 3\b/.test(out) &&
      /skipped 1\b/.test(out),
    `\n${out}`,
  );
  ok("a run older than --days is not read", !/agent-old/.test(out), `\n${out}`);
}

// --days widens the window: the old run is read and is a second mismatch (expected opus, log haiku)
{
  const r = check(main, "--days", "60");
  const out = r.stdout + r.stderr;
  ok(
    "--days 60 reads the 40-day-old run",
    /MISMATCH.*agent-old/.test(out) && /checked 5\b/.test(out),
    `\n${out}`,
  );
}

// --sample caps how many runs are read (the newest first)
{
  const r = check(main, "--sample", "2");
  const out = r.stdout + r.stderr;
  const counted = out.match(/checked (\d+).*skipped (\d+)/);
  ok(
    "--sample 2 reads at most 2 runs",
    counted && Number(counted[1]) + Number(counted[2]) === 2,
    `\n${out}`,
  );
}

// all matches: exit 0
{
  const h = home("good", { worker: "sonnet" });
  run(
    h,
    "a",
    {
      agentType: "worker",
      launchedWithDefaults: true,
      model: "claude-sonnet-5-5",
      pickedEffortModel: "claude-opus-5-5",
    },
    ["claude-sonnet-5-5"],
  );
  const r = check(h);
  ok(
    "no mismatch: exit 0",
    r.status === 0 && /matched 1\b/.test(r.stdout),
    `exit ${r.status}\n${r.stdout}${r.stderr}`,
  );
}

// no runs at all: "0 runs", exit 0
{
  const r = check(home("empty"));
  ok(
    'no helper runs: prints "0 runs" and exits 0',
    r.status === 0 && /\b0 runs\b/.test(r.stdout),
    `exit ${r.status}\n${r.stdout}${r.stderr}`,
  );
}

// a home with no projects folder is an error, not "0 runs"
{
  const r = check(path.join(tmp, "missing"));
  ok(
    "a home with no projects folder fails with a clear error",
    r.status !== 0 && r.status !== 1 && /projects/.test(r.stderr),
    `exit ${r.status}\n${r.stdout}${r.stderr}`,
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
