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
  return "https://mc-heads.net/avatar/" + encodeURIComponent(name) + "/128";
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

let isUIBlocked = false;
let blockTimeout = null;

async function getPlayerData(id) {
  try {
    const res = await fetch(withInstance('/api/server/status'));
    const data = await res.json();
    return data.players.find(p => String(p.id) === String(id)) || null;
  } catch(e) { return null; }
}

async function sendPlayerCommand(playerName, cmd, switchEl = null, targetState = null) {
    if (switchEl && targetState !== null) switchEl.checked = targetState;
    isUIBlocked = true;
    if (blockTimeout) clearTimeout(blockTimeout);
    try {
        const res = await fetch(withInstance('/api/server/command'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cmd })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Error al enviar el comando');
            if (switchEl) switchEl.checked = !targetState;
        }
        blockTimeout = setTimeout(() => { isUIBlocked = false; initPlayerProfile(true); }, 3000);
    } catch(e) {
        if (switchEl) switchEl.checked = !targetState;
        isUIBlocked = false;
    }
}

async function sendBanIp(playerName, playerIp, switchEl = null, targetState = null) {
    if (switchEl && targetState !== null) switchEl.checked = targetState;
    isUIBlocked = true;
    if (blockTimeout) clearTimeout(blockTimeout);
    try {
        const res = await fetch(withInstance('/api/server/ban-ip'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: playerName, ip: playerIp || undefined })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'No se pudo banear por IP');
            if (switchEl) switchEl.checked = false;
        }
        blockTimeout = setTimeout(() => { isUIBlocked = false; initPlayerProfile(true); }, 3000);
    } catch(e) {
        if (switchEl) switchEl.checked = false;
        isUIBlocked = false;
    }
}

async function sendPardonIp(playerName, switchEl = null, targetState = null) {
    if (switchEl && targetState !== null) switchEl.checked = targetState;
    isUIBlocked = true;
    if (blockTimeout) clearTimeout(blockTimeout);
    try {
        const res = await fetch(withInstance('/api/server/pardon-ip'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: playerName })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'No se pudo desbanear la IP');
            if (switchEl) switchEl.checked = true;
        }
        blockTimeout = setTimeout(() => { isUIBlocked = false; initPlayerProfile(true); }, 3000);
    } catch(e) {
        if (switchEl) switchEl.checked = true;
        isUIBlocked = false;
    }
}

async function sendBanUuid(playerName, switchEl = null, targetState = null) {
    if (switchEl && targetState !== null) switchEl.checked = targetState;
    isUIBlocked = true;
    if (blockTimeout) clearTimeout(blockTimeout);
    try {
        const res = await fetch(withInstance('/api/server/ban'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: playerName })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'No se pudo banear al jugador');
            if (switchEl) switchEl.checked = false;
        }
        blockTimeout = setTimeout(() => { isUIBlocked = false; initPlayerProfile(true); }, 3000);
    } catch(e) {
        if (switchEl) switchEl.checked = false;
        isUIBlocked = false;
    }
}

async function sendPardonUuid(playerName, switchEl = null, targetState = null) {
    if (switchEl && targetState !== null) switchEl.checked = targetState;
    isUIBlocked = true;
    if (blockTimeout) clearTimeout(blockTimeout);
    try {
        const res = await fetch(withInstance('/api/server/pardon'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: playerName })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'No se pudo desbanear al jugador');
            if (switchEl) switchEl.checked = true;
        }
        blockTimeout = setTimeout(() => { isUIBlocked = false; initPlayerProfile(true); }, 3000);
    } catch(e) {
        if (switchEl) switchEl.checked = true;
        isUIBlocked = false;
    }
}

function renderSwitch(checked, onchange) {
  return `<label class='switch'><input type='checkbox' ${checked ? "checked" : ""} onchange="${onchange}"><span class='slider'></span></label>`;
}

async function initPlayerProfile(force = false) {
  if (isUIBlocked && !force) return;

  const id = getQueryParam("id");
  const player = await getPlayerData(id);
  const container = $("playerProfile");
  
  if (!container || !player) return;

  window.handleOpChange = (el) => sendPlayerCommand(player.name, el.checked ? `op ${player.name}` : `deop ${player.name}`, el, el.checked);
  window.handleWhitelistChange = (el) => sendPlayerCommand(player.name, el.checked ? `whitelist add ${player.name}` : `whitelist remove ${player.name}`, el, el.checked);
  window.handleBanIp = (el) => { if (el.checked) sendBanIp(player.name, player.ip, el, true); else sendPardonIp(player.name, el, false); };
  window.handleBanUuid = (el) => { if (el.checked) sendBanUuid(player.name, el, true); else sendPardonUuid(player.name, el, false); };
  
  window.handleGamemode = (val) => sendPlayerCommand(player.name, `gamemode ${val.toLowerCase()} ${player.name}`);

  // TP al spawn del jugador — respeta la dimensión (Overworld, o Nether si usó respawn anchor)
  window.tpToSpawn = (x, y, z, dim) => {
    const name = player.name;
    const dimension = dim || 'minecraft:overworld';
    if (dimension === 'minecraft:overworld') {
      sendPlayerCommand(name, `execute in minecraft:overworld run tp ${name} ${x} ${y} ${z}`);
    } else {
      sendPlayerCommand(name, `execute in ${dimension} run tp ${name} ${x} ${y} ${z}`);
    }
  };

  // TP a la última muerte — respeta la dimensión donde murió
  window.tpToLastDeath = (x, y, z, dim) => {
    const name = player.name;
    const dimension = dim || 'minecraft:overworld';
    if (dimension === 'minecraft:overworld') {
      sendPlayerCommand(name, `tp ${name} ${x} ${y} ${z}`);
    } else {
      sendPlayerCommand(name, `execute in ${dimension} run tp ${name} ${x} ${y} ${z}`);
    }
  };

  window.tpToPlayer = (targetName) => { if (targetName) sendPlayerCommand(player.name, `tp ${player.name} ${targetName}`); };
  window.playerKick = () => sendPlayerCommand(player.name, `kick ${player.name} Expulsado`);
  window.playerKill = () => sendPlayerCommand(player.name, `kill ${player.name}`);

  let currentLocation = player.location || { x: 0, y: 0, z: 0 };
  let spawn = { x: 0, y: 0, z: 0 };
  let spawnDimension = 'minecraft:overworld';
  let lastDeath = null;
  let lastDeathDimension = 'minecraft:overworld';
  let hasSpawn = false;
  let otherPlayers = [];
  try {
    const locRes = await fetch(withInstance('/api/server/player/' + encodeURIComponent(player.name) + '/location')).then(r => r.json()).catch(() => ({}));
    currentLocation = locRes.location || currentLocation;
    player.dimension = locRes.dimension || player.dimension;
    spawn = locRes.spawn || spawn;
    spawnDimension = locRes.spawnDimension || 'minecraft:overworld';
    lastDeath = locRes.lastDeath || null;
    lastDeathDimension = locRes.lastDeathDimension || 'minecraft:overworld';
    hasSpawn = spawn && (spawn.x !== 0 || spawn.y !== 0 || spawn.z !== 0);
    const statusRes = await fetch(withInstance('/api/server/status')).then(r => r.json()).catch(() => ({}));
    otherPlayers = (statusRes.players || []).filter(p => p.name && p.name.toLowerCase() !== player.name.toLowerCase());
  } catch (e) {}

  container.innerHTML = `
    <div class='player-page-layout'>
      <div class='card player-hero-card'>
        <div class='player-hero-left'>
          <img class='player-hero-avatar' src='${getAvatarUrl(player.name)}' alt='avatar' style="filter: ${player.online ? 'none' : 'grayscale(100%)'}">
        </div>
        <div class='player-hero-right'>
            <h3 class='player-hero-name'>
                ${player.name}
                <span class='player-online-dot hero-status-dot ${player.online ? "dot-online" : "dot-offline"}'></span>
            </h3>
        </div>
      </div>

      <div class='player-main-grid'>
        <div class='card' style="padding: 24px;">
          <h3 style="margin-bottom: 25px;"><i class="fa-solid fa-user-gear" style="color:#3b82f6; margin-right: 10px;"></i> Configuración</h3>
          <div class='info-list' style="display: flex; flex-direction: column; gap: 16px;">
            <div class='info-row switch-row'>
              <span style="font-weight: 500;">Permisos de Operador (OP)</span>
              ${renderSwitch(player.op, "handleOpChange(this)")}
            </div>
            <div class='info-row switch-row'>
              <span style="font-weight: 500;">Acceso a Whitelist</span>
              ${renderSwitch(player.whitelisted, "handleWhitelistChange(this)")}
            </div>
            
            <div class='player-ban-section' style="margin-top: 10px;">
              <h4 class='player-ban-section-title' style="margin-bottom: 15px; color: #ef4444; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; border-bottom: 1px solid rgba(239, 68, 68, 0.1); padding-bottom: 8px;">Acciones de Seguridad</h4>
              <div class='info-list' style="display: flex; flex-direction: column; gap: 16px;">
                <div class='info-row switch-row switch-row--danger'>
                  <span style="font-weight: 500;">Baneo por Dirección IP</span>
                  ${renderSwitch(player.bannedIp, "handleBanIp(this)")}
                </div>
                <div class='info-row switch-row switch-row--danger'>
                  <span style="font-weight: 500;">Baneo por Identificador UUID</span>
                  ${renderSwitch(player.bannedUuid, "handleBanUuid(this)")}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class='card' style="padding: 24px;">
          <h3 style="margin-bottom: 25px;"><i class="fa-solid fa-bolt" style="color:#f59e0b; margin-right: 10px;"></i> Acciones Rápidas</h3>
          <div class="quick-actions-list" style="gap: 20px;">
             
             <div class="location-group" style="display: flex; flex-direction: column; gap: 12px;">
                 <div class="location-info" style="background: rgba(255, 255, 255, 0.03); padding: 16px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); display: flex; flex-direction: column; gap: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <span style="display: block; font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.1em; margin-bottom: 4px;">Ubicación Actual</span>
                            <p style="margin:0; font-family: 'JetBrains Mono', monospace; font-size: 19px; color: #f8fafc; font-weight: 600; letter-spacing: -0.02em;">
                                ${Math.floor(currentLocation.x)} ${Math.floor(currentLocation.y)} ${Math.floor(currentLocation.z)}
                            </p>
                        </div>
                        <div style="text-align: right;">
                            <span style="display: block; font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.1em; margin-bottom: 4px;">Dimensión</span>
                            <span id="dimBadge" style="
                                display: inline-block;
                                padding: 5px 12px;
                                border-radius: 8px;
                                font-size: 12px;
                                font-weight: 800;
                                text-transform: uppercase;
                                letter-spacing: 0.05em;
                                background: ${(player.dimension || '').toLowerCase().includes('nether') ? 'rgba(239, 68, 68, 0.15)' : (player.dimension || '').toLowerCase().includes('end') ? 'rgba(168, 85, 247, 0.15)' : 'rgba(34, 197, 94, 0.15)'};
                                color: ${(player.dimension || '').toLowerCase().includes('nether') ? '#f87171' : (player.dimension || '').toLowerCase().includes('end') ? '#c084fc' : '#4ade80'};
                                border: 1px solid ${(player.dimension || '').toLowerCase().includes('nether') ? 'rgba(239, 68, 68, 0.3)' : (player.dimension || '').toLowerCase().includes('end') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(34, 197, 94, 0.3)'};
                            ">
                                ${(() => {
                                        const d = (player.dimension || 'overworld').toLowerCase();
                                        if (d.includes('nether')) return 'Nether';
                                        if (d.includes('end')) return 'End';
                                        if (d.includes('overworld')) return 'Overworld';
                                        return (player.dimension || 'overworld').split(':').pop().replace('_', ' ');
                                    })()}
                            </span>
                        </div>
                    </div>
                 </div>

                 <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="location-card" style="background: rgba(245, 158, 11, 0.05); padding: 12px; border-radius: 14px; border: 1px solid rgba(245, 158, 11, 0.15); display: flex; align-items: center; gap: 12px;">
                        <i class="fa-solid fa-house" style="color: #f59e0b; font-size: 14px;"></i>
                        <div>
                            <span style="display: block; font-size: 9px; text-transform: uppercase; color: #f59e0b; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 2px;">Spawn</span>
                            <p style="margin:0; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #f1f5f9; font-weight: 500;">
                                ${hasSpawn ? `${Math.floor(spawn.x)} ${Math.floor(spawn.y)} ${Math.floor(spawn.z)}` : '--- --- ---'}
                            </p>
                        </div>
                    </div>
                    <div class="location-card" style="background: rgba(14, 165, 233, 0.05); padding: 12px; border-radius: 14px; border: 1px solid rgba(14, 165, 233, 0.15); display: flex; align-items: center; gap: 12px;">
                        <i class="fa-solid fa-skull" style="color: #0ea5e9; font-size: 14px;"></i>
                        <div>
                            <span style="display: block; font-size: 9px; text-transform: uppercase; color: #0ea5e9; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 2px;">Muerte</span>
                            <p style="margin:0; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #f1f5f9; font-weight: 500;">
                                ${lastDeath ? `${Math.floor(lastDeath.x)} ${Math.floor(lastDeath.y)} ${Math.floor(lastDeath.z)}` : '--- --- ---'}
                            </p>
                        </div>
                    </div>
                 </div>
             </div>

             <div class="tp-actions" style="display: flex; flex-direction: column; gap: 10px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <button class='btn warning' style="justify-content: center; font-size: 13px; height: 42px; border-radius: 12px;" onclick="tpToSpawn(${spawn.x}, ${spawn.y}, ${spawn.z}, '${spawnDimension}')" ${!hasSpawn ? 'disabled' : ''}>
                        <i class="fa-solid fa-house"></i> TP Spawn
                    </button>
                    <button class='btn info' style="justify-content: center; background: #0ea5e9; color: white; border: none; font-size: 13px; height: 42px; border-radius: 12px;" onclick="tpToLastDeath(${lastDeath ? lastDeath.x : 0}, ${lastDeath ? lastDeath.y : 0}, ${lastDeath ? lastDeath.z : 0}, '${lastDeathDimension}')" ${!lastDeath ? 'disabled' : ''}>
                        <i class="fa-solid fa-skull"></i> TP Muerte
                    </button>
                </div>
                
                <div class="tp-player-row" style="margin-top: 5px;">
                    <select id="tpTargetSelect" class="tp-select" style="flex: 1; height: 38px;">
                        <option value="">Seleccionar jugador...</option>
                        ${otherPlayers.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                    </select>
                    <button class='btn primary' onclick="tpToPlayer($('tpTargetSelect').value)">TP</button>
                </div>
             </div>

             <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px;">
                <button class='btn warning' style="justify-content: center; height: 45px; border-radius: 12px;" onclick="playerKick()">
                    <i class="fa-solid fa-door-open"></i> EXPULSAR
                </button>
                <button class='btn danger' style="justify-content: center; height: 45px; border-radius: 12px;" onclick="playerKill()">
                    <i class="fa-solid fa-skull-crossbones"></i> MATAR
                </button>
             </div>
          </div>
        </div>
      </div>
    </div>`;
}

document.addEventListener("DOMContentLoaded", () => initPlayerProfile());
setInterval(() => initPlayerProfile(), 3000);

