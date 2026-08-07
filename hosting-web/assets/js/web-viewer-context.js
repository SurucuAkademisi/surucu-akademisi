/**
 * Shared read-only viewer context for public-web modules.
 * UI state only — does not unlock Firestore or fabricate Auth identity.
 */
(function () {
  'use strict';

  var AUTH_WAIT_MS = 8000;
  var KIND = {
    PENDING: 'pending',
    PUBLIC: 'public',
    INSTITUTION: 'institution',
    GUEST: 'guest',
    ERROR: 'error'
  };

  var readyPromise = null;
  var authUnsub = null;
  var authSettled = false;
  var lastResult = null;

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth) return fb.auth;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.auth) {
      return window.firebase.auth();
    }
    return null;
  }

  function getAuthUser() {
    var auth = getAuth();
    return auth && auth.currentUser ? auth.currentUser : null;
  }

  function getAuthUid() {
    var user = getAuthUser();
    return user && user.uid ? normalizeString(user.uid) : '';
  }

  function readPublicSession() {
    var api = window.SA_PUBLIC_SESSION;
    if (api && typeof api.getPublicSession === 'function') {
      try {
        return api.getPublicSession();
      } catch (_) {
        return null;
      }
    }
    try {
      var raw = sessionStorage.getItem('sa_public_session_v1');
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

  function readWebSessionRaw() {
    var api = window.SA_WEB_SESSION;
    if (api && typeof api.getWebSession === 'function') {
      try {
        return api.getWebSession();
      } catch (_) {
        return null;
      }
    }
    try {
      var raw = sessionStorage.getItem('sa_web_session_v1');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function readInstitutionSessionMatched() {
    var api = window.SA_WEB_SESSION;
    if (api && typeof api.requireWebStudentSession === 'function') {
      try {
        return api.requireWebStudentSession();
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function hasValidPublicSessionShape(session) {
    return !!(
      session &&
      normalizeString(session.uid) &&
      normalizeString(session.role) === 'public_user'
    );
  }

  function hasValidWebSessionShape(session) {
    return !!(session && normalizeString(session.uid) && normalizeString(session.tenantId));
  }

  function makeResult(kind, extras) {
    var base = {
      kind: kind,
      uid: null,
      authUser: getAuthUser(),
      publicSession: null,
      institutionSession: null,
      reason: ''
    };
    if (extras && typeof extras === 'object') {
      Object.keys(extras).forEach(function (key) {
        base[key] = extras[key];
      });
    }
    if (!base.uid && base.authUser && base.authUser.uid) {
      base.uid = normalizeString(base.authUser.uid);
    }
    return base;
  }

  function evaluateContext(options) {
    var opts = options || {};
    var forceFinal = !!opts.forceFinal;
    var publicSession = readPublicSession();
    var webSession = readWebSessionRaw();
    var authUid = getAuthUid();
    var hasPublic = hasValidPublicSessionShape(publicSession);
    var hasWeb = hasValidWebSessionShape(webSession);

    if (hasWeb && authUid && authUid === normalizeString(webSession.uid)) {
      var institution = readInstitutionSessionMatched() || webSession;
      if (hasValidWebSessionShape(institution)) {
        return makeResult(KIND.INSTITUTION, {
          uid: normalizeString(institution.uid),
          institutionSession: institution,
          publicSession: hasPublic ? publicSession : null,
          reason: 'institution_matched'
        });
      }
    }

    if (hasPublic && authUid && authUid === normalizeString(publicSession.uid)) {
      return makeResult(KIND.PUBLIC, {
        uid: normalizeString(publicSession.uid),
        publicSession: publicSession,
        reason: 'public_matched'
      });
    }

    if (hasWeb || hasPublic) {
      if (!authUid) {
        // Session present — never finalize as guest; wait until timeout before error.
        if (!forceFinal) {
          return makeResult(KIND.PENDING, {
            publicSession: hasPublic ? publicSession : null,
            institutionSession: hasWeb ? webSession : null,
            reason: 'waiting_auth_restore'
          });
        }
        return makeResult(KIND.ERROR, {
          publicSession: hasPublic ? publicSession : null,
          institutionSession: hasWeb ? webSession : null,
          reason: hasWeb ? 'institution_session_without_auth' : 'public_session_without_auth'
        });
      }

      return makeResult(KIND.ERROR, {
        publicSession: hasPublic ? publicSession : null,
        institutionSession: hasWeb ? webSession : null,
        reason: 'session_auth_uid_mismatch'
      });
    }

    if (authUid) {
      return makeResult(KIND.ERROR, {
        uid: authUid,
        reason: 'auth_without_portal_session'
      });
    }

    if (!authSettled && !forceFinal) {
      return makeResult(KIND.PENDING, { reason: 'waiting_auth_settle' });
    }

    return makeResult(KIND.GUEST, { reason: 'definitive_guest' });
  }

  function clearAuthListener() {
    if (authUnsub) {
      try {
        authUnsub();
      } catch (_) {}
      authUnsub = null;
    }
  }

  function whenReady() {
    if (readyPromise) return readyPromise;

    readyPromise = new Promise(function (resolve) {
      var settled = false;
      var timeoutId = null;

      function finish(result) {
        if (settled) return;
        if (!result || result.kind === KIND.PENDING) return;
        settled = true;
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        clearAuthListener();
        lastResult = result;
        resolve(result);
      }

      function attempt(forceFinal) {
        finish(evaluateContext({ forceFinal: !!forceFinal }));
      }

      var auth = getAuth();
      if (!auth || typeof auth.onAuthStateChanged !== 'function') {
        authSettled = true;
        attempt(true);
        if (!settled) {
          finish(makeResult(KIND.ERROR, { reason: 'auth_api_missing' }));
        }
        return;
      }

      // Single shared observer for this document.
      authUnsub = auth.onAuthStateChanged(function () {
        authSettled = true;
        attempt(false);
      });

      // Also evaluate current snapshot (may already be matched).
      attempt(false);

      timeoutId = window.setTimeout(function () {
        authSettled = true;
        var result = evaluateContext({ forceFinal: true });
        if (result.kind === KIND.PENDING) {
          result = makeResult(KIND.ERROR, { reason: 'auth_wait_timeout' });
        }
        finish(result);
      }, AUTH_WAIT_MS);
    });

    return readyPromise;
  }

  function getSnapshot() {
    if (lastResult) return lastResult;
    return evaluateContext({ forceFinal: false });
  }

  function isAuthenticatedKind(kind) {
    return kind === KIND.PUBLIC || kind === KIND.INSTITUTION;
  }

  window.SA_VIEWER_CONTEXT = {
    KIND: KIND,
    AUTH_WAIT_MS: AUTH_WAIT_MS,
    whenReady: whenReady,
    getSnapshot: getSnapshot,
    evaluateContext: evaluateContext,
    isAuthenticatedKind: isAuthenticatedKind
  };
})();
