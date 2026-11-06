// Every text one file writes and another file greps for. Hooks write from here; the scanners (setup-audit
// scripts, the rule check) match from here, so a reworded text cannot leave a scanner counting nothing.
// The last section is app text (Claude Code, Nimbalyst): it is not ours to change, only to name once.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// command-explain.mjs: the last line of a Bash command, the stand-in it adds, the prefix of its refusals
export const NOTE_WORDS = "WHAT THIS DOES:";
export const WHAT_THIS_DOES = `# ${NOTE_WORDS}`;
export const NO_NOTE = "(no note given)";
export const NOTE_LINE_RE = new RegExp(`^#\\s*${esc(NOTE_WORDS)}\\s*(.*)$`); // the command's last line, note in group 1
export const NOTE_ANYWHERE_RE = new RegExp(`#\\s*${esc(NOTE_WORDS)}\\s*(.*)`);
export const STAND_IN_RE = new RegExp(`\\n\\n${esc(WHAT_THIS_DOES)} ${esc(NO_NOTE)} [\\s\\S]*$`); // as appended to a command
export const COMMAND_EXPLAIN = "command-explain:";
export const POWERSHELL_TOOL = "PowerShell tool"; // the refusal "don't use the PowerShell tool here"
// Refusals older versions wrote, still in old transcripts
export const RETIRED_TOO_LONG = "too long";
export const RETIRED_NO_LINE = "no explanation line";

// Notes other hooks put in front of Claude
export const WORKER_SIZE_NOTE = "[worker-size] This helper's context is";
export const SETTLED_NOTE = "[background-tasks] This settled notice repeats";
export const BIG_READ_GATE = "[big-read-gate]";
export const VERIFY_GATE = "verify-gate:";

// chat-scan.mjs writes it in a digest's header, read-digests.mjs reads it back
export const chatCounts = (chats, requests) => `${chats} chats, ${requests} requests`;
export const CHAT_COUNTS_RE = /chats, (\d+) requests/;

// app text, outside fact
export const STOP_HOOK_FEEDBACK = "Stop hook feedback:"; // the app's prefix on a Stop hook's block message
export const REPORT_FOLLOWS = "The report follows:"; // the app's frame around a helper's report
export const TURN_LIMIT_RE = /stopped at its \d+-turn limit/; // the app's note on a helper cut at its turn limit
