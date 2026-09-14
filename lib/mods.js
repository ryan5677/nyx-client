'use strict';
/**
 * Manages the `mods/` folder of a single instance's game directory.
 *
 * Every instance gets its own root game directory (see instances.js), so
 * `mods/` here is exactly `<instance root>/mods` - the same convention the
 * vanilla launcher and every mod loader already understand. No guessing
 * about a third-party library's internal folder layout.
 *
 * Disabling a mod is done the classic way: renaming `thing.jar` to
 * `thing.jar.disabled` so the loader skips it, without losing the file.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function modsDir(instanceRoot) {
  const dir = path.join(instanceRoot, 'mods');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isJar(filename) {
  return /\.jar$/i.test(filename);
}
function isDisabledJar(filename) {
  return /\.jar\.disabled$/i.test(filename);
}

// ----------------------------------------------------------------- Manifest
// Tracks where each installed jar came from (which Modrinth/CurseForge
// project it is) so we can tell "do I already have this dependency?"
// reliably instead of guessing from filenames, and so the UI can show which
// mods were auto-pulled in as someone else's dependency.
const MANIFEST_FILE = '.nyx-manifest.json';

function manifestPath(instanceRoot) {
  return path.join(modsDir(instanceRoot), MANIFEST_FILE);
}

function readManifest(instanceRoot) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(instanceRoot), 'utf-8'));
  } catch {
    return {};
  }
}

function writeManifest(instanceRoot, manifest) {
  try {
    fs.writeFileSync(manifestPath(instanceRoot), JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.error('Could not write mod manifest:', err);
  }
}

/** Has this instance already got a file installed for the given source+projectId? */
function hasProject(instanceRoot, source, projectId) {
  const manifest = readManifest(instanceRoot);
  return Object.values(manifest).some((m) => m.source === source && m.projectId === projectId);
}

/** List installed mods with enabled/disabled state and basic file info. */
function list(instanceRoot) {
  const dir = modsDir(instanceRoot);
  const manifest = readManifest(instanceRoot);
  return fs
    .readdirSync(dir)
    .filter((f) => isJar(f) || isDisabledJar(f))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      const enabled = isJar(f);
      const displayName = enabled ? f.replace(/\.jar$/i, '') : f.replace(/\.jar\.disabled$/i, '');
      const meta = manifest[f] || null;
      return {
        filename: f,
        displayName,
        enabled,
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
        dependencyOf: meta?.dependencyOf || null,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function toggle(instanceRoot, filename, enabled) {
  const dir = modsDir(instanceRoot);
  const from = path.join(dir, filename);
  const base = enabled ? filename.replace(/\.jar\.disabled$/i, '.jar') : filename.replace(/\.jar$/i, '.jar.disabled');
  const to = path.join(dir, base);
  if (from !== to) fs.renameSync(from, to);

  const manifest = readManifest(instanceRoot);
  if (manifest[filename]) {
    manifest[base] = manifest[filename];
    if (base !== filename) delete manifest[filename];
    writeManifest(instanceRoot, manifest);
  }
  return base;
}

function remove(instanceRoot, filename) {
  const dir = modsDir(instanceRoot);
  fs.rmSync(path.join(dir, filename), { force: true });

  const manifest = readManifest(instanceRoot);
  if (manifest[filename]) {
    delete manifest[filename];
    writeManifest(instanceRoot, manifest);
  }
}

/** Copy a mod jar the user dragged in from their OS into this instance's mods folder. */
function installFromLocalPath(instanceRoot, sourcePath) {
  const dir = modsDir(instanceRoot);
  if (!isJar(sourcePath)) {
    throw new Error(`"${path.basename(sourcePath)}" isn't a .jar file`);
  }
  const dest = path.join(dir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, dest);
  return dest;
}

/**
 * Download a mod file (from Modrinth/CurseForge) straight into the mods folder.
 * `meta`, when given, is recorded in the manifest: { source: 'modrinth'|'curseforge',
 * projectId, dependencyOf } - dependencyOf is the project id that pulled this
 * mod in as a required dependency, or null if the user picked it directly.
 */
function installFromUrl(instanceRoot, url, filename, meta = null) {
  const dir = modsDir(instanceRoot);
  const dest = path.join(dir, filename);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'nyx-client/0.3.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.rmSync(dest, { force: true });
          installFromUrl(instanceRoot, res.headers.location, filename, meta).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.rmSync(dest, { force: true });
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          if (meta) {
            const manifest = readManifest(instanceRoot);
            manifest[filename] = {
              source: meta.source,
              projectId: meta.projectId,
              dependencyOf: meta.dependencyOf || null,
              installedAt: Date.now(),
            };
            writeManifest(instanceRoot, manifest);
          }
          resolve(dest);
        }));
      })
      .on('error', (err) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(err);
      });
  });
}

function openFolder(instanceRoot) {
  return modsDir(instanceRoot);
}

/** Wipe the dependency-tracking manifest for an instance (doesn't touch the actual mod files) - a troubleshooting reset, not an uninstall. */
function clearManifest(instanceRoot) {
  writeManifest(instanceRoot, {});
}

module.exports = { list, toggle, remove, installFromLocalPath, installFromUrl, openFolder, modsDir, hasProject, clearManifest };
