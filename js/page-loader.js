(function () {
  const MIN_VISIBLE_MS = 1000;
  const SETTLE_MS = 140;
  const TRACK_MAX_MS = 2400;
  const HARD_STOP_MS = 4200;

  const startedAt = Date.now();
  let pending = 0;
  let domReady = document.readyState !== 'loading';
  let trackFetch = true;
  let finished = false;
  let lastSettledAt = Date.now();
  let overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    const el = document.createElement('div');
    el.id = 'pageBootOverlay';
    el.innerHTML = `
      <div class="page-boot-center">
        <span class="page-boot-spinner" aria-hidden="true"></span>
        <span class="page-boot-text">Cargando panel...</span>
      </div>
    `;
    document.body.appendChild(el);
    overlayEl = el;
    return overlayEl;
  }

  function canFinishNow() {
    const now = Date.now();
    const elapsed = now - startedAt;
    if (!domReady) return false;
    if (elapsed < MIN_VISIBLE_MS) return false;
    if (pending > 0) return false;
    if ((now - lastSettledAt) < SETTLE_MS) return false;
    return true;
  }

  function finish() {
    if (finished) return;
    finished = true;
    document.documentElement.classList.remove('page-boot-loading');
    document.documentElement.classList.add('page-boot-loaded');
    if (overlayEl) {
      overlayEl.classList.add('hide');
      setTimeout(() => {
        try { overlayEl.remove(); } catch (e) {}
      }, 240);
    }
  }

  function tryFinish() {
    if (finished) return;
    if (canFinishNow()) {
      finish();
    }
  }

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch && !window.__pageBootFetchWrapped) {
    window.fetch = function (...args) {
      if (!trackFetch || finished) return nativeFetch(...args);
      pending += 1;
      return nativeFetch(...args).finally(() => {
        pending = Math.max(0, pending - 1);
        lastSettledAt = Date.now();
        tryFinish();
      });
    };
    window.__pageBootFetchWrapped = true;
  }

  function onDomReady() {
    domReady = true;
    ensureOverlay();
    tryFinish();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
  } else {
    onDomReady();
  }

  setTimeout(() => {
    trackFetch = false;
    tryFinish();
  }, TRACK_MAX_MS);

  setTimeout(() => {
    finish();
  }, HARD_STOP_MS);

  window.__pageBoot = {
    finish,
    tryFinish
  };
})();
