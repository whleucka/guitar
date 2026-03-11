// Settings persistence using localStorage
// Provides a clean API for saving/loading user preferences

const STORAGE_KEY = 'rifflogic_settings';

// Default settings
const defaults = {
  volume: 0.5,
  tuning: null, // null means standard E
  view: 'scales',
  scale: null,
  chord: null,
  tempo: 100,
  metronomeBpm: 80,
};

// In-memory cache of settings
let cache = null;

/**
 * Load all settings from localStorage
 * @returns {object} Settings object with defaults applied
 */
function load() {
  if (cache) return cache;
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      cache = { ...defaults, ...JSON.parse(stored) };
    } else {
      cache = { ...defaults };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
    cache = { ...defaults };
  }
  
  return cache;
}

/**
 * Save all settings to localStorage
 */
function save() {
  if (!cache) return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

/**
 * Get a setting value
 * @param {string} key - Setting key
 * @returns {*} Setting value
 */
export function get(key) {
  const settings = load();
  return settings[key];
}

/**
 * Set a setting value and persist
 * @param {string} key - Setting key
 * @param {*} value - Setting value
 */
export function set(key, value) {
  const settings = load();
  settings[key] = value;
  save();
}

/**
 * Get all settings
 * @returns {object} All settings
 */
export function getAll() {
  return { ...load() };
}

/**
 * Reset all settings to defaults
 */
export function reset() {
  cache = { ...defaults };
  save();
}

// Initialize cache on module load
load();
