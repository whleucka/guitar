// Tab mixer: per-track mute/unmute, track selection display

import { buildButton } from './dom-helpers.js';

/**
 * Create the mixer panel and return its elements + update functions.
 * @param {object} deps - { player, onTrackSelect(trackIndex) }
 * @returns {object} - { mixerWrap, mixerToggle, buildMixer, updateMixerUI }
 */
export function createMixer(deps) {
  const { player, onTrackSelect } = deps;

  const mixerToggle = buildButton('Tracks \u25BC', 'tab-mixer-toggle');

  const mixerWrap = document.createElement('div');
  mixerWrap.className = 'tab-mixer hidden';

  mixerToggle.addEventListener('click', () => {
    const isHidden = mixerWrap.classList.toggle('hidden');
    mixerToggle.innerHTML = isHidden ? 'Tracks &#9660;' : 'Tracks &#9650;';
  });

  /**
   * Rebuild the mixer UI for the current set of tracks.
   * @param {object} score - parsed GP score
   * @param {Array} allTrackData
   * @param {number} selectedTrackIndex
   * @param {HTMLSelectElement} trackSelect - to sync when clicking mixer names
   */
  function buildMixer(score, allTrackData, selectedTrackIndex, trackSelect) {
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
          onTrackSelect(td.trackIndex);
        });
        nameSpan.style.cursor = 'pointer';
      }

      mixerWrap.appendChild(item);
    }

    updateMixerUI(allTrackData, selectedTrackIndex);
  }

  /**
   * Update the visual selection state in the mixer.
   * @param {Array} allTrackData
   * @param {number} selectedTrackIndex
   */
  function updateMixerUI(allTrackData, selectedTrackIndex) {
    const items = mixerWrap.querySelectorAll('.tab-mixer-track');
    items.forEach(item => {
      const idx = parseInt(item.dataset.playerIndex);
      const td = allTrackData[idx];
      item.classList.toggle('selected', td && td.trackIndex === selectedTrackIndex);
    });
  }

  return { mixerWrap, mixerToggle, buildMixer, updateMixerUI };
}
