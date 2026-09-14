'use strict';
/**
 * Wraps minecraft-java-core (https://github.com/luuxis/minecraft-java-core)
 * for two things: Microsoft sign-in, and actually starting the game.
 *
 * minecraft-java-core handles the boring-but-critical parts itself:
 * downloading the right client jar/libraries/assets for a version, installing
 * Fabric/Forge/Quilt, picking a matching JRE, and building the java launch
 * command. That's deliberate - re-implementing Mojang's version/asset
 * resolution from scratch is how launchers rot every time Mojang tweaks the
 * manifest format.
 *
 * Note on sign-in: calling Microsoft#getAuth() inside Electron opens its own
 * Microsoft login popup window and resolves once the user finishes signing
 * in there - you don't need to build a device-code UI yourself.
 *
 * License note: minecraft-java-core is CC BY-NC 4.0 (non-commercial). Fine
 * for a personal launcher; re-check the license before shipping this
 * commercially.
 */

const { Launch, Microsoft } = require('minecraft-java-core');

/** Opens the library's Microsoft sign-in popup and returns the account profile. */
async function signIn() {
  const account = await new Microsoft().getAuth();
  // getAuth() resolves to `false` if the user closes the popup, or an
  // { error, errorType } object if Microsoft/Xbox/XSTS rejected the login.
  if (!account) throw new Error('Sign-in was cancelled.');
  if (account.error) throw new Error(account.error);
  return account; // { name, uuid, access_token, refresh_token, meta: {...}, ... }
}

/** Silently refreshes a stored account's token; throws if the refresh token is dead. */
async function refresh(account) {
  const refreshed = await new Microsoft().refresh(account);
  if (!refreshed) throw new Error('Session expired, please sign in again.');
  if (refreshed.error) throw new Error(refreshed.error);
  return refreshed;
}

const LOADER_TYPES_NEEDING_INSTALL = new Set(['fabric', 'forge', 'quilt', 'neoforge']);

/**
 * Starts the game for one instance. Returns the Launch emitter so the
 * caller (main.js) can forward progress/log/close events to the renderer.
 *
 * @param {object} instance   from instances.js (mcVersion, loader, loaderVersion, id)
 * @param {string} instanceRoot  this instance's own game directory
 * @param {object} account    Microsoft account profile from signIn()/refresh()
 * @param {object} settings   { memoryMinGb, memoryMaxGb, javaPath, windowWidth, windowHeight, fullscreen }
 * @param {object|null} joinServer  optional { host, port } - auto-connects to a multiplayer
 *   server on launch using Minecraft's standard --server/--port arguments (the same ones
 *   third-party launchers use for "direct connect"; no special server-side support needed).
 */
function launch(instance, instanceRoot, account, settings = {}, joinServer = null) {
  const launcher = new Launch();

  const gameArgs = [];
  if (joinServer?.host) {
    gameArgs.push('--server', joinServer.host, '--port', String(joinServer.port || 25565));
  }

  const opt = {
    authenticator: account,
    path: instanceRoot,
    version: instance.mcVersion,
    detached: false,
    downloadFileMultiple: 15,
    loader: {
      type: LOADER_TYPES_NEEDING_INSTALL.has(instance.loader) ? instance.loader : null,
      build: instance.loaderVersion || 'latest',
      enable: LOADER_TYPES_NEEDING_INSTALL.has(instance.loader),
      // Left at the library's default (./loader/<type>, relative to `path`
      // above) - instanceRoot is already unique per instance, so this stays
      // isolated without needing an override.
    },
    verify: true,
    JVM_ARGS: (settings.customJvmArgs || '').trim().split(/\s+/).filter(Boolean),
    GAME_ARGS: gameArgs,
    java: {
      path: settings.javaPath || null,
      version: null,
      type: 'jre',
    },
    screen: {
      width: settings.windowWidth || 1280,
      height: settings.windowHeight || 720,
      fullscreen: !!settings.fullscreen,
    },
    memory: {
      min: `${settings.memoryMinGb || 2}G`,
      max: `${settings.memoryMaxGb || 4}G`,
    },
  };

  // Fire-and-forget: caller listens on the returned emitter for progress/data/close/error.
  launcher.Launch(opt).catch((err) => launcher.emit('error', err));
  return launcher;
}

module.exports = { signIn, refresh, launch };
