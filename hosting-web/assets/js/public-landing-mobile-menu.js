/**
 * Public landing — body-level fixed mobile menu (≤900px).
 * Outside header flow; no brand/account layout coupling.
 */
(function () {
  'use strict';

  var MQ = '(max-width: 900px)';
  var OPEN_CLASS = 'is-open';
  var LABEL_OPEN = 'Menüyü kapat';
  var LABEL_CLOSED = 'Menüyü aç';

  function init() {
    if (!document.body || !document.body.classList.contains('page-landing')) return;

    var toggle = document.getElementById('public-mobile-menu-button');
    var panel = document.getElementById('public-mobile-menu-panel');
    if (!toggle || !panel || toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';

    function isMobile() {
      return window.matchMedia(MQ).matches;
    }

    function isOpen() {
      return toggle.getAttribute('aria-expanded') === 'true';
    }

    function setOpen(open) {
      if (!isMobile()) open = false;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? LABEL_OPEN : LABEL_CLOSED);
      toggle.classList.toggle(OPEN_CLASS, open);
      panel.classList.toggle(OPEN_CLASS, open);
      if (open) {
        panel.hidden = false;
        panel.removeAttribute('hidden');
        panel.setAttribute('aria-hidden', 'false');
      } else {
        panel.hidden = true;
        panel.setAttribute('hidden', '');
        panel.setAttribute('aria-hidden', 'true');
      }
    }

    function close() {
      setOpen(false);
    }

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!isMobile()) return;
      setOpen(!isOpen());
    });

    document.addEventListener('click', function (e) {
      if (!isOpen()) return;
      var t = e.target;
      if (toggle.contains(t) || panel.contains(t)) return;
      close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !isOpen()) return;
      e.preventDefault();
      close();
      if (typeof toggle.focus === 'function') toggle.focus();
    });

    var mqList = window.matchMedia(MQ);
    function onMqChange() {
      if (!mqList.matches) close();
    }
    if (typeof mqList.addEventListener === 'function') {
      mqList.addEventListener('change', onMqChange);
    } else if (typeof mqList.addListener === 'function') {
      mqList.addListener(onMqChange);
    }

    setOpen(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
