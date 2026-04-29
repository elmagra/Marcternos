const express = require('express');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const os = require('os');
const osUtils = require('os-utils');
const { spawn, exec } = require('child_process');

const config = require('./config/config');
const { downloadFile } = require('./utils/utils');
const { getJarUrl } = require('./services/jarService');
const {
    listInstances,
    registerInstance,
    updateInstance,
    getInstanceById,
    getActiveInstance,
    setActiveInstance,
    ensureRegistryMigrated,
    removeInstance
} = require('./services/instanceRegistryService');
const {
    getCatalog,
    getSoftwareList,
    getVersionsForSoftware
} = require('./services/versionCatalogService');
const {
    createBackup,
    listBackups,
    getBackup,
    deleteBackup: deleteBackupService,
    updateBackup,
    restoreBackup: restoreBackupService,
    zipFolder,
    extractZip,
    validateWorldZip,
    assertSafePath,
    BACKUPS_ROOT
} = require('./services/backupService');
const archiver = require('archiver');
const nbt = require('prismarine-nbt');

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL-REJECTION] No se pudo procesar la promesa:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[FATAL-EXCEPTION] Error no capturado:', err.message);
    if (err.message.includes('EADDRINUSE')) {
        console.error('El puerto 3000 ya está en uso. Por favor, cierra terminales antiguas.');
    }
});


const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(config.PANEL_ROOT));
// Nota: no persistimos activeInstanceId en cada request con instanceId.
// Hacerlo aquí provoca escrituras concurrentes del registry (incluyendo /api/server/icon)
// y puede generar estados transitorios/duplicados en UI.
app.use((req, res, next) => next());

// --- REAL STATE ---
let creationStatus = { steps: [], progress: 0, status: 'idle', name: 'world' };
let mcProcess = null;
let serverState = {
    status: 'offline',
    logs: [],
    ram: 0,
    cpu: 0,
    startTime: null,
    players: [],
    version: '...',
    software: 'Detectando...',
    worldSize: '0 MB',
    ramUsedGB: 0,
    ramTotalGB: 0
};

const propMapping = { 'whitelist': 'white-list' };

// Mapa nombre -> IP para saber quién está baneado por IP (Minecraft no guarda nombre en banned-ips.json)
let banIpByName = {};
let gameruleCache = {}; // Cache para gamerules sent via command but maybe not yet in level.dat

const BAN_IP_CACHE_FILENAME = 'ban-ip-cache.json';
const PLAYER_LAST_IP_FILENAME = 'player-last-ip.json';

async function getFirstServerPath() {
    try {
        const active = await getActiveInstance();
        if (active && await fs.pathExists(active.path)) return active.path;

        if (!await fs.pathExists(config.SERVERS_ROOT)) return null;
        const folders = await fs.readdir(config.SERVERS_ROOT);
        for (const f of folders) {
            const full = path.join(config.SERVERS_ROOT, f);
            if ((await fs.stat(full)).isDirectory()) return full;
        }
        return null;
    } catch (e) {
        console.error('Error getFirstServerPath:', e);
        return null;
    }
}

function getRequestedInstanceId(req) {
    const queryId = req.query && req.query.instanceId ? String(req.query.instanceId) : '';
    const bodyId = req.body && req.body.instanceId ? String(req.body.instanceId) : '';
    const headerId = req.headers && req.headers['x-instance-id'] ? String(req.headers['x-instance-id']) : '';
    return queryId || bodyId || headerId || null;
}

async function getServerPathFromRequest(req) {
    const requestedId = getRequestedInstanceId(req);
    if (requestedId) {
        const selected = await getInstanceById(requestedId);
        if (selected && selected.path && await fs.pathExists(selected.path)) {
            return selected.path;
        }
    }
    return getFirstServerPath();
}

async function loadBanIpCache() {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;
        const cachePath = path.join(serverPath, BAN_IP_CACHE_FILENAME);
        if (await fs.pathExists(cachePath)) {
            const data = await fs.readJson(cachePath).catch(() => ({}));
            if (data && typeof data === 'object') Object.assign(banIpByName, data);
        }
    } catch (e) {}
}

async function saveBanIpCache() {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;
        await fs.writeJson(path.join(serverPath, BAN_IP_CACHE_FILENAME), banIpByName, { spaces: 2 });
    } catch (e) {}
}

let playerLastIp = {};

async function loadPlayerLastIp() {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;
        const f = path.join(serverPath, PLAYER_LAST_IP_FILENAME);
        if (await fs.pathExists(f)) {
            const data = await fs.readJson(f).catch(() => ({}));
            if (data && typeof data === 'object') playerLastIp = data;
        }
    } catch (e) {}
}

async function savePlayerLastIp() {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;
        await fs.writeJson(path.join(serverPath, PLAYER_LAST_IP_FILENAME), playerLastIp, { spaces: 2 });
    } catch (e) {}
}

function addCreationStep(msg) {
    const time = new Date().toLocaleTimeString();
    creationStatus.steps.push({ time, msg });
    if (creationStatus.steps.length > 200) creationStatus.steps.shift();
}

async function createWorldFromRequest(payload) {
    gameruleCache = {}; // Reset cache for new world
    try {
        const type = (payload.type || 'Vanilla').toString();
        const version = (payload.version || '1.20.1').toString();
        const levelName = (payload.levelName || 'world').toString().trim().replace(/[^a-zA-Z0-9_\- ]/g, '') || 'world';
        // Si el usuario no pone semilla, se deja vacía â†’ Minecraft la genera aleatoriamente
        const levelSeed = (payload.levelSeed || '').toString().trim();
        const levelType = (payload.levelType || 'default').toString();
        // Semilla: si está vacía, NO ponemos nada â†’ Minecraft genera una aleatoria por sí solo
        const maxWorldSize = payload.maxWorldSize && !isNaN(Number(payload.maxWorldSize))
            ? Number(payload.maxWorldSize)
            : 29999984;

        creationStatus = { steps: [], progress: 0, status: 'running', name: levelName };
        addCreationStep(`ðŸš€ Preparando mundo "${levelName}" Â· ${type} ${version}`);
        addCreationStep(`ðŸŒ± Semilla: ${levelSeed !== '' ? levelSeed : 'aleatoria (generada por Minecraft)'}  |  Tipo: ${levelType}`);

        // 1) Apagar servidor si está encendido
        if (mcProcess) {
            addCreationStep('â›” Deteniendo servidor actual...');
            await stopProcessSync();
            addCreationStep('âœ… Servidor detenido.');
        }
        creationStatus.progress = 5;

        // 2) Asegurar que el directorio raíz existe
        const root = config.SERVERS_ROOT;
        await fs.ensureDir(root);

        // 3) Crear carpeta para una nueva instancia (sin borrar otras)
        const slug = levelName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'world';
        const instanceId = `${slug}-${Date.now().toString(36).slice(-6)}`;
        creationStatus.instanceId = instanceId;
        const serverPath = path.join(root, instanceId);
        await fs.ensureDir(serverPath);
        await fs.writeFile(path.join(serverPath, '.creating'), String(Date.now()));
        addCreationStep(`ðŸ“ Carpeta de instancia creada: .../${instanceId}`);
        
        // --- NUEVO: Crear carpetas para mods/plugins antes de la generación ---
        await fs.ensureDir(path.join(serverPath, 'mods'));
        await fs.ensureDir(path.join(serverPath, 'plugins'));
        addCreationStep(`ðŸ“‚ Carpetas /mods y /plugins creadas (puedes subir mods antes de iniciar).`);
        
        creationStatus.progress = 20;

        // 5) Resolver URL del JAR
        addCreationStep(`ðŸ” Buscando JAR de ${type} ${version}...`);
        const jarUrl = await getJarUrl(type, version);
        if (!jarUrl) throw new Error(`No se pudo obtener la URL del JAR para ${type} ${version}.`);
        addCreationStep(`ðŸ”— URL resuelta. Iniciando descarga...`);
        creationStatus.progress = 25;

        // 6) Descargar JAR
        const jarDest = path.join(serverPath, 'server.jar');
        await downloadFile(jarUrl, jarDest, (p) => {
            creationStatus.progress = 25 + Math.round((p / 100) * 45);
            // Log cada 25%
            const pct = Math.round(p);
            if (pct === 25 || pct === 50 || pct === 75 || pct === 100) {
                addCreationStep(`ðŸ“¥ Descargando server.jar... ${pct}%`);
            }
        });
        addCreationStep('âœ… server.jar descargado correctamente.');
        creationStatus.progress = 72;

        // 7) Escribir eula.txt
        await fs.writeFile(path.join(serverPath, 'eula.txt'), 'eula=true\n');
        addCreationStep('ðŸ“„ EULA aceptada automáticamente.');
        creationStatus.progress = 78;

        // 8) Escribir server.properties
        const generateStructures = payload.generateStructures !== false;
        const bonusChest = payload.bonusChest === true;
        const props = [
            `# Generado por Marcternos Panel el ${new Date().toISOString()}`,
            `level-name=${levelName}`,
            // Solo escribir level-seed si el usuario proporcionó una; si no, Minecraft genera la suya
            ...(levelSeed !== '' ? [`level-seed=${levelSeed}`] : []),
            `level-type=${levelType}`,
            `max-world-size=${maxWorldSize}`,
            `generate-structures=${generateStructures}`,
            `bonus-chest=${bonusChest}`,
            'motd=\u00a76\u00a7lMarcternos \u00a7r\u00a77- Servidor Minecraft',
            'online-mode=true',
            'enforce-secure-profile=false',
            'enable-command-block=false',
            'pvp=true',
            'difficulty=normal',
            'gamemode=survival',
            'spawn-protection=16',
            'max-players=20',
            'view-distance=10',
            'simulation-distance=10'
        ];
        const propPath = path.join(serverPath, 'server.properties');
        await fs.writeFile(propPath, props.join('\n') + '\n', 'utf-8');
        addCreationStep('âš™ï¸ server.properties configurado.');
        creationStatus.progress = 88;

        // 9) Inicializar archivos JSON necesarios
        const emptyJson = JSON.stringify([], null, 2);
        await fs.writeFile(path.join(serverPath, 'ops.json'), emptyJson);
        await fs.writeFile(path.join(serverPath, 'whitelist.json'), emptyJson);
        await fs.writeFile(path.join(serverPath, 'banned-players.json'), emptyJson);
        await fs.writeFile(path.join(serverPath, 'banned-ips.json'), emptyJson);
        addCreationStep('ðŸ“‹ Archivos de configuración inicializados.');

        // 10b) Copiar server-icon.png desde resources si existe
        try {
            const iconDest = path.join(serverPath, 'server-icon.png');
            const iconCandidates = [
                path.join(config.PANEL_ROOT, 'resources', 'icono.png'),
                path.join(config.PANEL_ROOT, 'resources', 'server-icon-default.png'),
                path.join(config.PANEL_ROOT, 'resources', 'logo.png'),
                path.join(config.PANEL_ROOT, 'resources', 'marcternos_logo.png')
            ];
            let copied = false;
            for (const iconSrc of iconCandidates) {
                if (await fs.pathExists(iconSrc)) {
                    await fs.copy(iconSrc, iconDest);
                    copied = true;
                    break;
                }
            }
            if (copied) addCreationStep('ðŸ–¼ï¸ Icono del servidor configurado (server-icon.png).');
        } catch (e) {
            console.warn('[CREATE-WORLD] No se pudo copiar el icono:', e.message);
        }

        creationStatus.progress = 95;

        // 10) Resetear estado global del servidor
        serverState.worldName = levelName;
        serverState.version = version;
        serverState.software = type;
        serverState.status = 'offline';
        serverState.players = [];
        serverState.logs = [];
        serverState.startTime = null;
        serverState.worldSize = '0 MB';
        banIpByName = {};
        playerLastIp = {};

        const reg = await registerInstance({
            id: creationStatus.instanceId || undefined,
            name: levelName,
            path: serverPath,
            software: type,
            version: version,
            status: 'offline'
        });
        await fs.remove(path.join(serverPath, '.creating')).catch(() => {});
        await setActiveInstance(reg.id);
        creationStatus.instanceId = reg.id;

        addCreationStep(`ðŸŽ‰ Â¡Mundo "${levelName}" listo! Recuerda subir tus mods o plugins en la sección de 'Archivos' antes de iniciar el servidor para que la generación sea correcta.`);
        creationStatus.progress = 100;
        creationStatus.status = 'done';

    } catch (e) {
        console.error('[CREATE-WORLD]', e);
        try {
            if (creationStatus.instanceId) {
                const maybePath = path.join(config.SERVERS_ROOT, creationStatus.instanceId);
                await fs.remove(path.join(maybePath, '.creating')).catch(() => {});
            }
        } catch (_e) {}
        addCreationStep(`âŒ Error: ${e.message}`);
        creationStatus.status = 'error';
    }
}

// Monitor de recursos
setInterval(() => {
    osUtils.cpuUsage((v) => { serverState.cpu = Math.round(v * 100); });
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    serverState.ram = Math.round(((totalMem - freeMem) / totalMem) * 100);
    serverState.ramUsedGB = ((totalMem - freeMem) / (1024 * 1024 * 1024)).toFixed(1);
    serverState.ramTotalGB = (totalMem / (1024 * 1024 * 1024)).toFixed(0);
    
    // Update world size periodically
    updateWorldSize();

}, 6000);

async function loadWorldName() {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;
        const propPath = path.join(serverPath, 'server.properties');
        if (await fs.pathExists(propPath)) {
            const content = await fs.readFile(propPath, 'utf-8');
            const match = content.match(/level-name=(.+)/);
            if (match) serverState.worldName = match[1].trim();
            else serverState.worldName = 'world';
        } else {
            serverState.worldName = 'world';
        }
    } catch (e) {
        serverState.worldName = 'world';
    }
}

async function peekLogsForMetadata() {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;
        const logPath = path.join(serverPath, 'logs', 'latest.log');
        if (await fs.pathExists(logPath)) {
            const content = await fs.readFile(logPath, 'utf-8');
            const lines = content.split('\n').reverse().slice(0, 500); // Last 500 lines
            let softwareDetected = false;
            
            for (const line of lines) {
                if (line.includes('Starting minecraft server version')) {
                    const match = line.match(/version\s+([0-9.a-zA-Z_-]+)/);
                    if (match && serverState.version === '...') serverState.version = match[1];
                }
                if (line.includes('This server is running')) {
                    if (line.includes('Paper')) serverState.software = 'Paper';
                    else if (line.includes('Spigot')) serverState.software = 'Spigot';
                    else if (line.includes('Forge')) serverState.software = 'Forge';
                    else serverState.software = 'Vanilla';
                    softwareDetected = true;
                }
                if (line.includes('Fabric Loader')) { serverState.software = 'Fabric'; softwareDetected = true; }
                if (line.toLowerCase().includes('mohist')) { serverState.software = 'Mohist'; softwareDetected = true; }
                if (line.toLowerCase().includes('purpur')) { serverState.software = 'Purpur'; softwareDetected = true; }
            }

            if (!softwareDetected && (serverState.software === 'Detectando...' || !serverState.software)) {
                serverState.software = 'Vanilla';
            }
        }
    } catch (e) {}
}

async function getDirSize(dirPath) {
    let size = 0;
    const files = await fs.readdir(dirPath).catch(() => []);
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath).catch(() => null);
        if (!stats) continue;
        if (stats.isDirectory()) size += await getDirSize(filePath);
        else size += stats.size;
    }
    return size;
}

let lastWorldSizeUpdate = 0;
async function updateWorldSize() {
    // Solo actualizar cada 60 segundos
    if (Date.now() - lastWorldSizeUpdate < 60000) return;
    lastWorldSizeUpdate = Date.now();

    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;
        if (serverState.worldName === 'Cargando...') await loadWorldName();
        
        const worldPath = path.join(serverPath, serverState.worldName);
        let sizeBytes = 0;
        
        if (await fs.pathExists(worldPath)) {
            sizeBytes = await getDirSize(worldPath);
        }
        
        // Si no existe el mundo o pesa 0, medimos toda la carpeta del servidor
        if (sizeBytes === 0) {
            sizeBytes = await getDirSize(serverPath);
        }

        if (sizeBytes > 1024 * 1024 * 1024) serverState.worldSize = (sizeBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        else serverState.worldSize = (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB';
    } catch(e) {}
}

function resetPlayersOnlineStatus() {
    serverState.players.forEach(p => { p.online = false; });
}

function applyOnlinePlayersSnapshot(names) {
    const normalized = names
        .map(n => (n || '').trim())
        .filter(Boolean);
    const onlineSet = new Set(normalized.map(n => n.toLowerCase()));

    // Mark everyone offline first, then set the snapshot players online.
    serverState.players.forEach(p => { p.online = onlineSet.has((p.name || '').toLowerCase()); });

    for (const name of normalized) {
        let p = serverState.players.find(x => x.name && x.name.toLowerCase() === name.toLowerCase());
        if (!p) {
            p = {
                id: name.toLowerCase(),
                name,
                online: true,
                dimension: 'Overworld',
                location: { x: 0, y: 64, z: 0 },
                gamemode: 'Survival',
                ip: playerLastIp[name.toLowerCase()] || '0.0.0.0'
            };
            serverState.players.push(p);
        } else {
            p.online = true;
        }
    }
}

// REFRESH PLAYER DATA & DISCOVER DISCONNECTED/BANNED PLAYERS
// CACHE PARA EL ESCÃNER DE ARCHIVOS
let lastFileTimestamps = {};

// REFRESH PLAYER DATA & DISCOVER DISCONNECTED/BANNED PLAYERS
async function refreshAllPlayers() {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;

        if (Object.keys(banIpByName).length === 0) await loadBanIpCache();
        if (Object.keys(playerLastIp).length === 0) await loadPlayerLastIp();

        // 1. Discover (con caché de archivos para mayor velocidad)
        const filesToScan = [
            { path: 'banned-players.json', key: 'name' },
            { path: 'whitelist.json', key: 'name' },
            { path: 'ops.json', key: 'name' },
            { path: 'usercache.json', key: 'name' }
        ];

        for (const file of filesToScan) {
            const filePath = path.join(serverPath, file.path);
            if (await fs.pathExists(filePath)) {
                const stats = await fs.stat(filePath);
                if (lastFileTimestamps[file.path] === stats.mtimeMs) continue; // No ha cambiado, saltar
                lastFileTimestamps[file.path] = stats.mtimeMs;

                const data = await fs.readJson(filePath).catch(() => []);
                data.forEach(entry => {
                    const name = entry[file.key];
                    if (name && !serverState.players.find(p => p.name.toLowerCase() === name.toLowerCase())) {
                        serverState.players.push({
                            id: name.toLowerCase(),
                            name: name,
                            online: false,
                            dimension: 'Overworld',
                            location: { x: 0, y: 0, z: 0 },
                            gamemode: 'Survival',
                            ip: '0.0.0.0'
                        });
                    }
                });
            }
        }

        // 2. Update (solo jugadores online o los primeros 10 para ahorrar CPU)
        const playersToUpdate = serverState.players.filter(p => p.online).slice(0, 20);
        for (let player of playersToUpdate) {
            const info = await getPlayerExtendedInfo(player.name);
            Object.assign(player, info);
        }
    } catch (e) {}
}

setInterval(refreshAllPlayers, 10000); // Escanear archivos cada 10s (más eficiente)

setInterval(() => {
    try {
        if (!mcProcess) return;
        if (serverState.status !== 'online') return;
        mcProcess.stdin.write('list\n');
    } catch (e) {}
}, 7000);


async function loadRealTimeMetadata() {
    try {
        const active = await getActiveInstance();
        const serverPath = await getFirstServerPath();
        if (!serverPath) return;
        if (active) serverState.worldName = active.name;
        const propPath = path.join(serverPath, 'server.properties');
        if (await fs.pathExists(propPath)) {
            const content = await fs.readFile(propPath, 'utf-8');
            const maxMatch = content.match(/max-players=(\d+)/);
            if (maxMatch) serverState.maxPlayers = parseInt(maxMatch[1]);
        }
    } catch (e) {}
}
loadRealTimeMetadata();

async function getPlayerExtendedInfo(name) {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return {};
        
        let op = false, whitelisted = false, uuid = 'Desconocido', bannedIp = false, bannedUuid = false;

        const cachePath = path.join(serverPath, 'usercache.json');
        if (await fs.pathExists(cachePath)) {
            const cache = await fs.readJson(cachePath).catch(() => []);
            const entry = cache.find(c => c.name && c.name.toLowerCase() === name.toLowerCase());
            if (entry) uuid = entry.uuid;
        }

        const opsPath = path.join(serverPath, 'ops.json');
        if (await fs.pathExists(opsPath)) {
            const ops = await fs.readJson(opsPath).catch(() => []);
            op = ops.some(o => o.name && o.name.toLowerCase() === name.toLowerCase());
        }

        const wlPath = path.join(serverPath, 'whitelist.json');
        if (await fs.pathExists(wlPath)) {
            const wl = await fs.readJson(wlPath).catch(() => []);
            whitelisted = wl.some(w => w.name && w.name.toLowerCase() === name.toLowerCase());
        }

        const banPath = path.join(serverPath, 'banned-players.json');
        if (await fs.pathExists(banPath)) {
            const bans = await fs.readJson(banPath).catch(() => []);
            bannedUuid = bans.some(b => b.name && b.name.toLowerCase() === name.toLowerCase());
        }

        const banIpPath = path.join(serverPath, 'banned-ips.json');
        if (await fs.pathExists(banIpPath)) {
            const bansIp = await fs.readJson(banIpPath).catch(() => []);
            const playerObj = serverState.players.find(p => p.name.toLowerCase() === name.toLowerCase());
            const ipFromMap = banIpByName[name.toLowerCase()];
            bannedIp = bansIp.some(b => 
                (b.name && b.name.toLowerCase() === name.toLowerCase()) || 
                (playerObj && playerObj.ip !== '0.0.0.0' && playerObj.ip === b.ip) ||
                (ipFromMap && bansIp.some(b2 => b2.ip === ipFromMap))
            );
        }

        const locInfo = await getPlayerLocationFromNbt(name);
        return { op, whitelisted, uuid, bannedIp, bannedUuid, ...locInfo };
    } catch (e) { return {}; }
}

function addLog(msg) {
    // Silenciar sondeo interno de conectados para no ensuciar consola/UI.
    const listMatch = msg.match(/There are\s+(\d+)\s+of a max of\s+\d+\s+players online:?\s*(.*)$/i);
    if (listMatch) {
        const onlineCount = parseInt(listMatch[1], 10) || 0;
        const rawNames = (listMatch[2] || '').trim();
        const names = rawNames
            ? rawNames.split(',').map(x => x.trim()).filter(Boolean)
            : [];
        if (onlineCount === 0) applyOnlinePlayersSnapshot([]);
        else applyOnlinePlayersSnapshot(names);
        return;
    }
    if (/issued server command:\s*\/list/i.test(msg)) return;

    const time = new Date().toLocaleTimeString();
    serverState.logs.push(`[${time}] ${msg}`);
    if (serverState.logs.length > 500) serverState.logs.shift();

    if (msg.includes('Starting minecraft server version')) {
        const parts = msg.split('version');
        if (parts.length > 1) serverState.version = parts[1].trim();
    }
    if (msg.includes('This server is running')) {
        if (msg.includes('Paper')) serverState.software = 'Paper';
        else if (msg.includes('Spigot')) serverState.software = 'Spigot';
        else if (msg.includes('Forge')) serverState.software = 'Forge';
        else serverState.software = 'Vanilla';
    }
    if (msg.includes('Fabric Loader')) serverState.software = 'Fabric';
    if (msg.toLowerCase().includes('mohist')) serverState.software = 'Mohist';
    if (msg.toLowerCase().includes('purpur')) serverState.software = 'Purpur';

    // --- DETECCIÃ“N DE JUGADORES (Mejorada) ---
    // 1. Detección de Entrada (Joined)
    const joinMatch = msg.match(/\[.*\/INFO\]: (.*?)(\[.*\])? joined the game/);
    if (joinMatch) {
        const name = joinMatch[1].split(' ').pop().trim(); // Limpiar rastro de timestamp si lo hubiera
        let p = serverState.players.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (p) {
            p.online = true;
        } else {
            p = { 
                id: name.toLowerCase(),
                name, online: true, dimension: 'Overworld', location: {x:0, y:64, z:0},
                gamemode: 'Survival', health: 20, hunger: 20, ip: '0.0.0.0'
            };
            serverState.players.push(p);
        }
        // Refrescar info extendida en paralelo
        getPlayerExtendedInfo(name).then(info => Object.assign(p, info));
    }

    // 2. Detección de UUID (Crucial para cambios Premium/No-Premium)
    const uuidMatch = msg.match(/UUID of player (.*?) is (.*)/);
    if (uuidMatch) {
        const nameVal = uuidMatch[1].trim();
        const uuidVal = uuidMatch[2].trim();
        let p = serverState.players.find(x => x.name.toLowerCase() === nameVal.toLowerCase());
        if (p) p.uuid = uuidVal;
    }

    // 3. Detección de IP y Login (GameProfile o Login message)
    const loginMatch = msg.match(/\[.*\/INFO\]: (.*?)\[\/(.*?):\d+\] logged in with entity id/);
    if (loginMatch) {
        const nameVal = loginMatch[1].trim();
        const ipVal = loginMatch[2].trim();
        let p = serverState.players.find(x => x.name.toLowerCase() === nameVal.toLowerCase());
        if (p) {
            p.ip = ipVal;
            p.online = true;
            if (ipVal !== '0.0.0.0') {
                playerLastIp[nameVal.toLowerCase()] = ipVal;
                savePlayerLastIp();
            }
        }
    }

    // 4. Detección de Salida (Left)
    const leaveMatch = msg.match(/\[.*\/INFO\]: (.*?)(\[.*\])? left the game/);
    if (leaveMatch) {
        const name = leaveMatch[1].split(' ').pop().trim();
        let p = serverState.players.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (p) p.online = false;
    }
}


function cleanupLingeringJava() {
    return new Promise((resolve) => {
        if (os.platform() === 'win32') {
            const cmd = 'wmic process where "name=\'java.exe\' and commandline like \'%server.jar%\'" get processid';
            exec(cmd, (err, stdout) => {
                if (stdout) {
                    const pids = stdout.split('\n').map(l => l.trim()).filter(l => l && !isNaN(l) && l !== 'ProcessId');
                    pids.forEach(pid => exec(`taskkill /f /pid ${pid} /t`));
                    setTimeout(resolve, 2000);
                } else resolve();
            });
        } else {
            // Linux/Docker cleanup
            exec('pkill -f "java.*server.jar"', () => {
                setTimeout(resolve, 2000);
            });
        }
    });
}

function stopProcessSync() {
    return new Promise(async (resolve) => {
        if (!mcProcess) { await cleanupLingeringJava(); return resolve(); }
        try { mcProcess.stdin.write('stop\n'); } catch(e) { }
        let timer = setTimeout(async () => {
            if (mcProcess) {
                if (os.platform() === 'win32') {
                    exec(`taskkill /f /pid ${mcProcess.pid} /t`);
                } else {
                    mcProcess.kill('SIGKILL');
                }
                mcProcess = null;
                serverState.status = 'offline';
                resolve();
            }
        }, 8000);
        mcProcess.on('close', () => {
            clearTimeout(timer);
            mcProcess = null;
            serverState.status = 'offline';
            resolve();
        });
    });
}

function detectBestLocalIp() {
    const nets = os.networkInterfaces();
    let normalIp = '127.0.0.1';
    let tailscaleIp = '';

    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family !== 'IPv4' || net.internal) continue;
            if (!normalIp || normalIp === '127.0.0.1') normalIp = net.address;
            if (net.address.startsWith('100.') && !tailscaleIp) tailscaleIp = net.address;
            if (name.toLowerCase().includes('tailscale') && !tailscaleIp) tailscaleIp = net.address;
        }
    }
    return { ip: tailscaleIp || normalIp || '127.0.0.1', tailscaleIp, normalIp: normalIp || '127.0.0.1' };
}

function detectPublicPort(req) {
    if (config.PUBLIC_PORT) return String(config.PUBLIC_PORT);
    if (config.MC_PUBLIC_PORT) return String(config.MC_PUBLIC_PORT);
    if (req.headers['x-public-port']) return String(req.headers['x-public-port']);
    if (req.headers['x-forwarded-port']) return String(req.headers['x-forwarded-port']);
    const host = String(req.headers.host || '');
    const hostPort = host.includes(':') ? host.split(':').pop() : '';
    return hostPort || String(config.PORT);
}

function detectPublicHost(req) {
    if (config.PUBLIC_HOST) return String(config.PUBLIC_HOST);
    if (!config.PUBLIC_HOST && config.TAILSCALE_IP) return String(config.TAILSCALE_IP);
    if (req.headers['x-public-host']) return String(req.headers['x-public-host']);
    const local = detectBestLocalIp();
    return local.tailscaleIp || local.ip;
}

app.get('/api/instances', async (req, res) => {
    try {
        const instances = await listInstances();
        const active = await getActiveInstance();
        const activePlayers = Array.isArray(serverState.players) ? serverState.players.filter(p => p && p.online).length : 0;
        const activeUptimeMs = serverState.startTime ? (Date.now() - serverState.startTime) : 0;
        const decorated = await Promise.all(instances.map(async (i) => {
            let iconRev = 0;
            try {
                const iconPath = path.join(i.path, 'server-icon.png');
                if (await fs.pathExists(iconPath)) {
                    const st = await fs.stat(iconPath);
                    iconRev = st.mtimeMs || 0;
                }
            } catch (e) {}
            const isActive = !!(active && i.id === active.id);
            const software = isActive
                ? (serverState.software || i.software || 'Vanilla')
                : (i.software || 'Vanilla');
            const versionFromRegistry = String(i.version || '').trim();
            const liveVersion = String(serverState.version || '').trim();
            const version = isActive && liveVersion && liveVersion !== '...'
                ? liveVersion
                : (versionFromRegistry && versionFromRegistry !== '...' ? versionFromRegistry : '');

            return {
                ...i,
                status: isActive ? serverState.status : (i.status || 'offline'),
                version,
                software,
                playersOnline: isActive ? activePlayers : 0,
                uptimeMs: isActive ? activeUptimeMs : 0,
                iconRev,
                iconUrl: `/api/server/icon?instanceId=${encodeURIComponent(i.id)}&rev=${encodeURIComponent(iconRev)}`
            };
        }));
        res.json({ activeInstanceId: active ? active.id : null, instances: decorated });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/instances', async (req, res) => {
    try {
        const rawName = (req.body && req.body.name ? String(req.body.name) : '').trim();
        const name = rawName.replace(/[^a-zA-Z0-9_\- ]/g, '') || `world-${Date.now().toString(36).slice(-4)}`;
        const software = String((req.body && req.body.software) || 'Vanilla');
        const version = String((req.body && req.body.version) || '...');

        const folderName = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `world-${Date.now().toString(36).slice(-4)}`;
        const serverPath = path.join(config.SERVERS_ROOT, folderName);

        if (await fs.pathExists(serverPath)) {
            return res.status(409).json({ error: 'Ya existe una instancia con esa ruta' });
        }

        await fs.ensureDir(serverPath);
        await fs.ensureDir(path.join(serverPath, 'mods'));
        await fs.ensureDir(path.join(serverPath, 'plugins'));

        const created = await registerInstance({
            name,
            path: serverPath,
            software,
            version,
            status: 'offline'
        });

        res.status(201).json({ message: 'OK', instance: created });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/instances/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '');
        const instance = await getInstanceById(id);
        if (!instance) return res.status(404).json({ error: 'Instancia no encontrada' });
        res.json(instance);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/instances/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '');
        const current = await getInstanceById(id);
        if (!current) return res.status(404).json({ error: 'Instancia no encontrada' });

        const patch = {};
        if (typeof req.body?.name === 'string') {
            patch.name = req.body.name.trim().replace(/[^a-zA-Z0-9_\- ]/g, '') || current.name;
        }
        if (typeof req.body?.software === 'string') patch.software = req.body.software;
        if (typeof req.body?.version === 'string') patch.version = req.body.version;
        if (typeof req.body?.status === 'string') patch.status = req.body.status;

        const updated = await updateInstance(id, patch);
        res.json({ message: 'OK', instance: updated });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/instances/select', async (req, res) => {
    try {
        const id = (req.body && req.body.instanceId) ? String(req.body.instanceId) : null;
        if (!id) return res.status(400).json({ error: 'Falta instanceId' });
        const selected = await setActiveInstance(id);
        if (!selected) return res.status(404).json({ error: 'Instancia no encontrada' });
        res.json({ message: 'OK', activeInstanceId: selected.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/instances/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '');
        const inst = await getInstanceById(id);
        if (!inst) return res.status(404).json({ error: 'Instancia no encontrada' });
        if (mcProcess) return res.status(400).json({ error: 'Deten el servidor activo antes de eliminar una instancia' });
        await fs.remove(inst.path);
        await removeInstance(id);
        res.json({ message: 'OK' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/catalog/software', async (req, res) => {
    try {
        const software = await getSoftwareList();
        res.json({ software });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/catalog/versions', async (req, res) => {
    try {
        const software = String(req.query.software || 'Vanilla');
        const versions = await getVersionsForSoftware(software);
        res.json({ software, versions });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/catalog/refresh', async (req, res) => {
    try {
        const catalog = await getCatalog({ forceRefresh: true });
        res.json({ message: 'OK', catalog });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/server/status', async (req, res) => {
    const data = { ...serverState };
    data.uptimeMs = serverState.startTime ? (Date.now() - serverState.startTime) : 0;
    const active = await getActiveInstance().catch(() => null);
    data.activeInstanceId = active ? active.id : null;
    data.publicEndpoint = `${detectPublicHost(req)}:${detectPublicPort(req)}`;
    res.json(data);
});

app.get('/api/server/ip', (req, res) => {
    try {
        const best = detectBestLocalIp();
        res.json({
            ip: best.ip,
            tailscaleIp: best.tailscaleIp || null,
            normalIp: best.normalIp || null,
            publicPort: detectPublicPort(req),
            publicAddress: `${detectPublicHost(req)}:${detectPublicPort(req)}`
        });
    } catch (e) {
        res.json({ ip: '127.0.0.1' });
    }
});

app.get('/api/server/public-endpoint', (req, res) => {
    try {
        const host = detectPublicHost(req);
        const port = detectPublicPort(req);
        const best = detectBestLocalIp();
        res.json({
            host,
            port,
            address: `${host}:${port}`,
            tailscaleIp: best.tailscaleIp || null,
            internalIp: best.normalIp || null
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Subir server-icon.png desde el panel
app.post('/api/server/icon', async (req, res) => {
    try {
        const serverPath = await getServerPathFromRequest(req);
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const { IncomingForm: IconForm } = require('formidable');
        const form = new IconForm({ maxFileSize: 1024 * 1024 });
        form.parse(req, async (err, fields, files) => {
            if (err) return res.status(500).json({ error: err.message });
            const file = files.icon ? (Array.isArray(files.icon) ? files.icon[0] : files.icon) : null;
            if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
            const dest = path.join(serverPath, 'server-icon.png');
            await fs.move(file.filepath, dest, { overwrite: true });
            res.json({ message: 'Icono actualizado. Reinicia el servidor para verlo.' });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/server/icon', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        const serverPath = await getServerPathFromRequest(req);
        if (serverPath) {
            const iconPath = path.join(serverPath, 'server-icon.png');
            if (await fs.pathExists(iconPath)) return res.sendFile(iconPath);
        }

        const fallbackCandidates = [
            path.join(config.PANEL_ROOT, 'resources', 'icono.png'),
            path.join(config.PANEL_ROOT, 'resources', 'server-icon-default.png'),
            path.join(config.PANEL_ROOT, 'resources', 'logo.png'),
            path.join(config.PANEL_ROOT, 'resources', 'marcternos_logo.png')
        ];
        for (const p of fallbackCandidates) {
            if (await fs.pathExists(p)) return res.sendFile(p);
        }
        res.status(404).json({ error: 'No icon' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/server/gamerules', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        
        if (serverState.worldName === 'Cargando...') await loadWorldName();
        const worldName = serverState.worldName || 'world';
        
        const possiblePaths = [
            path.join(serverPath, worldName, 'level.dat'),
            path.join(serverPath, 'world', 'level.dat')
        ];
        
        let levelDatPath = null;
        for (const p of possiblePaths) {
            if (await fs.pathExists(p)) {
                levelDatPath = p;
                break;
            }
        }
        
        if (!levelDatPath) return res.status(404).json({ error: 'level.dat no encontrado' });
        
        const buf = await fs.readFile(levelDatPath);
        const { parsed } = await nbt.parse(buf);
        const simple = nbt.simplify(parsed);
        
        let fileRules = (simple && simple.Data && simple.Data.GameRules) ? simple.Data.GameRules : {};
        
        // Merge with cache (cache takes priority as it's the most recent state)
        const finalRules = { ...fileRules, ...gameruleCache };
        res.json(finalRules);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/current-server', async (req, res) => {
    const active = await getActiveInstance().catch(() => null);
    res.json({
        id: active ? active.id : null,
        name: active ? active.name : (serverState.worldName || 'world')
    });
});

app.post('/api/addons/install', async (req, res) => {
    try {
        const { url, name, type } = req.body;
        if (!url || !name || !type) return res.status(400).json({ error: 'Faltan parámetros (url, name, type)' });
        
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'No se encontró la carpeta del servidor. Crea un mundo primero.' });
        
        const destDir = type === 'mod' ? 'mods' : 'plugins';
        const targetPath = path.join(serverPath, destDir, name);
        
        await fs.ensureDir(path.join(serverPath, destDir));
        
        console.log(`[ADDON-INSTALL] Descargando ${name} desde ${url}...`);
        addLog(`ðŸ“¥ Instalando ${type}: ${name}...`);
        
        await downloadFile(url, targetPath);
        
        addLog(`âœ… ${name} instalado correctamente.`);
        res.json({ message: 'Instalado con éxito', path: targetPath });
    } catch (e) {
        console.error('Error addon install:', e);
        res.status(500).json({ error: `Fallo en la descarga: ${e.message}` });
    }
});

app.get('/api/addons/installed', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.json({ mods: [], plugins: [] });
        
        const modsPath = path.join(serverPath, 'mods');
        const pluginsPath = path.join(serverPath, 'plugins');
        
        const mods = (await fs.pathExists(modsPath)) ? await fs.readdir(modsPath) : [];
        const plugins = (await fs.pathExists(pluginsPath)) ? await fs.readdir(pluginsPath) : [];
        
        res.json({ mods, plugins });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/addons/remove', async (req, res) => {
    try {
        const { name, type } = req.body;
        if (!name || !type) return res.status(400).json({ error: 'Faltan parámetros' });
        
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'No se encontró el servidor' });
        
        const destDir = type === 'mod' ? 'mods' : 'plugins';
        const targetPath = path.join(serverPath, destDir, name);
        
        if (await fs.pathExists(targetPath)) {
            await fs.remove(targetPath);
            addLog(`ðŸ—‘ï¸ Addon eliminado: ${name}`);
            res.json({ message: 'Eliminado con éxito' });
        } else {
            res.status(404).json({ error: 'El archivo no existe' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/create-world', async (req, res) => {
    if (creationStatus.status === 'running') {
        return res.status(400).json({ error: 'Ya hay una creación de mundo en curso.' });
    }
    createWorldFromRequest(req.body || {});
    res.json({ message: 'OK' });
});

app.get('/api/creation-status', (req, res) => {
    res.json(creationStatus);
});

async function getPlayerLocationFromNbt(playerName) {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return null;
        const usercachePath = path.join(serverPath, 'usercache.json');
        if (!(await fs.pathExists(usercachePath))) return null;
        const cache = await fs.readJson(usercachePath);
        const entry = cache.find(c => c.name && c.name.toLowerCase() === playerName.toLowerCase());
        if (!entry || !entry.uuid) return null;
        const uuid = entry.uuid;
        const undashedUuid = uuid.replace(/-/g, '');
        const serverWorldName = serverState.worldName || 'world';
        
        // --- MULTI-PATH & MULTI-UUID SEARCH ---
        const possibleFiles = [uuid + '.dat', undashedUuid + '.dat'];
        const possibleDirs = [
            path.join(serverPath, serverWorldName, 'playerdata'),
            path.join(serverPath, 'playerdata'),
            path.join(serverPath, 'world', 'playerdata')
        ];

        let playerdataPath = null;
        for (const dir of possibleDirs) {
            for (const file of possibleFiles) {
                const fullPath = path.join(dir, file);
                if (await fs.pathExists(fullPath)) {
                    playerdataPath = fullPath;
                    break;
                }
            }
            if (playerdataPath) break;
        }

        if (!playerdataPath) {
            return { location: {x:0,y:0,z:0}, dimension: 'minecraft:overworld' };
        }

        const buf = await fs.readFile(playerdataPath);
        const { parsed } = await nbt.parse(buf);
        const simple = nbt.simplify(parsed);
        
        const toNum = (v) => (v && typeof v === 'object' && 'value' in v) ? Number(v.value) : Number(v);
        const toStr = (v) => (v && typeof v === 'object' && 'value' in v) ? String(v.value) : String(v);

        const location = { x: 0, y: 0, z: 0 };
        if (simple.Pos && Array.isArray(simple.Pos)) {
            location.x = Math.floor(toNum(simple.Pos[0]));
            location.y = Math.floor(toNum(simple.Pos[1]));
            location.z = Math.floor(toNum(simple.Pos[2]));
        }

        let dimension = 'minecraft:overworld';
        // Extreme search for dimension info in common NBT tags
        const dimKeys = ['Dimension', 'dimension', 'World', 'world', 'Dim', 'dim', 'MapDimension'];
        let foundDim = null;
        for (const key of dimKeys) {
            if (simple[key] !== undefined) {
                foundDim = toStr(simple[key]);
                break;
            }
        }

        if (foundDim !== null) {
            const val = foundDim.toLowerCase();
            if (val.includes('nether') || val === '-1') dimension = 'minecraft:the_nether';
            else if (val.includes('end') || val === '1') dimension = 'minecraft:the_end';
            else if (val.includes('overworld') || val === '0') dimension = 'minecraft:overworld';
            else dimension = foundDim; // Fallback for custom dimensions
        }

        const spawn = { x: 0, y: 0, z: 0 };
        let spawnDimension = 'minecraft:overworld';
        if (simple.SpawnX != null) {
            spawn.x = toNum(simple.SpawnX);
            spawn.y = toNum(simple.SpawnY ?? 0);
            spawn.z = toNum(simple.SpawnZ ?? 0);

            // Buscar SpawnDimension: primero en el NBT simplificado, luego en el raw (parsed.value)
            // prismarine-nbt a veces no simplifica correctamente ciertos TAG_String compuestos
            const rawParsedValue = (parsed && parsed.value) ? parsed.value : {};
            const sdSimple = simple.SpawnDimension;
            const sdRaw = rawParsedValue.SpawnDimension;

            let sdFound = null;
            if (sdSimple != null) {
                sdFound = toStr(sdSimple);
            } else if (sdRaw != null) {
                sdFound = toStr(sdRaw);
            }


            if (sdFound != null) {
                const sd = sdFound.toLowerCase();
                if (sd.includes('nether')) spawnDimension = 'minecraft:the_nether';
                else if (sd.includes('end')) spawnDimension = 'minecraft:the_end';
                else spawnDimension = sdFound;
            }
        }

        let lastDeath = null;
        let lastDeathDimension = 'minecraft:overworld';

        const ld = simple.LastDeathPos || simple.LastDeathLocation;
        if (ld) {
            if (Array.isArray(ld)) {
                // Formato antiguo: array puro [x, y, z] â€” sin dimensión guardada
                lastDeath = { x: Math.floor(toNum(ld[0])), y: Math.floor(toNum(ld[1])), z: Math.floor(toNum(ld[2])) };
            } else if (ld.pos && Array.isArray(ld.pos)) {
                // Formato 1.17+: { dimension: "minecraft:the_nether", pos: [x, y, z] }
                lastDeath = { x: Math.floor(toNum(ld.pos[0])), y: Math.floor(toNum(ld.pos[1])), z: Math.floor(toNum(ld.pos[2])) };
                if (ld.dimension) {
                    const dimRaw = toStr(ld.dimension).toLowerCase();
                    if (dimRaw.includes('nether')) lastDeathDimension = 'minecraft:the_nether';
                    else if (dimRaw.includes('end')) lastDeathDimension = 'minecraft:the_end';
                    else lastDeathDimension = toStr(ld.dimension);
                }
            } else if (ld.X !== undefined || ld.x !== undefined) {
                lastDeath = { x: Math.floor(toNum(ld.X ?? ld.x)), y: Math.floor(toNum(ld.Y ?? ld.y)), z: Math.floor(toNum(ld.Z ?? ld.z)) };
                if (ld.dimension) {
                    const dimRaw = toStr(ld.dimension).toLowerCase();
                    if (dimRaw.includes('nether')) lastDeathDimension = 'minecraft:the_nether';
                    else if (dimRaw.includes('end')) lastDeathDimension = 'minecraft:the_end';
                    else lastDeathDimension = toStr(ld.dimension);
                }
            }
        }
        
        return { location, dimension, spawn, spawnDimension, lastDeath, lastDeathDimension };
    } catch (e) { 
        return { location: {x:0,y:0,z:0}, dimension: 'minecraft:overworld' }; 
    }
}

app.get('/api/server/player/:name/location', async (req, res) => {
    try {
        const name = (req.params.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Falta el nombre' });
        const loc = await getPlayerLocationFromNbt(name);
        
        if (loc) {
            let p = serverState.players.find(x => x.name.toLowerCase() === name.toLowerCase());
            if (p) {
                p.location = loc.location || p.location;
                p.dimension = loc.dimension || p.dimension;
            }
        }

        if (!loc) return res.json({ location: null, dimension: 'minecraft:overworld', spawn: null, lastDeath: null });
        res.json(loc);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/server/start', async (req, res) => {
    if (mcProcess) return res.status(400).json({ error: 'Ya encendido' });
    await cleanupLingeringJava();
    try {
        const serverPath = await getServerPathFromRequest(req);
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        serverState.logs = [];
        serverState.status = 'starting';
        const javaFlags = config.JAVA_ARGS.split(' ').filter(arg => arg.trim() !== '');
        mcProcess = spawn(config.JAVA_PATH, [...javaFlags, '-jar', 'server.jar', 'nogui'], { cwd: serverPath, shell: false });
        
        // Manejador de errores para evitar que el servidor se caiga si no se encuentra Java
        mcProcess.on('error', (err) => {
            console.error('Error al iniciar el proceso de Minecraft:', err);
            addLog(`Â¡ERROR CRÃTICO! No se pudo iniciar el servidor: ${err.message}`);
            if (err.code === 'ENOENT') {
                addLog('Asegúrate de tener Java instalado y en el PATH, o configura la ruta en config.js');
            }
            serverState.status = 'offline';
        });
        mcProcess.stdout.on('data', data => {
            data.toString().split('\n').forEach(line => {
                if (line.trim()) {
                    addLog(line.trim());
                    // Status Detection
                    if (line.includes('Done') || line.includes('For help, type "help"')) {
                        serverState.status = 'online';
                        if (!serverState.startTime) serverState.startTime = Date.now();
                        // Si no se detectó otro software, es Vanilla
                        if (serverState.software === 'Detectando...') serverState.software = 'Vanilla';
                        try { mcProcess.stdin.write('list\n'); } catch (e) {}
                    }
                    // Version Detection
                    if (line.includes('Starting minecraft server version')) {
                        const match = line.match(/version\s+([0-9.a-zA-Z_-]+)/);
                        if (match) serverState.version = match[1];
                    }
                    // Software Detection
                    if (line.includes('This server is running')) {
                        if (line.includes('Paper')) serverState.software = 'Paper';
                        else if (line.includes('Spigot')) serverState.software = 'Spigot';
                        else if (line.includes('Forge')) serverState.software = 'Forge';
                        else serverState.software = 'Vanilla';
                    }
                    if (line.includes('Fabric Loader')) serverState.software = 'Fabric';
                    if (line.toLowerCase().includes('mohist')) serverState.software = 'Mohist';
                    if (line.toLowerCase().includes('purpur')) serverState.software = 'Purpur';
                }
            });
        });
        mcProcess.stderr.on('data', data => {
            data.toString().split('\n').forEach(line => {
                if (line.trim()) addLog(line.trim());
            });
        });
        mcProcess.on('close', () => { 
            serverState.status = 'offline'; 
            mcProcess = null; 
            serverState.startTime = null;
            resetPlayersOnlineStatus();
        });
        // Set start time immediately when spawning as fallback
        serverState.startTime = Date.now();
        res.json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/server/stop', async (req, res) => { await stopProcessSync(); res.json({ message: 'OK' }); });
app.post('/api/server/restart', async (req, res) => {
    await stopProcessSync();
    setTimeout(async () => {
        const serverPath = await getServerPathFromRequest(req);
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        serverState.logs = [];
        serverState.status = 'starting';
        const javaFlags = config.JAVA_ARGS.split(' ').filter(arg => arg.trim() !== '');
        mcProcess = spawn(config.JAVA_PATH, [...javaFlags, '-jar', 'server.jar', 'nogui'], { cwd: serverPath, shell: false });
        
        mcProcess.on('error', (err) => {
            console.error('Error al iniciar el proceso de Minecraft (RESTART):', err);
            addLog(`Â¡ERROR CRÃTICO! No se pudo iniciar el servidor tras el reinicio: ${err.message}`);
            if (err.code === 'ENOENT') {
                addLog('Asegúrate de tener Java instalado y en el PATH, o configura la ruta en config.js');
            }
            serverState.status = 'offline';
        });
        mcProcess.stdout.on('data', data => {
            data.toString().split('\n').forEach(line => {
                if (line.trim()) {
                    addLog(line.trim());
                    if (line.includes('Done') || line.includes('For help, type "help"')) {
                        serverState.status = 'online';
                        if (!serverState.startTime) serverState.startTime = Date.now();
                        if (serverState.software === 'Detectando...') serverState.software = 'Vanilla';
                        try { mcProcess.stdin.write('list\n'); } catch (e) {}
                    }
                    if (line.includes('Starting minecraft server version')) {
                        const match = line.match(/version\s+([0-9.a-zA-Z_-]+)/);
                        if (match) serverState.version = match[1];
                    }
                    if (line.includes('This server is running')) {
                        if (line.includes('Paper')) serverState.software = 'Paper';
                        else if (line.includes('Spigot')) serverState.software = 'Spigot';
                        else if (line.includes('Forge')) serverState.software = 'Forge';
                        else serverState.software = 'Vanilla';
                    }
                    if (line.includes('Fabric Loader')) serverState.software = 'Fabric';
                    if (line.toLowerCase().includes('mohist')) serverState.software = 'Mohist';
                    if (line.toLowerCase().includes('purpur')) serverState.software = 'Purpur';
                }
            });
        });
        mcProcess.stderr.on('data', data => {
            data.toString().split('\n').forEach(line => {
                if (line.trim()) addLog(line.trim());
            });
        });
        mcProcess.on('close', () => { 
            serverState.status = 'offline'; 
            mcProcess = null; 
            serverState.startTime = null;
            resetPlayersOnlineStatus();
        });
        serverState.startTime = Date.now();
    }, 1000);
    res.json({ message: 'OK' });
});

app.post('/api/server/ban-ip', async (req, res) => {
    try {
        const { name, ip } = req.body || {};
        if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Falta el nombre del jugador' });
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const banIpPath = path.join(serverPath, 'banned-ips.json');
        const clientIp = (ip && typeof ip === 'string' && ip.includes('.') && ip !== '0.0.0.0') ? ip : null;

        await loadPlayerLastIp();
        const targetIp = clientIp || playerLastIp[name.toLowerCase()] || null;
        if (!targetIp) return res.status(400).json({ error: 'Servidor apagado o IP no encontrada. Necesitas la IP del jugador (que se haya conectado alguna vez).' });

        if (mcProcess) {
            mcProcess.stdin.write(`ban-ip ${targetIp}\n`);
            // Cacheamos la IP sospechosa inmediatamente para que la UI no parpadee
            banIpByName[name.toLowerCase()] = targetIp;
            saveBanIpCache();
            // Refrescamos después de un tiempo para confirmar lo que Minecraft escribió
            setTimeout(refreshAllPlayers, 2500);
            return res.json({ message: 'OK' });
        }


        let bans = await fs.pathExists(banIpPath) ? await fs.readJson(banIpPath).catch(() => []) : [];
        if (bans.some(b => (b.ip || '') === targetIp)) return res.json({ message: 'OK' });
        bans.push({
            ip: targetIp,
            created: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000',
            source: 'Server',
            expires: 'forever',
            reason: 'Banned by an operator.'
        });
        await fs.writeJson(banIpPath, bans, { spaces: 2 });
        banIpByName[name.toLowerCase()] = targetIp;
        saveBanIpCache();
        refreshAllPlayers();
        setTimeout(refreshAllPlayers, 500);
        res.json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/server/pardon-ip', async (req, res) => {
    try {
        const { name, ip } = req.body || {};
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const banIpPath = path.join(serverPath, 'banned-ips.json');
        let targetIp = ip;

        if (!targetIp && name) {
            if (name.includes('.')) targetIp = name;
            else {
                const player = serverState.players.find(p => p.name && p.name.toLowerCase() === name.toLowerCase());
                if (player && player.ip && player.ip.includes('.') && player.ip !== '0.0.0.0') targetIp = player.ip;
                if (!targetIp) { await loadPlayerLastIp(); targetIp = playerLastIp[name.toLowerCase()] || null; }
            }
            if (!targetIp && await fs.pathExists(banIpPath)) {
                const bans = await fs.readJson(banIpPath);
                const byName = bans.find(b => b.name && b.name.toLowerCase() === name.toLowerCase());
                if (byName && byName.ip) targetIp = byName.ip;
                else if (bans.length === 1 && bans[0].ip) targetIp = bans[0].ip;
            }
        }

        if (!targetIp || !targetIp.includes('.')) return res.status(400).json({ error: 'No se pudo resolver la IP' });

        if (mcProcess) {
            mcProcess.stdin.write(`pardon-ip ${targetIp}\n`);
            // Limpiar cache hoy mismo
            for (const k of Object.keys(banIpByName)) { if (banIpByName[k] === targetIp) delete banIpByName[k]; }
            if (name) delete banIpByName[name.toLowerCase()];
            saveBanIpCache();
            setTimeout(refreshAllPlayers, 2000);
            return res.json({ message: 'OK' });
        }

        if (await fs.pathExists(banIpPath)) {
            let bans = await fs.readJson(banIpPath);
            const before = bans.length;
            bans = bans.filter(b => (b.ip || '').toString() !== targetIp);
            if (bans.length < before) {
                await fs.writeJson(banIpPath, bans, { spaces: 2 });
                if (name) delete banIpByName[name.toLowerCase()];
                saveBanIpCache();
                refreshAllPlayers();
                setTimeout(refreshAllPlayers, 500);
                return res.json({ message: 'OK' });
            }
        }
        res.status(404).json({ error: 'IP no encontrada en la lista de baneos' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/server/ban', async (req, res) => {
    try {
        const { name } = req.body || {};
        if (!name) return res.status(400).json({ error: 'Falta el nombre' });
        
        if (mcProcess) {
            mcProcess.stdin.write(`ban ${name}\n`);
            setTimeout(refreshAllPlayers, 2000);
            return res.json({ message: 'OK' });
        }

        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const banPath = path.join(serverPath, 'banned-players.json');
        const cachePath = path.join(serverPath, 'usercache.json');

        // Intentar obtener UUID del cache
        let uuid = null;
        if (await fs.pathExists(cachePath)) {
            const cache = await fs.readJson(cachePath).catch(() => []);
            const entry = cache.find(c => c.name && c.name.toLowerCase() === name.toLowerCase());
            if (entry) uuid = entry.uuid;
        }

        if (!uuid) return res.status(400).json({ error: 'No se encontró el UUID del jugador. El servidor debe estar encendido o el jugador haber entrado antes.' });

        let bans = await fs.pathExists(banPath) ? await fs.readJson(banPath).catch(() => []) : [];
        if (bans.some(b => b.uuid === uuid)) return res.json({ message: 'OK' });

        bans.push({
            uuid: uuid,
            name: name,
            created: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000',
            source: 'Server',
            expires: 'forever',
            reason: 'Banned by an operator.'
        });

        await fs.writeJson(banPath, bans, { spaces: 2 });
        refreshAllPlayers();
        setTimeout(refreshAllPlayers, 500);
        res.json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/server/pardon', async (req, res) => {
    try {
        const { name } = req.body || {};
        if (!name) return res.status(400).json({ error: 'Falta el nombre' });

        if (mcProcess) {
            mcProcess.stdin.write(`pardon ${name}\n`);
            setTimeout(refreshAllPlayers, 2000);
            return res.json({ message: 'OK' });
        }

        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const banPath = path.join(serverPath, 'banned-players.json');

        if (await fs.pathExists(banPath)) {
            let bans = await fs.readJson(banPath);
            const before = bans.length;
            bans = bans.filter(b => b.name && b.name.toLowerCase() !== name.toLowerCase());
            if (bans.length < before) {
                await fs.writeJson(banPath, bans, { spaces: 2 });
                refreshAllPlayers();
                setTimeout(refreshAllPlayers, 500);
                return res.json({ message: 'OK' });
            }
        }
        res.status(404).json({ error: 'Jugador no encontrado en la lista de baneos' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/server/command', async (req, res) => {
    let command = req.body.command;
    
    // OFFLINE SUPPORT FOR BASIC OPERATIONS
    if (!mcProcess) {
        try {
            const serverPath = await getServerPathFromRequest(req);
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
            
            const handleList = async (cmdList, addAction, removeAction, file) => {
                const args = command.split(' ');
                if (cmdList.includes(args[0])) {
                    const isAdd = args[0] === addAction || (args[0] === cmdList[0] && args[1] === 'add');
                    const target = args[0] === 'op' || args[0] === 'deop' ? args[1] : args[2];
                    
                    if (target) {
                        const filePath = path.join(serverPath, file);
                        let list = await fs.pathExists(filePath) ? await fs.readJson(filePath).catch(()=>[]) : [];
                        const cachePath = path.join(serverPath, 'usercache.json');
                        let uuid = "Desconocido";
                        if (await fs.pathExists(cachePath)) {
                            const cache = await fs.readJson(cachePath).catch(()=>[]);
                            const entry = cache.find(c => c.name && c.name.toLowerCase() === target.toLowerCase());
                            if (entry) uuid = entry.uuid;
                        }
                        const before = list.length;
                        if (isAdd) {
                            if (!list.some(x => x.name && x.name.toLowerCase() === target.toLowerCase())) {
                                if (file === 'ops.json') list.push({ uuid, name: target, level: 4, bypassesPlayerLimit: false });
                                else list.push({ uuid, name: target });
                            }
                        } else {
                            list = list.filter(x => !(x.name && x.name.toLowerCase() === target.toLowerCase()));
                        }
                        
                        await fs.writeJson(filePath, list, { spaces: 2 });
                        setTimeout(refreshAllPlayers, 500);
                        return res.json({ message: 'OK' });
                    }
                }
                return false;
            };

            if (command.startsWith('whitelist ')) {
                if (await handleList(['whitelist'], 'add', 'remove', 'whitelist.json')) return;
            } else if (command.startsWith('op ') || command.startsWith('deop ')) {
                if (await handleList(['op', 'deop'], 'op', 'deop', 'ops.json')) return;
            }

            if (command.startsWith('gamerule ')) {
                const parts = command.split(' ');
                if (parts.length >= 3) {
                    gameruleCache[parts[1]] = parts[2];
                    return res.json({ message: 'OK (Cache actualizado offline)' });
                }
            }

            return res.status(400).json({ error: 'Apagado' });
        } catch(e) {
            return res.status(500).json({ error: e.message });
        }
    }

    if (command.startsWith('gamerule ')) {
        const parts = command.split(' ');
        if (parts.length >= 3) {
            gameruleCache[parts[1]] = parts[2];
        }
    }

    if (command.startsWith('pardon-ip ')) {
        const target = (command.split(' ')[1] || '').trim();
        if (target && !target.includes('.')) {
            try {
                const serverPath = await getServerPathFromRequest(req);
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
                const banIpPath = path.join(serverPath, 'banned-ips.json');
                let resolvedIp = null;

                if (await fs.pathExists(banIpPath)) {
                    const bans = await fs.readJson(banIpPath);
                    const byName = bans.find(b => b.name && b.name.toLowerCase() === target.toLowerCase());
                    if (byName && byName.ip) resolvedIp = byName.ip;
                }
                if (!resolvedIp) {
                    const player = serverState.players.find(p => p.name && p.name.toLowerCase() === target.toLowerCase());
                    if (player && player.ip && player.ip.includes('.') && player.ip !== '0.0.0.0') resolvedIp = player.ip;
                }
                if (!resolvedIp) {
                    await loadPlayerLastIp();
                    resolvedIp = playerLastIp[target.toLowerCase()] || null;
                }
                if (!resolvedIp) {
                    const cached = banIpByName[target.toLowerCase()];
                    if (cached && cached.includes('.')) resolvedIp = cached;
                }
                if (!resolvedIp && await fs.pathExists(banIpPath)) {
                    const bans = await fs.readJson(banIpPath);
                    if (bans.length === 1 && bans[0].ip) resolvedIp = bans[0].ip;
                }
                if (resolvedIp) command = `pardon-ip ${resolvedIp}`;
            } catch(e) {}
        }
    }

    // Reflejo inmediato en UI para OP/Whitelist (sin esperar al próximo escaneo)
    const parts = command.trim().split(/\s+/);
    const baseCmd = (parts[0] || '').toLowerCase();
    const arg1 = parts[1] || '';
    const arg2 = parts[2] || '';
    const touchPlayerFlag = (name, key, value) => {
        if (!name) return;
        const player = serverState.players.find(p => p.name && p.name.toLowerCase() === name.toLowerCase());
        if (player) player[key] = value;
    };
    if (baseCmd === 'op') touchPlayerFlag(arg1, 'op', true);
    if (baseCmd === 'deop') touchPlayerFlag(arg1, 'op', false);
    if (baseCmd === 'whitelist' && arg1.toLowerCase() === 'add') touchPlayerFlag(arg2, 'whitelisted', true);
    if (baseCmd === 'whitelist' && arg1.toLowerCase() === 'remove') touchPlayerFlag(arg2, 'whitelisted', false);

    mcProcess.stdin.write(command + '\n');
    setTimeout(refreshAllPlayers, 1000); 
    res.json({ message: 'Enviado' });
});

app.post('/api/server/properties', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const propPath = path.join(serverPath, 'server.properties');
        
        // Cargar existentes para no borrarlas si no están en el UI
        let existingProps = {};
        if (await fs.pathExists(propPath)) {
            const content = await fs.readFile(propPath, 'utf-8');
            content.split('\n').forEach(line => {
                if (line.trim() && !line.startsWith('#')) {
                    const [key, ...val] = line.split('=');
                    if (key) existingProps[key.trim()] = val.join('=').trim();
                }
            });
        }

        // Mergear con las que vienen del UI
        for (let [key, val] of Object.entries(req.body)) {
            const realKey = propMapping[key] || key;
            existingProps[realKey] = val;
        }

        let content = "# MC props\n";
        for (let [key, val] of Object.entries(existingProps)) {
            content += `${key}=${val}\n`;
        }
        await fs.writeFile(propPath, content);
        loadRealTimeMetadata();
        res.json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/server/properties', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const propPath = path.join(serverPath, 'server.properties');
        const content = await fs.readFile(propPath, 'utf-8');
        const props = {};
        content.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, ...val] = line.split('=');
                const uiKey = Object.keys(propMapping).find(k => propMapping[k] === key.trim()) || key.trim();
                props[uiKey] = val.join('=').trim();
            }
        });
        if (props['online-mode'] === undefined) props['online-mode'] = 'true';
        if (props['enforce-secure-profile'] === undefined) props['enforce-secure-profile'] = 'false';
        res.json(props);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/files', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.json([]);
        const subPath = (req.query.path || '/').replace(/^\//, '');
        const targetDir = path.normalize(path.join(serverPath, subPath));

        if (!(await fs.pathExists(targetDir))) {
            console.error(`[FILES] Dir not found: ${targetDir}`);
            return res.status(404).json({ error: 'Ruta no encontrada' });
        }

        const items = await fs.readdir(targetDir);
        const result = [];

        for (const item of items) {
            const fullPath = path.join(targetDir, item);
            let stats;
            try { stats = await fs.stat(fullPath); } catch(e) { continue; }
            
            let sizeStr = '-';
            if (!stats.isDirectory()) {
                const s = stats.size;
                if (s === 0) sizeStr = '0 B';
                else if (s < 1024) sizeStr = s + ' B';
                else if (s < 1024 * 1024) sizeStr = (s / 1024).toFixed(1) + ' KB';
                else if (s < 1024 * 1024 * 1024) sizeStr = (s / (1024 * 1024)).toFixed(1) + ' MB';
                else sizeStr = (s / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
            }

            result.push({
                name: item,
                type: stats.isDirectory() ? 'folder' : 'file',
                size: sizeStr,
                date: stats.mtime.toISOString().replace(/T/, ' ').substring(0, 16)
            });
        }
        res.json(result);
    } catch (e) { 
        console.error(`[FILES] Error listing path:`, e);
        res.status(500).json({ error: e.message }); 
    }
});

const { IncomingForm } = require('formidable');

app.post('/api/upload', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const subPath = (req.query.path || '/').replace(/^\//, '');
        const targetDir = path.join(serverPath, subPath);

        const form = new IncomingForm({ uploadDir: targetDir, keepExtensions: true, multiples: true });
        form.parse(req, async (err, fields, files) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const fileArray = Array.isArray(files.file) ? files.file : [files.file];
            for (const f of fileArray) {
                if (!f) continue;
                const newPath = path.join(targetDir, f.originalFilename);
                await fs.move(f.filepath, newPath, { overwrite: true });
            }
            res.json({ message: 'OK' });
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/files/download', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const subPath = (req.query.path || '').replace(/^\//, '');
        const targetFile = path.join(serverPath, subPath);

        if (!(await fs.pathExists(targetFile))) return res.status(404).json({ error: 'Archivo no encontrado' });
        res.download(targetFile);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/delete', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const { path: subPath } = req.body;
        const target = path.join(serverPath, (subPath || '').replace(/^\//, ''));

        if (!(await fs.pathExists(target))) return res.status(404).json({ error: 'No existe' });
        await fs.remove(target);
        res.json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/rename', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const { oldPath, newPath } = req.body;
        
        const oldTarget = path.join(serverPath, (oldPath || '').replace(/^\//, ''));
        const newTarget = path.join(serverPath, (newPath || '').replace(/^\//, ''));

        if (!(await fs.pathExists(oldTarget))) return res.status(404).json({ error: 'No existe' });
        await fs.move(oldTarget, newTarget);
        res.json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/create-folder', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const { path: subPath, name } = req.body;
        const target = path.join(serverPath, (subPath || '').replace(/^\//, ''), name);

        await fs.ensureDir(target);
        res.json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/files/content', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });

        const subPath = (req.query.path || '').replace(/^\//, '');
        const target = path.normalize(path.join(serverPath, subPath));

        if (!(await fs.pathExists(target))) {
            console.error(`[FILES-CONTENT] Not found: ${target}`);
            return res.status(404).json({ error: 'El archivo no existe en el disco' });
        }
        
        const stats = await fs.stat(target);
        if (stats.isDirectory()) return res.status(400).json({ error: 'No se puede editar una carpeta' });
        if (stats.size > 2 * 1024 * 1024) return res.status(400).json({ error: 'Archivo demasiado grande para el editor (máximo 2MB)' });

        const content = await fs.readFile(target, 'utf-8');
        res.json({ content });
    } catch (e) { 
        console.error(`[FILES-CONTENT] Error:`, e);
        res.status(500).json({ error: 'Error del sistema al leer: ' + e.message }); 
    }
});

app.post('/api/files/content', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const { path: subPath, content } = req.body;
        const target = path.join(serverPath, (subPath || '').replace(/^\//, ''));

        await fs.writeFile(target, content, 'utf-8');
        res.json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
//  BACKUP API
// ═══════════════════════════════════════════════════════════

app.post('/api/backups/create', async (req, res) => {
    try {
        const requestedId = getRequestedInstanceId(req);
        const instance = requestedId ? await getInstanceById(requestedId) : await getActiveInstance();
        if (!instance) return res.status(404).json({ error: 'Instancia no encontrada' });
        if (!await fs.pathExists(instance.path)) return res.status(404).json({ error: 'Carpeta del servidor no encontrada' });

        const { name, description } = req.body || {};
        const backup = await createBackup(instance.id, instance.path, { name, description });
        res.json({ message: 'OK', backup });
    } catch (e) {
        console.error('[BACKUP-CREATE]', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/backups/list', async (req, res) => {
    try {
        const requestedId = getRequestedInstanceId(req);
        const instance = requestedId ? await getInstanceById(requestedId) : await getActiveInstance();
        if (!instance) return res.json({ backups: [] });
        const backups = await listBackups(instance.id);
        res.json({ backups });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/backups/download/:id', async (req, res) => {
    try {
        const requestedId = getRequestedInstanceId(req);
        const instance = requestedId ? await getInstanceById(requestedId) : await getActiveInstance();
        if (!instance) return res.status(404).json({ error: 'Instancia no encontrada' });

        const backup = await getBackup(instance.id, req.params.id);
        if (!backup) return res.status(404).json({ error: 'Backup no encontrado' });
        if (!await fs.pathExists(backup.zipPath)) return res.status(404).json({ error: 'Archivo de backup no encontrado' });

        res.download(backup.zipPath, `${backup.name.replace(/[^a-zA-Z0-9_\- .]/g, '_')}.zip`);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/backups/restore/:id', async (req, res) => {
    try {
        const requestedId = getRequestedInstanceId(req);
        const instance = requestedId ? await getInstanceById(requestedId) : await getActiveInstance();
        if (!instance) return res.status(404).json({ error: 'Instancia no encontrada' });
        if (!await fs.pathExists(instance.path)) return res.status(404).json({ error: 'Carpeta del servidor no encontrada' });

        // Detener servidor si está encendido
        if (mcProcess) {
            console.log('[BACKUP-RESTORE] Deteniendo servidor antes de restaurar...');
            await stopProcessSync();
        }

        const result = await restoreBackupService(instance.id, req.params.id, instance.path);
        res.json({ message: 'Backup restaurado correctamente', autoBackup: result.autoBackup, restored: result.restored });
    } catch (e) {
        console.error('[BACKUP-RESTORE]', e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/backups/:id', async (req, res) => {
    try {
        const requestedId = getRequestedInstanceId(req);
        const instance = requestedId ? await getInstanceById(requestedId) : await getActiveInstance();
        if (!instance) return res.status(404).json({ error: 'Instancia no encontrada' });

        await deleteBackupService(instance.id, req.params.id);
        res.json({ message: 'Backup eliminado' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/backups/:id', async (req, res) => {
    try {
        const requestedId = getRequestedInstanceId(req);
        const instance = requestedId ? await getInstanceById(requestedId) : await getActiveInstance();
        if (!instance) return res.status(404).json({ error: 'Instancia no encontrada' });

        const { name, description } = req.body || {};
        const backup = await updateBackup(instance.id, req.params.id, { name, description });
        res.json({ message: 'OK', backup });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/backups/:id', async (req, res) => {
    try {
        const requestedId = getRequestedInstanceId(req);
        const instance = requestedId ? await getInstanceById(requestedId) : await getActiveInstance();
        if (!instance) return res.status(404).json({ error: 'Instancia no encontrada' });

        const backup = await getBackup(instance.id, req.params.id);
        if (!backup) return res.status(404).json({ error: 'Backup no encontrado' });
        res.json(backup);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
//  FILE MANAGER: Download folder as zip
// ═══════════════════════════════════════════════════════════

app.get('/api/files/download-folder', async (req, res) => {
    try {
        const serverPath = await getFirstServerPath();
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });
        const subPath = (req.query.path || '').replace(/^\//, '');
        const targetDir = path.join(serverPath, subPath);

        // Security: path traversal check
        const resolvedTarget = path.resolve(targetDir);
        const resolvedServer = path.resolve(serverPath);
        if (!resolvedTarget.startsWith(resolvedServer)) {
            return res.status(403).json({ error: 'Ruta no permitida' });
        }

        if (!await fs.pathExists(targetDir)) return res.status(404).json({ error: 'Carpeta no encontrada' });
        const stats = await fs.stat(targetDir);
        if (!stats.isDirectory()) return res.status(400).json({ error: 'No es una carpeta' });

        const folderName = path.basename(targetDir) || 'server';
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`);

        const archive = archiver('zip', { zlib: { level: 5 } });
        archive.on('error', (err) => res.status(500).json({ error: err.message }));
        archive.pipe(res);
        archive.directory(targetDir, folderName);
        archive.finalize();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
//  UPLOAD WORLD (zip import)
// ═══════════════════════════════════════════════════════════

app.post('/api/upload-world', async (req, res) => {
    try {
        const serverPath = await getServerPathFromRequest(req);
        if (!serverPath) return res.status(404).json({ error: 'Servidor no encontrado' });

        const { IncomingForm: WorldForm } = require('formidable');
        const tmpDir = path.join(config.PANEL_ROOT, 'data', 'tmp-uploads');
        await fs.ensureDir(tmpDir);

        const form = new WorldForm({
            uploadDir: tmpDir,
            keepExtensions: true,
            maxFileSize: 5 * 1024 * 1024 * 1024 // 5GB
        });

        form.parse(req, async (err, fields, files) => {
            if (err) return res.status(500).json({ error: err.message });

            const file = files.world ? (Array.isArray(files.world) ? files.world[0] : files.world) : null;
            if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

            const ext = path.extname(file.originalFilename || '').toLowerCase();
            if (ext !== '.zip') {
                await fs.remove(file.filepath).catch(() => {});
                return res.status(400).json({ error: 'Solo se aceptan archivos .zip' });
            }

            // Validate it's a Minecraft world
            const validation = await validateWorldZip(file.filepath);
            if (!validation.valid) {
                await fs.remove(file.filepath).catch(() => {});
                return res.status(400).json({ error: validation.reason });
            }

            // Extract to server path
            try {
                await extractZip(file.filepath, serverPath);
                await fs.remove(file.filepath).catch(() => {});
                res.json({ message: 'Mundo importado correctamente' });
            } catch (extractErr) {
                await fs.remove(file.filepath).catch(() => {});
                res.status(500).json({ error: 'Error al extraer: ' + extractErr.message });
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Iniciar caches y arrancar
(async () => {
    await ensureRegistryMigrated();
    await loadBanIpCache();
    await loadPlayerLastIp();
    await loadWorldName();
    await peekLogsForMetadata();
    app.listen(config.PORT, () => console.log(`[MARCTERNOS-API] Ready on ${config.PORT}`));
})();
