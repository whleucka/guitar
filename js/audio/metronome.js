// Metronome — scheduling-ahead pattern for rock-solid timing

import { METRONOME } from '../config.js';
import { getAudioContext } from './audio-engine.js';
import { scheduleClick } from './metronome-click.js';
import { events, METRONOME_TICK } from '../events.js';

export class Metronome {
  constructor() {
    this.bpm = METRONOME.defaultBpm;
    this.beatsPerMeasure = 4;
    this.currentBeat = 0;
    this.currentBar = 0;
    this.nextBeatTime = 0;
    this.timerID = null;
    this.running = false;
  }

  start(bpm, beatsPerMeasure = 4) {
    if (this.running) this.stop();
    this.bpm = bpm;
    this.beatsPerMeasure = beatsPerMeasure;
    this.currentBeat = 0;
    this.currentBar = 0;

    const ctx = getAudioContext();
    this.nextBeatTime = ctx.currentTime + 0.05;
    this.running = true;

    this.timerID = setInterval(() => this._scheduler(), METRONOME.scheduleIntervalMs);
  }

  stop() {
    if (this.timerID) {
      clearInterval(this.timerID);
      this.timerID = null;
    }
    this.running = false;
  }

  setBpm(bpm) {
    this.bpm = Math.max(METRONOME.minBpm, Math.min(METRONOME.maxBpm, bpm));
  }

  _scheduler() {
    const ctx = getAudioContext();
    const lookahead = METRONOME.lookaheadMs / 1000;

    while (this.nextBeatTime < ctx.currentTime + lookahead) {
      const isDownbeat = this.currentBeat === 0;

      this._scheduleClick(this.nextBeatTime, isDownbeat);

      // Emit tick event (use setTimeout to fire near the beat time)
      const delay = Math.max(0, (this.nextBeatTime - ctx.currentTime) * 1000);
      const tickData = {
        beat: this.currentBeat,
        bar: this.currentBar,
        isDownbeat,
        time: this.nextBeatTime,
      };
      setTimeout(() => {
        events.emit(METRONOME_TICK, tickData);
      }, delay);

      // Advance
      this.currentBeat++;
      if (this.currentBeat >= this.beatsPerMeasure) {
        this.currentBeat = 0;
        this.currentBar++;
      }

      this.nextBeatTime += 60 / this.bpm;
    }
  }

  _scheduleClick(time, isDownbeat) {
    scheduleClick(time, isDownbeat);
  }
}
