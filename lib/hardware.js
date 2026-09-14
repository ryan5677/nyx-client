'use strict';
/**
 * Detects the machine's hardware and recommends performance mods.
 *
 * Detection uses `systeminformation` (pure JS, no native build step - safe
 * to ship via electron-builder on every platform). Detection is read-only
 * and best-effort: any field that can't be read comes back null/0 rather
 * than throwing, since a slow or unusual system shouldn't block startup.
 */

const si = require('systeminformation');

async function getSpecs() {
  const [cpu, mem, graphics, osInfo] = await Promise.all([
    si.cpu().catch(() => null),
    si.mem().catch(() => null),
    si.graphics().catch(() => null),
    si.osInfo().catch(() => null),
  ]);

  return {
    cpu: cpu ? { manufacturer: cpu.manufacturer, brand: cpu.brand, cores: cpu.cores, physicalCores: cpu.physicalCores, speedGhz: cpu.speed } : null,
    memTotalGb: mem ? Math.round(mem.total / 1024 / 1024 / 1024) : null,
    gpus: (graphics?.controllers || []).map((g) => ({
      vendor: g.vendor,
      model: g.model,
      vramGb: g.vram ? Math.round(g.vram / 1024) : null,
    })),
    os: osInfo ? { platform: osInfo.distro || osInfo.platform, arch: osInfo.arch } : null,
  };
}

/**
 * Curated, real, actively-maintained Fabric performance mods (all on
 * Modrinth). Not an exhaustive catalog - just well-established ones, so
 * they're safe to recommend. Most have no gameplay changes; Distant Horizons
 * changes what far terrain looks like (lower detail) in exchange for seeing
 * much further, which is why it's only suggested rather than auto-installed.
 */
const CATALOG = [
  { slug: 'sodium', title: 'Sodium', blurb: 'Rewrites the renderer for a major FPS boost - the single highest-impact mod here.', tier: 'always' },
  { slug: 'lithium', title: 'Lithium', blurb: 'General-purpose game logic optimizations (pathfinding, block ticking, etc.) with no gameplay changes.', tier: 'always' },
  { slug: 'starlight', title: 'Starlight', blurb: 'Rewrites the lighting engine - faster chunk loading and fewer lighting-related freezes.', tier: 'always' },
  { slug: 'krypton', title: 'Krypton', blurb: "Optimizes Minecraft's networking stack - helps most when playing on servers.", tier: 'always' },
  { slug: 'entityculling', title: 'EntityCulling', blurb: 'Skips rendering entities and block entities hidden behind walls.', tier: 'always' },
  { slug: 'immediatelyfast', title: 'ImmediatelyFast', blurb: 'Speeds up the immediate-mode rendering used by the UI and held/dropped items.', tier: 'always' },
  { slug: 'ferrite-core', title: 'FerriteCore', blurb: 'Cuts memory usage significantly - especially worth it on lower-RAM machines.', tier: 'lowRam' },
  { slug: 'modernfix', title: 'ModernFix', blurb: 'A bundle of startup-time and memory-usage fixes.', tier: 'lowRam' },
  { slug: 'nvidium', title: 'Nvidium', blurb: 'A Sodium add-on that uses mesh shaders for a large extra FPS boost - NVIDIA GPUs only.', tier: 'nvidia' },
  { slug: 'distanthorizons', title: 'Distant Horizons', blurb: "Renders far-away terrain at a lower detail level, so you can see much further without vanilla's full performance cost.", tier: 'highRam' },
];

/**
 * Given detected specs, return recommendations grouped by *why* they're
 * suggested - "for everyone", "because you're low on RAM", "because you
 * have an NVIDIA GPU", etc - rather than one flat list, and only the groups
 * that actually apply to this machine. Fabric/Quilt only (none of these
 * mods exist for Forge).
 */
function recommendPerfMods(specs) {
  const ramGb = specs?.memTotalGb || 16;
  const lowRam = ramGb > 0 && ramGb <= 8;
  const highRam = ramGb >= 16;
  const isNvidia = (specs?.gpus || []).some(
    (g) => /nvidia/i.test(g.vendor || '') || /nvidia|geforce|rtx|gtx/i.test(g.model || '')
  );

  const byTier = (tier) => CATALOG.filter((m) => m.tier === tier).map(({ slug, title, blurb }) => ({ slug, title, blurb }));

  const groups = [{ reason: 'Recommended for everyone', mods: byTier('always') }];
  if (lowRam) groups.push({ reason: `Because you have ${ramGb}GB of RAM`, mods: byTier('lowRam') });
  if (isNvidia) groups.push({ reason: 'Because you have an NVIDIA GPU', mods: byTier('nvidia') });
  if (highRam) groups.push({ reason: `You have ${ramGb}GB of RAM to spare`, mods: byTier('highRam') });

  return groups.filter((g) => g.mods.length);
}

/**
 * A more detailed hardware readout - disk layout, individual memory stick
 * info, and CPU cache sizes. Split from getSpecs() since it's slower to
 * collect and only needed by the Premium tab's deep dive, not every load of
 * the regular Performance tab.
 */
async function getDeepSpecs() {
  const [disks, memLayout, cpuCache] = await Promise.all([
    si.diskLayout().catch(() => []),
    si.memLayout().catch(() => []),
    si.cpuCache().catch(() => null),
  ]);

  return {
    disks: (disks || []).map((d) => ({ name: d.name, type: d.type, sizeGb: d.size ? Math.round(d.size / 1e9) : null })),
    memSlots: (memLayout || []).map((m) => ({
      sizeGb: m.size ? Math.round(m.size / 1024 / 1024 / 1024) : null,
      type: m.type,
      clockMhz: m.clockSpeed || null,
    })),
    cpuCache: cpuCache
      ? { l1d: cpuCache.l1d, l1i: cpuCache.l1i, l2: cpuCache.l2, l3: cpuCache.l3 }
      : null,
  };
}

/**
 * Same idea as recommendPerfMods, but for Premium: RAM-tier picks
 * (FerriteCore/ModernFix/Distant Horizons) are shown to everyone rather than
 * only when they'd make the biggest difference, since they're still real
 * optional upgrades either way. GPU-specific picks stay gated - Nvidium
 * genuinely doesn't run without an NVIDIA GPU, so showing it to everyone
 * would just be misleading.
 */
function recommendPerfModsPremium(specs) {
  const isNvidia = (specs?.gpus || []).some(
    (g) => /nvidia/i.test(g.vendor || '') || /nvidia|geforce|rtx|gtx/i.test(g.model || '')
  );
  const byTier = (tier) => CATALOG.filter((m) => m.tier === tier).map(({ slug, title, blurb }) => ({ slug, title, blurb }));

  const groups = [
    { reason: 'Recommended for everyone', mods: byTier('always') },
    { reason: "Extra picks - not essential for your specs, but still worth trying", mods: [...byTier('lowRam'), ...byTier('highRam')] },
  ];
  if (isNvidia) groups.push({ reason: 'Because you have an NVIDIA GPU', mods: byTier('nvidia') });

  return groups.filter((g) => g.mods.length);
}

/**
 * A sane min/max memory allocation given total system RAM - leaves enough
 * headroom for the OS and other apps rather than letting Minecraft claim
 * everything. Purely a suggestion; the user can always override it manually.
 */
function recommendMemoryGb(totalRamGb) {
  if (!totalRamGb || totalRamGb <= 0) return { minGb: 2, maxGb: 4 };
  const maxGb = Math.max(2, Math.min(Math.floor(totalRamGb * 0.5), totalRamGb - 4, 16));
  const minGb = Math.min(2, maxGb);
  return { minGb, maxGb };
}

module.exports = { getSpecs, recommendPerfMods, getDeepSpecs, recommendPerfModsPremium, recommendMemoryGb };
