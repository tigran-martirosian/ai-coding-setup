#!/usr/bin/env node
// Antigravity PreToolUse hook, registered in ~/.gemini/config/hooks.json. Its settings file has no way to
// refuse web search, or to refuse a file by pattern, so this hook does both. ask.mjs sets ASK_AGY_GATE=1 for
// its runs (other agy runs are not touched). In those runs:
//   - web search, page reading, the browser and subagents (a subagent has a browser) are refused;
//   - a file named .env or .env.*, in a path or inside a shell command, is refused unless ASK_AGY_ENV_OK=1, which ask.mjs sets only for
//     --allow-env. Claude gives that flag, so a line planted in a file can't set it.
// A refusal is a "deny"; a tool call that can't be read, or has no name, is refused too. The hook is registered for every
// tool ("*"), so a tool Antigravity renames still passes through here.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const deny = (reason) => console.log(JSON.stringify({ decision: "deny", reason }));
  if (process.env.ASK_AGY_GATE !== "1") return console.log(JSON.stringify({ decision: "allow" }));
  let call;
  try { call = JSON.parse(input).toolCall; } catch { return deny("ask.mjs gate: the tool call could not be read, so it is refused"); }
  if (!call?.name) return deny("ask.mjs gate: the tool call had no name, so it is refused");
  const strings = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  if (/^(search_web|read_url\w*|browser_\w+)$/.test(call.name)) return deny(`${call.name} is refused in ask.mjs runs: web research is Claude's own job`);
  if (["invoke_subagent", "define_subagent"].includes(call.name)) return deny(`${call.name} is refused in ask.mjs runs: do the work yourself`);
  const env = strings(call).find((s) => /(^|[\s\\/"'`=:;|&<>(])\.env(\.[^\s"'`;|&<>)]*)?($|[\s\\/"'`;|&<>)*?])/i.test(s));
  if (env && process.env.ASK_AGY_ENV_OK !== "1") return deny(`${env} is refused: env files stay unread unless the run was started with --allow-env`);
  console.log(JSON.stringify({ decision: "allow" }));
});
