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
 * feeds (latest.yml vs dev.yml) from colliding on the same repo, so each
 * variant only ever offers to update itself to a newer build of itself.
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
  // Releases go back to normal (non-prerelease) from here on - prerelease
  // scanning forces electron-updater onto GitHub's heavier "list every
  // release" API call instead of the single lightweight "latest release"
  // one, and both are subject to the same 60-requests-per-hour-per-IP
  // unauthenticated limit, so there's no reason to pay that extra cost
  // once a release doesn't need the prerelease label anymore.
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: friendlyErrorMessage(err) }));
}

/**
 * GitHub's unauthenticated API allows 60 requests/hour per IP - easy to
 * exhaust during heavy testing (many launches/manual checks in a short
 * window), effectively impossible to hit under normal day-to-day use
 * (checking once or twice per launch). Worth calling out specifically
 * rather than a generic failure, since "try again later" is actually
 * correct advice here rather than a sign of something broken.
 */
function friendlyErrorMessage(err) {
  const raw = err?.message || String(err);
  if (/403/.test(raw) && /rate.?limit/i.test(raw)) {
    return 'GitHub is rate-limiting update checks from this network right now - this resets automatically within the hour, no action needed.';
  }
  return raw;
}

async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    send({ state: 'error', message: friendlyErrorMessage(err) });
  }
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { init, checkForUpdates, quitAndInstall };
