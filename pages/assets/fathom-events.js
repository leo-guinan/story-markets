(() => {
  function track(eventName, retries = 2) {
    if (typeof eventName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(eventName)) return;
    try {
      if (window.fathom && typeof window.fathom.trackEvent === 'function') {
        window.fathom.trackEvent(eventName);
        return;
      }
    } catch {
      return;
    }
    if (retries > 0) window.setTimeout(() => track(eventName, retries - 1), 350);
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-track-event]') : null;
    if (target) track(target.getAttribute('data-track-event'));
  }, true);

  window.storyMarketsTrackEvent = track;
})();
