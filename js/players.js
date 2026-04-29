function $(id) {
  return document.getElementById(id);
}

function withInstance(url) {
  const id = localStorage.getItem('activeInstanceId') || '';
  if (!id) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}instanceId=${encodeURIComponent(id)}`;
}

function getAvatarUrl(name) {
  return 'https://mc-heads.net/avatar/' + encodeURIComponent(name) + '/96';
}

function renderBadge(text, type) {
  return "<span class='mini-status " + type + "'>" + text + '</span>';
}

let activeFilter = 'all';
let allCachedPlayers = [];
let lastPlayersHash = '';

async function fetchAndRenderPlayers() {
  const grid = $('playersGrid');
  if (!grid) return;

  try {
    const res = await fetch(withInstance('/api/server/status'));
    const data = await res.json();
    const players = data.players || [];

    const currentHash = JSON.stringify(players.map((p) => ({
      n: p.name,
      o: p.online,
      op: !!p.op,
      wl: !!p.whitelisted,
      bIp: !!p.bannedIp,
      bUuid: !!p.bannedUuid,
      l: p.location,
      d: p.dimension
    })));

    if (currentHash === lastPlayersHash) return;
    lastPlayersHash = currentHash;

    allCachedPlayers = players;
    renderPlayersList();
  } catch (e) {
    console.error('Error:', e);
  }
}

function renderPlayersList() {
  const grid = $('playersGrid');
  if (!grid) return;
  applyFilterAndRender();
}

function applyFilterAndRender() {
  const grid = $('playersGrid');
  if (!grid) return;

  let filtered = allCachedPlayers;
  if (activeFilter === 'whitelist') filtered = allCachedPlayers.filter((p) => p.whitelisted);
  if (activeFilter === 'ban-ip') filtered = allCachedPlayers.filter((p) => p.bannedIp);
  if (activeFilter === 'ban-uuid') filtered = allCachedPlayers.filter((p) => p.bannedUuid);

  grid.innerHTML = '';
  if (filtered.length === 0) {
    grid.innerHTML = "<div class='empty-state-card'><h3>No se encontraron jugadores</h3></div>";
    return;
  }

  filtered.forEach((player) => {
    const card = document.createElement('a');
    card.href = 'player.html?id=' + player.id;
    const isBanned = player.bannedUuid || player.bannedIp;
    card.className = 'player-card compact' + (player.op ? ' player-op' : '') + (player.online ? '' : ' player-offline') + (isBanned ? ' player-banned-card' : '');

    card.innerHTML = `
      <div class="player-card-top compact">
        <img class="player-avatar-card" src="${getAvatarUrl(player.name)}" alt="skin" style="filter: ${player.online ? 'none' : 'grayscale(100%)'}">
        <div class="player-card-head-text">
          <div class="player-name-row">
            <h3 class="player-card-name">${player.name}</h3>
            <span class="player-online-dot ${player.online ? 'dot-online' : 'dot-offline'}"></span>
          </div>
          <div class="player-card-badges">
            ${player.op ? renderBadge('OP', 'op-badge') : ''}
            ${player.whitelisted ? renderBadge('Whitelist', 'whitelist-badge') : ''}
            ${player.bannedIp ? renderBadge('Ban IP', 'ban-ip') : ''}
            ${player.bannedUuid ? renderBadge('Ban UUID', 'ban-uuid') : ''}
          </div>
        </div>
      </div>
      <div class="player-card-info compact">
        <div class="player-card-row compact">
          <span>Coordenadas</span>
          ${(() => {
            const loc = (player.location && (player.location.x !== 0 || player.location.z !== 0)) ? player.location : (player.spawn && (player.spawn.x !== 0 || player.spawn.z !== 0) ? player.spawn : { x: 0, y: 64, z: 0 });
            return renderBadge(`${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`, 'coords');
          })()}
        </div>
        <div class="player-card-row compact" style="margin-top: 4px; align-items: center;">
          <span>Dimensión</span>
          <span style="
            display: inline-block;
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            background: ${(player.dimension || '').toLowerCase().includes('nether') ? 'rgba(239, 68, 68, 0.15)' : (player.dimension || '').toLowerCase().includes('end') ? 'rgba(168, 85, 247, 0.15)' : 'rgba(34, 197, 94, 0.15)'};
            color: ${(player.dimension || '').toLowerCase().includes('nether') ? '#f87171' : (player.dimension || '').toLowerCase().includes('end') ? '#c084fc' : '#4ade80'};
            border: 1px solid ${(player.dimension || '').toLowerCase().includes('nether') ? 'rgba(239, 68, 68, 0.3)' : (player.dimension || '').toLowerCase().includes('end') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(34, 197, 94, 0.3)'};
          ">${(() => {
            const d = (player.dimension || 'Overworld').toLowerCase();
            if (d.includes('nether')) return 'Nether';
            if (d.includes('end')) return 'End';
            if (d.includes('overworld')) return 'Overworld';
            return (player.dimension || '').split(':').pop().replace('_', ' ');
          })()}</span>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

function setupFilters() {
  const buttons = {
    showAllPlayersBtn: 'all',
    showWhitelistBtn: 'whitelist',
    showBanIpBtn: 'ban-ip',
    showBanUuidBtn: 'ban-uuid'
  };

  Object.keys(buttons).forEach((id) => {
    const btn = $(id);
    if (!btn) return;
    btn.onclick = () => {
      Object.keys(buttons).forEach((bid) => {
        const b = $(bid);
        if (b) b.classList.remove('filter-active');
      });
      btn.classList.add('filter-active');
      activeFilter = buttons[id];
      applyFilterAndRender();
    };
  });
}

document.addEventListener('DOMContentLoaded', function () {
  setupFilters();
  const refreshBtn = $('refreshPlayersBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      lastPlayersHash = '';
      fetchAndRenderPlayers();
    });
  }
  fetchAndRenderPlayers();
  setInterval(fetchAndRenderPlayers, 2000);
});
