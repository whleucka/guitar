// Note highlight buttons, volume slider, show/hide toggle

import { NOTE_NAMES } from '../music/notes.js';
import { events, NOTE_HIGHLIGHT, NOTE_CLEAR_HIGHLIGHT, SHOW_ALL_NOTES, VOLUME_CHANGE, TUNING_CHANGE } from '../events.js';
import { setMasterVolume } from '../audio/audio-engine.js';
import { AUDIO, TUNING_PRESETS } from '../config.js';
import * as settings from '../settings.js';

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

  // Volume slider - load saved value
  const savedVolume = settings.get('volume');
  const volWrap = document.createElement('div');
  volWrap.className = 'volume-control';
  volWrap.innerHTML = `
    <label for="volume-slider">Volume</label>
    <input type="range" id="volume-slider" min="0" max="1" step="0.01" value="${savedVolume}">
  `;
  const slider = volWrap.querySelector('input');
  
  // Apply saved volume on load
  setMasterVolume(savedVolume);
  
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    setMasterVolume(val);
    settings.set('volume', val);
    events.emit(VOLUME_CHANGE, { volume: val });
  });
  settingsGroup.appendChild(volWrap);

  // Show/hide all notes toggle - do not persist
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

  // Tuning selector - load saved value
  const savedTuning = settings.get('tuning');
  const tuningWrap = document.createElement('div');
  tuningWrap.className = 'tuning-control';
  tuningWrap.innerHTML = `<label for="tuning-select">Tuning</label>`;
  
  const tuningSelect = document.createElement('select');
  tuningSelect.id = 'tuning-select';
  tuningSelect.className = 'tuning-select';
  
  // Add "From Tab" option (will be selected when tab loads)
  const fromTabOption = document.createElement('option');
  fromTabOption.value = 'from-tab';
  fromTabOption.textContent = 'From Tab (Standard E)';
  fromTabOption.disabled = true;
  tuningSelect.appendChild(fromTabOption);
  
  // Add preset tunings
  TUNING_PRESETS.forEach((preset, index) => {
    const option = document.createElement('option');
    option.value = index.toString();
    option.textContent = `${preset.name} (${preset.notes})`;
    tuningSelect.appendChild(option);
  });
  
  // Find saved tuning index or default to Standard E
  let initialTuningIndex = 0;
  if (savedTuning) {
    const savedStr = JSON.stringify(savedTuning);
    const idx = TUNING_PRESETS.findIndex(p => JSON.stringify(p.midi) === savedStr);
    if (idx >= 0) initialTuningIndex = idx;
  }
  tuningSelect.value = initialTuningIndex.toString();
  
  // Apply saved tuning on load (emit on next tick so fretboard is ready)
  if (savedTuning && initialTuningIndex >= 0) {
    setTimeout(() => {
      const preset = TUNING_PRESETS[initialTuningIndex];
      events.emit(TUNING_CHANGE, { 
        tuning: preset.midi, 
        name: preset.name,
        source: 'manual'
      });
    }, 0);
  }
  
  tuningSelect.addEventListener('change', () => {
    const selectedIndex = parseInt(tuningSelect.value);
    const preset = TUNING_PRESETS[selectedIndex];
    settings.set('tuning', preset.midi);
    events.emit(TUNING_CHANGE, { 
      tuning: preset.midi, 
      name: preset.name,
      source: 'manual'
    });
  });
  
  tuningWrap.appendChild(tuningSelect);
  settingsGroup.appendChild(tuningWrap);

  // Listen for tab tuning changes to update selector
  events.on(TUNING_CHANGE, ({ tuning, name, source }) => {
    if (source === 'tab') {
      fromTabOption.disabled = false;
      fromTabOption.textContent = `From Tab (${name || 'Custom'})`;
      tuningSelect.value = 'from-tab';
      settings.set('tuning', tuning);
    }
  });

  container.appendChild(settingsGroup);
}
