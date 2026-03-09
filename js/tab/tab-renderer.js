// Canvas-based scrolling tab renderer

const TAB = {
  lineSpacing: 16,
  beatSpacing: 32,
  measurePadding: 20,
  marginLeft: 50,
  marginTop: 40,
  marginBottom: 20,
  cursorWidth: 3,
  fontSize: 13,
  sectionFontSize: 11,
  minMeasureWidth: 120,
};

export class TabRenderer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tab-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.wrap = document.createElement('div');
    this.wrap.className = 'tab-canvas-wrap';
    this.wrap.appendChild(this.canvas);
    container.appendChild(this.wrap);

    this.timeline = null;
    this.measures = null;
    this.stringCount = 6;
    this.beatXPositions = [];
    this.measureXPositions = [];
    this.totalWidth = 0;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;

    // Click handler for loop setting
    this.canvas.addEventListener('click', (e) => {
      if (this._onCanvasClick) this._onCanvasClick(e);
    });
  }

  /**
   * Set tab data and render.
   */
  setData(timeline, measures, stringCount = 6) {
    this.timeline = timeline;
    this.measures = measures;
    this.stringCount = stringCount;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;

    this._computeLayout();
    this._render();
  }

  /**
   * Move cursor to a timeline index.
   */
  setCursor(index) {
    if (this.cursorIndex === index) return;
    this.cursorIndex = index;
    this._render();
    this._scrollToCursor();
  }

  clearCursor() {
    this.cursorIndex = -1;
    this._render();
  }

  setLoop(a, b) {
    this.loopA = a;
    this.loopB = b;
    this._render();
  }

  /**
   * Get timeline index from canvas click X position.
   */
  getIndexAtX(canvasX) {
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.beatXPositions.length; i++) {
      const dist = Math.abs(this.beatXPositions[i] - canvasX);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  }

  onCanvasClick(handler) {
    this._onCanvasClick = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const index = this.getIndexAtX(canvasX);
      handler(index);
    };
  }

  _computeLayout() {
    if (!this.timeline || !this.measures) return;

    const beatXs = [];
    const measureXs = [];
    let x = TAB.marginLeft;

    for (const measure of this.measures) {
      measureXs.push(x);

      const numBeats = measure.beatIndices.length || 1;
      const measureWidth = Math.max(
        TAB.minMeasureWidth,
        numBeats * TAB.beatSpacing + TAB.measurePadding * 2
      );

      for (let i = 0; i < measure.beatIndices.length; i++) {
        const beatX = x + TAB.measurePadding + i * (measureWidth - TAB.measurePadding * 2) / Math.max(numBeats, 1);
        beatXs[measure.beatIndices[i]] = beatX;
      }

      x += measureWidth;
    }

    this.beatXPositions = beatXs;
    this.measureXPositions = measureXs;
    this.totalWidth = x + TAB.marginLeft;

    const staffHeight = (this.stringCount - 1) * TAB.lineSpacing;
    const totalHeight = TAB.marginTop + staffHeight + TAB.marginBottom;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.totalWidth * dpr;
    this.canvas.height = totalHeight * dpr;
    this.canvas.style.width = this.totalWidth + 'px';
    this.canvas.style.height = totalHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _render() {
    const ctx = this.ctx;
    const { stringCount, timeline, measures } = this;
    if (!timeline || !measures) return;

    const staffHeight = (stringCount - 1) * TAB.lineSpacing;
    const totalHeight = TAB.marginTop + staffHeight + TAB.marginBottom;

    // Get theme colors from CSS
    const style = getComputedStyle(document.documentElement);
    const bgColor = style.getPropertyValue('--bg-primary').trim() || '#24283b';
    const lineColor = style.getPropertyValue('--fb-fret-wire').trim() || '#565f89';
    const textColor = style.getPropertyValue('--text-primary').trim() || '#c0caf5';
    const mutedColor = style.getPropertyValue('--text-muted').trim() || '#565f89';
    const cursorColor = style.getPropertyValue('--accent-gold').trim() || '#e0af68';
    const accentBlue = style.getPropertyValue('--accent-blue').trim() || '#7aa2f7';
    const accentRed = style.getPropertyValue('--accent-red').trim() || '#f7768e';
    const sectionColor = style.getPropertyValue('--accent-green').trim() || '#9ece6a';
    const surfaceColor = style.getPropertyValue('--bg-surface').trim() || '#292e42';

    // Clear
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, this.totalWidth, totalHeight);

    // Loop region highlight
    if (this.loopA !== null && this.loopB !== null) {
      const ax = this.beatXPositions[this.loopA] || 0;
      const bx = this.beatXPositions[this.loopB] || 0;
      ctx.fillStyle = 'rgba(122, 162, 247, 0.08)';
      ctx.fillRect(ax - 5, 0, bx - ax + 10, totalHeight);
    }

    // Tab lines — top line = high e (string 5), bottom line = low E (string 0)
    // Standard tab: highest-pitched string at top
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.5;
    for (let s = 0; s < stringCount; s++) {
      const y = TAB.marginTop + s * TAB.lineSpacing;
      ctx.beginPath();
      ctx.moveTo(TAB.marginLeft - 10, y);
      ctx.lineTo(this.totalWidth - TAB.marginLeft + 10, y);
      ctx.stroke();
    }

    // TAB clef label
    ctx.fillStyle = mutedColor;
    ctx.font = `bold 11px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
    ctx.textAlign = 'center';
    const midY = TAB.marginTop + staffHeight / 2;
    ctx.fillText('T', 20, midY - 7);
    ctx.fillText('A', 20, midY + 3);
    ctx.fillText('B', 20, midY + 13);

    // Measure barlines + section labels
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    for (let m = 0; m < measures.length; m++) {
      const x = this.measureXPositions[m];
      ctx.beginPath();
      ctx.moveTo(x, TAB.marginTop);
      ctx.lineTo(x, TAB.marginTop + staffHeight);
      ctx.stroke();

      // Section label
      if (measures[m].section) {
        const label = measures[m].section.text || measures[m].section.letter;
        if (label) {
          ctx.fillStyle = sectionColor;
          ctx.font = `bold ${TAB.sectionFontSize}px ${style.getPropertyValue('--font-main').trim() || 'sans-serif'}`;
          ctx.textAlign = 'left';
          ctx.fillText(label, x + 4, TAB.marginTop - 10);
        }
      }

      // Bar number
      ctx.fillStyle = mutedColor;
      ctx.font = `9px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
      ctx.textAlign = 'left';
      ctx.fillText(m + 1, x + 3, TAB.marginTop - 3);
    }

    // Final barline
    if (this.measureXPositions.length > 0) {
      const lastX = this.totalWidth - TAB.marginLeft;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lastX, TAB.marginTop);
      ctx.lineTo(lastX, TAB.marginTop + staffHeight);
      ctx.stroke();
    }

    // --- Palm Muting Brackets ---
    let pmStart = null;
    for (let i = 0; i < timeline.length; i++) {
      const isPM = timeline[i].notes.some(n => n.palmMuted);
      const nextIsPM = timeline[i+1]?.notes.some(n => n.palmMuted);

      if (isPM && pmStart === null) {
        pmStart = this.beatXPositions[i];
      }
      
      if (pmStart !== null && (!nextIsPM || i === timeline.length - 1)) {
        const endX = this.beatXPositions[i];
        const y = TAB.marginTop - 15;
        
        ctx.strokeStyle = sectionColor;
        ctx.fillStyle = sectionColor;
        ctx.lineWidth = 1;
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("P.M.", pmStart, y);
        
        const textWidth = ctx.measureText("P.M. ").width;
        ctx.beginPath();
        ctx.setLineDash([2, 2]);
        ctx.moveTo(pmStart + textWidth, y - 3);
        ctx.lineTo(endX + 5, y - 3);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Cap
        ctx.beginPath();
        ctx.moveTo(endX + 5, y - 6);
        ctx.lineTo(endX + 5, y);
        ctx.stroke();
        
        pmStart = null;
      }
    }

    // Fret numbers
    ctx.font = `bold ${TAB.fontSize}px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < timeline.length; i++) {
      const event = timeline[i];
      const x = this.beatXPositions[i];
      if (x === undefined) continue;

      // --- Strumming Pattern (Down/Up) ---
      const stroke = event.notes.find(n => n.pickStroke && n.pickStroke !== 'None')?.pickStroke;
      if (stroke) {
        ctx.fillStyle = mutedColor;
        ctx.font = "bold 10px sans-serif";
        const label = stroke === 'Down' ? 'Π' : 'V'; // Traditional strum symbols
        ctx.fillText(label, x, TAB.marginTop + staffHeight + 10);
        ctx.font = `bold ${TAB.fontSize}px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
      }

      for (const note of event.notes) {
        if (note.tieDestination) continue; // Don't redraw tied notes
        if (note.string < 0 || note.string >= stringCount) continue;

        // String 5 (high e) at top (y=0), string 0 (low E) at bottom
        const y = TAB.marginTop + (stringCount - 1 - note.string) * TAB.lineSpacing;

        // Background to cover the tab line
        const textW = note.fret >= 10 ? 16 : 10;
        ctx.fillStyle = bgColor;
        ctx.fillRect(x - textW / 2 - 1, y - 7, textW + 2, 14);

        // Fret number
        const isCursor = i === this.cursorIndex;
        ctx.fillStyle = isCursor ? cursorColor : textColor;
        
        if (note.muted) {
          ctx.fillText('X', x, y);
        } else {
          ctx.fillText(note.fret, x, y);
        }

        // Annotations
        let annoText = '';
        if (note.bended) annoText = 'B';
        else if (note.harmonic) annoText = 'NH';

        if (annoText) {
          ctx.fillStyle = sectionColor;
          ctx.font = `bold 8px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
          ctx.fillText(annoText, x, y - 10);
          ctx.font = `bold ${TAB.fontSize}px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
        }

        // --- Technique Graphics (Slides and Legato) ---
        if (note.slide || note.hopoOrigin) {
          // Find next note on this string to connect to
          let nextX = null;
          let nextY = null;
          let nextFret = null;

          for (let j = i + 1; j < Math.min(i + 10, timeline.length); j++) {
            const nextEvent = timeline[j];
            const targetNote = nextEvent.notes.find(n => n.string === note.string);
            if (targetNote) {
              nextX = this.beatXPositions[j];
              nextY = TAB.marginTop + (stringCount - 1 - targetNote.string) * TAB.lineSpacing;
              nextFret = targetNote.fret;
              break;
            }
          }

          if (nextX !== null) {
            ctx.strokeStyle = sectionColor;
            ctx.lineWidth = 1;

            if (note.slide) {
              // Diagonal slide line
              const xOff = 8;
              const yOff = note.fret < nextFret ? 3 : -3;
              ctx.beginPath();
              ctx.moveTo(x + xOff, y + yOff);
              ctx.lineTo(nextX - xOff, nextY - yOff);
              ctx.stroke();
            } else if (note.hopoOrigin) {
              // Legato arc (slur)
              const xOff = 6;
              const midX = (x + nextX) / 2;
              const arcHeight = 12;
              ctx.beginPath();
              ctx.moveTo(x + xOff, y - 5);
              ctx.quadraticCurveTo(midX, y - 5 - arcHeight, nextX - xOff, nextY - 5);
              ctx.stroke();

              // Add small H or P above the arc
              const label = nextFret > note.fret ? 'H' : 'P';
              ctx.fillStyle = sectionColor;
              ctx.font = "bold 8px sans-serif";
              ctx.fillText(label, midX, y - 5 - arcHeight);
              ctx.font = `bold ${TAB.fontSize}px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
            }
          }
        }
      }

      // Rest marker
      if (event.notes.length === 0 && !event.isRest) {
        // Empty beat, skip
      }
    }

    // Cursor line
    if (this.cursorIndex >= 0 && this.cursorIndex < this.beatXPositions.length) {
      const cx = this.beatXPositions[this.cursorIndex];
      if (cx !== undefined) {
        ctx.strokeStyle = cursorColor;
        ctx.lineWidth = TAB.cursorWidth;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(cx, TAB.marginTop - 5);
        ctx.lineTo(cx, TAB.marginTop + staffHeight + 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Loop markers
    if (this.loopA !== null && this.beatXPositions[this.loopA] !== undefined) {
      this._drawLoopMarker(this.beatXPositions[this.loopA], 'A', accentBlue, staffHeight);
    }
    if (this.loopB !== null && this.beatXPositions[this.loopB] !== undefined) {
      this._drawLoopMarker(this.beatXPositions[this.loopB], 'B', accentRed, staffHeight);
    }
  }

  _drawLoopMarker(x, label, color, staffHeight) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, TAB.marginTop - 5);
    ctx.lineTo(x, TAB.marginTop + staffHeight + 5);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, TAB.marginTop + staffHeight + 15);
  }

  _scrollToCursor() {
    if (this.cursorIndex < 0) return;
    const cx = this.beatXPositions[this.cursorIndex];
    if (cx === undefined) return;

    const wrapWidth = this.wrap.clientWidth;
    const targetScroll = cx - wrapWidth / 2;
    this.wrap.scrollLeft = Math.max(0, targetScroll);
  }
}
