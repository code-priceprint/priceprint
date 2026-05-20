// Lightweight edit modal. Opens an overlay with a small form and Save/Cancel/Delete.
// Receipt-themed to match the rest of the app.
import { customConfirm, customAlert } from './dialog.js';

export function openEditModal({ title, body, fields, onSave, onDelete, topAction, deleteMessage, deleteLabel }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card entry" role="dialog" aria-modal="true">
      <h2 class="screen-title">${escapeHTML(title)}</h2>
      <div class="modal-scroll">
        ${topAction ? `
          <button class="modal-top-action" data-action="top" type="button">
            ${escapeHTML(topAction.label)}
          </button>
        ` : ''}
        ${body ? `<div class="modal-body">${body}</div>` : ''}
        ${fields.map(f => `
          <label class="field">
            <span class="lbl">${escapeHTML(f.label)}</span>
            <input
              type="${f.type || 'text'}"
              name="${f.name}"
              ${f.step ? `step="${f.step}"` : ''}
              ${f.min !== undefined ? `min="${f.min}"` : ''}
              value="${escapeHTML(String(f.value == null ? '' : f.value))}"
            />
          </label>
        `).join('')}
        <div class="actions">
          <button class="primary" data-action="save" type="button">Save changes</button>
        </div>
        <div class="entry-secondary">
          <button class="link-btn" data-action="cancel" type="button">Cancel</button>
        </div>
        ${onDelete ? `
          <div class="modal-danger">
            <button class="btn-danger" data-action="delete" type="button">⚠ ${escapeHTML(deleteLabel || 'Delete this — cannot be undone')}</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const card = overlay.querySelector('.modal-card');
  const inputs = overlay.querySelectorAll('input');

  function close() { overlay.remove(); }
  function values() {
    const out = {};
    inputs.forEach(i => { out[i.name] = i.value; });
    return out;
  }

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) return close(); // backdrop click
    const action = e.target.dataset.action;
    if (action === 'cancel') return close();
    if (action === 'top' && topAction) {
      close();
      topAction.onClick();
      return;
    }
    if (action === 'save') {
      try { await onSave(values()); close(); }
      catch (err) { await customAlert(err.message || String(err), { title: 'Could not save' }); }
    } else if (action === 'delete' && onDelete) {
      const ok = await customConfirm(deleteMessage || 'Delete this? This cannot be undone.', {
        title: 'Delete',
        confirmLabel: 'Yes, delete',
        cancelLabel: 'Keep it',
        danger: true,
      });
      if (!ok) return;
      try { await onDelete(); close(); }
      catch (err) { await customAlert(err.message || String(err), { title: 'Could not delete' }); }
    }
  });

  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  // focus first input
  setTimeout(() => inputs[0] && inputs[0].focus(), 0);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
