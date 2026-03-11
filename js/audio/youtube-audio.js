// YouTube audio integration - search and playback
// Requires local proxy server running (server/index.js)

import { getAudioContext, getMasterOutput } from './audio-engine.js';

// Use relative URLs - works when served from same origin
const API_BASE = '/api/youtube';

// --- State ---
let audioElement = null;
let sourceNode = null;
let gainNode = null;
let currentVideoId = null;
let isLoading = false;
let isReady = false;

// --- API Client ---

/**
 * Search YouTube for tracks matching the query.
 * Automatically appends "lyric video" to prioritize lyric videos.
 * @param {string} artist 
 * @param {string} title 
 * @param {number} limit 
 * @returns {Promise<Array<{id, title, channel, duration, thumbnail}>>}
 */
export async function searchYouTube(artist, title, limit = 5) {
  const query = `${artist} ${title} lyric video`;
  const url = `${API_BASE}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.warn('[YouTube] Search failed:', err.message);
    return [];
  }
}

/**
 * Check if the proxy server is available.
 */
export async function isProxyAvailable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch('/api/health', { 
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (err) {
    console.warn('[YouTube] Proxy check failed:', err.message);
    return false;
  }
}

// --- Audio Playback ---

/**
 * Load a YouTube video for audio playback.
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<void>}
 */
export async function loadYouTubeAudio(videoId) {
  if (currentVideoId === videoId && isReady) {
    return; // Already loaded
  }

  isLoading = true;
  isReady = false;

  // Clean up previous
  _cleanup();

  const ctx = getAudioContext();
  const output = getMasterOutput();

  // Create audio element for streaming
  audioElement = new Audio();
  audioElement.crossOrigin = 'anonymous';
  audioElement.preload = 'auto';
  
  // Use the streaming endpoint (handles CORS)
  audioElement.src = `${API_BASE}/stream/${videoId}`;

  // Create Web Audio nodes
  sourceNode = ctx.createMediaElementSource(audioElement);
  gainNode = ctx.createGain();
  gainNode.gain.value = 0.8; // Slightly lower than synth

  sourceNode.connect(gainNode);
  gainNode.connect(output);

  // Wait for enough data to play
  return new Promise((resolve, reject) => {
    const onCanPlay = () => {
      audioElement.removeEventListener('canplay', onCanPlay);
      audioElement.removeEventListener('error', onError);
      currentVideoId = videoId;
      isLoading = false;
      isReady = true;
      console.log(`[YouTube] Loaded: ${videoId}`);
      resolve();
    };

    const onError = (e) => {
      audioElement.removeEventListener('canplay', onCanPlay);
      audioElement.removeEventListener('error', onError);
      isLoading = false;
      console.error('[YouTube] Load error:', e);
      reject(new Error('Failed to load YouTube audio'));
    };

    audioElement.addEventListener('canplay', onCanPlay);
    audioElement.addEventListener('error', onError);
    
    // Start loading
    audioElement.load();
  });
}

/**
 * Start playback from a specific time.
 * @param {number} startTime - Start time in seconds
 */
export function playYouTube(startTime = 0) {
  if (!audioElement || !isReady) return;
  
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  
  audioElement.currentTime = startTime;
  audioElement.play().catch(err => {
    console.warn('[YouTube] Play failed:', err.message);
  });
}

/**
 * Pause playback.
 */
export function pauseYouTube() {
  if (audioElement) {
    audioElement.pause();
  }
}

/**
 * Stop playback and reset to beginning.
 */
export function stopYouTube() {
  if (audioElement) {
    audioElement.pause();
    audioElement.currentTime = 0;
  }
}

/**
 * Seek to a specific time.
 * @param {number} time - Time in seconds
 */
export function seekYouTube(time) {
  if (audioElement && isReady) {
    audioElement.currentTime = Math.max(0, time);
  }
}

/**
 * Get current playback time.
 * @returns {number} Current time in seconds, or -1 if not ready
 */
export function getYouTubeTime() {
  if (audioElement && isReady) {
    return audioElement.currentTime;
  }
  return -1;
}

/**
 * Get total duration.
 * @returns {number} Duration in seconds, or 0 if not ready
 */
export function getYouTubeDuration() {
  if (audioElement && isReady && !isNaN(audioElement.duration)) {
    return audioElement.duration;
  }
  return 0;
}

/**
 * Set playback rate (for tempo sync).
 * @param {number} rate - Playback rate (1.0 = normal)
 */
export function setYouTubePlaybackRate(rate) {
  if (audioElement) {
    audioElement.playbackRate = rate;
  }
}

/**
 * Set volume.
 * @param {number} volume - 0.0 to 1.0
 */
export function setYouTubeVolume(volume) {
  if (gainNode) {
    gainNode.gain.value = Math.max(0, Math.min(1, volume));
  }
}

/**
 * Check if YouTube audio is currently loaded and ready.
 */
export function isYouTubeReady() {
  return isReady;
}

/**
 * Check if YouTube audio is currently loading.
 */
export function isYouTubeLoading() {
  return isLoading;
}

/**
 * Get the currently loaded video ID.
 */
export function getCurrentVideoId() {
  return currentVideoId;
}

/**
 * Unload YouTube audio and clean up.
 */
export function unloadYouTube() {
  _cleanup();
  currentVideoId = null;
  isReady = false;
  isLoading = false;
}

/**
 * Register a callback for when playback ends.
 * @param {Function} callback 
 */
export function onYouTubeEnded(callback) {
  if (audioElement) {
    audioElement.addEventListener('ended', callback);
  }
}

// --- Internal ---

function _cleanup() {
  if (audioElement) {
    audioElement.pause();
    audioElement.src = '';
    audioElement = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (gainNode) {
    gainNode.disconnect();
    gainNode = null;
  }
}
