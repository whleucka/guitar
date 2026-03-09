// SVG fretboard renderer

import { TUNING, FRET_COUNT, LAYOUT, STRING_WIDTHS, FRET_MARKERS, DOUBLE_MARKERS, NOTE_RADIUS } from '../config.js';
import { getNoteInfo } from '../music/notes.js';
import { computeFretPositions, computeStringPositions, fretMidX } from './fretboard-layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

/**
 * Build the complete fretboard SVG and return { svg, noteElements }.
 * noteElements is a Map keyed by "string-fret" for later highlight/interaction.
 */
export function renderFretboard() {
  const fretPositions = computeFretPositions();
  const stringPositions = computeStringPositions();

  const { width, height, paddingLeft, nutWidth } = LAYOUT;

  const svg = svgEl('svg', {
    class: 'fretboard-svg',
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
  });

  // --- Body background ---
  const bodyX = paddingLeft;
  const bodyW = width - paddingLeft - LAYOUT.paddingRight;
  svg.appendChild(svgEl('rect', {
    class: 'fb-body',
    x: bodyX, y: LAYOUT.paddingTop - 10,
    width: bodyW, height: height - LAYOUT.paddingTop - LAYOUT.paddingBottom + 20,
    rx: 3,
  }));

  // --- Fret inlay markers ---
  for (const fret of FRET_MARKERS) {
    if (fret > FRET_COUNT) continue;
    const mx = fretMidX(fretPositions, fret);
    const topY = stringPositions[0].y;
    const botY = stringPositions[5].y;
    const midY = (topY + botY) / 2;

    if (DOUBLE_MARKERS.includes(fret)) {
      const offset = (botY - topY) * 0.25;
      svg.appendChild(svgEl('circle', {
        class: 'fb-inlay', cx: mx, cy: midY - offset, r: 5,
      }));
      svg.appendChild(svgEl('circle', {
        class: 'fb-inlay', cx: mx, cy: midY + offset, r: 5,
      }));
    } else {
      svg.appendChild(svgEl('circle', {
        class: 'fb-inlay', cx: mx, cy: midY, r: 5,
      }));
    }
  }

  // --- Nut ---
  svg.appendChild(svgEl('rect', {
    class: 'fb-nut',
    x: paddingLeft,
    y: stringPositions[5].y - 5,
    width: nutWidth,
    height: stringPositions[0].y - stringPositions[5].y + 10,
    rx: 2,
  }));

  // --- Fret wires ---
  for (let f = 1; f <= FRET_COUNT; f++) {
    const x = fretPositions[f].x;
    svg.appendChild(svgEl('line', {
      class: 'fb-fret',
      x1: x, y1: stringPositions[5].y - 5,
      x2: x, y2: stringPositions[0].y + 5,
    }));
  }

  // --- Strings ---
  for (let s = 0; s < 6; s++) {
    const y = stringPositions[s].y;
    const endX = fretPositions[FRET_COUNT].x + 10;
    svg.appendChild(svgEl('line', {
      class: 'fb-string',
      x1: paddingLeft, y1: y,
      x2: endX, y2: y,
      'stroke-width': STRING_WIDTHS[s],
    }));
  }

  // --- Fret numbers ---
  const numY = stringPositions[5].y + 20;
  for (const fret of FRET_MARKERS) {
    if (fret > FRET_COUNT) continue;
    const mx = fretMidX(fretPositions, fret);
    const txt = svgEl('text', {
      class: 'fb-fret-number', x: mx, y: numY,
    });
    txt.textContent = fret;
    svg.appendChild(txt);
  }

  // --- Hit areas + Note circles ---
  const noteElements = new Map();

  for (let s = 0; s < 6; s++) {
    const sy = stringPositions[s].y;
    const baseMidi = TUNING[s].midi;

    for (let f = 0; f <= FRET_COUNT; f++) {
      const mx = fretMidX(fretPositions, f);
      const noteInfo = getNoteInfo(baseMidi, f);
      const key = `${s}-${f}`;

      // Compute hit area width
      let hitW;
      if (f === 0) {
        hitW = 30;
      } else {
        const left = fretPositions[f - 1].x;
        const right = fretPositions[f].x;
        hitW = right - left;
      }

      // Group for hit area + note
      const g = svgEl('g', { 'data-string': s, 'data-fret': f, 'data-midi': noteInfo.midi });

      // Hit area
      const hitArea = svgEl('rect', {
        class: 'fb-hit-area',
        x: mx - hitW / 2,
        y: sy - 12,
        width: hitW,
        height: 24,
      });
      g.appendChild(hitArea);

      // Note circle group
      const noteG = svgEl('g', { class: 'fb-note' });

      const circle = svgEl('circle', {
        class: 'fb-note-circle',
        cx: mx, cy: sy, r: NOTE_RADIUS,
      });
      noteG.appendChild(circle);

      const text = svgEl('text', {
        class: 'fb-note-text',
        x: mx, y: sy,
        'font-size': f === 0 ? '9' : '8',
      });
      text.textContent = noteInfo.display;
      noteG.appendChild(text);

      g.appendChild(noteG);
      svg.appendChild(g);

      noteElements.set(key, { group: g, noteGroup: noteG, hitArea, noteInfo });
    }
  }

  return { svg, noteElements, fretPositions, stringPositions };
}
