/**
 * Public (bireysel) mobile session — separate from institution tenant session and web sa_public_session_v1.
 */
(function () {
  'use strict';

  var PUBLIC_MOBILE_SESSION_KEY = 'sa_public_mobile_session_v1';

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function buildSessionPayload(source) {
    var data = source && typeof source === 'object' ? source : {};
    var firstName = normalizeString(data.firstName);
    var lastName = normalizeString(data.lastName);
    var displayName = normalizeString(data.displayName);
    if (!displayName) {
      displayName = (firstName + ' ' + lastName).trim() || normalizeString(data.email).split('@')[0] || 'Üye';
    }
    return {
      uid: normalizeString(data.uid),
      email: normalizeString(data.email).toLowerCase(),
      firstName: firstName,
      lastName: lastName,
      displayName: displayName,
      role: 'public_user',
      accountType: 'public',
      savedAt: data.savedAt || Date.now()
    };
  }

  function setPublicUserSession(profile) {
    var payload = buildSessionPayload(profile);
    if (!payload.uid) return false;
    try {
      sessionStorage.setItem(PUBLIC_MOBILE_SESSION_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn('[SA_PUBLIC_USER_SESSION] setPublicUserSession failed', e);
      return false;
    }
  }

  function getPublicUserSession() {
    try {
      var raw = sessionStorage.getItem(PUBLIC_MOBILE_SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (normalizeString(parsed.role) !== 'public_user') return null;
      if (!normalizeString(parsed.uid)) return null;
      return parsed;
    } catch (e) {
      console.warn('[SA_PUBLIC_USER_SESSION] getPublicUserSession failed', e);
      return null;
    }
  }

  function clearPublicUserSession() {
    try {
      sessionStorage.removeItem(PUBLIC_MOBILE_SESSION_KEY);
    } catch (e) {
      console.warn('[SA_PUBLIC_USER_SESSION] clearPublicUserSession failed', e);
    }
  }

  function isPublicUserSessionActive() {
    return !!getPublicUserSession();
  }

  function getCurrentUserMode() {
    return isPublicUserSessionActive() ? 'public' : 'institution';
  }

  window.SA_PUBLIC_USER_SESSION = {
    PUBLIC_MOBILE_SESSION_KEY: PUBLIC_MOBILE_SESSION_KEY,
    setPublicUserSession: setPublicUserSession,
    getPublicUserSession: getPublicUserSession,
    clearPublicUserSession: clearPublicUserSession,
    isPublicUserSessionActive: isPublicUserSessionActive,
    getCurrentUserMode: getCurrentUserMode
  };
})();
