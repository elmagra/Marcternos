function el(id) { return document.getElementById(id); }
let lastInstancesHash = '';
let cachedInstances = [];
let armedDeleteId = null;
let armedDeleteTimer = null;

function buildInstanceIconUrl(instanceId, iconRev = 0) {
  return `/api/server/icon?instanceId=${encodeURIComponent(instanceId)}&rev=${encodeURIComponent(iconRev || 0)}`;
}

function formatSoftwareVersion(instance) {
  const software = String(instance.software || 'Vanilla').trim() || 'Vanilla';
  const version = String(instance.version || '').trim();
  return version ? `${software} · ${version}` : `${software} · versión sin detectar`;
}

function formatUptime(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function selectInstance(instanceId) {
  localStorage.setItem('activeInstanceId', instanceId);
  await fetch('/api/instances/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId })
  }).catch(() => {});
}

async function doAction(instanceId, endpoint) {
  await selectInstance(instanceId);
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId })
  }).catch(() => {});
  setTimeout(loadInstances, 700);
}

async function openWorldPanel(instanceId) {
  await selectInstance(instanceId);
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
  loadInstances();
  renderDeleteWorldsList();
}

function getStatusClass(status) {
  if (status === 'online') return 'online';
  if (status === 'starting') return 'starting';
  return 'offline';
}

function renderInstanceCard(instance, activeId) {
  const card = document.createElement('div');
  const statusClass = getStatusClass(instance.status);
  const onlineCard = statusClass === 'online' || statusClass === 'starting';
  card.className = `instance-card ${onlineCard ? 'online' : 'offline'}${instance.id === activeId ? ' active' : ''}`;
  card.onclick = () => openWorldPanel(instance.id);

  card.innerHTML = `
    <div class="instance-header">
      <img class="instance-icon" data-instance-id="${instance.id}" src="${buildInstanceIconUrl(instance.id, instance.iconRev || 0)}" alt="icono" onerror="this.src='resources/icono.png'" />
      <div class="instance-title-wrap">
        <h4 class="instance-title">${instance.name}</h4>
        <p class="instance-version">${formatSoftwareVersion(instance)}</p>
      </div>
      <div class="instance-status">
        <span class="status-dot-small ${statusClass}"></span>
        <span>${instance.status || 'offline'}</span>
      </div>
    </div>

    <div class="instance-stats">
      <div class="stat-pill">
        <div class="stat-label">Jugando ahora</div>
        <div class="stat-value">${instance.playersOnline || 0}</div>
      </div>
      <div class="stat-pill">
        <div class="stat-label">Tiempo abierto</div>
        <div class="stat-value">${formatUptime(instance.uptimeMs || 0)}</div>
      </div>
    </div>

    <div class="instance-actions">
      <button class="btn danger" data-action="stop">Stop</button>
    </div>
  `;

  card.querySelector('[data-action="stop"]').onclick = (ev) => {
    ev.stopPropagation();
    doAction(instance.id, '/api/server/stop');
  };

  return card;
}

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

async function loadInstances() {
  const grid = el('instancesGrid');
  if (!grid) return;

  if (!grid.dataset.loaded) {
    grid.innerHTML = '<div class="small-text">Cargando...</div>';
  }
  const instRes = await fetch('/api/instances').catch(() => null);

  if (!instRes || !instRes.ok) {
    grid.innerHTML = '<div class="small-text">No se pudieron cargar las instancias.</div>';
    return;
  }

  const instData = await instRes.json();
  const instances = instData.instances || [];
  cachedInstances = instances.slice();
  const activeId = localStorage.getItem('activeInstanceId') || instData.activeInstanceId || null;
  const hash = JSON.stringify({
    activeId,
    instances: instances.map(i => ({
      id: i.id,
      status: i.status,
      playersOnline: i.playersOnline,
      version: i.version,
      software: i.software,
      iconRev: i.iconRev || 0
    }))
  });

  if (hash === lastInstancesHash) return;
  lastInstancesHash = hash;

  grid.innerHTML = '';
  grid.dataset.loaded = '1';
  if (instances.length === 0) {
    grid.innerHTML = '<div class="small-text">No hay instancias. Crea la primera con "Nueva instancia".</div>';
    return;
  }

  instances.forEach(i => grid.appendChild(renderInstanceCard(i, activeId)));
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
});
