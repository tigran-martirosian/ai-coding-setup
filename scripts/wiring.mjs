// The hook wiring of a settings.json: wire adds the example's hooks, retire takes out the ones the setup
// retired, unwire takes out every hook that starts one of the setup's scripts (--uninstall). Each works
// on a settings object over the run's ctx (home, CLAUDE, NODE, say, OLD_MATCHERS) and says what it did.
import path from "node:path";
import { fwd, SCRIPT_PATHS } from "./files.mjs";

// The scripts a hook command starts, as lowercase paths with / ('~' written out)
export const scriptsOf = (h, home) =>
  [...String(h.command || "").matchAll(SCRIPT_PATHS)].map((m) =>
    fwd((m[1] || m[2]).replace(/^~(?=[\\/])/, home)).toLowerCase(),
  );

// Hooks the setup retired (their files are gone): an install that has one wired from ~/.claude loses
// that entry on the next run. The same script from another folder is the user's own and stays.
// `folder` is the .claude folder the hooks sit in, `names` the retired file names, `where` the suffix of the message.
export function retire({ home, say }, target, folder, names, where = "") {
  const root = fwd(folder).toLowerCase();
  // A name may carry the arguments of one retired entry ("file-link-gate.mjs --remind"): quotes are dropped
  // before matching, so `node "<claude>/hooks/file-link-gate.mjs" --remind` matches and the bare Stop entry does not.
  const plain = (h) =>
    fwd(String(h.command || ""))
      .replace(/(^|[\s"'])~\//g, `$1${fwd(home)}/`)
      .replace(/["']/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  const nameOf = (h) =>
    names.find(
      (name) =>
        (plain(h) + " ").includes(`${root}/hooks/${name.toLowerCase()} `) ||
        plain(h).endsWith(`${root}/hooks/${name.toLowerCase()}`),
    );
  const retired = (h) => nameOf(h) !== undefined;
  let removed = 0;
  for (const [event, groups] of Object.entries(target.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    target.hooks[event] = groups.filter((group) => {
      const before = (group.hooks || []).length;
      if (!before) return true;
      for (const h of group.hooks.filter(retired))
        say(
          `hook removed: ${event} ${nameOf(h)}${where} (no longer part of the setup)`,
        );
      group.hooks = group.hooks.filter((h) => !retired(h));
      removed += before - group.hooks.length;
      return group.hooks.length > 0;
    });
  }
  return removed;
}
// A command's arguments after the script (null when it does not start that script): "--start" in
// `node "<claude>/hooks/code-review-gate.mjs" --start`
const nameIn = (base) => base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const argsOf = (command, base) =>
  String(command || "")
    .match(
      new RegExp(`(?:^|[\\\\/"' ])${nameIn(base)}["']?(?=\\s|$)(.*)$`),
    )?.[1]
    .replace(/\s*\d?>>?\s*\S+/g, "")
    .trim()
    .replace(/\s+/g, " ") ?? null; // a redirect is no argument
// The hook wiring: each hook from an example is added unless that event already runs the same script.
// The command points at the installed copy by its full path, so it works from any folder and shell.
// A script named as ~/.claude/... is the one in ~/.claude, any other path is inside the project folder.
// A hook whose example matcher changed: an install that still has exactly the old one gets the new one.
// A matcher the user changed themselves is not in OLD_MATCHERS and is left alone.
export function wire(
  { home, CLAUDE, NODE, say, OLD_MATCHERS },
  target,
  hooks,
  folder,
  where = "",
) {
  // Where a command starts the script from, as a path with / ('~' written out), or null
  const scriptOf = (command, base) => {
    const m = String(command || "").match(
      new RegExp(
        `"([^"]*[\\\\/]${nameIn(base)})"|(\\S*[\\\\/]${nameIn(base)})`,
      ),
    );
    return m && fwd(m[1] || m[2]).replace(/^~(?=\/)/, fwd(home));
  };
  const insideClaude = (p) =>
    !!p && p.toLowerCase().startsWith(fwd(CLAUDE).toLowerCase() + "/");
  let added = 0;
  for (const [event, groups] of Object.entries(hooks || {})) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const global = hook.command.match(/~\/\.claude\/(\S+)(.*)$/);
        const [, script, extra] =
          global || hook.command.match(/^node (\S+)(.*)$/);
        const list = ((target.hooks ??= {})[event] ??= []);
        const base = path.basename(script);
        const at = fwd(path.join(global ? CLAUDE : folder, script));
        const command = `${NODE} "${at}"${extra}`;
        const wanted = extra.trim().replace(/\s+/g, " ");
        // One script can be wired several times with different arguments (code-review-gate.mjs plain,
        // --start, --pre) and, with an `if`, once for each tool: an entry counts as this one only when
        // the arguments are the same, and the `if` too where the example has one.
        const same = (h) =>
          argsOf(h.command, base) === wanted && (!hook.if || h.if === hook.if);
        // An older wiring of this hook ran for every command; the `if` handlers replace it, not join it.
        // Only the one started from ~/.claude is the setup's; a script from elsewhere is the user's own.
        if (hook.if && global) {
          for (const g of [...list]) {
            const before = (g.hooks || []).length;
            g.hooks = (g.hooks || []).filter(
              (h) =>
                !(
                  !h.if &&
                  argsOf(h.command, base) === wanted &&
                  insideClaude(scriptOf(h.command, base))
                ),
            );
            if (g.hooks.length === before) continue;
            if (!g.hooks.length) list.splice(list.indexOf(g), 1);
            say(
              `hook replaced: ${event} ${base}${where} (it ran for every command; now only where the command needs it)`,
            );
            added++;
          }
        }
        if (list.some((g) => (g.hooks || []).some(same))) {
          // An older copy of this setup may have wired the same script from another place in ~/.claude:
          // that wiring is pointed at the installed copy. A script outside ~/.claude is the user's own.
          for (const old of global
            ? list.flatMap((g) => g.hooks || []).filter(same)
            : []) {
            const was = scriptOf(old.command, base);
            if (
              !was ||
              was.toLowerCase() === at.toLowerCase() ||
              !insideClaude(was)
            )
              continue;
            old.command = command;
            say(`hook repointed: ${event} ${base}${where} (it started ${was})`);
            added++;
          }
          for (const g of list) {
            if (
              !group.matcher ||
              !(OLD_MATCHERS[base] || []).includes(g.matcher)
            )
              continue;
            if (
              !(g.hooks || []).some((h) =>
                String(h.command || "").includes(base),
              )
            )
              continue;
            say(
              `hook matcher updated: ${event} ${base}${where} (${g.matcher} -> ${group.matcher})`,
            );
            g.matcher = group.matcher;
            added++;
          }
          // A guard that must block when it crashes or times out: an older wiring without the key gets it.
          // A value the user set themselves stays.
          for (const old of hook.onFailure
            ? list.flatMap((g) => g.hooks || []).filter(same)
            : []) {
            if (old.onFailure) continue;
            old.onFailure = hook.onFailure;
            say(
              `hook updated: ${event} ${base}${where} (onFailure: ${hook.onFailure})`,
            );
            added++;
          }
          continue;
        }
        // Everything else the example sets comes along: without asyncRewake a watcher would hold the session up.
        const entry = { ...hook, command };
        list.push(
          group.matcher
            ? { matcher: group.matcher, hooks: [entry] }
            : { hooks: [entry] },
        );
        say(
          `hook added: ${event}${group.matcher ? ` (${group.matcher})` : ""} ${path.basename(script)}${where}`,
        );
        added++;
      }
    }
  }
  return added;
}
// Takes out every hook for which setups(h) holds, naming each; an emptied event, and an emptied hooks, go
export function unwire({ say, home }, target, setups, where = "") {
  const before = JSON.stringify(target);
  for (const [event, groups] of Object.entries(target.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    let gone = 0;
    target.hooks[event] = groups.filter((g) => {
      const n = (g.hooks || []).length;
      for (const h of (g.hooks || []).filter(setups))
        say(
          `hook unwired: ${event} ${path.basename(scriptsOf(h, home)[0] || "")}${where}`,
        );
      g.hooks = (g.hooks || []).filter((h) => !setups(h));
      gone += n - g.hooks.length;
      return !n || g.hooks.length;
    });
    if (gone && !target.hooks[event].length) delete target.hooks[event];
  }
  if (
    target.hooks &&
    !Object.keys(target.hooks).length &&
    JSON.stringify(target) !== before
  )
    delete target.hooks;
}
