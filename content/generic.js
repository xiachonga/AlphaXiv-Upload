'use strict';

(function () {
  // Known publisher PDF URL patterns
  const pdfSelectors = [
    'a[href$=".pdf"]',
    'a[href*="/content/pdf/"]',
    'a[href*="/pdf/"]',
    'embed[type="application/pdf"]',
    'iframe[src*=".pdf"]',
    'object[type="application/pdf"]',
  ];

  function findPdfByText() {
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
      const text = (a.textContent || '').trim().toLowerCase();
      if (/\bdownload\s*pdf\b|\bview\s*pdf\b|\bfull[- ]?text\s*pdf\b/.test(text)) {
        return a.href;
      }
    }
    return null;
  }

  function detectPdfUrl() {
    // If the page itself is a PDF
    if (document.contentType === 'application/pdf') return location.href;

    for (const sel of pdfSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const url = el.href || el.src || el.data;
        if (url) return new URL(url, location.href).href;
      }
    }
    return findPdfByText();
  }

  function getTitle() {
    const metaCitation = document.querySelector('meta[name="citation_title"]');
    if (metaCitation) return metaCitation.content;

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) return ogTitle.content;

    const h1 = document.querySelector('h1');
    if (h1) {
      const text = h1.textContent.trim();
      if (text.length > 5 && text.length < 300) return text;
    }

    return (document.title || 'document').replace(/\s*[-|–—]\s*.*$/, '').trim();
  }

  function buildPaperInfo() {
    const pdfUrl = detectPdfUrl();
    if (!pdfUrl) return null;
    const title = getTitle();
    return { title, pdfUrl, source: 'generic', pageUrl: location.href };
  }

  // Send paper info on page load
  const paper = buildPaperInfo();
  if (paper) {
    chrome.runtime.sendMessage({ type: 'PAPER_DETECTED', paper }, () => {
      void chrome.runtime.lastError; // suppress unconnected errors
    });
  }

  // Respond to GET_PAPER_INFO queries from the background script
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_PAPER_INFO') {
      sendResponse({ paper: buildPaperInfo() });
    }
  });
})();
