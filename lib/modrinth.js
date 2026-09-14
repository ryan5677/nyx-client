'use strict';
/**
 * Thin wrapper around the public Modrinth API (https://docs.modrinth.com/).
 * No API key required - this is why Modrinth is the mod source that works
 * out of the box, unlike CurseForge (see curseforge.js).
 */

const BASE = 'https://api.modrinth.com/v2';
const USER_AGENT = 'nyx-client/0.3.0 (+https://github.com/, personal-use launcher)';

async function api(pathAndQuery) {
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Modrinth API ${pathAndQuery} -> HTTP ${res.status}`);
  return res.json();
}

/**
 * Search mods. `loader` is 'fabric' | 'forge' | 'quilt' | 'neoforge' | null (any).
 * `mcVersion` narrows to a specific game version, or leave null for all.
 */
async function search(query, { loader = null, mcVersion = null, offset = 0, limit = 20 } = {}) {
  const facets = [['project_type:mod']];
  if (loader) facets.push([`categories:${loader}`]);
  if (mcVersion) facets.push([`versions:${mcVersion}`]);

  const params = new URLSearchParams({
    query: query || '',
    limit: String(limit),
    offset: String(offset),
    facets: JSON.stringify(facets),
    index: query ? 'relevance' : 'downloads',
  });

  const data = await api(`/search?${params.toString()}`);
  return {
    hits: data.hits.map((hit) => ({
      id: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      author: hit.author,
      downloads: hit.downloads,
      iconUrl: hit.icon_url,
      categories: hit.categories,
      loaders: hit.display_categories,
      latestMcVersions: hit.versions?.slice(-4) || [],
      source: 'modrinth',
    })),
    totalHits: data.total_hits ?? data.hits.length,
  };
}

/** All published versions/files of a project, optionally filtered by loader + MC version. */
async function getProjectVersions(projectId, { loader = null, mcVersion = null } = {}) {
  const params = new URLSearchParams();
  if (loader) params.set('loaders', JSON.stringify([loader]));
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]));
  const query = params.toString();
  const data = await api(`/project/${projectId}/version${query ? `?${query}` : ''}`);
  return data.map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    datePublished: v.date_published,
    files: v.files.map((f) => ({
      url: f.url,
      filename: f.filename,
      primary: f.primary,
      size: f.size,
      sha1: f.hashes?.sha1,
    })),
    dependencies: (v.dependencies || []).map((d) => ({
      projectId: d.project_id,
      versionId: d.version_id,
      fileName: d.file_name,
      type: d.dependency_type, // 'required' | 'optional' | 'incompatible' | 'embedded'
    })),
  }));
}

/**
 * Convenience: given a project, pick the newest file compatible with a
 * loader + MC version, including its dependency list. Returns null if
 * nothing matches.
 */
async function getBestFile(projectId, { loader, mcVersion }) {
  const versions = await getProjectVersions(projectId, { loader, mcVersion });
  if (!versions.length) return null;
  const [best] = versions; // Modrinth returns newest-first
  const file = best.files.find((f) => f.primary) || best.files[0];
  return file ? { ...file, versionNumber: best.versionNumber, dependencies: best.dependencies } : null;
}

/**
 * Search modpacks (same API, different project_type facet + no loader
 * category filter - a modpack can bundle several loaders' worth of files).
 */
async function searchModpacks(query, { mcVersion = null, offset = 0, limit = 20 } = {}) {
  const facets = [['project_type:modpack']];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);

  const params = new URLSearchParams({
    query: query || '',
    limit: String(limit),
    offset: String(offset),
    facets: JSON.stringify(facets),
    index: query ? 'relevance' : 'downloads',
  });

  const data = await api(`/search?${params.toString()}`);
  return {
    hits: data.hits.map((hit) => ({
      id: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      author: hit.author,
      downloads: hit.downloads,
      iconUrl: hit.icon_url,
      categories: hit.categories,
      loaders: hit.display_categories,
      latestMcVersions: hit.versions?.slice(-4) || [],
      source: 'modrinth',
    })),
    totalHits: data.total_hits ?? data.hits.length,
  };
}

/** Newest .mrpack file for a modpack project, optionally narrowed to an MC version. */
async function getBestModpackFile(projectId, { mcVersion = null } = {}) {
  const versions = await getProjectVersions(projectId, { mcVersion });
  if (!versions.length) return null;
  const [best] = versions;
  const file = best.files.find((f) => f.filename.endsWith('.mrpack')) || best.files.find((f) => f.primary) || best.files[0];
  return file ? { ...file, versionNumber: best.versionNumber } : null;
}

async function getProject(projectId) {
  const p = await api(`/project/${projectId}`);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    body: p.body,
    iconUrl: p.icon_url,
    categories: p.categories,
    downloads: p.downloads,
    source: 'modrinth',
  };
}

module.exports = { search, getProjectVersions, getBestFile, getProject, searchModpacks, getBestModpackFile };
