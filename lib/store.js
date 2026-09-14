'use strict';
/**
 * Tiny JSON-file-backed store. Deliberately dependency-free (no electron-store)
 * so the app has one less native/ESM dependency to break across Electron versions.
 *
 * Each Store instance owns one JSON file under the app's userData directory,
 * e.g. instances.json, settings.json, account.json.
 */
const fs = require('fs');
const path = require('path');

class Store {
  /**
   * @param {string} dir   Directory the file lives in (usually app.getPath('userData'))
   * @param {string} name  File name without extension, e.g. "settings"
   * @param {object} defaults  Default contents if the file doesn't exist yet
   */
  constructor(dir, name, defaults = {}) {
    this.file = path.join(dir, `${name}.json`);
    this.defaults = defaults;
    this._ensure();
  }

  _ensure() {
    if (!fs.existsSync(path.dirname(this.file))) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
    }
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify(this.defaults, null, 2));
    }
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch {
      return structuredClone(this.defaults);
    }
  }

  write(data) {
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
    return data;
  }

  get(key, fallback) {
    const data = this.read();
    return key in data ? data[key] : fallback;
  }

  set(key, value) {
    const data = this.read();
    data[key] = value;
    this.write(data);
    return value;
  }

  patch(partial) {
    const data = { ...this.read(), ...partial };
    this.write(data);
    return data;
  }
}

module.exports = { Store };
