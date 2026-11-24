// The panel's command must return the planner's JSON in every shell host.exec might use, well inside
// the panel's 30-second limit (the transcript scan, which is off here, can take all of that).
// Every command must also run outside the open project, with cmd.exe told not to look for node there.
import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readDashboardFile, script, trusted } from "../src/command.ts";

// vite.config.ts sets this in the build
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
(globalThis as { __CLAUDE_DIR__?: string }).__CLAUDE_DIR__ = CLAUDE_DIR;

// Nimbalyst's exec: the process environment plus the options' env, run in the options' cwd.
// The guard is taken out of the base environment first (a Claude Code shell sets it already).
const base = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^NoDefaultCurrentDirectoryInExePath$/i.test(k),
  ),
);
const asHost = (o: ReturnType<typeof trusted>) => ({
  ...o,
  env: { ...base, ...o.env },
});

let failed = 0;
const fail = (what: string) => {
  failed++;
  console.log(`FAIL ${what}`);
};

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "usage-plan-ws-"));
const options = trusted({ timeout: 5000, cwd: workspace } as {
  timeout: number;
});
if (
  options.cwd !== CLAUDE_DIR ||
  options.timeout !== 5000 ||
  options.env.NoDefaultCurrentDirectoryInExePath !== "1"
)
  fail(
    `commands run in ~/.claude with the cwd guard, never in the project: ${JSON.stringify(options)}`,
  );
else console.log("ok   trusted options: cwd ~/.claude, guard on");

// A project's own node.cmd must not run even when the command's folder is that project
if (process.platform === "win32") {
  const marker = path.join(workspace, "planted-ran");
  fs.writeFileSync(
    path.join(workspace, "node.cmd"),
    `@echo planted> "${marker}"\r\n`,
  );
  await new Promise<void>((done) =>
    exec(
      readDashboardFile(),
      { ...asHost(trusted({ timeout: 20_000 })), cwd: workspace },
      () => {
        if (fs.existsSync(marker))
          fail("cmd.exe ran the project's node.cmd: the guard is not set");
        else console.log("ok   a planted node.cmd in the project does not run");
        done();
      },
    ),
  );
}

const shells: (string | undefined)[] =
  process.platform === "win32" ? [undefined, "powershell.exe"] : [undefined];
for (const shell of shells) {
  const name = shell ?? "default shell";
  const started = Date.now();
  await new Promise<void>((done) => {
    exec(
      script("plan-ahead.mjs", "--json"),
      { shell, ...asHost(trusted({ timeout: 30_000 })) },
      (err, stdout, stderr) => {
        try {
          if (err) throw new Error(stderr || err.message);
          if (Date.now() - started > 15_000)
            throw new Error(`took ${Date.now() - started} ms`);
          const plan = JSON.parse(stdout);
          if (!["ok", "none"].includes(plan.status))
            throw new Error("unexpected status " + plan.status);
          console.log(
            `ok   ${name}: status ${plan.status}, week ${plan.week?.used}%, ${plan.tips?.length ?? 0} tips`,
          );
        } catch (e) {
          fail(`${name}: ${(e as Error).message}`);
        }
        done();
      },
    );
  });
}
// Removed last: right after the decoy run Windows can still hold the new node.cmd (EPERM)
fs.rmSync(workspace, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
