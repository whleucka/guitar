// Tab playback engine — scheduling-ahead pattern for audio + visual sync

import { getAudioContext } from '../audio/audio-engine.js';
import { playNote } from '../audio/synth-voice.js';
import { midiToFrequency } from '../music/notes.js';
import { events, TAB_BEAT_ON, TAB_BEAT_OFF, TAB_POSITION, TAB_STOP } from '../events.js';

const LOOKAHEAD_MS = 100;
const SCHEDULE_INTERVAL_MS = 25;

export class TabPlayer {
  constructor() {
    this.timeline = null;
    this.measures = null;
    this.currentIndex = 0;
    this.startTime = 0;
    this.tempoScale = 1.0;
    this.loopA = null;
    this.loopB = null;
    this.state = 'stopped'; // stopped | playing | paused
    this.schedulerInterval = null;
    this.scheduledUpTo = 0; // absolute audio time we've scheduled up to
  }

  play(timeline, measures, fromIndex = 0) {
    this.timeline = timeline;
    this.measures = measures;
    this.currentIndex = fromIndex;

    const ctx = getAudioContext();
    // Calculate start time offset so that currentIndex plays "now"
    const eventTime = timeline[fromIndex] ? timeline[fromIndex].time : 0;
    this.startTime = ctx.currentTime - eventTime / this.tempoScale;
    this.scheduledUpTo = ctx.currentTime;

    this.state = 'playing';
    this.schedulerInterval = setInterval(() => this._scheduler(), SCHEDULE_INTERVAL_MS);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  resume() {
    if (this.state !== 'paused' || !this.timeline) return;
    const ctx = getAudioContext();
    const eventTime = this.timeline[this.currentIndex]
      ? this.timeline[this.currentIndex].time
      : 0;
    this.startTime = ctx.currentTime - eventTime / this.tempoScale;
    this.scheduledUpTo = ctx.currentTime;
    this.state = 'playing';
    this.schedulerInterval = setInterval(() => this._scheduler(), SCHEDULE_INTERVAL_MS);
  }

  stop() {
    this.state = 'stopped';
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    this.currentIndex = 0;
    events.emit(TAB_STOP);
  }

  setTempoScale(scale) {
    if (this.state === 'playing' && this.timeline) {
      const ctx = getAudioContext();
      const eventTime = this.timeline[this.currentIndex]
        ? this.timeline[this.currentIndex].time
        : 0;
      this.tempoScale = scale;
      this.startTime = ctx.currentTime - eventTime / this.tempoScale;
    } else {
      this.tempoScale = scale;
    }
  }

  setLoop(a, b) {
    this.loopA = a;
    this.loopB = b;
  }

  seekTo(index) {
    this.currentIndex = Math.max(0, Math.min(index, (this.timeline?.length || 1) - 1));
    if (this.state === 'playing' && this.timeline) {
      const ctx = getAudioContext();
      const eventTime = this.timeline[this.currentIndex].time;
      this.startTime = ctx.currentTime - eventTime / this.tempoScale;
      this.scheduledUpTo = ctx.currentTime;
    }
  }

  _scheduler() {
    if (this.state !== 'playing' || !this.timeline) return;

    const ctx = getAudioContext();
    const lookahead = LOOKAHEAD_MS / 1000;

    while (this.currentIndex < this.timeline.length) {
      const event = this.timeline[this.currentIndex];
      const scaledTime = this.startTime + event.time / this.tempoScale;

      if (scaledTime > ctx.currentTime + lookahead) break;

      // Schedule audio for non-tied notes
      for (const note of event.notes) {
        if (note.tieDestination) continue;
        const freq = note.midi > 0
          ? midiToFrequency(note.midi)
          : midiToFrequency(40 + note.fret); // fallback
        playNote(freq, Math.max(0, Math.min(5, note.string)), scaledTime, 0.7);
      }

      // Collect all notes in the current measure for fretboard preview
      const mbIndex = event.masterBarIndex;
      const measure = this.measures.find(m => m.masterBarIndex === mbIndex);
      const measureNotes = [];
      if (measure) {
        for (const bi of measure.beatIndices) {
          const b = this.timeline[bi];
          if (b) {
            for (const n of b.notes) {
              if (!n.tieDestination) measureNotes.push(n);
            }
          }
        }
      }

      // Visual sync (fire near the beat time)
      const delay = Math.max(0, (scaledTime - ctx.currentTime) * 1000);
      const idx = this.currentIndex;
      const notesCopy = event.notes;

      setTimeout(() => {
        events.emit(TAB_BEAT_ON, {
          index: idx,
          notes: notesCopy,
          measureNotes,
          masterBarIndex: mbIndex,
        });

        events.emit(TAB_POSITION, {
          currentIndex: idx,
          totalBeats: this.timeline ? this.timeline.length : 0,
          masterBarIndex: mbIndex,
          totalBars: this.measures ? this.measures.length : 0,
        });
      }, delay);

      // Clear previous beat highlight
      if (idx > 0) {
        setTimeout(() => {
          events.emit(TAB_BEAT_OFF, { index: idx - 1 });
        }, delay);
      }

      this.currentIndex++;

      // Loop handling
      if (this.loopB !== null && this.currentIndex > this.loopB) {
        const loopStart = this.loopA !== null ? this.loopA : 0;
        this.currentIndex = loopStart;
        const restartTime = this.timeline[loopStart].time;
        this.startTime = ctx.currentTime - restartTime / this.tempoScale + 0.05;
        break;
      }
    }

    // End of timeline
    if (this.currentIndex >= this.timeline.length) {
      this.stop();
    }
  }
}
