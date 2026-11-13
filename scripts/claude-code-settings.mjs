// The Claude Code settings this setup adds to ~/.claude/settings.json, for install.mjs and
// scripts/app-settings.mjs: "model": "opus" at medium effort when no model is set, a one-hour prompt cache
// for helpers, 120 days of transcripts, and permission rules (the agent can't read the saved sign-ins or the SSH keys, and asks before a
// .env file), and on Windows with Git Bash the PowerShell tool off. What is there stays.
import { gitBashFound } from "./claude-files.mjs";

// Explore and general-purpose run uncapped on the session's model; the deny rule blocks them, and the
// agent list already points to "worker" and "reviewer" (it replaced the worker-nudge hook). --uninstall takes
// them out again, since the worker agent goes with it.
export const HELPER_DENY = ["Agent(Explore)", "Agent(general-purpose)"];
const DENY = [
  ...HELPER_DENY,
  "Read(~/.claude/.credentials.json)", "Read(~/.codex/auth.json)", "Read(~/.gemini/oauth_creds.json)",
  "Read(~/.gemini/google_accounts.json)", "Read(~/.ssh/**)",
  "Bash(*.credentials.json*)", "Bash(*.codex/auth.json*)", "Bash(*oauth_creds.json*)", "Bash(*.ssh/*)",
  "PowerShell(*.credentials.json*)", "PowerShell(*.codex/auth.json*)", "PowerShell(*.codex\\auth.json*)",
  "PowerShell(*oauth_creds.json*)", "PowerShell(*.ssh/*)", "PowerShell(*.ssh\\*)",
];
const ASK = [
  "Read(//**/.env)", "Read(//**/.env.*)", "Bash(* .env*)", "Bash(*/.env*)",
  "PowerShell(* .env*)", "PowerShell(*/.env*)", "PowerShell(*\\.env*)",
];

// The models the "opus" alias resolves to, and the effort set for them: install.mjs undoes exactly this when it moves a model back
export const OPUS_MODELS = ["claude-opus-5", "claude-opus-5-5"];
export const DEFAULT_EFFORT = "medium";

// Changes the settings object it is given and says what it did: whether the model was set, and how
// many permission rules were added. gitBash: the PowerShell tool goes off (Windows with Git Bash only).
export function addClaudeCodeSettings(settings, win = process.platform === "win32", gitBash = win && gitBashFound(settings)) {
  const model = !settings.model;
  if (model) {
    settings.model = "opus";
    for (const name of OPUS_MODELS) ((settings.modelSettings ??= {})[name] ??= {}).effortLevel ??= DEFAULT_EFFORT;
  }
  // Compact at about 200k, mid-work or before the next message, so a finished chat is left alone
  const compact = settings.autoCompactWindow === undefined;
  if (compact) settings.autoCompactWindow = 230000;
  // A helper waiting on a long build or test keeps its context cached instead of paying to read it again
  const cache = settings.subagentPromptCacheTtl === undefined;
  if (cache) settings.subagentPromptCacheTtl = "1h";
  // No advisor is set: it stays the person's choice (/advisor fable) until it is measured (DECISIONS 2026-11-10)
  // Claude Code deletes transcripts after 30 days by default, and hooks and audits read them
  const logs = settings.cleanupPeriodDays === undefined;
  if (logs) settings.cleanupPeriodDays = 120;
  // Windows with Git Bash: the PowerShell tool goes off, since Nimbalyst's permission popup shows only the
  // word "PowerShell" for it. Without Git Bash it is the only shell, so it stays. A value set already stays.
  const powershellOff = gitBash && settings.env?.CLAUDE_CODE_USE_POWERSHELL_TOOL === undefined;
  if (powershellOff) (settings.env ??= {}).CLAUDE_CODE_USE_POWERSHELL_TOOL = "0";
  let added = 0;
  for (const [kind, rules] of [["deny", DENY], ["ask", ASK]]) {
    const list = ((settings.permissions ??= {})[kind] ??= []);
    for (const rule of rules.filter((r) => win || !r.startsWith("PowerShell("))) if (!list.includes(rule)) { list.push(rule); added++; }
  }
  return { model, added, compact, cache, logs, powershellOff };
}

// 1.0.104 set CLAUDE_CODE_MAX_OUTPUT_TOKENS to 64000, which cut a long reply short instead of keeping a helper's
// job small enough. An update from 1.0.104 takes out exactly that value; any other value is the person's own and stays.
export const OLD_OUTPUT_CAP = { version: "1.0.104", value: "64000" };
export function removeOldOutputCap(settings, previousVersion) {
  if (previousVersion !== OLD_OUTPUT_CAP.version || settings.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS !== OLD_OUTPUT_CAP.value) return false;
  delete settings.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  if (!Object.keys(settings.env).length) delete settings.env;
  return true;
}
