// Flatten parsed GP score into a timed event array for a specific track

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

  for (const mb of score.masterBars) {
    const barId = mb.barIds[trackIndex];
    if (barId === undefined) continue;

    const bar = score.bars.get(barId);
    if (!bar) continue;

    const tempo = mb.tempo;
    const beatDuration = 60 / tempo; // seconds per quarter note

    const measureStart = absoluteTime;
    const measureBeats = [];

    // Use first voice only (voice index 0)
    const voiceId = bar.voiceIds[0];
    if (voiceId >= 0) {
      const voice = score.voices.get(voiceId);
      if (voice) {
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

              // GPIF string index matches app convention: 0 = low E, 5 = high e
              const appString = note.string;

              beatNotes.push({
                fret: note.fret,
                string: appString,
                midi: note.midi,
                tieDestination: note.tieDestination,
              });
            }
          }

          timeline.push({
            masterBarIndex: mb.index,
            time: absoluteTime,
            duration: durationSecs,
            notes: beatNotes,
            rhythmLabel: RHYTHM_LABELS[rhythm.noteValue] || 'Q',
            dotted: rhythm.dots > 0,
            tempo,
          });

          measureBeats.push(timeline.length - 1);
          absoluteTime += durationSecs;
        }
      }
    }

    // Ensure measure fills its full theoretical duration based on time signature.
    // Beats may not sum to a full measure (trailing rests are implicit in GP).
    const measureDuration = (mb.timeSignature.num / (mb.timeSignature.den / 4)) * beatDuration;
    const measureEnd = measureStart + measureDuration;
    if (absoluteTime < measureEnd) {
      absoluteTime = measureEnd;
    }

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

  return { timeline, measures };
}
