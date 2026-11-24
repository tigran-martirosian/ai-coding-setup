// Command line for one script of the setup-audit skill.
// node finds the home folder itself, so the command is the same in cmd, PowerShell and sh.
// (plan-ahead.mjs only prints when it is the main file, so it is started as its own process.)
export const script = (file: string, arg?: string) =>
  `node -e "require('child_process').execFileSync(process.execPath,[require('path').join(require('os').homedir(),'.claude','skills','setup-audit','scripts','${file}')${
    arg ? `,'${arg}'` : ""
  }],{stdio:'inherit'})"`;

/** Builds the dashboard data (and its page) without opening the browser. Takes up to 3 minutes. */
export const buildDashboard = () => script("usage-dashboard.mjs", "--no-open");

// The ~/.claude folder of the person who built the extension, set by vite.config.ts.
declare const __CLAUDE_DIR__: string;

/**
 * The exec options every command of this extension runs with, whatever the caller passed as cwd.
 * Nimbalyst runs a command in the open project unless told otherwise, and on Windows cmd.exe looks for
 * `node` in the current folder before PATH, so a project's own node.cmd would run instead of Node.js.
 * So the commands run in ~/.claude, and NoDefaultCurrentDirectoryInExePath (passed here; Nimbalyst merges it into the
 * child's environment) stops cmd.exe from searching the current folder at all.
 */
export const trusted = (options?: { timeout?: number }) => ({
  ...options,
  cwd: __CLAUDE_DIR__,
  env: { NoDefaultCurrentDirectoryInExePath: "1" },
});

/** Prints ~/.claude/reports/usage-dashboard.json. A missing file exits with code 2, any other failure with 1. */
export const readDashboardFile = () =>
  `node -e "try{process.stdout.write(require('fs').readFileSync(require('path').join(require('os').homedir(),'.claude','reports','usage-dashboard.json')))}catch(e){console.error(e.message);process.exit(e.code==='ENOENT'?2:1)}"`;
