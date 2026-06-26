const addons = [
    {
        id: 'lithium',
        name: 'Lithium',
        description: 'Optimización general del motor del servidor (física, IA, ticks). Indispensable para reducir el lag.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-bolt',
        slug: 'lithium'
    },
    {
        id: 'ferrite-core',
        name: 'FerriteCore',
        description: 'Reduce drásticamente el uso de memoria RAM optimizando el almacenamiento de modelos y datos.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-memory',
        slug: 'ferrite-core'
    },
    {
        id: 'modernfix',
        name: 'ModernFix',
        description: 'Arregla bugs del motor, acelera el tiempo de carga y optimiza el uso de memoria.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-wrench',
        slug: 'modernfix'
    },
    {
        id: 'starlight',
        name: 'Starlight',
        description: 'Reescribe el motor de iluminación para que sea increíblemente rápido. (No necesario en 1.20+)',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-sun',
        slug: 'starlight'
    },
    {
        id: 'krypton',
        name: 'Krypton',
        description: 'Optimiza la pila de red para reducir el uso de ancho de banda y mejorar el ping de los jugadores.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-network-wired',
        slug: 'krypton'
    },
    {
        id: 'alternate-current',
        name: 'Alternate Current',
        description: 'Reemplaza el algoritmo de Redstone por uno mucho más eficiente, evitando lag en granjas grandes.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-plug',
        slug: 'alternate-current'
    },
    {
        id: 'noisium',
        name: 'Noisium',
        description: 'Optimiza la generación de terreno (ruido) para que los mundos carguen más rápido al explorar.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-mountain',
        slug: 'noisium'
    },
    {
        id: 'memory-leak-fix',
        name: 'Memory Leak Fix',
        description: 'Arregla múltiples fugas de memoria en el servidor y el cliente.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-faucet',
        slug: 'memory-leak-fix'
    },
    {
        id: 'servercore',
        name: 'ServerCore',
        description: 'Paquete de optimizaciones integradas que permiten ajustar el rendimiento dinámicamente.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-microchip',
        slug: 'servercore'
    },
    {
        id: 'tabtps',
        name: 'TabTPS',
        description: 'Muestra el TPS y el rendimiento del servidor directamente en la lista de jugadores (TAB) y el action bar.',
        category: 'utility',
        type: 'both',
        icon: 'fa-chart-line',
        slug: 'tabtps'
    },
    {
        id: 'chunky',
        name: 'Chunky',
        description: 'Permite pre-generar trozos del mundo (chunks) para eliminar el lag al explorar.',
        category: 'utility',
        type: 'both',
        icon: 'fa-border-none',
        slug: 'chunky'
    },
    {
        id: 'clumps',
        name: 'Clumps',
        description: 'Agrupa los orbes de experiencia en un solo montón para evitar lag visual y de servidor.',
        category: 'optimization',
        type: 'mod',
        icon: 'fa-gem',
        slug: 'clumps'
    },
    {
        id: 'spark',
        name: 'Spark',
        description: 'Potente herramienta de perfilado para encontrar qué está causando lag en tu servidor.',
        category: 'utility',
        type: 'both',
        icon: 'fa-gauge-high',
        slug: 'spark'
    },
    {
        id: 'luckperms',
        name: 'LuckPerms',
        description: 'El mejor sistema de permisos y rangos. Indispensable para configurar grupos.',
        category: 'utility',
        type: 'both',
        icon: 'fa-shield-halved',
        slug: 'luckperms'
    },
    {
        id: 'carpet',
        name: 'Carpet Mod',
        description: 'Añade controles avanzados para técnicos, bots (jugadores falsos) y ajustes del motor.',
        category: 'utility',
        type: 'mod',
        icon: 'fa-scroll',
        slug: 'carpet'
    },
    {
        id: 'simple-voice-chat',
        name: 'Simple Voice Chat',
        description: 'Chat de voz de proximidad dentro del juego. Requiere que los jugadores lo tengan instalado.',
        category: 'utility',
        type: 'mod',
        icon: 'fa-microphone',
        slug: 'simple-voice-chat'
    },
    {
        id: 'tab',
        name: 'TAB',
        description: 'Personaliza la lista de jugadores (TAB), el prefijo/sufijo y el scoreboard.',
        category: 'utility',
        type: 'plugin', // TAB es principalmente un plugin
        icon: 'fa-table-list',
        slug: 'tab'
    }
];

let serverSoftware = 'Vanilla';
let serverVersion = '1.20.1';
let installedAddons = { mods: [], plugins: [] };

async function loadServerInfo() {
    try {
        const res = await fetch('/api/server/status');
        const data = await res.json();
        serverSoftware = data.software || 'Vanilla';
        let rawVersion = data.version || '1.20.1';
        if (rawVersion === '...') rawVersion = '1.20.1';
        
        // Limpiar versión: "1.20.1 (Estable)" -> "1.20.1"
        const match = rawVersion.match(/([0-9]+\.[0-9]+(\.[0-9]+)?)/);
        serverVersion = match ? match[1] : '1.20.1';
        
        await fetchInstalled();
        await fetchAllProjectData();
        displayAddons();
    } catch (e) {
        console.error('Error loading server info:', e);
        displayAddons();
    }
}

async function fetchInstalled() {
    try {
        const res = await fetch('/api/addons/installed');
        if (res.ok) installedAddons = await res.json();
    } catch (e) {}
}

// Cache para datos completos de los proyectos
const projectCache = {};

async function fetchAllProjectData() {
    const slugs = addons.map(a => a.slug);
    try {
        const res = await fetch(`https://api.modrinth.com/v2/projects?ids=${JSON.stringify(slugs)}`);
        if (!res.ok) return;
        const projects = await res.json();
        projects.forEach(p => {
            projectCache[p.slug || p.id] = p;
        });
    } catch (e) {
        console.error('Error fetching bulk project data:', e);
    }
}

function displayAddons(filterVal = 'all') {
    const grid = document.getElementById('addonsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const isPluginServer = ['Paper', 'Spigot', 'Purpur', 'Mohist'].includes(serverSoftware);
    const isModServer = ['Fabric', 'Forge', 'Mohist', 'Quilt'].includes(serverSoftware);
    const loader = isModServer ? (serverSoftware.toLowerCase() === 'fabric' ? 'fabric' : 'forge') : 'paper';

    // Ocultar botones irrelevantes
    const modBtn = document.querySelector('[data-filter="mod"]');
    const pluginBtn = document.querySelector('[data-filter="plugin"]');
    if (modBtn) modBtn.style.display = isModServer ? 'block' : 'none';
    if (pluginBtn) pluginBtn.style.display = isPluginServer ? 'block' : 'none';

    const filtered = addons.filter(a => {
        let shouldShowByType = false;
        if (a.type === 'both') shouldShowByType = isPluginServer || isModServer;
        else if (a.type === 'mod') shouldShowByType = isModServer;
        else if (a.type === 'plugin') shouldShowByType = isPluginServer;

        if (!shouldShowByType) return false;

        if (filterVal === 'all') return true;
        if (filterVal === 'optimization') return a.category === 'optimization';
        if (filterVal === 'utility') return a.category === 'utility';
        if (filterVal === 'mod') return a.type === 'mod' || a.type === 'both';
        if (filterVal === 'plugin') return a.type === 'plugin' || a.type === 'both';
        return true;
    });

    filtered.forEach(addon => {
        const pData = projectCache[addon.slug];
        let typeToShow = addon.type;
        if (addon.type === 'both') {
            typeToShow = isPluginServer ? 'plugin' : 'mod';
        }

        const canInstallByType = (typeToShow === 'plugin' && isPluginServer) || (typeToShow === 'mod' && isModServer);
        
        // --- DETECCIÓN MEJORADA ---
        const targetList = typeToShow === 'plugin' ? installedAddons.plugins : installedAddons.mods;
        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const isInstalled = targetList.some(filename => {
            const normalizedFile = normalize(filename);
            const normalizedSlug = normalize(addon.slug);
            const normalizedName = normalize(addon.name);
            return normalizedFile.includes(normalizedSlug) || normalizedFile.includes(normalizedName);
        });

        let versionError = '';
        if (pData) {
            const supportsVersion = pData.game_versions.includes(serverVersion);
            const supportsLoader = pData.loaders.includes(loader);
            
            if (!supportsVersion && !supportsLoader) {
                versionError = `No compatible con ${serverVersion} ni con ${serverSoftware}`;
            } else if (!supportsVersion) {
                versionError = `No disponible para la versión ${serverVersion}`;
            } else if (!supportsLoader) {
                versionError = `Para este software necesitas la versión ${loader === 'fabric' ? 'Forge' : 'Fabric'}`;
            }
        }

        const canInstall = canInstallByType && !versionError && !isInstalled;

        const card = document.createElement('div');
        card.className = 'addon-card' + (isInstalled ? ' is-installed' : '');
        card.dataset.id = addon.id;
        card.innerHTML = `
            ${isInstalled ? '<div class="installed-badge"><i class="fa-solid fa-check"></i> Instalado</div>' : ''}
            <div class="addon-header">
                <div class="addon-icon" id="icon-${addon.id}">
                    ${pData && pData.icon_url ? `<img src="${pData.icon_url}" alt="icono">` : `<i class="fa-solid ${addon.icon}"></i>`}
                </div>
                <div class="addon-info">
                    <span class="addon-tag">${addon.category}</span>
                    <span class="addon-name">${addon.name}</span>
                </div>
            </div>
            <p class="addon-description">${addon.description}</p>
            ${versionError ? `<div class="incompatibility-notice"><i class="fa-solid fa-triangle-exclamation"></i> <span>${versionError}</span></div>` : ''}
            <div class="addon-footer">
                <div class="addon-type">
                    ${addon.type === 'mod' || addon.type === 'both' ? '<span class="type-badge badge-mod">Mod</span>' : ''}
                    ${addon.type === 'plugin' || addon.type === 'both' ? '<span class="type-badge badge-plugin">Plugin</span>' : ''}
                </div>
                ${isInstalled ? 
                    `<button class="btn-delete" id="del-${addon.id}"><i class="fa-solid fa-trash-can"></i> Desinstalar</button>` :
                    `<button class="btn-install" id="btn-${addon.id}" ${!canInstall ? `disabled title="${versionError || 'No compatible'}"` : ''}>
                        <i class="fa-solid fa-cloud-arrow-down"></i> Instalar
                    </button>`
                }
            </div>
        `;
        
        grid.appendChild(card);

        if (isInstalled) {
            const delBtn = card.querySelector(`#del-${addon.id}`);
            delBtn.onclick = () => removeAddon(addon, typeToShow);
        } else if (canInstall) {
            const btn = card.querySelector(`#btn-${addon.id}`);
            btn.onclick = () => installAddon(addon, typeToShow);
        }
    });
}

// Cache para iconos se puede eliminar o dejar vacío si no se usa más
const iconCache = {};

function showToast(msg, icon = 'fa-check') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

async function installAddon(addon, type) {
    const btn = document.getElementById(`btn-${addon.id}`);
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Instalando...';

    try {
        // 1. Obtener URL de Modrinth (Codificando parámetros)
        const loader = type === 'mod' ? (serverSoftware.toLowerCase() === 'fabric' ? 'fabric' : 'forge') : 'paper';
        const params = new URLSearchParams({
            loaders: JSON.stringify([loader]),
            game_versions: JSON.stringify([serverVersion])
        });

        const modrinthRes = await fetch(`https://api.modrinth.com/v2/project/${addon.slug}/version?${params.toString()}`);
        
        if (!modrinthRes.ok) throw new Error('No se encontró versión compatible en Modrinth');
        
        let versions;
        try {
            versions = await modrinthRes.json();
        } catch (je) {
            throw new Error('Error al leer datos de Modrinth');
        }

        if (!versions || versions.length === 0) throw new Error(`No hay versiones para ${serverVersion} con ${loader}`);

        const bestVersion = versions[0]; // La más reciente
        const file = bestVersion.files.find(f => f.primary) || bestVersion.files[0];
        
        // 2. Enviar al backend para descargar
        const res = await fetch('/api/addons/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: file.url,
                name: file.filename,
                type: type
            })
        });

        if (!res.ok) {
            let errorMsg = 'Error en el servidor';
            try {
                const errData = await res.json();
                errorMsg = errData.error || errorMsg;
            } catch (e) {
                // Not JSON? maybe HTML error
            }
            throw new Error(errorMsg);
        }

        showToast(`${addon.name} instalado en /${type === 'mod' ? 'mods' : 'plugins'}`);
        await fetchInstalled();
        displayAddons();

    } catch (e) {
        showToast(e.message, 'fa-circle-xmark');
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function removeAddon(addon, type) {
    const btn = document.getElementById(`del-${addon.id}`);
    const originalContent = btn.innerHTML;
    
    if (!confirm(`¿Estás seguro de que quieres eliminar ${addon.name}?`)) return;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Borrando...';
    
    try {
        // Necesitamos encontrar el nombre exacto del archivo instalado
        const targetList = type === 'plugin' ? installedAddons.plugins : installedAddons.mods;
        const filename = targetList.find(name => name.toLowerCase().includes(addon.slug.toLowerCase()));
        
        if (!filename) throw new Error('No se pudo encontrar el archivo del addon');
        
        const res = await fetch('/api/addons/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: filename, type: type })
        });
        
        if (!res.ok) throw new Error('Error al eliminar');
        
        showToast(`${addon.name} eliminado.`);
        await fetchInstalled();
        displayAddons();
    } catch (e) {
        showToast(e.message, 'fa-triangle-exclamation');
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

// Event Listeners para filtros
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        displayAddons(btn.dataset.filter);
    };
});

window.onload = loadServerInfo;
setInterval(loadServerInfo, 10000);

