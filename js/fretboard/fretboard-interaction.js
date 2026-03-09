// Click, hover, and touch handlers for fretboard

import { events, NOTE_PLAY, NOTE_HIGHLIGHT, NOTE_CLEAR_HIGHLIGHT, SHOW_ALL_NOTES, SCALE_SELECT, SCALE_CLEAR, CAGED_POSITION, SCALE_NOTE_ON, SCALE_NOTE_OFF, CHORD_SELECT, CHORD_CLEAR, CHORD_NOTE_ON, CHORD_NOTE_OFF, TAB_BEAT_ON, TAB_BEAT_OFF, TAB_STOP } from '../events.js';
import { playNote } from '../audio/synth-voice.js';
import { computeScaleMap, filterCAGEDPosition } from '../music/scales.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Wire up interaction on the fretboard.
 * @param {SVGElement} svg
 * @param {Map} noteElements - Map of "string-fret" → { group, noteGroup, hitArea, noteInfo }
 */
export function setupInteraction(svg, noteElements) {
  let showAllNotes = false;
  const highlightedNotes = new Set(); // note names like 'C', 'F#'
  let activeScaleMap = null; // Map of "string-fret" → { degree, isRoot }
  let activeCAGEDMap = null; // Filtered version for CAGED position
  let activeChordMap = null; // Map of "string-fret" → { degree, isRoot }

  // --- Click/touch to play ---
  svg.addEventListener('pointerdown', (e) => {
    const hitArea = e.target.closest('.fb-hit-area');
    if (!hitArea) return;

    const g = hitArea.parentElement;
    const stringIdx = parseInt(g.dataset.string);
    const fret = parseInt(g.dataset.fret);
    const key = `${stringIdx}-${fret}`;
    const entry = noteElements.get(key);
    if (!entry) return;

    // Play audio
    playNote(entry.noteInfo.frequency, stringIdx);

    // Visual feedback — show note and animate
    entry.noteGroup.classList.add('visible', 'active');

    // Ping animation
    const circle = entry.noteGroup.querySelector('.fb-note-circle');
    const cx = circle.getAttribute('cx');
    const cy = circle.getAttribute('cy');
    const ping = document.createElementNS(SVG_NS, 'circle');
    ping.setAttribute('cx', cx);
    ping.setAttribute('cy', cy);
    ping.setAttribute('r', '10');
    ping.setAttribute('class', 'fb-note-ping');
    ping.setAttribute('fill', 'none');
    ping.setAttribute('stroke', 'var(--accent-red)');
    ping.setAttribute('stroke-width', '4');
    svg.appendChild(ping);

    setTimeout(() => {
      entry.noteGroup.classList.remove('active');
      const map = activeChordMap || activeCAGEDMap || activeScaleMap;
      const inMap = map && map.has(key);
      if (!showAllNotes && !highlightedNotes.has(entry.noteInfo.name) && !inMap) {
        entry.noteGroup.classList.remove('visible');
      }
      ping.remove();
    }, 500);

    events.emit(NOTE_PLAY, { string: stringIdx, fret, note: entry.noteInfo });
  });

  // --- Hover to show note name ---
  svg.addEventListener('pointerenter', (e) => {
    const hitArea = e.target.closest('.fb-hit-area');
    if (!hitArea) return;
    const g = hitArea.parentElement;
    const key = `${g.dataset.string}-${g.dataset.fret}`;
    const entry = noteElements.get(key);
    if (entry) entry.noteGroup.classList.add('hover-show');
  }, true);

  svg.addEventListener('pointerleave', (e) => {
    const hitArea = e.target.closest('.fb-hit-area');
    if (!hitArea) return;
    const g = hitArea.parentElement;
    const key = `${g.dataset.string}-${g.dataset.fret}`;
    const entry = noteElements.get(key);
    if (entry) entry.noteGroup.classList.remove('hover-show');
  }, true);

  // --- Event bus: highlight specific notes ---
  events.on(NOTE_HIGHLIGHT, ({ noteName }) => {
    highlightedNotes.add(noteName);
    updateDisplay(noteElements, highlightedNotes, showAllNotes, activeChordMap || activeCAGEDMap || activeScaleMap);
  });

  events.on(NOTE_CLEAR_HIGHLIGHT, ({ noteName }) => {
    highlightedNotes.delete(noteName);
    updateDisplay(noteElements, highlightedNotes, showAllNotes, activeChordMap || activeCAGEDMap || activeScaleMap);
  });

  // --- Event bus: show/hide all notes ---
  events.on(SHOW_ALL_NOTES, ({ show }) => {
    showAllNotes = show;
    updateDisplay(noteElements, highlightedNotes, showAllNotes, activeChordMap || activeCAGEDMap || activeScaleMap);
  });

  // --- Event bus: scale selection ---
  events.on(SCALE_SELECT, ({ root, scale }) => {
    activeScaleMap = computeScaleMap(root, scale);
    activeCAGEDMap = null;
    updateDisplay(noteElements, highlightedNotes, showAllNotes, activeScaleMap);
  });

  events.on(SCALE_CLEAR, () => {
    activeScaleMap = null;
    activeCAGEDMap = null;
    updateDisplay(noteElements, highlightedNotes, showAllNotes, null);
  });

  events.on(CAGED_POSITION, ({ root, scale, position }) => {
    activeScaleMap = computeScaleMap(root, scale);
    if (position) {
      activeCAGEDMap = filterCAGEDPosition(activeScaleMap, root, position);
    } else {
      activeCAGEDMap = null;
    }
    updateDisplay(noteElements, highlightedNotes, showAllNotes, activeChordMap || activeCAGEDMap || activeScaleMap);
  });

  // --- Event bus: scale playback note highlights ---
  events.on(SCALE_NOTE_ON, ({ key }) => {
    const entry = noteElements.get(key);
    if (entry) {
      entry.noteGroup.classList.add('visible', 'playing');
    }
  });

  events.on(SCALE_NOTE_OFF, (detail) => {
    if (detail && detail.key) {
      const entry = noteElements.get(detail.key);
      if (entry) {
        entry.noteGroup.classList.remove('playing');
      }
    } else {
      // Clear all playing states
      for (const [, entry] of noteElements) {
        entry.noteGroup.classList.remove('playing');
      }
    }
  });

  // --- Event bus: chord selection ---
  events.on(CHORD_SELECT, ({ fretboardMap }) => {
    activeChordMap = fretboardMap;
    updateDisplay(noteElements, highlightedNotes, showAllNotes, activeChordMap);
  });

  events.on(CHORD_CLEAR, () => {
    activeChordMap = null;
    updateDisplay(noteElements, highlightedNotes, showAllNotes, activeCAGEDMap || activeScaleMap);
  });

  // --- Event bus: chord strum note highlights ---
  events.on(CHORD_NOTE_ON, ({ key }) => {
    const entry = noteElements.get(key);
    if (entry) {
      entry.noteGroup.classList.add('visible', 'playing');
    }
  });

  events.on(CHORD_NOTE_OFF, (detail) => {
    if (detail && detail.key) {
      const entry = noteElements.get(detail.key);
      if (entry) entry.noteGroup.classList.remove('playing');
    } else {
      for (const [, entry] of noteElements) {
        entry.noteGroup.classList.remove('playing');
      }
    }
  });

  // --- Event bus: tab playback note highlights ---
  let tabMeasureKeys = [];  // all notes in current measure (shown as visible)
  let tabActiveKeys = [];   // current beat notes (shown as playing)

  events.on(TAB_BEAT_ON, ({ notes, measureNotes }) => {
    // Clear previous active highlights
    for (const key of tabActiveKeys) {
      const entry = noteElements.get(key);
      if (entry) entry.noteGroup.classList.remove('playing');
    }
    tabActiveKeys = [];

    // If measure changed, update measure note previews
    const newMeasureKeys = (measureNotes || []).map(n => `${n.string}-${n.fret}`);
    const measureChanged = newMeasureKeys.length !== tabMeasureKeys.length ||
      newMeasureKeys.some((k, i) => k !== tabMeasureKeys[i]);

    if (measureChanged) {
      // Remove old measure highlights
      for (const key of tabMeasureKeys) {
        const entry = noteElements.get(key);
        if (entry) {
          entry.noteGroup.classList.remove('visible', 'scale-tone');
        }
      }
      tabMeasureKeys = newMeasureKeys;

      // Show all measure notes as visible
      (measureNotes || []).forEach(n => {
        const key = `${n.string}-${n.fret}`;
        const entry = noteElements.get(key);
        if (entry) {
          entry.noteGroup.classList.add('visible', 'scale-tone');
        }
      });
    }

    // Highlight current beat notes as playing
    for (const note of notes) {
      if (note.tieDestination) continue;
      const key = `${note.string}-${note.fret}`;
      const entry = noteElements.get(key);
      if (entry) {
        entry.noteGroup.classList.add('visible', 'playing');
        tabActiveKeys.push(key);
      }
    }
  });

  events.on(TAB_STOP, () => {
    for (const key of tabActiveKeys) {
      const entry = noteElements.get(key);
      if (entry) entry.noteGroup.classList.remove('playing');
    }
    for (const key of tabMeasureKeys) {
      const entry = noteElements.get(key);
      if (entry) {
        entry.noteGroup.classList.remove('visible', 'scale-tone');
      }
    }
    tabActiveKeys = [];
    tabMeasureKeys = [];
  });
}

// Degree CSS classes for color-coding scale tones
const DEGREE_CLASSES = ['degree-root', 'degree-2', 'degree-3', 'degree-4', 'degree-5', 'degree-6', 'degree-7'];
const ALL_DEGREE_CLASSES = [...DEGREE_CLASSES, 'scale-tone', 'root', 'highlight'];

function updateDisplay(noteElements, highlightedNotes, showAll, scaleMap) {
  for (const [key, entry] of noteElements) {
    const { noteGroup, noteInfo } = entry;
    const isHighlighted = highlightedNotes.has(noteInfo.name);
    const scaleEntry = scaleMap ? scaleMap.get(key) : null;

    // Remove all degree/state classes
    for (const cls of ALL_DEGREE_CLASSES) {
      noteGroup.classList.remove(cls);
    }

    // Determine visibility
    const shouldShow = showAll || isHighlighted || scaleEntry;
    noteGroup.classList.toggle('visible', !!shouldShow);

    // Apply classes
    if (isHighlighted) {
      noteGroup.classList.add('highlight');
    }

    if (scaleEntry) {
      noteGroup.classList.add('scale-tone');
      if (scaleEntry.isRoot) {
        noteGroup.classList.add('root');
      }
      if (scaleEntry.degree >= 0 && scaleEntry.degree < DEGREE_CLASSES.length) {
        noteGroup.classList.add(DEGREE_CLASSES[scaleEntry.degree]);
      }
    }
  }
}
