// Receipt-themed replacements for browser-native confirm() and alert().
// Both return Promises so call sites can `await` them.

export function customConfirm(message, opts = {}) {
  const {
    title = 'Confirm',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
  } = opts;
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay dialog-overlay';
    overlay.innerHTML = `
      <div class="modal-card entry dialog-card" role="alertdialog" aria-modal="true">
        <h2 class="screen-title">${danger ? '⚠ ' : ''}${escapeHTML(title)}</h2>
        <div class="modal-scroll">
          <p class="dialog-message">${escapeHTML(message)}</p>
          <div class="actions">
            <button class="${danger ? 'btn-danger-solid' : 'primary'}" data-action="ok" type="button">
              ${escapeHTML(confirmLabel)}
            </button>
          </div>
          ${cancelLabel ? `
            <div class="entry-secondary">
              <button class="link-btn" data-action="cancel" type="button">${escapeHTML(cancelLabel)}</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close(false);
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'ok')     close(true);
      else if (action === 'cancel') close(false);
    });
    document.addEventListener('keydown', onKey);

    setTimeout(() => overlay.querySelector('[data-action="ok"]')?.focus(), 0);
  });
}

export function customAlert(message, opts = {}) {
  const { title = 'Heads up', confirmLabel = 'OK' } = opts;
  return customConfirm(message, { title, confirmLabel, cancelLabel: null });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
