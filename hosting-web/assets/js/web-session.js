/**
 * Student web session (W3) — sessionStorage only, no Firestore writes.
 */
(function () {
  'use strict';

  var SELECTED_TENANT_KEY = 'sa_selected_tenant_id';
  var WEB_SESSION_KEY = 'sa_web_session_v1';

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function saveSelectedTenantId(tenantId) {
    var v = normalizeString(tenantId);
    try {
      if (v) {
        sessionStorage.setItem(SELECTED_TENANT_KEY, v);
      } else {
        sessionStorage.removeItem(SELECTED_TENANT_KEY);
      }
    } catch (e) {
      console.warn('[web-session] saveSelectedTenantId failed', e);
    }
  }

  function getSelectedTenantId() {
    try {
      var v = sessionStorage.getItem(SELECTED_TENANT_KEY);
      return normalizeString(v) || null;
    } catch (e) {
      return null;
    }
  }

  function saveWebSession(session) {
    if (!session || typeof session !== 'object') return false;
    var payload = {
      uid: normalizeString(session.uid),
      tenantId: normalizeString(session.tenantId),
      tenantName: normalizeString(session.tenantName),
      tenantRole: normalizeString(session.tenantRole),
      membershipId: normalizeString(session.membershipId),
      username: normalizeString(session.username),
      displayName: normalizeString(session.displayName),
      globalRole: normalizeString(session.globalRole),
      tenantLogoUrl: normalizeString(session.tenantLogoUrl),
      showInstitutionLogo: session.showInstitutionLogo !== false,
      savedAt: session.savedAt || Date.now()
    };
    try {
      sessionStorage.setItem(WEB_SESSION_KEY, JSON.stringify(payload));
      if (payload.tenantId) {
        saveSelectedTenantId(payload.tenantId);
      }
      return true;
    } catch (e) {
      console.warn('[web-session] saveWebSession failed', e);
      return false;
    }
  }

  function getWebSession() {
    try {
      var raw = sessionStorage.getItem(WEB_SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearWebSession() {
    try {
      sessionStorage.removeItem(WEB_SESSION_KEY);
      sessionStorage.removeItem(SELECTED_TENANT_KEY);
    } catch (e) {
      console.warn('[web-session] clearWebSession failed', e);
    }
  }

  function getAuth() {
    return window.SA_WEB_FIREBASE && window.SA_WEB_FIREBASE.auth
      ? window.SA_WEB_FIREBASE.auth
      : null;
  }

  /**
   * Returns session if Firebase user matches session uid; otherwise null.
   */
  function requireWebStudentSession() {
    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    var session = getWebSession();
    if (!user || !user.uid || !session || !session.uid) {
      return null;
    }
    if (session.uid !== user.uid) {
      return null;
    }
    if (!session.tenantId) {
      return null;
    }
    return session;
  }

  function logoutWebStudent() {
    clearWebSession();
    var auth = getAuth();
    if (auth && typeof auth.signOut === 'function') {
      return auth.signOut();
    }
    return Promise.resolve();
  }

  window.SA_WEB_SESSION = {
    SELECTED_TENANT_KEY: SELECTED_TENANT_KEY,
    WEB_SESSION_KEY: WEB_SESSION_KEY,
    saveSelectedTenantId: saveSelectedTenantId,
    getSelectedTenantId: getSelectedTenantId,
    saveWebSession: saveWebSession,
    getWebSession: getWebSession,
    clearWebSession: clearWebSession,
    requireWebStudentSession: requireWebStudentSession,
    logoutWebStudent: logoutWebStudent
  };
})();
