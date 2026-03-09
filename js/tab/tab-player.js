// Tab playback engine — multi-track scheduling-ahead pattern for audio + visual sync

import { getAudioContext } from '../audio/audio-engine.js';
import { playNote } from '../audio/synth-voice.js';
import { playDrum } from '../audio/drum-voice.js';
import { midiToFrequency } from '../music/notes.js';
import { events, TAB_BEAT_ON, TAB_BEAT_OFF, TAB_POSITION, TAB_STOP } from '../events.js';

const LOOKAHEAD_MS = 100;
const SCHEDULE_INTERVAL_MS = 25;

const PRIMARY_GAIN = 0.7;
const BACKING_GAIN = 0.35;

export class TabPlayer {
  constructor() {
    // Primary track (selected in UI) — drives visuals + fretboard
    this.timeline = null;
    this.measures = null;
    this.currentIndex = 0;

    // Backing tracks — audio only
    this.backingTracks = []; // [{ timeline, measures, currentIndex }]

    this.startTime = 0;
    this.tempoScale = 1.0;
    this.loopA = null;
    this.loopB = null;
    this.soloTrack = false; // when true, only primary track plays audio
    this.state = 'stopped'; // stopped | playing | paused
    this.schedulerInterval = null;
  }

  /**
   * Set all track data. Primary track drives visuals; others are backing audio.
   * @param {object} primaryTrack - { timeline, measures }
   * @param {Array} backingTracks - [{ timeline, measures, isDrum }, ...]
   */
  setTracks(primaryTrack, backingTracks = []) {
    this.timeline = primaryTrack.timeline;
    this.measures = primaryTrack.measures;
    this.backingTracks = backingTracks.map(t => ({
      timeline: t.timeline,
      measures: t.measures,
      isDrum: !!t.isDrum,
      currentIndex: 0,
    }));
    this.currentIndex = 0;
  }

  play(fromIndex = 0) {
    if (!this.timeline) return;

    this.currentIndex = fromIndex;

    const ctx = getAudioContext();
    const eventTime = this.timeline[fromIndex] ? this.timeline[fromIndex].time : 0;
    this.startTime = ctx.currentTime - eventTime / this.tempoScale;

    // Sync backing tracks to the same absolute time
    for (const bt of this.backingTracks) {
      bt.currentIndex = this._findIndexAtTime(bt.timeline, eventTime);
    }

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

    // Re-sync backing tracks
    for (const bt of this.backingTracks) {
      bt.currentIndex = this._findIndexAtTime(bt.timeline, eventTime);
    }

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
    for (const bt of this.backingTracks) {
      bt.currentIndex = 0;
    }
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

  setSoloTrack(solo) {
    this.soloTrack = solo;
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

      // Re-sync backing tracks
      for (const bt of this.backingTracks) {
        bt.currentIndex = this._findIndexAtTime(bt.timeline, eventTime);
      }
    }
  }

  /**
   * Find the timeline index closest to (but not before) a given absolute time.
   */
  _findIndexAtTime(timeline, time) {
    if (!timeline || timeline.length === 0) return 0;
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].time >= time - 0.001) return i;
    }
    return timeline.length;
  }

  _scheduler() {
    if (this.state !== 'playing' || !this.timeline) return;

    const ctx = getAudioContext();
    const lookahead = LOOKAHEAD_MS / 1000;

    // --- Schedule primary track (audio + visuals) ---
    while (this.currentIndex < this.timeline.length) {
      const event = this.timeline[this.currentIndex];
      const scaledTime = this.startTime + event.time / this.tempoScale;

      if (scaledTime > ctx.currentTime + lookahead) break;

      // Schedule audio for primary track
      for (const note of event.notes) {
        if (note.tieDestination) continue;
        const freq = note.midi > 0
          ? midiToFrequency(note.midi)
          : midiToFrequency(40 + note.fret);
        playNote(freq, Math.max(0, Math.min(5, note.string)), scaledTime, PRIMARY_GAIN);
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

      // Loop handling (primary drives the loop)
      if (this.loopB !== null && this.currentIndex > this.loopB) {
        const loopStart = this.loopA !== null ? this.loopA : 0;
        this.currentIndex = loopStart;
        const restartTime = this.timeline[loopStart].time;
        this.startTime = ctx.currentTime - restartTime / this.tempoScale + 0.05;

        // Re-sync backing tracks to loop start
        for (const bt of this.backingTracks) {
          bt.currentIndex = this._findIndexAtTime(bt.timeline, restartTime);
        }
        break;
      }
    }

    // --- Schedule backing tracks (audio only, no visuals) ---
    if (!this.soloTrack) {
      for (const bt of this.backingTracks) {
        while (bt.currentIndex < bt.timeline.length) {
          const event = bt.timeline[bt.currentIndex];
          const scaledTime = this.startTime + event.time / this.tempoScale;

          if (scaledTime > ctx.currentTime + lookahead) break;

          if (bt.isDrum) {
            // Drum tracks: use drum synth with GM note number (stored as fret)
            for (const note of event.notes) {
              if (note.tieDestination) continue;
              playDrum(note.fret, scaledTime, BACKING_GAIN);
            }
          } else {
            // Pitched tracks: use Karplus-Strong string synth
            for (const note of event.notes) {
              if (note.tieDestination) continue;
              const freq = note.midi > 0
                ? midiToFrequency(note.midi)
                : midiToFrequency(40 + note.fret);
              playNote(freq, Math.max(0, Math.min(5, note.string)), scaledTime, BACKING_GAIN);
            }
          }

          bt.currentIndex++;
        }
      }
    }

    // End of primary timeline
    if (this.currentIndex >= this.timeline.length) {
      this.stop();
    }
  }
}
