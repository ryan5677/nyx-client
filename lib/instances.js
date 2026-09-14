'use strict';
/**
 * An "instance" is one entry in the left rail of the Play tab: a name, a
 * Minecraft version, a loader (vanilla/fabric/forge/quilt) + loader
 * version, and its own
 * mods/config/saves folder so instances never contaminate each other.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Store } = require('./store');

class Instances {
  /**
   * @param {string} userDataDir  Electron app.getPath('userData')
   */
  constructor(userDataDir) {
    this.gamesRoot = path.join(userDataDir, 'instances');
    this.store = new Store(userDataDir, 'instances', { list: [] });
  }

  all() {
    return this.store.get('list', []);
  }

  get(id) {
    return this.all().find((i) => i.id === id) || null;
  }

  rootDir(id) {
    return path.join(this.gamesRoot, id);
  }

  create({ name, mcVersion, loader = 'vanilla', loaderVersion = 'latest', icon = null }) {
    const instance = {
      id: crypto.randomUUID(),
      name: name || mcVersion,
      mcVersion,
      loader,       // 'vanilla' | 'fabric' | 'forge' | 'quilt'
      loaderVersion, // specific version string, or 'latest'
      icon,
      createdAt: Date.now(),
      lastPlayedAt: null,
      playCount: 0,
    };
    const list = this.all();
    list.push(instance);
    this.store.set('list', list);
    return instance;
  }

  update(id, patch) {
    const list = this.all();
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`No instance ${id}`);
    list[idx] = { ...list[idx], ...patch };
    this.store.set('list', list);
    return list[idx];
  }

  markPlayed(id) {
    const current = this.all().find((i) => i.id === id);
    return this.update(id, { lastPlayedAt: Date.now(), playCount: (current?.playCount || 0) + 1 });
  }

  remove(id) {
    const list = this.all().filter((i) => i.id !== id);
    this.store.set('list', list);
    try {
      fs.rmSync(this.rootDir(id), { recursive: true, force: true });
    } catch (err) {
      console.error(`Could not delete instance folder for ${id}:`, err);
    }
  }
}

module.exports = { Instances };
