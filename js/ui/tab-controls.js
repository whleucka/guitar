// Tab viewer controls: file picker, track selector, transport, tempo, loop, mixer

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

  // Track select (controls which track is displayed on tab + fretboard)
  const trackSelect = document.createElement('select');
  trackSelect.className = 'scale-select';
  trackSelect.innerHTML = '<option value="">Track</option>';
  trackSelect.disabled = true;

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

  // --- Track mixer (built dynamically on file load) ---
  const mixerWrap = document.createElement('div');
  mixerWrap.className = 'tab-mixer';
  header.appendChild(mixerWrap);

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
  let allTrackData = []; // [{ trackIndex, timeline, measures, isDrum }]
  let selectedTrackIndex = null;
  let loopA = null;
  let loopB = null;
  let settingLoop = null;

  /**
   * Build timelines for all tracks.
   */
  function buildAllTracks() {
    if (!score) return;
    allTrackData = [];
    score.tracks.forEach((t, i) => {
      const { timeline, measures } = buildTimeline(score, i);
      if (timeline.length === 0) return;
      allTrackData.push({
        trackIndex: i,
        timeline,
        measures,
        isDrum: t.isDrum,
        tuning: t.tuning,
      });
    });
  }

  /**
   * Initialize the player with all tracks (called once on file load).
   */
  function initPlayer(primaryTrackIndex) {
    const primaryIdx = allTrackData.findIndex(t => t.trackIndex === primaryTrackIndex);
    if (primaryIdx < 0) return;

    player.setTracks(
      allTrackData.map(t => ({
        timeline: t.timeline,
        measures: t.measures,
        isDrum: t.isDrum,
        tuning: t.tuning,
      })),
      primaryIdx,
    );
  }

  /**
   * Select a track for visual display and set it as primary.
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

    // Update which track is primary in the player (preserves mute states)
    const primaryIdx = allTrackData.findIndex(t => t.trackIndex === trackIndex);
    if (primaryIdx >= 0) {
      player.setPrimary(primaryIdx);
    }

    updateMixerSelection();
  }

  /**
   * Build the track mixer UI.
   */
  function buildMixer() {
    mixerWrap.innerHTML = '';
    if (!score || allTrackData.length === 0) return;

    for (let i = 0; i < allTrackData.length; i++) {
      const td = allTrackData[i];
      const track = score.tracks[td.trackIndex];

      const item = document.createElement('label');
      item.className = 'tab-mixer-track';
      item.dataset.playerIndex = i;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', () => {
        player.setTrackMuted(i, !cb.checked);
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-mixer-name';
      nameSpan.textContent = track.name + (td.isDrum ? ' [drums]' : '');

      item.appendChild(cb);
      item.appendChild(nameSpan);

      // Click on the name to select as primary (only non-drum)
      if (!td.isDrum) {
        nameSpan.addEventListener('click', (e) => {
          e.preventDefault();
          trackSelect.value = td.trackIndex;
          player.stop();
          selectTrack(td.trackIndex);
        });
        nameSpan.style.cursor = 'pointer';
      }

      mixerWrap.appendChild(item);
    }

    updateMixerSelection();
  }

  function updateMixerSelection() {
    const items = mixerWrap.querySelectorAll('.tab-mixer-track');
    items.forEach(item => {
      const idx = parseInt(item.dataset.playerIndex);
      const td = allTrackData[idx];
      item.classList.toggle('selected', td && td.trackIndex === selectedTrackIndex);
    });
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

      // Populate track selector (filter out drums — drums can't display as tab)
      trackSelect.innerHTML = '';
      score.tracks.forEach((t, i) => {
        if (t.isDrum) return;
        // Only add if we have timeline data
        if (!allTrackData.find(td => td.trackIndex === i)) return;
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = t.name;
        trackSelect.appendChild(opt);
      });

      trackSelect.disabled = false;
      playBtn.disabled = false;
      stopBtn.disabled = false;
      loopABtn.disabled = false;
      loopBBtn.disabled = false;
      loopClearBtn.disabled = false;

      // Build mixer
      buildMixer();

      // Auto-select first non-drum track and initialize player with all tracks
      if (trackSelect.options.length > 0) {
        trackSelect.selectedIndex = 0;
        const firstTrackIdx = parseInt(trackSelect.value);
        initPlayer(firstTrackIdx);
        selectTrack(firstTrackIdx);
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
