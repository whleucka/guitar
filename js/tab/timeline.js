// Flatten parsed GP score into a timed event array for a specific track
// Supports repeat sections (repeatStart/repeatEnd/repeatCount)

const NOTE_VALUE_BEATS = {
  'Whole': 4,
  'Half': 2,
  'Quarter': 1,
  'Eighth': 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
};

const RHYTHM_LABELS = {
  'Whole': 'W',
  'Half': 'H',
  'Quarter': 'Q',
  'Eighth': '8',
  '16th': '16',
  '32nd': '32',
  '64th': '64',
};

function rhythmToBeats(rhythm) {
  let beats = NOTE_VALUE_BEATS[rhythm.noteValue] || 1;
  for (let d = 0; d < rhythm.dots; d++) {
    beats += beats / Math.pow(2, d + 1);
  }
  if (rhythm.tupletNum && rhythm.tupletDen) {
    beats = beats * rhythm.tupletDen / rhythm.tupletNum;
  }
  return beats;
}

/**
 * Expand master bars to handle repeats.
 * Returns a flat array of masterBar references in playback order.
 */
function expandRepeats(masterBars) {
  const expanded = [];
  let i = 0;

  while (i < masterBars.length) {
    const mb = masterBars[i];

    if (mb.repeatEnd && mb.repeatCount > 0) {
      // Find the matching repeatStart (scan backward from current position)
      let repeatStartIdx = i;
      for (let j = i; j >= 0; j--) {
        if (masterBars[j].repeatStart) {
          repeatStartIdx = j;
          break;
        }
      }

      // First pass is already played, so we need (repeatCount - 1) additional passes
      // But we must add the current bar range for any passes not yet added
      // Check if bars from repeatStartIdx..i are already in expanded from the first pass
      const rangeAlreadyAdded = expanded.length > 0 &&
        expanded[expanded.length - 1] === masterBars[i - 1 >= repeatStartIdx ? i - 1 : i];

      if (!rangeAlreadyAdded) {
        // Add the range for the first pass (repeatStartIdx..i inclusive)
        for (let j = repeatStartIdx; j <= i; j++) {
          expanded.push(masterBars[j]);
        }
      } else {
        // First pass was already added bar-by-bar; just add the current end bar
        expanded.push(masterBars[i]);
      }

      // Add (repeatCount - 1) additional repetitions
      for (let rep = 1; rep < mb.repeatCount; rep++) {
        for (let j = repeatStartIdx; j <= i; j++) {
          expanded.push(masterBars[j]);
        }
      }

      i++;
    } else {
      expanded.push(mb);
      i++;
    }
  }

  return expanded;
}

/**
 * Build a flat timeline of events for a track.
 * @param {object} score - parsed GP score
 * @param {number} trackIndex - index into score.tracks
 * @returns {{ timeline: Array, measures: Array }}
 */
export function buildTimeline(score, trackIndex) {
  const track = score.tracks[trackIndex];
  if (!track) return { timeline: [], measures: [] };

  const stringCount = track.stringCount;
  const timeline = [];
  const measures = [];
  let absoluteTime = 0;

  // Expand repeats to get playback-order master bars
  const playbackBars = expandRepeats(score.masterBars);

  for (const mb of playbackBars) {
    const barId = mb.barIds[trackIndex];
    if (barId === undefined) continue;

    const bar = score.bars.get(barId);
    if (!bar) continue;

    const tempo = mb.tempo;
    const beatDuration = 60 / tempo; // seconds per quarter note
    const measureStart = absoluteTime;

    // Support multiple voices per bar (common in drums and polyphonic guitar)
    const barBeatsMap = new Map(); // time -> { event }

    for (const voiceId of bar.voiceIds) {
      if (voiceId < 0) continue;
      const voice = score.voices.get(voiceId);
      if (!voice) continue;

      let voiceTime = measureStart;
      for (const beatId of voice.beatIds) {
        const beat = score.beats.get(beatId);
        if (!beat) continue;

        const rhythm = score.rhythms.get(beat.rhythmId);
        if (!rhythm) continue;

        const durationInBeats = rhythmToBeats(rhythm);
        const durationSecs = durationInBeats * beatDuration;

        const beatNotes = [];
        if (!beat.isRest) {
          for (const noteId of beat.noteIds) {
            const note = score.notes.get(noteId);
            if (!note) continue;
            beatNotes.push({
              fret: note.fret,
              string: note.string,
              midi: note.midi,
              tieOrigin: note.tieOrigin,
              tieDestination: note.tieDestination,
              muted: note.muted,
              palmMuted: note.palmMuted,
              hopoOrigin: note.hopoOrigin,
              hopoDestination: note.hopoDestination,
              slide: note.slide,
              bended: note.bended,
              vibrato: note.vibrato,
              harmonic: note.harmonic,
              pickStroke: beat.pickStroke || note.pickStroke,
            });
          }
        }

        // Use a small epsilon for time grouping to handle float precision
        const timeKey = Math.round(voiceTime * 1000) / 1000;
        if (barBeatsMap.has(timeKey)) {
          // Merge with existing beat at this time
          const existing = barBeatsMap.get(timeKey);
          existing.notes.push(...beatNotes);
          // Keep the longest duration for visual/scheduling purposes
          existing.duration = Math.max(existing.duration, durationSecs);
        } else {
          barBeatsMap.set(timeKey, {
            masterBarIndex: mb.index,
            time: voiceTime,
            duration: durationSecs,
            notes: beatNotes,
            rhythmLabel: RHYTHM_LABELS[rhythm.noteValue] || 'Q',
            dotted: rhythm.dots > 0,
            tupletNum: rhythm.tupletNum || 0,
            tempo,
            dynamic: beat.dynamic || 'MF',
          });
        }

        voiceTime += durationSecs;
      }
    }

    // Sort merged beats by time and add to timeline
    const sortedTimes = Array.from(barBeatsMap.keys()).sort((a, b) => a - b);
    const measureBeats = [];
    for (const t of sortedTimes) {
      timeline.push(barBeatsMap.get(t));
      measureBeats.push(timeline.length - 1);
    }

    // Ensure measure fills its full theoretical duration
    const measureDuration = (mb.timeSignature.num / (mb.timeSignature.den / 4)) * beatDuration;
    absoluteTime = measureStart + measureDuration;

    measures.push({
      masterBarIndex: mb.index,
      startTime: measureStart,
      endTime: absoluteTime,
      timeSignature: mb.timeSignature,
      tempo,
      section: mb.section,
      beatIndices: measureBeats,
    });
  }

  // --- Validate tie pairs ---
  // Strip orphaned ties: a tieOrigin without a matching tieDestination on the
  // next same-string note (or vice versa) produces nonsensical arcs, especially
  // at repeat boundaries where the GP file's tie flags don't account for the
  // expanded playback order.
  for (let i = 0; i < timeline.length; i++) {
    const event = timeline[i];
    for (const note of event.notes) {
      if (note.tieOrigin) {
        // Look forward for the next note on the same string
        let found = false;
        for (let j = i + 1; j < Math.min(i + 15, timeline.length); j++) {
          const target = timeline[j].notes.find(n => n.string === note.string);
          if (target) {
            found = target.tieDestination;
            break;
          }
        }
        if (!found) note.tieOrigin = false;
      }
      if (note.tieDestination) {
        // Look backward for the previous note on the same string
        let found = false;
        for (let j = i - 1; j >= Math.max(i - 15, 0); j--) {
          const target = timeline[j].notes.find(n => n.string === note.string);
          if (target) {
            found = target.tieOrigin;
            break;
          }
        }
        if (!found) note.tieDestination = false;
      }
    }
  }

  // --- Cap note durations at the next event's start time ---
  // Prevents notes from ringing into the next beat/measure.
  for (let i = 0; i < timeline.length - 1; i++) {
    const gap = timeline[i + 1].time - timeline[i].time;
    if (gap > 0 && timeline[i].duration > gap) {
      timeline[i].duration = gap;
    }
  }

  return { timeline, measures };
}
