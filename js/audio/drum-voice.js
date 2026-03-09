// Synthesized drum voices — noise bursts + sine tones with fast envelopes
// Maps General MIDI drum numbers to synthesized percussion sounds

import { getAudioContext, getMasterOutput } from './audio-engine.js';

/**
 * GM drum note categories.
 * GPIF drum "fret" values correspond to GM MIDI drum map.
 */
const DRUM_DEFS = {
  // Kicks (35-36)
  35: { type: 'kick', freq: 55,  decay: 0.3,  noiseDecay: 0.05, tone: 0.9, noise: 0.3 },
  36: { type: 'kick', freq: 60,  decay: 0.25, noiseDecay: 0.05, tone: 0.9, noise: 0.3 },
  // Snares (37-40)
  37: { type: 'snare', freq: 180, decay: 0.08, noiseDecay: 0.15, tone: 0.4, noise: 0.8 },
  38: { type: 'snare', freq: 160, decay: 0.1,  noiseDecay: 0.2,  tone: 0.5, noise: 0.8 },
  39: { type: 'snare', freq: 160, decay: 0.08, noiseDecay: 0.12, tone: 0.3, noise: 0.6 },
  40: { type: 'snare', freq: 170, decay: 0.1,  noiseDecay: 0.18, tone: 0.5, noise: 0.7 },
  // Hi-hats (42, 44, 46)
  42: { type: 'hihat', freq: 0,   decay: 0,    noiseDecay: 0.05, tone: 0,   noise: 0.6, hpf: 7000 },
  44: { type: 'hihat', freq: 0,   decay: 0,    noiseDecay: 0.04, tone: 0,   noise: 0.5, hpf: 8000 },
  46: { type: 'hihat', freq: 0,   decay: 0,    noiseDecay: 0.2,  tone: 0,   noise: 0.6, hpf: 6000 },
  // Toms (41, 43, 45, 47, 48, 50)
  41: { type: 'tom', freq: 80,  decay: 0.25, noiseDecay: 0.06, tone: 0.7, noise: 0.4 },
  43: { type: 'tom', freq: 100, decay: 0.22, noiseDecay: 0.06, tone: 0.7, noise: 0.4 },
  45: { type: 'tom', freq: 130, decay: 0.2,  noiseDecay: 0.05, tone: 0.7, noise: 0.4 },
  47: { type: 'tom', freq: 160, decay: 0.18, noiseDecay: 0.05, tone: 0.7, noise: 0.35 },
  48: { type: 'tom', freq: 190, decay: 0.16, noiseDecay: 0.04, tone: 0.7, noise: 0.35 },
  50: { type: 'tom', freq: 220, decay: 0.15, noiseDecay: 0.04, tone: 0.7, noise: 0.3 },
  // Cymbals (49, 51, 52, 53, 55, 57, 59)
  49: { type: 'cymbal', freq: 0, decay: 0, noiseDecay: 0.6,  tone: 0, noise: 0.5, hpf: 5000 },
  51: { type: 'cymbal', freq: 0, decay: 0, noiseDecay: 0.4,  tone: 0, noise: 0.4, hpf: 6000 },
  52: { type: 'cymbal', freq: 0, decay: 0, noiseDecay: 0.8,  tone: 0, noise: 0.5, hpf: 4000 },
  53: { type: 'cymbal', freq: 0, decay: 0, noiseDecay: 0.25, tone: 0, noise: 0.4, hpf: 7000 },
  55: { type: 'cymbal', freq: 0, decay: 0, noiseDecay: 0.5,  tone: 0, noise: 0.45, hpf: 5500 },
  57: { type: 'cymbal', freq: 0, decay: 0, noiseDecay: 0.7,  tone: 0, noise: 0.5, hpf: 4500 },
  59: { type: 'cymbal', freq: 0, decay: 0, noiseDecay: 0.4,  tone: 0, noise: 0.4, hpf: 6500 },
};

// Default fallback for unknown GM drum numbers
const DEFAULT_DRUM = { type: 'snare', freq: 150, decay: 0.08, noiseDecay: 0.12, tone: 0.3, noise: 0.5 };

// Shared noise buffer (created once, reused)
let noiseBuffer = null;

function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const ctx = getAudioContext();
  const length = ctx.sampleRate * 2; // 2 seconds of noise
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/**
 * Play a synthesized drum hit.
 * @param {number} drumNote - GM drum MIDI number (typically the "fret" value from GPIF)
 * @param {number} startTime - AudioContext time to start
 * @param {number} gainMult - Overall gain multiplier
 */
export function playDrum(drumNote, startTime = null, gainMult = 1) {
  const ctx = getAudioContext();
  const output = getMasterOutput();
  const now = startTime || ctx.currentTime;
  const def = DRUM_DEFS[drumNote] || DEFAULT_DRUM;

  const nodes = [];

  // --- Tonal component (kick, snare, toms) ---
  if (def.tone > 0 && def.freq > 0) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(def.freq, now);

    // Pitch sweep down for kicks/toms
    if (def.type === 'kick') {
      osc.frequency.exponentialRampToValueAtTime(30, now + def.decay);
    } else if (def.type === 'tom') {
      osc.frequency.exponentialRampToValueAtTime(def.freq * 0.5, now + def.decay);
    }

    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(def.tone * gainMult, now);
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + def.decay);

    osc.connect(toneGain);
    toneGain.connect(output);
    osc.start(now);
    osc.stop(now + def.decay + 0.05);

    nodes.push(osc, toneGain);
  }

  // --- Noise component (all drum types) ---
  if (def.noise > 0) {
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = getNoiseBuffer();

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(def.noise * gainMult, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + def.noiseDecay);

    // High-pass filter for hi-hats and cymbals
    if (def.hpf) {
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = def.hpf;
      hpf.Q.value = 1;

      noiseSrc.connect(hpf);
      hpf.connect(noiseGain);
      nodes.push(hpf);
    } else {
      // Band-pass for snares to shape the noise
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = def.type === 'snare' ? 3000 : 5000;
      bpf.Q.value = 0.5;

      noiseSrc.connect(bpf);
      bpf.connect(noiseGain);
      nodes.push(bpf);
    }

    noiseGain.connect(output);
    noiseSrc.start(now);
    const maxDecay = Math.max(def.noiseDecay, def.decay || 0);
    noiseSrc.stop(now + maxDecay + 0.1);

    nodes.push(noiseSrc, noiseGain);
  }

  // Cleanup
  const lastNode = nodes.find(n => n instanceof AudioBufferSourceNode || n instanceof OscillatorNode);
  if (lastNode) {
    lastNode.onended = () => {
      for (const n of nodes) n.disconnect();
    };
  }
}
