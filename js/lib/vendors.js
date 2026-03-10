// Thin wrappers around vendored global libraries
// Modules import from here instead of reaching into window globals directly.

/**
 * Get the JSZip constructor.
 * @returns {typeof JSZip}
 */
export function getJSZip() {
  if (!window.JSZip) {
    throw new Error('JSZip library not loaded. Ensure lib/jszip.min.js is included before the app module.');
  }
  return window.JSZip;
}

/**
 * Get the Soundfont namespace.
 * @returns {object|null} - Soundfont global, or null if not loaded
 */
export function getSoundfont() {
  return window.Soundfont || null;
}
