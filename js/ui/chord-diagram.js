// Classic chord box SVG renderer

import { svgEl as el } from './dom-helpers.js';

const DIAGRAM = {
  width: 120,
  height: 160,
  padTop: 35,
  padLeft: 20,
  padRight: 15,
  strings: 6,
  frets: 5,
  dotRadius: 6,
  markerSize: 8,
};

/**
 * Render a chord box SVG for the given voicing.
 * Returns the SVG element.
 */
export function createChordDiagram(voicing) {
  const { width, height, padTop, padLeft, padRight, strings, frets, dotRadius } = DIAGRAM;
  const gridW = width - padLeft - padRight;
  const gridH = height - padTop - 15;
  const stringSpacing = gridW / (strings - 1);
  const fretSpacing = gridH / frets;

  const svg = el('svg', {
    class: 'chord-diagram-svg',
    viewBox: `0 0 ${width} ${height}`,
    width: width,
    height: height,
  });

  // Chord name
  const title = el('text', {
    x: width / 2,
    y: 14,
    class: 'cd-title',
  });
  title.textContent = voicing.name;
  svg.appendChild(title);

  // Base fret label (if not open position)
  const isOpenPos = voicing.baseFret <= 1;

  // Nut (thick top line) or position label
  if (isOpenPos) {
    svg.appendChild(el('rect', {
      class: 'cd-nut',
      x: padLeft - 1,
      y: padTop - 3,
      width: gridW + 2,
      height: 4,
      rx: 1,
    }));
  } else {
    const posLabel = el('text', {
      x: padLeft - 10,
      y: padTop + fretSpacing / 2,
      class: 'cd-position',
    });
    posLabel.textContent = voicing.baseFret;
    svg.appendChild(posLabel);
  }

  // Fret lines
  for (let f = 0; f <= frets; f++) {
    const y = padTop + f * fretSpacing;
    svg.appendChild(el('line', {
      class: 'cd-fret-line',
      x1: padLeft, y1: y,
      x2: padLeft + gridW, y2: y,
    }));
  }

  // String lines
  for (let s = 0; s < strings; s++) {
    const x = padLeft + s * stringSpacing;
    svg.appendChild(el('line', {
      class: 'cd-string-line',
      x1: x, y1: padTop,
      x2: x, y2: padTop + gridH,
    }));
  }

  // Barre
  if (voicing.barre) {
    const barFret = voicing.barre.fret - voicing.baseFret + 1;
    const y = padTop + (barFret - 0.5) * fretSpacing;
    const x1 = padLeft + voicing.barre.fromString * stringSpacing;
    const x2 = padLeft + voicing.barre.toString * stringSpacing;
    svg.appendChild(el('rect', {
      class: 'cd-barre',
      x: x1 - dotRadius,
      y: y - dotRadius,
      width: (x2 - x1) + dotRadius * 2,
      height: dotRadius * 2,
      rx: dotRadius,
    }));
  }

  // Finger dots + X/O markers
  for (let s = 0; s < strings; s++) {
    const x = padLeft + s * stringSpacing;
    const fret = voicing.frets[s];

    if (fret === -1) {
      // Muted — X
      const marker = el('text', { x, y: padTop - 10, class: 'cd-marker cd-muted' });
      marker.textContent = '\u00D7';
      svg.appendChild(marker);
    } else if (fret === 0 || (isOpenPos && fret === 0)) {
      // Open — O
      const marker = el('text', { x, y: padTop - 10, class: 'cd-marker cd-open' });
      marker.textContent = 'O';
      svg.appendChild(marker);
    } else {
      // Finger dot
      const displayFret = fret - voicing.baseFret + 1;
      const y = padTop + (displayFret - 0.5) * fretSpacing;

      // Skip dot if covered by barre (same position)
      const isBarre = voicing.barre &&
        fret === voicing.barre.fret &&
        s >= voicing.barre.fromString &&
        s <= voicing.barre.toString;

      if (!isBarre) {
        svg.appendChild(el('circle', {
          class: 'cd-dot',
          cx: x, cy: y, r: dotRadius,
        }));

        // Finger number
        if (voicing.fingers[s] > 0) {
          const num = el('text', { x, y, class: 'cd-finger' });
          num.textContent = voicing.fingers[s];
          svg.appendChild(num);
        }
      }
    }
  }

  return svg;
}

/**
 * Render a chord diagram into a container, replacing existing content.
 */
export function renderChordDiagram(voicing, container) {
  container.innerHTML = '';
  if (voicing) {
    container.appendChild(createChordDiagram(voicing));
  }
}
