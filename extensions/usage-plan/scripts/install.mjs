// Installs the built extension into Nimbalyst's user extensions folder
// (%APPDATA%\@nimbalyst\electron\extensions\usageplan). Does not touch the app install.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

const target = path.join(process.env.APPDATA, '@nimbalyst', 'electron', 'extensions', 'usageplan');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const item of ['manifest.json', 'dist', 'README.md']) {
  if (fs.existsSync(item)) fs.cpSync(item, path.join(target, item), { recursive: true });
}
fs.writeFileSync(
  path.join(target, 'package.json'),
  JSON.stringify({ name: 'usageplan', version: '0.1.0', private: true, type: 'module', main: 'dist/index.js' }, null, 2)
);
console.log('installed to', target);
