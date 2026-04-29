function $g(id) { return document.getElementById(id); }

function getActiveInstanceId() {
    return localStorage.getItem('activeInstanceId') || '';
}

if (!window.__instanceAwareFetchWrapped) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = function(resource, init = undefined) {
        try {
            const activeId = getActiveInstanceId();
            if (!activeId) return originalFetch(resource, init);

            if (typeof resource === 'string' && resource.startsWith('/api/')) {
                const hasInstance = resource.includes('instanceId=');
                let finalResource = resource;
                if (!hasInstance && !resource.includes('/api/instances/select')) {
                    const sep = resource.includes('?') ? '&' : '?';
                    finalResource = `${resource}${sep}instanceId=${encodeURIComponent(activeId)}`;
                }
                return originalFetch(finalResource, init);
            }
        } catch (e) {}
        return originalFetch(resource, init);
    };
    window.__instanceAwareFetchWrapped = true;
}

async function ensureActiveInstanceSelected() {
    try {
        const localId = getActiveInstanceId();
        if (localId) {
            await fetch('/api/instances/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instanceId: localId })
            });
            return;
        }
        const res = await fetch('/api/instances');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.activeInstanceId) {
            localStorage.setItem('activeInstanceId', data.activeInstanceId);
        }
    } catch (e) {}
}

async function handleGlobalAction(url, btnId) {
    const btn = $g(btnId);
    if (!btn) return;
    btn.disabled = true;
    const oldText = btn.innerHTML;
    btn.innerHTML = '...';
    try {
        const instanceId = getActiveInstanceId();
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(instanceId ? { instanceId } : {})
        });
    } catch(e) { console.error(e); }
    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = oldText;
    }, 2000);
}

async function updateGlobalStatus() {
    try {
        const instanceId = getActiveInstanceId();
        const url = instanceId ? `/api/server/status?instanceId=${encodeURIComponent(instanceId)}` : '/api/server/status';
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        const dot = $g("globalStatusDot");
        const text = $g("globalStatusText");

        if (dot && text) {
            dot.className = "status-dot";
            if (data.status === 'online') {
                dot.classList.add("dot-online");
                if (dot.style) dot.style.background = "#22c55e"; // En caso de que se use el style inline de index
                text.textContent = "En línea";
                if ($g("globalStartBtn")) $g("globalStartBtn").style.display = "none";
                if ($g("globalStopBtn")) $g("globalStopBtn").style.display = "inline-block";
                if ($g("globalRestartBtn")) $g("globalRestartBtn").style.display = "inline-block";
            } else if (data.status === 'starting') {
                dot.classList.add("dot-starting");
                if (dot.style) dot.style.background = "#eab308";
                text.textContent = "Iniciando...";
                if ($g("globalStartBtn")) $g("globalStartBtn").style.display = "none";
                if ($g("globalStopBtn")) $g("globalStopBtn").style.display = "none";
                if ($g("globalRestartBtn")) $g("globalRestartBtn").style.display = "none";
            } else {
                dot.classList.add("dot-offline");
                if (dot.style) dot.style.background = "#ef4444";
                text.textContent = "Apagado";
                if ($g("globalStartBtn")) $g("globalStartBtn").style.display = "inline-block";
                if ($g("globalStopBtn")) $g("globalStopBtn").style.display = "none";
                if ($g("globalRestartBtn")) $g("globalRestartBtn").style.display = "none";
            }
        }
    } catch(e) {}
}

document.addEventListener("DOMContentLoaded", () => {
    const startBtn = $g("globalStartBtn");
    const stopBtn = $g("globalStopBtn");
    const restartBtn = $g("globalRestartBtn");

    ensureActiveInstanceSelected();

    if (startBtn) startBtn.onclick = () => handleGlobalAction("/api/server/start", "globalStartBtn");
    if (stopBtn) stopBtn.onclick = () => handleGlobalAction("/api/server/stop", "globalStopBtn");
    if (restartBtn) restartBtn.onclick = () => handleGlobalAction("/api/server/restart", "globalRestartBtn");

    updateGlobalStatus();
    setInterval(updateGlobalStatus, 3000);
});

