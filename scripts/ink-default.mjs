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

/** True when the picked theme is one of the Ink themes. */
export const themeIsInk = (settings) => typeof settings.theme === "string" && settings.theme.startsWith(`${EXTENSION_ID}:`);

/**
 * What the installer does with the theme: "set" (fresh, or a non-Ink theme picked before the setup switched once:
 * the new look only draws with an Ink theme), "keep" (an Ink theme, or a non-Ink one picked after the one switch).
 * `switched` is the installer's record that the one switch was made.
 */
export const themeAction = (settings, switched) => (themeIsFresh(settings) || (!themeIsInk(settings) && !switched) ? "set" : "keep");

/**
 * True when the person picked a theme since the pending line was recorded: it is an Ink theme now, or differs from
 * `from` (the theme seen when the line was recorded, null for none). The settings file can be read while Nimbalyst runs.
 */
export const pickedSincePending = (settings, from) => themeIsInk(settings) || (settings.theme ?? null) !== (from ?? null);

/** The line install.mjs and update.mjs print while Nimbalyst is open: it tells a Claude and a person what to do. */
export const PENDING_LINE = `theme: set now: ${INK_DEFAULT.theme} (Nimbalyst is open. Claude inside Nimbalyst: call mcp__nimbalyst-host__appearance_set_theme with that theme; only if the call succeeds, run node ~/.claude/skills/update-setup/update.mjs --theme-done; if it fails, tell the person to quit and reopen Nimbalyst and run /update-setup again. By hand: the Theme button at the bottom of the left bar, Ink themes, Ink Cobalt.)`;

/** Sets Ink Cobalt in the settings object (the caller decides with themeAction); returns true. */
export function setInkDefault(settings) {
  settings.theme = INK_DEFAULT.theme;
  settings.themeIsDark = INK_DEFAULT.isDark;
  settings.themeBackgroundColor = INK_DEFAULT.background;
  delete settings.pendingThemeFallback;
  // The theme only draws when its extension is on.
  settings.extensionSettings = settings.extensionSettings || {};
  settings.extensionSettings["com.local.inktheme"] = { ...(settings.extensionSettings["com.local.inktheme"] || {}), enabled: true };
  return true;
}
