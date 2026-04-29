const path = require('path');

module.exports = {
    PORT: process.env.PORT || 3000,
    MULTI_INSTANCE_ENABLED: String(process.env.MULTI_INSTANCE_ENABLED || 'true').toLowerCase() === 'true',
    DYNAMIC_CATALOG_ENABLED: String(process.env.DYNAMIC_CATALOG_ENABLED || 'true').toLowerCase() === 'true',
    SERVERS_ROOT: process.env.SERVERS_ROOT || path.join(__dirname, '../../data/servers'),
    INSTANCE_REGISTRY_PATH: process.env.INSTANCE_REGISTRY_PATH || path.join(__dirname, '../../data/instances/registry.json'),
    DEFAULT_INSTANCE_ID: process.env.DEFAULT_INSTANCE_ID || 'default',
    PUBLIC_HOST: process.env.PUBLIC_HOST || '',
    PUBLIC_PORT: process.env.PUBLIC_PORT || '',
    MC_PUBLIC_PORT: process.env.MC_PUBLIC_PORT || '25565',
    TAILSCALE_IP: process.env.TAILSCALE_IP || '',
    PANEL_ROOT: process.env.PANEL_ROOT || path.join(__dirname, '../../'),
    JAVA_PATH: process.env.JAVA_PATH || 'java',
    JAVA_ARGS: process.env.JAVA_ARGS || '-XX:MaxRAMPercentage=90.0 -XX:+UseG1GC'
};
