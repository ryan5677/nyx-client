'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Store } = require('./lib/store');
const { Instances } = require('./lib/instances');
const mods = require('./lib/mods');
const versions = require('./lib/versions');
const modrinth = require('./lib/modrinth');
const curseforge = require('./lib/curseforge');
const launcher = require('./lib/launcher');
const skins = require('./lib/skins');
const hardware = require('./lib/hardware');
const modpacks = require('./lib/modpacks');
const mcping = require('./lib/mcping');
const lan = require('./lib/lan');
const updater = require('./lib/updater');
const ingame = require('./lib/ingame');
const sync = require('./lib/sync');
const { VARIANT } = require('./lib/variant');
const { DEFAULT_BACKEND_URL } = require('./lib/config');

let mainWindow = null;
let instances = null;
let settingsStore = null;
let accountStore = null;
let friendsStore = null;

const DEFAULT_SETTINGS = {
  memoryMinGb: 2,
  memoryMaxGb: 4,
  javaPath: null,
  windowWidth: 1280,
  windowHeight: 720,
  fullscreen: false,
  showSnapshots: false,
  curseforgeApiKey: '',
  closeOnLaunch: false,
  theme: 'dark',
  accentColor: '#8b5cf6',
  roundedUI: true,
  nightSky: false,
  starDensity: 40,
  shootingStarCount: 7,
  shootingStarSpeed: 1,
  sidebarPosition: 'left',
  uiDensity: 'comfortable',
  adminUnlocked: false,
  backendUrl: DEFAULT_BACKEND_URL,
  backendAdminKey: '',
  customJvmArgs: '',
  startupAnimation: 'full', // 'full' | 'quick' | 'off'
  lastSeenVersion: null, // drives the "you've been updated" popup - set on every boot, popup only fires when this differs from the running version and isn't null (i.e. never on a fresh install)
  launchOnStartup: false, // register with Windows to start when the PC does
  launchMinimized: true, // when launched at startup, come up minimised rather than grabbing focus

  // In-game options. These are written out to a config file that the Nyx
  // companion Fabric mod reads at runtime - the launcher itself cannot
  // change anything inside Minecraft's own rendering, so none of these do
  // anything until that mod is installed in the instance.
  inGameAccentColor: '#8b5cf6',
  inGameFpsCounter: false,
  inGameFpsPosition: 'top-left', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  inGameCoords: false,
  inGameCustomMenuTheme: true,
  inGameHideHandsInF1: false,
  inGameCpsCounter: false,
};

/**
 * Fabric/Quilt instances get Fabric API + Mod Menu pre-installed, the same
 * way the old code did for Fabric API alone on the auto-created Default
 * instance - here it applies to every new Fabric/Quilt instance, and skips
 * anything already present. Best-effort: a missing/incompatible utility (or
 * being offline) never blocks instance creation.
 */
async function installDefaultUtilityMods(instanceRoot, loader, mcVersion) {
  if (loader !== 'fabric' && loader !== 'quilt') return;
  for (const slug of ['fabric-api', 'modmenu']) {
    try {
      if (mods.hasProject(instanceRoot, 'modrinth', slug)) continue;
      const file = await modrinth.getBestFile(slug, { loader, mcVersion });
      if (file) await mods.installFromUrl(instanceRoot, file.url, file.filename, { source: 'modrinth', projectId: slug });
    } catch (err) {
      console.error(`Could not install ${slug}:`, err);
    }
  }
}

/** Recursively install a Modrinth project's required dependencies, then the project itself. Skips anything already installed. */
async function installModrinthWithDeps(instanceRoot, inst, projectId) {
  const seen = new Set();
  async function step(pid) {
    if (seen.has(pid)) return [];
    seen.add(pid);
    if (mods.hasProject(instanceRoot, 'modrinth', pid)) return [];

    const best = await modrinth.getBestFile(pid, { loader: inst.loader, mcVersion: inst.mcVersion });
    if (!best) {
      if (pid === projectId) throw new Error("No file compatible with this instance's version/loader.");
      return []; // an optional/required dep with nothing compatible - skip it rather than fail the whole install
    }

    const installed = [];
    for (const dep of best.dependencies || []) {
      if (dep.type !== 'required') continue;
      try {
        installed.push(...(await step(dep.projectId)));
      } catch (err) {
        console.error(`Modrinth dependency ${dep.projectId} failed:`, err);
      }
    }
    await mods.installFromUrl(instanceRoot, best.url, best.filename, {
      source: 'modrinth',
      projectId: pid,
      dependencyOf: pid === projectId ? null : projectId,
    });
    installed.push(best.filename);
    return installed;
  }

  const all = await step(projectId);
  if (!all.length) return { alreadyInstalled: true };
  return { filename: all[all.length - 1], dependenciesInstalled: all.slice(0, -1) };
}

/** Same idea as installModrinthWithDeps, for CurseForge (relationType 3 = required dependency). */
async function installCurseforgeWithDeps(instanceRoot, inst, modId, apiKey) {
  const seen = new Set();
  async function step(id) {
    if (seen.has(id)) return [];
    seen.add(id);
    if (mods.hasProject(instanceRoot, 'curseforge', id)) return [];

    const file = await curseforge.getBestFile(apiKey, id, { mcVersion: inst.mcVersion, loader: inst.loader });
    if (!file || !file.downloadUrl) {
      if (id === modId) {
        if (file && !file.downloadUrl) {
          // A compatible file exists but CurseForge withheld the URL - almost always because
          // the author opted out of third-party distribution, not an incompatibility.
          let reason = "This mod's author has disabled third-party downloads for it - CurseForge blocks the file at the API level, so no tool (this one included) can fetch it automatically. Download it manually from the mod's CurseForge page and drag the .jar into the Mods tab.";
          try {
            const modInfo = await curseforge.getMod(apiKey, id);
            if (modInfo.allowsThirdPartyDownload) {
              reason = 'CurseForge did not return a download link for this file. Try again in a moment, or download it manually from the mod\'s CurseForge page.';
            }
          } catch {
            // Diagnostic call failed - stick with the more common explanation above rather than blocking on it.
          }
          throw new Error(reason);
        }
        throw new Error("No file compatible with this instance's Minecraft version/loader.");
      }
      return [];
    }

    const installed = [];
    for (const dep of file.dependencies || []) {
      if (dep.relationType !== 3) continue;
      try {
        installed.push(...(await step(dep.modId)));
      } catch (err) {
        console.error(`CurseForge dependency ${dep.modId} failed:`, err);
      }
    }
    await mods.installFromUrl(instanceRoot, file.downloadUrl, file.filename, {
      source: 'curseforge',
      projectId: id,
      dependencyOf: id === modId ? null : modId,
    });
    installed.push(file.filename);
    return installed;
  }

  const all = await step(modId);
  if (!all.length) return { alreadyInstalled: true };
  return { filename: all[all.length - 1], dependenciesInstalled: all.slice(0, -1) };
}

/** Multi-account store shape: { accounts: { [uuid]: account }, activeUuid } */
function listAccounts() {
  return Object.values(accountStore.get('accounts', {}));
}
function getActiveAccount() {
  const activeUuid = accountStore.get('activeUuid', null);
  if (!activeUuid) return null;
  return accountStore.get('accounts', {})[activeUuid] || null;
}
function upsertAccount(account) {
  const accounts = accountStore.get('accounts', {});
  const existing = accounts[account.uuid];
  accounts[account.uuid] = { ...existing, ...account, joinedAt: existing?.joinedAt || Date.now() };
  accountStore.set('accounts', accounts);
}

/** Patch arbitrary fields onto the currently-active account (e.g. adminUnlocked/premium tags). */
function tagActiveAccount(patch) {
  const activeUuid = accountStore.get('activeUuid', null);
  if (!activeUuid) return null;
  const accounts = accountStore.get('accounts', {});
  if (!accounts[activeUuid]) return null;
  accounts[activeUuid] = { ...accounts[activeUuid], ...patch };
  accountStore.set('accounts', accounts);
  return accounts[activeUuid];
}

/** True when Windows (not the user) launched us at login - we add this flag ourselves in applyLaunchOnStartup below. */
function launchedAtStartup() {
  return process.argv.includes('--startup');
}

function createWindow() {
  const settings = { ...DEFAULT_SETTINGS, ...settingsStore.read() };
  const startHidden = launchedAtStartup() && settings.launchMinimized;

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#181b1d',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: !startHidden, // avoids a visible flash-then-minimise at login
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (startHidden) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.minimize();
      mainWindow.show();
    });
  }
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

/**
 * Registers (or clears) the Windows login-item entry. The --startup flag is
 * how the app later knows it was auto-launched rather than opened by hand,
 * which is what gates the start-minimised behaviour.
 */
function applyLaunchOnStartup(settings) {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!settings.launchOnStartup,
      path: process.execPath,
      args: ['--startup'],
    });
  } catch (err) {
    console.error('Could not update launch-on-startup setting:', err);
  }
}

let skinEditorWindow = null;

/** Skin Editor lives in its own window - singleton, focuses the existing one instead of opening duplicates. */
function openSkinEditorWindow() {
  if (skinEditorWindow && !skinEditorWindow.isDestroyed()) {
    skinEditorWindow.focus();
    return;
  }
  skinEditorWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0b0a22',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  skinEditorWindow.loadFile(path.join(__dirname, 'src', 'skin-editor.html'));
  skinEditorWindow.on('closed', () => { skinEditorWindow = null; });
}

/** First run: create a Default instance on Fabric + latest release, with Fabric API pre-installed. */
async function ensureDefaultInstance() {
  if (instances.all().length > 0) return;
  try {
    const latest = await versions.getLatest();
    const inst = instances.create({
      name: 'Default',
      mcVersion: latest.release,
      loader: 'fabric',
      loaderVersion: 'latest',
    });
    await installDefaultUtilityMods(instances.rootDir(inst.id), 'fabric', latest.release);
  } catch (err) {
    // Offline on first run, or Modrinth hiccup - fall back to an empty vanilla instance
    // rather than blocking startup. The user can still pick a version manually.
    console.error('Could not set up the default instance:', err);
    if (instances.all().length === 0) {
      instances.create({ name: 'Default', mcVersion: '1.21.1', loader: 'vanilla', loaderVersion: 'latest' });
    }
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  instances = new Instances(userData);
  settingsStore = new Store(userData, 'settings', DEFAULT_SETTINGS);
  accountStore = new Store(userData, 'account', { accounts: {}, activeUuid: null });
  friendsStore = new Store(userData, 'friends', { list: [] });

  await ensureDefaultInstance();
  createWindow();
  applyLaunchOnStartup({ ...DEFAULT_SETTINGS, ...settingsStore.read() });
  ingame.writeConfig(userData, { ...DEFAULT_SETTINGS, ...settingsStore.read() });
  updater.init(mainWindow);
  // Quiet background check a few seconds after launch, so it's not competing
  // with the startup animation or the initial instance/account loads for
  // resources. Silent by design when there's nothing new - the About panel
  // only lights up if an update is actually found or downloaded.
  setTimeout(() => updater.checkForUpdates(), 8000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------
ipcMain.handle('versions:vanilla', (_e, { includeSnapshots } = {}) => versions.listVanillaVersions({ includeSnapshots }));
ipcMain.handle('versions:latest', () => versions.getLatest());
ipcMain.handle('versions:fabricLoaders', (_e, mcVersion) => versions.listFabricLoaderVersions(mcVersion));
ipcMain.handle('versions:quiltLoaders', (_e, mcVersion) => versions.listQuiltLoaderVersions(mcVersion));
ipcMain.handle('versions:forgeBuilds', (_e, mcVersion) => versions.listForgeVersions(mcVersion));
ipcMain.handle('versions:forgePromoted', (_e, mcVersion) => versions.getForgePromoted(mcVersion));

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------
ipcMain.handle('instances:list', () => instances.all());
ipcMain.handle('instances:create', async (_e, data) => {
  const inst = instances.create(data);
  await installDefaultUtilityMods(instances.rootDir(inst.id), inst.loader, inst.mcVersion);
  return inst;
});
ipcMain.handle('instances:update', (_e, { id, patch }) => instances.update(id, patch));
ipcMain.handle('instances:remove', (_e, id) => instances.remove(id));

// ---------------------------------------------------------------------------
// Mods (per instance)
// ---------------------------------------------------------------------------
function rootFor(instanceId) {
  const inst = instances.get(instanceId);
  if (!inst) throw new Error('Unknown instance');
  return instances.rootDir(instanceId);
}

ipcMain.handle('mods:list', (_e, instanceId) => mods.list(rootFor(instanceId)));
ipcMain.handle('mods:toggle', (_e, { instanceId, filename, enabled }) => mods.toggle(rootFor(instanceId), filename, enabled));
ipcMain.handle('mods:remove', (_e, { instanceId, filename }) => mods.remove(rootFor(instanceId), filename));
ipcMain.handle('mods:installLocalPath', (_e, { instanceId, filePath }) => mods.installFromLocalPath(rootFor(instanceId), filePath));
ipcMain.handle('mods:openFolder', (_e, instanceId) => shell.openPath(mods.openFolder(rootFor(instanceId))));

ipcMain.handle('mods:installFromModrinth', async (_e, { instanceId, projectId }) => {
  const inst = instances.get(instanceId);
  return installModrinthWithDeps(rootFor(instanceId), inst, projectId);
});

ipcMain.handle('mods:installFromCurseforge', async (_e, { instanceId, modId }) => {
  const inst = instances.get(instanceId);
  const apiKey = settingsStore.get('curseforgeApiKey', '');
  return installCurseforgeWithDeps(rootFor(instanceId), inst, modId, apiKey);
});

// ---------------------------------------------------------------------------
// Mod browser
// ---------------------------------------------------------------------------
ipcMain.handle('browse:modrinthSearch', (_e, { query, loader, mcVersion, offset }) => modrinth.search(query, { loader, mcVersion, offset }));
ipcMain.handle('browse:modrinthProject', (_e, id) => modrinth.getProject(id));
ipcMain.handle('browse:curseforgeSearch', (_e, { query, loader, mcVersion, index }) => {
  const apiKey = settingsStore.get('curseforgeApiKey', '');
  return curseforge.search(apiKey, query, { loader, mcVersion, index });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
ipcMain.handle('auth:current', () => getActiveAccount());
ipcMain.handle('auth:list', () => listAccounts());

ipcMain.handle('auth:signIn', async () => {
  const account = await launcher.signIn();
  upsertAccount(account);
  accountStore.set('activeUuid', account.uuid);
  return syncPremiumFromBackend(account);
});

ipcMain.handle('auth:switch', async (_e, uuid) => {
  const accounts = accountStore.get('accounts', {});
  if (!accounts[uuid]) throw new Error('Unknown account');
  accountStore.set('activeUuid', uuid);
  return syncPremiumFromBackend(accounts[uuid]);
});

ipcMain.handle('auth:remove', (_e, uuid) => {
  const accounts = accountStore.get('accounts', {});
  delete accounts[uuid];
  accountStore.set('accounts', accounts);
  if (accountStore.get('activeUuid', null) === uuid) {
    const remaining = Object.keys(accounts);
    accountStore.set('activeUuid', remaining[0] || null);
  }
  return true;
});

ipcMain.handle('auth:tagActive', (_e, patch) => tagActiveAccount(patch));

ipcMain.handle('auth:faceIcon', async (_e, uuid) => {
  try {
    return await skins.getFaceDataUrl(uuid);
  } catch (err) {
    console.error('Could not fetch skin face icon:', err);
    return null;
  }
});

ipcMain.handle('app:variant', () => VARIANT);
ipcMain.handle('app:openSkinEditor', () => openSkinEditorWindow());

// ---------------------------------------------------------------------------
// Auto-update (electron-updater, GitHub Releases)
// ---------------------------------------------------------------------------
ipcMain.handle('updater:check', () => updater.checkForUpdates());
ipcMain.handle('updater:install', () => updater.quitAndInstall());
ipcMain.handle('updater:currentVersion', () => app.getVersion());

// ---------------------------------------------------------------------------
// Skin editor
// ---------------------------------------------------------------------------
ipcMain.handle('skins:current', async () => {
  const account = getActiveAccount();
  if (!account) return null;
  try {
    return await skins.getCurrentSkin(account.uuid);
  } catch (err) {
    console.error('Could not fetch current skin:', err);
    return null;
  }
});

ipcMain.handle('skins:importFile', async (e) => {
  const parentWin = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  const res = await dialog.showOpenDialog(parentWin, {
    title: 'Import skin',
    filters: [{ name: 'PNG skin', extensions: ['png'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const buf = fs.readFileSync(res.filePaths[0]);
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
});

ipcMain.handle('skins:exportFile', async (e, { dataUrl, suggestedName }) => {
  const parentWin = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  const res = await dialog.showSaveDialog(parentWin, {
    title: 'Save skin',
    defaultPath: suggestedName || 'skin.png',
    filters: [{ name: 'PNG skin', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePath) return false;
  const base64 = String(dataUrl).split(',')[1] || '';
  fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'));
  return true;
});

ipcMain.handle('skins:upload', async (_e, { dataUrl, variant }) => {
  let account = getActiveAccount();
  if (!account) throw new Error('Sign in first (Accounts tab).');

  try {
    account = await launcher.refresh(account);
    upsertAccount(account);
  } catch {
    account = await launcher.signIn();
    upsertAccount(account);
    accountStore.set('activeUuid', account.uuid);
  }

  const base64 = String(dataUrl).split(',')[1] || '';
  const buf = Buffer.from(base64, 'base64');
  await skins.uploadSkin(account.access_token, buf, variant === 'slim' ? 'slim' : 'classic');
  return true;
});

// ---------------------------------------------------------------------------
// Cross-device Premium sync (optional - only talks to anything if
// settings.backendUrl is actually set; otherwise these are all no-ops)
// ---------------------------------------------------------------------------
async function syncPremiumFromBackend(account) {
  const settings = { ...DEFAULT_SETTINGS, ...settingsStore.read() };
  if (!settings.backendUrl || !account) return account;
  try {
    const res = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/accounts/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid: account.uuid, name: account.name }),
    });
    if (!res.ok) return account;
    const { premium, banned } = await res.json();
    return tagActiveAccount({ premium: banned ? false : premium, banned: !!banned }) || account;
  } catch {
    return account; // offline or unreachable - just fall back to whatever's stored locally
  }
}

ipcMain.handle('auth:syncPremium', async () => {
  const account = getActiveAccount();
  if (!account) return null;
  return syncPremiumFromBackend(account);
});

function requireDevVariant() {
  if (VARIANT !== 'dev') throw new Error('Not available in this build.');
}

ipcMain.handle('admin:remoteAccounts', async () => {
  requireDevVariant();
  const settings = { ...DEFAULT_SETTINGS, ...settingsStore.read() };
  if (!settings.backendUrl) throw new Error('Set a backend URL in Settings -> Account sync first.');
  const res = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/accounts`, {
    headers: { 'x-admin-key': settings.backendAdminKey || '' },
  });
  if (res.status === 401) throw new Error('Bad admin key.');
  if (!res.ok) throw new Error(`Backend returned HTTP ${res.status}`);
  return res.json();
});

ipcMain.handle('admin:setRemotePremium', async (_e, { uuid, value }) => {
  requireDevVariant();
  const settings = { ...DEFAULT_SETTINGS, ...settingsStore.read() };
  if (!settings.backendUrl) throw new Error('Set a backend URL in Settings -> Account sync first.');
  const res = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/accounts/${uuid}/premium`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': settings.backendAdminKey || '' },
    body: JSON.stringify({ value }),
  });
  if (res.status === 401) throw new Error('Bad admin key.');
  if (!res.ok) throw new Error(`Backend returned HTTP ${res.status}`);
  return res.json();
});

ipcMain.handle('admin:setRemoteBan', async (_e, { uuid, value }) => {
  requireDevVariant();
  const settings = { ...DEFAULT_SETTINGS, ...settingsStore.read() };
  if (!settings.backendUrl) throw new Error('Set a backend URL in Settings -> Account sync first.');
  const res = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/accounts/${uuid}/ban`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': settings.backendAdminKey || '' },
    body: JSON.stringify({ value }),
  });
  if (res.status === 401) throw new Error('Bad admin key.');
  if (!res.ok) throw new Error(`Backend returned HTTP ${res.status}`);
  return res.json();
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', () => ({ ...DEFAULT_SETTINGS, ...settingsStore.read() }));
ipcMain.handle('settings:set', (_e, patch) => {
  const safePatch = { ...patch };
  if (VARIANT === 'public') delete safePatch.adminUnlocked; // public build: no path to admin, ever - not even by editing settings directly
  const updated = settingsStore.patch(safePatch);
  if ('launchOnStartup' in safePatch) applyLaunchOnStartup(updated);
  if (ingame.IN_GAME_KEYS.some((k) => k in safePatch)) ingame.writeConfig(app.getPath('userData'), { ...DEFAULT_SETTINGS, ...updated });
  return updated;
});

// ---------------------------------------------------------------------------
// Admin dev options
// ---------------------------------------------------------------------------
ipcMain.handle('dev:openDataFolder', () => shell.openPath(app.getPath('userData')));

ipcMain.handle('dev:openLogsFolder', () => shell.openPath(app.getPath('logs')));

ipcMain.handle('dev:openInstanceFolder', (_e, instanceId) => {
  const inst = instances.get(instanceId);
  if (!inst) throw new Error('Unknown instance');
  return shell.openPath(instances.rootDir(instanceId));
});

ipcMain.handle('dev:rawSettings', () => JSON.stringify({ ...DEFAULT_SETTINGS, ...settingsStore.read() }, null, 2));

ipcMain.handle('dev:clearModManifest', (_e, instanceId) => {
  const inst = instances.get(instanceId);
  if (!inst) throw new Error('Unknown instance');
  mods.clearManifest(instances.rootDir(instanceId));
  return true;
});

ipcMain.handle('dev:resetSettings', () => {
  settingsStore.write({ ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
});

ipcMain.handle('dev:debugInfo', () => {
  const settings = { ...DEFAULT_SETTINGS, ...settingsStore.read() };
  const lines = [
    `Nyx Client ${app.getVersion()}`,
    `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Instances: ${instances.all().length}`,
    `Accounts: ${listAccounts().length}`,
    `Theme: ${settings.theme}, accent: ${settings.accentColor}`,
    `Admin unlocked: ${settings.adminUnlocked}, Active account premium: ${getActiveAccount()?.premium || false}`,
  ];
  return lines.join('\n');
});

ipcMain.handle('dev:launchStats', () => {
  const all = instances.all();
  let totalMods = 0;
  for (const inst of all) {
    try {
      totalMods += mods.list(instances.rootDir(inst.id)).length;
    } catch {
      // instance folder may not exist yet - skip it
    }
  }
  const totalPlays = all.reduce((sum, inst) => sum + (inst.playCount || 0), 0);
  return { instanceCount: all.length, totalMods, totalPlays, accountCount: listAccounts().length };
});

ipcMain.handle('dialog:chooseJava', async () => {
  // minecraft-java-core's java.path expects the Java *installation's binaries
  // directory* (the folder that contains `bin/java`), not the executable
  // itself - so this picks a folder, not a file.
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Java installation folder (contains bin/java)',
    properties: ['openDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

// ---------------------------------------------------------------------------
// Hardware / performance recommendations
// ---------------------------------------------------------------------------
ipcMain.handle('system:specs', () => hardware.getSpecs());
ipcMain.handle('system:perfRecommendations', async () => {
  const specs = await hardware.getSpecs();
  return { specs, recommendations: hardware.recommendPerfMods(specs) };
});

ipcMain.handle('system:deepSpecs', () => hardware.getDeepSpecs());

ipcMain.handle('system:premiumRecommendations', async () => {
  const specs = await hardware.getSpecs();
  return { specs, recommendations: hardware.recommendPerfModsPremium(specs) };
});

ipcMain.handle('system:recommendMemory', async () => {
  const specs = await hardware.getSpecs();
  return hardware.recommendMemoryGb(specs.memTotalGb);
});

// ---------------------------------------------------------------------------
// Instance backup / restore (Premium)
// ---------------------------------------------------------------------------
ipcMain.handle('instances:backup', async (_e, instanceId) => {
  const inst = instances.get(instanceId);
  if (!inst) throw new Error('Unknown instance');

  const res = await dialog.showSaveDialog(mainWindow, {
    title: `Back up "${inst.name}"`,
    defaultPath: `${inst.name.replace(/[^\w -]/g, '_')}-backup.zip`,
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };

  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addLocalFolder(instances.rootDir(instanceId));
  // The instance's version/loader live in the separate instances store, not
  // its own folder - embed them so a restore doesn't come back as "unknown".
  zip.addFile(
    '.nyx-instance.json',
    Buffer.from(JSON.stringify({ name: inst.name, mcVersion: inst.mcVersion, loader: inst.loader, loaderVersion: inst.loaderVersion }, null, 2))
  );
  zip.writeZip(res.filePath);
  return { canceled: false, path: res.filePath };
});

ipcMain.handle('instances:restore', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore instance from backup',
    properties: ['openFile'],
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };

  const AdmZip = require('adm-zip');
  const zip = new AdmZip(res.filePaths[0]);

  let meta = { name: null, mcVersion: 'unknown', loader: 'vanilla', loaderVersion: 'latest' };
  const metaEntry = zip.getEntry('.nyx-instance.json');
  if (metaEntry) {
    try {
      meta = { ...meta, ...JSON.parse(zip.readAsText(metaEntry)) };
    } catch {
      // Corrupt/foreign zip - fall back to the generic defaults above rather than failing the restore.
    }
  }
  const fallbackName = path.basename(res.filePaths[0]).replace(/-backup\.zip$/i, '').replace(/\.zip$/i, '') || 'Restored';

  const inst = instances.create({ name: meta.name || fallbackName, mcVersion: meta.mcVersion, loader: meta.loader, loaderVersion: meta.loaderVersion });
  const root = instances.rootDir(inst.id);
  zip.extractAllTo(root, true);
  fs.rmSync(path.join(root, '.nyx-instance.json'), { force: true }); // not a real Minecraft file - drop it from the live instance
  return { canceled: false, instance: instances.get(inst.id) };
});

ipcMain.handle('instances:sync', (_e, { sourceId, targetIds, mods, resourcePacks, options }) => {
  const sourceRoot = instances.rootDir(sourceId);
  const results = [];
  for (const targetId of targetIds || []) {
    if (targetId === sourceId) continue;
    try {
      const done = sync.syncInstance(sourceRoot, instances.rootDir(targetId), { mods, resourcePacks, options });
      results.push({ targetId, ok: true, done });
    } catch (err) {
      results.push({ targetId, ok: false, error: err.message });
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// Friends / multiplayer
// ---------------------------------------------------------------------------
// Everything here talks straight to a Minecraft server's own port (ping) or
// listens passively on the local network (LAN discovery) - no server of
// ours is involved anywhere. There's no way for any app to discover a
// friend's game across the internet without either them port-forwarding and
// sharing their address, or a third-party tunnelling tool (e.g. playit.gg) -
// that's a networking reality, not a limitation of this launcher.
ipcMain.handle('friends:list', () => friendsStore.get('list', []));

ipcMain.handle('friends:add', (_e, { name, host, port }) => {
  const list = friendsStore.get('list', []);
  const entry = { id: crypto.randomUUID(), name: name || host, host, port: Number(port) || 25565 };
  list.push(entry);
  friendsStore.set('list', list);
  return entry;
});

ipcMain.handle('friends:remove', (_e, id) => {
  friendsStore.set('list', friendsStore.get('list', []).filter((f) => f.id !== id));
  return true;
});

ipcMain.handle('friends:ping', (_e, { host, port }) => mcping.pingServer(host, port));

let stopLanScan = null;
ipcMain.handle('lan:start', () => {
  if (stopLanScan) return true; // already running
  stopLanScan = lan.startLanScan((games) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lan:found', games);
  });
  return true;
});
ipcMain.handle('lan:stop', () => {
  if (stopLanScan) {
    stopLanScan();
    stopLanScan = null;
  }
  return true;
});

// ---------------------------------------------------------------------------
// Modpacks
// ---------------------------------------------------------------------------
ipcMain.handle('modpacks:search', (_e, { query, mcVersion, offset }) => modrinth.searchModpacks(query, { mcVersion, offset }));

ipcMain.handle('modpacks:install', async (_e, { projectId, name }) => {
  const file = await modrinth.getBestModpackFile(projectId, {});
  if (!file) throw new Error('No .mrpack file available for this modpack.');

  const inst = instances.create({ name: name || 'Modpack', mcVersion: 'unknown', loader: 'vanilla', loaderVersion: 'latest' });
  const root = instances.rootDir(inst.id);

  try {
    const result = await modpacks.installMrpack(file.url, root, {
      onProgress: (done, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('modpacks:progress', { done, total });
      },
    });
    const updated = instances.update(inst.id, {
      name: name || result.name || inst.name,
      mcVersion: result.mcVersion || inst.mcVersion,
      loader: result.loader,
      loaderVersion: result.loaderVersion,
    });
    return { instance: updated, fileCount: result.fileCount };
  } catch (err) {
    // Don't leave a broken half-downloaded instance lying around.
    instances.remove(inst.id);
    throw err;
  }
});

function describeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.error) return String(err.error);
  if (err.message) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------
ipcMain.handle('launch:start', async (_e, instanceId, joinServer = null) => {
  const inst = instances.get(instanceId);
  if (!inst) throw new Error('Unknown instance');

  let account = getActiveAccount();
  if (!account) throw new Error('Sign in first (Accounts tab).');

  try {
    account = await launcher.refresh(account);
    upsertAccount(account);
  } catch {
    account = await launcher.signIn();
    upsertAccount(account);
    accountStore.set('activeUuid', account.uuid);
  }

  const settings = { ...DEFAULT_SETTINGS, ...settingsStore.read() };
  const root = instances.rootDir(instanceId);
  const emitter = launcher.launch(inst, root, account, settings, joinServer);
  instances.markPlayed(instanceId);

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  emitter.on('progress', (progress, size, element) => send('launch:progress', { progress, size, element }));
  emitter.on('check', (progress, size, element) => send('launch:check', { progress, size, element }));
  emitter.on('extract', (extract) => send('launch:extract', extract));
  emitter.on('estimated', (time) => send('launch:estimated', time));
  emitter.on('patch', (patch) => send('launch:patch', patch));
  emitter.on('data', (line) => send('launch:log', String(line)));
  emitter.on('close', (code) => send('launch:closed', code));
  // minecraft-java-core emits 'error' with all sorts of shapes (a plain
  // string, an Error, or an { error, errorType } object) depending on where
  // it came from, so normalize whatever we get into a readable string.
  emitter.on('error', (err) => send('launch:error', describeError(err)));

  if (settings.closeOnLaunch) {
    emitter.once('data', () => mainWindow?.hide());
    emitter.once('close', () => mainWindow?.show());
  }

  return true;
});
