// Note highlight buttons, volume slider, show/hide toggle

import { NOTE_NAMES } from '../music/notes.js';
import { events, NOTE_HIGHLIGHT, NOTE_CLEAR_HIGHLIGHT, SHOW_ALL_NOTES, VOLUME_CHANGE } from '../events.js';
import { setMasterVolume } from '../audio/audio-engine.js';
import { AUDIO } from '../config.js';
import { setVoiceType, VOICE_TYPES } from '../audio/synth-voice.js';

export function renderControls(container) {
  // --- Note highlight buttons ---
  const noteGroup = document.createElement('div');
  noteGroup.className = 'control-group';
  noteGroup.innerHTML = '<h3>Highlight Notes</h3>';

  const btnWrap = document.createElement('div');
  btnWrap.className = 'note-buttons';

  const activeNotes = new Set();

  for (const name of NOTE_NAMES) {
    const btn = document.createElement('button');
    btn.className = 'note-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      if (activeNotes.has(name)) {
        activeNotes.delete(name);
        btn.classList.remove('active');
        events.emit(NOTE_CLEAR_HIGHLIGHT, { noteName: name });
      } else {
        activeNotes.add(name);
        btn.classList.add('active');
        events.emit(NOTE_HIGHLIGHT, { noteName: name });
      }
    });
    btnWrap.appendChild(btn);
  }

  noteGroup.appendChild(btnWrap);
  container.appendChild(noteGroup);

  // --- Volume + Show notes group ---
  const settingsGroup = document.createElement('div');
  settingsGroup.className = 'control-group';
  settingsGroup.innerHTML = '<h3>Settings</h3>';

  // Volume slider
  const volWrap = document.createElement('div');
  volWrap.className = 'volume-control';
  volWrap.innerHTML = `
    <label for="volume-slider">Volume</label>
    <input type="range" id="volume-slider" min="0" max="1" step="0.01" value="${AUDIO.masterGain}">
  `;
  const slider = volWrap.querySelector('input');
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    setMasterVolume(val);
    events.emit(VOLUME_CHANGE, { volume: val });
  });
  settingsGroup.appendChild(volWrap);

  // Show/hide all notes toggle
  const toggleWrap = document.createElement('div');
  toggleWrap.className = 'toggle-control';
  let showAll = false;
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'toggle-btn';
  toggleBtn.textContent = 'Show All Notes';
  toggleBtn.addEventListener('click', () => {
    showAll = !showAll;
    toggleBtn.classList.toggle('active', showAll);
    toggleBtn.textContent = showAll ? 'Hide All Notes' : 'Show All Notes';
    events.emit(SHOW_ALL_NOTES, { show: showAll });
  });
  toggleWrap.appendChild(toggleBtn);
  settingsGroup.appendChild(toggleWrap);

  container.appendChild(settingsGroup);
}
