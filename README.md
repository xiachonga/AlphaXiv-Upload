# AlphaXiv Paper Uploader

A Chrome extension that uploads academic PDFs to your [AlphaXiv](https://www.alphaxiv.org) private library with one click.

## Supported Sources

| Source | URL Pattern |
|---|---|
| ACM Digital Library | `dl.acm.org/doi/...` |
| IEEE Xplore | `ieeexplore.ieee.org/document/...` or `stamp.jsp?arnumber=...` |
| arXiv | `arxiv.org/pdf/...` or `arxiv.org/abs/...` |
| Any PDF | Any `https://.../*.pdf` URL open in Chrome |

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
2. The extension automatically captures your session token from the page — no manual steps needed
3. The token is refreshed automatically on every use via Clerk's session API

### Get your AlphaXiv token (manual fallback)

1. On alphaxiv.org, open DevTools → **Network** tab
2. Refresh the page, click any request to `api.alphaxiv.org`
3. Copy the value after `Authorization: Bearer ` in the request headers
4. Open the extension's **Settings** page (⚙ icon in the popup) and paste it

## Usage

1. Keep an **alphaxiv.org** tab open and logged in (required for authentication)
2. Navigate to an ACM, IEEE, arXiv, or any PDF page
3. Click the extension icon in the toolbar
4. Click **Upload to Private Library**

The PDF is downloaded using your browser's existing session (institutional IP access, cookies, etc.) and uploaded to your AlphaXiv private library.

## File Structure

```
AlphaXiv-Upload/
├── manifest.json
├── background/
│   └── service-worker.js   # Message routing, PDF download, upload logic
├── content/
│   ├── acm.js              # ACM DL paper detection
│   ├── ieee.js             # IEEE Xplore paper detection
│   └── alphaxiv.js         # Auto token capture from alphaxiv.org
├── popup/
│   ├── popup.html/js/css   # Extension popup UI
├── options/
│   ├── options.html/js/css # Settings page (token management)
├── lib/
│   └── utils.js            # Shared utilities
└── icons/
```

## How it works

1. **Paper detection** — The service worker parses the active tab's URL to extract the paper title and PDF URL. No DOM scraping needed for ACM, IEEE, or arXiv.
2. **Token** — At upload time, a fresh JWT is obtained by calling `window.Clerk.session.getToken()` injected into the open alphaxiv.org tab. This bypasses the 60-second token expiry.
3. **PDF download** — A script is injected into the source tab (ACM/IEEE) so the fetch inherits the tab's network context (institutional access, cookies). For public PDFs the service worker fetches directly.
4. **Upload** — The PDF is base64-encoded and POSTed to `https://api.alphaxiv.org/v2/papers/private` from within the alphaxiv.org tab context to satisfy CORS requirements.

## Requirements

- Chrome (or any Chromium-based browser)
- An [AlphaXiv](https://www.alphaxiv.org) account
- For ACM/IEEE: institutional network access or a logged-in account
