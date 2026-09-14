'use strict';
/**
 * If you deploy backend/server.js somewhere, put its URL here before
 * building - every copy of the app (dev and public) will then check in
 * automatically with zero setup needed from the person running it. Leave
 * this blank and the app never makes a single request to anything but
 * Microsoft/Mojang/Modrinth/CurseForge, exactly as before - cross-device
 * Premium just falls back to local-only granting.
 */
module.exports = {
  DEFAULT_BACKEND_URL: '',
};
