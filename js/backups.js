const $ = (id) => document.getElementById(id);

function getActiveInstanceId() {
  return localStorage.getItem('activeInstanceId') || '';
}

function withInstance(url) {
  const id = getActiveInstanceId();
  if (!id) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}instanceId=${encodeURIComponent(id)}`;
}

// ─── Toast ──────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `backup-toast ${type}`;
  const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-circle-xmark' : 'fa-circle-info';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${message}`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, 4000);
}

// ─── Modals ─────────────────────────────────────────────────────────────────

function openModal(id) {
  const modal = $(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = $(id);
  if (modal) modal.classList.remove('active');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('backup-modal-overlay') && e.target.classList.contains('active')) {
    e.target.classList.remove('active');
  }
});

// ─── State ──────────────────────────────────────────────────────────────────

let backupsList = [];
let pendingRestoreId = null;
let pendingDeleteId = null;
let pendingRenameId = null;
let serverStatus = 'offline';

// ─── API Calls ──────────────────────────────────────────────────────────────

async function fetchBackups() {
  try {
    const res = await fetch(withInstance('/api/backups/list'));
    if (!res.ok) throw new Error('Error cargando backups');
    const data = await res.json();
    backupsList = data.backups || [];
    renderBackups();
  } catch (e) {
    console.error('Error fetching backups:', e);
  }
}

async function createBackup(name, description) {
  const overlay = $('backupProgressOverlay');
  const progressText = $('backupProgressText');
  if (overlay) overlay.classList.add('active');
  if (progressText) progressText.textContent = 'Creando copia de seguridad...';

  try {
    const instanceId = getActiveInstanceId();
    const res = await fetch('/api/backups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId, name, description })
    });

    let data;
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      data = await res.json();
    } else {
      const text = await res.text();
      console.error("Error del servidor (No es JSON):", text);
      throw new Error(`Servidor no configurado (404). ¿Has reiniciado el servidor tras los cambios?`);
    }

    if (!res.ok) throw new Error(data.error || 'Error creando backup');
    showToast(`Backup "${data.backup.name}" creado correctamente`, 'success');
    await fetchBackups();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  } finally {
    if (overlay) overlay.classList.remove('active');
  }
}

async function deleteBackup(backupId) {
  try {
    const instanceId = getActiveInstanceId();
    const res = await fetch(`/api/backups/${encodeURIComponent(backupId)}?instanceId=${encodeURIComponent(instanceId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error eliminando');
    showToast('Backup eliminado correctamente', 'success');
    await fetchBackups();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

async function restoreBackup(backupId) {
  const overlay = $('backupProgressOverlay');
  const progressText = $('backupProgressText');
  if (overlay) overlay.classList.add('active');
  if (progressText) progressText.textContent = 'Restaurando backup... Esto puede tardar.';

  try {
    const instanceId = getActiveInstanceId();
    const res = await fetch(`/api/backups/restore/${encodeURIComponent(backupId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId })
    });

    let data;
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      data = await res.json();
    } else {
      const text = await res.text();
      throw new Error(`Respuesta del servidor no válida (${res.status})`);
    }

    if (!res.ok) throw new Error(data.error || 'Error restaurando');
    showToast('¡Backup restaurado correctamente!', 'success');
    if (data.autoBackup) {
      showToast(`Se creó un backup automático: ${data.autoBackup.name}`, 'info');
    }
    await fetchBackups();
  } catch (e) {
    showToast(`Error restaurando: ${e.message}`, 'error');
  } finally {
    if (overlay) overlay.classList.remove('active');
  }
}

async function renameBackup(backupId, name, description) {
  try {
    const instanceId = getActiveInstanceId();
    const res = await fetch(`/api/backups/${encodeURIComponent(backupId)}?instanceId=${encodeURIComponent(instanceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error renombrando');
    showToast('Backup actualizado', 'success');
    await fetchBackups();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

function downloadBackup(backupId) {
  const instanceId = getActiveInstanceId();
  const url = `/api/backups/download/${encodeURIComponent(backupId)}?instanceId=${encodeURIComponent(instanceId)}`;
  window.open(url, '_blank');
}

// ─── Render ─────────────────────────────────────────────────────────────────

function formatDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getStatusLabel(status) {
  switch (status) {
    case 'created': return '<span class="backup-status created"><i class="fa-solid fa-check"></i> Creado</span>';
    case 'restored': return '<span class="backup-status restored"><i class="fa-solid fa-rotate-left"></i> Restaurado</span>';
    case 'auto-pre-restore': return '<span class="backup-status auto-pre-restore"><i class="fa-solid fa-shield"></i> Auto</span>';
    case 'error': return '<span class="backup-status error"><i class="fa-solid fa-xmark"></i> Error</span>';
    default: return '<span class="backup-status created"><i class="fa-solid fa-check"></i> Creado</span>';
  }
}

function renderBackups() {
  const list = $('backupList');
  const countEl = $('backupCount');
  if (!list) return;

  if (countEl) {
    countEl.textContent = `${backupsList.length} copia${backupsList.length !== 1 ? 's' : ''} de seguridad`;
  }

  if (backupsList.length === 0) {
    list.innerHTML = `
      <div class="backup-empty">
        <i class="fa-solid fa-box-archive"></i>
        <h4>No hay backups aún</h4>
        <p>Crea tu primera copia de seguridad para proteger tu mundo de pérdidas accidentales.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = backupsList.map(b => `
    <div class="backup-card" data-id="${b.id}">
      <div class="backup-card-top">
        <div class="backup-card-info">
          <div class="backup-card-name">${escapeHtml(b.name)}</div>
          ${b.description ? `<div class="backup-card-desc">${escapeHtml(b.description)}</div>` : ''}
          <div class="backup-card-meta">
            <div class="backup-meta-item">
              <i class="fa-regular fa-calendar"></i> ${formatDate(b.createdAt)}
            </div>
            <div class="backup-meta-item">
              <i class="fa-solid fa-hard-drive"></i> ${b.sizeFormatted || '-'}
            </div>
            <div class="backup-meta-item">
              ${getStatusLabel(b.status)}
            </div>
          </div>
        </div>
        <div class="backup-card-actions">
          <button class="backup-action-btn download" title="Descargar" onclick="downloadBackup('${b.id}')">
            <i class="fa-solid fa-download"></i>
          </button>
          <button class="backup-action-btn restore" title="Restaurar" onclick="openRestoreModal('${b.id}')">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
          <button class="backup-action-btn rename" title="Renombrar" onclick="openRenameModal('${b.id}')">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="backup-action-btn" title="Detalles" onclick="openDetailsModal('${b.id}')">
            <i class="fa-solid fa-circle-info"></i>
          </button>
          <button class="backup-action-btn delete" title="Eliminar" onclick="openDeleteModal('${b.id}')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ─── Modal Openers ──────────────────────────────────────────────────────────

function openRestoreModal(backupId) {
  pendingRestoreId = backupId;
  const backup = backupsList.find(b => b.id === backupId);
  if (!backup) return;
  $('restoreBackupName').textContent = backup.name;
  const warning = $('restoreServerWarning');
  if (warning) warning.style.display = (serverStatus === 'online' || serverStatus === 'starting') ? 'block' : 'none';
  openModal('restoreBackupModal');
}

function openDeleteModal(backupId) {
  pendingDeleteId = backupId;
  const backup = backupsList.find(b => b.id === backupId);
  if (!backup) return;
  $('deleteBackupName').textContent = backup.name;
  openModal('deleteBackupModal');
}

function openRenameModal(backupId) {
  pendingRenameId = backupId;
  const backup = backupsList.find(b => b.id === backupId);
  if (!backup) return;
  $('renameInput').value = backup.name;
  $('renameDescInput').value = backup.description || '';
  openModal('renameBackupModal');
}

function openDetailsModal(backupId) {
  const backup = backupsList.find(b => b.id === backupId);
  if (!backup) return;
  const grid = $('backupDetailGrid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="backup-detail-row">
      <span class="backup-detail-label">ID</span>
      <span class="backup-detail-value">${backup.id}</span>
    </div>
    <div class="backup-detail-row">
      <span class="backup-detail-label">Nombre</span>
      <span class="backup-detail-value">${escapeHtml(backup.name)}</span>
    </div>
    <div class="backup-detail-row">
      <span class="backup-detail-label">Descripción</span>
      <span class="backup-detail-value">${escapeHtml(backup.description || 'Sin descripción')}</span>
    </div>
    <div class="backup-detail-row">
      <span class="backup-detail-label">Fecha de creación</span>
      <span class="backup-detail-value">${formatDate(backup.createdAt)}</span>
    </div>
    <div class="backup-detail-row">
      <span class="backup-detail-label">Tamaño</span>
      <span class="backup-detail-value">${backup.sizeFormatted || '-'}</span>
    </div>
    <div class="backup-detail-row">
      <span class="backup-detail-label">Estado</span>
      <span class="backup-detail-value">${getStatusLabel(backup.status)}</span>
    </div>
    <div class="backup-detail-row">
      <span class="backup-detail-label">Instancia</span>
      <span class="backup-detail-value">${backup.instanceId}</span>
    </div>
  `;
  openModal('detailsBackupModal');
}

// ─── Poll server status ────────────────────────────────────────────────────

async function pollStatus() {
  try {
    const res = await fetch(withInstance('/api/server/status'));
    if (!res.ok) return;
    const data = await res.json();
    serverStatus = data.status || 'offline';

    // Update world name
    const name = $('backupWorldName');
    if (name && data.worldName) name.textContent = data.worldName;
  } catch (e) {}
}

// ─── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Create backup
  $('createBackupBtn').onclick = () => {
    $('backupNameInput').value = '';
    $('backupDescInput').value = '';
    openModal('createBackupModal');
  };

  $('confirmCreateBtn').onclick = async () => {
    closeModal('createBackupModal');
    const name = $('backupNameInput').value.trim();
    const desc = $('backupDescInput').value.trim();
    await createBackup(name, desc);
  };

  // Restore
  $('confirmRestoreBtn').onclick = async () => {
    closeModal('restoreBackupModal');
    if (pendingRestoreId) {
      await restoreBackup(pendingRestoreId);
      pendingRestoreId = null;
    }
  };

  // Delete
  $('confirmDeleteBtn').onclick = async () => {
    closeModal('deleteBackupModal');
    if (pendingDeleteId) {
      await deleteBackup(pendingDeleteId);
      pendingDeleteId = null;
    }
  };

  // Rename
  $('confirmRenameBtn').onclick = async () => {
    closeModal('renameBackupModal');
    if (pendingRenameId) {
      const name = $('renameInput').value.trim();
      const desc = $('renameDescInput').value.trim();
      await renameBackup(pendingRenameId, name, desc);
      pendingRenameId = null;
    }
  };

  // Load data
  fetchBackups();
  pollStatus();
  setInterval(fetchBackups, 10000);
  setInterval(pollStatus, 5000);

  // Load server name
  fetch(withInstance('/api/current-server'))
    .then(r => r.json())
    .then(d => {
      if ($('backupWorldName') && d.name) $('backupWorldName').textContent = d.name;
    })
    .catch(() => {});
});
