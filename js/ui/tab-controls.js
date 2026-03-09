// Tab viewer controls: file picker, track selector, transport, tempo, loop, solo

import { parseGPFile } from '../tab/gp-parser.js';
import { buildTimeline } from '../tab/timeline.js';
import { TabRenderer } from '../tab/tab-renderer.js';
import { TabPlayer } from '../tab/tab-player.js';
import { events, TAB_LOADED, TAB_BEAT_ON, TAB_BEAT_OFF, TAB_POSITION, TAB_STOP } from '../events.js';

export function renderTabViewer(container) {
  const group = document.createElement('div');
  group.className = 'tab-viewer-group';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'control-group tab-header';
  header.innerHTML = '<h3>Tab Viewer</h3>';

  // Controls row
  const row = document.createElement('div');
  row.className = 'tab-controls-row';

  // File picker
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.gp,.gp3,.gp4,.gp5,.gpx';
  fileInput.style.display = 'none';

  const fileBtn = document.createElement('button');
  fileBtn.className = 'toggle-btn';
  fileBtn.textContent = 'Open GP File';
  fileBtn.addEventListener('click', () => fileInput.click());

  // Track select
  const trackSelect = document.createElement('select');
  trackSelect.className = 'scale-select';
  trackSelect.innerHTML = '<option value="">Track</option>';
  trackSelect.disabled = true;

  // Solo toggle
  const soloBtn = document.createElement('button');
  soloBtn.className = 'toggle-btn';
  soloBtn.textContent = 'Solo';
  soloBtn.title = 'Solo selected track (mute others)';
  soloBtn.disabled = true;

  // Transport
  const playBtn = document.createElement('button');
  playBtn.className = 'toggle-btn';
  playBtn.textContent = '▶ Play';
  playBtn.disabled = true;

  const stopBtn = document.createElement('button');
  stopBtn.className = 'toggle-btn';
  stopBtn.textContent = '■ Stop';
  stopBtn.disabled = true;

  // Tempo control
  const tempoWrap = document.createElement('div');
  tempoWrap.className = 'bpm-control';
  const tempoLabel = document.createElement('label');
  tempoLabel.textContent = 'Speed';
  const tempoSlider = document.createElement('input');
  tempoSlider.type = 'range';
  tempoSlider.min = '25';
  tempoSlider.max = '150';
  tempoSlider.value = '100';
  const tempoValue = document.createElement('span');
  tempoValue.className = 'bpm-value';
  tempoValue.textContent = '100%';
  tempoWrap.appendChild(tempoLabel);
  tempoWrap.appendChild(tempoSlider);
  tempoWrap.appendChild(tempoValue);

  // Loop controls
  const loopABtn = document.createElement('button');
  loopABtn.className = 'caged-btn';
  loopABtn.textContent = 'A';
  loopABtn.title = 'Set loop start';
  loopABtn.disabled = true;

  const loopBBtn = document.createElement('button');
  loopBBtn.className = 'caged-btn';
  loopBBtn.textContent = 'B';
  loopBBtn.title = 'Set loop end';
  loopBBtn.disabled = true;

  const loopClearBtn = document.createElement('button');
  loopClearBtn.className = 'caged-btn';
  loopClearBtn.textContent = '✕';
  loopClearBtn.title = 'Clear loop';
  loopClearBtn.disabled = true;

  const loopWrap = document.createElement('div');
  loopWrap.className = 'tab-loop-controls';
  const loopLabel = document.createElement('span');
  loopLabel.className = 'caged-label';
  loopLabel.textContent = 'Loop:';
  loopWrap.appendChild(loopLabel);
  loopWrap.appendChild(loopABtn);
  loopWrap.appendChild(loopBBtn);
  loopWrap.appendChild(loopClearBtn);

  // Position display
  const posDisplay = document.createElement('span');
  posDisplay.className = 'tab-position';
  posDisplay.textContent = '';

  // Song info
  const songInfo = document.createElement('span');
  songInfo.className = 'tab-song-info';
  songInfo.textContent = '';

  row.appendChild(fileBtn);
  row.appendChild(fileInput);
  row.appendChild(trackSelect);
  row.appendChild(soloBtn);
  row.appendChild(playBtn);
  row.appendChild(stopBtn);
  row.appendChild(tempoWrap);
  row.appendChild(loopWrap);
  header.appendChild(row);

  // Info row
  const infoRow = document.createElement('div');
  infoRow.className = 'tab-info-row';
  infoRow.appendChild(songInfo);
  infoRow.appendChild(posDisplay);
  header.appendChild(infoRow);

  group.appendChild(header);

  // --- Tab canvas area ---
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'tab-canvas-container';
  group.appendChild(canvasContainer);

  container.appendChild(group);

  // --- State ---
  const renderer = new TabRenderer(canvasContainer);
  const player = new TabPlayer();
  let score = null;
  let allTrackData = []; // [{ trackIndex, timeline, measures }] for all non-drum tracks
  let selectedTrackIndex = null;
  let loopA = null;
  let loopB = null;
  let settingLoop = null; // 'a' or 'b' or null
  let isSolo = false;

  /**
   * Build timelines for all non-drum tracks and configure the player.
   */
  function buildAllTracks() {
    if (!score) return;
    allTrackData = [];
    score.tracks.forEach((t, i) => {
      if (t.isDrum) return;
      const { timeline, measures } = buildTimeline(score, i);
      allTrackData.push({ trackIndex: i, timeline, measures });
    });
  }

  /**
   * Configure the player with the selected primary track and all others as backing.
   */
  function configurePlayer() {
    if (!score || selectedTrackIndex === null) return;

    const primary = allTrackData.find(t => t.trackIndex === selectedTrackIndex);
    if (!primary) return;

    const backing = allTrackData
      .filter(t => t.trackIndex !== selectedTrackIndex)
      .map(t => ({ timeline: t.timeline, measures: t.measures }));

    player.setTracks(
      { timeline: primary.timeline, measures: primary.measures },
      backing,
    );
    player.setSoloTrack(isSolo);
  }

  /**
   * Select a track for visual display and set it as the primary player track.
   */
  function selectTrack(trackIndex) {
    if (!score) return;
    selectedTrackIndex = trackIndex;

    const trackData = allTrackData.find(t => t.trackIndex === trackIndex);
    if (!trackData) return;

    const track = score.tracks[trackIndex];
    renderer.setData(trackData.timeline, trackData.measures, track.stringCount);
    posDisplay.textContent = `Bar 1 / ${trackData.measures.length}`;
    loopA = null;
    loopB = null;
    settingLoop = null;

    configurePlayer();
  }

  // --- File loading ---
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileBtn.textContent = 'Loading...';
    try {
      const buf = await file.arrayBuffer();
      score = await parseGPFile(buf);

      songInfo.textContent = `${score.title} — ${score.artist}`;

      // Build timelines for all tracks
      buildAllTracks();

      // Populate track selector (filter out drums)
      trackSelect.innerHTML = '';
      score.tracks.forEach((t, i) => {
        if (t.isDrum) return;
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = t.name;
        trackSelect.appendChild(opt);
      });

      trackSelect.disabled = false;
      playBtn.disabled = false;
      stopBtn.disabled = false;
      soloBtn.disabled = false;
      loopABtn.disabled = false;
      loopBBtn.disabled = false;
      loopClearBtn.disabled = false;

      // Auto-select first non-drum track
      if (trackSelect.options.length > 0) {
        trackSelect.selectedIndex = 0;
        selectTrack(parseInt(trackSelect.value));
      }

      fileBtn.textContent = 'Open GP File';
      events.emit(TAB_LOADED, { score });
    } catch (err) {
      console.error('GP parse error:', err);
      fileBtn.textContent = 'Error — Try Again';
      setTimeout(() => { fileBtn.textContent = 'Open GP File'; }, 2000);
    }
  });

  // --- Track selection ---
  trackSelect.addEventListener('change', () => {
    const idx = parseInt(trackSelect.value);
    if (!isNaN(idx)) {
      player.stop();
      selectTrack(idx);
    }
  });

  // --- Solo toggle ---
  soloBtn.addEventListener('click', () => {
    isSolo = !isSolo;
    soloBtn.classList.toggle('active', isSolo);
    player.setSoloTrack(isSolo);
  });

  // --- Transport ---
  playBtn.addEventListener('click', () => {
    const trackData = allTrackData.find(t => t.trackIndex === selectedTrackIndex);
    if (!trackData || trackData.timeline.length === 0) return;

    if (player.state === 'playing') {
      player.pause();
      playBtn.textContent = '▶ Play';
    } else if (player.state === 'paused') {
      player.resume();
      playBtn.textContent = '⏸ Pause';
    } else {
      player.play(0);
      playBtn.textContent = '⏸ Pause';
    }
  });

  stopBtn.addEventListener('click', () => {
    player.stop();
    playBtn.textContent = '▶ Play';
    renderer.clearCursor();
    const trackData = allTrackData.find(t => t.trackIndex === selectedTrackIndex);
    posDisplay.textContent = trackData
      ? `Bar 1 / ${trackData.measures.length}`
      : '';
  });

  // --- Tempo ---
  tempoSlider.addEventListener('input', () => {
    const pct = parseInt(tempoSlider.value);
    tempoValue.textContent = pct + '%';
    player.setTempoScale(pct / 100);
  });

  // --- Loop ---
  loopABtn.addEventListener('click', () => {
    settingLoop = 'a';
    loopABtn.classList.add('active');
    loopBBtn.classList.remove('active');
  });

  loopBBtn.addEventListener('click', () => {
    settingLoop = 'b';
    loopBBtn.classList.add('active');
    loopABtn.classList.remove('active');
  });

  loopClearBtn.addEventListener('click', () => {
    loopA = null;
    loopB = null;
    settingLoop = null;
    loopABtn.classList.remove('active');
    loopBBtn.classList.remove('active');
    player.setLoop(null, null);
    renderer.setLoop(null, null);
  });

  renderer.onCanvasClick((index) => {
    if (settingLoop === 'a') {
      loopA = index;
      loopABtn.classList.remove('active');
      settingLoop = null;
      if (loopB !== null) {
        player.setLoop(loopA, loopB);
        renderer.setLoop(loopA, loopB);
      }
    } else if (settingLoop === 'b') {
      loopB = index;
      loopBBtn.classList.remove('active');
      settingLoop = null;
      if (loopA !== null) {
        player.setLoop(loopA, loopB);
        renderer.setLoop(loopA, loopB);
      }
    } else if (player.state !== 'playing') {
      // Click to seek
      player.seekTo(index);
      renderer.setCursor(index);
    }
  });

  // --- Event listeners for visual sync ---
  events.on(TAB_BEAT_ON, ({ index }) => {
    renderer.setCursor(index);
  });

  events.on(TAB_STOP, () => {
    renderer.clearCursor();
    playBtn.textContent = '▶ Play';
  });

  events.on(TAB_POSITION, ({ masterBarIndex, totalBars }) => {
    posDisplay.textContent = `Bar ${masterBarIndex + 1} / ${totalBars}`;
  });
}
