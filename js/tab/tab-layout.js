// Tab layout computation — system grouping, proportional beat spacing, time signatures
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
 * Group measures into systems (lines) with a fixed count per line.
 * @param {Array} allMeasures
 * @param {number} perLine - measures per system
 * @returns {Array} systems - [{ measures }]
 */
export function groupMeasuresIntoSystems(allMeasures, perLine) {
  const systems = [];
  for (let i = 0; i < allMeasures.length; i += perLine) {
    const batch = allMeasures.slice(i, i + perLine);
    systems.push({ measures: batch });
  }
  return systems;
}

/**
 * Compute full layout: beat positions, system coordinates, canvas dimensions.
 * @param {object} track - { timeline, measures, stringCount }
 * @param {number} containerWidth
 * @param {number} measuresPerLine
 * @param {number} maxMeasuresPerLine
 * @returns {{ beatPositions: Array, systems: Array, totalWidth: number, totalHeight: number }}
 */
export function computeLayout(track, containerWidth, measuresPerLine, maxMeasuresPerLine) {
  const C = TAB_CONSTANTS;
  const { timeline } = track;
  const availableWidth = Math.max(containerWidth - C.marginLeft - C.marginRight, 400);
  const totalWidth = containerWidth;

  const allMeasures = track.measures;
  const perLine = Math.min(measuresPerLine, maxMeasuresPerLine);
  const systems = groupMeasuresIntoSystems(allMeasures, perLine);

  const staffHeight = (track.stringCount - 1) * C.lineSpacing;
  const systemHeight = staffHeight + C.marginTop + C.marginBottom;

  const timeSigFlags = computeTimeSigFlags(allMeasures, systems);

  const beatPos = [];
  let currentY = C.titleHeight;

  for (let sIdx = 0; sIdx < systems.length; sIdx++) {
    const system = systems[sIdx];
    system.y = currentY;
    system.height = systemHeight;

    // Calculate proportional widths based on rhythmic and visual complexity
    const complexities = system.measures.map(m => {
      let score = Math.max(4, m.beatIndices.length);

      for (const bIdx of m.beatIndices) {
        const event = timeline[bIdx];
        if (event && event.notes.some(n => n.fret >= 10)) {
          score += 1.5;
        }
        if (event && event.notes.length > 2) {
          score += 0.3;
        }
      }
      return score;
    });
    const totalComplexity = complexities.reduce((a, b) => a + b, 0);

    let currentX = C.marginLeft;
    for (let mIdx = 0; mIdx < system.measures.length; mIdx++) {
      const measure = system.measures[mIdx];
      const measureWidth = (complexities[mIdx] / totalComplexity) * availableWidth;

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
