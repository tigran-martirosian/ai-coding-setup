// ~/.claude/settings.json: the hook wiring, the move of an old "model": "sonnet" to opus, Claude Code's own
// settings (scripts/claude-code-settings.mjs) and the reply language, written once when any of them changed.
// Returns what goes on record as state.model ("moved", "kept" or the earlier answer).
import { addClaudeCodeSettings, DEFAULT_EFFORT, OPUS_MODELS, removeOldOutputCap } from "./claude-code-settings.mjs";
import { fwd } from "./files.mjs";
import { retire, wire } from "./wiring.mjs";

const olderThan = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

export function claudeSettings(ctx) {
  const { settings, settingsFile, state, CLAUDE, WIN, LANG, say } = ctx;
  const settingsWas = JSON.stringify(settings);
  const retiredHooks = retire(ctx, settings, CLAUDE, ctx.RETIRED);
  const wired = wire(ctx, settings, ctx.example.hooks, CLAUDE) + retiredHooks;
  if (!wired) say(`hooks already wired in ${fwd(settingsFile)}`);
  // Before 1.0.74 the installer set "model": "sonnet", and an update keeps the settings a person has, so
  // that stayed for good. Such a setup (sonnet, no model settings, a version on record that is older) moves to
  // opus at medium effort, said loudly. state.model records the choice for later runs: "moved", or "kept"
  // (--keep-model). --keep-model after a move puts sonnet back; it is the undo.
  const KEEP_MODEL = ctx.args.includes("--keep-model");
  let modelMark = state.model;
  let modelChanged = false;
  if (KEEP_MODEL && state.model === "moved") {
    if (settings.model === "opus") {
      settings.model = "sonnet";
      for (const name of OPUS_MODELS) {
        const s = settings.modelSettings?.[name];
        if (s && JSON.stringify(s) === JSON.stringify({ effortLevel: DEFAULT_EFFORT })) delete settings.modelSettings[name];
      }
      if (settings.modelSettings && !Object.keys(settings.modelSettings).length) delete settings.modelSettings;
      modelChanged = true;
      say(`model: sonnet is back in ${fwd(settingsFile)}, and stays on later runs (--keep-model)`);
    } else say(`model: --keep-model has nothing to undo, "model" in ${fwd(settingsFile)} is ${JSON.stringify(settings.model)} and stays as it is`);
    modelMark = "kept";
  } else if (KEEP_MODEL) {
    modelMark = "kept";
    if (settings.model === "sonnet") say(`model: sonnet stays in ${fwd(settingsFile)} (--keep-model); later runs keep it too`);
    else say(`model: --keep-model found no move on record, so "model" in ${fwd(settingsFile)} stays ${JSON.stringify(settings.model)}. Set it there to change it.`);
  } else if (!state.model && state.version && olderThan(state.version, "1.0.75") && settings.model === "sonnet" && !settings.modelSettings) {
    delete settings.model; // addClaudeCodeSettings below sets opus at medium effort
    modelMark = "moved";
    modelChanged = true;
    say(`MODEL CHANGED: ${fwd(settingsFile)} had "model": "sonnet", which the installer before 1.0.74 set for you, so it is now opus at medium effort.`);
    say(`  To undo: ${ctx.selfRun("--keep-model")}`);
    say(`  (in a chat: /update-setup --keep-model). That puts sonnet back and keeps it on every later run.`);
  }
  // Claude Code's own settings go into the same file: what is set there already stays
  const own = addClaudeCodeSettings(settings, WIN);
  if (own.model && !modelChanged) say(`model: set to opus at medium effort in ${fwd(settingsFile)} (none was set)`);
  if (own.compact) say(`compact: long chats compact themselves at about 200k, set in ${fwd(settingsFile)}`);
  if (own.cache) say(`cache: helpers keep their prompt cache for an hour, set in ${fwd(settingsFile)}`);
  if (own.logs) say(`logs: transcripts are kept 120 days, set in ${fwd(settingsFile)}`);
  const uncapped = removeOldOutputCap(settings, state.version);
  if (uncapped) say(`output: the 64k cap on one reply that 1.0.104 set is taken out of ${fwd(settingsFile)}`);
  if (own.added) say(`permissions: ${own.added} rule(s) added (the saved sign-ins and SSH keys can't be read, a .env file is asked about)`);
  // Claude Code's own reply-language setting follows the language. english removes only the "russian"
  // this setup wrote: a language the person set to something else stays.
  let langChanged = false;
  if (LANG === "russian" && settings.language !== "russian") { settings.language = "russian"; langChanged = true; say(`language: russian set in ${fwd(settingsFile)}`); }
  else if (LANG === "english" && state.language === "russian" && settings.language === "russian") { delete settings.language; langChanged = true; say(`language: russian removed from ${fwd(settingsFile)}`); }
  if (wired || own.model || modelChanged || own.compact || own.cache || own.logs || uncapped || own.added || langChanged) ctx.putJson(settingsFile, settings, settingsWas);
  return modelMark;
}
