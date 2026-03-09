// Canvas-based scrolling tab renderer
// Uses dual-canvas layering: static tab content + animated cursor overlay

const TAB = {
  lineSpacing: 14,
  measurePadding: 12,
  marginLeft: 50,
  marginRight: 20,
  marginTop: 70,
  marginBottom: 10,
  systemSpacing: 40,
  cursorWidth: 3,
  fontSize: 12,
  sectionFontSize: 10,
  measuresPerLine: 5,       // target measures per system (like sheet music)
  maxMeasuresPerLine: 6,    // never exceed this many
  titleHeight: 35,

  // Annotation offsets (previously magic numbers)
  tabLabelX: 20,
  tabLabelOffsetTop: -6,
  tabLabelOffsetMid: 3,
  tabLabelOffsetBot: 12,
  sectionLabelOffsetY: -40,
  measureNumOffsetX: 3,
  measureNumOffsetY: -5,
  pmLabelOffsetY: -20,
  pmDashPattern: [2, 2],
  pmFontSize: 8,
  annotationFontSize: 7,
  annotationOffsetY: -8,
  slideInset: 6,
  hopoInset: 4,
  hopoArcHeight: -10,
  hopoArcOffsetY: -3,
  pickStrokeOffsetY: 8,
  pickStrokeFontSize: 8,
  cursorOverhang: 5,
  noteTextWidthSingle: 8,
  noteTextWidthDouble: 12,
  noteTextPadding: 1,
  noteTextHalfHeight: 5,
  barlineEndWidth: 2,
  barlineStartInset: -10,
  barlineEndInset: 10,
  measureNumFontSize: 9,
  tabLabelFontSize: 10,
  titleFontSize: 12,
  loopMarkerWidth: 2,
  loopMarkerFontSize: 10,
  loopMarkerBottomOffset: -2,
  scrollPaddingTop: 50,
  scrollPaddingBottom: 150,
  scrollTargetOffset: 100,
};

export class TabRenderer {
  constructor(container) {
    this.container = container;

    // Static canvas (tab content: staff lines, notes, annotations)
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tab-canvas';
    this.ctx = this.canvas.getContext('2d');

    // Overlay canvas (cursor, loop markers — redrawn frequently)
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'tab-canvas tab-canvas-overlay';
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    this.wrap = document.createElement('div');
    this.wrap.className = 'tab-canvas-wrap';
    this.wrap.appendChild(this.canvas);
    this.wrap.appendChild(this.overlayCanvas);
    container.appendChild(this.wrap);

    this.track = null;
    this.beatPositions = [];
    this.systems = [];
    this.totalWidth = 0;
    this.totalHeight = 0;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;

    // Cached theme colors (refreshed on setData and resize)
    this._colors = null;

    // Resize handling
    this._resizeTimeout = null;
    this._onResize = () => {
      clearTimeout(this._resizeTimeout);
      this._resizeTimeout = setTimeout(() => {
        if (this.track) {
          this._refreshColors();
          this._computeLayout();
          this._renderStatic();
          this._renderOverlay();
        }
      }, 200);
    };
    window.addEventListener('resize', this._onResize);

    // Click handler
    this._onCanvasClickHandler = null;
    this._clickListener = (e) => {
      if (this._onCanvasClickHandler) this._onCanvasClickHandler(e);
    };
    this.overlayCanvas.addEventListener('click', this._clickListener);
  }

  /**
   * Clean up event listeners and DOM.
   */
  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.overlayCanvas.removeEventListener('click', this._clickListener);
    clearTimeout(this._resizeTimeout);
    this.wrap.remove();
  }

  /**
   * Set tab data and render.
   */
  setData(trackData) {
    this.track = trackData;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;

    this._refreshColors();
    this._computeLayout();
    this._renderStatic();
    this._renderOverlay();
  }

  /**
   * Move cursor to a timeline index.
   * Only redraws the lightweight overlay canvas.
   */
  setCursor(index) {
    if (this.cursorIndex === index) return;
    this.cursorIndex = index;
    this._renderOverlay();
    this._scrollToCursor();
  }

  clearCursor() {
    this.cursorIndex = -1;
    this._renderOverlay();
  }

  setLoop(a, b) {
    this.loopA = a;
    this.loopB = b;
    this._renderOverlay();
  }

  /**
   * Get timeline index from canvas click coordinates.
   */
  getIndexAtPoint(canvasX, canvasY) {
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.beatPositions.length; i++) {
      const pos = this.beatPositions[i];
      if (!pos) continue;

      const dx = pos.x - canvasX;
      const dy = (pos.y + pos.systemHeight / 2) - canvasY;
      const dist = dx * dx + dy * dy; // skip sqrt for comparison

      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  }

  onCanvasClick(handler) {
    this._onCanvasClickHandler = (e) => {
      const rect = this.overlayCanvas.getBoundingClientRect();
      const scaleX = this.overlayCanvas.width / rect.width;
      const scaleY = this.overlayCanvas.height / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;
      const index = this.getIndexAtPoint(canvasX, canvasY);
      handler(index);
    };
  }

  // --- Color caching ---

  _refreshColors() {
    const style = getComputedStyle(document.documentElement);
    this._colors = {
      bg: style.getPropertyValue('--bg-primary').trim() || '#24283b',
      line: style.getPropertyValue('--fb-fret-wire').trim() || '#565f89',
      text: style.getPropertyValue('--text-primary').trim() || '#c0caf5',
      muted: style.getPropertyValue('--text-muted').trim() || '#565f89',
      cursor: style.getPropertyValue('--accent-gold').trim() || '#e0af68',
      blue: style.getPropertyValue('--accent-blue').trim() || '#7aa2f7',
      red: style.getPropertyValue('--accent-red').trim() || '#f7768e',
      gold: style.getPropertyValue('--accent-gold').trim() || '#e0af68',
      section: style.getPropertyValue('--accent-green').trim() || '#9ece6a',
      fontMono: style.getPropertyValue('--font-mono').trim() || 'monospace',
    };
  }

  // --- Layout ---

  _computeLayout() {
    if (!this.track) return;

    const containerWidth = this.wrap.clientWidth || 1000;
    const availableWidth = Math.max(containerWidth - TAB.marginLeft - TAB.marginRight, 400);
    this.totalWidth = containerWidth;

    const beatPos = [];
    const systems = [];
    const allMeasures = this.track.measures;

    // Group measures into systems with a fixed count per line (like sheet music).
    // Each system gets equal-width measures that fill the available width.
    const perLine = Math.min(TAB.measuresPerLine, TAB.maxMeasuresPerLine);
    for (let i = 0; i < allMeasures.length; i += perLine) {
      const batch = allMeasures.slice(i, i + perLine);
      systems.push({ measures: batch });
    }

    const staffHeight = (this.track.stringCount - 1) * TAB.lineSpacing;
    const systemHeight = staffHeight + TAB.marginTop + TAB.marginBottom;

    let currentY = TAB.titleHeight;

    for (let sIdx = 0; sIdx < systems.length; sIdx++) {
      const system = systems[sIdx];
      system.y = currentY;
      system.height = systemHeight;

      // All measures in the system get equal width
      const measureWidth = availableWidth / system.measures.length;

      let currentX = TAB.marginLeft;
      for (const measure of system.measures) {
        const numBeats = measure.beatIndices.length || 1;

        measure._renderedX = currentX;
        measure._renderedWidth = measureWidth;

        // Evenly space beats within the measure (with padding on each side)
        const innerWidth = measureWidth - TAB.measurePadding * 2;
        for (let i = 0; i < measure.beatIndices.length; i++) {
          // Center beats: first beat offset by half a slot from the left padding
          const beatX = currentX + TAB.measurePadding + (i + 0.5) * (innerWidth / numBeats);
          const beatIdx = measure.beatIndices[i];

          beatPos[beatIdx] = {
            x: beatX,
            y: currentY,
            systemHeight: systemHeight,
            staffY: currentY + TAB.marginTop,
          };
        }

        currentX += measureWidth;
      }
      currentY += systemHeight + TAB.systemSpacing;
    }

    this.beatPositions = beatPos;
    this.systems = systems;
    this.totalHeight = currentY;

    // Size both canvases identically
    const dpr = window.devicePixelRatio || 1;
    for (const cvs of [this.canvas, this.overlayCanvas]) {
      cvs.width = this.totalWidth * dpr;
      cvs.height = this.totalHeight * dpr;
      cvs.style.width = this.totalWidth + 'px';
      cvs.style.height = this.totalHeight + 'px';
      cvs.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // --- Static rendering (tab content — only redrawn on data/layout change) ---

  _renderStatic() {
    const ctx = this.ctx;
    const c = this._colors;
    if (!this.track || this.systems.length === 0 || !c) return;

    const { stringCount, timeline, name } = this.track;
    const staffHeight = (stringCount - 1) * TAB.lineSpacing;

    // Clear
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.totalWidth, this.totalHeight);

    // Title
    this._drawTitle(ctx, c, name);

    for (let sIdx = 0; sIdx < this.systems.length; sIdx++) {
      const system = this.systems[sIdx];
      const staffY = system.y + TAB.marginTop;

      this._drawStaffLines(ctx, c, staffY, stringCount);
      this._drawTabLabel(ctx, c, staffY, staffHeight);
      this._drawMeasureBars(ctx, c, system, staffY, staffHeight);
      this._drawSystemEndBarline(ctx, c, staffY, staffHeight);
      this._drawPalmMuting(ctx, c, system, staffY, timeline);
      this._drawNotes(ctx, c, system, staffY, stringCount, staffHeight, timeline);
    }
  }

  _drawTitle(ctx, c, name) {
    ctx.fillStyle = c.gold;
    ctx.font = `bold ${TAB.titleFontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(name.toUpperCase(), TAB.marginLeft, 25);
  }

  _drawStaffLines(ctx, c, staffY, stringCount) {
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 0.5;
    for (let s = 0; s < stringCount; s++) {
      const y = staffY + s * TAB.lineSpacing;
      ctx.beginPath();
      ctx.moveTo(TAB.marginLeft + TAB.barlineStartInset, y);
      ctx.lineTo(this.totalWidth - TAB.marginRight + TAB.barlineEndInset, y);
      ctx.stroke();
    }
  }

  _drawTabLabel(ctx, c, staffY, staffHeight) {
    const midY = staffY + staffHeight / 2;
    ctx.fillStyle = c.muted;
    ctx.font = `bold ${TAB.tabLabelFontSize}px ${c.fontMono}`;
    ctx.textAlign = 'center';
    ctx.fillText('T', TAB.tabLabelX, midY + TAB.tabLabelOffsetTop);
    ctx.fillText('A', TAB.tabLabelX, midY + TAB.tabLabelOffsetMid);
    ctx.fillText('B', TAB.tabLabelX, midY + TAB.tabLabelOffsetBot);
  }

  _drawMeasureBars(ctx, c, system, staffY, staffHeight) {
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
          ctx.font = `bold ${TAB.sectionFontSize}px sans-serif`;
          ctx.textAlign = 'left';
          ctx.fillText(label, x + 4, staffY + TAB.sectionLabelOffsetY);
        }
      }

      // Measure number
      ctx.fillStyle = c.muted;
      ctx.font = `${TAB.measureNumFontSize}px ${c.fontMono}`;
      ctx.textAlign = 'left';
      ctx.fillText(measure.masterBarIndex + 1, x + TAB.measureNumOffsetX, staffY + TAB.measureNumOffsetY);
    }
  }

  _drawSystemEndBarline(ctx, c, staffY, staffHeight) {
    const lastX = this.totalWidth - TAB.marginRight;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = TAB.barlineEndWidth;
    ctx.beginPath();
    ctx.moveTo(lastX, staffY);
    ctx.lineTo(lastX, staffY + staffHeight);
    ctx.stroke();
  }

  _drawPalmMuting(ctx, c, system, staffY, timeline) {
    let pmStart = null;
    for (const measure of system.measures) {
      for (const beatIdx of measure.beatIndices) {
        const isPM = timeline[beatIdx].notes.some(n => n.palmMuted);
        const nextIsPM = timeline[beatIdx + 1]?.notes.some(n => n.palmMuted);
        const nextIsOnSameRow = (beatIdx + 1 < timeline.length) &&
          this.beatPositions[beatIdx + 1] &&
          this.beatPositions[beatIdx + 1].y === system.y;

        if (isPM && pmStart === null) pmStart = this.beatPositions[beatIdx].x;

        if (pmStart !== null && (!nextIsPM || !nextIsOnSameRow)) {
          const endX = this.beatPositions[beatIdx].x;
          const y = staffY + TAB.pmLabelOffsetY;
          ctx.strokeStyle = c.section;
          ctx.fillStyle = c.section;
          ctx.lineWidth = 1;
          ctx.font = `bold ${TAB.pmFontSize}px sans-serif`;
          ctx.textAlign = 'left';
          ctx.fillText('P.M.', pmStart, y);
          if (endX > pmStart) {
            const textWidth = ctx.measureText('P.M. ').width;
            ctx.beginPath();
            ctx.setLineDash(TAB.pmDashPattern);
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

  _drawNotes(ctx, c, system, staffY, stringCount, staffHeight, timeline) {
    for (const measure of system.measures) {
      for (const beatIdx of measure.beatIndices) {
        const event = timeline[beatIdx];
        if (!event) continue;
        const x = this.beatPositions[beatIdx].x;

        // Pick stroke indicator
        const stroke = event.notes.find(n => n.pickStroke && n.pickStroke !== 'None')?.pickStroke;
        if (stroke) {
          ctx.fillStyle = c.muted;
          ctx.font = `bold ${TAB.pickStrokeFontSize}px sans-serif`;
          ctx.textAlign = 'center';
          const label = stroke === 'Down' ? '\u03A0' : 'V'; // Π or V
          ctx.fillText(label, x, staffY + staffHeight + TAB.pickStrokeOffsetY);
        }

        for (const note of event.notes) {
          if (note.tieDestination) continue;
          if (note.string < 0 || note.string >= stringCount) continue;

          const y = staffY + (stringCount - 1 - note.string) * TAB.lineSpacing;
          const textW = note.fret >= 10 ? TAB.noteTextWidthDouble : TAB.noteTextWidthSingle;

          // Background clear behind note text
          ctx.fillStyle = c.bg;
          ctx.fillRect(x - textW / 2 - TAB.noteTextPadding, y - TAB.noteTextHalfHeight, textW + TAB.noteTextPadding * 2, TAB.noteTextHalfHeight * 2);

          // Note text
          ctx.fillStyle = c.text;
          ctx.font = `bold ${TAB.fontSize}px ${c.fontMono}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          if (note.muted) ctx.fillText('X', x, y);
          else ctx.fillText(note.fret, x, y);

          // Harmonic / bend annotations
          if (note.harmonic || note.bended) {
            ctx.fillStyle = c.red;
            ctx.font = `bold ${TAB.annotationFontSize}px sans-serif`;
            ctx.fillText(note.harmonic ? 'NH' : 'B', x, y + TAB.annotationOffsetY);
          }

          // Slide / hammer-on lines
          if (note.slide || note.hopoOrigin) {
            let nextBeat = null;
            for (let j = beatIdx + 1; j < Math.min(beatIdx + 10, timeline.length); j++) {
              if (this.beatPositions[j] && this.beatPositions[j].y === system.y) {
                const target = timeline[j].notes.find(n => n.string === note.string);
                if (target) { nextBeat = j; break; }
              } else break;
            }
            if (nextBeat !== null) {
              const nextX = this.beatPositions[nextBeat].x;
              const nextY = staffY + (stringCount - 1 - note.string) * TAB.lineSpacing;
              ctx.strokeStyle = c.section;
              ctx.lineWidth = 1;
              if (note.slide) {
                ctx.beginPath();
                ctx.moveTo(x + TAB.slideInset, y);
                ctx.lineTo(nextX - TAB.slideInset, nextY);
                ctx.stroke();
              } else {
                const midX = (x + nextX) / 2;
                ctx.beginPath();
                ctx.moveTo(x + TAB.hopoInset, y + TAB.hopoArcOffsetY);
                ctx.quadraticCurveTo(midX, y + TAB.hopoArcHeight, nextX - TAB.hopoInset, nextY + TAB.hopoArcOffsetY);
                ctx.stroke();
              }
            }
          }
        }
      }
    }
  }

  // --- Overlay rendering (cursor + loop markers — redrawn on every cursor move) ---

  _renderOverlay() {
    const ctx = this.overlayCtx;
    const c = this._colors;
    if (!c) return;

    // Clear entire overlay
    ctx.clearRect(0, 0, this.totalWidth, this.totalHeight);

    this._drawCursor(ctx, c);
    this._drawLoopMarkers(ctx, c);
  }

  _drawCursor(ctx, c) {
    if (this.cursorIndex < 0) return;
    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;

    // Find the system this cursor is on
    const system = this.systems.find(s => s.y === pos.y);
    if (!system) return;

    ctx.strokeStyle = c.cursor;
    ctx.lineWidth = TAB.cursorWidth;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(pos.x, system.y + TAB.marginTop - TAB.cursorOverhang);
    ctx.lineTo(pos.x, system.y + system.height - TAB.marginBottom + TAB.cursorOverhang);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Highlight cursor notes on static canvas by re-drawing them in cursor color
    this._highlightCursorNotes();
  }

  _highlightCursorNotes() {
    if (this.cursorIndex < 0 || !this.track) return;
    const ctx = this.overlayCtx;
    const c = this._colors;
    const { stringCount, timeline } = this.track;
    const event = timeline[this.cursorIndex];
    if (!event) return;

    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;
    const staffY = pos.staffY;

    for (const note of event.notes) {
      if (note.tieDestination) continue;
      if (note.string < 0 || note.string >= stringCount) continue;

      const x = pos.x;
      const y = staffY + (stringCount - 1 - note.string) * TAB.lineSpacing;
      const textW = note.fret >= 10 ? TAB.noteTextWidthDouble : TAB.noteTextWidthSingle;

      // Background
      ctx.fillStyle = c.bg;
      ctx.fillRect(x - textW / 2 - TAB.noteTextPadding, y - TAB.noteTextHalfHeight, textW + TAB.noteTextPadding * 2, TAB.noteTextHalfHeight * 2);

      // Note in cursor color
      ctx.fillStyle = c.cursor;
      ctx.font = `bold ${TAB.fontSize}px ${c.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (note.muted) ctx.fillText('X', x, y);
      else ctx.fillText(note.fret, x, y);
    }
  }

  _drawLoopMarkers(ctx, c) {
    if (this.loopA !== null) this._drawLoopMarker(ctx, this.beatPositions[this.loopA], 'A', c.blue);
    if (this.loopB !== null) this._drawLoopMarker(ctx, this.beatPositions[this.loopB], 'B', c.red);
  }

  _drawLoopMarker(ctx, pos, label, color) {
    if (!pos) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = TAB.loopMarkerWidth;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y + TAB.marginTop - TAB.cursorOverhang);
    ctx.lineTo(pos.x, pos.y + pos.systemHeight - TAB.marginBottom + TAB.cursorOverhang);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${TAB.loopMarkerFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, pos.x, pos.y + pos.systemHeight + TAB.loopMarkerBottomOffset);
  }

  // --- Scrolling ---

  _scrollToCursor() {
    if (this.cursorIndex < 0) return;
    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;

    const wrapHeight = this.wrap.clientHeight;
    const scrollY = this.wrap.scrollTop;
    if (pos.y < scrollY + TAB.scrollPaddingTop || pos.y > scrollY + wrapHeight - TAB.scrollPaddingBottom) {
      this.wrap.scrollTo({ top: Math.max(0, pos.y - TAB.scrollTargetOffset), behavior: 'smooth' });
    }
  }
}
