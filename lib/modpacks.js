'use strict';
/**
 * Downloads and unpacks a Modrinth .mrpack modpack.
 *
 * A .mrpack is just a zip containing `modrinth.index.json` (the file list +
 * declared Minecraft version/loader) plus an optional `overrides/` folder of
 * configs/resource packs to copy in verbatim. See
 * https://docs.modrinth.com/docs/modpacks/format_definition/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const AdmZip = require('adm-zip');

const USER_AGENT = 'nyx-client/0.3.0';

function downloadToPath(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.rmSync(destPath, { force: true });
          downloadToPath(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.rmSync(destPath, { force: true });
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(destPath)));
      })
      .on('error', (err) => {
        file.close();
        fs.rmSync(destPath, { force: true });
        reject(err);
      });
  });
}

/** Join a zip-declared relative path onto instanceRoot, refusing to escape it (zip-slip guard). */
function safeJoin(instanceRoot, relPath) {
  const root = path.resolve(instanceRoot);
  const dest = path.resolve(root, relPath);
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  return dest;
}

/**
 * Download and unpack a Modrinth .mrpack file straight into an instance's
 * game directory. Returns the pack's declared Minecraft version + loader so
 * the caller can create/update the right instance for it, and skips
 * anything in the pack the client doesn't need (env.client === 'unsupported').
 */
async function installMrpack(mrpackUrl, instanceRoot, { onProgress } = {}) {
  const tmpFile = path.join(os.tmpdir(), `nyx-pack-${Date.now()}-${Math.random().toString(36).slice(2)}.mrpack`);
  await downloadToPath(mrpackUrl, tmpFile);

  try {
    const zip = new AdmZip(tmpFile);
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry) throw new Error('Not a valid .mrpack file (missing modrinth.index.json)');
    const index = JSON.parse(zip.readAsText(indexEntry));

    const deps = index.dependencies || {};
    const mcVersion = deps.minecraft || null;
    let loader = 'vanilla';
    let loaderVersion = 'latest';
    if (deps['fabric-loader']) { loader = 'fabric'; loaderVersion = deps['fabric-loader']; }
    else if (deps['quilt-loader']) { loader = 'quilt'; loaderVersion = deps['quilt-loader']; }
    else if (deps.forge) { loader = 'forge'; loaderVersion = deps.forge; }
    else if (deps.neoforge) { loader = 'forge'; loaderVersion = deps.neoforge; } // closest supported loader

    const files = (index.files || []).filter((f) => f.env?.client !== 'unsupported');
    let done = 0;
    for (const f of files) {
      const dest = safeJoin(instanceRoot, f.path);
      const url = f.downloads?.[0];
      if (dest && url) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await downloadToPath(url, dest);
      }
      done++;
      onProgress?.(done, files.length);
    }

    // Copy overrides/ (configs, resource packs, etc.) verbatim.
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('overrides/')) continue;
      const rel = entry.entryName.slice('overrides/'.length);
      if (!rel) continue;
      const dest = safeJoin(instanceRoot, rel);
      if (!dest) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
    }

    return { name: index.name, mcVersion, loader, loaderVersion, fileCount: files.length };
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

module.exports = { installMrpack };
