/**
 * IEEE Xplore content script.
 * IEEE is a SPA — we must wait for the Angular app to hydrate before reading paper data.
 */
(function () {
  'use strict';

  let paperInfo = null;

  function tryDetect() {
    // Prefer the global xplGlobal object populated by the SPA
    const xpl = window.xplGlobal;
    if (xpl && xpl.document && xpl.document.arnumber) {
      const arnumber = xpl.document.arnumber;
      const title = xpl.document.title || document.title.replace(' | IEEE Xplore', '').trim();
      const pdfUrl = `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${arnumber}`;
      return { title, pdfUrl, source: 'ieee', pageUrl: window.location.href };
    }

    // Fallback: read from the page meta tags
    const metaTitle = document.querySelector('meta[property="og:title"]');
    const titleText = metaTitle
      ? metaTitle.content.trim()
      : document.title.replace(' | IEEE Xplore', '').trim();

    // Extract article number from the URL: /document/<id>
    const match = window.location.pathname.match(/\/document\/(\d+)/);
    if (!match) return null;
    const arnumber = match[1];
    const pdfUrl = `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${arnumber}`;

    if (!titleText) return null;
    return { title: titleText, pdfUrl, source: 'ieee', pageUrl: window.location.href };
  }

  function init() {
    // Try immediately first
    paperInfo = tryDetect();
    if (paperInfo) {
      chrome.runtime.sendMessage({ type: 'PAPER_DETECTED', paper: paperInfo });
      return;
    }

    // IEEE SPA: wait up to 5 s for the content to render
    const deadline = Date.now() + 5000;
    const observer = new MutationObserver(() => {
      paperInfo = tryDetect();
      if (paperInfo) {
        observer.disconnect();
        chrome.runtime.sendMessage({ type: 'PAPER_DETECTED', paper: paperInfo });
      } else if (Date.now() > deadline) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Respond to queries from popup / service worker
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_PAPER_INFO') {
      paperInfo = tryDetect();
      sendResponse({ paper: paperInfo });
    }
    return true;
  });

  init();
})();
