// Tab transport controls: play/pause/stop, tempo, loop, metronome

import { buildButton, buildSlider } from './dom-helpers.js';

const SEEK_STEP = 5; // beats to skip on arrow key press

/**
 * Create transport control elements and wire up their logic.
 * @param {object} deps - { player, renderer, getTrackData }
 * @returns {object} - { elements, state, actions }
 */
export function createTransport(deps) {
  const { player, renderer, getTrackData } = deps;

  // --- Play / Stop buttons ---
  const playBtn = buildButton('\u25B6 Play', 'toggle-btn', { disabled: true });
  const stopBtn = buildButton('\u25A0 Stop', 'toggle-btn', { disabled: true });

  // --- Tempo slider ---
  const { wrap: tempoWrap, slider: tempoSlider, valueSpan: tempoValue } = buildSlider({
    className: 'bpm-control',
    label: 'Speed',
    min: 25,
    max: 150,
    value: 100,
    valueText: '100%',
  });

  // --- Loop controls ---
  const loopABtn = buildButton('A', 'caged-btn', { title: 'Set loop start', disabled: true });
  const loopBBtn = buildButton('B', 'caged-btn', { title: 'Set loop end', disabled: true });
  const loopClearBtn = buildButton('\u2715', 'caged-btn', { title: 'Clear loop', disabled: true });

  const loopWrap = document.createElement('div');
  loopWrap.className = 'tab-loop-controls';
  const loopLabel = document.createElement('span');
  loopLabel.className = 'caged-label';
  loopLabel.textContent = 'Loop:';
  loopWrap.appendChild(loopLabel);
  loopWrap.appendChild(loopABtn);
  loopWrap.appendChild(loopBBtn);
  loopWrap.appendChild(loopClearBtn);

  // --- Metronome toggle ---
  const metroBtn = buildButton('\u23F1', 'caged-btn', { title: 'Toggle Metronome', disabled: true });

  // --- State ---
  let loopA = null;
  let loopB = null;
  let settingLoop = null;

  // --- Actions ---

  function togglePlayPause() {
    const trackData = getTrackData();
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
    const trackData = getTrackData();
    return trackData ? `Bar 1 / ${trackData.measures.length}` : '';
  }

  function seekRelative(delta) {
    if (!player.timeline || player.timeline.length === 0) return;
    const newIndex = Math.max(0, Math.min(player.currentIndex + delta, player.timeline.length - 1));
    player.seekTo(newIndex);
    renderer.setCursor(newIndex);
  }

  function clearLoop() {
    loopA = null;
    loopB = null;
    settingLoop = null;
    loopABtn.classList.remove('active');
    loopBBtn.classList.remove('active');
    player.setLoop(null, null);
    renderer.setLoop(null, null);
  }

  function handleCanvasClick(index) {
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
  }

  function resetLoopState() {
    loopA = null;
    loopB = null;
    settingLoop = null;
  }

  function enableControls() {
    playBtn.disabled = false;
    stopBtn.disabled = false;
    loopABtn.disabled = false;
    loopBBtn.disabled = false;
    loopClearBtn.disabled = false;
    metroBtn.disabled = false;
  }

  function onPlaybackStopped() {
    playBtn.textContent = '\u25B6 Play';
  }

  // --- Wire up event listeners ---

  playBtn.addEventListener('click', togglePlayPause);
  stopBtn.addEventListener('click', () => doStop());

  tempoSlider.addEventListener('input', () => {
    const pct = parseInt(tempoSlider.value);
    tempoValue.textContent = pct + '%';
    player.setTempoScale(pct / 100);
  });

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

  loopClearBtn.addEventListener('click', clearLoop);

  metroBtn.addEventListener('click', () => {
    const enabled = !player.metronomeEnabled;
    player.setMetronomeEnabled(enabled);
    metroBtn.classList.toggle('active', enabled);
  });

  return {
    elements: { playBtn, stopBtn, tempoWrap, loopWrap, metroBtn },
    actions: {
      togglePlayPause,
      doStop,
      seekRelative,
      handleCanvasClick,
      resetLoopState,
      enableControls,
      onPlaybackStopped,
    },
    SEEK_STEP,
  };
}
