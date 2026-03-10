// Tab viewer controls: file picker, track selector, transport, tempo, loop, mixer

import { parseGPFile } from '../tab/gp-parser.js';
import { buildTimeline } from '../tab/timeline.js';
import { TabRenderer } from '../tab/tab-renderer.js';
import { TabPlayer } from '../tab/tab-player.js';
import { setVoiceType, VOICE_TYPES } from '../audio/synth-voice.js';
import { events, TAB_LOADED, TAB_BEAT_ON, TAB_POSITION, TAB_STOP } from '../events.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ACCEPTED_EXTENSIONS = ['.gp'];
const SEEK_STEP = 5; // beats to skip on arrow key press

export function renderTabViewer(container) {
  const group = document.createElement('div');
  group.className = 'tab-viewer-group';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'control-group tab-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'tab-title-row';
  titleRow.innerHTML = '<h3 style="margin:0">Tab Viewer</h3>';

  const mixerToggle = document.createElement('button');
  mixerToggle.className = 'icon-btn tab-mixer-toggle';
  mixerToggle.innerHTML = 'Tracks &#9660;';
  titleRow.appendChild(mixerToggle);
  header.appendChild(titleRow);

  // Row 1: File + Track + Voice + Bars/Line
  const row1 = document.createElement('div');
  row1.className = 'tab-controls-row';

  // File picker
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.gp';
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

  // Bars per line select
  const barsSelect = document.createElement('select');
  barsSelect.className = 'scale-select';
  barsSelect.title = 'Measures per line';
  [3, 4, 5, 6].forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = `${n} Bars/Line`;
    if (n === 4) opt.selected = true;
    barsSelect.appendChild(opt);
  });

  // Voice/Instrument Selector
  const voiceSelect = document.createElement('select');
  voiceSelect.className = 'scale-select';

  const voiceOptions = [
    { value: VOICE_TYPES.KARPLUS, label: 'Default Synth' },
    { value: VOICE_TYPES.ACOUSTIC, label: 'Acoustic Guitar' },
    { value: VOICE_TYPES.ELECTRIC_CLEAN, label: 'Electric Clean' },
    { value: VOICE_TYPES.ELECTRIC_MUTED, label: 'Electric Muted' },
    { value: VOICE_TYPES.OVERDRIVEN, label: 'Overdriven' },
    { value: VOICE_TYPES.DISTORTION, label: 'Distortion' },
  ];

  voiceOptions.forEach(opt => {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    voiceSelect.appendChild(el);
  });

  voiceSelect.addEventListener('change', async () => {
    voiceSelect.disabled = true;
    const selectedOption = voiceSelect.options[voiceSelect.selectedIndex];
    const oldLabel = selectedOption.textContent;
    selectedOption.textContent = 'Loading...';
    await setVoiceType(voiceSelect.value);
    selectedOption.textContent = oldLabel;
    voiceSelect.disabled = false;
  });

  row1.appendChild(fileBtn);
  row1.appendChild(fileInput);
  row1.appendChild(trackSelect);
  row1.appendChild(barsSelect);
  row1.appendChild(voiceSelect);
  header.appendChild(row1);

  barsSelect.addEventListener('change', () => {
    const n = parseInt(barsSelect.value);
    if (!isNaN(n)) {
      renderer.setMeasuresPerLine(n);
    }
  });

  // Row 2: Transport + Tempo + Loop + Metronome
  const row2 = document.createElement('div');
  row2.className = 'tab-controls-row tab-controls-row-transport';

  // Transport
  const playBtn = document.createElement('button');
  playBtn.className = 'toggle-btn';
  playBtn.textContent = '\u25B6 Play';
  playBtn.disabled = true;

  const stopBtn = document.createElement('button');
  stopBtn.className = 'toggle-btn';
  stopBtn.textContent = '\u25A0 Stop';
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
  loopClearBtn.textContent = '\u2715';
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

  // Metronome toggle
  const metroBtn = document.createElement('button');
  metroBtn.className = 'caged-btn';
  metroBtn.textContent = '\u23F1';
  metroBtn.title = 'Toggle Metronome';
  metroBtn.disabled = true;

  row2.appendChild(playBtn);
  row2.appendChild(stopBtn);
  row2.appendChild(tempoWrap);
  row2.appendChild(loopWrap);
  row2.appendChild(metroBtn);
  header.appendChild(row2);

  // Row 3: Position display
  const posDisplay = document.createElement('span');
  posDisplay.className = 'tab-position';
  posDisplay.textContent = '';

  const songInfo = document.createElement('span');
  songInfo.className = 'tab-song-info';
  songInfo.textContent = '';

  const infoRow = document.createElement('div');
  infoRow.className = 'tab-info-row';
  infoRow.appendChild(songInfo);
  infoRow.appendChild(posDisplay);
  header.appendChild(infoRow);

  // --- Track mixer (built dynamically on file load) ---
  const mixerWrap = document.createElement('div');
  mixerWrap.className = 'tab-mixer hidden';
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
  let allTrackData = [];
  let selectedTrackIndex = null;
  let loopA = null;
  let loopB = null;
  let settingLoop = null;

  mixerToggle.addEventListener('click', () => {
    const isHidden = mixerWrap.classList.toggle('hidden');
    mixerToggle.innerHTML = isHidden ? 'Tracks &#9660;' : 'Tracks &#9650;';
  });

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
   * Initialize the player with all tracks.
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
   * Update the renderer with the currently selected track.
   */
  function updateRenderer() {
    if (!score || selectedTrackIndex === null) return;

    const td = allTrackData.find(t => t.trackIndex === selectedTrackIndex);
    if (!td) return;

    const track = score.tracks[td.trackIndex];
    renderer.setData({
      timeline: td.timeline,
      measures: td.measures,
      stringCount: track.stringCount,
      name: track.name,
    });
  }

  /**
   * Select a track for visual display and set it as primary.
   */
  function selectTrack(trackIndex) {
    if (!score) return;
    selectedTrackIndex = trackIndex;

    const trackDataIdx = allTrackData.findIndex(t => t.trackIndex === trackIndex);
    if (trackDataIdx < 0) return;

    const trackData = allTrackData[trackDataIdx];
    posDisplay.textContent = `Bar 1 / ${trackData.measures.length}`;
    loopA = null;
    loopB = null;
    settingLoop = null;

    player.setPrimary(trackDataIdx);
    updateRenderer();
    updateMixerUI();
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

      const item = document.createElement('div');
      item.className = 'tab-mixer-track';
      item.dataset.playerIndex = i;

      const audioCb = document.createElement('input');
      audioCb.type = 'checkbox';
      audioCb.checked = true;
      audioCb.title = 'Mute/Unmute audio';
      audioCb.addEventListener('change', () => {
        player.setTrackMuted(i, !audioCb.checked);
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-mixer-name';
      nameSpan.textContent = track.name + (td.isDrum ? ' [drums]' : '');

      item.appendChild(audioCb);
      item.appendChild(nameSpan);

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

    updateMixerUI();
  }

  function updateMixerUI() {
    const items = mixerWrap.querySelectorAll('.tab-mixer-track');
    items.forEach(item => {
      const idx = parseInt(item.dataset.playerIndex);
      const td = allTrackData[idx];
      item.classList.toggle('selected', td && td.trackIndex === selectedTrackIndex);
    });
  }

  // --- Helpers ---

  function togglePlayPause() {
    const trackData = allTrackData.find(t => t.trackIndex === selectedTrackIndex);
    if (!trackData || trackData.timeline.length === 0) return;

    if (player.state === 'playing') {
      player.pause();
      playBtn.textContent = '\u25B6 Play';
    } else if (player.state === 'paused') {
      player.resume();
      playBtn.textContent = '\u23F8 Pause';
    } else {
      player.play(player.currentIndex);
      playBtn.textContent = '\u23F8 Pause';
    }
  }

  function doStop() {
    player.stop();
    playBtn.textContent = '\u25B6 Play';
    renderer.clearCursor();
    const trackData = allTrackData.find(t => t.trackIndex === selectedTrackIndex);
    posDisplay.textContent = trackData
      ? `Bar 1 / ${trackData.measures.length}`
      : '';
  }

  function seekRelative(delta) {
    if (!player.timeline || player.timeline.length === 0) return;
    const newIndex = Math.max(0, Math.min(player.currentIndex + delta, player.timeline.length - 1));
    player.seekTo(newIndex);
    renderer.setCursor(newIndex);
  }

  /**
   * Validate a file before parsing.
   */
  function validateFile(file) {
    if (file.size > MAX_FILE_SIZE) {
      return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`;
    }
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `Unsupported format "${ext}". Only modern Guitar Pro (.gp) files are supported.`;
    }
    return null;
  }

  // --- File loading ---
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate
    const validationError = validateFile(file);
    if (validationError) {
      fileBtn.textContent = validationError;
      setTimeout(() => { fileBtn.textContent = 'Open GP File'; }, 3000);
      return;
    }

    fileBtn.textContent = 'Loading...';
    try {
      const buf = await file.arrayBuffer();
      score = await parseGPFile(buf);

      songInfo.textContent = `${score.title} \u2014 ${score.artist}`;

      buildAllTracks();

      // Populate track selector (filter out drums)
      trackSelect.innerHTML = '';
      score.tracks.forEach((t, i) => {
        if (t.isDrum) return;
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
      metroBtn.disabled = false;

      buildMixer();

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
      // Show the actual error message for better debugging
      const msg = err.message || 'Unknown parsing error';
      fileBtn.textContent = msg;
      setTimeout(() => { fileBtn.textContent = 'Open GP File'; }, 5000);
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
  playBtn.addEventListener('click', togglePlayPause);
  stopBtn.addEventListener('click', doStop);

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

  // --- Metronome ---
  metroBtn.addEventListener('click', () => {
    const enabled = !player.metronomeEnabled;
    player.setMetronomeEnabled(enabled);
    metroBtn.classList.toggle('active', enabled);
  });

  // --- Canvas click ---
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

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', (e) => {
    // Only handle shortcuts when tab viewer is visible
    if (!container.offsetParent) return;

    // Don't intercept when typing in inputs
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekRelative(SEEK_STEP);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekRelative(-SEEK_STEP);
        break;
      case 'Escape':
        e.preventDefault();
        doStop();
        break;
    }
  });

  // --- Event listeners for visual sync ---
  events.on(TAB_BEAT_ON, ({ index }) => {
    renderer.setCursor(index);
  });

  events.on(TAB_STOP, () => {
    renderer.clearCursor();
    playBtn.textContent = '\u25B6 Play';
  });

  events.on(TAB_POSITION, ({ masterBarIndex, totalBars }) => {
    posDisplay.textContent = `Bar ${masterBarIndex + 1} / ${totalBars}`;
  });
}
