'use strict';

// ─── State management ────────────────────────────────────────────────────────
const states = ['no-paper', 'no-token', 'ready', 'uploading', 'success', 'error'];

function showState(name) {
  for (const s of states) {
    const el = document.getElementById('state-' + s);
    if (el) el.classList.toggle('hidden', s !== name);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sendMessage(payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Service worker did not respond in time')), timeoutMs);
    chrome.runtime.sendMessage(payload, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Settings button — always available
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showState('no-paper'); return; }

  let paper = null;
  let token = null;

  // Parallel: fetch paper info and token (catch individually so one failure doesn't kill the other)
  const [paperResult, tokenResult] = await Promise.allSettled([
    sendMessage({ type: 'GET_CURRENT_PAPER', tabId: tab.id }),
    sendMessage({ type: 'GET_TOKEN' }),
  ]);
  if (paperResult.status === 'fulfilled' && paperResult.value) {
    paper = paperResult.value.paper;
  }
  if (tokenResult.status === 'fulfilled' && tokenResult.value) {
    token = tokenResult.value.token;
  }

  if (!paper) {
    showState('no-paper');
    return;
  }

  if (!token) {
    document.getElementById('title-no-token').textContent = paper.title;
    showState('no-token');
    document.getElementById('btn-open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  // Ready state
  document.getElementById('title-ready').textContent = paper.title;
  const badgeLabel = { acm: 'ACM DL', ieee: 'IEEE', web: 'PDF', generic: 'PDF', 'context-menu': 'PDF' };
  document.getElementById('source-badge').textContent = badgeLabel[paper.source] || 'PDF';
  showState('ready');

  // Upload button
  document.getElementById('btn-upload').addEventListener('click', async () => {
    showState('uploading');

    let result;
    try {
      result = await sendMessage({ type: 'UPLOAD_PAPER', tabId: tab.id }, 60000);
    } catch (err) {
      result = { success: false, error: err.message };
    }

    if (result && result.success) {
      const sizeTxt = result.fileSize
        ? ` (${(result.fileSize / 1024 / 1024).toFixed(1)} MB)`
        : '';
      document.getElementById('success-detail').textContent =
        `"${paper.title.slice(0, 60)}"${sizeTxt} added to your private library.`;
      showState('success');
    } else {
      const mainErr = (result && result.error) || 'Unknown error occurred.';
      const serverMsg = result && result.serverMessage;
      document.getElementById('error-msg').textContent =
        serverMsg ? `${mainErr}\n\nServer: ${serverMsg}` : mainErr;
      showState('error');
    }
  });

  // Retry button
  document.getElementById('btn-retry').addEventListener('click', () => {
    showState('ready');
  });

  // Done button
  document.getElementById('btn-done').addEventListener('click', () => {
    window.close();
  });
});
