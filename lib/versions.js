'use strict';
/**
 * Fetches the lists that populate the version + loader dropdowns.
 * Nothing here is cached to disk on purpose - it's cheap, and it means
 * the dropdowns are always current the moment you open the app.
 */

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_GAME_VERSIONS = 'https://meta.fabricmc.net/v2/versions/game';
const FABRIC_LOADER_VERSIONS = (mcVersion) => `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`;
const QUILT_GAME_VERSIONS = 'https://meta.quiltmc.org/v3/versions/game';
const QUILT_LOADER_VERSIONS = (mcVersion) => `https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`;
const FORGE_PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

/** All vanilla versions Mojang publishes, newest first. */
async function listVanillaVersions({ includeSnapshots = false } = {}) {
  const manifest = await getJson(MOJANG_MANIFEST);
  return manifest.versions
    .filter((v) => includeSnapshots || v.type === 'release')
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}

/** Latest release + latest snapshot ids, for quick-pick defaults. */
async function getLatest() {
  const manifest = await getJson(MOJANG_MANIFEST);
  return manifest.latest; // { release, snapshot }
}

/** Fabric loader versions compatible with a given MC version, newest first. */
async function listFabricLoaderVersions(mcVersion) {
  const rows = await getJson(FABRIC_LOADER_VERSIONS(mcVersion));
  return rows.map((r) => ({
    loaderVersion: r.loader.version,
    stable: !!r.loader.stable,
  }));
}

/** MC versions Fabric supports at all - used to grey out the loader tab otherwise. */
async function listFabricSupportedGameVersions() {
  const rows = await getJson(FABRIC_GAME_VERSIONS);
  return rows.filter((r) => r.stable).map((r) => r.version);
}

/** Quilt loader versions compatible with a given MC version, newest first. */
async function listQuiltLoaderVersions(mcVersion) {
  const rows = await getJson(QUILT_LOADER_VERSIONS(mcVersion));
  return rows.map((r) => ({
    loaderVersion: r.loader.version,
    stable: !!r.loader.stable,
  }));
}

async function listQuiltSupportedGameVersions() {
  const rows = await getJson(QUILT_GAME_VERSIONS);
  return rows.filter((r) => r.stable).map((r) => r.version);
}

/**
 * Forge build numbers available for a given MC version, newest first.
 * Parsed out of Forge's maven-metadata.xml since there's no clean JSON list.
 */
async function listForgeVersions(mcVersion) {
  const xml = await getText(FORGE_MAVEN_METADATA);
  const versionTags = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  const matches = versionTags.filter((v) => v.startsWith(`${mcVersion}-`));
  // maven-metadata.xml lists oldest -> newest
  return matches.reverse();
}

/** Recommended + latest Forge build for a MC version, when Forge publishes one. */
async function getForgePromoted(mcVersion) {
  const data = await getJson(FORGE_PROMOTIONS);
  const promos = data.promos || {};
  return {
    recommended: promos[`${mcVersion}-recommended`] || null,
    latest: promos[`${mcVersion}-latest`] || null,
  };
}

module.exports = {
  listVanillaVersions,
  getLatest,
  listFabricLoaderVersions,
  listFabricSupportedGameVersions,
  listQuiltLoaderVersions,
  listQuiltSupportedGameVersions,
  listForgeVersions,
  getForgePromoted,
};
