/**
 * Context-aware portal home links for web module pages (sessionStorage only).
 */
(function () {
  'use strict';

  var WEB_SESSION_KEY = 'sa_web_session_v1';
  var PUBLIC_SESSION_KEY = 'sa_public_session_v1';
  var INSTITUTION_HOME = '../app/home.html';
  var PUBLIC_HOME = '../';
  var PORTAL_HOME_SELECTOR = '[data-sa-portal-home]';

  var initialized = false;
  var authListenerBound = false;

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function parseInstitutionSession() {
    var api = window.SA_WEB_SESSION;
    if (api && typeof api.getWebSession === 'function') {
      try {
        var fromApi = api.getWebSession();
        if (fromApi && normalizeString(fromApi.uid) && normalizeString(fromApi.tenantId)) {
          return fromApi;
        }
      } catch (_) {}
    }

    try {
      var raw = sessionStorage.getItem(WEB_SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!normalizeString(parsed.uid) || !normalizeString(parsed.tenantId)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function parsePublicSession() {
    var api = window.SA_PUBLIC_SESSION;
    if (api && typeof api.getPublicSession === 'function') {
      try {
        var fromApi = api.getPublicSession();
        if (fromApi && normalizeString(fromApi.uid) && normalizeString(fromApi.role) === 'public_user') {
          return fromApi;
        }
      } catch (_) {}
    }

    try {
      var raw = sessionStorage.getItem(PUBLIC_SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (normalizeString(parsed.role) !== 'public_user') return null;
      if (!normalizeString(parsed.uid)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function getPortalHomeContext() {
    if (parseInstitutionSession()) return 'institution';
    if (parsePublicSession()) return 'public';
    return 'guest';
  }

  function resolvePortalHomeHref() {
    return getPortalHomeContext() === 'institution' ? INSTITUTION_HOME : PUBLIC_HOME;
  }

  function applyPortalHomeLinks(root) {
    var href = resolvePortalHomeHref();
    var scope = root && root.querySelectorAll ? root : document;
    var links = scope.querySelectorAll(PORTAL_HOME_SELECTOR);
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute('href', href);
    }
  }

  function bindAuthRefresh() {
    if (authListenerBound) return;
    var fb = window.SA_WEB_FIREBASE;
    if (!fb || !fb.ready || !fb.auth || typeof fb.auth.onAuthStateChanged !== 'function') {
      return;
    }
    authListenerBound = true;
    fb.auth.onAuthStateChanged(function () {
      applyPortalHomeLinks();
    });
  }

  function init() {
    if (initialized) return;
    var hasPortalLinks = document.querySelector(PORTAL_HOME_SELECTOR);
    if (!hasPortalLinks) return;
    initialized = true;

    applyPortalHomeLinks();
    bindAuthRefresh();
  }

  window.SA_WEB_MODULE_NAV = {
    getPortalHomeContext: getPortalHomeContext,
    resolvePortalHomeHref: resolvePortalHomeHref,
    applyPortalHomeLinks: applyPortalHomeLinks
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('load', function () {
    applyPortalHomeLinks();
  });
})();
