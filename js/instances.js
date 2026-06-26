function el(id) { return document.getElementById(id); }
let lastInstancesHash = '';
let cachedInstances = [];
let runningInstanceId = null;
let armedDeleteId = null;
let armedDeleteTimer = null;

// Mapa para mantener el tiempo de inicio de cada instancia activa
const instanceUptimeStarts = {};

function buildInstanceIconUrl(instanceId, iconRev = 0) {
  return `/api/server/icon?instanceId=${encodeURIComponent(instanceId)}&rev=${encodeURIComponent(iconRev || 0)}`;
}

function formatSoftwareVersion(instance) {
  const software = String(instance.software || 'Vanilla').trim() || 'Vanilla';
  const version = String(instance.version || '').trim();
  return version ? `${software} · ${version}` : `${software}`;
}

function formatUptime(ms) {
  if (!ms || ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isAnotherInstanceRunning(targetId) {
  return runningInstanceId && runningInstanceId !== targetId;
}

function showRunningConflictAlert() {
  alert('Hay un servidor en ejecución. Apágalo antes de cambiar de instancia o iniciar otro mundo.');
}

async function selectInstance(instanceId) {
  if (isAnotherInstanceRunning(instanceId)) {
    showRunningConflictAlert();
    return false;
  }
  localStorage.setItem('activeInstanceId', instanceId);
  const res = await fetch('/api/instances/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId })
  }).catch(() => null);
  if (res && res.status === 409) {
    showRunningConflictAlert();
    return false;
  }
  return true;
}

async function doAction(ev, instanceId, endpoint) {
  ev.stopPropagation();
  if (endpoint.includes('/start') && isAnotherInstanceRunning(instanceId)) {
    showRunningConflictAlert();
    return;
  }
  const btn = ev.currentTarget;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  btn.disabled = true;
  
  const ok = await selectInstance(instanceId);
  if (!ok) {
    btn.innerHTML = oldText;
    btn.disabled = false;
    return;
  }
  const res = await fetch(`${endpoint}?instanceId=${encodeURIComponent(instanceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId })
  }).catch(() => null);
  if (res && !res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.error) alert(data.error);
  }
  
  setTimeout(() => {
    btn.innerHTML = oldText;
    btn.disabled = false;
    loadInstances();
  }, 1000);
}

async function openWorldPanel(instanceId) {
  if (isAnotherInstanceRunning(instanceId)) {
    showRunningConflictAlert();
    return;
  }
  const ok = await selectInstance(instanceId);
  if (!ok) return;
  window.location.href = 'index.html';
}

async function deleteInstance(instanceId) {
  const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' }).catch(() => null);
  if (!res || !res.ok) {
    alert('No se pudo borrar este mundo. Si hay un servidor encendido, apágalo primero.');
    return;
  }
  const current = localStorage.getItem('activeInstanceId');
  if (current === instanceId) localStorage.removeItem('activeInstanceId');
  lastInstancesHash = ''; // Forzar recarga
  loadInstances();
  renderDeleteWorldsList();
}

function getStatusInfo(status) {
  if (status === 'online') return { class: 'online', text: 'En línea', icon: 'fa-check-circle', color: '#22c55e' };
  if (status === 'starting') return { class: 'starting', text: 'Iniciando', icon: 'fa-spinner fa-spin', color: '#eab308' };
  return { class: 'offline', text: 'Apagado', icon: 'fa-power-off', color: '#ef4444' };
}

function renderInstanceCard(instance, activeId) {
  const card = document.createElement('div');
  const sInfo = getStatusInfo(instance.status);
  const isOnline = instance.status === 'online' || instance.status === 'starting';
  const blockedByOther = isAnotherInstanceRunning(instance.id);
  
  card.className = `instance-card ${sInfo.class} ${instance.id === activeId ? 'active' : ''} ${blockedByOther ? 'instance-blocked' : ''}`;
  card.onclick = () => {
    if (blockedByOther) {
      showRunningConflictAlert();
      return;
    }
    openWorldPanel(instance.id);
  };
  card.dataset.id = instance.id;

  const maxPlayers = instance.maxPlayers || 20;
  const playersOnline = instance.playersOnline || 0;
  
  card.innerHTML = `
    <div class="instance-header">
      <div class="instance-icon-wrap">
        <img class="instance-icon" data-instance-id="${instance.id}" src="${buildInstanceIconUrl(instance.id, instance.iconRev || 0)}" alt="icono" onerror="this.src='resources/icono.png'" />
        ${instance.id === activeId ? '<div class="active-badge"><i class="fa-solid fa-star"></i></div>' : ''}
      </div>
      <div class="instance-title-wrap">
        <h4 class="instance-title">${instance.name}</h4>
        <span class="status-badge" style="color: ${sInfo.color}; background: ${sInfo.color}15; border: 1px solid ${sInfo.color}30;">
          <i class="fa-solid ${sInfo.icon}"></i> ${sInfo.text}
        </span>
      </div>
    </div>

    <div class="instance-stats">
      <div class="stat-pill">
        <div class="stat-icon"><i class="fa-solid fa-clock"></i></div>
        <div class="stat-info">
          <div class="stat-label">Tiempo abierto</div>
          <div class="stat-value uptime-value" data-id="${instance.id}">${isOnline ? formatUptime(instance.uptimeMs || 0) : '00:00:00'}</div>
        </div>
      </div>
      
      <div class="stat-pill">
        <div class="stat-icon"><i class="fa-solid fa-users"></i></div>
        <div class="stat-info">
          <div class="stat-label">Jugadores</div>
          <div class="stat-value">${isOnline ? playersOnline + ' / ' + maxPlayers : '0 / ?'}</div>
        </div>
      </div>

      <div class="stat-pill">
        <div class="stat-icon"><i class="fa-solid fa-cube"></i></div>
        <div class="stat-info">
          <div class="stat-label">Versión</div>
          <div class="stat-value">${instance.version && instance.version !== '...' ? instance.version : 'Desconocida'}</div>
        </div>
      </div>

      <div class="stat-pill">
        <div class="stat-icon"><i class="fa-solid fa-microchip"></i></div>
        <div class="stat-info">
          <div class="stat-label">Software</div>
          <div class="stat-value">${instance.software || 'Vanilla'}</div>
        </div>
      </div>
    </div>

    <div class="instance-actions">
      <button class="action-btn primary" title="Abrir Panel" onclick="event.stopPropagation(); openWorldPanel('${instance.id}')">
        <i class="fa-solid fa-gauge-high"></i> Abrir Panel
      </button>
      ${instance.status === 'offline' 
        ? `<button class="action-btn success" title="Iniciar" ${blockedByOther ? 'disabled' : ''} onclick="doAction(event, '${instance.id}', '/api/server/start')"><i class="fa-solid fa-play"></i></button>`
        : `<button class="action-btn danger" title="Detener" onclick="doAction(event, '${instance.id}', '/api/server/stop')"><i class="fa-solid fa-stop"></i></button>
           <button class="action-btn warning" title="Reiniciar" onclick="doAction(event, '${instance.id}', '/api/server/restart')"><i class="fa-solid fa-rotate-right"></i></button>`
      }
    </div>
  `;

  return card;
}

// ─── Modal de Borrado ───────────────────────────────────────────────────────

function openDeleteWorldsModal() {
  const modal = el('deleteWorldsModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  renderDeleteWorldsList();
}

function closeDeleteWorldsModal() {
  const modal = el('deleteWorldsModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function renderDeleteWorldsList() {
  const list = el('deleteWorldsList');
  if (!list) return;
  list.innerHTML = '';
  if (!cachedInstances.length) {
    list.innerHTML = '<div class="small-text">No hay mundos para borrar.</div>';
    return;
  }

  cachedInstances.forEach((instance) => {
    const row = document.createElement('div');
    row.className = 'delete-world-row';
    const version = String(instance.version || '').trim();
    const versionText = version ? `${instance.software || 'Vanilla'} ${version}` : `${instance.software || 'Vanilla'}`;
    const armed = armedDeleteId === instance.id;
    row.innerHTML = `
      <div class="delete-world-meta">
        <div class="delete-world-name">${instance.name}</div>
        <div class="delete-world-sub">${versionText}</div>
      </div>
      <button class="btn danger">${armed ? 'Confirmar borrado' : 'Borrar'}</button>
    `;
    row.querySelector('button').onclick = async () => {
      if (armedDeleteId !== instance.id) {
        armedDeleteId = instance.id;
        if (armedDeleteTimer) clearTimeout(armedDeleteTimer);
        armedDeleteTimer = setTimeout(() => {
          armedDeleteId = null;
          renderDeleteWorldsList();
        }, 5000);
        renderDeleteWorldsList();
        return;
      }
      armedDeleteId = null;
      if (armedDeleteTimer) clearTimeout(armedDeleteTimer);
      await deleteInstance(instance.id);
    };
    list.appendChild(row);
  });
}

// ─── Carga y Refresco ───────────────────────────────────────────────────────

async function loadInstances() {
  const grid = el('instancesGrid');
  if (!grid) return;

  if (!grid.dataset.loaded) {
    grid.innerHTML = '<div class="small-text">Cargando instancias...</div>';
  }
  const instRes = await fetch('/api/instances').catch(() => null);

  if (!instRes || !instRes.ok) {
    grid.innerHTML = '<div class="small-text" style="color: #ef4444;">Error al cargar las instancias. Inténtalo de nuevo.</div>';
    return;
  }

  const instData = await instRes.json();
  runningInstanceId = instData.runningInstanceId || null;
  const instances = instData.instances || [];
  cachedInstances = instances.slice();
  const activeId = localStorage.getItem('activeInstanceId') || instData.activeInstanceId || null;
  
  const hash = JSON.stringify({
    activeId,
    instances: instances.map(i => ({
      id: i.id,
      status: i.status,
      playersOnline: i.playersOnline,
      maxPlayers: i.maxPlayers,
      version: i.version,
      software: i.software,
      iconRev: i.iconRev || 0
    }))
  });

  // Guardar los tiempos base para el contador local de uptime
  instances.forEach(inst => {
    if (inst.status === 'online') {
      if (!instanceUptimeStarts[inst.id]) {
        instanceUptimeStarts[inst.id] = Date.now() - (inst.uptimeMs || 0);
      }
    } else {
      delete instanceUptimeStarts[inst.id];
    }
  });

  if (hash === lastInstancesHash) return; // No hay cambios visuales fuertes
  lastInstancesHash = hash;

  grid.innerHTML = '';
  grid.dataset.loaded = '1';
  if (instances.length === 0) {
    grid.innerHTML = `
      <div class="empty-instances">
        <i class="fa-solid fa-server empty-icon"></i>
        <h3>No tienes ninguna instancia</h3>
        <p>Crea tu primer mundo de Minecraft para empezar a jugar.</p>
        <a class="btn primary mt-3" href="create-world.html"><i class="fa-solid fa-plus"></i> Crear mundo</a>
      </div>
    `;
    return;
  }

  instances.forEach(i => grid.appendChild(renderInstanceCard(i, activeId)));
}

// ─── Contador local de Uptime ────────────────────────────────────────────────

function tickUptimes() {
  Object.keys(instanceUptimeStarts).forEach(id => {
    const el = document.querySelector(`.uptime-value[data-id="${id}"]`);
    if (el) {
      const elapsed = Date.now() - instanceUptimeStarts[id];
      el.textContent = formatUptime(elapsed);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = el('refreshInstancesBtn');
  if (btn) btn.onclick = loadInstances;
  const openDeleteBtn = el('openDeleteWorldsBtn');
  if (openDeleteBtn) openDeleteBtn.onclick = openDeleteWorldsModal;
  const closeDeleteBtn = el('closeDeleteWorldsBtn');
  if (closeDeleteBtn) closeDeleteBtn.onclick = closeDeleteWorldsModal;
  const modal = el('deleteWorldsModal');
  if (modal) {
    modal.onclick = (ev) => {
      if (ev.target === modal) closeDeleteWorldsModal();
    };
  }
  
  loadInstances();
  setInterval(loadInstances, 3000);
  setInterval(tickUptimes, 1000); // Actualiza el timer cada segundo suavemente
});
