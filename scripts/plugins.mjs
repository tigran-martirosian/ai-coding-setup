// The plugins (claude plugin install) and the find-skills skill (npx). Each is handled once and put on
// record in state.plugins: one the user removed or switched later stays as they have it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PLUGINS = [["claude-hud@claude-hud", "jarrodwatts/claude-hud"]];
const cli = (line, ms = 300000) => {
  const r = spawnSync(line, { shell: true, encoding: "utf8", timeout: ms });
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
    const markets = new Set();
    if (!list.ok)
      say(
        `plugins not installed: claude plugin list failed (${tail(list.out)})`,
      );
    else
      for (const [name, market] of toPlug) {
        if (list.out.includes(name)) {
          say(`plugin already there: ${name} (left as it is)`);
          plugged.push(name);
          continue;
        }
        if (!markets.has(market)) {
          cli(`claude plugin marketplace add ${market}`);
          markets.add(market);
        }
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
