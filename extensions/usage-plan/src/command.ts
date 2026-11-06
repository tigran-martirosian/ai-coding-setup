// Command line for one script of the setup-audit skill.
// node finds the home folder itself, so the command is the same in cmd, PowerShell and sh.
// (plan-ahead.mjs only prints when it is the main file, so it is started as its own process.)
export const script = (file: string, arg?: string) =>
  `node -e "require('child_process').execFileSync(process.execPath,[require('path').join(require('os').homedir(),'.claude','skills','setup-audit','scripts','${file}')${
    arg ? `,'${arg}'` : ''
  }],{stdio:'inherit'})"`;

/** Builds the dashboard data (and its page) without opening the browser. Takes up to 3 minutes. */
export const buildDashboard = () => script('usage-dashboard.mjs', '--no-open');

/** Prints ~/.claude/reports/usage-dashboard.json. A missing file exits with code 2, any other failure with 1. */
export const readDashboardFile = () =>
  `node -e "try{process.stdout.write(require('fs').readFileSync(require('path').join(require('os').homedir(),'.claude','reports','usage-dashboard.json')))}catch(e){console.error(e.message);process.exit(e.code==='ENOENT'?2:1)}"`;
