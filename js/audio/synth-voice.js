// Karplus-Strong plucked string synthesis
// Realistic guitar/bass sound using noise excitation + filtered delay feedback

import { getAudioContext, getMasterOutput } from './audio-engine.js';

/**
 * Create a noise-burst excitation buffer for Karplus-Strong.
 * The buffer length determines the fundamental frequency: freq = sampleRate / length
 */
function createExcitationBuffer(ctx, frequency) {
  // Buffer length = one period at the target frequency
  const periodSamples = Math.round(ctx.sampleRate / frequency);
  const buffer = ctx.createBuffer(1, periodSamples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < periodSamples; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Play a Karplus-Strong plucked string note.
 * @param {number} frequency - Note frequency in Hz
 * @param {number} stringIndex - 0 (low E) to 5 (high E) for tonal variation
 * @param {number} startTime - AudioContext scheduled time (null = now)
 * @param {number} gainMult - Gain multiplier (0-1)
 */
export function playNote(frequency, stringIndex = 3, startTime = null, gainMult = 1) {
  const ctx = getAudioContext();
  const output = getMasterOutput();
  const now = startTime || ctx.currentTime;

  // Clamp frequency to valid range for Karplus-Strong
  const freq = Math.max(20, Math.min(frequency, 8000));

  // --- Delay-line length sets the pitch ---
  const delaySec = 1 / freq;

  // --- Excitation: short noise burst (one period) ---
  const excitation = ctx.createBufferSource();
  excitation.buffer = createExcitationBuffer(ctx, freq);
  excitation.loop = false;

  // --- Delay node (the string) ---
  const delay = ctx.createDelay(1);
  delay.delayTime.value = delaySec;

  // --- Feedback filter (string damping) ---
  // Lower strings have lower damping cutoff = duller, longer decay
  // Higher strings have higher cutoff = brighter, shorter decay
  const damping = ctx.createBiquadFilter();
  damping.type = 'lowpass';
  const dampingFreqs = [1800, 2200, 2800, 3500, 4200, 5000];
  damping.frequency.value = dampingFreqs[stringIndex] || 3000;
  damping.Q.value = 0.5;

  // --- Feedback gain (controls sustain/decay length) ---
  // Values close to 1 = long sustain, lower = faster decay
  const feedbackGain = ctx.createGain();
  // Lower strings sustain longer
  const feedbackValues = [0.998, 0.997, 0.996, 0.995, 0.994, 0.993];
  feedbackGain.gain.value = feedbackValues[stringIndex] || 0.996;

  // --- Body resonance filter (simulates guitar body) ---
  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 250;
  body.Q.value = 1;
  body.gain.value = 3;

  // --- Output envelope ---
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.6 * gainMult, now);

  // Natural decay over time (Karplus-Strong decays on its own, but we add
  // an envelope to ensure cleanup and shape the tail)
  const sustainTime = 1.5 + stringIndex * 0.15; // lower strings ring longer
  env.gain.setValueAtTime(0.6 * gainMult, now + sustainTime * 0.7);
  env.gain.linearRampToValueAtTime(0, now + sustainTime);

  // --- Signal flow ---
  // Excitation → delay → damping → feedback → delay (loop)
  //                                         ↘ body → env → output
  excitation.connect(delay);

  // Feedback loop: delay → damping → feedbackGain → delay
  delay.connect(damping);
  damping.connect(feedbackGain);
  feedbackGain.connect(delay);

  // Tap the output from the delay
  delay.connect(body);
  body.connect(env);
  env.connect(output);

  excitation.start(now);
  excitation.stop(now + delaySec + 0.001); // just one burst

  // Schedule cleanup: break the feedback loop and disconnect
  const cleanupTime = sustainTime + 0.1;
  const cleanup = () => {
    try {
      feedbackGain.gain.value = 0; // break feedback loop
      excitation.disconnect();
      delay.disconnect();
      damping.disconnect();
      feedbackGain.disconnect();
      body.disconnect();
      env.disconnect();
    } catch (e) {
      // Nodes may already be garbage collected
    }
  };

  // Use a silent oscillator as a timer for cleanup
  const timer = ctx.createOscillator();
  timer.connect(ctx.createGain()); // connect to dummy to avoid warning
  timer.onended = cleanup;
  timer.start(now);
  timer.stop(now + cleanupTime);
}
