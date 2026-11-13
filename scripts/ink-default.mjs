// The theme a fresh Nimbalyst gets from the install: Ink Cobalt, when nobody has picked a theme yet.
// Nimbalyst keeps its settings in @nimbalyst/electron/app-settings.json. Until a person picks a theme the file
// has no "theme" key, or "system" (the app's default); any other value was picked and stays. The app holds the
// file in memory while it runs and writes it back, so install.mjs only writes it while Nimbalyst is closed.
// Off: install.mjs --no-theme, or SETUP_THEME=off.

import { EXTENSION_ID, THEMES } from '../extensions/ink-themes/themes.mjs';

// read from the theme list, so a changed Cobalt colour reaches the installer too
const cobalt = THEMES.find((t) => t.id === 'ink-cobalt');
if (!cobalt) throw new Error('ink-default: no ink-cobalt in extensions/ink-themes/themes.mjs');
export const INK_DEFAULT = { theme: `${EXTENSION_ID}:${cobalt.id}`, isDark: cobalt.isDark, background: cobalt.bg };

/** True when the settings hold no theme the person picked. */
export const themeIsFresh = (settings) => settings.theme === undefined || settings.theme === "system";

/** Sets Ink Cobalt in the settings object when the theme is fresh; returns whether it changed anything. */
export function setInkDefault(settings) {
  if (!themeIsFresh(settings)) return false;
  settings.theme = INK_DEFAULT.theme;
  settings.themeIsDark = INK_DEFAULT.isDark;
  settings.themeBackgroundColor = INK_DEFAULT.background;
  delete settings.pendingThemeFallback;
  // The theme only draws when its extension is on.
  settings.extensionSettings = settings.extensionSettings || {};
  settings.extensionSettings["com.local.inktheme"] = { ...(settings.extensionSettings["com.local.inktheme"] || {}), enabled: true };
  return true;
}
