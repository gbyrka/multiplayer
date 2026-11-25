(() => {
  'use strict';

  // Each Pages project keeps its own copy so deployments remain independent.
  const analyticsId = 'G-WTPHWDLQ7K';
  const analyticsDisabled = 'ga-disable-' + analyticsId;
  const analyticsChoiceKey = 'mod-it:analytics-consent:v1';
  const choiceLifetime = 180 * 86400 * 1000;
  const cmpWait = 5000;
  let analyticsLoaded = false;
  let analyticsAllowed = false;
  let cmpStatus;
  let fallbackActive = false;
  let settings;
  let panel;
  let adsUnavailable = false;
  const observed = new WeakSet();

  window[analyticsDisabled] = true;
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

  function analyticsURL(value) {
    if (!value) return '';
    const url = new URL(value);
    for (const parameter of ['room', 'debug', '_refresh']) url.searchParams.delete(parameter);
    url.hash = '';
    return url.href;
  }

  function pageContext() {
    const page = new URL(analyticsURL(location.href));
    return {
      page_location: page.href,
      page_title: page.searchParams.get('game') === 'plan' ? 'PLAN — Multiplayer' : document.title,
    };
  }

  function applyAnalyticsConsent(allowed) {
    if (analyticsAllowed === allowed) return;
    analyticsAllowed = allowed;
    window[analyticsDisabled] = !allowed;
    window.gtag('consent', 'update', { analytics_storage: allowed ? 'granted' : 'denied' });
    if (!analyticsAllowed || analyticsLoaded) return;
    analyticsLoaded = true;
    window.gtag('js', new Date());
    window.gtag('config', analyticsId, {
      ...pageContext(),
      page_referrer: analyticsURL(document.referrer),
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + analyticsId;
    document.head.append(script);
  }

  window.MoDITAnalytics = {
    pageView() {
      if (!analyticsAllowed) return;
      const page = pageContext();
      window.gtag('config', analyticsId, { ...page, update: true });
      window.gtag('event', 'page_view', page);
    },
  };

  function storedChoice() {
    try {
      const choice = JSON.parse(localStorage.getItem(analyticsChoiceKey));
      if (choice?.expires > Date.now() && typeof choice.allowed === 'boolean') return choice.allowed;
    } catch { /* The choice can still apply to the current page. */ }
    return null;
  }

  function showPanel(show) {
    panel.hidden = !show;
    settings.setAttribute('aria-expanded', String(show));
  }

  function syncChoice(choice) {
    applyAnalyticsConsent(choice === true);
    showPanel(choice === null);
  }

  function choose(allowed) {
    try {
      localStorage.setItem(analyticsChoiceKey, JSON.stringify({ allowed, expires: Date.now() + choiceLifetime }));
    } catch { /* The choice still applies to the current page. */ }
    syncChoice(allowed);
    settings.focus({ preventScroll: true });
  }

  function mountAnalyticsSettings() {
    settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'collection-analytics-settings';
    settings.textContent = 'Analytics settings';
    settings.setAttribute('aria-controls', 'collection-analytics');
    settings.addEventListener('click', () => {
      showPanel(panel.hidden);
      if (!panel.hidden) panel.querySelector('h2').focus({ preventScroll: true });
    });
    const footer = document.querySelector('.privacy-footer, .site-footer') || document.querySelector('footer');
    (footer || document.body).append(settings);

    panel = document.createElement('section');
    panel.id = 'collection-analytics';
    panel.setAttribute('aria-labelledby', 'collection-analytics-title');
    panel.innerHTML = `
      <h2 id="collection-analytics-title" tabindex="-1">Optional visit statistics</h2>
      <p>Allow Google Analytics to measure visits to MoD-IT Games? You can play either way. <a href="/games/privacy.html#analytics">Privacy policy</a></p>
      <div>
        <button type="button" data-consent="deny">Decline</button>
        <button type="button" data-consent="allow">Allow analytics</button>
      </div>`;
    panel.querySelector('[data-consent="deny"]').addEventListener('click', () => choose(false));
    panel.querySelector('[data-consent="allow"]').addEventListener('click', () => choose(true));
    document.body.append(panel);
  }

  function setFallback(active) {
    if (fallbackActive === active) return;
    fallbackActive = active;
    if (active) {
      if (!settings) mountAnalyticsSettings();
      settings.hidden = false;
      syncChoice(storedChoice());
    } else {
      showPanel(false);
      settings.hidden = true;
    }
  }

  function updateConsent() {
    if (typeof window.googlefc.getGoogleConsentModeValues !== 'function') return;
    const values = window.googlefc.getGoogleConsentModeValues();
    if (!values) return;
    // Google CMP: 1 = GRANTED, 3 = NOT_APPLICABLE, 4 = NOT_CONFIGURED.
    const permitted = value => value === 1 || value === 3;
    cmpStatus = values.analyticsStoragePurposeConsentStatus;
    window.gtag('consent', 'update', {
      ad_storage: permitted(values.adStoragePurposeConsentStatus) ? 'granted' : 'denied',
      ad_user_data: permitted(values.adUserDataPurposeConsentStatus) ? 'granted' : 'denied',
      ad_personalization: permitted(values.adPersonalizationPurposeConsentStatus) ? 'granted' : 'denied',
    });
    if (cmpStatus === 4) {
      if (document.readyState !== 'loading') setFallback(true);
      return;
    }
    setFallback(false);
    applyAnalyticsConsent(permitted(cmpStatus));
  }

  function initAnalyticsSettings() {
    if (!document.getElementById('adsense-script') || cmpStatus === 4) {
      setFallback(true);
      return;
    }
    // Some pages receive the funding message script without its Consent Mode API.
    setTimeout(() => {
      if (cmpStatus === undefined && typeof window.googlefc.getGoogleConsentModeValues !== 'function') {
        setFallback(true);
      }
    }, cmpWait);
  }

  window.addEventListener('storage', event => {
    if (fallbackActive && (event.key === analyticsChoiceKey || event.key === null)) syncChoice(storedChoice());
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAnalyticsSettings, { once: true });
  else initAnalyticsSettings();

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
