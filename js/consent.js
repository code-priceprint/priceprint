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
})();
