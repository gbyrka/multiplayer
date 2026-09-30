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

  function request(slot) {
    if (adsUnavailable || !slot.isConnected || slot.dataset.adRequested ||
        slot.closest('[hidden]') || slot.getBoundingClientRect().width < 1) return;
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
  }, { rootMargin: '200px 0px' }) : null;

  function observe(placement) {
    const slot = placement.querySelector('.adsbygoogle');
    if (!slot || adsUnavailable) return;
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
      placement.hidden = adsUnavailable || !visible ||
        placement.querySelector('.adsbygoogle')?.dataset.adStatus === 'unfilled';
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
