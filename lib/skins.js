'use strict';
/**
 * Renders the signed-in player's face (base layer + hat/overlay layer) as a
 * small PNG data URL, for the sidebar/account avatar.
 *
 * We fetch the skin texture straight from Mojang (session server -> texture
 * CDN) and crop it ourselves rather than depending on a third-party avatar
 * proxy like Crafatar, which has had long, unresolved outages.
 */

const { PNG } = require('pngjs');

const cache = new Map(); // uuid -> { dataUrl, expiresAt }
const TTL_MS = 10 * 60 * 1000;
const USER_AGENT = 'nyx-client/0.3.0';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function decodePng(buffer) {
  return new Promise((resolve, reject) => {
    new PNG().parse(buffer, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/**
 * Crop the 8x8 face at (8,8) plus the 8x8 hat overlay at (40,8), composite
 * the overlay over the base wherever it's opaque, and scale up (nearest
 * neighbour, so the pixel art stays crisp) to `size`x`size`.
 */
function composeFace(src, size) {
  const out = new PNG({ width: size, height: size });
  const scale = size / 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = 8 + Math.floor(x / scale);
      const sy = 8 + Math.floor(y / scale);
      const baseIdx = (src.width * sy + sx) << 2;
      let r = src.data[baseIdx];
      let g = src.data[baseIdx + 1];
      let b = src.data[baseIdx + 2];
      let a = src.data[baseIdx + 3];

      const ox = 40 + Math.floor(x / scale);
      const oy = 8 + Math.floor(y / scale);
      const overlayIdx = (src.width * oy + ox) << 2;
      const oa = src.data[overlayIdx + 3];
      if (oa > 10) {
        r = src.data[overlayIdx];
        g = src.data[overlayIdx + 1];
        b = src.data[overlayIdx + 2];
        a = oa;
      }

      const outIdx = (size * y + x) << 2;
      out.data[outIdx] = r;
      out.data[outIdx + 1] = g;
      out.data[outIdx + 2] = b;
      out.data[outIdx + 3] = a;
    }
  }
  return out;
}

function encodeDataUrl(png) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    png
      .pack()
      .on('data', (c) => chunks.push(c))
      .on('end', () => resolve(`data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`))
      .on('error', reject);
  });
}

/**
 * Given a Mojang profile uuid, return a data: URL of the player's face
 * (64x64), or null if it can't be resolved (offline, no skin, etc.).
 */
async function getFaceDataUrl(uuid) {
  if (!uuid) return null;
  const cached = cache.get(uuid);
  if (cached && cached.expiresAt > Date.now()) return cached.dataUrl;

  const skinUrl = await resolveSkinUrl(uuid);
  if (!skinUrl) return null;

  const skinBuf = await fetchBuffer(skinUrl);
  const png = await decodePng(skinBuf);
  const face = composeFace(png, 64);
  const dataUrl = await encodeDataUrl(face);
  cache.set(uuid, { dataUrl, expiresAt: Date.now() + TTL_MS });
  return dataUrl;
}

/** Looks up a Mojang profile's current skin URL (and model variant), or null if it can't be resolved. */
async function resolveSkinTexture(uuid) {
  const clean = uuid.replace(/-/g, '');
  const profile = await fetchJson(`https://sessionserver.mojang.com/session/minecraft/profile/${clean}`);
  const textureProp = profile.properties?.find((p) => p.name === 'textures');
  if (!textureProp) return null;
  const decoded = JSON.parse(Buffer.from(textureProp.value, 'base64').toString('utf-8'));
  const skin = decoded.textures?.SKIN;
  if (!skin?.url) return null;
  return { url: skin.url, variant: skin.metadata?.model === 'slim' ? 'slim' : 'classic' };
}

async function resolveSkinUrl(uuid) {
  const t = await resolveSkinTexture(uuid);
  return t?.url || null;
}

/**
 * Fetches the signed-in player's full, uncropped skin texture (the raw
 * 64x64 - or legacy 64x32 - PNG) for loading into the skin editor, along
 * with which arm model (classic/slim) Mojang has it tagged as.
 * Returns null if the account has no custom skin set (default Steve/Alex).
 */
async function getCurrentSkin(uuid) {
  if (!uuid) return null;
  const texture = await resolveSkinTexture(uuid);
  if (!texture) return null;
  const buf = await fetchBuffer(texture.url);
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, variant: texture.variant };
}

/**
 * Uploads a new skin to the signed-in account via Mojang's official skin
 * API. `pngBuffer` must be a 64x64 PNG. `variant` is 'classic' (4px wide
 * arms) or 'slim' (3px, the "Alex" model). Throws with a readable message
 * on rejection (e.g. an offline/non-owning account, or a malformed PNG).
 */
async function uploadSkin(accessToken, pngBuffer, variant = 'classic') {
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'skin.png');

  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': USER_AGENT },
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).errorMessage || ''; } catch { /* ignore */ }
    throw new Error(detail || `Mojang rejected the skin upload (HTTP ${res.status}).`);
  }
  return res.json();
}

module.exports = { getFaceDataUrl, getCurrentSkin, uploadSkin };
