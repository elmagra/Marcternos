let selectedSoftware = 'Vanilla';
let pollInterval = null;

function normalizeSoftwareLabel(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('paper') || s.includes('spigot')) return 'Paper';
  if (s.includes('fabric')) return 'Fabric';
  if (s.includes('forge')) return 'Forge';
  return 'Vanilla';
}

function selectVersion(card) {
  document.querySelectorAll('.version-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedSoftware = card.dataset.software || normalizeSoftwareLabel(card.querySelector('.version-name')?.textContent || 'Vanilla');
  loadVersionsForSoftware(selectedSoftware);
}
window.selectVersion = selectVersion;

document.querySelectorAll('.version-card').forEach(card => {
  card.addEventListener('click', () => selectVersion(card));
});

const seedInput = document.getElementById('level-seed');
const randomSeedBtn = document.getElementById('btn-random-seed');
if (randomSeedBtn && seedInput) {
  randomSeedBtn.addEventListener('click', () => {
    const seed = Math.floor(Math.random() * 19999999999) - 9999999999;
    seedInput.value = seed;
  });
}

const btnCreate = document.getElementById('btnCreateWorld');
const progressBar = document.getElementById('inlineProgressBar');
const progressText = document.getElementById('inlinePercentage');
const logContainer = document.getElementById('inlineLog');

function renderVersionsInSelect(selectEl, versions, preferred) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const list = Array.isArray(versions) ? versions : [];
  if (list.length === 0) {
    const option = document.createElement('option');
    option.value = '1.20.1';
    option.textContent = '1.20.1';
    selectEl.appendChild(option);
    return;
  }
  list.forEach((v, idx) => {
    const option = document.createElement('option');
    option.value = v;
    option.textContent = idx === 0 ? `${v} (Última)` : v;
    if ((preferred && preferred === v) || (!preferred && idx === 0)) option.selected = true;
    selectEl.appendChild(option);
  });
}

async function loadVersionsForSoftware(software) {
  const select = document.getElementById('mc-version');
  if (!select) return;

  try {
    select.disabled = true;
    const res = await fetch(`/api/catalog/versions?software=${encodeURIComponent(software)}`);
    if (!res.ok) throw new Error('No se pudo cargar catálogo');
    const data = await res.json();
    renderVersionsInSelect(select, data.versions || [], select.value);
  } catch (e) {
    // fallback local
    const fallback = ['1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.16.5', '1.12.2'];
    renderVersionsInSelect(select, fallback, '1.20.1');
  } finally {
    select.disabled = false;
  }
}

async function loadSoftwareCatalog() {
  try {
    await fetch('/api/catalog/software');
  } catch (e) {
    // visual cards are already available as fallback
  }
  loadVersionsForSoftware(selectedSoftware);
}

btnCreate?.addEventListener('click', async () => {
  const levelName = (document.getElementById('level-name').value.trim()) || 'world';
  const levelSeed = seedInput ? seedInput.value.trim() : '';
  const levelType = document.getElementById('level-type').value;
  const mcVersion = document.getElementById('mc-version').value;
  const generateStructures = document.getElementById('generate-structures').checked;
  const bonusChest = document.getElementById('bonus-chest').checked;
  const maxWorldSize = document.getElementById('max-world-size').value;

  if (!/^[a-zA-Z0-9_\- ]+$/.test(levelName)) {
    alert('El nombre del mundo solo puede contener letras, números, guiones y guiones bajos.');
    return;
  }

  const data = {
    type: selectedSoftware,
    version: mcVersion,
    levelName,
    levelSeed,
    levelType,
    generateStructures,
    bonusChest,
    maxWorldSize
  };

  btnCreate.disabled = true;
  btnCreate.innerText = 'Instalando...';
  if (logContainer) logContainer.innerHTML = '<div class="log-entry"><span class="log-msg">Iniciando proceso de creación...</span></div>';
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.innerText = '0%';

  try {
    const res = await fetch('/api/create-world', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error en el servidor');
    }
    pollStatus();
  } catch (e) {
    btnCreate.disabled = false;
    btnCreate.innerText = 'Crear y Generar Mundo';
    if (logContainer) logContainer.innerHTML += `<div class="log-entry" style="color:#ef4444">[Error] ${e.message}</div>`;
  }
});

function pollStatus() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/creation-status');
      const data = await res.json();

      if (progressBar) progressBar.style.width = (data.progress || 0) + '%';
      if (progressText) progressText.innerText = Math.round(data.progress || 0) + '%';

      if (logContainer && Array.isArray(data.steps)) {
        logContainer.innerHTML = '';
        data.steps.forEach(step => {
          logContainer.innerHTML += `<div class="log-entry"><span class="log-time">${step.time}</span><span class="log-msg">${step.msg}</span></div>`;
        });
        logContainer.scrollTop = logContainer.scrollHeight;
      }

      if (data.status === 'done') {
        clearInterval(pollInterval);
        btnCreate.innerText = 'Listo';
        btnCreate.disabled = false;
        if (data.instanceId) localStorage.setItem('activeInstanceId', data.instanceId);
        setTimeout(() => {
          window.location.href = 'instances.html';
        }, 1200);
      } else if (data.status === 'error') {
        clearInterval(pollInterval);
        btnCreate.disabled = false;
        btnCreate.innerText = 'Reintentar';
      }
    } catch (e) {
      console.error('Error de polling:', e);
    }
  }, 900);
}

document.addEventListener('DOMContentLoaded', loadSoftwareCatalog);
