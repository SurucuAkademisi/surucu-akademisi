/**
 * Institution student header for shared web modules (e.g. cikmis-sorular hub).
 */
(function () {
  'use strict';

  var INSTITUTION_BODY_CLASS = 'page-cikmis-sorular--institution-student';
  var HEADER_PENDING_CLASS = 'page-cikmis-sorular--header-pending';

  var institutionActive = false;
  var headerResolved = false;
  var authChecked = false;
  var headerPendingInitial = false;
  var logoutBound = false;

  function isExamHubPage() {
    return document.body && document.body.classList.contains('page-cikmis-sorular');
  }

  function hasPendingClass() {
    return (
      document.documentElement.classList.contains(HEADER_PENDING_CLASS)
      || (document.body && document.body.classList.contains(HEADER_PENDING_CLASS))
    );
  }

  function isPending() {
    return !headerResolved && (headerPendingInitial || hasPendingClass());
  }

  function isResolved() {
    return headerResolved;
  }

  function isActive() {
    return institutionActive;
  }

  function clearPendingClass() {
    document.documentElement.classList.remove(HEADER_PENDING_CLASS);
    if (document.body) {
      document.body.classList.remove(HEADER_PENDING_CLASS);
    }
  }

  function markResolved() {
    headerResolved = true;
    clearPendingClass();
  }

  function getFirstName(session) {
    var display = String(
      (session && (session.displayName || session.studentName || session.username)) || ''
    ).trim();
    if (!display) return 'Öğrenci';
    var parts = display.split(/\s+/).filter(Boolean);
    return parts.length ? parts[0] : 'Öğrenci';
  }

  function getPublicShell() {
    return document.getElementById('public-header-shell');
  }

  function getInstitutionShell() {
    return document.getElementById('hub-student-header');
  }

  function showInstitutionShell() {
    var inst = getInstitutionShell();
    var pub = getPublicShell();
    if (inst) {
      inst.hidden = false;
      inst.setAttribute('aria-hidden', 'false');
    }
    if (pub) {
      pub.hidden = true;
      pub.setAttribute('aria-hidden', 'true');
    }
  }

  function hideInstitutionShell() {
    var inst = getInstitutionShell();
    var pub = getPublicShell();
    if (inst) {
      inst.hidden = true;
      inst.setAttribute('aria-hidden', 'true');
    }
    if (pub) {
      pub.hidden = false;
      pub.setAttribute('aria-hidden', 'false');
    }
  }

  function fillHeader(session) {
    var greetingEl = document.getElementById('hub-student-greeting-name');
    var tenantEl = document.getElementById('hub-tenant-name');
    var logoEl = document.getElementById('hub-tenant-logo');
    var monogramEl = document.getElementById('hub-tenant-monogram');

    if (greetingEl) greetingEl.textContent = getFirstName(session);
    if (tenantEl) tenantEl.textContent = session.tenantName || session.tenantId || '—';

    var brand = window.SA_WEB_TENANT_BRAND;
    if (brand && typeof brand.applyHeaderBranding === 'function') {
      brand.applyHeaderBranding(logoEl, monogramEl, session);
    }
  }

  function bindLogout() {
    if (logoutBound) return;
    var btn = document.getElementById('hub-student-logout');
    if (!btn) return;
    logoutBound = true;

    btn.addEventListener('click', function () {
      btn.disabled = true;
      var sessionApi = window.SA_WEB_SESSION;
      var p = sessionApi && sessionApi.logoutWebStudent
        ? sessionApi.logoutWebStudent()
        : Promise.resolve();
      p.then(function () {
        window.location.href = '../app/login.html';
      }).catch(function () {
        window.location.href = '../app/login.html';
      });
    });
  }

  function activateInstitutionMode(session) {
    institutionActive = true;
    document.body.classList.add(INSTITUTION_BODY_CLASS);
    showInstitutionShell();
    fillHeader(session);
    bindLogout();
  }

  function deactivateInstitutionMode() {
    institutionActive = false;
    document.body.classList.remove(INSTITUTION_BODY_CLASS);
    hideInstitutionShell();
  }

  function finishNonInstitutionMode() {
    deactivateInstitutionMode();
    markResolved();
  }

  function refreshInstitutionHeader() {
    if (!isExamHubPage()) {
      deactivateInstitutionMode();
      markResolved();
      return;
    }

    if (isPending() && !authChecked) {
      return;
    }

    var sessionApi = window.SA_WEB_SESSION;
    if (!sessionApi || typeof sessionApi.requireWebStudentSession !== 'function') {
      finishNonInstitutionMode();
      return;
    }

    var session = sessionApi.requireWebStudentSession();
    if (session) {
      clearPendingClass();
      activateInstitutionMode(session);
      markResolved();
      return;
    }

    finishNonInstitutionMode();
  }

  function onAuthReady() {
    authChecked = true;
    refreshInstitutionHeader();
  }

  function init() {
    if (!isExamHubPage()) return;

    headerPendingInitial = hasPendingClass();

    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth && typeof fb.auth.onAuthStateChanged === 'function') {
      fb.auth.onAuthStateChanged(function () {
        onAuthReady();
      });
    } else {
      onAuthReady();
      return;
    }

    if (!headerPendingInitial) {
      onAuthReady();
    }
  }

  window.SA_WEB_STUDENT_HEADER = {
    isActive: isActive,
    isPending: isPending,
    isResolved: isResolved,
    refresh: refreshInstitutionHeader
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
