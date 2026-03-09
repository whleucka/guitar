// Lightweight event bus using CustomEvent

const target = new EventTarget();

export const events = {
  on(name, handler) {
    const wrapper = (e) => handler(e.detail);
    target.addEventListener(name, wrapper);
    return () => target.removeEventListener(name, wrapper);
  },

  emit(name, detail) {
    target.dispatchEvent(new CustomEvent(name, { detail }));
  },
};

// Event names
export const NOTE_PLAY = 'note:play';
export const NOTE_HIGHLIGHT = 'note:highlight';
export const NOTE_CLEAR_HIGHLIGHT = 'note:clear-highlight';
export const SHOW_ALL_NOTES = 'ui:show-all-notes';
export const VOLUME_CHANGE = 'ui:volume-change';
export const SCALE_SELECT = 'scale:select';
export const SCALE_CLEAR = 'scale:clear';
export const CAGED_POSITION = 'scale:caged-position';
export const SCALE_PLAY = 'scale:play';
export const SCALE_NOTE_ON = 'scale:note-on';
export const SCALE_NOTE_OFF = 'scale:note-off';
export const CHORD_SELECT = 'chord:select';
export const CHORD_CLEAR = 'chord:clear';
export const CHORD_STRUM = 'chord:strum';
export const CHORD_NOTE_ON = 'chord:note-on';
export const CHORD_NOTE_OFF = 'chord:note-off';
export const METRONOME_TICK = 'metronome:tick';
export const TAB_LOADED = 'tab:loaded';
export const TAB_STOP = 'tab:stop';
export const TAB_BEAT_ON = 'tab:beat-on';
export const TAB_BEAT_OFF = 'tab:beat-off';
export const TAB_POSITION = 'tab:position';
