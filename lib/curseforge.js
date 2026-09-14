'use strict';
/**
 * Thin wrapper around the CurseForge API.
 *
 * Unlike Modrinth, CurseForge locked their API behind a "Core API Key" in
 * 2022. Third-party apps (this launcher included) can't ship a working key -
 * you have to get your own for free at https://console.curseforge.com/,
 * then paste it into Settings -> CurseForge API Key. Until a key is set,
 * this module's calls will throw and the Browse Mods tab just shows the
 * Modrinth results.
 */

const BASE = 'https://api.curseforge.com/v1';
const MINECRAFT_GAME_ID = 432;
const MODS_CLASS_ID = 6;

// CurseForge's modLoaderType enum, per their published API schema.
const LOADER_TYPE = { any: 0, forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

function requireKey(apiKey) {
  if (!apiKey) throw new Error('No CurseForge API key set. Add one in Settings -> CurseForge API Key.');
}

async function api(apiKey, pathAndQuery) {
  requireKey(apiKey);
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('CurseForge rejected that API key. Double-check it in Settings -> CurseForge API Key.');
  }
  if (res.status === 404) {
    throw new Error('CurseForge could not find that mod.');
  }
  if (!res.ok) throw new Error(`CurseForge API ${pathAndQuery} -> HTTP ${res.status}`);
  return res.json();
}

/** Whether a mod's author allows third-party tools (like this one) to download it at all. */
async function getMod(apiKey, modId) {
  const data = await api(apiKey, `/mods/${modId}`);
  return { allowsThirdPartyDownload: data.data?.allowModDistribution !== false };
}

async function search(apiKey, query, { loader = null, mcVersion = null, index = 0, pageSize = 20 } = {}) {
  const params = new URLSearchParams({
    gameId: String(MINECRAFT_GAME_ID),
    classId: String(MODS_CLASS_ID),
    searchFilter: query || '',
    index: String(index),
    pageSize: String(pageSize),
    sortField: '2', // Popularity
    sortOrder: 'desc',
  });
  if (mcVersion) params.set('gameVersion', mcVersion);
  if (loader && LOADER_TYPE[loader] !== undefined) params.set('modLoaderType', String(LOADER_TYPE[loader]));

  const data = await api(apiKey, `/mods/search?${params.toString()}`);
  return {
    hits: data.data.map((mod) => ({
      id: mod.id,
      slug: mod.slug,
      title: mod.name,
      description: mod.summary,
      author: mod.authors?.[0]?.name,
      downloads: mod.downloadCount,
      iconUrl: mod.logo?.thumbnailUrl,
      categories: (mod.categories || []).map((c) => c.name),
      source: 'curseforge',
    })),
    totalHits: data.pagination?.totalCount ?? data.data.length,
  };
}

async function getModFiles(apiKey, modId, { mcVersion = null, loader = null } = {}) {
  const params = new URLSearchParams();
  if (mcVersion) params.set('gameVersion', mcVersion);
  if (loader && LOADER_TYPE[loader] !== undefined && loader !== 'vanilla') {
    params.set('modLoaderType', String(LOADER_TYPE[loader]));
  }
  const data = await api(apiKey, `/mods/${modId}/files${params.toString() ? `?${params}` : ''}`);
  return data.data.map((f) => ({
    id: f.id,
    filename: f.fileName,
    displayName: f.displayName,
    gameVersions: f.gameVersions,
    downloadUrl: f.downloadUrl,
    fileLength: f.fileLength,
    // relationType 3 = "Required Dependency" in CurseForge's (undocumented) enum.
    dependencies: (f.dependencies || []).map((d) => ({ modId: d.modId, relationType: d.relationType })),
  }));
}

/**
 * Newest file compatible with a MC version + loader. Filtering happens
 * server-side via CurseForge's own modLoaderType/gameVersion query params,
 * not a client-side guess - so if nothing comes back, that's a real "no
 * compatible file" rather than a mismatched file slipping through.
 */
async function getBestFile(apiKey, modId, { mcVersion, loader } = {}) {
  const files = await getModFiles(apiKey, modId, { mcVersion, loader });
  return files[0] || null;
}

module.exports = { search, getModFiles, getBestFile, getMod };
