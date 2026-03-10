// Canvas-based scrolling tab renderer
// Uses dual-canvas layering: static tab content + animated cursor overlay

const TAB = {
  lineSpacing: 14,
  measurePadding: 12,
  marginLeft: 50,
  marginRight: 20,
  marginTop: 70,
  marginBottom: 30,         // room for rhythm stems below staff
  systemSpacing: 40,
  cursorWidth: 3,
  fontSize: 12,
  sectionFontSize: 10,
  measuresPerLine: 4,       // target measures per system (like sheet music)
  maxMeasuresPerLine: 5,    // never exceed this many
  titleHeight: 35,

  // Annotation offsets
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
  noteTextWidthSingle: 10,
  noteTextWidthDouble: 16,
  noteTextPadding: 2,
  noteTextHalfHeight: 6,
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

  // Vibrato & Bends
  vibratoAmplitude: 3,
  vibratoFrequency: 6,
  vibratoLength: 15,
  bendWidth: 12,
  bendHeight: 20,
  bendFontSize: 9,

  // Time signature
  timeSigFontSize: 16,
  timeSigPadLeft: 6,        // gap between barline and time sig
  timeSigWidth: 22,         // reserved width for the time sig block
  timeSigSpacing: 15,       // vertical spacing between numerator and denominator

  // Rhythm stems (Songsterr-style below staff)
  stemOffset: 6,            // gap between bottom staff line and stem top
  stemLength: 12,           // length of the stem line
  stemWidth: 1.5,
  flagLength: 6,            // length of flag strokes
  flagSpacing: 3,           // vertical spacing between multiple flags
  beamThickness: 2,         // thickness of beam lines
  noteheadRadius: 2.5,      // radius for filled/open noteheads
  restFontSize: 10,         // font size for rest symbols

  // Rhythmic Layout
  minNoteSpacing: 18,       // minimum horizontal space for a short note (e.g. 16th)
  beatSpacing: 8,           // extra padding between beats for visual grouping
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

  setMeasuresPerLine(n) {
    TAB.measuresPerLine = n;
    TAB.maxMeasuresPerLine = n + 1;
    if (this.track) {
      this._computeLayout();
      this._renderStatic();
      this._renderOverlay();
    }
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

    const { timeline } = this.track;
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

    // Pre-compute which measures show a time signature (needed for layout padding)
    const timeSigFlags = this._computeTimeSigFlags(allMeasures, systems);

    let currentY = TAB.titleHeight;

    for (let sIdx = 0; sIdx < systems.length; sIdx++) {
      const system = systems[sIdx];
      system.y = currentY;
      system.height = systemHeight;

      // Calculate proportional widths based on rhythmic and visual complexity
      const complexities = system.measures.map(m => {
        let score = Math.max(4, m.beatIndices.length);
        
        // Add extra weight for measures with many double-digit notes
        for (const bIdx of m.beatIndices) {
          const event = timeline[bIdx];
          if (event && event.notes.some(n => n.fret >= 10)) {
            score += 1.5; // significantly more room for high frets
          }
          if (event && event.notes.length > 2) {
            score += 0.3; // extra weight for chords
          }
        }
        return score;
      });
      const totalComplexity = complexities.reduce((a, b) => a + b, 0);

      let currentX = TAB.marginLeft;
      for (let mIdx = 0; mIdx < system.measures.length; mIdx++) {
        const measure = system.measures[mIdx];
        const measureWidth = (complexities[mIdx] / totalComplexity) * availableWidth;
        
        const hasTimeSig = timeSigFlags.has(measure);
        const beatDuration = 60 / measure.tempo;
        const totalMeasureBeats = (measure.timeSignature?.num || 4) / ((measure.timeSignature?.den || 4) / 4);

        measure._renderedX = currentX;
        measure._renderedWidth = measureWidth;
        measure._hasTimeSig = hasTimeSig;

        // Extra left padding when time signature is shown
        const leftPad = TAB.measurePadding + (hasTimeSig ? TAB.timeSigPadLeft + TAB.timeSigWidth : 0);
        const innerWidth = measureWidth - leftPad - TAB.measurePadding;

        for (let i = 0; i < measure.beatIndices.length; i++) {
          const beatIdx = measure.beatIndices[i];
          const event = timeline[beatIdx];
          if (!event) continue;

          // Relative time in quarter notes (beats)
          const beatTime = (event.time - measure.startTime) / beatDuration;

          // Non-linear spacing logic:
          // We compress subdivisions (8ths, 16ths) slightly towards the start of the beat.
          // This creates a visual "gap" between beats, making the rhythm much easier to read.
          
          const beatInt = Math.floor(beatTime + 0.0001); // Handle precision noise
          const beatFrac = Math.max(0, beatTime - beatInt); 
          
          // Apply power function to "tuck" fractional parts (subdivisions)
          // Using a softer power (1.1) to avoid overlapping fast triplets.
          const groupedFrac = Math.pow(beatFrac, 1.1);
          const weightedTime = beatInt + groupedFrac;
          
          const progress = weightedTime / totalMeasureBeats;
          const beatX = currentX + leftPad + Math.min(0.98, progress) * innerWidth;
          
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
      this._drawTimeSignatures(ctx, c, system, staffY, staffHeight, sIdx);
      this._drawMeasureBars(ctx, c, system, staffY, staffHeight);
      this._drawSystemEndBarline(ctx, c, staffY, staffHeight);
      this._drawPalmMuting(ctx, c, system, staffY, timeline);
      this._drawNotes(ctx, c, system, staffY, stringCount, staffHeight, timeline);
      this._drawRhythmStems(ctx, c, system, staffY, staffHeight, timeline);
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

  /**
   * Pre-compute which measures should display a time signature.
   * Returns a Set of measure objects that need one.
   */
  _computeTimeSigFlags(allMeasures, systems) {
    const flags = new Set();
    let prevTs = null;
    let measureIndex = 0;

    for (const system of systems) {
      for (const measure of system.measures) {
        const ts = measure.timeSignature;
        if (ts) {
          // Show on first measure, or when time sig changes
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

  _drawTimeSignatures(ctx, c, system, staffY, staffHeight, systemIndex) {
    for (const measure of system.measures) {
      if (!measure._hasTimeSig) continue;
      const ts = measure.timeSignature;
      if (!ts) continue;

      // Position: right after the barline, centered in the reserved space
      const x = measure._renderedX + TAB.timeSigPadLeft + TAB.timeSigWidth / 2;
      const midY = staffY + staffHeight / 2;

      ctx.fillStyle = c.gold;
      ctx.font = `bold ${TAB.timeSigFontSize}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ts.num, x, midY - TAB.timeSigSpacing / 2);
      ctx.fillText(ts.den, x, midY + TAB.timeSigSpacing / 2);
    }
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

        // Draw rests directly on the staff
        if (event.notes.length === 0) {
          ctx.fillStyle = c.muted;
          const label = event.rhythmLabel;
          const midY = staffY + staffHeight / 2;
          
          if (label === 'W') {
            // Whole rest: hanging from string 2 (from top)
            const ry = staffY + TAB.lineSpacing;
            ctx.fillRect(x - 8, ry, 16, 5);
          } else if (label === 'H') {
            // Half rest: sitting on string 3
            const ry = staffY + TAB.lineSpacing * 2 - 5;
            ctx.fillRect(x - 8, ry, 16, 5);
          } else {
            // Quarter and shorter: centered musical symbols
            ctx.font = `${TAB.restFontSize + 12}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            let glyph = '\u{1D13D}'; // quarter
            if (label === '8') glyph = '\u{1D13E}';
            else if (label === '16') glyph = '\u{1D13F}';
            else if (label === '32') glyph = '\u{1D140}';
            ctx.fillText(glyph, x, midY);
          }
          continue;
        }

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
          if (note.string < 0 || note.string >= stringCount) continue;

          const y = staffY + (stringCount - 1 - note.string) * TAB.lineSpacing;
          const isTied = note.tieDestination;
          
          // Note text width (wider for double digits or tied notes with parens)
          let textW = note.fret >= 10 ? TAB.noteTextWidthDouble : TAB.noteTextWidthSingle;
          if (isTied) textW += 6; // extra space for parens

          // Background clear behind note text
          ctx.fillStyle = c.bg;
          ctx.fillRect(x - textW / 2 - TAB.noteTextPadding, y - TAB.noteTextHalfHeight, textW + TAB.noteTextPadding * 2, TAB.noteTextHalfHeight * 2);

          // Note text
          ctx.fillStyle = isTied ? c.muted : c.text;
          ctx.font = `${isTied ? '' : 'bold '}${TAB.fontSize}px ${c.fontMono}`;
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
            const vy = y - TAB.lineSpacing / 2;
            const vw = TAB.vibratoLength;
            for (let vx = 0; vx < vw; vx++) {
              ctx.lineTo(x + TAB.noteTextWidthSingle + vx, vy + Math.sin(vx * 0.5) * TAB.vibratoAmplitude);
            }
            ctx.stroke();
          }

          // Harmonic / bend annotations
          if (!isTied) {
            if (note.harmonic) {
              ctx.fillStyle = c.red;
              ctx.font = `bold ${TAB.annotationFontSize}px sans-serif`;
              ctx.fillText('NH', x, y + TAB.annotationOffsetY);
            }
            
            if (note.bended) {
              const bx = x + (note.fret >= 10 ? 12 : 8);
              const by = y;
              ctx.strokeStyle = c.text;
              ctx.lineWidth = 1;
              
              // Draw bend arrow (vertical curve)
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.quadraticCurveTo(bx + 5, by - TAB.bendHeight / 2, bx + 5, by - TAB.bendHeight);
              ctx.stroke();
              
              // Arrowhead
              ctx.beginPath();
              ctx.moveTo(bx + 2, by - TAB.bendHeight + 4);
              ctx.lineTo(bx + 5, by - TAB.bendHeight);
              ctx.lineTo(bx + 8, by - TAB.bendHeight + 4);
              ctx.stroke();
              
              // Bend label
              ctx.fillStyle = c.text;
              ctx.font = `${TAB.bendFontSize}px sans-serif`;
              ctx.fillText('Full', bx + 5, by - TAB.bendHeight - 6);
            }
          }

          // Slide / hammer-on / tie lines
          if (note.slide || note.hopoOrigin || note.tieOrigin) {
            let nextBeat = null;
            for (let j = beatIdx + 1; j < Math.min(beatIdx + 15, timeline.length); j++) {
              const target = timeline[j].notes.find(n => n.string === note.string);
              if (target && (target.hopoDestination || target.tieDestination || note.slide)) {
                nextBeat = j;
                break;
              }
            }
            if (nextBeat !== null && this.beatPositions[nextBeat]) {
              const nextPos = this.beatPositions[nextBeat];
              const nextX = nextPos.x;
              const nextY = staffY + (stringCount - 1 - note.string) * TAB.lineSpacing;
              
              // Check if they are in the same system (y-coordinate is the same)
              const sameSystem = nextPos.y === this.beatPositions[beatIdx].y;

              if (sameSystem) {
                // Arcs for ties and hammer-ons
                if (note.tieOrigin || note.hopoOrigin) {
                  ctx.strokeStyle = note.tieOrigin ? c.muted : c.section;
                  ctx.lineWidth = 1;
                  const midX = (x + nextX) / 2;
                  const arcH = note.tieOrigin ? -TAB.hopoArcHeight * 0.7 : TAB.hopoArcHeight;
                  ctx.beginPath();
                  ctx.moveTo(x + TAB.hopoInset, y + TAB.hopoArcOffsetY);
                  ctx.quadraticCurveTo(midX, y + arcH, nextX - TAB.hopoInset, nextY + TAB.hopoArcOffsetY);
                  ctx.stroke();
                } else if (note.slide) {
                  ctx.strokeStyle = c.section;
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(x + TAB.slideInset, y);
                  ctx.lineTo(nextX - TAB.slideInset, nextY);
                  ctx.stroke();
                }
              } else {
                // Cross-system rendering: Draw a partial arc exiting the measure
                const exitX = measure._renderedX + measure._renderedWidth;
                ctx.strokeStyle = note.tieOrigin ? c.muted : c.section;
                ctx.lineWidth = 1;
                const midX = (x + exitX) / 2;
                const arcH = note.tieOrigin ? -TAB.hopoArcHeight * 0.7 : TAB.hopoArcHeight;
                
                ctx.beginPath();
                ctx.moveTo(x + TAB.hopoInset, y + TAB.hopoArcOffsetY);
                ctx.quadraticCurveTo(midX, y + arcH, exitX, y + (TAB.hopoArcOffsetY / 2));
                ctx.stroke();
              }
            }
          }
        }
      }
    }
  }

  _drawRhythmStems(ctx, c, system, staffY, staffHeight, timeline) {
    const stemTop = staffY + staffHeight + TAB.stemOffset;
    const stemBot = stemTop + TAB.stemLength;

    for (const measure of system.measures) {
      const beatDuration = 60 / measure.tempo;
      const timeSigNum = measure.timeSignature?.num || 4;
      const timeSigDen = measure.timeSignature?.den || 4;

      // Collect beat positions and rhythm info for beaming
      const beats = [];
      for (const beatIdx of measure.beatIndices) {
        const event = timeline[beatIdx];
        if (!event) continue;
        const pos = this.beatPositions[beatIdx];
        if (!pos) continue;

        // Relative time in beats from the start of the measure
        const beatTime = (event.time - measure.startTime) / beatDuration;

        // A beat is only a "visual rest" if it has no notes at all.
        // Tied notes should still have stems and beams.
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

        const flagCount = this._flagCount(label);

        if (label === 'W') {
          // Whole note: open notehead only, no stem
          ctx.strokeStyle = c.muted;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(x, stemTop + 2, TAB.noteheadRadius + 1, TAB.noteheadRadius, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (dotted) this._drawDot(ctx, c, x + TAB.noteheadRadius + 4, stemTop + 2);
        } else if (label === 'H') {
          // Half note: open notehead + stem
          ctx.strokeStyle = c.muted;
          ctx.lineWidth = TAB.stemWidth;
          ctx.beginPath();
          ctx.moveTo(x, stemTop);
          ctx.lineTo(x, stemBot);
          ctx.stroke();
          // Open notehead
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(x, stemBot + TAB.noteheadRadius, TAB.noteheadRadius + 0.5, TAB.noteheadRadius, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (dotted) this._drawDot(ctx, c, x + TAB.noteheadRadius + 4, stemBot + TAB.noteheadRadius);
        } else {
          // Quarter and shorter: filled notehead + stem + flags/beams
          ctx.strokeStyle = c.muted;
          ctx.lineWidth = TAB.stemWidth;
          ctx.beginPath();
          ctx.moveTo(x, stemTop);
          ctx.lineTo(x, stemBot);
          ctx.stroke();

          // Filled notehead (skip if purely tied)
          if (!isTied) {
            ctx.fillStyle = c.muted;
            ctx.beginPath();
            ctx.arc(x, stemBot + TAB.noteheadRadius, TAB.noteheadRadius, 0, Math.PI * 2);
            ctx.fill();
          }

          if (dotted) this._drawDot(ctx, c, x + TAB.noteheadRadius + 4, stemBot + TAB.noteheadRadius);

          // Beaming: try to beam with the next beat if both have flags
          if (flagCount > 0) {
            const next = beats[i + 1];
            const nextFlagCount = next ? this._flagCount(next.label) : 0;
            
            let shouldBreak = false;
            if (next) {
              const currentBeatPos = b.beatTime;
              const nextBeatPos = next.beatTime;

              // Rule 1: Break at the middle of 4/4 measures for eighth notes (grouping 4+4)
              // This splits the measure into two equal halves (beats 1-2 and 3-4).
              if (timeSigNum === 4 && timeSigDen === 4) {
                // Break if we are crossing the boundary between beat 2 and 3
                if (currentBeatPos < 1.99 && nextBeatPos >= 1.99) shouldBreak = true;
              }

              // Rule 2: For 16th notes and shorter, always break at every quarter-note beat boundary
              // (1.0, 2.0, 3.0, 4.0) to keep subdivisions grouped by the beat.
              if (flagCount >= 2 || nextFlagCount >= 2) {
                if (Math.floor(currentBeatPos + 0.005) !== Math.floor(nextBeatPos + 0.005)) {
                  shouldBreak = true;
                }
              }
            }

            const canBeam = !shouldBreak && nextFlagCount > 0 && !next?.isRest;

            if (canBeam) {
              // Draw beams connecting this beat to the next
              const beamCount = Math.min(flagCount, nextFlagCount);
              ctx.fillStyle = c.muted;
              for (let f = 0; f < beamCount; f++) {
                const by = stemTop + f * TAB.flagSpacing;
                ctx.fillRect(x, by, next.x - x, TAB.beamThickness);
              }
              // Extra flags if this beat has more than next (short beams)
              for (let f = beamCount; f < flagCount; f++) {
                const by = stemTop + f * TAB.flagSpacing;
                ctx.fillRect(x, by, TAB.flagLength, TAB.beamThickness);
              }
            } else {
              // Standalone flags
              ctx.fillStyle = c.muted;
              for (let f = 0; f < flagCount; f++) {
                const by = stemTop + f * TAB.flagSpacing;
                ctx.fillRect(x, by, TAB.flagLength, TAB.beamThickness);
              }
            }
          }
        }
      }
    }
  }

  _flagCount(rhythmLabel) {
    switch (rhythmLabel) {
      case '8':  return 1;
      case '16': return 2;
      case '32': return 3;
      case '64': return 4;
      default:   return 0;
    }
  }

  _drawDot(ctx, c, x, y) {
    ctx.fillStyle = c.muted;
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
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
