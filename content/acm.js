/**
 * ACM Digital Library content script.
 * Detects paper title and PDF URL, then notifies the service worker.
 */
(function () {
  'use strict';

  let paperInfo = null;

  function detectPaper() {
    // Extract title — ACM uses several possible selectors
    const titleEl =
      document.querySelector('h1.citation__title') ||
      document.querySelector('.citation__title') ||
      document.querySelector('h1.article-title') ||
      document.querySelector('[class*="citation"] h1') ||
      document.querySelector('article h1');
    if (!titleEl) return null;
    const title = titleEl.textContent.trim();
    if (!title) return null;

    // Look for a direct PDF link — ACM uses /doi/pdf/ and sometimes /doi/epdf/
    const pdfLink =
      document.querySelector('a[href*="/doi/pdf/"]') ||
      document.querySelector('a[href*="/doi/epdf/"]');

    let pdfUrl = null;
    if (pdfLink) {
      pdfUrl = pdfLink.href;
      // Prefer /doi/pdf/ over /doi/epdf/ (epdf is the enhanced reader, pdf is the raw file)
      pdfUrl = pdfUrl.replace('/doi/epdf/', '/doi/pdf/');
    } else {
      // Fallback: construct from the current DOI URL
      const doiMatch = window.location.pathname.match(/\/doi\/([\d.]+\/.+?)(?:\?|$)/);
      if (doiMatch) {
        pdfUrl = 'https://dl.acm.org/doi/pdf/' + doiMatch[1];
      }
    }

    if (!pdfUrl) return null;

    // Ensure absolute URL
    if (pdfUrl.startsWith('/')) {
      pdfUrl = 'https://dl.acm.org' + pdfUrl;
    }

    return { title, pdfUrl, source: 'acm', pageUrl: window.location.href };
  }

  function init() {
    paperInfo = detectPaper();
    if (paperInfo) {
      chrome.runtime.sendMessage({ type: 'PAPER_DETECTED', paper: paperInfo });
      return;
    }

    // ACM may lazy-load content; wait up to 5 seconds
    const deadline = Date.now() + 5000;
    const observer = new MutationObserver(() => {
      paperInfo = detectPaper();
      if (paperInfo) {
        observer.disconnect();
        chrome.runtime.sendMessage({ type: 'PAPER_DETECTED', paper: paperInfo });
      } else if (Date.now() > deadline) {
        observer.disconnect();
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Respond to queries from the popup / service worker
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_PAPER_INFO') {
      // Re-detect in case the page updated
      paperInfo = detectPaper();
      sendResponse({ paper: paperInfo });
    }
    return true; // keep channel open for async
  });

  // Run on DOM ready or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
