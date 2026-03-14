// Tab playback engine — multi-track scheduling-ahead pattern for audio + visual sync

import { getAudioContext } from '../audio/audio-engine.js';
import { playNote } from '../audio/synth-voice.js';
import { playDrum } from '../audio/drum-voice.js';
import { scheduleClick } from '../audio/metronome-click.js';
import { midiToFrequency } from '../music/notes.js';
import { isFluidReady, fluidNoteOn, fluidNoteOff, fluidTrackNotesOff, fluidAllNotesOff } from '../audio/fluid-synth.js';
import { events, TAB_BEAT_ON, TAB_BEAT_OFF, TAB_POSITION, TAB_STOP } from '../events.js';
import { FLUID_SYNTH } from '../config.js';

const LOOKAHEAD_MS = 150;
const SCHEDULE_INTERVAL_MS = 25;

const PRIMARY_GAIN = 0.7;
const BACKING_GAIN = 0.35;

// Dynamic velocity mapping
const DYNAMIC_VELOCITY = {
  'PPP': 20, 'PP': 35, 'P': 50, 'MP': 65,
  'MF': 80, 'F': 95, 'FF': 110, 'FFF': 125,
};

export class TabPlayer {
  constructor() {
    // All tracks: [{ timeline, measures, measureMap, isDrum, muted, currentIndex }]
    this.tracks = [];
    this.primaryIndex = 0;

    this.startTime = 0;
    this.tempoScale = 1.0;
    this.loopA = null;
    this.loopB = null;
    this.state = 'stopped'; // stopped | playing | paused
    this.schedulerInterval = null;

    this.metronomeEnabled = false;
    this.nextMetronomeMeasureIndex = 0;
    this.nextMetronomeBeatInMeasure = 0;

    // rAF-based visual sync
    this._rafId = null;
    this._pendingVisuals = []; // sorted by scheduledTime
    this._pendingFluidAudio = []; // precision audio queue for FluidSynth
    this._fluidInterval = null;

    // External audio sync callbacks (for YouTube backing tracks)
    this._onPlay = null;   // (startTime: number) => void
    this._onPause = null;  // () => void
    this._onStop = null;   // () => void
    this._onSeek = null;   // (time: number) => void
    this._onTempoChange = null; // (scale: number) => void

    // When true, mute all synth audio (for YouTube backing mode)
    this._synthMuted = false;

    // External clock source (for YouTube mode).
    // When set, this function returns the current playback time in timeline
    // seconds, replacing AudioContext.currentTime as the master clock.
    // This eliminates drift by having a single source of truth.
    this._externalClockFn = null;
  }

  /**
   * Set callbacks for external audio sync (YouTube backing tracks).
   * @param {object} callbacks - { onPlay, onPause, onStop, onSeek, onTempoChange }
   */
  setExternalAudioCallbacks(callbacks) {
    this._onPlay = callbacks.onPlay || null;
    this._onPause = callbacks.onPause || null;
    this._onStop = callbacks.onStop || null;
    this._onSeek = callbacks.onSeek || null;
    this._onTempoChange = callbacks.onTempoChange || null;
  }

  /**
   * Clear external audio callbacks.
   */
  clearExternalAudioCallbacks() {
    this._onPlay = null;
    this._onPause = null;
    this._onStop = null;
    this._onSeek = null;
    this._onTempoChange = null;
  }

  /**
   * Mute/unmute synth audio (for YouTube backing mode).
   * When muted, visuals still play but no synth sounds.
   */
  setSynthMuted(muted) {
    this._synthMuted = muted;
  }

  /**
   * Set an external clock function for YouTube mode.
   * The function should return the current playback time in timeline seconds
   * (i.e. audioElement.currentTime - youtubeOffset), or -1 if not available.
   * When set, this becomes the single source of truth for all timing,
   * eliminating clock drift between AudioContext and HTMLAudioElement.
   * @param {Function|null} fn - () => number (timeline seconds) or null to use AudioContext
   */
  setExternalClock(fn) {
    this._externalClockFn = fn;
    this._loggedSchedulerType = false; // reset so next scheduler call logs its type
    this._extClockLogCount = 0;
    console.log(`[TabPlayer] External clock ${fn ? 'SET' : 'CLEARED'}`);
  }

  /** Primary track shortcuts */
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
    this.tracks = tracks.map(t => {
      // Build a Map<masterBarIndex, measure> for O(1) lookup
      const measureMap = new Map();
      for (const m of t.measures) {
        measureMap.set(m.masterBarIndex, m);
      }
      return {
        timeline: t.timeline,
        measures: t.measures,
        measureMap,
        isDrum: !!t.isDrum,
        tuning: t.tuning || [40, 45, 50, 55, 59, 64],
        muted: false,
        currentIndex: 0,
      };
    });
    this.primaryIndex = primaryIndex;
  }

  /**
   * Change which track is primary (visual). Does not change mute states.
   */
  setPrimary(index) {
    if (index < 0 || index >= this.tracks.length) return;
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

  setMetronomeEnabled(enabled) {
    this.metronomeEnabled = enabled;
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

    this._syncMetronome(eventTime);
    this._pendingVisuals = [];
    this._pendingFluidAudio = [];
    this._stopFluidInterval();

    // Reset diagnostic log flags
    this._loggedSchedulerType = false;
    this._loggedExtClockUsed = false;
    this._loggedExtClockFallback = false;
    this._extClockLogCount = 0;

    this.state = 'playing';
    console.log(`[TabPlayer] play() — externalClock=${!!this._externalClockFn}, synthMuted=${this._synthMuted}`);
    this.schedulerInterval = setInterval(() => this._scheduler(), SCHEDULE_INTERVAL_MS);
    this._startVisualLoop();
    if (isFluidReady()) this._startFluidInterval();

    // Notify external audio (YouTube)
    if (this._onPlay) this._onPlay(eventTime);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._clearScheduler();
    this._stopVisualLoop();
    this._pendingVisuals = [];
    this._pendingFluidAudio = [];
    this._stopFluidInterval();
    if (isFluidReady()) fluidAllNotesOff();

    // Notify external audio (YouTube)
    if (this._onPause) this._onPause();
  }

  stop() {
    this.state = 'stopped';
    this._clearScheduler();
    this._stopVisualLoop();
    this._pendingVisuals = [];
    this._pendingFluidAudio = [];
    this._stopFluidInterval();
    if (isFluidReady()) fluidAllNotesOff();

    this.currentIndex = 0;
    for (let i = 0; i < this.tracks.length; i++) {
      this.tracks[i].currentIndex = 0;
    }
    this._syncMetronome(0);

    // Notify external audio (YouTube)
    if (this._onStop) this._onStop();
    events.emit(TAB_STOP);
  }

  resume() {
    if (this.state !== 'paused' || !this.timeline) return;
    const ctx = getAudioContext();
    const eventTime = this.timeline[this.currentIndex]?.time || 0;
    this.startTime = ctx.currentTime - eventTime / this.tempoScale;

    for (let i = 0; i < this.tracks.length; i++) {
      if (i === this.primaryIndex) continue;
      this.tracks[i].currentIndex = this._findIndexAtTime(this.tracks[i].timeline, eventTime);
    }

    this._syncMetronome(eventTime);
    this._pendingVisuals = [];
    this._pendingFluidAudio = [];
    this._stopFluidInterval();

    // Reset diagnostic log flags
    this._loggedSchedulerType = false;
    this._loggedExtClockUsed = false;
    this._loggedExtClockFallback = false;
    this._extClockLogCount = 0;

    this.state = 'playing';
    console.log(`[TabPlayer] resume() — externalClock=${!!this._externalClockFn}, synthMuted=${this._synthMuted}`);
    this.schedulerInterval = setInterval(() => this._scheduler(), SCHEDULE_INTERVAL_MS);
    this._startVisualLoop();
    if (isFluidReady()) this._startFluidInterval();

    // Notify external audio (YouTube)
    if (this._onPlay) this._onPlay(eventTime);
  }

  /**
   * Returns the current playback time in the timeline's time space (seconds).
   * In YouTube mode, reads directly from the audio element (single clock source).
   * In synth mode, uses AudioContext and accounts for audio output latency.
   */
  getPlaybackTime() {
    const ctx = getAudioContext();

    // Determine latency to subtract for visual sync
    let latencySecs = FLUID_SYNTH.visualLatencyMs / 1000;
    if (FLUID_SYNTH.visualLatencyMs === 0 && ctx.outputLatency) {
      // Base system latency + 50ms buffer
      latencySecs = ctx.outputLatency + 0.05;
    }
    // Add FluidSynth ScriptProcessor buffer latency when active
    if (isFluidReady() && !this._synthMuted) {
      const fluidBufferLatency = (FLUID_SYNTH.bufferSize / ctx.sampleRate) * 2;
      latencySecs += fluidBufferLatency;
    }

    // External clock mode (YouTube): read directly from the audio element.
    // This is the single source of truth — no drift possible.
    if (this._externalClockFn) {
      const extTime = this._externalClockFn();
      if (extTime >= 0) {
        if (!this._loggedExtClockUsed) {
          console.log(`[getPlaybackTime] Using external clock: ${extTime.toFixed(3)}s`);
          this._loggedExtClockUsed = true;
        }
        // Apply same latency compensation to external clock for consistent visual sync
        return Math.max(0, extTime - latencySecs);
      }
      // External clock not ready yet (e.g. YouTube hasn't started),
      // fall through to AudioContext-based calculation
      if (!this._loggedExtClockFallback) {
        console.log(`[getPlaybackTime] External clock returned ${extTime}, falling back to AudioContext`);
        this._loggedExtClockFallback = true;
      }
    }

    if (this.state === 'stopped') return 0;

    let rawTime;
    if (this.state === 'paused') {
      rawTime = this.timeline[this.currentIndex]?.time || 0;
    } else {
      rawTime = (ctx.currentTime - this.startTime) * this.tempoScale;
    }
    
    return Math.max(0, rawTime - latencySecs);
  }

  /**
   * Debug: log timing info to console. Call from browser console:
   * window.tabPlayer.debugTiming()
   */
  debugTiming() {
    const ctx = getAudioContext();
    console.log('=== Timing Debug ===');
    console.log('audioContext.currentTime:', ctx.currentTime);
    console.log('startTime:', this.startTime);
    console.log('tempoScale:', this.tempoScale);
    console.log('state:', this.state);
    console.log('currentIndex:', this.currentIndex);
    if (this.timeline && this.timeline[this.currentIndex]) {
      console.log('current event.time:', this.timeline[this.currentIndex].time);
    }
    console.log('getPlaybackTime():', this.getPlaybackTime());
    console.log('pending visuals:', this._pendingVisuals.length);
    console.log('pending fluid audio:', this._pendingFluidAudio.length);
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

    // Notify external audio (YouTube)
    if (this._onTempoChange) this._onTempoChange(scale);
  }

  setLoop(a, b) {
    this.loopA = a;
    this.loopB = b;
  }

  seekTo(index) {
    if (!this.timeline) return;
    this.currentIndex = Math.max(0, Math.min(index, this.timeline.length - 1));
    const eventTime = this.timeline[this.currentIndex].time;

    if (this.state === 'playing') {
      const ctx = getAudioContext();
      this.startTime = ctx.currentTime - eventTime / this.tempoScale;

      for (let i = 0; i < this.tracks.length; i++) {
        if (i === this.primaryIndex) continue;
        this.tracks[i].currentIndex = this._findIndexAtTime(this.tracks[i].timeline, eventTime);
      }
    }
    this._syncMetronome(eventTime);

    // Notify external audio (YouTube)
    if (this._onSeek) this._onSeek(eventTime);
  }

  /**
   * Re-sync the scheduler's currentIndex to match a given timeline time.
   * Used when the offset mapping changes (e.g. YouTube offset slider)
   * without the audio position changing.
   */
  resyncToTime(time) {
    if (!this.timeline) return;
    this.currentIndex = this._findIndexAtTime(this.timeline, time);
    for (let i = 0; i < this.tracks.length; i++) {
      if (i === this.primaryIndex) continue;
      this.tracks[i].currentIndex = this._findIndexAtTime(this.tracks[i].timeline, time);
    }
    this._syncMetronome(time);
  }

  // --- Internal helpers ---

  _clearScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  _syncMetronome(time) {
    if (!this.measures) return;
    for (let i = 0; i < this.measures.length; i++) {
      const m = this.measures[i];
      if (time >= m.startTime && time < m.endTime) {
        this.nextMetronomeMeasureIndex = i;
        const beatDuration = 60 / m.tempo;
        this.nextMetronomeBeatInMeasure = Math.floor((time - m.startTime) / beatDuration);

        const elapsedInBeat = (time - m.startTime) % beatDuration;
        if (elapsedInBeat > 0.001) {
          this.nextMetronomeBeatInMeasure++;
          if (this.nextMetronomeBeatInMeasure >= m.timeSignature.num) {
            this.nextMetronomeBeatInMeasure = 0;
            this.nextMetronomeMeasureIndex++;
          }
        }
        return;
      }
    }
    this.nextMetronomeMeasureIndex = this.measures.length;
    this.nextMetronomeBeatInMeasure = 0;
  }

  /**
   * Binary search for the first timeline index at or after the given time.
   * O(log n) instead of O(n).
   */
  _findIndexAtTime(timeline, time) {
    if (!timeline || timeline.length === 0) return 0;
    const target = time - 0.001;
    let lo = 0;
    let hi = timeline.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (timeline[mid].time < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo < timeline.length ? lo : timeline.length;
  }

  _scheduleTrackAudio(track, scaledTime, event, gain, trackPlayerIndex) {
    // Skip all synth audio when using external audio (YouTube)
    if (this._synthMuted) return;

    const noteDur = event.duration / this.tempoScale;

    // Use FluidSynth when available — push to precision audio queue
    if (isFluidReady()) {
      // Rest beat: silence the track so notes don't ring through rests
      if (event.notes.length === 0) {
        this._pendingFluidAudio.push({ time: scaledTime, trackIdx: trackPlayerIndex, type: 'rest' });
        return;
      }

      const velocity = DYNAMIC_VELOCITY[event.dynamic] || 80;

      for (const note of event.notes) {
        if (note.tieDestination) continue;

        let midi;
        if (track.isDrum) {
          midi = note.midi > 0 ? note.midi : note.fret;
        } else {
          const baseMidi = (track.tuning && track.tuning[note.string]) || 40;
          midi = note.midi > 0 ? note.midi : baseMidi + note.fret;
        }

        const vel = note.muted ? Math.round(velocity * 0.3) : velocity;
        this._pendingFluidAudio.push({ time: scaledTime, trackIdx: trackPlayerIndex, midi, velocity: vel, type: 'on' });

        if (!note.tieOrigin) {
          this._pendingFluidAudio.push({ time: scaledTime + noteDur, trackIdx: trackPlayerIndex, midi, type: 'off' });
        }
      }
      return;
    }

    // Fallback: original Karplus-Strong / drum synth
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

  _scheduleMetronomeClick(time, isDownbeat) {
    scheduleClick(time, isDownbeat);
  }

  // --- Visual sync (rAF, ~60fps — fine for cursor updates) ---

  _startVisualLoop() {
    const tick = () => {
      if (this.state !== 'playing') return;
      this._flushVisuals();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopVisualLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  // --- FluidSynth audio sync (tight interval for low-latency note firing) ---

  _startFluidInterval() {
    if (this._fluidInterval) return;
    this._fluidInterval = setInterval(() => this._flushFluidAudio(), 5);
  }

  _stopFluidInterval() {
    if (this._fluidInterval) {
      clearInterval(this._fluidInterval);
      this._fluidInterval = null;
    }
  }

  _flushFluidAudio() {
    if (this._pendingFluidAudio.length === 0) return;
    const now = getAudioContext().currentTime;
    let i = 0;
    let firedCount = 0;
    while (i < this._pendingFluidAudio.length) {
      const entry = this._pendingFluidAudio[i];
      if (entry.time <= now) {
        if (entry.type === 'on') {
          fluidNoteOn(entry.trackIdx, entry.midi, entry.velocity);
          firedCount++;
        } else if (entry.type === 'off') {
          fluidNoteOff(entry.trackIdx, entry.midi);
        } else if (entry.type === 'rest') {
          fluidTrackNotesOff(entry.trackIdx);
        }
        // Swap-remove for O(1) deletion
        this._pendingFluidAudio[i] = this._pendingFluidAudio[this._pendingFluidAudio.length - 1];
        this._pendingFluidAudio.pop();
      } else {
        i++;
      }
    }
    // Debug: log if notes are being fired
    if (firedCount > 0 && !this._loggedFluidFire) {
      console.log(`[FLUID] Firing ${firedCount} notes`);
      this._loggedFluidFire = true;
    }
  }

  _flushVisuals() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    while (this._pendingVisuals.length > 0) {
      const entry = this._pendingVisuals[0];
      if (entry.scheduledTime > now) break;
      this._pendingVisuals.shift();

      // Emit beat-off for previous
      if (entry.index > 0) {
        events.emit(TAB_BEAT_OFF, { index: entry.index - 1 });
      }

      events.emit(TAB_BEAT_ON, {
        index: entry.index,
        notes: entry.notes,
        measureNotes: entry.measureNotes,
        masterBarIndex: entry.masterBarIndex,
      });
      events.emit(TAB_POSITION, {
        currentIndex: entry.index,
        totalBeats: entry.totalBeats,
        masterBarIndex: entry.masterBarIndex,
        totalBars: entry.totalBars,
      });
    }
  }

  // --- Main scheduler ---

  _scheduler() {
    if (this.state !== 'playing' || !this.timeline) return;

    // In external clock mode (YouTube), use a simplified scheduler that
    // reads the current position directly from the audio element.
    // This eliminates drift by deriving all timing from a single clock.
    if (this._externalClockFn) {
      this._schedulerExternalClock();
      return;
    }

    // Log once to confirm AudioContext scheduler is being used (not external clock)
    if (!this._loggedSchedulerType) {
      console.log('[Scheduler] Using AudioContext clock (no external clock set)');
      this._loggedSchedulerType = true;
    }

    const ctx = getAudioContext();
    
    // Debug: check for AudioContext issues
    if (ctx.state !== 'running') {
      console.warn(`[AUDIO] Context state: ${ctx.state}`);
      ctx.resume();
    }
    
    const lookahead = LOOKAHEAD_MS / 1000;
    const primary = this.tracks[this.primaryIndex];

    // --- Schedule metronome ---
    if (this.metronomeEnabled && this.measures) {
      while (this.nextMetronomeMeasureIndex < this.measures.length) {
        const m = this.measures[this.nextMetronomeMeasureIndex];
        const beatDuration = 60 / m.tempo;
        const beatTime = m.startTime + this.nextMetronomeBeatInMeasure * beatDuration;
        const scaledTime = this.startTime + beatTime / this.tempoScale;

        if (scaledTime > ctx.currentTime + lookahead) break;

        this._scheduleMetronomeClick(scaledTime, this.nextMetronomeBeatInMeasure === 0);

        this.nextMetronomeBeatInMeasure++;
        if (this.nextMetronomeBeatInMeasure >= m.timeSignature.num) {
          this.nextMetronomeBeatInMeasure = 0;
          this.nextMetronomeMeasureIndex++;
        }
      }
    }

    // --- Schedule primary track (audio + visuals) ---
    while (primary.currentIndex < primary.timeline.length) {
      const event = primary.timeline[primary.currentIndex];
      const scaledTime = this.startTime + event.time / this.tempoScale;

      if (scaledTime > ctx.currentTime + lookahead) break;

      // Audio (if not muted and synth not muted globally)
      if (!primary.muted && !this._synthMuted) {
        this._scheduleTrackAudio(primary, scaledTime, event, PRIMARY_GAIN, this.primaryIndex);
      }



      // Queue visual update for rAF-based sync (O(1) measureMap lookup)
      const idx = primary.currentIndex;
      const mbIndex = event.masterBarIndex;
      const measure = primary.measureMap.get(mbIndex);
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

      this._pendingVisuals.push({
        scheduledTime: scaledTime,
        index: idx,
        notes: event.notes,
        measureNotes,
        masterBarIndex: mbIndex,
        totalBeats: primary.timeline.length,
        totalBars: primary.measures.length,
      });

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
        this._syncMetronome(restartTime);
        break;
      }
    }

    // --- Schedule non-primary tracks (audio only) ---
    // Skip entirely when synth is muted (YouTube mode) - only primary track needed for visuals
    if (!this._synthMuted) {
      for (let i = 0; i < this.tracks.length; i++) {
        if (i === this.primaryIndex) continue;
        const track = this.tracks[i];
        if (track.muted) {
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

          this._scheduleTrackAudio(track, scaledTime, event, BACKING_GAIN, i);
          track.currentIndex++;
        }
      }
    }

    // End of primary timeline
    if (primary.currentIndex >= primary.timeline.length) {
      this.stop();
    }
  }

  /**
   * Simplified scheduler for external clock mode (YouTube).
   * Instead of the lookahead-based scheduling pattern used for AudioContext,
   * this reads the current timeline position directly from the external clock
   * and immediately emits visual events for any beats that have been reached.
   * No audio scheduling is needed (synth is muted in YouTube mode).
   */
  _schedulerExternalClock() {
    const currentTime = this._externalClockFn();
    if (currentTime < 0) return; // external clock not ready yet

    // Periodic diagnostic logging
    if (!this._extClockLogCount) this._extClockLogCount = 0;
    if (this._extClockLogCount % 40 === 0) { // every ~1 second (25ms * 40)
      const primary = this.tracks[this.primaryIndex];
      const nextEvent = primary.timeline[primary.currentIndex];
      console.log(`[ExtClock] time=${currentTime.toFixed(3)}s, idx=${primary.currentIndex}, nextBeat=${nextEvent ? nextEvent.time.toFixed(3) : 'END'}s`);
    }
    this._extClockLogCount++;

    const primary = this.tracks[this.primaryIndex];

    // --- Emit visuals for beats at or before current time ---
    while (primary.currentIndex < primary.timeline.length) {
      const event = primary.timeline[primary.currentIndex];

      // Event is in the future — stop here
      if (event.time > currentTime) break;

      // Emit visual events immediately (no queue needed — we're already
      // at or past this point in the audio)
      const idx = primary.currentIndex;
      const mbIndex = event.masterBarIndex;
      const measure = primary.measureMap.get(mbIndex);
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

      // Beat off for previous
      if (idx > 0) {
        events.emit(TAB_BEAT_OFF, { index: idx - 1 });
      }

      events.emit(TAB_BEAT_ON, {
        index: idx,
        notes: event.notes,
        measureNotes,
        masterBarIndex: mbIndex,
      });
      events.emit(TAB_POSITION, {
        currentIndex: idx,
        totalBeats: primary.timeline.length,
        masterBarIndex: mbIndex,
        totalBars: primary.measures.length,
      });

      primary.currentIndex++;

      // Loop handling
      if (this.loopB !== null && primary.currentIndex > this.loopB) {
        const loopStart = this.loopA !== null ? this.loopA : 0;
        primary.currentIndex = loopStart;

        for (let i = 0; i < this.tracks.length; i++) {
          if (i === this.primaryIndex) continue;
          const restartTime = primary.timeline[loopStart].time;
          this.tracks[i].currentIndex = this._findIndexAtTime(this.tracks[i].timeline, restartTime);
        }
        this._syncMetronome(primary.timeline[loopStart].time);

        // Notify external audio to seek back to loop start
        if (this._onSeek) this._onSeek(primary.timeline[loopStart].time);
        break;
      }
    }

    // End of primary timeline
    if (primary.currentIndex >= primary.timeline.length) {
      this.stop();
    }
  }
}
