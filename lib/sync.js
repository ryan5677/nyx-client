'use strict';
/**
 * Copies mods/, resourcepacks/, and options.txt from one instance's game
 * directory to one or more others. A manual, explicit action, never
 * automatic - that matches the whole point of instances having their own
 * folders in the first place (see instances.js): nothing contaminates
 * anything else unless the user specifically asks for it.
 *
 * Nyx's own in-game options (accent colour, HUD toggles - see ingame.js)
 * aren't part of this: they're already a single global config shared by
 * every instance, not per-instance, so there's nothing to sync there.
 */
const fs = require('fs');
const path = require('path');

function copyDirContents(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return false;
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true, force: true });
  return true;
}

/**
 * @param {string} sourceRoot instance game directory to copy FROM
 * @param {string} targetRoot instance game directory to copy TO
 * @param {{mods?: boolean, resourcePacks?: boolean, options?: boolean}} what
 * @returns {{mods: boolean, resourcePacks: boolean, options: boolean}} which parts actually had something to copy
 */
function syncInstance(sourceRoot, targetRoot, what = {}) {
  const { mods = true, resourcePacks = true, options = true } = what;
  const done = { mods: false, resourcePacks: false, options: false };

  if (mods) done.mods = copyDirContents(path.join(sourceRoot, 'mods'), path.join(targetRoot, 'mods'));
  if (resourcePacks) done.resourcePacks = copyDirContents(path.join(sourceRoot, 'resourcepacks'), path.join(targetRoot, 'resourcepacks'));
  if (options) {
    const src = path.join(sourceRoot, 'options.txt');
    if (fs.existsSync(src)) {
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.copyFileSync(src, path.join(targetRoot, 'options.txt'));
      done.options = true;
    }
  }
  return done;
}

module.exports = { syncInstance };
