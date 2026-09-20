'use strict';
/**
 * Downloads (and caches) the Nyx Companion mod jar from the mod-latest
 * rolling release, and copies it into a Fabric instance's mods folder.
 * Instances aren't touched at all for unsupported loaders/versions, or for
 * Fabric instances where every in-game option is off - no point installing
 * a mod that would render nothing.
 */
const fs = require('fs');
const path = require('path');

const SUPPORTED_VERSIONS = ['1.20.1', '1.20.4', '1.21', '1.21.1'];
const RELEASE_BASE = 'https://github.com/ryan5677/nyx-client/releases/download/mod-latest';

function jarFileName(mcVersion) {
  return `nyx-companion-${mcVersion}.jar`;
}

function cacheDir(userDataDir) {
  return path.join(userDataDir, 'companion-mod-cache');
}

function isSupported(mcVersion, loader) {
  return loader === 'fabric' && SUPPORTED_VERSIONS.includes(mcVersion);
}

/** Any toggle that the mod actually does something with - installing it when all of these are off would be pointless. */
function anyInGameFeatureEnabled(settings) {
  return !!(settings.inGameFpsCounter || settings.inGameCoords || settings.inGameCpsCounter);
}

async function downloadJar(userDataDir, mcVersion) {
  const dir = cacheDir(userDataDir);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, jarFileName(mcVersion));
  // Cached copies are reused rather than re-checked every launch - the
  // rolling release does change over time as the mod is developed further,
  // so a "check for companion mod updates" action may be worth adding
  // later, but silently re-downloading on every single launch would slow
  // launches down for no benefit most of the time.
  if (fs.existsSync(dest)) return dest;
  const url = `${RELEASE_BASE}/${jarFileName(mcVersion)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the Nyx Companion mod for Minecraft ${mcVersion} (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

/**
 * @returns {Promise<{installed: boolean, reason?: string}>}
 */
async function ensureInInstance(userDataDir, instanceRoot, mcVersion, loader, settings) {
  if (!isSupported(mcVersion, loader)) return { installed: false, reason: 'unsupported' };
  if (!anyInGameFeatureEnabled(settings)) return { installed: false, reason: 'nothing-enabled' };
  try {
    const jarPath = await downloadJar(userDataDir, mcVersion);
    const modsDir = path.join(instanceRoot, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    fs.copyFileSync(jarPath, path.join(modsDir, path.basename(jarPath)));
    return { installed: true };
  } catch (err) {
    console.error('Could not install the Nyx Companion mod:', err);
    return { installed: false, reason: 'error', error: err.message };
  }
}

module.exports = { ensureInInstance, isSupported, SUPPORTED_VERSIONS };
