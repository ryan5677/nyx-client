'use strict';
/**
 * Thin wrapper around electron-updater. Checks GitHub Releases for a newer
 * build than the one currently running, downloads it in the background, and
 * asks the renderer to prompt for a restart once it's ready. Every stage is
 * forwarded to the renderer over 'updater:status' so the About panel can
 * show something more useful than silence.
 *
 * Dev and Public are two different products as far as GitHub Releases is
 * concerned (different appId/productName, see scripts/build-variant.js) and
 * each build's own package.json "build.publish.channel" keeps their update
 * feeds (latest.yml vs latest-dev.yml) from colliding on the same repo, so
 * each variant only ever offers to update itself to a newer build of
 * itself.
 */
const { autoUpdater } = require('electron-updater');

let mainWindowRef = null;
let initialized = false;

function send(status) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:status', status);
  }
}

function init(mainWindow) {
  mainWindowRef = mainWindow;
  if (initialized) return;
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Releases are currently published to GitHub flagged as pre-release.
  // electron-updater ignores pre-releases unless this is on, so without it
  // auto-update would silently stop finding anything.
  autoUpdater.allowPrerelease = true;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message || String(err) }));
}

async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    send({ state: 'error', message: err?.message || String(err) });
  }
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { init, checkForUpdates, quitAndInstall };
