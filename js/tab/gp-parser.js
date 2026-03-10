// Guitar Pro (.gp) file parser — ZIP + GPIF XML extraction

import { getJSZip } from '../lib/vendors.js';

/**
 * Parse a .gp file (ArrayBuffer) into a normalized score object.
 */
export async function parseGPFile(arrayBuffer) {
  const JSZip = getJSZip();
  let zip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch (err) {
    throw new Error('Not a valid Guitar Pro 7/8 file (.gp is a ZIP-based format). Older .gp5/.gp4 files are not supported.');
  }

  const gpifFile = zip.file('Content/score.gpif');
  if (!gpifFile) throw new Error('Invalid GP file: score.gpif not found in archive');

  const gpifText = await gpifFile.async('string');
  const doc = new DOMParser().parseFromString(gpifText, 'text/xml');

  // Check for DOMParser errors
  const parseError = doc.getElementsByTagName('parsererror');
  if (parseError.length > 0) {
    throw new Error('Failed to parse score.gpif (XML error): ' + parseError[0].textContent);
  }

  try {
    return parseGPIF(doc);
  } catch (err) {
    console.error('GPIF mapping error:', err);
    throw new Error('Internal mapping error: ' + err.message);
  }
}

function parseGPIF(doc) {
  const root = doc.documentElement;

  // --- Metadata ---
  const title = textContent(root, 'Score > Title') || 'Untitled';
  const artist = textContent(root, 'Score > Artist') || 'Unknown';

  // --- Rhythms ---
  const rhythms = new Map();
  for (const el of root.querySelectorAll('Rhythms > Rhythm')) {
    const id = parseInt(el.getAttribute('id'));
    const noteValue = textContent(el, 'NoteValue') || 'Quarter';
    const dotEl = el.querySelector('AugmentationDot');
    const dots = dotEl ? parseInt(dotEl.getAttribute('count') || '1') : 0;
    const tupletEl = el.querySelector('PrimaryTuplet');
    let tupletNum = 0, tupletDen = 0;
    if (tupletEl) {
      tupletNum = parseInt(tupletEl.getAttribute('num') || '0');
      tupletDen = parseInt(tupletEl.getAttribute('den') || '0');
    }
    rhythms.set(id, { id, noteValue, dots, tupletNum, tupletDen });
  }

  // --- Notes ---
  const notes = new Map();
  for (const el of root.querySelectorAll('Notes > Note')) {
    const id = parseInt(el.getAttribute('id'));
    let fret = 0, string = 0, midi = 0;
    let tieOrigin = false, tieDestination = false;
    let muted = false, hopoOrigin = false, hopoDestination = false, slide = false, bended = false, harmonic = false;
    let palmMuted = false;
    let pickStroke = null;

    let vibrato = false;

    for (const prop of el.querySelectorAll('Properties > Property')) {
      const name = prop.getAttribute('name');
      const val = (textContent(prop, 'Value') || textContent(prop, 'Number') || prop.textContent.trim());
      
      // If the property exists but val is null/empty, we assume it's a true flag.
      // If val is "false" or "0", it's explicitly false.
      const isTrue = (val === null || val === '') || (val !== 'false' && val !== '0');
      
      if (name === 'Fret') {
        fret = parseInt(val || '0');
      } else if (name === 'String') {
        string = parseInt(val || '0');
      } else if (name === 'Midi') {
        midi = parseInt(val || '0');
      } else if (name === 'Muted') {
        muted = isTrue;
      } else if (name === 'PalmMuted') {
        palmMuted = isTrue;
      } else if (name === 'HopoOrigin') {
        hopoOrigin = isTrue;
      } else if (name === 'HopoDestination') {
        hopoDestination = isTrue;
      } else if (name === 'Slide') {
        slide = isTrue;
      } else if (name === 'Bended') {
        bended = isTrue;
      } else if (name === 'Harmonic') {
        harmonic = isTrue;
      } else if (name === 'Vibrato') {
        vibrato = isTrue;
      } else if (name === 'PickStroke') {
        pickStroke = val || 'None';
      }
    }

    const tieEl = el.querySelector('Tie');
    if (tieEl) {
      const origin = tieEl.getAttribute('origin');
      const dest = tieEl.getAttribute('destination');
      tieOrigin = origin === 'true' || origin === '1';
      tieDestination = dest === 'true' || dest === '1';
    }

    notes.set(id, {
      id, fret, string, midi,
      tieOrigin, tieDestination,
      muted, palmMuted, hopoOrigin, hopoDestination, slide, bended, harmonic, vibrato,
      pickStroke
    });
  }

  // --- Beats ---
  const beats = new Map();
  for (const el of root.querySelectorAll('Beats > Beat')) {
    const id = parseInt(el.getAttribute('id'));
    const rhythmRef = el.querySelector('Rhythm');
    const rhythmId = rhythmRef ? parseInt(rhythmRef.getAttribute('ref')) : 0;

    const noteIds = [];
    const notesEl = el.querySelector('Notes');
    if (notesEl) {
      const text = notesEl.textContent.trim();
      if (text) {
        for (const nid of text.split(/\s+/)) {
          const parsed = parseInt(nid);
          if (!isNaN(parsed)) noteIds.push(parsed);
        }
      }
    }

    const isRest = el.querySelector('GraceNotes') === null &&
                   el.querySelector('Notes') === null;
    const dynEl = el.querySelector('Dynamic');
    const dynamic = dynEl ? dynEl.textContent.trim() : 'MF';

    // pickStroke is a beat-level property in the GPIF format
    const pickStrokeEl = el.querySelector('Properties > Property[name="PickStroke"]');
    const pickStroke = pickStrokeEl
      ? (textContent(pickStrokeEl, 'Value') || textContent(pickStrokeEl, 'Direction') || 'None')
      : null;

    beats.set(id, { id, rhythmId, noteIds, isRest, dynamic, pickStroke });
  }

  // --- Voices ---
  const voices = new Map();
  for (const el of root.querySelectorAll('Voices > Voice')) {
    const id = parseInt(el.getAttribute('id'));
    const beatsEl = el.querySelector('Beats');
    const text = beatsEl ? beatsEl.textContent.trim() : '';
    const beatIds = text ? text.split(/\s+/).map(Number).filter(n => !isNaN(n)) : [];
    voices.set(id, { id, beatIds });
  }

  // --- Bars ---
  const bars = new Map();
  for (const el of root.querySelectorAll('Bars > Bar')) {
    const id = parseInt(el.getAttribute('id'));
    const voicesEl = el.querySelector('Voices');
    const text = voicesEl ? voicesEl.textContent.trim() : '';
    const voiceIds = text ? text.split(/\s+/).map(Number).filter(n => !isNaN(n)) : [];
    bars.set(id, { id, voiceIds });
  }

  // --- Tracks ---
  const tracks = [];
  for (const el of root.querySelectorAll('Tracks > Track')) {
    const id = parseInt(el.getAttribute('id'));
    const name = (textContent(el, 'Name') || 'Track ' + id).trim();

    // Find tuning
    let tuning = [40, 45, 50, 55, 59, 64]; // default standard
    for (const prop of el.querySelectorAll('Properties > Property')) {
      if (prop.getAttribute('name') === 'Tuning') {
        const pitches = textContent(prop, 'Pitches');
        if (pitches) {
          tuning = pitches.trim().split(/\s+/).filter(s => s !== '').map(Number);
        }
      }
    }

    const stringCount = tuning.length;
    const isDrum = tuning.every(v => v === 0);

    tracks.push({ id, name, tuning, stringCount, isDrum });
  }

  // --- Tempo automations ---
  const tempoMap = new Map(); // bar index -> BPM
  for (const auto of root.querySelectorAll('MasterTrack > Automations > Automation')) {
    if (textContent(auto, 'Type') === 'Tempo') {
      const bar = parseInt(textContent(auto, 'Bar') || '0');
      const valText = textContent(auto, 'Value') || '120 2';
      const bpm = parseInt(valText.split(/\s+/)[0]);
      tempoMap.set(bar, bpm);
    }
  }

  // --- MasterBars ---
  const masterBars = [];
  let currentTempo = tempoMap.get(0) || 120;

  for (const el of root.querySelectorAll('MasterBars > MasterBar')) {
    const index = masterBars.length;

    if (tempoMap.has(index)) {
      currentTempo = tempoMap.get(index);
    }

    const timeStr = textContent(el, 'Time') || '4/4';
    const [num, den] = timeStr.split('/').map(Number);

    const barsEl = el.querySelector('Bars');
    const text = barsEl ? barsEl.textContent.trim() : '';
    const barIds = text ? text.split(/\s+/).map(Number).filter(n => !isNaN(n)) : [];

    // Section markers
    let section = null;
    const secEl = el.querySelector('Section');
    if (secEl) {
      section = {
        letter: textContent(secEl, 'Letter') || '',
        text: textContent(secEl, 'Text') || '',
      };
    }

    const repeatStart = el.querySelector('Repeat[start="true"]') !== null;
    const repeatEnd = el.querySelector('Repeat[end="true"]') !== null;
    const repeatCount = repeatEnd
      ? parseInt(el.querySelector('Repeat')?.getAttribute('count') || '2')
      : 0;

    masterBars.push({
      index,
      timeSignature: { num, den },
      tempo: currentTempo,
      section,
      repeatStart,
      repeatEnd,
      repeatCount,
      barIds,
    });
  }

  return {
    title,
    artist,
    tracks,
    masterBars,
    bars,
    voices,
    beats,
    notes,
    rhythms,
  };
}

function textContent(parent, selector) {
  const el = parent.querySelector(selector);
  return el ? el.textContent.trim() : null;
}
