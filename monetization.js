(() => {
  'use strict';

  // Each Pages project keeps its own copy so deployments remain independent.
  const analyticsId = 'G-WTPHWDLQ7K';
  let analyticsLoaded = false;
  let analyticsAllowed = false;
  let adsUnavailable = false;
  const observed = new WeakSet();

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    // Do not replay gameplay events collected before an analytics decision.
    if (arguments[0] === 'event' && !analyticsAllowed) return;
    window.dataLayer.push(arguments);
  };
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });

  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];

  function updateConsent() {
    if (typeof window.googlefc.getGoogleConsentModeValues !== 'function') return;
    const values = window.googlefc.getGoogleConsentModeValues();
    if (!values) return;
    // Google CMP enum: GRANTED = 1, NOT_APPLICABLE = 3.
    // UNKNOWN, DENIED and NOT_CONFIGURED all remain denied.
    const allowed = value => value === 1 || value === 3;
    analyticsAllowed = allowed(values.analyticsStoragePurposeConsentStatus);
    window.gtag('consent', 'update', {
      ad_storage: allowed(values.adStoragePurposeConsentStatus) ? 'granted' : 'denied',
      ad_user_data: allowed(values.adUserDataPurposeConsentStatus) ? 'granted' : 'denied',
      ad_personalization: allowed(values.adPersonalizationPurposeConsentStatus) ? 'granted' : 'denied',
      analytics_storage: analyticsAllowed ? 'granted' : 'denied',
    });
    if (!analyticsAllowed || analyticsLoaded) return;
    analyticsLoaded = true;
    window.gtag('js', new Date());
    window.gtag('config', analyticsId);
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + analyticsId;
    document.head.append(script);
  }

  window.googlefc.callbackQueue.push({ CONSENT_MODE_DATA_READY: updateConsent });
  window.googlefc.callbackQueue.push({
    CONSENT_API_READY: () => {
      if (typeof window.__tcfapi !== 'function') return;
      window.__tcfapi('addEventListener', 2, (data, success) => {
        if (success && ['tcloaded', 'useractioncomplete'].includes(data?.eventStatus)) {
          // Let the CMP update its consent-mode values first.
          setTimeout(updateConsent, 0);
        }
      });
    },
  });

  function eligible(placement) {
    // Navigation, private chat and dialogs are never advertising surfaces.
    if (!placement || placement.closest('dialog, [role="dialog"], nav, [role="navigation"], .room-chat, #chat-root, [role="log"]')) return false;
    const label = placement.querySelector('.ad-placement-label')?.textContent.trim().toLowerCase();
    if (!['advertisements', 'sponsored links'].includes(label)) return false;
    const style = getComputedStyle(placement);
    return !['fixed', 'sticky'].includes(style.position);
  }

  function request(slot) {
    const placement = slot.closest('.ad-placement');
    if (adsUnavailable || !slot.isConnected || slot.dataset.adRequested ||
        !eligible(placement) || slot.closest('[hidden]') ||
        document.querySelector('dialog[open]') ||
        slot.getBoundingClientRect().width < 1) return;
    slot.dataset.adRequested = 'true';
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      slot.closest('.ad-placement').hidden = true;
    }
  }

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      request(entry.target);
      if (entry.target.dataset.adRequested) observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px', threshold: 0.01 }) : null;

  function observe(placement) {
    const slot = placement.querySelector('.adsbygoogle');
    if (!slot || adsUnavailable) return;
    if (!eligible(placement)) { placement.hidden = true; return; }
    if (!observed.has(slot)) {
      observed.add(slot);
      new MutationObserver(() => {
        if (slot.dataset.adStatus === 'unfilled') placement.hidden = true;
      }).observe(slot, { attributes: true, attributeFilter: ['data-ad-status'] });
    }
    if (slot.dataset.adRequested || placement.hidden) return;
    if (observer) observer.observe(slot); else request(slot);
  }

  window.MoDITAds = {
    setVisible(placement, visible) {
      if (!placement) return;
      const slot = placement.querySelector('.adsbygoogle');
      // Once requested, keep a filled unit stable across SPA navigation. Never hide,
      // recreate or refresh a served ad when players open a room or make a move.
      placement.hidden = adsUnavailable || !eligible(placement) ||
        slot?.dataset.adStatus === 'unfilled' || (!visible && !slot?.dataset.adRequested);
      if (!placement.hidden) observe(placement);
    },
    unavailable() {
      adsUnavailable = true;
      observer?.disconnect();
      document.querySelectorAll('.ad-placement').forEach(placement => { placement.hidden = true; });
    },
  };

  function ready() {
    if (adsUnavailable) {
      window.MoDITAds.unavailable();
      return;
    }
    document.querySelectorAll('.ad-placement').forEach(observe);
  }
  document.addEventListener('close', event => {
    if (event.target.tagName !== 'DIALOG') return;
    // Re-arm only unrequested slots: an observer entry may have been consumed
    // while the modal was open. Requested units must never be requested again.
    document.querySelectorAll('.ad-placement .adsbygoogle').forEach(slot => {
      if (!slot.dataset.adRequested) observer?.unobserve(slot);
    });
    ready();
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
