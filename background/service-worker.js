/**
 * AlphaXiv Paper Uploader — background service worker (Manifest V3).
 *
 * Message types handled:
 *   PAPER_DETECTED      — content script found a paper; cache it
 *   GET_CURRENT_PAPER   — popup requests current tab's paper info
 *   GET_TOKEN           — popup / options requests stored token
 *   SAVE_TOKEN          — options page saves a new token
 *   AUTO_DETECT_TOKEN   — attempt to read token from open alphaxiv.org tab
 *   TEST_TOKEN          — validate a token against the API
 *   UPLOAD_PAPER        — download PDF and upload to AlphaXiv private library
 */

'use strict';

// In-memory cache: tabId → paperInfo  (survives within SW lifetime)
const paperCache = new Map();

// ─── Utility: chunk-safe ArrayBuffer → Base64 ──────────────────────────────
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// ─── Utility: validate %PDF magic bytes ────────────────────────────────────
function validatePDFMagicBytes(buffer) {
  const bytes = new Uint8Array(buffer, 0, 4);
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

// ─── Storage helpers ────────────────────────────────────────────────────────
async function getToken() {
  const result = await chrome.storage.local.get('authToken');
  return result.authToken || null;
}

async function getExtraHeaders() {
  const result = await chrome.storage.local.get('extraHeaders');
  return result.extraHeaders || {};
}

// ─── Get a fresh token from Clerk's __session cookie ─────────────────────────
// Clerk stores the JWT in the __session cookie (not httpOnly), and refreshes it
// automatically every ~55 seconds while the page is open.
// We read it directly via chrome.cookies — no tab injection needed.
async function getFreshToken() {
  const urls = ['https://www.alphaxiv.org', 'https://alphaxiv.org'];
  // Try versioned cookie first (e.g. __session_XhMTI0bs), then plain __session
  const names = ['__session_XhMTI0bs', '__session'];

  for (const url of urls) {
    for (const name of names) {
      try {
        const cookie = await chrome.cookies.get({ url, name });
        if (cookie && cookie.value && cookie.value.startsWith('eyJ')) {
          return cookie.value;
        }
      } catch (_) {}
    }
  }

  // Fallback: enumerate all alphaxiv.org cookies and find a JWT-shaped one
  try {
    const all = await chrome.cookies.getAll({ domain: 'alphaxiv.org' });
    for (const c of all) {
      if (c.value && c.value.startsWith('eyJ') && c.value.includes('.')) {
        return c.value;
      }
    }
  } catch (_) {}

  return null;
}

async function saveToken(token, extraHeaders) {
  const data = { authToken: token };
  if (extraHeaders && Object.keys(extraHeaders).length) {
    data.extraHeaders = extraHeaders;
  }
  await chrome.storage.local.set(data);
}

// ─── Auto-detect token from open alphaxiv.org tab ──────────────────────────
async function autoDetectToken() {
  const [tabs1, tabs2] = await Promise.all([
    chrome.tabs.query({ url: 'https://alphaxiv.org/*' }),
    chrome.tabs.query({ url: 'https://www.alphaxiv.org/*' }),
  ]);
  const tabs = [...tabs1, ...tabs2];
  if (!tabs.length) {
    return { success: false, error: 'No alphaxiv.org tab found. Please open alphaxiv.org and log in first.' };
  }

  // Strategy 1: Inject into the tab and scan ALL localStorage & sessionStorage keys
  for (const tab of tabs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const dump = {};

          // Scan all localStorage
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            dump['localStorage.' + key] = localStorage.getItem(key);
          }
          // Scan all sessionStorage
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            dump['sessionStorage.' + key] = sessionStorage.getItem(key);
          }

          // Look for token-like values (JWT or long hex strings)
          const tokenKeys = ['token', 'auth', 'access', 'session', 'jwt', 'bearer', 'key', 'credential'];
          let bestGuess = null;
          for (const [fullKey, val] of Object.entries(dump)) {
            if (!val || val.length < 10) continue;
            const lk = fullKey.toLowerCase();
            for (const tk of tokenKeys) {
              if (lk.includes(tk)) {
                // Prefer JWT-shaped values (eyJ...)
                if (val.startsWith('eyJ')) return { token: val, key: fullKey, source: 'storage-jwt' };
                if (!bestGuess) bestGuess = { token: val, key: fullKey, source: 'storage-keyword' };
              }
            }
            // Also detect JWT anywhere
            if (!bestGuess && val.startsWith('eyJ') && val.includes('.')) {
              bestGuess = { token: val, key: fullKey, source: 'storage-jwt-scan' };
            }
          }

          return bestGuess || { dump, token: null };
        },
        args: [],
      });

      if (results && results[0] && results[0].result) {
        const r = results[0].result;
        if (r.token) {
          await saveToken(r.token);
          return { success: true, token: r.token, detectedKey: r.key, source: r.source };
        }
        // No token found — return the dump for diagnostic
        return { success: false, storageDump: r.dump, error: 'No token-like value found in storage. See dump below.' };
      }
    } catch (err) {
      console.warn('Failed to inject into tab', tab.id, err.message);
    }
  }

  // Strategy 2: Check cookies for alphaxiv.org
  let cookieInfo = [];
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'alphaxiv.org' });
    cookieInfo = cookies.map((c) => ({
      name: c.name,
      valuePreview: c.value.length > 20 ? c.value.slice(0, 20) + '…' : c.value,
      valueLength: c.value.length,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }));

    // Look for a token-like cookie
    for (const c of cookies) {
      const ln = c.name.toLowerCase();
      if ((ln.includes('token') || ln.includes('session') || ln.includes('auth') || ln.includes('jwt')) && c.value.length > 10) {
        await saveToken(c.value);
        return { success: true, token: c.value, detectedKey: 'cookie:' + c.name, source: 'cookie' };
      }
    }
  } catch (err) {
    console.warn('Cookie read failed', err.message);
  }

  return {
    success: false,
    cookies: cookieInfo,
    error: 'Could not find auth token automatically. Check the diagnostic dump, or enter the token manually (DevTools → Network tab → look for "Authorization: Bearer ..." header).',
  };
}

// ─── Dump Clerk state for diagnostic ─────────────────────────────────────────
async function dumpClerkState() {
  const [tabs1, tabs2] = await Promise.all([
    chrome.tabs.query({ url: 'https://alphaxiv.org/*' }),
    chrome.tabs.query({ url: 'https://www.alphaxiv.org/*' }),
  ]);
  const tabs = [...tabs1, ...tabs2];
  if (!tabs.length) return { error: 'No alphaxiv.org tab open' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: async () => {
      const info = {};
      info.hasClerk = typeof window.Clerk !== 'undefined';
      if (window.Clerk) {
        info.clerkKeys = Object.keys(window.Clerk);
        info.hasSession = !!window.Clerk.session;
        if (window.Clerk.session) {
          info.sessionKeys = Object.keys(window.Clerk.session);
          info.sessionStatus = window.Clerk.session.status;
          try {
            const t = await window.Clerk.session.getToken();
            info.tokenPreview = t ? t.slice(0, 20) + '…' : null;
          } catch (e) {
            info.getTokenError = e.message;
          }
        }
        info.hasUser = !!window.Clerk.user;
        if (window.Clerk.user) {
          info.userId = window.Clerk.user.id;
        }
      }
      // Also check __clerk_db_jwt cookie pattern
      info.clerkCookies = document.cookie
        .split(';')
        .map(c => c.trim().split('=')[0])
        .filter(n => n.toLowerCase().includes('clerk') || n.toLowerCase().includes('session'));
      return info;
    },
  });
  return results && results[0] ? results[0].result : { error: 'Script returned nothing' };
}

// ─── Dump all storage for diagnostic ────────────────────────────────────────
async function dumpAlphaxivStorage() {
  const [tabs1, tabs2] = await Promise.all([
    chrome.tabs.query({ url: 'https://alphaxiv.org/*' }),
    chrome.tabs.query({ url: 'https://www.alphaxiv.org/*' }),
  ]);
  const tabs = [...tabs1, ...tabs2];
  if (!tabs.length) {
    return { error: 'No alphaxiv.org tab open.' };
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: () => {
      const data = { localStorage: {}, sessionStorage: {} };
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        data.localStorage[key] = val && val.length > 200 ? val.slice(0, 200) + '…' : val;
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const val = sessionStorage.getItem(key);
        data.sessionStorage[key] = val && val.length > 200 ? val.slice(0, 200) + '…' : val;
      }
      return data;
    },
    args: [],
  });

  let cookies = [];
  try {
    const all = await chrome.cookies.getAll({ domain: 'alphaxiv.org' });
    cookies = all.map((c) => ({
      name: c.name,
      value: c.value.length > 100 ? c.value.slice(0, 100) + '…' : c.value,
      httpOnly: c.httpOnly,
    }));
  } catch (_) {}

  return {
    storage: results && results[0] ? results[0].result : null,
    cookies,
  };
}

// ─── Test token validity ────────────────────────────────────────────────────
async function testToken(token) {
  try {
    const resp = await fetch('https://api.alphaxiv.org/v2/papers/private', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) return { valid: false, error: 'Token is invalid or expired (401).' };
    if (resp.status === 403) return { valid: false, error: 'Token does not have permission (403).' };
    // 200 or 404/405 all mean the server accepted our credentials
    return { valid: true };
  } catch (err) {
    return { valid: false, error: 'Network error: ' + err.message };
  }
}

// ─── Extract paper info directly from a tab URL (no content script needed) ──
function paperFromTabUrl(tab) {
  if (!tab || !tab.url) return null;
  const url = tab.url;

  // ACM: https://dl.acm.org/doi/10.1145/...
  const acmMatch = url.match(/https:\/\/dl\.acm\.org\/doi\/(?:pdf\/|abs\/|epdf\/)?(.+?)(?:\?|#|$)/);
  if (acmMatch) {
    const doi = acmMatch[1];
    const pdfUrl = `https://dl.acm.org/doi/pdf/${doi}`;
    const title = (tab.title || doi).replace(/\s*\|.*$/, '').trim();
    return { title, pdfUrl, source: 'acm', pageUrl: url };
  }

  // IEEE abstract page: https://ieeexplore.ieee.org/document/NNNNNNN
  const ieeeMatch = url.match(/https:\/\/ieeexplore\.ieee\.org\/document\/(\d+)/);
  if (ieeeMatch) {
    const arnumber = ieeeMatch[1];
    const pdfUrl = `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${arnumber}`;
    const title = (tab.title || `IEEE Document ${arnumber}`).replace(/\s*\|.*$/, '').trim();
    return { title, pdfUrl, source: 'ieee', pageUrl: url };
  }

  // IEEE stamp viewer (the PDF page itself): stamp.jsp?tp=&arnumber=NNNNNNN
  const ieeeStampMatch = url.match(/ieeexplore\.ieee\.org\/stamp\/stamp\.jsp.*[?&]arnumber=(\d+)/);
  if (ieeeStampMatch) {
    const arnumber = ieeeStampMatch[1];
    const title = (tab.title || `IEEE Document ${arnumber}`).replace(/\s*\|.*$/, '').trim();
    return { title, pdfUrl: url, source: 'ieee', pageUrl: url };
  }

  // Generic: any URL ending with .pdf, or known PDF-serving patterns (arXiv, etc.)
  const isPdf = /\.pdf(\?[^#]*)?(#.*)?$/i.test(url)
    || /arxiv\.org\/(pdf|abs)\//.test(url);
  if (isPdf && url.startsWith('http')) {
    // For arXiv abs pages, redirect to the PDF URL
    const pdfUrl = url.replace('arxiv.org/abs/', 'arxiv.org/pdf/');
    const filename = pdfUrl.split('/').pop().split('?')[0] || 'document.pdf';
    const title = (tab.title || filename.replace(/\.pdf$/i, '')).replace(/\s*[-|–]\s*.*$/, '').trim();
    return { title, pdfUrl, source: 'web', pageUrl: url };
  }

  return null;
}

// ─── Upload paper ───────────────────────────────────────────────────────────
async function uploadPaper(tabId) {
  // 1. Get a fresh token from the live alphaxiv.org tab (bypasses 60s expiry).
  //    Falls back to the last token saved in storage.
  const token = (await getFreshToken()) || (await getToken());
  if (!token) {
    return { success: false, error: '未找到 Token：请先打开 alphaxiv.org 并登录，然后重试' };
  }

  // 2. Get paper info — URL parsing first, then cache, then content script
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch (_) {}

  let paper = paperFromTabUrl(tab)
    || paperCache.get(tabId)
    || null;

  // Best-effort content script query for a better title
  const csPaper = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2000);
    chrome.tabs.sendMessage(tabId, { type: 'GET_PAPER_INFO' }, (resp) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp && resp.paper ? resp.paper : null);
    });
  });
  if (csPaper) paper = csPaper;

  if (!paper || !paper.pdfUrl) {
    return { success: false, error: '未找到 PDF 链接（请在 PDF 页面或 ACM/IEEE 论文页使用）' };
  }

  // 3. Download PDF.
  //    Injected into the source tab for ACM/IEEE/generic (uses institutional/IP auth cookies).
  //    Fetched directly from SW for public PDFs (arXiv, etc.).
  const tabPdfFetcher = async (startUrl) => {
    const toBuf = async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return { error: `HTTP ${r.status}`, status: r.status };
      return r.arrayBuffer();
    };

    const isPdf = (buf) => {
      const b = new Uint8Array(buf, 0, 4);
      return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    };

    // Return raw bytes as Array (structured clone friendly, avoids base64 in tab)
    const toResult = (buf) => ({ bytes: Array.from(new Uint8Array(buf)), size: buf.byteLength });

    // First try fetching the URL directly
    let bufOrErr = await toBuf(startUrl);
    if (bufOrErr.error) return bufOrErr;

    if (isPdf(bufOrErr)) return toResult(bufOrErr);

    // Got HTML — look for the real PDF URL inside the page DOM
    // (IEEE stamp.jsp embeds the PDF in an iframe)
    const candidates = [
      ...Array.from(document.querySelectorAll('iframe[src]')).map(el => el.src),
      ...Array.from(document.querySelectorAll('embed[src],object[data]'))
           .map(el => el.src || el.data),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const abs = new URL(candidate, location.href).href;
      const b = await toBuf(abs);
      if (!b.error && isPdf(b)) return toResult(b);
    }

    // Last resort: look for a link/anchor href ending in .pdf
    const pdfLink = document.querySelector('a[href$=".pdf"]');
    if (pdfLink) {
      const abs = new URL(pdfLink.href, location.href).href;
      const b = await toBuf(abs);
      if (!b.error && isPdf(b)) return toResult(b);
    }

    return { error: 'NOT_PDF' };
  };

  let pdfBuffer, fileSize;
  try {
    let result;
    if (paper.source === 'acm' || paper.source === 'ieee' || paper.source === 'generic' || paper.source === 'context-menu') {
      // Inject into the source tab — reuses its authenticated network context
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        func: tabPdfFetcher,
        args: [paper.pdfUrl],
      });
      result = injected && injected[0] && injected[0].result;
      if (!result) return { success: false, error: 'PDF 下载失败：注入脚本无返回值' };
    } else {
      // Public PDFs (arXiv, etc.) — fetch directly from service worker
      const resp = await fetch(paper.pdfUrl, { credentials: 'include' });
      if (!resp.ok) result = { error: `HTTP ${resp.status}` };
      else {
        const buf = await resp.arrayBuffer();
        if (!validatePDFMagicBytes(buf)) result = { error: 'NOT_PDF' };
        else result = { bytes: Array.from(new Uint8Array(buf)), size: buf.byteLength };
      }
    }

    if (result.error === 'NOT_PDF') {
      return { success: false, error: '该页面未找到可下载的 PDF 文件' };
    }
    if (result.error) {
      return { success: false, error: `PDF 下载失败：${result.error}` };
    }
    pdfBuffer = new Uint8Array(result.bytes);
    fileSize = result.size;
  } catch (err) {
    return { success: false, error: 'PDF 下载异常：' + err.message };
  }

  // 4. Convert to base64 and upload directly from the service worker.
  //    Extension SW with host_permissions is not subject to CORS — no need to
  //    inject into the alphaxiv.org tab, saving a full IPC round-trip of the PDF data.
  const base64pdf = arrayBufferToBase64(pdfBuffer.buffer);
  const filename = paper.title.replace(/[^\w\s\-\.]/g, '').replace(/\s+/g, '_').slice(0, 80) + '.pdf';
  const extraHeaders = await getExtraHeaders();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (extraHeaders['arxiv-pageview-id'])  headers['arxiv-pageview-id']  = extraHeaders['arxiv-pageview-id'];
  if (extraHeaders['arxiv-session-id'])   headers['arxiv-session-id']   = extraHeaders['arxiv-session-id'];
  if (extraHeaders['user-session-id'])    headers['user-session-id']    = extraHeaders['user-session-id'];
  if (extraHeaders['client-commit-hash']) headers['client-commit-hash'] = extraHeaders['client-commit-hash'];

  let resp;
  try {
    resp = await fetch('https://api.alphaxiv.org/v2/papers/private', {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename, contentType: 'application/pdf', file: base64pdf }),
    });
  } catch (err) {
    return { success: false, error: '上传请求失败：' + err.message };
  }

  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}

  if (!resp.ok) {
    const candidate = json && (json.message || json.error || json.detail);
    const serverMsg = typeof candidate === 'string'
      ? candidate
      : (json ? JSON.stringify(json, null, 2) : text.slice(0, 400) || '（无响应体）');
    return { success: false, error: `上传失败 HTTP ${resp.status}`, serverMessage: serverMsg };
  }

  return { success: true, data: json || {}, fileSize };
}

// ─── Context menu ───────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'upload-to-alphaxiv',
      title: 'Upload PDF to AlphaXiv',
      contexts: ['link', 'page'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'upload-to-alphaxiv') return;

  // Determine the PDF URL: prefer clicked link, fallback to current page
  const targetUrl = info.linkUrl || info.pageUrl;
  if (!targetUrl) return;

  // Build a paper object for upload
  const title = (tab.title || 'document').replace(/\s*[-|–—]\s*.*$/, '').trim();
  const paper = { title, pdfUrl: targetUrl, source: 'context-menu', pageUrl: tab.url };
  paperCache.set(tab.id, paper);

  // Show uploading badge
  chrome.action.setBadgeText({ text: '…', tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color: '#666', tabId: tab.id });

  const result = await uploadPaper(tab.id);

  if (result.success) {
    chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId: tab.id });
  } else {
    chrome.action.setBadgeText({ text: '✗', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#F44336', tabId: tab.id });
    console.error('Context menu upload failed:', result.error, result.serverMessage);
  }

  // Clear badge after 5 seconds
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 5000);
});

// ─── Message router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  switch (msg.type) {
    case 'PAPER_DETECTED':
      if (tabId && msg.paper) {
        paperCache.set(tabId, msg.paper);
      }
      sendResponse({ ok: true });
      break;

    case 'GET_CURRENT_PAPER':
      (async () => {
        const id = msg.tabId;

        // Step 1: get the tab so we can parse its URL directly — most reliable
        let tab = null;
        try { tab = await chrome.tabs.get(id); } catch (_) {}
        let paper = paperFromTabUrl(tab);

        // Step 2: try cache (may have a better title from content script)
        const cached = paperCache.get(id);
        if (cached) paper = cached;

        // Step 3: try asking content script (works for generic sites like Springer, SIAM, etc.)
        if (id) {
          const cs = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), 2000);
            chrome.tabs.sendMessage(id, { type: 'GET_PAPER_INFO' }, (resp) => {
              clearTimeout(timer);
              if (chrome.runtime.lastError) { resolve(null); return; }
              resolve(resp && resp.paper ? resp.paper : null);
            });
          });
          if (cs) { paper = cs; paperCache.set(id, cs); }
        }

        sendResponse({ paper: paper || null });
      })();
      return true;

    case 'GET_TOKEN':
      getToken().then((token) => sendResponse({ token }));
      return true;

    case 'SAVE_TOKEN':
      saveToken(msg.token, msg.extraHeaders).then(() => sendResponse({ ok: true }));
      return true;

    case 'AUTO_DETECT_TOKEN':
      autoDetectToken().then(sendResponse);
      return true;

    case 'TEST_TOKEN':
      testToken(msg.token).then(sendResponse);
      return true;

    case 'UPLOAD_PAPER':
      uploadPaper(msg.tabId).then(sendResponse);
      return true;

    case 'DUMP_STORAGE':
      dumpAlphaxivStorage().then(sendResponse);
      return true;

    case 'DUMP_CLERK':
      dumpClerkState().then(sendResponse);
      return true;

    default:
      sendResponse({ error: 'Unknown message type: ' + msg.type });
  }
});
