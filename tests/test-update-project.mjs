// Tests for skills/update-project/pass.mjs: --check on a made-up folder raises each check id (P1 to P12), and the
// stamp modes (--done with --kept, --skip, --skip-all, --list) write ~/.claude/project-pass.json as the design says,
// and version.json's projectPass equals pass.mjs's LEVEL.
// Everything happens in a temporary home folder (--home), so the real ~/.claude is never read or written.
// Run: node tests/test-update-project.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEVEL } from "../skills/update-project/pass.mjs";

const PASS = fileURLToPath(
  new URL("../skills/update-project/pass.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "update-project-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${detail.trim().split("\n").join("\n     ")}`}`,
  );
};
const fwd = (p) => p.replace(/\\/g, "/");
const home = path.join(tmp, "home"),
  claude = path.join(home, ".claude");
const run = (...args) => {
  const r = spawnSync(process.execPath, [PASS, ...args, "--home", home], {
    encoding: "utf8",
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const stamp = () =>
  JSON.parse(fs.readFileSync(path.join(claude, "project-pass.json"), "utf8"));

// A made-up folder with one fault for each check. file-upkeep's checker is the real one, found beside pass.mjs.
const dir = path.join(tmp, "work"),
  key = fwd(dir);
write(path.join(dir, "CLAUDE.md"), "# Work\n\nA made-up project.\n"); // P2: no base lines
write(
  path.join(dir, "HANDOFF.md"),
  Array.from({ length: 130 }, (_, i) => `line ${i}`).join("\n") +
    "\nSee `docs/gone/old-plan.md`.\n",
); // P3, P8
write(
  path.join(dir, "DECISIONS.md"),
  "# Decisions\n\n- Use tabs. Replaced by the spaces rule.\n",
); // P4
write(path.join(dir, ".claude", "settings.json"), "{ not json"); // P5
write(path.join(dir, "docs", "HOW-TO.md"), "# How to\n"); // P6: an upper-case name
write(
  path.join(dir, "docs", "facts.md"),
  "# Facts\n\n- A fact with no date.\n",
); // P11
// no .claude/rules/: P1
spawnSync("git", ["init", "-q", dir]); // P7: all untracked
write(
  path.join(
    claude,
    "projects",
    key.replace(/[^A-Za-z0-9]/g, "-"),
    "memory",
    "note.md",
  ),
  "a memory note\n",
); // P8.memory
// P9 reads the recheck-dates hook (row C4); a stand-in prints one past and one ok line in its --list form
write(
  path.join(claude, "hooks", "recheck-dates.mjs"),
  'console.log("docs/facts.md:3  2026-01-01  past  - A fact.\\nCLAUDE.md:2  2099-01-01  ok  - Another.\\n1 past their recheck date, 1 within it");\n',
);

const first = run("--check", dir);
const lines = first.out.trim().split(/\r?\n/);
const ids = lines.slice(0, -1).map((l) => l.split(/\s+/)[0]);
const top = [...new Set(ids.map((i) => i.split(".")[0]))].sort(
  (a, b) => Number(a.slice(1)) - Number(b.slice(1)),
);
check(
  "--check exits 0 and ends with the summary line",
  first.code === 0 &&
    new RegExp(
      `^project-pass .+ · \\d+ to fix · \\d+ to ask · \\d+ notes · level ${LEVEL}$`,
    ).test(lines.at(-1)),
  first.out,
);
check(
  "--check raises every check id, P1 to P12",
  top.join() === Array.from({ length: 12 }, (_, i) => `P${i + 1}`).join(),
  top.join(),
);
check(
  "P1 once: the missing .claude/rules/ folder only",
  ids.filter((i) => i === "P1").length === 1 &&
    lines.some((l) => /^P1\s+fix\s+\.claude\/rules\//.test(l)),
);
check(
  "P2 lists each missing base line as its own id",
  ["P2.handoff", "P2.designs", "P2.standard", "P2.checks", "P2.tools"].every(
    (i) => ids.includes(i),
  ),
  ids.join(),
);
check(
  "P3, P4, P5, P10, P11 once each",
  ["P3", "P4", "P5", "P10", "P11"].every(
    (i) => ids.filter((x) => x === i).length === 1,
  ),
  ids.join(),
);
check(
  "P6 passes the checker's rename on",
  lines.some((l) => /^P6\s+fix\s+docs\/HOW-TO\.md/.test(l)),
  first.out,
);
check(
  "P7 groups the untracked entries by top folder",
  ids.includes("P7.docs") && ids.includes("P7.CLAUDE.md"),
  ids.join(),
);
check(
  "P8 names the missing path with its line, and the memory notes",
  lines.some(
    (l) =>
      l.startsWith("P8.docs/gone/old-plan.md") && l.includes("HANDOFF.md:131"),
  ) && ids.includes("P8.memory"),
  first.out,
);
check(
  "P9 lists the past fact only",
  ids.filter((i) => i.startsWith("P9")).join() === "P9.docs/facts.md:3",
  ids.join(),
);
check(
  "P12 asks for a map when the folder has none",
  lines.some((l) => /^P12\s+ask\s+\.claude\/systems-map\.json\s+no Systems map/.test(l)),
  first.out,
);
// P12 on a folder with a map: none of its things lists a ~/ file -> ask; one does -> nothing
const mapped = path.join(tmp, "mapped");
const node = (files) => ({ id: "a", name: "A", what: "A.", files });
write(path.join(mapped, ".claude", "systems-map.json"), JSON.stringify({ nodes: [node(["src/a.js"])], links: [] }));
const noHow = run("--check", mapped).out;
check(
  "P12 asks for how-to things when no thing lists a ~/ file",
  /^P12\s+ask\s+\S+\s+the map has no "how we do X" things/m.test(noHow),
  noHow,
);
write(path.join(mapped, ".claude", "systems-map.json"), JSON.stringify({ nodes: [node(["src/a.js"]), { ...node(["~/.claude/skills/web-research/SKILL.md"]), id: "b" }], links: [] }));
const withHow = run("--check", mapped).out;
check("P12 is quiet when the map has a how-to thing", !/^P12/m.test(withHow), withHow);
check(
  "--check writes nothing",
  !fs.existsSync(path.join(claude, "project-pass.json")),
);

// --list: the folder of the newest transcript in a projects folder, behind until stamped
write(
  path.join(claude, "projects", "some-slug", "s1.jsonl"),
  JSON.stringify({ type: "user", cwd: dir }) + "\n",
);
const listed = run("--list");
check(
  "--list names the folder from a transcript's cwd as behind",
  listed.code === 0 &&
    listed.out.includes(`${key}  behind  last used `) &&
    /· 1 behind ·/.test(listed.out),
  listed.out,
);

// --done with --kept: stamped at the level, the kept ids left out of the next check (P2 keeps every P2 sub-id)
const done = run("--done", dir, "--kept", "P4,P2");
const s = stamp();
check(
  "--done stamps the folder at the level with its kept ids",
  done.code === 0 &&
    s.level === LEVEL &&
    s.folders[key]?.done === LEVEL &&
    s.folders[key].kept.join() === "P4,P2" &&
    s.mode === "on-open",
  JSON.stringify(s),
);
const again = run("--check", dir).out;
check(
  "kept ids are left out of the next check",
  !/^P4\s/m.test(again) && !/^P2\./m.test(again) && /^P3\s/m.test(again),
  again,
);
run("--done", dir, "--kept", "P3");
check(
  "a later --done adds to the kept ids",
  stamp().folders[key].kept.join() === "P4,P2,P3",
);
check(
  "--list shows the folder as done",
  run("--list").out.includes(`${key}  done  `),
);

// --skip and --skip-all
const other = path.join(tmp, "other");
fs.mkdirSync(other);
check(
  "--skip writes the folder as declined at the level",
  run("--skip", other).code === 0 && stamp().declined[fwd(other)] === LEVEL,
);
check(
  "--skip-all writes declinedAll at the level",
  run("--skip-all").code === 0 && stamp().declinedAll === LEVEL,
);
check(
  "--done on a declined folder clears its decline",
  run("--done", other).code === 0 && !(fwd(other) in stamp().declined),
);
check(
  "--done with no folder stops with its reason",
  /--done needs a folder/.test(run("--done").out) && run("--done").code === 1,
);
write(path.join(claude, "project-pass.json"), "{ broken");
check(
  "a stamp file that is not JSON stops with its name",
  run("--status").code === 1 &&
    /project-pass\.json is not valid JSON/.test(run("--status").out),
);

// The two levels move together: raised in one only, pass.mjs writes its own level back and every folder shows behind
const released = JSON.parse(
  fs.readFileSync(new URL("../version.json", import.meta.url), "utf8"),
).projectPass;
check(
  "version.json projectPass equals pass.mjs LEVEL",
  released === LEVEL,
  `version.json projectPass ${released}, pass.mjs LEVEL ${LEVEL}: raise both`,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
