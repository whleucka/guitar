// Canvas-based scrolling tab renderer

const TAB = {
  lineSpacing: 16,
  beatSpacing: 32,
  measurePadding: 20,
  marginLeft: 50,
  marginRight: 20,
  marginTop: 100, // Increased for RiffLogic
  marginBottom: 20,
  systemSpacing: 120, // Increased for visual breathing room
  cursorWidth: 3,
  fontSize: 13,
  sectionFontSize: 11,
  minMeasureWidth: 150,
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

    this.track = null; // { timeline, measures, stringCount, name }
    this.beatPositions = []; // Array of { x, y, systemHeight, staffY } (per beat index)
    this.systems = []; // Array of { measures, y, height }
    this.totalWidth = 0;
    this.totalHeight = 0;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;

    // Handle window resize to re-layout
    this._resizeTimeout = null;
    window.addEventListener('resize', () => {
      clearTimeout(this._resizeTimeout);
      this._resizeTimeout = setTimeout(() => {
        if (this.track) {
          this._computeLayout();
          this._render();
        }
      }, 200);
    });

    // Click handler for loop setting
    this.canvas.addEventListener('click', (e) => {
      if (this._onCanvasClick) this._onCanvasClick(e);
    });
  }

  /**
   * Set tab data and render.
   */
  setData(trackData) {
    this.track = trackData;
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
      const dist = Math.sqrt(dx * dx + dy * dy);
      
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
      const scaleY = this.canvas.height / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;
      const index = this.getIndexAtPoint(canvasX, canvasY);
      handler(index);
    };
  }

  _computeLayout() {
    if (!this.track) return;

    const containerWidth = this.wrap.clientWidth || 1000;
    const availableWidth = Math.max(containerWidth - TAB.marginLeft - TAB.marginRight, 400);
    this.totalWidth = containerWidth;

    const beatPos = [];
    const systems = [];
    
    // Group measures into rows (systems)
    let currentSystemMeasures = [];
    let currentSystemWidth = 0;
    
    for (const measure of this.track.measures) {
      const numBeats = measure.beatIndices.length || 1;
      const measureMinWidth = Math.max(
        TAB.minMeasureWidth,
        numBeats * TAB.beatSpacing + TAB.measurePadding * 2
      );

      if (currentSystemWidth + measureMinWidth > availableWidth && currentSystemMeasures.length > 0) {
        systems.push({ measures: currentSystemMeasures, width: currentSystemWidth });
        currentSystemMeasures = [measure];
        currentSystemWidth = measureMinWidth;
      } else {
        currentSystemMeasures.push(measure);
        currentSystemWidth += measureMinWidth;
      }
    }
    if (currentSystemMeasures.length > 0) {
      systems.push({ measures: currentSystemMeasures, width: currentSystemWidth });
    }

    const staffHeight = (this.track.stringCount - 1) * TAB.lineSpacing;
    const systemHeight = staffHeight + TAB.marginTop + TAB.marginBottom;
    
    // Add extra space at top for the instrument name (only once)
    const titleHeight = 40;
    let currentY = titleHeight;

    for (let sIdx = 0; sIdx < systems.length; sIdx++) {
      const system = systems[sIdx];
      system.y = currentY;
      system.height = systemHeight;

      const extraWidth = availableWidth - system.width;
      const widthPerMeasure = extraWidth / system.measures.length;

      let currentX = TAB.marginLeft;
      for (const measure of system.measures) {
        const numBeats = measure.beatIndices.length || 1;
        const baseWidth = Math.max(TAB.minMeasureWidth, numBeats * TAB.beatSpacing + TAB.measurePadding * 2);
        const actualMeasureWidth = baseWidth + widthPerMeasure;
        
        measure._renderedX = currentX;
        measure._renderedWidth = actualMeasureWidth;

        for (let i = 0; i < measure.beatIndices.length; i++) {
          const beatX = currentX + TAB.measurePadding + i * (actualMeasureWidth - TAB.measurePadding * 2) / Math.max(numBeats, 1);
          const beatIdx = measure.beatIndices[i];
          
          beatPos[beatIdx] = {
            x: beatX,
            y: currentY,
            systemHeight: systemHeight,
            staffY: currentY + TAB.marginTop
          };
        }

        currentX += actualMeasureWidth;
      }
      currentY += systemHeight + TAB.systemSpacing;
    }

    this.beatPositions = beatPos;
    this.systems = systems;
    this.totalHeight = currentY;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.totalWidth * dpr;
    this.canvas.height = this.totalHeight * dpr;
    this.canvas.style.width = this.totalWidth + 'px';
    this.canvas.style.height = this.totalHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _render() {
    const ctx = this.ctx;
    if (!this.track || this.systems.length === 0) return;

    const style = getComputedStyle(document.documentElement);
    const bgColor = style.getPropertyValue('--bg-primary').trim() || '#24283b';
    const lineColor = style.getPropertyValue('--fb-fret-wire').trim() || '#565f89';
    const textColor = style.getPropertyValue('--text-primary').trim() || '#c0caf5';
    const mutedColor = style.getPropertyValue('--text-muted').trim() || '#565f89';
    const cursorColor = style.getPropertyValue('--accent-gold').trim() || '#e0af68';
    const accentBlue = style.getPropertyValue('--accent-blue').trim() || '#7aa2f7';
    const accentRed = style.getPropertyValue('--accent-red').trim() || '#f7768e';
    const accentGold = style.getPropertyValue('--accent-gold').trim() || '#e0af68';
    const sectionColor = style.getPropertyValue('--accent-green').trim() || '#9ece6a';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, this.totalWidth, this.totalHeight);

    const { stringCount, timeline, name } = this.track;
    const staffHeight = (stringCount - 1) * TAB.lineSpacing;

    // Instrument Name (Once at top) - RiffLogic style
    ctx.fillStyle = accentGold;
    ctx.font = `bold 12px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(name.toUpperCase(), TAB.marginLeft, 30);

    for (let sIdx = 0; sIdx < this.systems.length; sIdx++) {
      const system = this.systems[sIdx];
      const currentY = system.y + TAB.marginTop;

      // Tab lines
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.5;
      for (let s = 0; s < stringCount; s++) {
        const y = currentY + s * TAB.lineSpacing;
        ctx.beginPath();
        ctx.moveTo(TAB.marginLeft - 10, y);
        ctx.lineTo(this.totalWidth - TAB.marginRight + 10, y);
        ctx.stroke();
      }

      // TAB clef
      ctx.fillStyle = mutedColor;
      ctx.font = `bold 11px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
      ctx.textAlign = 'center';
      const midY = currentY + staffHeight / 2;
      ctx.fillText('T', 20, midY - 7);
      ctx.fillText('A', 20, midY + 3);
      ctx.fillText('B', 20, midY + 13);

      // Measures
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      for (const measure of system.measures) {
        const x = measure._renderedX;
        ctx.beginPath();
        ctx.moveTo(x, currentY);
        ctx.lineTo(x, currentY + staffHeight);
        ctx.stroke();

        // Section label (e.g. Verse)
        if (measure.section) {
          const label = measure.section.text || measure.section.letter;
          if (label) {
            ctx.fillStyle = accentBlue;
            ctx.font = `bold ${TAB.sectionFontSize}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText(label, x + 4, currentY - 55);
          }
        }

        // Bar number
        ctx.fillStyle = mutedColor;
        ctx.font = `9px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
        ctx.textAlign = 'left';
        ctx.fillText(measure.masterBarIndex + 1, x + 3, currentY - 5);
      }

      // Final system barline
      const lastX = this.totalWidth - TAB.marginRight;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lastX, currentY);
      ctx.lineTo(lastX, currentY + staffHeight);
      ctx.stroke();

      // --- Palm Muting Brackets (System-aware) ---
      let pmStart = null;
      for (const measure of system.measures) {
        for (const beatIdx of measure.beatIndices) {
          const isPM = timeline[beatIdx].notes.some(n => n.palmMuted);
          const nextIsPM = timeline[beatIdx + 1]?.notes.some(n => n.palmMuted);
          const nextIsOnSameRow = (beatIdx + 1 < timeline.length) && 
                                  this.beatPositions[beatIdx + 1] && 
                                  this.beatPositions[beatIdx + 1].y === system.y;

          if (isPM && pmStart === null) {
            pmStart = this.beatPositions[beatIdx].x;
          }
          
          if (pmStart !== null && (!nextIsPM || !nextIsOnSameRow)) {
            const endX = this.beatPositions[beatIdx].x;
            const y = currentY - 25;
            
            ctx.strokeStyle = sectionColor;
            ctx.fillStyle = sectionColor;
            ctx.lineWidth = 1;
            ctx.font = "bold 9px sans-serif";
            ctx.textAlign = "left";
            ctx.fillText("P.M.", pmStart, y);
            
            if (endX > pmStart) {
              const textWidth = ctx.measureText("P.M. ").width;
              ctx.beginPath();
              ctx.setLineDash([2, 2]);
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

      // Notes
      for (const measure of system.measures) {
        for (const beatIdx of measure.beatIndices) {
          const event = timeline[beatIdx];
          if (!event) continue;
          const x = this.beatPositions[beatIdx].x;

          const stroke = event.notes.find(n => n.pickStroke && n.pickStroke !== 'None')?.pickStroke;
          if (stroke) {
            ctx.fillStyle = mutedColor;
            ctx.font = "bold 9px sans-serif";
            const label = stroke === 'Down' ? 'Π' : 'V';
            ctx.fillText(label, x, currentY + staffHeight + 10);
          }

          for (const note of event.notes) {
            if (note.tieDestination) continue;
            if (note.string < 0 || note.string >= stringCount) continue;

            const y = currentY + (stringCount - 1 - note.string) * TAB.lineSpacing;
            const textW = note.fret >= 10 ? 14 : 9;
            
            ctx.fillStyle = bgColor;
            ctx.fillRect(x - textW / 2 - 1, y - 6, textW + 2, 12);

            const isCursor = beatIdx === this.cursorIndex;
            ctx.fillStyle = isCursor ? cursorColor : textColor;
            ctx.font = `bold ${TAB.fontSize}px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            if (note.muted) ctx.fillText('X', x, y);
            else ctx.fillText(note.fret, x, y);

            if (note.harmonic || note.bended) {
              ctx.fillStyle = accentRed;
              ctx.font = "bold 7px sans-serif";
              ctx.fillText(note.harmonic ? 'NH' : 'B', x, y - 10);
            }

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
                const nextY = currentY + (stringCount - 1 - note.string) * TAB.lineSpacing;
                ctx.strokeStyle = sectionColor;
                ctx.lineWidth = 1;
                if (note.slide) {
                  ctx.beginPath(); ctx.moveTo(x + 7, y); ctx.lineTo(nextX - 7, nextY); ctx.stroke();
                } else {
                  const midX = (x + nextX) / 2;
                  ctx.beginPath(); ctx.moveTo(x + 5, y - 4); ctx.quadraticCurveTo(midX, y - 12, nextX - 5, nextY - 4); ctx.stroke();
                }
              }
            }
          }
        }
      }

      // Cursor
      if (this.cursorIndex >= 0) {
        const pos = this.beatPositions[this.cursorIndex];
        if (pos && pos.y === system.y) {
          ctx.strokeStyle = cursorColor;
          ctx.lineWidth = TAB.cursorWidth;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(pos.x, system.y + TAB.marginTop - 10);
          ctx.lineTo(pos.x, system.y + system.height - TAB.marginBottom + 10);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    if (this.loopA !== null) this._drawLoopMarker(this.beatPositions[this.loopA], 'A', accentBlue);
    if (this.loopB !== null) this._drawLoopMarker(this.beatPositions[this.loopB], 'B', accentRed);
  }

  _drawLoopMarker(pos, label, color) {
    if (!pos) return;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y + TAB.marginTop - 10);
    ctx.lineTo(pos.x, pos.y + pos.systemHeight - TAB.marginBottom + 10);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, pos.x, pos.y + pos.systemHeight - 2);
  }

  _scrollToCursor() {
    if (this.cursorIndex < 0) return;
    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;

    const wrapHeight = this.wrap.clientHeight;
    const scrollY = this.wrap.scrollTop;
    if (pos.y < scrollY + 50 || pos.y > scrollY + wrapHeight - 150) {
      this.wrap.scrollTo({ top: Math.max(0, pos.y - 100), behavior: 'smooth' });
    }
  }
}
