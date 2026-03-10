// Tab viewer — orchestrates file loading, transport, mixer, and keyboard shortcuts

import { TabRenderer } from '../tab/tab-renderer.js';
import { TabPlayer } from '../tab/tab-player.js';
import { setVoiceType, VOICE_TYPES } from '../audio/synth-voice.js';
import { initFluidSynth, isFluidReady, isFluidLoading, assignChannels } from '../audio/fluid-synth.js';
import { events, TAB_LOADED, TAB_BEAT_ON, TAB_POSITION, TAB_STOP } from '../events.js';
import { VIEW_CHANGE } from './toolbar.js';
import { buildSelect, buildButton } from './dom-helpers.js';
import { createFileLoader } from './tab-file-loader.js';
import { createTransport } from './tab-transport.js';
import { createMixer } from './tab-mixer.js';

export function renderTabViewer(container) {
  const group = document.createElement('div');
  group.className = 'tab-viewer-group';

  // --- Core instances ---
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'tab-canvas-container';

  const renderer = new TabRenderer(canvasContainer);
  const player = new TabPlayer();

  // --- State ---
  let score = null;
  let allTrackData = [];
  let selectedTrackIndex = null;

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'control-group tab-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'tab-title-row';
  titleRow.innerHTML = '<h3 style="margin:0">Tab Viewer</h3>';

  const titleControls = document.createElement('div');
  titleControls.className = 'tab-title-controls';

  const expandToggle = buildButton('Expand View', 'tab-expand-toggle');

  // --- Mixer ---
  const mixer = createMixer({
    player,
    onTrackSelect: (trackIndex) => {
      player.stop();
      selectTrack(trackIndex);
    },
  });

  titleControls.appendChild(mixer.mixerToggle);
  titleControls.appendChild(expandToggle);
  titleRow.appendChild(titleControls);
  header.appendChild(titleRow);

  // --- Row 1: File + Track + Bars/Line + Voice ---
  const row1 = document.createElement('div');
  row1.className = 'tab-controls-row';

  const fileLoader = createFileLoader({
    onFileLoaded: handleFileLoaded,
  });

  const trackSelect = buildSelect({
    placeholder: 'Track',
    disabled: true,
  });

  const barsSelect = buildSelect({
    options: [3, 4, 5, 6].map(n => ({
      value: n,
      label: `${n} Bars/Line`,
      selected: n === 4,
    })),
  });
  barsSelect.title = 'Measures per line';

  const voiceSelect = buildSelect({
    options: [
      { value: VOICE_TYPES.KARPLUS, label: 'Default Synth' },
      { value: VOICE_TYPES.ACOUSTIC, label: 'Acoustic Guitar' },
      { value: VOICE_TYPES.ELECTRIC_CLEAN, label: 'Electric Clean' },
      { value: VOICE_TYPES.ELECTRIC_MUTED, label: 'Electric Muted' },
      { value: VOICE_TYPES.OVERDRIVEN, label: 'Overdriven' },
      { value: VOICE_TYPES.DISTORTION, label: 'Distortion' },
    ],
  });

  row1.appendChild(fileLoader.fileBtn);
  row1.appendChild(fileLoader.fileInput);
  row1.appendChild(trackSelect);
  row1.appendChild(barsSelect);
  row1.appendChild(voiceSelect);
  header.appendChild(row1);

  // --- Row 2: Transport ---
  const transport = createTransport({
    player,
    renderer,
    getTrackData: () => allTrackData.find(t => t.trackIndex === selectedTrackIndex),
  });

  const row2 = document.createElement('div');
  row2.className = 'tab-controls-row tab-controls-row-transport';
  row2.appendChild(transport.elements.playBtn);
  row2.appendChild(transport.elements.stopBtn);
  row2.appendChild(transport.elements.tempoWrap);
  row2.appendChild(transport.elements.loopWrap);
  row2.appendChild(transport.elements.metroBtn);
  header.appendChild(row2);

  // --- Row 3: Position + Song Info ---
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

  // --- Mixer panel ---
  header.appendChild(mixer.mixerWrap);

  // --- Assemble DOM ---
  group.appendChild(header);
  group.appendChild(canvasContainer);
  container.appendChild(group);

  // --- Event wiring ---

  barsSelect.addEventListener('change', () => {
    const n = parseInt(barsSelect.value);
    if (!isNaN(n)) renderer.setMeasuresPerLine(n);
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

  trackSelect.addEventListener('change', () => {
    const idx = parseInt(trackSelect.value);
    if (!isNaN(idx)) {
      player.stop();
      selectTrack(idx);
    }
  });

  expandToggle.addEventListener('click', () => {
    const isExpanded = document.body.classList.toggle('tabs-expanded');
    expandToggle.textContent = isExpanded ? 'Exit Expand' : 'Expand View';
    window.dispatchEvent(new Event('resize'));
  });

  events.on(VIEW_CHANGE, () => {
    document.body.classList.remove('tabs-expanded');
    expandToggle.textContent = 'Expand View';
  });

  renderer.onCanvasClick((index) => transport.actions.handleCanvasClick(index));

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', (e) => {
    if (!container.offsetParent) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        transport.actions.togglePlayPause();
        break;
      case 'ArrowRight':
        e.preventDefault();
        transport.actions.seekRelative(transport.SEEK_STEP);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        transport.actions.seekRelative(-transport.SEEK_STEP);
        break;
      case 'Escape':
        e.preventDefault();
        posDisplay.textContent = transport.actions.doStop();
        break;
    }
  });

  // --- Event bus: visual sync ---
  events.on(TAB_BEAT_ON, ({ index }) => {
    renderer.setCursor(index);
  });

  events.on(TAB_STOP, () => {
    renderer.clearCursor();
    transport.actions.onPlaybackStopped();
  });

  events.on(TAB_POSITION, ({ masterBarIndex, totalBars }) => {
    posDisplay.textContent = `Bar ${masterBarIndex + 1} / ${totalBars}`;
  });

  // --- Internal helpers ---

  function handleFileLoaded(loadedScore, loadedTrackData) {
    score = loadedScore;
    allTrackData = loadedTrackData;

    songInfo.textContent = `${score.title} \u2014 ${score.artist}`;

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
    transport.actions.enableControls();

    mixer.buildMixer(score, allTrackData, selectedTrackIndex, trackSelect);

    if (trackSelect.options.length > 0) {
      trackSelect.selectedIndex = 0;
      const firstTrackIdx = parseInt(trackSelect.value);
      initPlayer(firstTrackIdx);
      selectTrack(firstTrackIdx);
    }

    events.emit(TAB_LOADED, { score });

    // Initialize FluidSynth lazily on first file load
    _ensureFluidSynth();
  }

  async function _ensureFluidSynth() {
    if (isFluidReady() || isFluidLoading()) {
      // Already loaded or loading — just assign channels
      if (isFluidReady()) _assignFluidChannels();
      return;
    }

    songInfo.textContent += ' \u2014 Loading SoundFont...';

    try {
      await initFluidSynth((loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        songInfo.textContent = `${score.title} \u2014 ${score.artist} \u2014 SoundFont ${pct}%`;
      });
      songInfo.textContent = `${score.title} \u2014 ${score.artist}`;
      _assignFluidChannels();
    } catch (err) {
      console.warn('FluidSynth unavailable, using fallback synth:', err.message);
      songInfo.textContent = `${score.title} \u2014 ${score.artist}`;
    }
  }

  function _assignFluidChannels() {
    if (!isFluidReady() || !score || allTrackData.length === 0) return;
    assignChannels(allTrackData.map(td => ({
      trackIndex: td.trackIndex,
      isDrum: td.isDrum,
      midiProgram: score.tracks[td.trackIndex].midiProgram,
      midiBank: score.tracks[td.trackIndex].midiBank,
    })));
  }

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

  function selectTrack(trackIndex) {
    if (!score) return;
    selectedTrackIndex = trackIndex;

    const trackDataIdx = allTrackData.findIndex(t => t.trackIndex === trackIndex);
    if (trackDataIdx < 0) return;

    const trackData = allTrackData[trackDataIdx];
    posDisplay.textContent = `Bar 1 / ${trackData.measures.length}`;
    transport.actions.resetLoopState();

    player.setPrimary(trackDataIdx);
    updateRenderer();
    mixer.updateMixerUI(allTrackData, selectedTrackIndex);
  }

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
}
