/**
 * Public landing: module gate (guest) + unlocked navigation (public_user) — P2.2a / P2.2b.
 */
(function () {
  'use strict';

  var LOGIN_GATE_ID = 'public-login-gate';
  var SOON_GATE_ID = 'public-soon-gate';
  var CARD_SELECTOR = '.content-module-card[data-requires-login]';
  var EXAMS_MODULE_KEY = 'exams';
  var LESSONS_MODULE_KEY = 'lessons';
  var PROFILE_MODULE_KEY = 'profile';
  var DUEL_MODULE_KEY = 'duel';
  var LEAGUES_MODULE_KEY = 'leagues';
  var PRACTICAL_MODULE_KEY = 'practical';
  var VIDEOS_MODULE_KEY = 'videos';
  var FORUM_MODULE_KEY = 'forum';

  var lastFocusedCard = null;
  var cardHandlersBound = false;
  var isPublicUserMode = false;
  var PUBLIC_HEADER_PENDING_CLASS = 'page-public-header-pending';

  function clearPublicHeaderPending() {
    document.documentElement.classList.remove(PUBLIC_HEADER_PENDING_CLASS);
  }

  function getSession() {
    return window.SA_PUBLIC_SESSION && typeof window.SA_PUBLIC_SESSION.getPublicSession === 'function'
      ? window.SA_PUBLIC_SESSION.getPublicSession()
      : null;
  }

  function getLoginGate() {
    return document.getElementById(LOGIN_GATE_ID);
  }

  function getSoonGate() {
    return document.getElementById(SOON_GATE_ID);
  }

  function isModalOpen(gate) {
    return gate && !gate.hidden;
  }

  function openModal(gate, card) {
    if (!gate) return;
    lastFocusedCard = card || null;
    gate.hidden = false;
    gate.setAttribute('aria-hidden', 'false');
    document.body.classList.add('public-gate-open');

    var focusTarget = gate.querySelector('[data-public-gate-focus], .public-gate__actions a, .public-gate__later, .public-gate__close');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }

  function closeModal(gate) {
    if (!gate) return;
    gate.hidden = true;
    gate.setAttribute('aria-hidden', 'true');
    if (!isModalOpen(getLoginGate()) && !isModalOpen(getSoonGate())) {
      document.body.classList.remove('public-gate-open');
    }
    if (lastFocusedCard && typeof lastFocusedCard.focus === 'function') {
      lastFocusedCard.focus();
    }
    lastFocusedCard = null;
  }

  function openLoginGate(card) {
    openModal(getLoginGate(), card);
  }

  function openSoonGate(card) {
    openModal(getSoonGate(), card);
  }

  function closeAllModals() {
    closeModal(getLoginGate());
    closeModal(getSoonGate());
  }

  function getDisplayName(session) {
    if (!session) return 'Üye';
    var first = String(session.firstName || '').trim();
    if (first) return first;
    var display = String(session.displayName || '').trim();
    if (display) return display.split(' ')[0] || display;
    var email = String(session.email || '').trim();
    if (email && email.indexOf('@') > 0) return email.split('@')[0];
    return 'Üye';
  }

  function setHeaderMode(loggedIn, session) {
    var guestBlocks = document.querySelectorAll('[data-public-header="guest"]');
    var userBlocks = document.querySelectorAll('[data-public-header="user"]');
    var nameEl = document.getElementById('public-header-name');

    guestBlocks.forEach(function (el) {
      el.hidden = !!loggedIn;
      el.setAttribute('aria-hidden', loggedIn ? 'true' : 'false');
    });

    userBlocks.forEach(function (el) {
      el.hidden = !loggedIn;
      el.setAttribute('aria-hidden', loggedIn ? 'false' : 'true');
    });

    if (nameEl) {
      nameEl.textContent = loggedIn ? getDisplayName(session) : '';
    }

    document.body.classList.toggle('page-landing--public-user', !!loggedIn);
    document.body.classList.toggle('page-cikmis-sorular--public-user', !!loggedIn);
    clearPublicHeaderPending();
  }

  function isExamHubPage() {
    return document.body.classList.contains('page-cikmis-sorular');
  }

  function isLandingHomePage() {
    return document.body.classList.contains('page-landing') && !isExamHubPage();
  }

  function navigateToModule(card) {
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

  function handleCardActivate(e, card) {
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();

    if (isPublicUserMode) {
      navigateToModule(card);
      return;
    }

    openLoginGate(card);
  }

  function unbindCardGateBehavior(card) {
    card.removeAttribute('tabindex');
    card.removeAttribute('role');
    card.removeAttribute('aria-haspopup');
    card.classList.add('content-module-card--unlocked');
  }

  function syncCardAccessibility(card) {
    if (isPublicUserMode) {
      unbindCardGateBehavior(card);
    } else {
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-haspopup', 'dialog');
      card.classList.remove('content-module-card--unlocked');
    }
  }

  function bindCardGateBehavior(card) {
    if (card.dataset.publicCardBound === '1') {
      syncCardAccessibility(card);
      return;
    }
    card.dataset.publicCardBound = '1';
    syncCardAccessibility(card);

    card.addEventListener('click', function (e) {
      handleCardActivate(e, card);
    });

    card.addEventListener('keydown', function (e) {
      var key = e.key || e.code;
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        handleCardActivate(e, card);
      }
    });
  }

  function bindModuleCards() {
    var cards = document.querySelectorAll(CARD_SELECTOR);
    cards.forEach(bindCardGateBehavior);
    cardHandlersBound = cards.length > 0;
  }

  function syncAllCardsAccessibility() {
    document.querySelectorAll(CARD_SELECTOR).forEach(syncCardAccessibility);
  }

  function bindGateDismiss() {
    document.querySelectorAll('.public-gate').forEach(function (gate) {
      gate.querySelectorAll('[data-public-gate-dismiss]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.preventDefault();
          closeModal(gate);
        });
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (isModalOpen(getLoginGate())) {
        e.preventDefault();
        closeModal(getLoginGate());
      } else if (isModalOpen(getSoonGate())) {
        e.preventDefault();
        closeModal(getSoonGate());
      }
    });
  }

  function bindLogout() {
    var btn = document.getElementById('public-header-logout');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', async function () {
      btn.disabled = true;
      if (window.SA_PUBLIC_AUTH && typeof window.SA_PUBLIC_AUTH.logoutPublicUser === 'function') {
        await window.SA_PUBLIC_AUTH.logoutPublicUser();
      } else if (window.SA_PUBLIC_SESSION) {
        window.SA_PUBLIC_SESSION.clearPublicSession();
      }
      isPublicUserMode = false;
      setHeaderMode(false, null);
      if (isLandingHomePage()) {
        syncAllCardsAccessibility();
      }
      if (isExamHubPage()) {
        window.location.href = '../';
        return;
      }
      btn.disabled = false;
    });
  }

  function isInstitutionStudentHeaderActive() {
    return !!(
      window.SA_WEB_STUDENT_HEADER
      && typeof window.SA_WEB_STUDENT_HEADER.isActive === 'function'
      && window.SA_WEB_STUDENT_HEADER.isActive()
    );
  }

  function isExamHubHeaderPending() {
    if (!isExamHubPage()) return false;
    return !!(
      window.SA_WEB_STUDENT_HEADER
      && typeof window.SA_WEB_STUDENT_HEADER.isPending === 'function'
      && window.SA_WEB_STUDENT_HEADER.isPending()
    );
  }

  async function refreshPublicUserState() {
    if (isInstitutionStudentHeaderActive()) {
      clearPublicHeaderPending();
      return;
    }

    if (isExamHubHeaderPending()) {
      return;
    }

    var session = getSession();
    isPublicUserMode = !!(session && session.uid);

    if (isPublicUserMode) {
      setHeaderMode(true, session);
      closeAllModals();
      syncAllCardsAccessibility();
      bindLogout();
      return;
    }

    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth && fb.auth.currentUser && window.SA_PUBLIC_AUTH) {
      try {
        var uid = fb.auth.currentUser.uid;
        var doc = await window.SA_PUBLIC_AUTH.loadPublicUserDoc(uid);
        var restore = null;
        if (typeof window.SA_PUBLIC_AUTH.resolvePublicEhliyetRestore === 'function') {
          restore = await window.SA_PUBLIC_AUTH.resolvePublicEhliyetRestore(doc, uid);
        } else if (typeof window.SA_PUBLIC_AUTH.assertPublicUserRole === 'function') {
          restore = window.SA_PUBLIC_AUTH.assertPublicUserRole(doc);
        }
        if (restore && restore.ok && window.SA_PUBLIC_SESSION) {
          var email = fb.auth.currentUser.email || (doc && doc.email) || '';
          var payload = typeof window.SA_PUBLIC_AUTH.buildSessionPayload === 'function'
            ? window.SA_PUBLIC_AUTH.buildSessionPayload(uid, email, doc)
            : {
                uid: uid,
                email: email,
                firstName: doc && doc.firstName,
                lastName: doc && doc.lastName,
                displayName: doc && doc.displayName,
                role: 'public_user',
                authRole: restore.authRole || 'public_user',
                ehliyetEntitlement: 'public',
                savedAt: Date.now()
              };
          window.SA_PUBLIC_SESSION.savePublicSession(payload);
          session = getSession();
          isPublicUserMode = true;
          setHeaderMode(true, session);
          closeAllModals();
          syncAllCardsAccessibility();
          bindLogout();
          return;
        }
      } catch (e) {
        console.warn('[public-landing-auth] auth sync failed', e);
      }
    }

    if (isInstitutionStudentHeaderActive()) {
      clearPublicHeaderPending();
      return;
    }

    if (isExamHubHeaderPending()) {
      return;
    }

    setHeaderMode(false, null);
    syncAllCardsAccessibility();
  }

  function bindAuthStateListener() {
    var fb = window.SA_WEB_FIREBASE;
    if (!fb || !fb.ready || !fb.auth || typeof fb.auth.onAuthStateChanged !== 'function') return;
    fb.auth.onAuthStateChanged(function () {
      refreshPublicUserState();
    });
  }

  function initPublicHeader() {
    bindLogout();
    refreshPublicUserState();
    bindAuthStateListener();
  }

  function initLandingModules() {
    bindGateDismiss();
    if (!cardHandlersBound) {
      bindModuleCards();
    }
  }

  function init() {
    if (!document.body.classList.contains('page-landing') && !isExamHubPage()) return;

    initPublicHeader();

    if (isLandingHomePage()) {
      initLandingModules();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
