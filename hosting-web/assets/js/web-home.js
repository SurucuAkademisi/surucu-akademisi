/**
 * Student web home shell (W3.1) — auth/session guard, branding, premium module grid.
 */
(function () {
  'use strict';

  var SOON_GATE_ID = 'app-soon-gate';
  var EXAMS_MODULE_KEY = 'exams';
  var LESSONS_MODULE_KEY = 'lessons';
  var PROFILE_MODULE_KEY = 'profile';
  var DUEL_MODULE_KEY = 'duel';
  var LEAGUES_MODULE_KEY = 'leagues';
  var PRACTICAL_MODULE_KEY = 'practical';
  var VIDEOS_MODULE_KEY = 'videos';
  var FORUM_MODULE_KEY = 'forum';
  var HEADER_PENDING_CLASS = 'page-app--header-pending';
  var lastFocusedCard = null;
  var headerPendingInitial = false;

  var MODULE_ICONS = {
    exams:
      '<rect x="10" y="8" width="28" height="34" rx="3" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M16 18h16M16 24h12M16 30h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M30 14l3 3-6 6-3-3 6-6z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>',
    lessons:
      '<path d="M10 12h12v28H10V12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M22 12h16v28H22V12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M14 18h4M14 24h4M26 18h8M26 24h8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
    practical:
      '<path d="M24 10L38 36H10L24 10z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M24 20v8M24 32v2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
      '<rect x="6" y="38" width="36" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>',
    forum:
      '<path d="M8 14h22a4 4 0 014 4v10H18l-6 6v-6H8V14z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M28 22h12a4 4 0 014 4v8h-8l-4 4v-4h-4V22z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    duel:
      '<path d="M24 8v6M20 14h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M14 38h20l2-14H12l2 14z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M18 24c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="2"/>',
    videos:
      '<rect x="8" y="12" width="32" height="24" rx="3" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M22 20l10 6-10 6V20z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<circle cx="36" cy="10" r="5" stroke="currentColor" stroke-width="1.75"/>' +
      '<path d="M34 10h4M36 8v4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
    leagues:
      '<path d="M16 38h16v4H16v-4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M14 18h6v12h-6V18zM22 14h4v16h-4V14zM28 20h6v10h-6V20z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M12 18l12-8 12 8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    profile:
      '<circle cx="24" cy="18" r="8" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M10 40c0-7.7 6.3-14 14-14s14 6.3 14 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  };

  var MODULE_EMOJI = {
    exams: '📝',
    lessons: '📚',
    practical: '🚦',
    forum: '💬',
    duel: '⚔️',
    videos: '🎥',
    leagues: '🏆',
    profile: '👤'
  };

  function redirectLogin() {
    clearPendingClass();
    window.location.replace('login.html');
  }

  function hasPendingClass() {
    return document.documentElement.classList.contains(HEADER_PENDING_CLASS);
  }

  function clearPendingClass() {
    document.documentElement.classList.remove(HEADER_PENDING_CLASS);
  }

  function getCatalog() {
    return Array.isArray(window.SA_WEB_MODULE_CATALOG) ? window.SA_WEB_MODULE_CATALOG : [];
  }

  function getSoonGate() {
    return document.getElementById(SOON_GATE_ID);
  }

  function openSoonGate(card) {
    var gate = getSoonGate();
    if (!gate) return;
    lastFocusedCard = card || null;
    gate.hidden = false;
    gate.setAttribute('aria-hidden', 'false');
    document.body.classList.add('public-gate-open');

    var focusTarget = gate.querySelector('[data-app-soon-focus], .public-gate__later, .public-gate__close');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }

  function closeSoonGate() {
    var gate = getSoonGate();
    if (!gate) return;
    gate.hidden = true;
    gate.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('public-gate-open');
    if (lastFocusedCard && typeof lastFocusedCard.focus === 'function') {
      lastFocusedCard.focus();
    }
    lastFocusedCard = null;
  }

  function bindSoonGate() {
    var gate = getSoonGate();
    if (!gate || gate.dataset.bound === '1') return;
    gate.dataset.bound = '1';

    gate.querySelectorAll('[data-app-soon-dismiss]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        closeSoonGate();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var activeGate = getSoonGate();
      if (activeGate && !activeGate.hidden) {
        e.preventDefault();
        closeSoonGate();
      }
    });
  }

  function createModuleIcon(key) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'module-icon');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = MODULE_ICONS[key] || MODULE_ICONS.exams;
    return svg;
  }

  function handleModuleActivate(e, card) {
    if (!card) return;
    e.preventDefault();

    var key = (card.getAttribute('data-module-key') || '').trim();
    var href = (card.getAttribute('data-module-href') || '').trim();
    if (
      (key === EXAMS_MODULE_KEY ||
        key === LESSONS_MODULE_KEY ||
        key === PROFILE_MODULE_KEY ||
        key === DUEL_MODULE_KEY ||
        key === LEAGUES_MODULE_KEY ||
        key === PRACTICAL_MODULE_KEY ||
        key === VIDEOS_MODULE_KEY ||
        key === FORUM_MODULE_KEY) &&
      href
    ) {
      window.location.href = href;
      return;
    }

    openSoonGate(card);
  }

  function bindModuleCard(card) {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.classList.add('content-module-card--app-interactive');

    card.addEventListener('click', function (e) {
      handleModuleActivate(e, card);
    });

    card.addEventListener('keydown', function (e) {
      var key = e.key || e.code;
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        handleModuleActivate(e, card);
      }
    });
  }

  function renderModules(container) {
    if (!container) return;
    container.innerHTML = '';

    getCatalog().forEach(function (mod) {
      if (!mod || !mod.key) return;

      var accent = String(mod.accent || 'cyan').trim();
      var card = document.createElement('article');
      card.className =
        'content-module-card content-module-card--' +
        accent +
        ' content-module-card--app';
      card.id = 'home-modul-' + mod.key;
      card.setAttribute('data-module-key', mod.key);
      var appHref = mod.appHref ? String(mod.appHref).trim() : '';
      if (appHref) {
        card.setAttribute('data-module-href', appHref);
      }

      var visual = document.createElement('div');
      visual.className = 'module-card-visual';

      var heading = document.createElement('h3');
      heading.className = 'module-card-visual-title';

      var emojiSpan = document.createElement('span');
      emojiSpan.className = 'module-card-emoji';
      emojiSpan.setAttribute('aria-hidden', 'true');
      emojiSpan.textContent = MODULE_EMOJI[mod.key] || '✨';

      var titleSpan = document.createElement('span');
      titleSpan.className = 'module-card-title';
      titleSpan.textContent = mod.title || mod.key;

      heading.appendChild(emojiSpan);
      heading.appendChild(titleSpan);
      visual.appendChild(heading);

      var body = document.createElement('div');
      body.className = 'module-card-body';

      var desc = document.createElement('p');
      desc.textContent = mod.description || '';

      var status = document.createElement('span');
      status.className = 'content-module-status';
      if (mod.statusAccent) {
        status.classList.add('content-module-status--accent');
      }
      status.textContent = mod.statusLabel || 'Hazırlanıyor';

      body.appendChild(desc);
      body.appendChild(status);

      card.appendChild(visual);
      card.appendChild(body);
      container.appendChild(card);
      bindModuleCard(card);
    });
  }

  function bindLogout(btn) {
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      var sessionApi = window.SA_WEB_SESSION;
      var p = sessionApi && sessionApi.logoutWebStudent
        ? sessionApi.logoutWebStudent()
        : Promise.resolve();
      p.then(function () {
        window.location.href = 'login.html';
      }).catch(function () {
        window.location.href = 'login.html';
      });
    });
  }

  function getFirstName(session) {
    var display = String((session && (session.displayName || session.username)) || '').trim();
    if (!display) return 'Öğrenci';
    var parts = display.split(/\s+/).filter(Boolean);
    return parts.length ? parts[0] : 'Öğrenci';
  }

  function fillHeader(session) {
    var tenantEl = document.getElementById('home-tenant-name');
    var greetingNameEl = document.getElementById('home-greeting-name');
    var userEl = document.getElementById('home-user-name');
    var logoEl = document.getElementById('home-tenant-logo');
    var monogramEl = document.getElementById('home-tenant-monogram');

    var display = session.displayName || session.username || 'Öğrenci';
    var firstName = getFirstName(session);
    if (tenantEl) tenantEl.textContent = session.tenantName || session.tenantId || '—';
    if (greetingNameEl) greetingNameEl.textContent = firstName;
    if (userEl) userEl.textContent = display;

    var brand = window.SA_WEB_TENANT_BRAND;
    if (brand && typeof brand.applyHeaderBranding === 'function') {
      brand.applyHeaderBranding(logoEl, monogramEl, session);
    }
  }

  function handleAuthState(user) {
    var sessionApi = window.SA_WEB_SESSION;

    if (!user) {
      redirectLogin();
      return;
    }

    var session = sessionApi.requireWebStudentSession();
    if (!session) {
      redirectLogin();
      return;
    }

    fillHeader(session);
    renderModules(document.getElementById('home-module-grid'));
    bindLogout(document.getElementById('home-logout'));
    clearPendingClass();
  }

  function onAuthReady(user) {
    handleAuthState(user);
  }

  function init() {
    headerPendingInitial = hasPendingClass();

    var fb = window.SA_WEB_FIREBASE;
    var sessionApi = window.SA_WEB_SESSION;

    if (!fb || !fb.ready || !fb.auth || !sessionApi) {
      redirectLogin();
      return;
    }

    bindSoonGate();

    fb.auth.onAuthStateChanged(function (user) {
      onAuthReady(user);
    });

    if (!headerPendingInitial) {
      onAuthReady(fb.auth.currentUser);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
