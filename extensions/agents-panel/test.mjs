// Checks the Agents Panel build: manifest points at real files, the script loads and exports
// activate/deactivate, the stylesheet is well formed and carries both fixes, and the Russian
// build swaps both labels. Run: node test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
};
const build = (lang) => {
  const r = spawnSync(process.execPath, ['build.mjs'], { cwd: here, encoding: 'utf8', env: { ...process.env, SETUP_LANGUAGE: lang } });
  if (r.status !== 0) throw new Error(`build (${lang}) failed: ${r.stderr}`);
};

build('russian');
const ru = fs.readFileSync(path.join(here, 'dist', 'index.js'), 'utf8');
check('russian: finished label', ru.includes('`Готово: ${done}`') && !ru.includes('finished`'));
check('russian: idle label', ru.includes("'Ничего не запущено'") && !ru.includes("'Nothing running'"));

build('english');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
check('manifest id', manifest.id === 'com.local.agentspanel');
check('manifest main exists', fs.existsSync(path.join(here, manifest.main)));
check('manifest styles exists', fs.existsSync(path.join(here, manifest.styles)));

const mod = await import(pathToFileURL(path.join(here, 'dist', 'index.js')).href + `?t=${Date.now()}`);
check('exports activate', typeof mod.activate === 'function');
check('exports deactivate', typeof mod.deactivate === 'function');

const css = fs.readFileSync(path.join(here, 'dist', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
check('css braces balanced', (css.match(/{/g) || []).length === (css.match(/}/g) || []).length);
check('css: agents list rules', css.includes('.teammate-panel .task-item[data-status="running"]'));
check('css: commit panel shrinks', /\.git-operations-panel\s*{\s*min-width:\s*0/.test(css));
check('css: commit switch wraps', css.includes('[data-testid="git-commit-mode-toggle"]'));

console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
