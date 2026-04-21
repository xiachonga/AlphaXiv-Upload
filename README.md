# AlphaXiv Paper Uploader

A Chrome extension that uploads academic PDFs to your [AlphaXiv](https://www.alphaxiv.org) private library with one click. Works with any publisher.

## Supported Sources

| Source | Detection |
|---|---|
| ACM Digital Library | Auto-detected from `dl.acm.org/doi/...` |
| IEEE Xplore | Auto-detected from `ieeexplore.ieee.org/document/...` |
| arXiv | Auto-detected from `arxiv.org/pdf/...` or `arxiv.org/abs/...` |
| Springer, Nature, SIAM, Wiley, PNAS, Science, etc. | Auto-detected via PDF links, `<meta>` tags, or embedded viewers |
| Any `.pdf` URL | Auto-detected from URL pattern |
| **Any page (right-click)** | Right-click any link or page → *Upload PDF to AlphaXiv* |

The generic detector works by scanning the page for PDF download links (`a[href$=".pdf"]`, `a[href*="/pdf/"]`), embedded PDF viewers (`<embed>`, `<iframe>`, `<object>`), and "Download PDF" buttons. Paper titles are extracted from `<meta name="citation_title">`, `og:title`, `<h1>`, or the page title.

## Installation

This extension is not yet on the Chrome Web Store. Load it manually:

1. Clone this repo:
   ```bash
   git clone git@github.com:xiachonga/AlphaXiv-Upload.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the cloned folder
5. The extension icon appears in your toolbar

To update after a `git pull`, click the refresh icon on the extension card in `chrome://extensions`.

## Setup

### Get your AlphaXiv token (automatic)

1. Open [alphaxiv.org](https://www.alphaxiv.org) in a tab and log in
2. The extension automatically reads your session token from the `__session` cookie — no manual steps needed
3. The token is refreshed automatically on every upload

### Get your AlphaXiv token (manual fallback)

1. On alphaxiv.org, open DevTools → **Network** tab
2. Refresh the page, click any request to `api.alphaxiv.org`
3. Copy the value after `Authorization: Bearer ` in the request headers
4. Open the extension's **Settings** page (gear icon in the popup) and paste it

## Usage

### Popup (one-click)

1. Navigate to any paper page (ACM, IEEE, arXiv, Springer, Nature, SIAM, etc.)
2. Click the extension icon in the toolbar
3. Click **Upload to Private Library**

### Right-click context menu

1. Right-click any PDF link on any page (or right-click the page itself)
2. Select **Upload PDF to AlphaXiv**
3. The upload status shows on the extension badge (check mark = success, X = failure)

The PDF is downloaded using your browser's existing session (institutional IP access, cookies, etc.) and uploaded to your AlphaXiv private library.

## File Structure

```
AlphaXiv-Upload/
├── manifest.json
├── background/
│   └── service-worker.js   # Message routing, PDF download, upload logic, context menu
├── content/
│   ├── acm.js              # ACM DL paper detection
│   ├── ieee.js             # IEEE Xplore paper detection
│   ├── generic.js          # Universal paper detection (any publisher)
│   └── alphaxiv.js         # Auto token capture from alphaxiv.org
├── popup/
│   ├── popup.html/js/css   # Extension popup UI
├── options/
│   ├── options.html/js/css # Settings page (token management)
├── lib/
│   └── utils.js            # Shared utilities
└── icons/
```

## How It Works

1. **Paper detection** — Site-specific content scripts (ACM, IEEE) or the generic detector (`generic.js`) identify the paper title and PDF URL. The service worker also parses the tab URL directly for known patterns (arXiv, ACM, IEEE).
2. **Token** — A fresh JWT is read from the `__session` cookie on `alphaxiv.org` via `chrome.cookies`. Falls back to stored token or auto-detection from open tabs.
3. **PDF download** — For publisher pages (ACM, IEEE, Springer, etc.), a script is injected into the source tab so the fetch inherits the tab's network context (institutional access, cookies). For public PDFs (arXiv), the service worker fetches directly.
4. **Upload** — The PDF is base64-encoded and POSTed to `https://api.alphaxiv.org/v2/papers/private` directly from the service worker.

## Disclaimer

This tool is intended **solely for personal, non-commercial research use**.

- **Personal use only.** This extension is designed to help individual researchers save papers they already have legitimate access to into their own private AlphaXiv library. It is not intended for any commercial purpose.
- **No bulk downloading.** The extension operates on a single paper at a time, triggered manually by the user. Modifying this software to perform automated or bulk downloading of papers from any publisher is **strictly prohibited** and likely violates their Terms of Service.
- **No redistribution.** Do not use this tool to download and redistribute copyrighted papers. Keep your AlphaXiv private library private.
- **Respect access rights.** Only use this extension to access papers you are legitimately authorized to access (e.g., through institutional subscription, open access, or personal license).
- **No warranty.** This software is provided as-is. The author assumes no liability for any misuse, ToS violations, or damages arising from use of this tool.
- **API stability.** This extension uses AlphaXiv's internal API, which may change without notice.

By using this extension, you agree to use it responsibly and in compliance with the terms of service of all platforms involved (AlphaXiv, ACM Digital Library, IEEE Xplore, arXiv, Springer, etc.).

## Requirements

- Chrome (or any Chromium-based browser)
- An [AlphaXiv](https://www.alphaxiv.org) account
- For paywalled papers: institutional network access or a logged-in publisher account
