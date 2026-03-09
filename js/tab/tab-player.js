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
    // All tracks: [{ timeline, measures, isDrum, muted, currentIndex }]
    this.tracks = [];
    this.primaryIndex = 0; // index into this.tracks — drives visuals

    this.startTime = 0;
    this.tempoScale = 1.0;
    this.loopA = null;
    this.loopB = null;
    this.state = 'stopped'; // stopped | playing | paused
    this.schedulerInterval = null;
  }

  /** Primary track shortcut */
  get timeline() { return this.tracks[this.primaryIndex]?.timeline || null; }
  get measures() { return this.tracks[this.primaryIndex]?.measures || null; }
  get currentIndex() { return this.tracks[this.primaryIndex]?.currentIndex || 0; }
  set currentIndex(v) { if (this.tracks[this.primaryIndex]) this.tracks[this.primaryIndex].currentIndex = v; }

  /**
   * Set all track data.
   * @param {Array} tracks - [{ timeline, measures, isDrum, tuning }, ...]
   * @param {number} primaryIndex - which track drives visuals
   */
  setTracks(tracks, primaryIndex = 0) {
    this.tracks = tracks.map(t => ({
      timeline: t.timeline,
      measures: t.measures,
      isDrum: !!t.isDrum,
      tuning: t.tuning || [40, 45, 50, 55, 59, 64],
      muted: false,
      currentIndex: 0,
    }));
    this.primaryIndex = primaryIndex;
  }

  /**
   * Change which track is primary (visual). Does not change mute states.
   */
  setPrimary(index) {
    if (index < 0 || index >= this.tracks.length) return;
    // Sync the new primary to the old primary's time position
    if (this.state === 'playing' || this.state === 'paused') {
      const oldPrimary = this.tracks[this.primaryIndex];
      const time = oldPrimary?.timeline[oldPrimary.currentIndex]?.time || 0;
      this.primaryIndex = index;
      this.currentIndex = this._findIndexAtTime(this.timeline, time);
    } else {
      this.primaryIndex = index;
      this.currentIndex = 0;
    }
  }

  setTrackMuted(trackIdx, muted) {
    if (this.tracks[trackIdx]) {
      this.tracks[trackIdx].muted = muted;
    }
  }

  play(fromIndex = 0) {
    if (!this.timeline) return;

    this.currentIndex = fromIndex;

    const ctx = getAudioContext();
    const eventTime = this.timeline[fromIndex] ? this.timeline[fromIndex].time : 0;
    this.startTime = ctx.currentTime - eventTime / this.tempoScale;

    // Sync all tracks to the same absolute time
    for (let i = 0; i < this.tracks.length; i++) {
      if (i === this.primaryIndex) continue;
      this.tracks[i].currentIndex = this._findIndexAtTime(this.tracks[i].timeline, eventTime);
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
    const eventTime = this.timeline[this.currentIndex]?.time || 0;
    this.startTime = ctx.currentTime - eventTime / this.tempoScale;

    // Re-sync non-primary tracks
    for (let i = 0; i < this.tracks.length; i++) {
      if (i === this.primaryIndex) continue;
      this.tracks[i].currentIndex = this._findIndexAtTime(this.tracks[i].timeline, eventTime);
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
    for (const t of this.tracks) t.currentIndex = 0;
    events.emit(TAB_STOP);
  }

  setTempoScale(scale) {
    if (this.state === 'playing' && this.timeline) {
      const ctx = getAudioContext();
      const eventTime = this.timeline[this.currentIndex]?.time || 0;
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
    if (!this.timeline) return;
    this.currentIndex = Math.max(0, Math.min(index, this.timeline.length - 1));
    if (this.state === 'playing') {
      const ctx = getAudioContext();
      const eventTime = this.timeline[this.currentIndex].time;
      this.startTime = ctx.currentTime - eventTime / this.tempoScale;

      for (let i = 0; i < this.tracks.length; i++) {
        if (i === this.primaryIndex) continue;
        this.tracks[i].currentIndex = this._findIndexAtTime(this.tracks[i].timeline, eventTime);
      }
    }
  }

  _findIndexAtTime(timeline, time) {
    if (!timeline || timeline.length === 0) return 0;
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].time >= time - 0.001) return i;
    }
    return timeline.length;
  }

  _scheduleTrackAudio(track, scaledTime, event, gain) {
    const noteDur = event.duration / this.tempoScale;
    if (track.isDrum) {
      for (const note of event.notes) {
        if (note.tieDestination) continue;
        const drumNote = note.midi > 0 ? note.midi : note.fret;
        playDrum(drumNote, scaledTime, gain);
      }
    } else {
      for (const note of event.notes) {
        if (note.tieDestination) continue;
        const baseMidi = (track.tuning && track.tuning[note.string]) || 40;
        const midi = note.midi > 0 ? note.midi : baseMidi + note.fret;
        playNote(midiToFrequency(midi), Math.max(0, Math.min(5, note.string)), scaledTime, gain, noteDur);
      }
    }
  }

  _scheduler() {
    if (this.state !== 'playing' || !this.timeline) return;

    const ctx = getAudioContext();
    const lookahead = LOOKAHEAD_MS / 1000;
    const primary = this.tracks[this.primaryIndex];

    // --- Schedule primary track (audio + visuals) ---
    while (primary.currentIndex < primary.timeline.length) {
      const event = primary.timeline[primary.currentIndex];
      const scaledTime = this.startTime + event.time / this.tempoScale;

      if (scaledTime > ctx.currentTime + lookahead) break;

      // Audio (if not muted)
      if (!primary.muted) {
        this._scheduleTrackAudio(primary, scaledTime, event, PRIMARY_GAIN);
      }

      // Visual sync
      const delay = Math.max(0, (scaledTime - ctx.currentTime) * 1000);
      const idx = primary.currentIndex;
      const notesCopy = event.notes;
      const mbIndex = event.masterBarIndex;

      // Collect measure notes for fretboard
      const measure = primary.measures.find(m => m.masterBarIndex === mbIndex);
      const measureNotes = [];
      if (measure) {
        for (const bi of measure.beatIndices) {
          const b = primary.timeline[bi];
          if (b) {
            for (const n of b.notes) {
              if (!n.tieDestination) measureNotes.push(n);
            }
          }
        }
      }

      setTimeout(() => {
        events.emit(TAB_BEAT_ON, {
          index: idx,
          notes: notesCopy,
          measureNotes,
          masterBarIndex: mbIndex,
        });
        events.emit(TAB_POSITION, {
          currentIndex: idx,
          totalBeats: primary.timeline.length,
          masterBarIndex: mbIndex,
          totalBars: primary.measures.length,
        });
      }, delay);

      if (idx > 0) {
        setTimeout(() => {
          events.emit(TAB_BEAT_OFF, { index: idx - 1 });
        }, delay);
      }

      primary.currentIndex++;

      // Loop handling
      if (this.loopB !== null && primary.currentIndex > this.loopB) {
        const loopStart = this.loopA !== null ? this.loopA : 0;
        primary.currentIndex = loopStart;
        const restartTime = primary.timeline[loopStart].time;
        this.startTime = ctx.currentTime - restartTime / this.tempoScale + 0.05;

        for (let i = 0; i < this.tracks.length; i++) {
          if (i === this.primaryIndex) continue;
          this.tracks[i].currentIndex = this._findIndexAtTime(this.tracks[i].timeline, restartTime);
        }
        break;
      }
    }

    // --- Schedule non-primary tracks (audio only) ---
    for (let i = 0; i < this.tracks.length; i++) {
      if (i === this.primaryIndex) continue;
      const track = this.tracks[i];
      if (track.muted) {
        // Still advance the index to stay in sync, but don't play audio
        while (track.currentIndex < track.timeline.length) {
          const event = track.timeline[track.currentIndex];
          const scaledTime = this.startTime + event.time / this.tempoScale;
          if (scaledTime > ctx.currentTime + lookahead) break;
          track.currentIndex++;
        }
        continue;
      }

      while (track.currentIndex < track.timeline.length) {
        const event = track.timeline[track.currentIndex];
        const scaledTime = this.startTime + event.time / this.tempoScale;

        if (scaledTime > ctx.currentTime + lookahead) break;

        this._scheduleTrackAudio(track, scaledTime, event, BACKING_GAIN);
        track.currentIndex++;
      }
    }

    // End of primary timeline
    if (primary.currentIndex >= primary.timeline.length) {
      this.stop();
    }
  }
}
