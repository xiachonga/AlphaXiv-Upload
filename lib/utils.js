/**
 * Mask a token for display — shows only the last 4 characters.
 * @param {string} token
 * @returns {string}
 */
function maskToken(token) {
  if (!token || token.length < 4) return '****';
  return '****' + token.slice(-4);
}

/**
 * Convert a paper title to a safe filename (no special chars, max 80 chars).
 * @param {string} title
 * @returns {string}
 */
function sanitizeFilename(title) {
  return title
    .replace(/[^\w\s\-\.]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80)
    .replace(/[_]+$/, '') + '.pdf';
}

/**
 * Check that an ArrayBuffer starts with the PDF magic bytes "%PDF".
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
function validatePDFMagicBytes(buffer) {
  const bytes = new Uint8Array(buffer, 0, 4);
  // %PDF = 0x25 0x50 0x44 0x46
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Convert an ArrayBuffer to a Base64 string without blowing the call stack.
 * Processes in 8 KB chunks.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
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

/**
 * Format a byte count into a human-readable string (e.g. "3.2 MB").
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
