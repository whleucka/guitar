// Guitar configuration constants

export const TUNING = [
  { string: 6, note: 'E', octave: 2, midi: 40 },  // Low E
  { string: 5, note: 'A', octave: 2, midi: 45 },
  { string: 4, note: 'D', octave: 3, midi: 50 },
  { string: 3, note: 'G', octave: 3, midi: 55 },
  { string: 2, note: 'B', octave: 3, midi: 59 },
  { string: 1, note: 'E', octave: 4, midi: 64 },  // High E
];

// Common tuning presets
export const TUNING_PRESETS = [
  { name: 'Standard (E)', midi: [40, 45, 50, 55, 59, 64], notes: 'E A D G B E' },
  { name: 'Drop D', midi: [38, 45, 50, 55, 59, 64], notes: 'D A D G B E' },
  { name: 'Half Step Down', midi: [39, 44, 49, 54, 58, 63], notes: 'Eb Ab Db Gb Bb Eb' },
  { name: 'Drop Db', midi: [37, 44, 49, 54, 58, 63], notes: 'Db Ab Db Gb Bb Eb' },
  { name: 'Whole Step Down', midi: [38, 43, 48, 53, 57, 62], notes: 'D G C F A D' },
  { name: 'Drop C', midi: [36, 43, 48, 53, 57, 62], notes: 'C G C F A D' },
  { name: 'Drop B', midi: [35, 42, 47, 52, 56, 61], notes: 'B F# B E G# C#' },
  { name: 'Drop A', midi: [33, 40, 45, 50, 54, 59], notes: 'A E A D F# B' },
  { name: 'DADGAD', midi: [38, 45, 50, 55, 57, 62], notes: 'D A D G A D' },
  { name: 'Open G', midi: [38, 43, 50, 55, 59, 62], notes: 'D G D G B D' },
  { name: 'Open D', midi: [38, 45, 50, 54, 57, 62], notes: 'D A D F# A D' },
];

export const FRET_COUNT = 22;

// SVG dimensions
export const LAYOUT = {
  width: 1200,
  height: 200,
  paddingLeft: 50,   // Space for open string labels
  paddingRight: 20,
  paddingTop: 30,
  paddingBottom: 30,
  nutWidth: 8,
  scaleLength: 1100, // Used for fret spacing calculation
};

// String visual thickness (low E to high E)
export const STRING_WIDTHS = [4, 3.2, 2.6, 2, 1.6, 1.2];

// Fret marker positions
export const FRET_MARKERS = [3, 5, 7, 9, 12, 15, 17, 19, 21];
export const DOUBLE_MARKERS = [12];

// Note circle radius
export const NOTE_RADIUS = 10;

// Audio
export const AUDIO = {
  masterGain: 0.5,
  attack: 0.005,
  decay: 0.1,
  sustain: 0.3,
  release: 0.3,
  filterBase: 2000,
  // Thicker strings get lower filter cutoff
  filterPerString: [1200, 1500, 1800, 2200, 2600, 3000],
};

// Strum
export const STRUM = {
  downDelay: 22,    // ms between strings for downstroke
  upDelay: 20,      // ms between strings for upstroke
  velocity: 0.6,    // gain multiplier for strummed notes
};

// Metronome
export const METRONOME = {
  defaultBpm: 80,
  minBpm: 40,
  maxBpm: 220,
  clickFreqHigh: 1200,
  clickFreqLow: 800,
  clickDuration: 0.03,
  clickGain: 0.3,
  lookaheadMs: 100,
  scheduleIntervalMs: 25,
};

// FluidSynth performance tuning
// Increase bufferSize if audio crackles (try 8192 or 16384)
// Increase visualLatencyMs if cursor is ahead of audio
export const FLUID_SYNTH = {
  bufferSize: 8192,       // ScriptProcessor buffer size (power of 2: 2048, 4096, 8192, 16384)
  visualLatencyMs: 200,   // Delay cursor to match audio output latency
};
