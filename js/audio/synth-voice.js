// Karplus-Strong plucked string synthesis
// Pre-computed waveform buffer — no real-time feedback loops

import { getAudioContext, getMasterOutput } from './audio-engine.js';

// Maximum buffer duration (seconds) — buffers are reused via cache
const MAX_BUFFER_DURATION = 2.0;

/**
 * Pre-compute a Karplus-Strong plucked string waveform into an AudioBuffer.
 */
function generateKarplusBuffer(ctx, frequency, duration, damping, brightness) {
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.ceil(sampleRate * duration);
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const period = Math.round(sampleRate / frequency);
  if (period < 2) return buffer;

  // Initialize delay line with white noise (the "pluck")
  const delayLine = new Float32Array(period);
  for (let i = 0; i < period; i++) {
    delayLine[i] = Math.random() * 2 - 1;
  }

  // Generate samples using Karplus-Strong averaging filter
  let readPos = 0;
  for (let i = 0; i < totalSamples; i++) {
    const curr = delayLine[readPos];
    const next = delayLine[(readPos + 1) % period];

    data[i] = curr;

    const averaged = (curr + next) * 0.5;
    const filtered = averaged * (1 - brightness) + curr * brightness;
    delayLine[readPos] = filtered * damping;

    readPos = (readPos + 1) % period;
  }

  return buffer;
}

// Cache buffers keyed by frequency + string params
const bufferCache = new Map();
const MAX_CACHE_SIZE = 80;

function getCachedBuffer(ctx, frequency, damping, brightness) {
  const key = `${Math.round(frequency)}-${damping.toFixed(4)}-${brightness.toFixed(2)}`;

  if (bufferCache.has(key)) {
    return bufferCache.get(key);
  }

  const buffer = generateKarplusBuffer(ctx, frequency, MAX_BUFFER_DURATION, damping, brightness);

  if (bufferCache.size >= MAX_CACHE_SIZE) {
    const firstKey = bufferCache.keys().next().value;
    bufferCache.delete(firstKey);
  }

  bufferCache.set(key, buffer);
  return buffer;
}

/**
 * Play a Karplus-Strong plucked string note.
 * @param {number} frequency - Note frequency in Hz
 * @param {number} stringIndex - 0 (low E) to 5 (high E) for tonal variation
 * @param {number} startTime - AudioContext scheduled time (null = now)
 * @param {number} gainMult - Gain multiplier (0-1)
 * @param {number} noteDuration - How long the note should sustain (seconds). 0 = use default.
 */
export function playNote(frequency, stringIndex = 3, startTime = null, gainMult = 1, noteDuration = 0) {
  const ctx = getAudioContext();
  const output = getMasterOutput();
  const now = startTime || ctx.currentTime;

  const freq = Math.max(20, Math.min(frequency, 8000));

  // Per-string tonal parameters
  const dampingValues =    [0.9960, 0.9955, 0.9950, 0.9942, 0.9935, 0.9925];
  const brightnessValues = [0.05,   0.08,   0.12,   0.18,   0.22,   0.28];

  const idx = Math.max(0, Math.min(5, stringIndex));
  const damping = dampingValues[idx];
  const brightness = brightnessValues[idx];

  // Determine actual playback duration:
  // Use the note's musical duration + a short release tail, capped to buffer length
  const releaseTail = 0.15;
  const defaultDur = 0.8; // fallback for interactive clicks, strums, etc.
  const sustainDur = noteDuration > 0 ? noteDuration : defaultDur;
  const totalDur = Math.min(sustainDur + releaseTail, MAX_BUFFER_DURATION);

  const buffer = getCachedBuffer(ctx, freq, damping, brightness);

  // --- Playback chain: buffer → body filter → high-shelf → gain envelope → output ---
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Body resonance (subtle guitar-body warmth)
  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 220;
  body.Q.value = 0.7;
  body.gain.value = 2;

  // High-shelf cut to tame harshness
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 4000;
  shelf.gain.value = -3;

  // Gain envelope — sustain then release
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.5 * gainMult, now);
  // Hold at sustain level, then fade out
  const releaseStart = now + sustainDur;
  env.gain.setValueAtTime(0.5 * gainMult, releaseStart);
  env.gain.linearRampToValueAtTime(0, releaseStart + releaseTail);

  source.connect(body);
  body.connect(shelf);
  shelf.connect(env);
  env.connect(output);

  source.start(now);
  source.stop(now + totalDur + 0.01);

  // Cleanup
  source.onended = () => {
    source.disconnect();
    body.disconnect();
    shelf.disconnect();
    env.disconnect();
  };
}
