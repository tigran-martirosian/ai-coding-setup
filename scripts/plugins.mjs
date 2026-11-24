// The plugins (claude plugin install) and the find-skills skill (npx). Each is handled once and put on
// record in state.plugins: one the user removed or switched later stays as they have it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The commands the security plugin's own launcher (hooks/sg-python.sh) tries for a Python. Each is run, not
// only looked for: Windows' python stand-ins in WindowsApps fail when run with arguments (they open nothing),
// a Python from the Store runs, and macOS's python3 may be a 3.9.
const PYTHONS = [
  "python3.13",
  "python3.12",
  "python3.11",
  "python3.10",
  "python3",
  "python",
  "py -3",
];
// The file the shell would run for a command name, or null. lstat, because Windows' app aliases are links
// that stat can not follow.
const which = (name) => {
  for (const d of (process.env.PATH || "").split(path.delimiter))
    for (const e of process.platform === "win32" ? [".exe", ".cmd"] : [""])
      if (d && fs.lstatSync(path.join(d, name + e), { throwIfNoEntry: false }))
        return path.join(d, name + e);
  return null;
};
const VERSION = ["-c", '"import sys;print(*sys.version_info[:2])"'];
const hasPython = () =>
  PYTHONS.some((cmd) => {
    const [name, ...pre] = cmd.split(" ");
    const file = which(name);
    if (!file) return false;
    const opts = { encoding: "utf8", timeout: 10000, windowsHide: true };
    // a .cmd file runs only through the shell
    const r = /\.cmd$/i.test(file)
      ? spawnSync(`"${file}" ${[...pre, ...VERSION].join(" ")}`, {
          ...opts,
          shell: true,
        })
      : spawnSync(file, [...pre, VERSION[0], VERSION[1].slice(1, -1)], opts);
    const [major, minor] = (r.status === 0 ? r.stdout : "")
      .trim()
      .split(/\s+/)
      .map(Number);
    return major > 3 || (major === 3 && minor >= 10);
  });

// [name, marketplace, what it needs to work: { check, why } (left off with "plugin left off: <name> <why>")]
const PLUGINS = [
  ["claude-hud@claude-hud", "jarrodwatts/claude-hud"],
  // Anthropic's security reviews on edits, turn ends and commits: the always-on level of skills/security. Its
  // hooks run on Python 3.10 or newer; without one every edit would end in a hook error, so it waits for one.
  [
    "security-guidance@claude-plugins-official",
    "anthropics/claude-plugins-official",
    {
      check: hasPython,
      why: "needs Python 3.10 or newer on the PATH (python.org; the Store stand-in is not one). Install it and run this again.",
    },
  ],
  // Design tools: Anthropic's frontend-design skill, and Paul Bakaus's impeccable (design commands and checks on
  // UI edits). impeccable's hooks run only when its launcher is there and fetch their own engine, so neither
  // needs anything on the PATH.
  [
    "frontend-design@claude-plugins-official",
    "anthropics/claude-plugins-official",
  ],
  ["impeccable@impeccable", "pbakaus/impeccable"],
];
const cli = (line, ms = 300000) => {
  const r = spawnSync(line, {
    shell: true,
    encoding: "utf8",
    timeout: ms,
    windowsHide: true,
  });
  return {
    ok: r.status === 0,
    out:
      `${r.stdout || ""}${r.stderr || ""}`.trim() ||
      String(r.error || "no output"),
  };
};
const tail = (text) => text.split("\n").slice(-3).join(" | ");

export function plugins(ctx) {
  const { CLAUDE, DRY, state, say, opt, onPath } = ctx;
  // --home is another home folder (the tests), and the claude command works on the real one
  const wantPlugins =
    opt("plugins") === "no"
      ? false
      : opt("plugins") === "yes"
        ? true
        : opt("home") === null;
  const plugged = [...(state.plugins || [])];
  const toPlug = PLUGINS.filter(([name]) => !plugged.includes(name));
  if (!wantPlugins) {
    if (toPlug.length)
      say(
        `plugins not installed by this run: ${toPlug.map(([n]) => n.split("@")[0]).join(", ")}`,
      );
  } else if (toPlug.length && !onPath("claude")) {
    say(
      `plugins not installed: the claude command is not on the PATH. Run this again from a terminal where claude works.`,
    );
  } else if (toPlug.length && !onPath("git")) {
    say(
      `plugins not installed: they are downloaded with Git, which is not on the PATH. Install Git and run this again.`,
    );
  } else if (toPlug.length && DRY) {
    say(
      `plugins would be installed if missing: ${toPlug.map(([n]) => n.split("@")[0]).join(", ")}`,
    );
  } else if (toPlug.length) {
    const list = cli("claude plugin list", 60000);
    // marketplace -> whether it is there to install from
    const markets = new Map();
    if (!list.ok)
      say(
        `plugins not installed: claude plugin list failed (${tail(list.out)})`,
      );
    else
      for (const [name, market, needs] of toPlug) {
        if (list.out.includes(name)) {
          say(`plugin already there: ${name} (left as it is)`);
          plugged.push(name);
          continue;
        }
        if (needs && !needs.check()) {
          say(`plugin left off: ${name} ${needs.why}`);
          continue;
        }
        if (!markets.has(market)) {
          // an add can fail because the marketplace is there already: the list settles it
          const added = cli(`claude plugin marketplace add ${market}`);
          const there =
            added.ok ||
            cli("claude plugin marketplace list", 60000).out.includes(
              `(${market})`,
            );
          if (!there)
            say(
              `marketplace ${market} could not be added (${tail(added.out)}); its plugins were not installed. Run this again to retry.`,
            );
          markets.set(market, there);
        }
        if (!markets.get(market)) continue;
        const got = cli(`claude plugin install ${name}`);
        if (!got.ok) {
          say(
            `plugin failed: ${name} (${tail(got.out)}). Everything else was installed; run this again to retry.`,
          );
          continue;
        }
        plugged.push(name);
        say(`plugin installed: ${name}`);
      }
  }
  // find-skills is someone else's skill, fetched with npx into the real home folder
  const finder = "find-skills";
  if (
    wantPlugins &&
    !DRY &&
    opt("home") === null &&
    !plugged.includes(finder)
  ) {
    if (fs.existsSync(path.join(CLAUDE, "skills", finder)))
      plugged.push(finder);
    else if (onPath("npx")) {
      const got = cli(
        `npx -y skills add vercel-labs/skills --skill ${finder} -g -y`,
      );
      if (got.ok) {
        plugged.push(finder);
        say(`skill installed: ${finder}`);
      } else
        say(
          `skill failed: ${finder} (${tail(got.out)}). Everything else was installed; run this again to retry.`,
        );
    }
  }
  if (!DRY && JSON.stringify(plugged) !== JSON.stringify(state.plugins || []))
    ctx.nextState.plugins = plugged;
}
