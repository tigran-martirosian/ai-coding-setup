// One check of the hook table: settings.example.json (and each project folder's own settings.json) against the files.
// Every wired command resolves to a file; every file in hooks/ is wired (a library lives in hooks/lib/);
// what _setup calls retired is neither wired nor shipped. Run: node tests/test-wiring.mjs
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
  "_setup has retired, retiredInHomes and oldMatchers",
  ["retired", "retiredInHomes", "oldMatchers"].map((k) => k in setup),
  [true, true, true],
);

// every command of the example resolves to a file in the repo
const wired = commandsIn(example).map(scriptOf);
ok(
  "every command in settings.example.json names a file in the repo",
  wired.filter((s) => !fs.existsSync(path.join(REPO, s))),
  [],
);

// every hook file is wired, or a library (hooks/lib/)
const hookFiles = fs
  .readdirSync(path.join(REPO, "hooks"), { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name);
ok(
  "every file in hooks/ is wired in settings.example.json",
  hookFiles.filter((n) => !wired.includes(`hooks/${n}`)),
  [],
);
ok(
  "hooks/lib/ holds the libraries and no hook is wired from it",
  wired.filter((s) => s.startsWith("hooks/lib/")),
  [],
);
ok(
  "every file in hooks/lib/ is a library some hook imports",
  fs
    .readdirSync(path.join(REPO, "hooks", "lib"))
    .filter(
      (n) =>
        !hookFiles.some((h) =>
          fs
            .readFileSync(path.join(REPO, "hooks", h), "utf8")
            .includes(`lib/${n}`),
        ),
    ),
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
  .readdirSync(path.join(REPO, "projects"), { withFileTypes: true })
  .filter(
    (e) =>
      e.isDirectory() &&
      fs.existsSync(
        path.join(REPO, "projects", e.name, ".claude", "settings.json"),
      ),
  )
  .map((e) => e.name);
for (const home of homes) {
  const dir = path.join(REPO, "projects", home);
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
