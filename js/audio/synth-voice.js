// Plucked string synthesis and Sampled Soundfont voices

import { getAudioContext, getMasterOutput } from './audio-engine.js';

// --- State and Config ---
export const VOICE_TYPES = {
  KARPLUS: 'karplus',
  ACOUSTIC: 'acoustic_guitar_steel',
  ELECTRIC_CLEAN: 'electric_guitar_clean',
  ELECTRIC_MUTED: 'electric_guitar_muted',
  OVERDRIVEN: 'overdriven_guitar',
  DISTORTION: 'distortion_guitar'
};

let currentVoiceType = VOICE_TYPES.KARPLUS;
let currentInstrument = null; // Loaded soundfont instrument
let isLoading = false;

// --- Karplus-Strong Synthesis (The "Original" Synth) ---
const MAX_BUFFER_DURATION = 2.0;
const bufferCache = new Map();

function generateKarplusBuffer(ctx, frequency, duration, damping, brightness) {
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.ceil(sampleRate * duration);
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const period = Math.round(sampleRate / frequency);
  if (period < 2) return buffer;

  const delayLine = new Float32Array(period);
  for (let i = 0; i < period; i++) delayLine[i] = Math.random() * 2 - 1;

  let readPos = 0;
  for (let i = 0; i < totalSamples; i++) {
    const curr = delayLine[readPos];
    const next = delayLine[(readPos + 1) % period];
    data[i] = curr;
    const filtered = ((curr + next) * 0.5) * (1 - brightness) + curr * brightness;
    delayLine[readPos] = filtered * damping;
    readPos = (readPos + 1) % period;
  }
  return buffer;
}

function getCachedKarplusBuffer(ctx, frequency, damping, brightness) {
  const key = `${Math.round(frequency)}-${damping.toFixed(4)}-${brightness.toFixed(2)}`;
  if (bufferCache.has(key)) return bufferCache.get(key);
  const buffer = generateKarplusBuffer(ctx, frequency, MAX_BUFFER_DURATION, damping, brightness);
  if (bufferCache.size >= 80) bufferCache.delete(bufferCache.keys().next().value);
  bufferCache.set(key, buffer);
  return buffer;
}

function playKarplus(frequency, stringIndex, now, gainMult, sustainDur) {
  const ctx = getAudioContext();
  const output = getMasterOutput();

  const dampingValues = [0.9960, 0.9955, 0.9950, 0.9942, 0.9935, 0.9925];
  const brightnessValues = [0.05, 0.08, 0.12, 0.18, 0.22, 0.28];
  const idx = Math.max(0, Math.min(5, stringIndex));
  const releaseTail = 0.15;
  const totalDur = Math.min(sustainDur + releaseTail, MAX_BUFFER_DURATION);

  const buffer = getCachedKarplusBuffer(ctx, frequency, dampingValues[idx], brightnessValues[idx]);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 220;
  body.Q.value = 0.7;
  body.gain.value = 2;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.5 * gainMult, now);
  const releaseStart = now + sustainDur;
  env.gain.setValueAtTime(0.5 * gainMult, releaseStart);
  env.gain.linearRampToValueAtTime(0, releaseStart + releaseTail);

  source.connect(body);
  body.connect(env);
  env.connect(output);

  source.start(now);
  source.stop(now + totalDur + 0.01);
}

// --- Soundfont Sampler (The "Pro" Voice) ---
/**
 * Change the active voice type.
 * @param {string} type - Key from VOICE_TYPES
 */
export async function setVoiceType(type) {
  if (type === currentVoiceType) return;
  
  const ctx = getAudioContext();
  currentVoiceType = type;

  if (type === VOICE_TYPES.KARPLUS) {
    currentInstrument = null;
    return;
  }

  // Load sample-based instrument
  if (window.Soundfont) {
    isLoading = true;
    try {
      // Soundfont player uses its own output, we'll try to route it to our master gain
      currentInstrument = await window.Soundfont.instrument(ctx, type, {
        destination: getMasterOutput()
      });
      console.log(`Loaded sampler voice: ${type}`);
    } catch (err) {
      console.error('Failed to load Soundfont:', err);
      currentVoiceType = VOICE_TYPES.KARPLUS;
    } finally {
      isLoading = false;
    }
  }
}

/**
 * Play a note using the active voice engine.
 */
export function playNote(frequency, stringIndex = 3, startTime = null, gainMult = 1, noteDuration = 0) {
  const ctx = getAudioContext();
  const now = startTime || ctx.currentTime;
  const sustainDur = noteDuration > 0 ? noteDuration : 0.8;

  if (currentVoiceType === VOICE_TYPES.KARPLUS || !currentInstrument) {
    playKarplus(frequency, stringIndex, now, gainMult, sustainDur);
  } else {
    // Soundfont uses MIDI numbers or names. Frequency to MIDI:
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    currentInstrument.play(midi, now, {
      duration: sustainDur,
      gain: gainMult * 0.7 // Samplers are often louder
    });
  }
}

export function getCurrentVoiceType() {
  return currentVoiceType;
}

export function isVoiceLoading() {
  return isLoading;
}
