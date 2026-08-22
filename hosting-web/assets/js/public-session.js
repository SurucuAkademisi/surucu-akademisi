/**
 * Public portal session (P2.2b) — sessionStorage only.
 * Do NOT use sa_web_session_v1 (institution student).
 *
 * Session `role` is the PORTAL session kind (`public_user`), not necessarily
 * Firestore users.role. Dual-program Machine students keep authRole=student
 * with ehliyetEntitlement=public after server attach.
 */
(function () {
  'use strict';

  var PUBLIC_SESSION_KEY = 'sa_public_session_v1';

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function savePublicSession(session) {
    if (!session || typeof session !== 'object') return false;

    var authRole = normalizeString(session.authRole).toLowerCase();
    if (authRole !== 'student') authRole = 'public_user';

    var ehliyetEntitlement = normalizeString(session.ehliyetEntitlement).toLowerCase();
    if (!ehliyetEntitlement) ehliyetEntitlement = 'public';
    if (ehliyetEntitlement !== 'public') return false;

    if (authRole === 'student' && ehliyetEntitlement !== 'public') return false;

    var payload = {
      uid: normalizeString(session.uid),
      email: normalizeString(session.email),
      firstName: normalizeString(session.firstName),
      lastName: normalizeString(session.lastName),
      displayName: normalizeString(session.displayName),
      role: 'public_user',
      authRole: authRole,
      ehliyetEntitlement: ehliyetEntitlement,
      savedAt: session.savedAt || Date.now()
    };

    if (!payload.uid) return false;

    try {
      sessionStorage.setItem(PUBLIC_SESSION_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn('[public-session] savePublicSession failed', e);
      return false;
    }
  }

  function getPublicSession() {
    try {
      var raw = sessionStorage.getItem(PUBLIC_SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (normalizeString(parsed.role) !== 'public_user') return null;
      if (!normalizeString(parsed.uid)) return null;

      var authRole = normalizeString(parsed.authRole).toLowerCase();
      var ehliyetEntitlement = normalizeString(parsed.ehliyetEntitlement).toLowerCase();

      // Legacy sessions (no authRole / ehliyetEntitlement) remain valid.
      if (!authRole && !ehliyetEntitlement) {
        return parsed;
      }

      if (!authRole) authRole = 'public_user';
      if (authRole !== 'public_user' && authRole !== 'student') return null;

      if (ehliyetEntitlement && ehliyetEntitlement !== 'public') return null;

      // Dual-program sessions must carry explicit public entitlement.
      if (authRole === 'student' && ehliyetEntitlement !== 'public') return null;

      parsed.authRole = authRole;
      if (ehliyetEntitlement) parsed.ehliyetEntitlement = ehliyetEntitlement;
      return parsed;
    } catch (e) {
      console.warn('[public-session] getPublicSession failed', e);
      return null;
    }
  }

  function clearPublicSession() {
    try {
      sessionStorage.removeItem(PUBLIC_SESSION_KEY);
    } catch (e) {
      console.warn('[public-session] clearPublicSession failed', e);
    }
  }

  window.SA_PUBLIC_SESSION = {
    PUBLIC_SESSION_KEY: PUBLIC_SESSION_KEY,
    savePublicSession: savePublicSession,
    getPublicSession: getPublicSession,
    clearPublicSession: clearPublicSession
  };
})();
