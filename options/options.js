'use strict';

// ─── Utils ────────────────────────────────────────────────────────────────────
function maskToken(token) {
  if (!token || token.length < 4) return '****';
  return '****' + token.slice(-4);
}

function showBanner(id, message, type) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = 'result-banner ' + type;
}

function hideBanner(id) {
  document.getElementById(id).className = 'result-banner hidden';
}

function sendMessage(payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No response from background')), timeoutMs);
    chrome.runtime.sendMessage(payload, (resp) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

// ─── DOM refs ──────────────────────────────────────────────────────────────────
const tokenStatusEl   = document.getElementById('token-status');
const tokenPreviewEl  = document.getElementById('token-preview');
const tokenInput      = document.getElementById('token-input');
const btnAutoDetect   = document.getElementById('btn-auto-detect');
const btnSaveToken    = document.getElementById('btn-save-token');
const btnTestToken    = document.getElementById('btn-test-token');
const btnClearToken   = document.getElementById('btn-clear-token');
const btnToggleVis    = document.getElementById('btn-toggle-visibility');

// ─── Load current token ────────────────────────────────────────────────────────
async function loadCurrentToken() {
  const resp = await sendMessage({ type: 'GET_TOKEN' }).catch(() => null);
  const token = resp && resp.token;
  if (token) {
    tokenPreviewEl.textContent = maskToken(token);
    tokenStatusEl.classList.remove('hidden');
  } else {
    tokenStatusEl.classList.add('hidden');
  }
}

// ─── Auto-detect ───────────────────────────────────────────────────────────────
btnAutoDetect.addEventListener('click', async () => {
  btnAutoDetect.disabled = true;
  btnAutoDetect.textContent = 'Detecting…';
  hideBanner('auto-detect-result');

  try {
    const result = await sendMessage({ type: 'AUTO_DETECT_TOKEN' }, 15000);
    if (result && result.success) {
      const src = result.detectedKey ? ` (found in: ${result.detectedKey})` : '';
      showBanner('auto-detect-result', 'Token detected and saved!' + src, 'success');
      await loadCurrentToken();
    } else {
      let msg = (result && result.error) || 'Auto-detect failed.';
      // If we got a diagnostic dump, show it
      if (result && (result.storageDump || result.cookies)) {
        const dumpEl = document.getElementById('dump-output');
        dumpEl.textContent = JSON.stringify({ storageDump: result.storageDump, cookies: result.cookies }, null, 2);
        dumpEl.classList.remove('hidden');
      }
      showBanner('auto-detect-result', msg, 'error');
    }
  } catch (err) {
    showBanner('auto-detect-result', 'Error: ' + err.message, 'error');
  } finally {
    btnAutoDetect.disabled = false;
    btnAutoDetect.textContent = 'Auto-detect from alphaxiv.org';
  }
});

// ─── Toggle visibility ─────────────────────────────────────────────────────────
btnToggleVis.addEventListener('click', () => {
  const isPassword = tokenInput.type === 'password';
  tokenInput.type = isPassword ? 'text' : 'password';
  btnToggleVis.textContent = isPassword ? 'Hide' : 'Show';
});

// ─── Save token ────────────────────────────────────────────────────────────────
btnSaveToken.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showBanner('save-result', 'Please enter a token.', 'error');
    return;
  }

  btnSaveToken.disabled = true;
  hideBanner('save-result');
  hideBanner('test-result');

  try {
    await sendMessage({ type: 'SAVE_TOKEN', token });
    tokenInput.value = '';
    tokenInput.type = 'password';
    btnToggleVis.textContent = 'Show';
    showBanner('save-result', 'Token saved successfully.', 'success');
    await loadCurrentToken();
  } catch (err) {
    showBanner('save-result', 'Failed to save: ' + err.message, 'error');
  } finally {
    btnSaveToken.disabled = false;
  }
});

// ─── Test connection ───────────────────────────────────────────────────────────
btnTestToken.addEventListener('click', async () => {
  // Use input value if present, otherwise use saved token
  let token = tokenInput.value.trim();
  if (!token) {
    const resp = await sendMessage({ type: 'GET_TOKEN' }).catch(() => null);
    token = resp && resp.token;
  }
  if (!token) {
    showBanner('test-result', 'No token to test. Save or enter one first.', 'error');
    return;
  }

  btnTestToken.disabled = true;
  btnTestToken.textContent = 'Testing…';
  hideBanner('test-result');

  try {
    const result = await sendMessage({ type: 'TEST_TOKEN', token }, 15000);
    if (result && result.valid) {
      showBanner('test-result', 'Connection successful — token is valid!', 'success');
    } else {
      const msg = (result && result.error) || 'Token is invalid.';
      showBanner('test-result', msg, 'error');
    }
  } catch (err) {
    showBanner('test-result', 'Error: ' + err.message, 'error');
  } finally {
    btnTestToken.disabled = false;
    btnTestToken.textContent = 'Test Connection';
  }
});

// ─── Clear token ───────────────────────────────────────────────────────────────
btnClearToken.addEventListener('click', async () => {
  if (!confirm('Clear the saved token?')) return;
  await sendMessage({ type: 'SAVE_TOKEN', token: '' });
  tokenStatusEl.classList.add('hidden');
  showBanner('save-result', 'Token cleared.', 'info');
});

// ─── Dump Clerk state diagnostic ──────────────────────────────────────────────
document.getElementById('btn-dump-clerk').addEventListener('click', async () => {
  const btn = document.getElementById('btn-dump-clerk');
  const output = document.getElementById('dump-output');
  btn.disabled = true;
  btn.textContent = 'Dumping…';
  output.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'DUMP_CLERK' }, 15000);
    output.textContent = JSON.stringify(result, null, 2);
    output.classList.remove('hidden');
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
    output.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Dump Clerk State';
  }
});

// ─── Dump storage diagnostic ───────────────────────────────────────────────────
document.getElementById('btn-dump').addEventListener('click', async () => {
  const btn = document.getElementById('btn-dump');
  const output = document.getElementById('dump-output');
  btn.disabled = true;
  btn.textContent = 'Dumping…';
  output.classList.add('hidden');

  try {
    const result = await sendMessage({ type: 'DUMP_STORAGE' }, 15000);
    output.textContent = JSON.stringify(result, null, 2);
    output.classList.remove('hidden');
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
    output.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Dump alphaxiv.org Storage & Cookies';
  }
});

// ─── Init ──────────────────────────────────────────────────────────────────────
loadCurrentToken();
