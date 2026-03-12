// Tab layout computation — dynamic system grouping, proportional beat spacing, time signatures
// Pure computation module: no canvas, no DOM dependency.

import { TAB_CONSTANTS } from './tab-constants.js';

/**
 * Pre-compute which measures should display a time signature.
 * Returns a Set of measure objects that need one.
 * @param {Array} allMeasures
 * @param {Array} systems
 * @returns {Set}
 */
export function computeTimeSigFlags(allMeasures, systems) {
  const flags = new Set();
  let prevTs = null;
  let measureIndex = 0;

  for (const system of systems) {
    for (const measure of system.measures) {
      const ts = measure.timeSignature;
      if (ts) {
        if (measureIndex === 0 || !prevTs || prevTs.num !== ts.num || prevTs.den !== ts.den) {
          flags.add(measure);
        }
        prevTs = ts;
      }
      measureIndex++;
    }
  }
  return flags;
}

/**
 * Compute the "natural" width a measure needs based on its beat count and content.
 * More beats / wider fret numbers = more space needed.
 */
function measureNaturalWidth(measure, timeline) {
  const C = TAB_CONSTANTS;
  const beatCount = measure.beatIndices.length;

  // Base width per measure + per-beat spacing
  let width = 60 + beatCount * 28;

  // Extra width for double-digit frets and dense chords
  for (const bIdx of measure.beatIndices) {
    const event = timeline[bIdx];
    if (!event) continue;
    if (event.notes.some(n => n.fret >= 10)) width += 10;
    if (event.notes.length > 3) width += 6;
  }

  // Enforce minimum note spacing so dense passages (16th notes) stay readable
  const minWidth = beatCount * C.minNoteSpacing + 2 * C.measurePadding;

  return Math.max(width, minWidth, 120);
}

/**
 * Dynamically group measures into systems (lines) by filling each line
 * until adding another measure would exceed the available width.
 * Falls back to at least 1 measure per line.
 */
function groupMeasuresDynamic(allMeasures, timeline, availableWidth) {
  const C = TAB_CONSTANTS;
  const systems = [];
  let i = 0;

  while (i < allMeasures.length) {
    const systemMeasures = [];
    let usedWidth = 0;

    while (i < allMeasures.length) {
      const m = allMeasures[i];
      const natWidth = measureNaturalWidth(m, timeline) + C.measurePadding * 2;

      if (systemMeasures.length > 0 && usedWidth + natWidth > availableWidth) {
        break; // This measure would overflow — start a new line
      }

      systemMeasures.push(m);
      usedWidth += natWidth;
      i++;
    }

    systems.push({ measures: systemMeasures });
  }

  return systems;
}

/**
 * Compute full layout: beat positions, system coordinates, canvas dimensions.
 * Measures per line is determined dynamically by content width.
 * @param {object} track - { timeline, measures, stringCount }
 * @param {number} containerWidth
 * @returns {{ beatPositions: Array, systems: Array, totalWidth: number, totalHeight: number }}
 */
export function computeLayout(track, containerWidth) {
  const C = TAB_CONSTANTS;
  const { timeline } = track;
  const availableWidth = Math.max(containerWidth - C.marginLeft - C.marginRight, 400);
  const totalWidth = containerWidth;

  const allMeasures = track.measures;
  const systems = groupMeasuresDynamic(allMeasures, timeline, availableWidth);

  const staffHeight = (track.stringCount - 1) * C.lineSpacing;
  const systemHeight = staffHeight + C.marginTop + C.marginBottom;

  const timeSigFlags = computeTimeSigFlags(allMeasures, systems);

  const beatPos = [];
  let currentY = C.titleHeight;

  for (let sIdx = 0; sIdx < systems.length; sIdx++) {
    const system = systems[sIdx];
    system.y = currentY;
    system.height = systemHeight;

    // Compute natural widths for proportional scaling to fill the line
    const naturalWidths = system.measures.map(m => measureNaturalWidth(m, timeline));
    const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);

    let currentX = C.marginLeft;
    for (let mIdx = 0; mIdx < system.measures.length; mIdx++) {
      const measure = system.measures[mIdx];
      // Scale proportionally to fill available width
      const measureWidth = (naturalWidths[mIdx] / totalNatural) * availableWidth;

      const hasTimeSig = timeSigFlags.has(measure);
      const beatDuration = 60 / measure.tempo;
      const totalMeasureBeats = (measure.timeSignature?.num || 4) / ((measure.timeSignature?.den || 4) / 4);

      measure._renderedX = currentX;
      measure._renderedWidth = measureWidth;
      measure._hasTimeSig = hasTimeSig;

      const leftPad = C.measurePadding + (hasTimeSig ? C.timeSigPadLeft + C.timeSigWidth : 0);
      const innerWidth = measureWidth - leftPad - C.measurePadding;

      for (let i = 0; i < measure.beatIndices.length; i++) {
        const beatIdx = measure.beatIndices[i];
        const event = timeline[beatIdx];
        if (!event) continue;

        const beatTime = (event.time - measure.startTime) / beatDuration;
        const beatInt = Math.floor(beatTime + 0.0001);
        const beatFrac = Math.max(0, beatTime - beatInt);
        const groupedFrac = Math.pow(beatFrac, 1.1);
        const weightedTime = beatInt + groupedFrac;

        const progress = weightedTime / totalMeasureBeats;
        const beatX = currentX + leftPad + Math.min(0.98, progress) * innerWidth;

        beatPos[beatIdx] = {
          x: beatX,
          y: currentY,
          systemHeight: systemHeight,
          staffY: currentY + C.marginTop,
        };
      }

      currentX += measureWidth;
    }
    currentY += systemHeight + C.systemSpacing;
  }

  return {
    beatPositions: beatPos,
    systems,
    totalWidth,
    totalHeight: currentY,
  };
}
