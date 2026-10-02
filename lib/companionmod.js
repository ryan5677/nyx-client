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

// Bump this whenever the mod changes in a way players need. Cached jars are
// keyed on it, so a bump forces one fresh download instead of reusing a stale
// (or broken) cached jar forever.
const MOD_REVISION = 3;

function jarFileName(mcVersion) {
  return `nyx-companion-${mcVersion}.jar`;
}

function cacheDir(userDataDir) {
  return path.join(userDataDir, 'companion-mod-cache');
}

// CI publishes versions.json next to the jars listing which Minecraft versions
// actually built, so new versions become supported without a launcher update.
// The hard-coded list is only the fallback for when that can't be fetched.
let manifestCache = { at: 0, versions: null };

async function supportedVersions() {
  if (manifestCache.versions && Date.now() - manifestCache.at < 10 * 60 * 1000) return manifestCache.versions;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`${RELEASE_BASE}/versions.json`, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.versions) && data.versions.length) {
        manifestCache = { at: Date.now(), versions: data.versions };
        return data.versions;
      }
    }
  } catch { /* offline or rate-limited - use the fallback below */ }
  return manifestCache.versions || SUPPORTED_VERSIONS;
}

async function isSupported(mcVersion, loader) {
  return loader === 'fabric' && (await supportedVersions()).includes(mcVersion);
}

/** Any toggle that the mod actually does something with - installing it when all of these are off would be pointless. */
function anyInGameFeatureEnabled(settings) {
  return settings.inGameCustomMenu !== false || settings.inGameCustomSettings !== false;
}

async function downloadJar(userDataDir, mcVersion) {
  const dir = cacheDir(userDataDir);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `r${MOD_REVISION}-${jarFileName(mcVersion)}`);
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
  if (!(await isSupported(mcVersion, loader))) return { installed: false, reason: 'unsupported' };
  if (!anyInGameFeatureEnabled(settings)) return { installed: false, reason: 'nothing-enabled' };
  try {
    const jarPath = await downloadJar(userDataDir, mcVersion);
    const modsDir = path.join(instanceRoot, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    // Remove any older Nyx Companion jar first - two copies of the same mod id
    // would stop Fabric from starting.
    for (const f of fs.readdirSync(modsDir)) {
      if (/^nyx-companion-.*\.jar$/.test(f)) fs.rmSync(path.join(modsDir, f), { force: true });
    }
    fs.copyFileSync(jarPath, path.join(modsDir, jarFileName(mcVersion)));
    return { installed: true };
  } catch (err) {
    console.error('Could not install the Nyx Companion mod:', err);
    return { installed: false, reason: 'error', error: err.message };
  }
}

module.exports = { ensureInInstance, isSupported, supportedVersions, SUPPORTED_VERSIONS };
