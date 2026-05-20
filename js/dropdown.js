// Custom dropdown that matches the receipt aesthetic. No native <select> —
// the OS popup looks nothing like the rest of the app. This builds a button
// + popup menu styled in monospace with dashed borders.
//
// Usage:
//   import { mountDropdown } from './dropdown.js';
//   mountDropdown(containerEl, {
//     options: [{ value: 'spread', label: 'Biggest spread' }, ...],
//     value: 'spread',
//     onChange: (newValue) => { ... },
//   });

export function mountDropdown(container, { options, value, onChange }) {
  const current = options.find(o => o.value === value) || options[0];

  container.classList.add('dd-host');
  container.innerHTML = `
    <button class="dd-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span class="dd-current">${escapeHTML(current.label)}</span>
      <span class="dd-chevron" aria-hidden="true">▾</span>
    </button>
    <ul class="dd-menu" role="listbox" hidden>
      ${options.map(o => `
        <li class="dd-option ${o.value === current.value ? 'is-selected' : ''}"
            role="option" data-value="${escapeHTML(o.value)}"
            aria-selected="${o.value === current.value}">
          ${escapeHTML(o.label)}
        </li>
      `).join('')}
    </ul>
  `;

  const trigger = container.querySelector('.dd-trigger');
  const menu = container.querySelector('.dd-menu');
  const currentLabel = container.querySelector('.dd-current');

  function open() {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    container.classList.add('is-open');
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
    document.addEventListener('keydown', escClose);
  }
  function close() {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    container.classList.remove('is-open');
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', escClose);
  }
  function outside(e) { if (!container.contains(e.target)) close(); }
  function escClose(e) { if (e.key === 'Escape') close(); }

  trigger.addEventListener('click', () => {
    menu.hidden ? open() : close();
  });

  menu.addEventListener('click', (e) => {
    const li = e.target.closest('li.dd-option');
    if (!li) return;
    const newValue = li.dataset.value;
    const newOpt = options.find(o => o.value === newValue);
    if (!newOpt) return;
    currentLabel.textContent = newOpt.label;
    container.querySelectorAll('.dd-option').forEach(el => {
      const sel = el === li;
      el.classList.toggle('is-selected', sel);
      el.setAttribute('aria-selected', sel);
    });
    close();
    onChange(newValue);
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
