// Canvas-based scrolling tab renderer
// Uses dual-canvas layering: static tab content + overlay for note highlights/loop markers
// Smooth playback cursor uses a GPU-composited DOM element (zero canvas redraws per frame)
// Delegates layout to tab-layout.js and static drawing to tab-drawing.js

import { computeLayout } from './tab-layout.js';
import { renderStaticContent } from './tab-drawing.js';
import { TAB_CONSTANTS } from './tab-constants.js';
import { events, TAB_POSITION } from '../events.js';

export class TabRenderer {
  constructor(container) {
    this.container = container;

    // Static canvas (tab content: staff lines, notes, annotations)
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tab-canvas';
    this.ctx = this.canvas.getContext('2d');

    // Overlay canvas (note highlights, loop markers — redrawn only on beat/loop change)
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'tab-canvas tab-canvas-overlay';
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    // DOM cursor element (GPU-composited, moved via transform — zero paint cost)
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'tab-smooth-cursor';

    this.wrap = document.createElement('div');
    this.wrap.className = 'tab-canvas-wrap';
    this.wrap.appendChild(this.canvas);
    this.wrap.appendChild(this.overlayCanvas);
    this.wrap.appendChild(this.cursorEl);
    container.appendChild(this.wrap);

    this.track = null;
    this.beatPositions = [];
    this.systems = [];
    this.totalWidth = 0;
    this.totalHeight = 0;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;

    // Smooth cursor state
    this._lastHighlightIndex = -1;
    this._lastScrollSystem = null;
    this._lastMasterBarIndex = -1;

    // Cached theme colors
    this._colors = null;

    // Resize handling
    this._resizeTimeout = null;
    this._onResize = () => {
      clearTimeout(this._resizeTimeout);
      this._resizeTimeout = setTimeout(() => {
        if (this.track) {
          this._refreshColors();
          this._doLayout();
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

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.overlayCanvas.removeEventListener('click', this._clickListener);
    clearTimeout(this._resizeTimeout);
    this.wrap.remove();
  }

  setMeasuresPerLine(n) {
    TAB_CONSTANTS.measuresPerLine = n;
    TAB_CONSTANTS.maxMeasuresPerLine = n + 1;
    if (this.track) {
      this._doLayout();
      this._renderStatic();
      this._renderOverlay();
    }
  }

  setData(trackData) {
    this.track = trackData;
    this.cursorIndex = -1;
    this.loopA = null;
    this.loopB = null;
    this._lastHighlightIndex = -1;
    this._lastScrollSystem = null;
    // Cache system reference on each measure for O(1) lookup
    this._cacheSystemRefs();

    this._refreshColors();
    this._doLayout();
    this._cacheSystemRefs(); // re-cache after layout
    this._renderStatic();
    this._renderOverlay();
    this.cursorEl.style.display = 'none';
  }

  /** Discrete beat-based cursor (used when not playing) */
  setCursor(index) {
    if (this.cursorIndex === index) return;
    this.cursorIndex = index;
    this.cursorEl.style.display = 'none';
    this._renderOverlay();
    this._scrollToCursor();
  }

  /**
   * Smooth time-based cursor — sweeps continuously across measures.
   * Only updates a DOM element transform (GPU-composited, no canvas redraw).
   * Redraws overlay canvas only when the beat changes (for note highlighting).
   * @param {number} playbackTime - current time in the timeline's time space (seconds)
   */
  setCursorSmooth(playbackTime) {
    if (!this.track || !this.track.measures) return;

    const measures = this.track.measures;
    const timeline = this.track.timeline;
    const C = TAB_CONSTANTS;

    // Binary search for the measure containing this time
    const measure = this._findMeasureAtTime(playbackTime);
    if (!measure) return;

    // Find current beat index for note highlighting
    let beatIdx = 0;
    for (let i = measure.beatIndices.length - 1; i >= 0; i--) {
      const bi = measure.beatIndices[i];
      if (timeline[bi] && timeline[bi].time <= playbackTime + 0.001) {
        beatIdx = bi;
        break;
      }
    }

    // Progress within measure (0 to 1)
    const progress = Math.max(0, Math.min(1,
      (playbackTime - measure.startTime) / (measure.endTime - measure.startTime)
    ));

    // Compute cursor X from measure's rendered position
    const hasTimeSig = measure._hasTimeSig;
    const leftPad = C.measurePadding + (hasTimeSig ? C.timeSigPadLeft + C.timeSigWidth : 0);
    const innerWidth = measure._renderedWidth - leftPad - C.measurePadding;
    const x = measure._renderedX + leftPad + progress * innerWidth;

    // Get system from cached ref
    const system = measure._system;
    if (!system) return;

    // Position the DOM cursor (GPU-composited — no canvas redraw)
    const top = system.y + C.marginTop - C.cursorOverhang;
    const height = system.height - C.marginTop - C.marginBottom + 2 * C.cursorOverhang;
    this.cursorEl.style.display = 'block';
    this.cursorEl.style.transform = `translate(${x}px, ${top}px)`;
    this.cursorEl.style.height = `${height}px`;

    // Only redraw overlay when beat changes (note highlighting)
    if (beatIdx !== this._lastHighlightIndex) {
      this._lastHighlightIndex = beatIdx;
      this.cursorIndex = beatIdx;
      this._renderOverlay();
    }

    // Update bar counter when measure changes
    if (measure.masterBarIndex !== this._lastMasterBarIndex) {
      this._lastMasterBarIndex = measure.masterBarIndex;
      events.emit(TAB_POSITION, {
        masterBarIndex: measure.masterBarIndex,
        totalBars: measures.length,
      });
    }

    // Only scroll when system changes
    if (system !== this._lastScrollSystem) {
      this._lastScrollSystem = system;
      const wrapHeight = this.wrap.clientHeight;
      const scrollY = this.wrap.scrollTop;
      if (system.y < scrollY + C.scrollPaddingTop || system.y > scrollY + wrapHeight - C.scrollPaddingBottom) {
        this.wrap.scrollTo({ top: Math.max(0, system.y - C.scrollTargetOffset), behavior: 'smooth' });
      }
    }
  }

  clearCursor() {
    this.cursorIndex = -1;
    this._lastHighlightIndex = -1;
    this._lastScrollSystem = null;
    this._lastMasterBarIndex = -1;
    this.cursorEl.style.display = 'none';
    this._renderOverlay();
  }

  setLoop(a, b) {
    this.loopA = a;
    this.loopB = b;
    this._needsFullOverlayRedraw = true;
    this._renderOverlay();
  }

  getIndexAtPoint(canvasX, canvasY) {
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.beatPositions.length; i++) {
      const pos = this.beatPositions[i];
      if (!pos) continue;
      const dx = pos.x - canvasX;
      const dy = (pos.y + pos.systemHeight / 2) - canvasY;
      const dist = dx * dx + dy * dy;
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

  // --- System ref caching ---

  _cacheSystemRefs() {
    if (!this.systems || !this.track) return;
    for (const system of this.systems) {
      for (const measure of system.measures) {
        measure._system = system;
      }
    }
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

  // --- Layout (delegates to tab-layout.js) ---

  _doLayout() {
    if (!this.track) return;

    const containerWidth = this.wrap.clientWidth || 1000;

    const result = computeLayout(
      this.track,
      containerWidth,
    );

    this.beatPositions = result.beatPositions;
    this.systems = result.systems;
    this.totalWidth = result.totalWidth;
    this.totalHeight = result.totalHeight;

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

  // --- Static rendering (delegates to tab-drawing.js) ---

  _renderStatic() {
    if (!this.track || this.systems.length === 0 || !this._colors) return;
    renderStaticContent(
      this.ctx,
      this._colors,
      this.track,
      this.systems,
      this.beatPositions,
      this.totalWidth,
      this.totalHeight,
    );
  }

  // --- Overlay rendering (note highlights + loop markers, NOT the smooth cursor) ---

  _renderOverlay() {
    const ctx = this.overlayCtx;
    const c = this._colors;
    if (!c) return;

    // Only do full clear/redraw when loop markers need updating
    // For cursor-only updates, use incremental redraw
    if (this._needsFullOverlayRedraw) {
      ctx.clearRect(0, 0, this.totalWidth, this.totalHeight);
      this._drawCursor(ctx, c);
      this._drawLoopMarkers(ctx, c);
      this._needsFullOverlayRedraw = false;
    } else {
      // Incremental: only clear and redraw the note highlight area
      this._drawCursorIncremental(ctx, c);
    }
  }

  _drawCursorIncremental(ctx, c) {
    const C = TAB_CONSTANTS;
    
    // Clear previous highlight area
    if (this._lastHighlightPos) {
      const p = this._lastHighlightPos;
      ctx.clearRect(p.x - 20, p.staffY - 10, 40, p.systemHeight + 20);
    }
    
    // Draw new highlight
    if (this.cursorIndex >= 0 && this.cursorEl.style.display !== 'none') {
      this._highlightCursorNotes();
      // Cache position for next clear
      this._lastHighlightPos = this.beatPositions[this.cursorIndex];
    }
  }

  _drawCursor(ctx, c) {
    if (this.cursorIndex < 0) return;

    // When DOM cursor is active, only draw note highlights (no canvas cursor line)
    if (this.cursorEl.style.display !== 'none') {
      this._highlightCursorNotes();
      return;
    }

    // Fallback: discrete beat-based canvas cursor (when not playing)
    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;
    const system = this.systems.find(s => s.y === pos.y);
    if (!system) return;

    const top = system.y + TAB_CONSTANTS.marginTop - TAB_CONSTANTS.cursorOverhang;
    const bottom = system.y + system.height - TAB_CONSTANTS.marginBottom + TAB_CONSTANTS.cursorOverhang;

    // Subtle background highlight
    ctx.fillStyle = c.cursor;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(pos.x - 12, top, 24, bottom - top);

    // Cursor line
    ctx.strokeStyle = c.cursor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(pos.x, top);
    ctx.lineTo(pos.x, bottom);
    ctx.stroke();

    // Top/Bottom triangle markers
    ctx.fillStyle = c.cursor;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(pos.x - 6, top);
    ctx.lineTo(pos.x + 6, top);
    ctx.lineTo(pos.x, top + 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pos.x - 6, bottom);
    ctx.lineTo(pos.x + 6, bottom);
    ctx.lineTo(pos.x, bottom - 8);
    ctx.fill();

    ctx.globalAlpha = 1;
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

    ctx.save();
    ctx.shadowColor = c.bg;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    for (const note of event.notes) {
      if (note.tieDestination) continue;
      if (note.string < 0 || note.string >= stringCount) continue;

      const x = pos.x;
      const y = staffY + (stringCount - 1 - note.string) * TAB_CONSTANTS.lineSpacing;

      ctx.fillStyle = c.cursor;
      ctx.font = `bold ${TAB_CONSTANTS.fontSize + 1}px ${c.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (note.muted) ctx.fillText('X', x, y);
      else ctx.fillText(note.fret, x, y);
    }
    ctx.restore();
  }

  _drawLoopMarkers(ctx, c) {
    if (this.loopA !== null) this._drawLoopMarker(ctx, this.beatPositions[this.loopA], 'A', c.blue);
    if (this.loopB !== null) this._drawLoopMarker(ctx, this.beatPositions[this.loopB], 'B', c.red);
  }

  _drawLoopMarker(ctx, pos, label, color) {
    if (!pos) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = TAB_CONSTANTS.loopMarkerWidth;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y + TAB_CONSTANTS.marginTop - TAB_CONSTANTS.cursorOverhang);
    ctx.lineTo(pos.x, pos.y + pos.systemHeight - TAB_CONSTANTS.marginBottom + TAB_CONSTANTS.cursorOverhang);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${TAB_CONSTANTS.loopMarkerFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, pos.x, pos.y + pos.systemHeight + TAB_CONSTANTS.loopMarkerBottomOffset);
  }

  // --- Scrolling ---

  _scrollToCursor() {
    if (this.cursorIndex < 0) return;
    const pos = this.beatPositions[this.cursorIndex];
    if (!pos) return;

    const wrapHeight = this.wrap.clientHeight;
    const scrollY = this.wrap.scrollTop;
    if (pos.y < scrollY + TAB_CONSTANTS.scrollPaddingTop || pos.y > scrollY + wrapHeight - TAB_CONSTANTS.scrollPaddingBottom) {
      this.wrap.scrollTo({ top: Math.max(0, pos.y - TAB_CONSTANTS.scrollTargetOffset), behavior: 'smooth' });
    }
  }

  /**
   * Binary search to find the measure containing a given time.
   * O(log n) instead of O(n).
   */
  _findMeasureAtTime(time) {
    const measures = this.track.measures;
    if (!measures || measures.length === 0) return null;

    let lo = 0;
    let hi = measures.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const m = measures[mid];

      if (time < m.startTime - 0.001) {
        hi = mid - 1;
      } else if (time > m.endTime + 0.001) {
        lo = mid + 1;
      } else {
        // Found it
        return m;
      }
    }

    // Clamp to last measure if past end
    if (lo >= measures.length) {
      return measures[measures.length - 1];
    }

    return null;
  }
}
