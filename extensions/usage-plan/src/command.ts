// Command line for one script of the usage-report skill.
// node finds the home folder itself, so the command is the same in cmd, PowerShell and sh.
// (plan-ahead.mjs only prints when it is the main file, so it is started as its own process.)
export const script = (file: string, arg?: string) =>
  `node -e "require('child_process').execFileSync(process.execPath,[require('path').join(require('os').homedir(),'.claude','skills','usage-report','${file}')${
    arg ? `,'${arg}'` : ''
  }],{stdio:'inherit'})"`;
