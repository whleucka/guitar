// Guitar Pro (.gp) file parser — ZIP + GPIF XML extraction

/**
 * Parse a .gp file (ArrayBuffer) into a normalized score object.
 */
export async function parseGPFile(arrayBuffer) {
  const zip = await window.JSZip.loadAsync(arrayBuffer);
  const gpifFile = zip.file('Content/score.gpif');
  if (!gpifFile) throw new Error('Invalid GP file: no score.gpif found');

  const gpifText = await gpifFile.async('string');
  const doc = new DOMParser().parseFromString(gpifText, 'text/xml');

  return parseGPIF(doc);
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

    for (const prop of el.querySelectorAll('Properties > Property')) {
      const name = prop.getAttribute('name');
      if (name === 'Fret') {
        fret = parseInt(textContent(prop, 'Fret') || '0');
      } else if (name === 'String') {
        string = parseInt(textContent(prop, 'String') || '0');
      } else if (name === 'Midi') {
        midi = parseInt(textContent(prop, 'Number') || '0');
      } else if (name === 'Muted') {
        muted = true;
      } else if (name === 'PalmMuted') {
        palmMuted = true;
      } else if (name === 'HopoOrigin') {
        hopoOrigin = true;
      } else if (name === 'HopoDestination') {
        hopoDestination = true;
      } else if (name === 'Slide') {
        slide = true;
      } else if (name === 'Bended') {
        bended = true;
      } else if (name === 'Harmonic') {
        harmonic = true;
      } else if (name === 'PickStroke') {
        pickStroke = textContent(prop, 'Value') || 'None';
      }
    }

    const tieEl = el.querySelector('Tie');
    if (tieEl) {
      const origin = tieEl.getAttribute('origin');
      const dest = tieEl.getAttribute('destination');
      tieOrigin = origin === 'true';
      tieDestination = dest === 'true';
    }

    notes.set(id, {
      id, fret, string, midi,
      tieOrigin, tieDestination,
      muted, palmMuted, hopoOrigin, hopoDestination, slide, bended, harmonic,
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
      for (const nid of notesEl.textContent.trim().split(/\s+/)) {
        const parsed = parseInt(nid);
        if (!isNaN(parsed)) noteIds.push(parsed);
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
    const beatIds = beatsEl
      ? beatsEl.textContent.trim().split(/\s+/).map(Number).filter(n => !isNaN(n))
      : [];
    voices.set(id, { id, beatIds });
  }

  // --- Bars ---
  const bars = new Map();
  for (const el of root.querySelectorAll('Bars > Bar')) {
    const id = parseInt(el.getAttribute('id'));
    const voicesEl = el.querySelector('Voices');
    const voiceIds = voicesEl
      ? voicesEl.textContent.trim().split(/\s+/).map(Number)
      : [];
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
          tuning = pitches.trim().split(/\s+/).map(Number);
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
    const barIds = barsEl
      ? barsEl.textContent.trim().split(/\s+/).map(Number)
      : [];

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
