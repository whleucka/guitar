// Tab static canvas drawing — staff lines, notes, annotations, rhythm stems
// All methods receive the canvas context and layout data; no state ownership.

import { TAB_CONSTANTS } from './tab-constants.js';
import { midiToNoteName } from '../music/notes.js';

const C = TAB_CONSTANTS;

// --- Title ---

export function drawTitle(ctx, c, name) {
  ctx.fillStyle = c.gold;
  ctx.font = `bold ${C.titleFontSize}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(name.toUpperCase(), C.marginLeft, 25);
}

// --- Staff lines ---

export function drawStaffLines(ctx, c, staffY, stringCount, totalWidth) {
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 0.5;
  for (let s = 0; s < stringCount; s++) {
    const y = staffY + s * C.lineSpacing;
    ctx.beginPath();
    ctx.moveTo(C.marginLeft + C.barlineStartInset, y);
    ctx.lineTo(totalWidth - C.marginRight + C.barlineEndInset, y);
    ctx.stroke();
  }
}

// --- TAB label ---

export function drawTabLabel(ctx, c, staffY, staffHeight) {
  const midY = staffY + staffHeight / 2;
  ctx.fillStyle = c.muted;
  ctx.font = `bold ${C.tabLabelFontSize}px ${c.fontMono}`;
  ctx.textAlign = 'center';
  ctx.fillText('T', C.tabLabelX, midY + C.tabLabelOffsetTop);
  ctx.fillText('A', C.tabLabelX, midY + C.tabLabelOffsetMid);
  ctx.fillText('B', C.tabLabelX, midY + C.tabLabelOffsetBot);
}

// --- Tuning display ---

export function drawTuning(ctx, c, staffY, stringCount, tuning) {
  if (!tuning || tuning.length !== stringCount) return;
  
  ctx.fillStyle = c.muted;
  ctx.font = `${C.tuningFontSize}px ${c.fontMono}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  // Draw note names from high to low (top to bottom on staff)
  for (let s = 0; s < stringCount; s++) {
    const stringIndex = stringCount - 1 - s; // Reverse: top staff line = highest string
    const midi = tuning[stringIndex];
    const noteName = midiToNoteName(midi);
    const y = staffY + s * C.lineSpacing;
    ctx.fillText(noteName, C.tuningX, y);
  }
}

// --- Time signatures ---

export function drawTimeSignatures(ctx, c, system, staffY, staffHeight) {
  for (const measure of system.measures) {
    if (!measure._hasTimeSig) continue;
    const ts = measure.timeSignature;
    if (!ts) continue;

    const x = measure._renderedX + C.timeSigPadLeft + C.timeSigWidth / 2;
    const midY = staffY + staffHeight / 2;

    ctx.fillStyle = c.gold;
    ctx.font = `bold ${C.timeSigFontSize}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ts.num, x, midY - C.timeSigSpacing / 2);
    ctx.fillText(ts.den, x, midY + C.timeSigSpacing / 2);
  }
}

// --- Measure barlines ---

export function drawMeasureBars(ctx, c, system, staffY, staffHeight) {
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  for (const measure of system.measures) {
    const x = measure._renderedX;
    ctx.beginPath();
    ctx.moveTo(x, staffY);
    ctx.lineTo(x, staffY + staffHeight);
    ctx.stroke();

    // Section label
    if (measure.section) {
      const label = measure.section.text || measure.section.letter;
      if (label) {
        ctx.fillStyle = c.blue;
        ctx.font = `bold ${C.sectionFontSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(label, x + 4, staffY + C.sectionLabelOffsetY);
      }
    }

    // Measure number
    ctx.fillStyle = c.muted;
    ctx.font = `${C.measureNumFontSize}px ${c.fontMono}`;
    ctx.textAlign = 'left';
    ctx.fillText(measure.masterBarIndex + 1, x + C.measureNumOffsetX, staffY + C.measureNumOffsetY);
  }
}

// --- System end barline ---

export function drawSystemEndBarline(ctx, c, staffY, staffHeight, totalWidth) {
  const lastX = totalWidth - C.marginRight;
  ctx.strokeStyle = c.line;
  ctx.lineWidth = C.barlineEndWidth;
  ctx.beginPath();
  ctx.moveTo(lastX, staffY);
  ctx.lineTo(lastX, staffY + staffHeight);
  ctx.stroke();
}

// --- Palm muting ---

export function drawPalmMuting(ctx, c, system, staffY, timeline, beatPositions) {
  let pmStart = null;
  for (const measure of system.measures) {
    for (const beatIdx of measure.beatIndices) {
      const isPM = timeline[beatIdx].notes.some(n => n.palmMuted);
      const nextIsPM = timeline[beatIdx + 1]?.notes.some(n => n.palmMuted);
      const nextIsOnSameRow = (beatIdx + 1 < timeline.length) &&
        beatPositions[beatIdx + 1] &&
        beatPositions[beatIdx + 1].y === system.y;

      if (isPM && pmStart === null) pmStart = beatPositions[beatIdx].x;

      if (pmStart !== null && (!nextIsPM || !nextIsOnSameRow)) {
        const endX = beatPositions[beatIdx].x;
        const y = staffY + C.pmLabelOffsetY;
        ctx.strokeStyle = c.section;
        ctx.fillStyle = c.section;
        ctx.lineWidth = 1;
        ctx.font = `bold ${C.pmFontSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('P.M.', pmStart, y);
        if (endX > pmStart) {
          const textWidth = ctx.measureText('P.M. ').width;
          ctx.beginPath();
          ctx.setLineDash(C.pmDashPattern);
          ctx.moveTo(pmStart + textWidth, y - 3);
          ctx.lineTo(endX + 5, y - 3);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(endX + 5, y - 6);
          ctx.lineTo(endX + 5, y);
          ctx.stroke();
        }
        pmStart = null;
      }
    }
  }
}

// --- Notes ---

export function drawNotes(ctx, c, system, staffY, stringCount, staffHeight, timeline, beatPositions) {
  for (const measure of system.measures) {
    for (const beatIdx of measure.beatIndices) {
      const event = timeline[beatIdx];
      if (!event) continue;
      const x = beatPositions[beatIdx].x;

      // Draw rests
      if (event.notes.length === 0) {
        _drawRest(ctx, c, event, x, staffY, staffHeight);
        continue;
      }

      // Pick stroke indicator
      const stroke = event.notes.find(n => n.pickStroke && n.pickStroke !== 'None')?.pickStroke;
      if (stroke) {
        ctx.fillStyle = c.muted;
        ctx.font = `bold ${C.pickStrokeFontSize}px sans-serif`;
        ctx.textAlign = 'center';
        const label = stroke === 'Down' ? '\u03A0' : 'V';
        ctx.fillText(label, x, staffY + staffHeight + C.pickStrokeOffsetY);
      }

      for (const note of event.notes) {
        if (note.string < 0 || note.string >= stringCount) continue;
        _drawNote(ctx, c, note, x, staffY, stringCount, beatIdx, event, measure, timeline, beatPositions);
      }

      // Draw a single tie arc above the staff for chord ties (instead of per-note arcs)
      _drawChordTie(ctx, c, event, x, staffY, beatIdx, measure, timeline, beatPositions);
    }

    // Draw tuplet brackets for this measure
    _drawTupletBrackets(ctx, c, measure, staffY, timeline, beatPositions);
  }
}

function _drawRest(ctx, c, event, x, staffY, staffHeight) {
  ctx.fillStyle = c.muted;
  const label = event.rhythmLabel;
  const midY = staffY + staffHeight / 2;

  if (label === 'W') {
    const ry = staffY + C.lineSpacing;
    ctx.fillRect(x - 8, ry, 16, 5);
  } else if (label === 'H') {
    const ry = staffY + C.lineSpacing * 2 - 5;
    ctx.fillRect(x - 8, ry, 16, 5);
  } else {
    ctx.font = `${C.restFontSize + 12}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let glyph = '\u{1D13D}';
    if (label === '8') glyph = '\u{1D13E}';
    else if (label === '16') glyph = '\u{1D13F}';
    else if (label === '32') glyph = '\u{1D140}';
    ctx.fillText(glyph, x, midY);
  }
}

function _drawNote(ctx, c, note, x, staffY, stringCount, beatIdx, event, measure, timeline, beatPositions) {
  const y = staffY + (stringCount - 1 - note.string) * C.lineSpacing;
  const isTied = note.tieDestination;

  // Note text width
  let textW = note.fret >= 10 ? C.noteTextWidthDouble : C.noteTextWidthSingle;
  if (isTied) textW += 6;

  // Background clear behind note text
  ctx.fillStyle = c.bg;
  ctx.fillRect(x - textW / 2 - C.noteTextPadding, y - C.noteTextHalfHeight, textW + C.noteTextPadding * 2, C.noteTextHalfHeight * 2);

  // Note text
  ctx.fillStyle = isTied ? c.muted : c.text;
  ctx.font = `${isTied ? '' : 'bold '}${C.fontSize}px ${c.fontMono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let label = note.muted ? 'X' : note.fret.toString();
  if (isTied) label = `(${label})`;
  ctx.fillText(label, x, y);

  // Vibrato
  if (note.vibrato) {
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const vy = y - C.lineSpacing / 2;
    const vw = C.vibratoLength;
    for (let vx = 0; vx < vw; vx++) {
      ctx.lineTo(x + C.noteTextWidthSingle + vx, vy + Math.sin(vx * 0.5) * C.vibratoAmplitude);
    }
    ctx.stroke();
  }

  // Harmonic / bend annotations
  if (!isTied) {
    if (note.harmonic) {
      ctx.fillStyle = c.red;
      ctx.font = `bold ${C.annotationFontSize}px sans-serif`;
      ctx.fillText('NH', x, y + C.annotationOffsetY);
    }

    if (note.bended) {
      _drawBend(ctx, c, note, x, y);
    }
  }

  // Slide / hammer-on lines (ties handled by _drawChordTie, tuplets by _drawTupletBrackets)
  if ((note.slide || note.hopoOrigin) && !event.tupletNum) {
    _drawConnector(ctx, c, note, x, y, staffY, stringCount, beatIdx, event, measure, timeline, beatPositions);
  }
}

function _drawBend(ctx, c, note, x, y) {
  const bx = x + (note.fret >= 10 ? 12 : 8);
  const by = y;
  ctx.strokeStyle = c.text;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(bx + 5, by - C.bendHeight / 2, bx + 5, by - C.bendHeight);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(bx + 2, by - C.bendHeight + 4);
  ctx.lineTo(bx + 5, by - C.bendHeight);
  ctx.lineTo(bx + 8, by - C.bendHeight + 4);
  ctx.stroke();

  ctx.fillStyle = c.text;
  ctx.font = `${C.bendFontSize}px sans-serif`;
  ctx.fillText('Full', bx + 5, by - C.bendHeight - 6);
}

/**
 * Draw tuplet brackets (e.g. "3" for triplets) above grouped beats.
 * Groups consecutive beats with the same tupletNum into one bracket.
 */
function _drawTupletBrackets(ctx, c, measure, staffY, timeline, beatPositions) {
  const indices = measure.beatIndices;
  let i = 0;

  while (i < indices.length) {
    const event = timeline[indices[i]];
    if (!event || !event.tupletNum || event.tupletNum <= 0) {
      i++;
      continue;
    }

    // Collect consecutive beats with the same tupletNum
    const tupletNum = event.tupletNum;
    const groupStart = i;
    while (i < indices.length) {
      const ev = timeline[indices[i]];
      if (!ev || ev.tupletNum !== tupletNum) break;
      i++;
    }
    const groupEnd = i - 1;

    // Need at least 2 beats for a bracket
    if (groupEnd <= groupStart) continue;

    const startPos = beatPositions[indices[groupStart]];
    const endPos = beatPositions[indices[groupEnd]];
    if (!startPos || !endPos) continue;

    const bracketY = staffY - 14;
    const tickH = 4;
    const x1 = startPos.x;
    const x2 = endPos.x;
    const midX = (x1 + x2) / 2;

    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;

    // Left tick
    ctx.beginPath();
    ctx.moveTo(x1, bracketY + tickH);
    ctx.lineTo(x1, bracketY);
    ctx.stroke();

    // Line to center (gap for number)
    ctx.beginPath();
    ctx.moveTo(x1, bracketY);
    ctx.lineTo(midX - 8, bracketY);
    ctx.stroke();

    // Line from center to right
    ctx.beginPath();
    ctx.moveTo(midX + 8, bracketY);
    ctx.lineTo(x2, bracketY);
    ctx.stroke();

    // Right tick
    ctx.beginPath();
    ctx.moveTo(x2, bracketY);
    ctx.lineTo(x2, bracketY + tickH);
    ctx.stroke();

    // Number
    ctx.fillStyle = c.muted;
    ctx.font = `bold 9px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tupletNum.toString(), midX, bracketY);
  }
}

/**
 * Draw a single tie arc above the staff when the beat contains tied notes.
 * Instead of one arc per string, draws one clean arc spanning the whole chord — like Songsterr.
 */
function _drawChordTie(ctx, c, event, x, staffY, beatIdx, measure, timeline, beatPositions) {
  const tieNotes = event.notes.filter(n => n.tieOrigin);
  if (tieNotes.length === 0) return;

  // Skip tie arcs for notes inside a tuplet group — the bracket handles it
  if (event.tupletNum > 0) return;

  // Find the next beat that has the tie destination
  let nextX = null;
  let sameSystem = true;
  for (let j = beatIdx + 1; j < Math.min(beatIdx + 15, timeline.length); j++) {
    const targetEvent = timeline[j];
    const hasTieDest = targetEvent.notes.some(n => n.tieDestination && tieNotes.some(t => t.string === n.string));
    if (hasTieDest && beatPositions[j]) {
      const pos = beatPositions[j];
      nextX = pos.x;
      sameSystem = pos.y === beatPositions[beatIdx]?.y;
      break;
    }
  }

  if (nextX === null && !beatPositions[beatIdx]) return;

  // Arc drawn above the staff
  const arcY = staffY - 6;
  const arcH = -10;

  ctx.strokeStyle = c.muted;
  ctx.lineWidth = 1;

  if (nextX !== null && sameSystem) {
    const midX = (x + nextX) / 2;
    ctx.beginPath();
    ctx.moveTo(x + C.hopoInset, arcY);
    ctx.quadraticCurveTo(midX, arcY + arcH, nextX - C.hopoInset, arcY);
    ctx.stroke();
  } else {
    // Cross-system: arc to the end of the measure
    const exitX = measure._renderedX + measure._renderedWidth;
    const midX = (x + exitX) / 2;
    ctx.beginPath();
    ctx.moveTo(x + C.hopoInset, arcY);
    ctx.quadraticCurveTo(midX, arcY + arcH, exitX, arcY);
    ctx.stroke();
  }
}

function _drawConnector(ctx, c, note, x, y, staffY, stringCount, beatIdx, event, measure, timeline, beatPositions) {
  let nextBeat = null;
  for (let j = beatIdx + 1; j < Math.min(beatIdx + 15, timeline.length); j++) {
    const targetEvent = timeline[j];
    const target = targetEvent.notes.find(n => n.string === note.string);
    if (target) {
      const sameMeasure = targetEvent.masterBarIndex === event.masterBarIndex;
      const canConnect = target.hopoDestination || target.tieDestination || (note.slide && sameMeasure);
      if (canConnect) nextBeat = j;
      break;
    }
  }

  if (nextBeat !== null && beatPositions[nextBeat]) {
    const nextPos = beatPositions[nextBeat];
    const nextX = nextPos.x;
    const nextY = staffY + (stringCount - 1 - note.string) * C.lineSpacing;
    const sameSystem = nextPos.y === beatPositions[beatIdx].y;

    if (sameSystem) {
      if (note.tieOrigin || note.hopoOrigin) {
        ctx.strokeStyle = note.tieOrigin ? c.muted : c.section;
        ctx.lineWidth = 1;
        const midX = (x + nextX) / 2;
        const arcH = note.tieOrigin ? -C.hopoArcHeight * 0.7 : C.hopoArcHeight;
        ctx.beginPath();
        ctx.moveTo(x + C.hopoInset, y + C.hopoArcOffsetY);
        ctx.quadraticCurveTo(midX, y + arcH, nextX - C.hopoInset, nextY + C.hopoArcOffsetY);
        ctx.stroke();
      } else if (note.slide) {
        // Diagonal line angled by pitch direction (same string = same y, so use fret to determine angle)
        const target = timeline[nextBeat].notes.find(n => n.string === note.string);
        const slideUp = target && target.fret > note.fret;
        const slideDown = target && target.fret < note.fret;
        const yOffset = slideUp ? 4 : slideDown ? -4 : 0;

        ctx.strokeStyle = c.section;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + C.slideInset, y + yOffset);
        ctx.lineTo(nextX - C.slideInset, nextY - yOffset);
        ctx.stroke();
      }
    } else {
      // Cross-system rendering
      const exitX = measure._renderedX + measure._renderedWidth;
      ctx.strokeStyle = note.tieOrigin ? c.muted : c.section;
      ctx.lineWidth = 1;
      const midX = (x + exitX) / 2;
      const arcH = note.tieOrigin ? -C.hopoArcHeight * 0.7 : C.hopoArcHeight;

      ctx.beginPath();
      ctx.moveTo(x + C.hopoInset, y + C.hopoArcOffsetY);
      ctx.quadraticCurveTo(midX, y + arcH, exitX, y + (C.hopoArcOffsetY / 2));
      ctx.stroke();
    }
  }
}

// --- Rhythm stems ---

export function drawRhythmStems(ctx, c, system, staffY, staffHeight, timeline, beatPositions) {
  const stemTop = staffY + staffHeight + C.stemOffset;
  const stemBot = stemTop + C.stemLength;

  for (const measure of system.measures) {
    const beatDuration = 60 / measure.tempo;
    const timeSigNum = measure.timeSignature?.num || 4;
    const timeSigDen = measure.timeSignature?.den || 4;

    // Collect beat positions and rhythm info for beaming
    const beats = [];
    for (const beatIdx of measure.beatIndices) {
      const event = timeline[beatIdx];
      if (!event) continue;
      const pos = beatPositions[beatIdx];
      if (!pos) continue;

      const beatTime = (event.time - measure.startTime) / beatDuration;
      const isRest = event.notes.length === 0;
      const isTied = !isRest && event.notes.every(n => n.tieDestination);

      beats.push({
        x: pos.x,
        label: event.rhythmLabel,
        dotted: event.dotted,
        isRest,
        isTied,
        beatTime,
      });
    }

    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const { x, label, dotted, isRest, isTied } = b;

      if (isRest) continue;

      const flagCount = _flagCount(label);

      if (label === 'W') {
        ctx.strokeStyle = c.muted;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(x, stemTop + 2, C.noteheadRadius + 1, C.noteheadRadius, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (dotted) _drawDot(ctx, c, x + C.noteheadRadius + 4, stemTop + 2);
      } else if (label === 'H') {
        ctx.strokeStyle = c.muted;
        ctx.lineWidth = C.stemWidth;
        ctx.beginPath();
        ctx.moveTo(x, stemTop);
        ctx.lineTo(x, stemBot);
        ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(x, stemBot + C.noteheadRadius, C.noteheadRadius + 0.5, C.noteheadRadius, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (dotted) _drawDot(ctx, c, x + C.noteheadRadius + 4, stemBot + C.noteheadRadius);
      } else {
        ctx.strokeStyle = c.muted;
        ctx.lineWidth = C.stemWidth;
        ctx.beginPath();
        ctx.moveTo(x, stemTop);
        ctx.lineTo(x, stemBot);
        ctx.stroke();

        if (!isTied) {
          ctx.fillStyle = c.muted;
          ctx.beginPath();
          ctx.arc(x, stemBot + C.noteheadRadius, C.noteheadRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        if (dotted) _drawDot(ctx, c, x + C.noteheadRadius + 4, stemBot + C.noteheadRadius);

        if (flagCount > 0) {
          _drawBeamsOrFlags(ctx, c, beats, i, flagCount, stemTop, timeSigNum, timeSigDen);
        }
      }
    }
  }
}

function _drawBeamsOrFlags(ctx, c, beats, i, flagCount, stemTop, timeSigNum, timeSigDen) {
  const b = beats[i];
  const next = beats[i + 1];
  const nextFlagCount = next ? _flagCount(next.label) : 0;

  let shouldBreak = false;
  if (next) {
    const currentBeatPos = b.beatTime;
    const nextBeatPos = next.beatTime;

    if (timeSigNum === 4 && timeSigDen === 4) {
      if (currentBeatPos < 1.99 && nextBeatPos >= 1.99) shouldBreak = true;
    }

    if (flagCount >= 2 || nextFlagCount >= 2) {
      if (Math.floor(currentBeatPos + 0.005) !== Math.floor(nextBeatPos + 0.005)) {
        shouldBreak = true;
      }
    }
  }

  const canBeam = !shouldBreak && nextFlagCount > 0 && !next?.isRest;

  if (canBeam) {
    const beamCount = Math.min(flagCount, nextFlagCount);
    ctx.fillStyle = c.muted;
    for (let f = 0; f < beamCount; f++) {
      const by = stemTop + f * C.flagSpacing;
      ctx.fillRect(b.x, by, next.x - b.x, C.beamThickness);
    }
    for (let f = beamCount; f < flagCount; f++) {
      const by = stemTop + f * C.flagSpacing;
      ctx.fillRect(b.x, by, C.flagLength, C.beamThickness);
    }
  } else {
    ctx.fillStyle = c.muted;
    for (let f = 0; f < flagCount; f++) {
      const by = stemTop + f * C.flagSpacing;
      ctx.fillRect(b.x, by, C.flagLength, C.beamThickness);
    }
  }
}

function _flagCount(rhythmLabel) {
  switch (rhythmLabel) {
    case '8':  return 1;
    case '16': return 2;
    case '32': return 3;
    case '64': return 4;
    default:   return 0;
  }
}

function _drawDot(ctx, c, x, y) {
  ctx.fillStyle = c.muted;
  ctx.beginPath();
  ctx.arc(x, y, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Render all static content for a full tab sheet.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} c - color cache
 * @param {object} track - { stringCount, timeline, name, measures }
 * @param {Array} systems
 * @param {Array} beatPositions
 * @param {number} totalWidth
 * @param {number} totalHeight
 */
export function renderStaticContent(ctx, c, track, systems, beatPositions, totalWidth, totalHeight) {
  const { stringCount, timeline, name, tuning } = track;
  const staffHeight = (stringCount - 1) * C.lineSpacing;

  // Clear
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Title
  drawTitle(ctx, c, name);

  for (let sIdx = 0; sIdx < systems.length; sIdx++) {
    const system = systems[sIdx];
    const staffY = system.y + C.marginTop;

    drawStaffLines(ctx, c, staffY, stringCount, totalWidth);
    drawTabLabel(ctx, c, staffY, staffHeight);
    
    // Draw tuning only on first system (like Songsterr)
    if (sIdx === 0) {
      drawTuning(ctx, c, staffY, stringCount, tuning);
    }
    
    drawTimeSignatures(ctx, c, system, staffY, staffHeight);
    drawMeasureBars(ctx, c, system, staffY, staffHeight);
    drawSystemEndBarline(ctx, c, staffY, staffHeight, totalWidth);
    drawPalmMuting(ctx, c, system, staffY, timeline, beatPositions);
    drawNotes(ctx, c, system, staffY, stringCount, staffHeight, timeline, beatPositions);
    drawRhythmStems(ctx, c, system, staffY, staffHeight, timeline, beatPositions);
  }
}
