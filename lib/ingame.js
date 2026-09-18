'use strict';
/**
 * The launcher is an Electron app and has no way to reach into Minecraft's
 * own rendering while the game is running - anything that changes menus,
 * HUD elements or in-game colours has to happen inside the game process,
 * which means a mod.
 *
 * So the split is: the launcher owns the UI for these options and writes
 * them to a plain JSON config file in a known location; the Nyx companion
 * Fabric mod reads that file at game startup and applies them. Until that
 * mod is installed in an instance, writing this file is harmless and simply
 * has no effect.
 */
const fs = require('fs');
const path = require('path');

const IN_GAME_KEYS = [
  'inGameAccentColor',
  'inGameFpsCounter',
  'inGameFpsPosition',
  'inGameCoords',
  'inGameCustomMenuTheme',
  'inGameHideHandsInF1',
  'inGameCpsCounter',
];

/** Strips the `inGame` prefix so the mod sees plain names (accentColor, fpsCounter, ...). */
function toModConfig(settings) {
  const out = {};
  for (const key of IN_GAME_KEYS) {
    const short = key.replace(/^inGame/, '');
    out[short.charAt(0).toLowerCase() + short.slice(1)] = settings[key];
  }
  return out;
}

/**
 * Writes the config next to the launcher's own data. Best-effort: a failure
 * here should never stop the launcher or a game launch, so it's logged and
 * swallowed rather than thrown.
 */
function writeConfig(userDataDir, settings) {
  try {
    const target = path.join(userDataDir, 'nyx-ingame-config.json');
    const payload = { version: 1, updatedAt: new Date().toISOString(), options: toModConfig(settings) };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2));
    return target;
  } catch (err) {
    console.error('Could not write in-game config:', err);
    return null;
  }
}

module.exports = { writeConfig, toModConfig, IN_GAME_KEYS };
