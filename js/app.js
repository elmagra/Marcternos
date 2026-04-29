function $(id) {
  return document.getElementById(id);
}

function getActiveInstanceId() {
  return localStorage.getItem('activeInstanceId') || '';
}

function withInstance(url) {
  const id = getActiveInstanceId();
  if (!id) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}instanceId=${encodeURIComponent(id)}`;
}

// ─── 1. UPTIME & FORMATTING ──────────────────────────────────────────────────
function formatUptime(ms) {
  if (!ms || ms < 0) return "00:00:00";
  let totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (
    String(hours).padStart(2, "0") + ":" +
    String(minutes).padStart(2, "0") + ":" +
    String(seconds).padStart(2, "0")
  );
}

async function sendCommandToBackend(command) {
  try {
    const instanceId = getActiveInstanceId();
    await fetch('/api/server/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(instanceId ? { command, instanceId } : { command })
    });
  } catch (e) {
    console.error('Error enviando comando:', e);
  }
}

async function initDashboard() {
  const bindClick = (id, url) => {
    const btn = $(id);
    if (!btn) return;

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const oldText = btn.innerHTML;
      btn.innerHTML = '<span>...</span>';
      try {
        const instanceId = getActiveInstanceId();
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(instanceId ? { instanceId } : {})
        });
      } catch (e) {}
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = oldText;
      }, 2000);
    });
  };

  bindClick('startBtn', '/api/server/start');
  bindClick('stopBtn', '/api/server/stop');
  bindClick('restartBtn', '/api/server/restart');

  setInterval(updateStatus, 1500);
}

let lastDataState = {};
let lastLogCount = 0;
let activePlayersList = [];

// ─── 2. DUPLICATE TIMESTAMP CLEANER ──────────────────────────────────────────
function cleanDuplicateTimestamps(msg) {
  // Ej: [21:45:07] [21:45:07] [Server thread/INFO]: ...
  // Regex busca dos timestamps iguales consecutivos al principio
  return msg.replace(/^(\[\d{2}:\d{2}:\d{2}\])\s+\1\s+/, '$1 ');
}

function getDisplayVersion(data) {
  const software = (data.software || '').trim();
  const version = (data.version || '').trim();
  if (software && version && version !== '...') return software + ' ' + version;
  if (software) return software;
  if (version && version !== '...') return version;
  return '-';
}

async function updateStatus() {
  try {
    const res = await fetch(withInstance('/api/server/status'));
    if (!res.ok) return;
    const data = await res.json();

    if (data.status !== lastDataState.status) {
      const statusText = $('serverStatusText');
      const dot = $('statusDot');
      if (data.status === 'online') {
        if (statusText) statusText.textContent = 'En linea';
        if (dot) dot.style.background = '#22c55e';
        if ($('startBtn')) $('startBtn').style.display = 'none';
        if ($('stopBtn')) $('stopBtn').style.display = 'inline-block';
        if ($('restartBtn')) $('restartBtn').style.display = 'inline-block';
      } else if (data.status === 'starting') {
        if (statusText) statusText.textContent = 'Iniciando...';
        if (dot) dot.style.background = '#eab308';
        if ($('startBtn')) $('startBtn').style.display = 'none';
        if ($('stopBtn')) $('stopBtn').style.display = 'none';
        if ($('restartBtn')) $('restartBtn').style.display = 'none';
      } else {
        if (statusText) statusText.textContent = 'Apagado';
        if (dot) dot.style.background = '#ef4444';
        if ($('startBtn')) $('startBtn').style.display = 'inline-block';
        if ($('stopBtn')) $('stopBtn').style.display = 'none';
        if ($('restartBtn')) $('restartBtn').style.display = 'none';
      }
    }

    // Actualizar lista de jugadores activos para el autocompletado (Req #6)
    if (data.players) {
      activePlayersList = data.players.filter(p => p.online).map(p => p.name);
      const onlineCount = activePlayersList.length;
      if (onlineCount !== lastDataState.onlineCount) {
        const maxP = data.maxPlayers || 20;
        if ($('playerCount')) $('playerCount').textContent = onlineCount + ' / ' + maxP;
        lastDataState.onlineCount = onlineCount;
      }
    } else {
      activePlayersList = [];
    }

    if (data.cpu !== lastDataState.cpu) {
      if ($('cpuUsage')) $('cpuUsage').textContent = (data.cpu || 0) + '%';
      if ($('cpuBar')) $('cpuBar').style.width = (data.cpu || 0) + '%';
      lastDataState.cpu = data.cpu;
    }

    if (data.ramUsedGB !== lastDataState.ramUsedGB) {
      if ($('ramUsage')) $('ramUsage').textContent = (data.ramUsedGB || 0) + ' GB / ' + (data.ramTotalGB || 0) + ' GB';
      if ($('ramBar')) $('ramBar').style.width = (data.ram || 0) + '%';
      lastDataState.ramUsedGB = data.ramUsedGB;
    }

    if (data.worldSize !== lastDataState.worldSize) {
      if ($('worldSize')) $('worldSize').textContent = data.worldSize || '0 MB';
      lastDataState.worldSize = data.worldSize;
    }

    const displayVersion = getDisplayVersion(data);
    if (displayVersion !== lastDataState.displayVersion) {
      if ($('serverVersion')) $('serverVersion').textContent = displayVersion;
      lastDataState.displayVersion = displayVersion;
    }

    // Req #1: Contador de tiempo encendido (basado en uptimeMs)
    if (data.status === 'online') {
      if (!window.localUptimeStart) {
        // Empieza a contar desde el momento en que status es 'online' si el backend nos da uptimeMs
        window.localUptimeStart = Date.now() - (data.uptimeMs || 0);
      }
      if ($('uptime')) {
        const elapsed = Date.now() - window.localUptimeStart;
        $('uptime').textContent = formatUptime(elapsed);
      }
    } else {
      window.localUptimeStart = null;
      if ($('uptime')) $('uptime').textContent = '00:00:00';
    }

    const logs = Array.isArray(data.logs) ? data.logs : [];
    if (logs.length !== lastLogCount) {
      const out = $('consoleOutput');
      if (out) {
        if (logs.length < lastLogCount) out.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const newLogs = logs.slice(lastLogCount);
        newLogs.forEach((msg) => {
          const line = document.createElement('div');
          line.className = 'log-line';
          // Limpiamos timestamp duplicado (Req #2)
          line.textContent = cleanDuplicateTimestamps(msg);
          fragment.appendChild(line);
        });
        out.appendChild(fragment);
        out.scrollTop = out.scrollHeight;
      }
      lastLogCount = logs.length;
    }

    lastDataState.status = data.status;
  } catch (e) {
    console.error('Update failed:', e);
  }
}

// ─── 4. & 5. AUTOCOMPLETADO AVANZADO Y POR ARGUMENTOS ─────────────────────────

// Efectos genéricos de Minecraft
const MINECRAFT_EFFECTS = [
  'minecraft:speed', 'minecraft:slowness', 'minecraft:haste', 'minecraft:mining_fatigue',
  'minecraft:strength', 'minecraft:instant_health', 'minecraft:instant_damage',
  'minecraft:jump_boost', 'minecraft:nausea', 'minecraft:regeneration', 'minecraft:resistance',
  'minecraft:fire_resistance', 'minecraft:water_breathing', 'minecraft:invisibility',
  'minecraft:blindness', 'minecraft:night_vision', 'minecraft:hunger', 'minecraft:weakness',
  'minecraft:poison', 'minecraft:wither', 'minecraft:health_boost', 'minecraft:absorption',
  'minecraft:saturation', 'minecraft:glowing', 'minecraft:levitation', 'minecraft:luck',
  'minecraft:unluck', 'minecraft:slow_falling', 'minecraft:conduit_power',
  'minecraft:dolphins_grace', 'minecraft:bad_omen', 'minecraft:hero_of_the_village',
  'minecraft:darkness'
];

// Estructura en árbol de los comandos. 
// $xxx = variable dinámica (jugadores, efectos, etc)
// [xxx] = argumento opcional o placeholder
// <xxx> = argumento requerido
const COMMAND_TREE_GENERIC = {
  "effect": {
    "give": {
      "$player": {
        "$effect": {
          "[duration]": {
            "[amplifier]": {
              "[hideParticles(true|false)]": {}
            }
          }
        }
      }
    },
    "clear": {
      "$player": {
        "[$effect]": {}
      }
    }
  },
  "gamemode": {
    "survival": { "[$player]": {} },
    "creative": { "[$player]": {} },
    "adventure": { "[$player]": {} },
    "spectator": { "[$player]": {} }
  },
  "give": {
    "$player": {
      "$item": {
        "[count]": {}
      }
    }
  },
  "teleport": {
    "$player": {
      "[$target]": {}
    }
  },
  "tp": {
    "$player": {
      "[$target]": {}
    }
  },
  "time": {
    "set": { "day": {}, "night": {}, "noon": {}, "midnight": {} },
    "add": { "<time>": {} },
    "query": { "daytime": {}, "gametime": {}, "day": {} }
  },
  "weather": {
    "clear": { "[duration]": {} },
    "rain": { "[duration]": {} },
    "thunder": { "[duration]": {} }
  },
  "ban": { "$player": { "[reason]": {} } },
  "kick": { "$player": { "[reason]": {} } },
  "op": { "$player": {} },
  "deop": { "$player": {} },
  "pardon": { "$player": {} },
  "whitelist": {
    "add": { "$player": {} },
    "remove": { "$player": {} },
    "on": {}, "off": {}, "list": {}, "reload": {}
  },
  "stop": {},
  "save-all": {},
  "save-off": {},
  "save-on": {},
  "say": { "<message>": {} }
};

// Diccionario para resolver variables dinámicas
const DYNAMIC_RESOLVERS = {
  "$player": () => activePlayersList.length > 0 ? activePlayersList : ["<player>"],
  "[$player]": () => activePlayersList.length > 0 ? activePlayersList : ["[player]"],
  "[$target]": () => activePlayersList.length > 0 ? activePlayersList : ["[target]"],
  "$effect": () => MINECRAFT_EFFECTS,
  "[$effect]": () => MINECRAFT_EFFECTS,
  "$item": () => ['minecraft:diamond', 'minecraft:iron_ingot', 'minecraft:gold_ingot', 'minecraft:emerald', 'minecraft:stone', 'minecraft:dirt'], // Simplificado, extensible
  "[hideParticles(true|false)]": () => ['true', 'false']
};

/**
 * Función recursiva para navegar el árbol de comandos según los argumentos escritos.
 */
function getCompletionsForInput(inputArgs) {
  let currentNode = COMMAND_TREE_GENERIC;
  
  // Recorremos el input menos el último argumento que es el que estamos escribiendo
  for (let i = 0; i < inputArgs.length - 1; i++) {
    const arg = inputArgs[i];
    
    // Buscamos coincidencia exacta en los hijos
    if (currentNode[arg]) {
      currentNode = currentNode[arg];
    } else {
      // Si no es un nodo estático, miramos si hay una variable dinámica que podría estar consumiendo este arg
      let matchedDynamic = false;
      for (const key of Object.keys(currentNode)) {
        if (key.startsWith('$') || key.startsWith('[')) {
          currentNode = currentNode[key];
          matchedDynamic = true;
          break;
        }
      }
      if (!matchedDynamic) return []; // No hay ruta válida
    }
  }

  // Ahora 'currentNode' contiene los posibles siguientes pasos
  const lastArg = (inputArgs[inputArgs.length - 1] || '').toLowerCase();
  let suggestions = [];

  for (const key of Object.keys(currentNode)) {
    if (key.startsWith('$') || key.startsWith('[')) {
      // Es una variable dinámica o placeholder
      if (DYNAMIC_RESOLVERS[key]) {
        const resolvedList = DYNAMIC_RESOLVERS[key]();
        suggestions.push(...resolvedList);
      } else {
        suggestions.push(key);
      }
    } else {
      // Es un literal (ej: 'give', 'clear')
      suggestions.push(key);
    }
  }

  // Filtramos por lo que el usuario ha escrito
  if (lastArg) {
    suggestions = suggestions.filter(s => s.toLowerCase().startsWith(lastArg));
  }

  // Eliminamos duplicados por si acaso
  return [...new Set(suggestions)].slice(0, 30); // Max 30 sugerencias para no petar la UI
}

function initConsole() {
  const form = $('consoleForm');
  const input = $('consoleCommand');
  const suggestionsBox = $('commandSuggestions');
  if (!form || !input || !suggestionsBox) return;

  let currentFocus = -1;

  // Renderizar las sugerencias en el box
  const renderSuggestions = (suggestions, argsSoFar) => {
    suggestionsBox.innerHTML = '';
    if (suggestions.length === 0) {
      suggestionsBox.style.display = 'none';
      return;
    }

    suggestions.forEach((suggestion) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      
      // Reconstruir el comando visualmente
      const prefix = argsSoFar.length > 0 ? '/' + argsSoFar.join(' ') + ' ' : '/';
      item.innerHTML = `<span>${prefix}</span>${suggestion}`;
      
      item.addEventListener('click', () => {
        // Al hacer click, autocompletamos
        input.value = prefix + suggestion + ' ';
        suggestionsBox.style.display = 'none';
        input.focus();
      });
      suggestionsBox.appendChild(item);
    });
    
    suggestionsBox.style.display = 'block';
    currentFocus = -1;
  };

  input.addEventListener('input', function () {
    const val = this.value;

    if (!val || !val.startsWith('/')) {
      suggestionsBox.style.display = 'none';
      return;
    }

    const withoutSlash = val.substring(1);
    // Split por espacios, manteniendo el último elemento vacío si acaba en espacio
    const args = withoutSlash.split(' '); 
    
    const argsSoFar = args.slice(0, -1);
    const suggestions = getCompletionsForInput(args);

    renderSuggestions(suggestions, argsSoFar);
  });

  input.addEventListener('keydown', function (e) {
    const items = suggestionsBox.getElementsByClassName('suggestion-item');
    if (suggestionsBox.style.display === 'block' && items.length > 0) {
      if (e.keyCode === 40) { // DOWN
        e.preventDefault();
        currentFocus++;
        addActive(items);
      } else if (e.keyCode === 38) { // UP
        e.preventDefault();
        currentFocus--;
        addActive(items);
      } else if (e.keyCode === 9) { // TAB
        e.preventDefault();
        if (currentFocus > -1 && items[currentFocus]) {
          items[currentFocus].click();
        } else if (items.length > 0) {
          items[0].click(); // Autocompleta la primera opción si no hay ninguna seleccionada
        }
      } else if (e.keyCode === 13) { // ENTER
        if (currentFocus > -1) {
          e.preventDefault();
          items[currentFocus].click();
        }
        // Si no hay nada seleccionado, dejamos que haga el submit normal
      } else if (e.keyCode === 27) { // ESC
        suggestionsBox.style.display = 'none';
      }
    }
  });

  function addActive(items) {
    if (!items) return false;
    removeActive(items);
    if (currentFocus >= items.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = items.length - 1;
    items[currentFocus].classList.add('active');
    items[currentFocus].scrollIntoView({ block: 'nearest' });
  }

  function removeActive(items) {
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove('active');
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target !== input) suggestionsBox.style.display = 'none';
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const command = input.value.trim();
    if (command === '') return;
    
    // Si empieza por /, enviamos sin la barra
    const finalCmd = command.startsWith('/') ? command.substring(1) : command;
    sendCommandToBackend(finalCmd);
    
    input.value = '';
    suggestionsBox.style.display = 'none';
  });
}

document.addEventListener('DOMContentLoaded', function () {
  initDashboard();
  initConsole();

  fetch(withInstance('/api/current-server'))
    .then((res) => res.json())
    .then((data) => {
      if ($('serverName')) $('serverName').innerText = data.name;
    });

  const ipContainer = $('serverIp');
  if (ipContainer) {
    fetch(withInstance('/api/server/ip'))
      .then(r => r.json())
      .then(d => {
        const rawFullIp = (d.publicAddress || d.ip || '127.0.0.1').replace(/^https?:\/\//, '');
        const rawIp = rawFullIp.split(':')[0];
        ipContainer.innerHTML = `${rawIp} <i class="fa-solid fa-copy" style="font-size: 0.7rem; margin-left: 4px; color: #3b82f6;"></i>`;
        ipContainer.onclick = () => { navigator.clipboard.writeText(rawIp); alert('IP copiada'); };
      })
      .catch(() => {
        ipContainer.innerHTML = '127.0.0.1 <i class="fa-solid fa-copy" style="font-size: 0.7rem; margin-left: 4px; color: #3b82f6;"></i>';
      });
  }
});
