// First-visit GDPR consent banner. Pairs with the Consent Mode v2 defaults
// set in every page's gtag <script> block — that block denies all storage
// categories by default and re-grants them on page load if the user has
// previously consented. This file shows the banner only when there is no
// stored decision, then writes the decision to localStorage and calls
// gtag('consent', 'update', ...) so analytics fires from this page forward.
//
// Plain (non-module) script so it can ship via a single <script src> tag on
// every page without needing type="module" or import/export plumbing.

(function () {
  const KEY = 'priceprint.consent';
  const GRANT = {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  };
  const DENY = {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  };

  function readDecision() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function writeDecision(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }
  function tellGtag(state) {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', state);
    }
  }

  function showBanner() {
    if (document.getElementById('consent-banner')) return;
    const el = document.createElement('div');
    el.id = 'consent-banner';
    el.className = 'consent-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'cookie consent');
    el.innerHTML = `
      <div class="consent-banner-inner">
        <div class="consent-banner-text">
          Google Analytics counts page visits. That's it — PricePrint has no server, so the prices you log never leave this device.
        </div>
        <div class="consent-banner-actions">
          <button type="button" class="consent-btn consent-btn-secondary" data-consent="denied">Decline</button>
          <button type="button" class="consent-btn consent-btn-primary" data-consent="granted">Accept</button>
        </div>
      </div>
    `;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-consent]');
      if (!btn) return;
      const decision = btn.dataset.consent;
      writeDecision(decision);
      tellGtag(decision === 'granted' ? GRANT : DENY);
      el.remove();
      // Now that the consent banner is gone, the install button can claim the
      // bottom-right corner without overlapping it.
      maybeShowInstall();
    });
    document.body.appendChild(el);
  }

  // Footer "Cookie preferences" link calls this to re-open the banner so
  // visitors can change their mind without clearing localStorage manually.
  window.priceprintShowConsent = showBanner;

  if (!readDecision()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }

  // Register the service worker (PWA install + offline support). Done here
  // because consent.js is the one script loaded on every page. Network-first
  // SW, so this never serves stale deploys — see sw.js.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // ---- Install button (PWA) ----
  // A circular floating button (bottom-right, like a back-to-top button) that
  // installs the app. On Chrome/Android/desktop it fires the captured
  // beforeinstallprompt; on iOS Safari (which has no such event) it shows a
  // "Share → Add to Home Screen" hint. Hidden if already installed or
  // dismissed, and only revealed once the consent banner is out of the way.
  const INSTALL_DISMISS_KEY = 'priceprint.installDismissed';
  let deferredPrompt = null;
  let installBtn = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const consentDecided = () => !!readDecision();
  const installDismissed = () => {
    try { return localStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch (e) { return false; }
  };

  function buildInstallButton() {
    const wrap = document.createElement('div');
    wrap.id = 'pwa-install';
    wrap.className = 'pwa-install';
    wrap.innerHTML = `
      <button type="button" class="pwa-install-btn" aria-label="Download PricePrint app" title="Download app">
        <img class="pwa-install-logo" src="/android-icon-96x96.png" alt="" aria-hidden="true" />
        <span class="pwa-install-label">Download</span>
      </button>
      <button type="button" class="pwa-install-close" aria-label="Dismiss download button" title="Dismiss">×</button>
    `;
    document.body.appendChild(wrap);
    wrap.querySelector('.pwa-install-close').addEventListener('click', () => {
      try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (e) {}
      wrap.remove();
      installBtn = null;
    });
    wrap.querySelector('.pwa-install-btn').addEventListener('click', onInstallClick);
    return wrap;
  }

  // Exact, minimal install steps for the visitor's actual browser. Browsers
  // don't let a page install itself (security) — beyond the one-tap Chromium
  // prompt, the rest is the browser's own flow, so the best we can do is point
  // precisely at the right control.
  function installInstructions() {
    const ua = navigator.userAgent;
    const iOS = /iphone|ipad|ipod/i.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
    if (iOS) {
      return 'Tap the <strong>Share</strong> icon (the box with an up-arrow), then choose <strong>"Add to Home Screen."</strong>';
    }
    if (/android/i.test(ua)) {
      return 'Tap the <strong>⋮</strong> menu (top-right), then <strong>"Add to Home screen"</strong> or <strong>"Install app."</strong>';
    }
    if (/edg\//i.test(ua)) {
      return 'Click the <strong>install icon</strong> in the address bar, or the <strong>⋯</strong> menu → <strong>Apps → "Install PricePrint."</strong>';
    }
    if (/chrome|chromium|crios/i.test(ua)) {
      return 'Click the <strong>install icon</strong> on the right of the address bar, or the <strong>⋮</strong> menu → <strong>"Install PricePrint."</strong>';
    }
    if (/safari/i.test(ua)) {
      return 'In Safari, choose <strong>File → Add to Dock</strong> (or the <strong>Share</strong> button → "Add to Dock").';
    }
    return 'Open your browser menu and choose <strong>"Install PricePrint"</strong> or <strong>"Add to Home Screen."</strong>';
  }

  async function onInstallClick() {
    if (deferredPrompt) {
      // Chromium: real one-tap install via the browser's own prompt.
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice && choice.outcome === 'accepted' && installBtn) {
        installBtn.remove();
        installBtn = null;
      }
    } else {
      // No install event available — show the exact steps for this browser.
      showHint(installInstructions());
    }
  }

  function showHint(message) {
    if (document.getElementById('pwa-ios-hint')) return;
    const hint = document.createElement('div');
    hint.id = 'pwa-ios-hint';
    hint.className = 'pwa-ios-hint';
    hint.innerHTML = `
      <p>${message}</p>
      <button type="button" class="pwa-ios-hint-close">Got it</button>
    `;
    document.body.appendChild(hint);
    hint.querySelector('.pwa-ios-hint-close').addEventListener('click', () => hint.remove());
  }

  // Show the install button whenever the app isn't already installed and the
  // visitor hasn't dismissed it — regardless of whether the browser has fired
  // beforeinstallprompt yet. The click handler adapts: native prompt on
  // Chromium, manual hint elsewhere. (Relying on beforeinstallprompt alone
  // left the button invisible in most browsers/test setups.)
  function maybeShowInstall() {
    if (installBtn || isStandalone() || installDismissed() || !consentDecided()) return;
    installBtn = buildInstallButton();
  }

  // Footer "Get the app" link calls this to bring the download button back
  // after the visitor has dismissed it (clears the dismissed flag).
  window.priceprintShowInstall = function () {
    try { localStorage.removeItem(INSTALL_DISMISS_KEY); } catch (e) {}
    if (isStandalone()) {
      showHint('You\'ve already installed PricePrint — open it from your home screen.');
      return;
    }
    maybeShowInstall();
    // If consent hasn't been decided yet, the button is gated; clicking the
    // install button later still works once consent is handled.
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    maybeShowInstall();
  });
  window.addEventListener('appinstalled', () => {
    if (installBtn) { installBtn.remove(); installBtn = null; }
    deferredPrompt = null;
  });
  // Returning visitor (consent already decided): try on load, e.g. iOS path
  // or if beforeinstallprompt fires after consent.
  window.addEventListener('load', maybeShowInstall);

  // Keep the footer copyright year current without a yearly code edit.
  function setFooterYear() {
    const y = String(new Date().getFullYear());
    document.querySelectorAll('.footer-year').forEach((el) => { el.textContent = y; });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setFooterYear);
  } else {
    setFooterYear();
  }
})();
