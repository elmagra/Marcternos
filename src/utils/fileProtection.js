const PROTECTED_ROOT_ENTRIES = new Set([
    'server.jar',
    'eula.txt',
    'server.properties',
    'server-icon.png',
    'ops.json',
    'whitelist.json',
    'banned-players.json',
    'banned-ips.json',
    'usercache.json',
    'bukkit.yml',
    'spigot.yml',
    'paper.yml',
    'paper-global.yml',
    'paper-world-defaults.yml',
    'commands.yml',
    'help.yml',
    'permissions.yml',
    'logs',
    'libraries',
    'versions',
    'cache',
    'crash-reports',
    'world',
    'world_nether',
    'world_the_end',
    '.creating',
]);

const PROTECTED_ROOT_FOLDERS = [
    'logs',
    'libraries',
    'versions',
    'cache',
    'crash-reports',
    'world',
    'world_nether',
    'world_the_end',
];

const USER_MANAGED_DIRS = ['mods', 'plugins', 'config'];

function normalizeRelativePath(relativePath) {
    return (relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function isPathProtected(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) return true;

    const segments = normalized.split('/').filter(Boolean);
    const topDir = segments[0].toLowerCase();

    if (USER_MANAGED_DIRS.includes(topDir)) return false;

    if (segments.length === 1) {
        return PROTECTED_ROOT_ENTRIES.has(segments[0].toLowerCase());
    }

    return PROTECTED_ROOT_FOLDERS.includes(topDir);
}

module.exports = {
    PROTECTED_ROOT_ENTRIES,
    PROTECTED_ROOT_FOLDERS,
    USER_MANAGED_DIRS,
    isPathProtected,
};
