'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('anvil', {
  app: {
    variant: invoke('app:variant'),
    openSkinEditor: invoke('app:openSkinEditor'),
  },
  updater: {
    check: invoke('updater:check'),
    install: invoke('updater:install'),
    currentVersion: invoke('updater:currentVersion'),
    onStatus: (cb) => ipcRenderer.on('updater:status', (_e, v) => cb(v)),
  },
  admin: {
    remoteAccounts: invoke('admin:remoteAccounts'),
    setRemotePremium: (uuid, value) => ipcRenderer.invoke('admin:setRemotePremium', { uuid, value }),
    setRemoteBan: (uuid, value) => ipcRenderer.invoke('admin:setRemoteBan', { uuid, value }),
  },
  versions: {
    vanilla: invoke('versions:vanilla'),
    latest: invoke('versions:latest'),
    fabricLoaders: invoke('versions:fabricLoaders'),
    quiltLoaders: invoke('versions:quiltLoaders'),
    forgeBuilds: invoke('versions:forgeBuilds'),
    forgePromoted: invoke('versions:forgePromoted'),
  },
  instances: {
    list: invoke('instances:list'),
    create: invoke('instances:create'),
    update: (id, patch) => ipcRenderer.invoke('instances:update', { id, patch }),
    remove: invoke('instances:remove'),
    backup: invoke('instances:backup'),
    restore: invoke('instances:restore'),
  },
  mods: {
    list: invoke('mods:list'),
    toggle: (instanceId, filename, enabled) => ipcRenderer.invoke('mods:toggle', { instanceId, filename, enabled }),
    remove: (instanceId, filename) => ipcRenderer.invoke('mods:remove', { instanceId, filename }),
    installLocalPath: (instanceId, filePath) => ipcRenderer.invoke('mods:installLocalPath', { instanceId, filePath }),
    installFromModrinth: (instanceId, projectId) => ipcRenderer.invoke('mods:installFromModrinth', { instanceId, projectId }),
    installFromCurseforge: (instanceId, modId) => ipcRenderer.invoke('mods:installFromCurseforge', { instanceId, modId }),
    openFolder: invoke('mods:openFolder'),
  },
  browse: {
    modrinthSearch: (query, opts) => ipcRenderer.invoke('browse:modrinthSearch', { query, ...opts }),
    modrinthProject: invoke('browse:modrinthProject'),
    curseforgeSearch: (query, opts) => ipcRenderer.invoke('browse:curseforgeSearch', { query, ...opts }),
  },
  auth: {
    current: invoke('auth:current'),
    list: invoke('auth:list'),
    signIn: invoke('auth:signIn'),
    switch: (uuid) => ipcRenderer.invoke('auth:switch', uuid),
    remove: (uuid) => ipcRenderer.invoke('auth:remove', uuid),
    faceIcon: (uuid) => ipcRenderer.invoke('auth:faceIcon', uuid),
    tagActive: (patch) => ipcRenderer.invoke('auth:tagActive', patch),
    syncPremium: invoke('auth:syncPremium'),
  },
  dev: {
    openDataFolder: invoke('dev:openDataFolder'),
    resetSettings: invoke('dev:resetSettings'),
    debugInfo: invoke('dev:debugInfo'),
    launchStats: invoke('dev:launchStats'),
    openLogsFolder: invoke('dev:openLogsFolder'),
    openInstanceFolder: invoke('dev:openInstanceFolder'),
    rawSettings: invoke('dev:rawSettings'),
    clearModManifest: invoke('dev:clearModManifest'),
  },
  system: {
    specs: invoke('system:specs'),
    perfRecommendations: invoke('system:perfRecommendations'),
    deepSpecs: invoke('system:deepSpecs'),
    premiumRecommendations: invoke('system:premiumRecommendations'),
    recommendMemory: invoke('system:recommendMemory'),
  },
  friends: {
    list: invoke('friends:list'),
    add: (name, host, port) => ipcRenderer.invoke('friends:add', { name, host, port }),
    remove: (id) => ipcRenderer.invoke('friends:remove', id),
    ping: (host, port) => ipcRenderer.invoke('friends:ping', { host, port }),
  },
  lan: {
    start: invoke('lan:start'),
    stop: invoke('lan:stop'),
    onFound: (cb) => ipcRenderer.on('lan:found', (_e, v) => cb(v)),
  },
  modpacks: {
    search: (query, opts) => ipcRenderer.invoke('modpacks:search', { query, ...opts }),
    install: (projectId, name) => ipcRenderer.invoke('modpacks:install', { projectId, name }),
    onProgress: (cb) => ipcRenderer.on('modpacks:progress', (_e, v) => cb(v)),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
    chooseJava: invoke('dialog:chooseJava'),
  },
  skins: {
    current: invoke('skins:current'),
    importFile: invoke('skins:importFile'),
    exportFile: (dataUrl, suggestedName) => ipcRenderer.invoke('skins:exportFile', { dataUrl, suggestedName }),
    upload: (dataUrl, variant) => ipcRenderer.invoke('skins:upload', { dataUrl, variant }),
  },
  shell: {
    openExternal: invoke('shell:openExternal'),
  },
  launch: {
    start: invoke('launch:start'),
    onProgress: (cb) => ipcRenderer.on('launch:progress', (_e, v) => cb(v)),
    onCheck: (cb) => ipcRenderer.on('launch:check', (_e, v) => cb(v)),
    onExtract: (cb) => ipcRenderer.on('launch:extract', (_e, v) => cb(v)),
    onEstimated: (cb) => ipcRenderer.on('launch:estimated', (_e, v) => cb(v)),
    onLog: (cb) => ipcRenderer.on('launch:log', (_e, v) => cb(v)),
    onClosed: (cb) => ipcRenderer.on('launch:closed', (_e, v) => cb(v)),
    onError: (cb) => ipcRenderer.on('launch:error', (_e, v) => cb(v)),
  },
  // Drag-and-drop support: File objects no longer carry a real filesystem
  // path for security reasons, so the path has to be resolved explicitly.
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
