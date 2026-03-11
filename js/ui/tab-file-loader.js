// Tab file loader: file picker, validation, GP parsing, track list building

import { parseGPFile } from '../tab/gp-parser.js';
import { buildTimeline } from '../tab/timeline.js';
import { buildButton } from './dom-helpers.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ACCEPTED_EXTENSIONS = ['.gp'];

/**
 * Validate a file before parsing.
 * @param {File} file
 * @returns {string|null} error message, or null if valid
 */
function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`;
  }
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return `Unsupported format "${ext}". Only modern Guitar Pro (.gp) files are supported.`;
  }
  return null;
}

/**
 * Build timelines for all tracks in a score.
 * @param {object} score - parsed GP score
 * @returns {Array} allTrackData - [{ trackIndex, timeline, measures, isDrum, tuning }]
 */
export function buildAllTracks(score) {
  const allTrackData = [];
  score.tracks.forEach((t, i) => {
    const { timeline, measures } = buildTimeline(score, i);
    if (timeline.length === 0) return;
    allTrackData.push({
      trackIndex: i,
      timeline,
      measures,
      isDrum: t.isDrum,
      tuning: t.tuning,
      title: score.title,
      artist: score.artist,
      name: t.name, // Track name (e.g. "Steel Guitar")
    });
  });
  return allTrackData;
}

/**
 * Create the file loader UI and return its elements + load handler.
 * @param {object} callbacks - { onFileLoaded(score, allTrackData) }
 * @returns {{ fileBtn: HTMLButtonElement, fileInput: HTMLInputElement }}
 */
export function createFileLoader(callbacks) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.gp';
  fileInput.style.display = 'none';

  const fileBtn = buildButton('Open GP File');
  fileBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      fileBtn.textContent = validationError;
      setTimeout(() => { fileBtn.textContent = 'Open GP File'; }, 3000);
      return;
    }

    fileBtn.textContent = 'Loading...';
    try {
      const buf = await file.arrayBuffer();
      const score = await parseGPFile(buf);
      const allTrackData = buildAllTracks(score);

      fileBtn.textContent = 'Open GP File';
      callbacks.onFileLoaded(score, allTrackData);
    } catch (err) {
      console.error('GP parse error:', err);
      const msg = err.message || 'Unknown parsing error';
      fileBtn.textContent = msg;
      setTimeout(() => { fileBtn.textContent = 'Open GP File'; }, 5000);
    }
  });

  return { fileBtn, fileInput };
}
