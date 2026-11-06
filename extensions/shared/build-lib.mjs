// What the extensions' build and install scripts have in common: the answer language, the STRINGS swap
// of the plain-JS extensions, the shared design tokens, and the copy into Nimbalyst's extensions folder.
// Node only; the browser side lives in host.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shared = path.dirname(fileURLToPath(import.meta.url));

/** The language the installer chose (SETUP_LANGUAGE, unset = english). Anything else is an error. */
export function setupLanguage() {
  const language = process.env.SETUP_LANGUAGE || 'english';
  if (language !== 'english' && language !== 'russian') {
    throw new Error(`SETUP_LANGUAGE must be "english" or "russian", not "${language}".`);
  }
  return language;
}

/** The same choice for the plain-JS builds, which also take `ru` and never refuse a value. */
export function lenientLanguage() {
  return (process.env.SETUP_LANGUAGE || 'english').toLowerCase().replace(/^ru$/, 'russian');
}

const STRINGS_START = 'const STRINGS = {';
const STRINGS_END = '\n};';

/** Swaps the whole `const STRINGS = {...};` of a plain-JS extension's source for `russianBlock`. */
export function swapStrings(js, russianBlock, file = 'src/index.js') {
  const from = js.indexOf(STRINGS_START);
  const to = js.indexOf(STRINGS_END, from);
  if (from < 0 || to < 0) throw new Error(`STRINGS object not found in ${file}`);
  return js.slice(0, from) + russianBlock + js.slice(to + STRINGS_END.length);
}

/** The text of shared/tokens.css. */
export function readTokens() {
  const file = path.join(shared, 'tokens.css');
  if (!fs.existsSync(file)) throw new Error(`shared tokens not found: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

/** The folder of one extension in Nimbalyst's user extensions folder. The folder name must equal the manifest id's last part. */
export function extensionTarget(folder) {
  // On a Mac Nimbalyst keeps its settings under Application Support
  const appData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.APPDATA;
  if (!appData) throw new Error("APPDATA is not set, so Nimbalyst's folder is unknown");
  const home = path.join(appData, '@nimbalyst', 'electron');
  if (!fs.existsSync(home)) throw new Error(`Nimbalyst's folder is not there: ${home}`);
  return path.join(home, 'extensions', folder);
}

/**
 * Checks ./dist with the SDK's validator, then replaces the installed copy of the extension in
 * Nimbalyst's folder with `items` (relative to the current folder) and a package.json.
 */
export async function installBuilt(folder, items = ['manifest.json', 'dist', 'README.md']) {
  // The SDK's main entry pulls in host-only modules, so load the validator file directly.
  const { validateExtensionBundle } = await import(
    pathToFileURL(path.resolve('node_modules/@nimbalyst/extension-sdk/dist/validate.js')).href
  );
  const result = await validateExtensionBundle('./dist');
  if (!result.valid) {
    console.error('Bundle validation failed:', result.errors);
    process.exit(1);
  }
  for (const w of result.warnings ?? []) console.warn('warning:', w);

  const target = extensionTarget(folder);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const item of items) {
    if (fs.existsSync(item)) fs.cpSync(item, path.join(target, item), { recursive: true });
  }
  // Marks dist/ files as ESM (read-aloud's backend.js runs in a utility process)
  fs.writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify({ name: folder, version: '0.1.0', private: true, type: 'module', main: 'dist/index.js' }, null, 2)
  );
  console.log('installed to', target);
}
