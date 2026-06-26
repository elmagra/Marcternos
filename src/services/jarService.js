const axios = require('axios');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MANIFEST_TTL_MS = 60 * 60 * 1000;

let manifestCache = { data: null, fetchedAt: 0 };

async function getVersionManifest() {
    const now = Date.now();
    if (manifestCache.data && now - manifestCache.fetchedAt < MANIFEST_TTL_MS) {
        return manifestCache.data;
    }
    const res = await axios.get(MANIFEST_URL, { timeout: 15000 });
    manifestCache = { data: res.data, fetchedAt: now };
    return res.data;
}

async function getVanillaJarUrl(ver) {
    const manifest = await getVersionManifest();
    const entry = (manifest.versions || []).find(v => v.id === ver);
    if (!entry) return null;

    const versionRes = await axios.get(entry.url, { timeout: 15000 });
    return versionRes.data?.downloads?.server?.url || null;
}

async function getPaperJarUrl(ver) {
    const headers = { 'User-Agent': 'panel-minecraft/1.0 (admin@localhost)' };
    const buildData = await axios.get(
        `https://api.papermc.io/v2/projects/paper/versions/${ver}/builds`,
        { timeout: 15000, headers }
    );
    const builds = buildData.data.builds || [];
    if (builds.length === 0) return null;

    const latestBuild = builds[builds.length - 1];
    const filename = latestBuild.downloads.application.name;
    return `https://api.papermc.io/v2/projects/paper/versions/${ver}/builds/${latestBuild.build}/downloads/${filename}`;
}

async function getFabricJarUrl(ver) {
    const [loadersRes, installersRes] = await Promise.all([
        axios.get('https://meta.fabricmc.net/v2/versions/loader', { timeout: 15000 }),
        axios.get('https://meta.fabricmc.net/v2/versions/installer', { timeout: 15000 })
    ]);

    const loader = (loadersRes.data || []).find(v => v.stable)?.version;
    const installer = (installersRes.data || []).find(v => v.stable)?.version;
    if (!loader || !installer) return null;

    return `https://meta.fabricmc.net/v2/versions/loader/${ver}/${loader}/${installer}/server/jar`;
}

async function getForgeJarUrl(ver) {
    const promosRes = await axios.get(
        'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
        { timeout: 15000 }
    );
    const promos = promosRes.data?.promos || {};
    const forgeVer = promos[`${ver}-recommended`] || promos[`${ver}-latest`];
    if (!forgeVer) return null;

    return `https://maven.minecraftforge.net/net/minecraftforge/forge/${ver}-${forgeVer}/forge-${ver}-${forgeVer}-installer.jar`;
}

async function getJarUrl(type, ver) {
    const software = String(type || 'Vanilla').toLowerCase();

    try {
        if (software.includes('paper')) {
            return await getPaperJarUrl(ver);
        }
        if (software.includes('fabric')) {
            return await getFabricJarUrl(ver);
        }
        if (software.includes('forge')) {
            return await getForgeJarUrl(ver);
        }
        return await getVanillaJarUrl(ver);
    } catch (e) {
        console.error(`[JAR] Error resolving URL for ${type} ${ver}:`, e.message);
        return null;
    }
}

module.exports = {
    getJarUrl
};
