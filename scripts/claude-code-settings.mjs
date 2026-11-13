// The Claude Code settings this setup adds to ~/.claude/settings.json, for install.mjs and
// scripts/app-settings.mjs: "model": "opus" at medium effort when no model is set, a one-hour prompt cache
// for helpers, 120 days of transcripts, and permission rules (the agent can't read the saved sign-ins or the SSH keys, and asks before a
// .env file). What is there stays.
const DENY = [
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

// Changes the settings object it is given and says what it did: whether the model was set, and how
// many permission rules were added.
export function addClaudeCodeSettings(settings, win = process.platform === "win32") {
  const model = !settings.model;
  if (model) {
    settings.model = "opus";
    for (const name of ["claude-opus-5", "claude-opus-5-5"]) ((settings.modelSettings ??= {})[name] ??= {}).effortLevel ??= "medium";
  }
  // Compact at about 200k, mid-work or before the next message, so a finished chat is left alone
  const compact = settings.autoCompactWindow === undefined;
  if (compact) settings.autoCompactWindow = 230000;
  // A helper waiting on a long build or test keeps its context cached instead of paying to read it again
  const cache = settings.subagentPromptCacheTtl === undefined;
  if (cache) settings.subagentPromptCacheTtl = "1h";
  // Claude Code deletes transcripts after 30 days by default, and hooks and audits read them
  const logs = settings.cleanupPeriodDays === undefined;
  if (logs) settings.cleanupPeriodDays = 120;
  let added = 0;
  for (const [kind, rules] of [["deny", DENY], ["ask", ASK]]) {
    const list = ((settings.permissions ??= {})[kind] ??= []);
    for (const rule of rules.filter((r) => win || !r.startsWith("PowerShell("))) if (!list.includes(rule)) { list.push(rule); added++; }
  }
  return { model, added, compact, cache, logs };
}
