// Shared metronome click scheduling — used by both Metronome and TabPlayer

import { getAudioContext, getMasterOutput } from './audio-engine.js';
import { METRONOME } from '../config.js';

/**
 * Schedule a single metronome click at the given audio time.
 * @param {number} time - AudioContext time to play the click
 * @param {boolean} isDownbeat - true for accented click
 */
export function scheduleClick(time, isDownbeat) {
  const ctx = getAudioContext();
  const output = getMasterOutput();

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = isDownbeat ? METRONOME.clickFreqHigh : METRONOME.clickFreqLow;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(METRONOME.clickGain, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + METRONOME.clickDuration);

  osc.connect(gain);
  gain.connect(output);

  osc.start(time);
  osc.stop(time + METRONOME.clickDuration + 0.01);

  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}
