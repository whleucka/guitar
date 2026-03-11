// FluidSynth WASM integration for high-quality tab playback
// Lazily loads SF2 on first use, caches in IndexedDB for subsequent loads.
// Provides noteOn/noteOff API that tab-player.js calls instead of synth-voice.js.

import { getAudioContext, getMasterOutput } from './audio-engine.js';
import { FLUID_SYNTH } from '../config.js';

const SF2_URL = 'assets/SGM-V2.01.sf2';
const IDB_NAME = 'rifflogic-sf2-cache';
const IDB_STORE = 'soundfonts';
const IDB_KEY = 'SGM-V2.01';

// GM drum channel
const DRUM_CHANNEL = 9;

let synth = null;
let audioNode = null;
let sfontId = -1;
let ready = false;
let loading = false;
let loadError = null;

// Track channel assignments: playerTrackIndex -> MIDI channel (0-15, skip 9)
let channelMap = new Map();
// Original per-track programs from GP file, for restoring after voice override
let originalPrograms = new Map(); // playerTrackIndex -> { bank, program }
// Whether user has overridden voice (null = use GP file programs)
let voiceOverrideProgram = null;
// When true, tab-player should skip FluidSynth and use fallback synth
let bypassed = false;

/**
 * @returns {boolean} Whether FluidSynth is initialized and ready.
 */
export function isFluidReady() {
  return ready && !bypassed;
}

/**
 * @returns {boolean} Whether SF2 is currently loading.
 */
export function isFluidLoading() {
  return loading;
}

/**
 * @returns {string|null} Last load error message, if any.
 */
export function getFluidError() {
  return loadError;
}

/**
 * Initialize FluidSynth: load WASM engine, load SF2 (from cache or network).
 * @param {function} [onProgress] - callback(loaded, total) for SF2 download progress
 * @returns {Promise<void>}
 */
export async function initFluidSynth(onProgress) {
  if (ready || loading) return;
  loading = true;
  loadError = null;

  try {
    // Wait for JSSynth WASM to be ready
    if (!window.JSSynth) {
      throw new Error('js-synthesizer not loaded. Check script tags.');
    }
    await window.JSSynth.waitForReady();

    const ctx = getAudioContext();

    synth = new window.JSSynth.Synthesizer();
    synth.init(ctx.sampleRate);

    // Create ScriptProcessor audio node and connect to our master output
    // Buffer size is configurable in config.js - increase if audio crackles
    audioNode = synth.createAudioNode(ctx, FLUID_SYNTH.bufferSize);
    audioNode.connect(getMasterOutput());

    // Load SF2 (try IndexedDB cache first)
    let sf2Buffer = await _loadFromCache();
    if (!sf2Buffer) {
      sf2Buffer = await _fetchSF2(onProgress);
      // Cache for next time (fire-and-forget)
      _saveToCache(sf2Buffer).catch(() => {});
    }

    // Configure reverb & chorus before loading the soundfont
    synth.setReverb(0.6, 0.4, 0.8, 0.3);
    synth.setChorus(3, 1.2, 0.3, 1.0, 0);

    sfontId = await synth.loadSFont(sf2Buffer);

    // Configure some synth settings for better quality
    synth.setGain(1.0);

    ready = true;
  } catch (err) {
    loadError = err.message || 'Failed to initialize FluidSynth';
    console.error('FluidSynth init error:', err);
    _cleanup();
    throw err;
  } finally {
    loading = false;
  }
}

/**
 * Assign MIDI programs to channels based on GP track data.
 * Call this after loading a GP file and before playing.
 * @param {Array} tracks - [{ trackIndex, isDrum, midiProgram, midiBank }]
 */
export function assignChannels(tracks) {
  if (!ready) return;

  channelMap = new Map();
  let nextChannel = 0;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];

    if (t.isDrum) {
      channelMap.set(i, DRUM_CHANNEL);
      synth.midiProgramSelect(DRUM_CHANNEL, sfontId, 128, 0);
    } else {
      // Skip drum channel
      if (nextChannel === DRUM_CHANNEL) nextChannel++;
      if (nextChannel > 15) nextChannel = 0; // wrap (unlikely with <16 tracks)
      if (nextChannel === DRUM_CHANNEL) nextChannel++;

      channelMap.set(i, nextChannel);
      originalPrograms.set(i, { bank: t.midiBank || 0, program: t.midiProgram || 25 });

      // Use voice override if set, otherwise use the GP file's program
      const bank = voiceOverrideProgram !== null ? 0 : (t.midiBank || 0);
      const prog = voiceOverrideProgram !== null ? voiceOverrideProgram : (t.midiProgram || 25);
      synth.midiProgramSelect(nextChannel, sfontId, bank, prog);
      nextChannel++;
    }
  }
}

/**
 * Send a noteOn event.
 * @param {number} playerTrackIndex - index into the player's track array
 * @param {number} midi - MIDI note number
 * @param {number} velocity - 0-127
 */
export function fluidNoteOn(playerTrackIndex, midi, velocity = 100) {
  if (!ready) return;
  const ch = channelMap.get(playerTrackIndex);
  if (ch === undefined) return;
  synth.midiNoteOn(ch, midi, velocity);
}

/**
 * Send a noteOff event.
 * @param {number} playerTrackIndex - index into the player's track array
 * @param {number} midi - MIDI note number
 */
export function fluidNoteOff(playerTrackIndex, midi) {
  if (!ready) return;
  const ch = channelMap.get(playerTrackIndex);
  if (ch === undefined) return;
  synth.midiNoteOff(ch, midi);
}

/**
 * Silence all notes on a single track's channel.
 * @param {number} playerTrackIndex - index into the player's track array
 */
export function fluidTrackNotesOff(playerTrackIndex) {
  if (!ready) return;
  const ch = channelMap.get(playerTrackIndex);
  if (ch === undefined) return;
  synth.midiAllNotesOff(ch);
}

/**
 * Silence all notes on all channels (panic).
 */
export function fluidAllNotesOff() {
  if (!ready) return;
  for (let ch = 0; ch < 16; ch++) {
    synth.midiAllNotesOff(ch);
  }
}

/**
 * Override MIDI program on all non-drum channels (voice selector).
 * Pass null to restore original GP file programs.
 * @param {number|null} program - GM program number (0-127) or null to restore
 */
/**
 * Override MIDI program on all non-drum channels (voice selector).
 * Pass null to bypass FluidSynth and use fallback synth.
 * Pass a GM program number to override all non-drum channels.
 * @param {number|null} program - GM program number (0-127) or null to bypass
 */
export function fluidSetVoiceProgram(program) {
  voiceOverrideProgram = program;

  if (program === null) {
    // Bypass FluidSynth — tab-player will use Karplus-Strong fallback
    bypassed = true;
    if (ready) fluidAllNotesOff();
    return;
  }

  // Re-enable FluidSynth with the selected program
  bypassed = false;
  if (!ready) return;

  for (const [trackIdx, ch] of channelMap) {
    if (ch === DRUM_CHANNEL) continue;
    synth.midiProgramSelect(ch, sfontId, 0, program);
  }
}

/**
 * Restore original GP file programs and re-enable FluidSynth.
 */
export function fluidRestoreOriginalPrograms() {
  bypassed = false;
  voiceOverrideProgram = null;
  if (!ready) return;

  for (const [trackIdx, ch] of channelMap) {
    if (ch === DRUM_CHANNEL) continue;
    const orig = originalPrograms.get(trackIdx);
    if (orig) synth.midiProgramSelect(ch, sfontId, orig.bank, orig.program);
  }
}

/**
 * Clean up and release resources.
 */
export function destroyFluidSynth() {
  fluidAllNotesOff();
  _cleanup();
}

// --- Internal helpers ---

function _cleanup() {
  if (audioNode) {
    audioNode.disconnect();
    audioNode = null;
  }
  if (synth) {
    try { synth.close(); } catch (_) {}
    synth = null;
  }
  sfontId = -1;
  ready = false;
  channelMap = new Map();
  originalPrograms = new Map();
  voiceOverrideProgram = null;
  bypassed = false;
}

async function _fetchSF2(onProgress) {
  const response = await fetch(SF2_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch SF2: ${response.status} ${response.statusText}`);
  }

  const contentLength = parseInt(response.headers.get('Content-Length') || '0');
  if (!response.body || !contentLength || !onProgress) {
    // No streaming progress — just download the whole thing
    const buf = await response.arrayBuffer();
    if (onProgress) onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }

  // Stream with progress
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, contentLength);
  }

  // Combine chunks into single ArrayBuffer
  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

async function _loadFromCache() {
  try {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function _saveToCache(buffer) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.put(buffer, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
