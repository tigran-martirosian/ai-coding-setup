// The panel's command must return the planner's JSON in every shell host.exec might use.
import { exec } from 'node:child_process';
import { script } from '../src/command.ts';

const shells: (string | undefined)[] = process.platform === 'win32' ? [undefined, 'powershell.exe'] : [undefined];
let failed = 0;
for (const shell of shells) {
  const name = shell ?? 'default shell';
  await new Promise<void>((done) => {
    exec(script('plan-ahead.mjs', '--json'), { shell, timeout: 30_000 }, (err, stdout, stderr) => {
      try {
        if (err) throw new Error(stderr || err.message);
        const plan = JSON.parse(stdout);
        if (!['ok', 'none'].includes(plan.status)) throw new Error('unexpected status ' + plan.status);
        console.log(`ok   ${name}: status ${plan.status}, week ${plan.week?.used}%, ${plan.tips?.length ?? 0} tips`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${name}: ${(e as Error).message}`);
      }
      done();
    });
  });
}
process.exit(failed ? 1 : 0);
