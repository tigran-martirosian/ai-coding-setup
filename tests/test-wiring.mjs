// One check of the hook table: settings.example.json (and each project folder's own settings.json) against the files.
// Every wired command resolves to a file; every file in hooks/ is wired (a library lives in hooks/lib/);
// what _setup calls retired is neither wired nor shipped. A `hooks/dispatch.mjs <group>` command runs the hooks of
// that group in hooks/dispatch-groups.json, so they count as wired on its event. Run: node tests/test-wiring.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const commandsIn = (settings) =>
  Object.values(settings.hooks || {})
    .flat()
    .flatMap((g) => g.hooks)
    .map((h) => h.command);
// the script a command starts: "node ~/.claude/x/y.mjs --arg" -> "x/y.mjs"; "node .claude/hooks/z.mjs" -> ".claude/hooks/z.mjs"
const scriptOf = (command) => command.match(/^node (?:~\/\.claude\/)?(\S+)/)[1];

const example = json(path.join(REPO, "settings.example.json"));
const setup = example._setup;
ok(
  "_setup has retired, retiredInHomes, retiredEntries and oldMatchers",
  ["retired", "retiredInHomes", "retiredEntries", "oldMatchers"].map(
    (k) => k in setup,
  ),
  [true, true, true, true],
);

const groups = json(path.join(REPO, "hooks", "dispatch-groups.json"));
const groupOf = (command) => command.match(/hooks\/dispatch\.mjs\s+(\S+)/)?.[1];
ok(
  "every dispatch.mjs command names a group of hooks/dispatch-groups.json",
  commandsIn(example).filter(
    (c) => groupOf(c) && !Array.isArray(groups[groupOf(c)]),
  ),
  [],
);
// Node runs a module once per process: a file a group lists twice would run once, its second entry doing nothing
ok(
  "no group of hooks/dispatch-groups.json lists one file twice",
  Object.entries(groups).flatMap(([name, list]) =>
    list
      .map((e) => e.hook.toLowerCase())
      .filter((f, i, all) => all.indexOf(f) !== i)
      .map((f) => `${name}: ${f}`),
  ),
  [],
);
// Each hook an event runs, as "hooks/x.mjs --arg": an entry, or a hook of the group it runs
const runsOn = (event) =>
  (example.hooks[event] || [])
    .flatMap((g) => g.hooks)
    .flatMap((h) =>
      groupOf(h.command)
        ? groups[groupOf(h.command)].map((e) =>
            [e.hook, ...(e.args ?? [])].join(" "),
          )
        : [h.command.replace(/^node (?:~\/\.claude\/)?/, "")],
    );

// every command of the example and every hook of its groups resolves to a file in the repo
const wired = [
  ...new Set([
    ...commandsIn(example).map(scriptOf),
    ...Object.keys(example.hooks)
      .flatMap(runsOn)
      .map((r) => r.split(" ")[0]),
  ]),
];
ok(
  "every command in settings.example.json names a file in the repo",
  wired.filter((s) => !fs.existsSync(path.join(REPO, s))),
  [],
);

// every hook file is wired, or run from an agent's own frontmatter (planner-readonly), or a library (hooks/lib/)
const hookFiles = fs
  .readdirSync(path.join(REPO, "hooks"), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name !== "dispatch-groups.json") // the table dispatch.mjs reads
  .map((e) => e.name);
const agentRun = fs
  .readdirSync(path.join(REPO, "agents"))
  .filter((n) => n.endsWith(".md"))
  .flatMap((n) =>
    [
      ...fs
        .readFileSync(path.join(REPO, "agents", n), "utf8")
        .matchAll(/command: "?(node [^"\n]+)/g),
    ].map((m) => scriptOf(m[1])),
  );
ok(
  "every file in hooks/ is wired in settings.example.json or an agent's frontmatter",
  hookFiles.filter(
    (n) => !wired.includes(`hooks/${n}`) && !agentRun.includes(`hooks/${n}`),
  ),
  [],
);
ok(
  "hooks/lib/ holds the libraries and no hook is wired from it",
  wired.filter((s) => s.startsWith("hooks/lib/")),
  [],
);
// a library is in use when a hook or a worker imports or loads it, or a library in use does (decisions.mjs
// through serves.mjs; net-guard-preload.mjs is loaded by workers/read-page.mjs through NODE_OPTIONS)
const libFiles = fs.readdirSync(path.join(REPO, "hooks", "lib"));
const usedLibs = new Set();
for (
  let users = [
    ...hookFiles.map((h) => path.join(REPO, "hooks", h)),
    ...fs
      .readdirSync(path.join(REPO, "workers"))
      .filter((n) => n.endsWith(".mjs"))
      .map((n) => path.join(REPO, "workers", n)),
  ];
  users.length;
) {
  const text = users.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const found = libFiles.filter(
    (n) =>
      !usedLibs.has(n) &&
      (text.includes(`lib/${n}"`) || text.includes(`"./${n}"`)),
  );
  for (const n of found) usedLibs.add(n);
  users = found.map((n) => path.join(REPO, "hooks", "lib", n));
}
ok(
  "every file in hooks/lib/ is a library some hook imports, itself or through another library",
  libFiles.filter((n) => !usedLibs.has(n)),
  [],
);

// retired hooks: gone from hooks/ and from the example
ok(
  "a retired hook is neither shipped nor wired",
  setup.retired.filter(
    (n) => hookFiles.includes(n) || wired.includes(`hooks/${n}`),
  ),
  [],
);

// retiredEntries: the file still ships (else it belongs in retired) and the event no longer runs that entry
ok(
  "a hook in retiredEntries still ships and is no longer wired on that event",
  Object.entries(setup.retiredEntries).flatMap(([event, names]) =>
    names
      .filter(
        (n) =>
          !hookFiles.includes(n.split(" ")[0]) ||
          runsOn(event).includes(`hooks/${n}`),
      )
      .map((n) => `${event} ${n}`),
  ),
  [],
);

// a hook with old matchers is wired, and its current matcher is not one of the old ones
const matchersOf = (base) =>
  Object.values(example.hooks)
    .flat()
    .filter((g) => g.hooks.some((h) => h.command.includes(`/${base}`)))
    .map((g) => g.matcher);
ok(
  "each hook in oldMatchers is wired, and no current matcher is an old one",
  Object.entries(setup.oldMatchers).filter(
    ([base, olds]) =>
      !wired.includes(`hooks/${base}`) ||
      matchersOf(base).some((m) => olds.includes(m)),
  ),
  [],
);

// each project folder: its own commands resolve inside the folder, and a retired name is gone
const homes = fs
  .readdirSync(path.join(REPO, "templates"), { withFileTypes: true })
  .filter(
    (e) =>
      e.isDirectory() &&
      fs.existsSync(
        path.join(REPO, "templates", e.name, ".claude", "settings.json"),
      ),
  )
  .map((e) => e.name);
for (const home of homes) {
  const dir = path.join(REPO, "templates", home);
  const own = commandsIn(json(path.join(dir, ".claude", "settings.json"))).map(
    scriptOf,
  );
  ok(
    `${home}: every command names a file inside the folder`,
    own.filter((s) => !fs.existsSync(path.join(dir, s))),
    [],
  );
  ok(
    `${home}: no retired hook file is shipped or wired`,
    (setup.retiredInHomes[home] || []).filter(
      (n) =>
        fs.existsSync(path.join(dir, ".claude", "hooks", n)) ||
        own.some((s) => s.endsWith(`/${n}`)),
    ),
    [],
  );
}
ok(
  "retiredInHomes names only project folders that exist",
  Object.keys(setup.retiredInHomes).filter((h) => !homes.includes(h)),
  [],
);

if (fails) {
  console.log(`\n${fails} failed`);
  process.exit(1);
}
console.log("\nall passed");
