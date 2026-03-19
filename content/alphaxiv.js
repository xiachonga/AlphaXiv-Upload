/**
 * alphaxiv.org content script.
 * Intercepts outgoing fetch requests to capture the Bearer token AND the
 * custom request headers the API requires (arxiv-session-id, user-session-id, etc.)
 */
(function () {
  'use strict';

  let lastSavedToken = null;

  // Inject a script into the page's JS world so we can patch window.fetch
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      const CUSTOM_HEADERS = [
        'authorization',
        'arxiv-pageview-id',
        'arxiv-session-id',
        'user-session-id',
        'client-commit-hash',
      ];

      const _fetch = window.fetch;
      window.fetch = function(...args) {
        try {
          const [input, init] = args;
          const headers = (init && init.headers) || (typeof input === 'object' && input.headers);
          if (!headers) return _fetch.apply(this, args);

          const captured = {};
          for (const key of CUSTOM_HEADERS) {
            let val = null;
            if (typeof headers.get === 'function') {
              val = headers.get(key) || headers.get(key.toLowerCase());
            } else if (typeof headers === 'object') {
              val = headers[key] || headers[key.toLowerCase()];
            }
            if (val) captured[key] = val;
          }

          if (captured['authorization'] && captured['authorization'].startsWith('Bearer eyJ')) {
            window.dispatchEvent(new CustomEvent('__alphaxiv_headers__', {
              detail: captured
            }));
          }
        } catch (_) {}
        return _fetch.apply(this, args);
      };
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  window.addEventListener('__alphaxiv_headers__', (e) => {
    const headers = e.detail;
    const token = headers['authorization'].slice(7); // strip 'Bearer '
    if (!token || token === lastSavedToken) return;
    lastSavedToken = token;

    // Save token + all captured custom headers together
    chrome.runtime.sendMessage({
      type: 'SAVE_TOKEN',
      token,
      extraHeaders: {
        'arxiv-pageview-id':  headers['arxiv-pageview-id']  || '',
        'arxiv-session-id':   headers['arxiv-session-id']   || '',
        'user-session-id':    headers['user-session-id']    || '',
        'client-commit-hash': headers['client-commit-hash'] || '/client',
      },
    });
  });
})();
