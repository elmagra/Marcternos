const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const config = require('../config/config');

const CACHE_PATH = path.join(path.dirname(config.INSTANCE_REGISTRY_PATH), 'version-catalog-cache.json');
const TTL_MS = 6 * 60 * 60 * 1000;

async function readCache() {
  if (!await fs.pathExists(CACHE_PATH)) return null;
  return fs.readJson(CACHE_PATH).catch(() => null);
}

async function writeCache(data) {
  await fs.ensureDir(path.dirname(CACHE_PATH));
  await fs.writeJson(CACHE_PATH, data, { spaces: 2 });
}

function sortVersionsDesc(versions) {
  const uniq = [...new Set(versions.filter(Boolean))];
  return uniq.sort((a, b) => {
    const pa = a.split('.').map(n => parseInt(n, 10));
    const pb = b.split('.').map(n => parseInt(n, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const av = Number.isFinite(pa[i]) ? pa[i] : 0;
      const bv = Number.isFinite(pb[i]) ? pb[i] : 0;
      if (av !== bv) return bv - av;
    }
    return 0;
  });
}

async function fetchVanillaVersions() {
  const res = await axios.get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { timeout: 10000 });
  const versions = (res.data.versions || [])
    .filter(v => v.type === 'release')
    .map(v => v.id);
  return sortVersionsDesc(versions);
}

async function fetchPaperVersions() {
  const headers = { 'User-Agent': 'panel-minecraft/1.0 (admin@localhost)' };
  const res = await axios.get('https://fill.papermc.io/v3/projects/paper', { timeout: 12000, headers });
  const grouped = res.data.versions || {};
  const all = [];
  for (const key of Object.keys(grouped)) {
    if (Array.isArray(grouped[key])) all.push(...grouped[key]);
  }
  return sortVersionsDesc(all);
}

async function fetchFabricVersions() {
  const res = await axios.get('https://meta.fabricmc.net/v2/versions/game', { timeout: 10000 });
  const versions = (res.data || []).filter(v => v.stable).map(v => v.version);
  return sortVersionsDesc(versions);
}

async function fetchForgeVersions() {
  // Legacy endpoint often used by launchers
  const res = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { timeout: 10000 });
  const promos = (res.data && res.data.promos) ? res.data.promos : {};
  const versions = Object.keys(promos)
    .filter(k => k.endsWith('-recommended') || k.endsWith('-latest'))
    .map(k => k.replace(/-(recommended|latest)$/, ''));
  return sortVersionsDesc(versions);
}

async function fetchCatalogLive() {
  const [vanilla, paper, fabric, forge] = await Promise.allSettled([
    fetchVanillaVersions(),
    fetchPaperVersions(),
    fetchFabricVersions(),
    fetchForgeVersions()
  ]);

  const catalog = {
    Vanilla: vanilla.status === 'fulfilled' ? vanilla.value : [],
    Paper: paper.status === 'fulfilled' ? paper.value : [],
    Fabric: fabric.status === 'fulfilled' ? fabric.value : [],
    Forge: forge.status === 'fulfilled' ? forge.value : []
  };

  return catalog;
}

function fallbackCatalog() {
  return {
    Vanilla: ['1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.16.5', '1.12.2'],
    Paper: ['1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4'],
    Fabric: ['1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4'],
    Forge: ['1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2']
  };
}

async function getCatalog({ forceRefresh = false } = {}) {
  const cached = await readCache();
  const now = Date.now();

  if (!forceRefresh && cached && cached.updatedAt && (now - cached.updatedAt < TTL_MS)) {
    return cached.catalog;
  }

  try {
    const catalog = await fetchCatalogLive();
    const data = { updatedAt: now, catalog };
    await writeCache(data);
    return catalog;
  } catch (e) {
    if (cached && cached.catalog) return cached.catalog;
    const fb = fallbackCatalog();
    await writeCache({ updatedAt: now, catalog: fb, fallback: true });
    return fb;
  }
}

async function getSoftwareList() {
  const catalog = await getCatalog();
  return Object.keys(catalog);
}

async function getVersionsForSoftware(software) {
  const catalog = await getCatalog();
  const key = String(software || 'Vanilla');
  if (catalog[key]) return catalog[key];

  const lower = key.toLowerCase();
  const found = Object.keys(catalog).find(k => k.toLowerCase() === lower);
  return found ? catalog[found] : [];
}

module.exports = {
  getCatalog,
  getSoftwareList,
  getVersionsForSoftware
};
