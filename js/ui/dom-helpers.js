// Shared DOM construction helpers to reduce boilerplate across UI modules

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element with attributes.
 * @param {string} tag - SVG element name
 * @param {object} attrs - key/value attribute pairs
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

/**
 * Create an HTML element with optional class, attributes, and text.
 * @param {string} tag
 * @param {object} opts - { className, text, attrs, html }
 * @returns {HTMLElement}
 */
export function htmlEl(tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.text) el.textContent = opts.text;
  if (opts.html) el.innerHTML = opts.html;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      el.setAttribute(k, v);
    }
  }
  return el;
}

/**
 * Build a <select> dropdown populated with options.
 * @param {object} opts
 * @param {string} opts.className - CSS class for the select
 * @param {string} [opts.placeholder] - Placeholder first option text (value="")
 * @param {Array} opts.options - [{ value, label }] or built via opts.items
 * @param {boolean} [opts.disabled]
 * @returns {HTMLSelectElement}
 */
export function buildSelect({ className = 'scale-select', placeholder, options = [], disabled = false }) {
  const select = document.createElement('select');
  select.className = className;
  if (disabled) select.disabled = true;

  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    select.appendChild(opt);
  }

  for (const { value, label, selected } of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (selected) opt.selected = true;
    select.appendChild(opt);
  }

  return select;
}

/**
 * Build a root-note <select> from NOTE_NAMES / NOTE_DISPLAY arrays.
 * @param {string[]} noteNames - e.g. ['C', 'C#', ...]
 * @param {string[]} noteDisplay - e.g. ['C', 'C#/Db', ...]
 * @param {string} [placeholder='Root']
 * @returns {HTMLSelectElement}
 */
export function buildNoteSelect(noteNames, noteDisplay, placeholder = 'Root') {
  return buildSelect({
    placeholder,
    options: noteNames.map((name, i) => ({
      value: name,
      label: noteDisplay[i],
    })),
  });
}

/**
 * Build a button element.
 * @param {string} text
 * @param {string} [className='toggle-btn']
 * @param {object} [opts] - { title, disabled }
 * @returns {HTMLButtonElement}
 */
export function buildButton(text, className = 'toggle-btn', opts = {}) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = text;
  if (opts.title) btn.title = opts.title;
  if (opts.disabled) btn.disabled = true;
  return btn;
}

/**
 * Build a labeled range slider group.
 * @param {object} opts
 * @param {string} opts.className - wrapper class
 * @param {string} opts.label - label text
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {number} opts.value
 * @param {string} [opts.valueText] - initial display text for value span
 * @param {number} [opts.step]
 * @returns {{ wrap: HTMLElement, slider: HTMLInputElement, valueSpan: HTMLSpanElement }}
 */
export function buildSlider({ className, label, min, max, value, valueText, step }) {
  const wrap = document.createElement('div');
  wrap.className = className;

  const lbl = document.createElement('label');
  lbl.textContent = label;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.value = String(value);
  if (step !== undefined) slider.step = String(step);

  const valueSpan = document.createElement('span');
  valueSpan.className = 'bpm-value';
  valueSpan.textContent = valueText || String(value);

  wrap.appendChild(lbl);
  wrap.appendChild(slider);
  wrap.appendChild(valueSpan);

  return { wrap, slider, valueSpan };
}

export { SVG_NS };
