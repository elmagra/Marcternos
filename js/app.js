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

    const onlineCount = data.players ? data.players.filter((p) => p.online).length : 0;
    if (onlineCount !== lastDataState.onlineCount) {
      const maxP = data.maxPlayers || 20;
      if ($('playerCount')) $('playerCount').textContent = onlineCount + ' / ' + maxP;
      lastDataState.onlineCount = onlineCount;
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

    if (data.status === 'online' || data.status === 'starting') {
      if (!window.localUptimeStart) {
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
          line.textContent = msg;
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

const MC_COMMANDS = {
  advancement: ['grant <player> everything', 'revoke <player> everything'],
  attribute: ['<target> <attribute> base set <value>', '<target> <attribute> get'],
  ban: ['<player> [reason]'],
  'ban-ip': ['<address|player> [reason]'],
  banlist: ['ips', 'players'],
  bossbar: ['add <id> <name>', 'set <id> players <targets>', 'remove <id>'],
  clear: ['<player> [item] [maxCount]'],
  clone: ['<begin> <end> <destination> [replace|masked|filtered]'],
  data: ['get entity <target>', 'merge entity <target> <nbt>'],
  datapack: ['list', 'enable <name>', 'disable <name>'],
  debug: ['start', 'stop', 'function <name>'],
  defaultgamemode: ['survival', 'creative', 'adventure', 'spectator'],
  deop: ['<player>'],
  difficulty: ['peaceful', 'easy', 'normal', 'hard'],
  effect: ['give <player> <effect> [duration] [amplifier]', 'clear <player> [effect]'],
  enchant: ['<player> <enchantment> [level]'],
  execute: ['as <target> run <command>', 'at <target> run <command>'],
  experience: ['add <player> <amount> [points|levels]', 'query <player> <points|levels>'],
  fill: ['<from> <to> <block> [replace|destroy|keep|hollow|outline]'],
  forceload: ['add <chunk>', 'remove <chunk>', 'query'],
  function: ['<name>'],
  gamemode: ['survival <player>', 'creative <player>', 'adventure <player>', 'spectator <player>'],
  gamerule: ['<rule> <value>'],
  give: ['<player> <item> [count]'],
  help: ['[command]'],
  item: ['replace entity <targets> <slot> with <item>', 'modify entity <targets> <slot> <modifier>'],
  jfr: ['start', 'stop'],
  kick: ['<player> [reason]'],
  kill: ['<target>'],
  list: ['uuids'],
  locate: ['structure <name>', 'biome <name>', 'poi <name>'],
  loot: ['give <player> loot <table>', 'spawn <pos> loot <table>'],
  me: ['<action>'],
  msg: ['<targets> <message>'],
  op: ['<player>'],
  pardon: ['<player>'],
  'pardon-ip': ['<address|player>'],
  particle: ['<name> <pos> <delta> <speed> <count> [force|normal]'],
  perf: ['start', 'stop'],
  place: ['feature <name> <pos>', 'structure <name> <pos>'],
  playsound: ['<sound> <source> <targets> [pos] [volume] [pitch] [minVolume]'],
  recipe: ['give <player> <recipe>', 'take <player> <recipe>'],
  reload: [''],
  'save-all': ['flush'],
  'save-off': [''],
  'save-on': [''],
  say: ['<message>'],
  schedule: ['function <name> <time> [append|replace]', 'clear <name>'],
  scoreboard: ['objectives add <name> <criteria>', 'players set <target> <objective> <score>'],
  seed: [''],
  setblock: ['<pos> <block> [destroy|keep|replace]'],
  setidletimeout: ['<minutes>'],
  setworldspawn: ['[x y z] [angle]'],
  spawnpoint: ['[player] [x y z] [angle]'],
  spectate: ['<target> [player]'],
  spreadplayers: ['<x> <z> <spreadDistance> <maxRange> <respectTeams> <targets>'],
  stop: [''],
  stopsound: ['<targets> [source] [sound]'],
  summon: ['<entity> [pos] [nbt]'],
  tag: ['<targets> add <name>', '<targets> remove <name>', '<targets> list'],
  team: ['add <name> [displayName]', 'join <team> [members]', 'leave [members]'],
  teammsg: ['<message>'],
  teleport: ['<targets> <location>', '<targets> <destination>'],
  tell: ['<targets> <message>'],
  tellraw: ['<targets> <json>'],
  tick: ['rate <value>', 'freeze', 'unfreeze', 'step <time>'],
  time: ['set day', 'set night', 'add <time>', 'query daytime'],
  title: ['<targets> title <text>', '<targets> subtitle <text>', '<targets> clear'],
  trigger: ['<objective> [add|set] [value]'],
  weather: ['clear [duration]', 'rain [duration]', 'thunder [duration]'],
  whitelist: ['on', 'off', 'list', 'add <player>', 'remove <player>', 'reload'],
  worldborder: ['set <distance> [time]', 'add <distance> [time]', 'center <x> <z>'],
  xp: ['add <player> <amount> [points|levels]', 'set <player> <amount> [points|levels]']
};

const BASE_COMMANDS = Object.keys(MC_COMMANDS).sort();

function initConsole() {
  const form = $('consoleForm');
  const input = $('consoleCommand');
  const suggestionsBox = $('commandSuggestions');
  if (!form || !input || !suggestionsBox) return;

  let currentFocus = -1;

  input.addEventListener('input', function () {
    const val = this.value;
    suggestionsBox.innerHTML = '';
    currentFocus = -1;

    if (!val || !val.startsWith('/')) {
      suggestionsBox.style.display = 'none';
      return;
    }

    const withoutSlash = val.substring(1);
    const pieces = withoutSlash.split(/\s+/);
    const hasArgs = withoutSlash.trim().includes(' ');
    const baseQuery = (pieces[0] || '').toLowerCase();

    if (!hasArgs) {
      const filtered = BASE_COMMANDS.filter((cmd) => cmd.startsWith(baseQuery));
      if (filtered.length > 0) {
        filtered.forEach((cmd) => {
          const item = document.createElement('div');
          item.className = 'suggestion-item';
          item.innerHTML = `<span>/</span>${cmd}`;
          item.addEventListener('click', () => {
            input.value = '/' + cmd + ' ';
            suggestionsBox.style.display = 'none';
            input.focus();
          });
          suggestionsBox.appendChild(item);
        });
        suggestionsBox.style.display = 'block';
      } else {
        suggestionsBox.style.display = 'none';
      }
      return;
    }

    const baseCommand = baseQuery;
    if (!MC_COMMANDS[baseCommand]) {
      suggestionsBox.style.display = 'none';
      return;
    }

    const argsQuery = withoutSlash.substring(baseCommand.length).trim().toLowerCase();
    const subCommands = MC_COMMANDS[baseCommand]
      .filter((sub) => sub.toLowerCase().startsWith(argsQuery))
      .slice(0, 20);

    if (subCommands.length === 0) {
      suggestionsBox.style.display = 'none';
      return;
    }

    subCommands.forEach((sub) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `<span>/</span>${baseCommand} ${sub}`.trim();
      item.addEventListener('click', () => {
        input.value = ('/' + baseCommand + ' ' + sub).trim() + ' ';
        suggestionsBox.style.display = 'none';
        input.focus();
      });
      suggestionsBox.appendChild(item);
    });
    suggestionsBox.style.display = 'block';
  });

  input.addEventListener('keydown', function (e) {
    const items = suggestionsBox.getElementsByClassName('suggestion-item');
    if (e.keyCode === 40) {
      currentFocus++;
      addActive(items);
    } else if (e.keyCode === 38) {
      currentFocus--;
      addActive(items);
    } else if (e.keyCode === 13) {
      if (currentFocus > -1) {
        if (items) items[currentFocus].click();
        e.preventDefault();
      }
    } else if (e.keyCode === 27) {
      suggestionsBox.style.display = 'none';
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
    sendCommandToBackend(command);
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
        // Solo mostrar la IP, sin puerto ni protocolos
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



