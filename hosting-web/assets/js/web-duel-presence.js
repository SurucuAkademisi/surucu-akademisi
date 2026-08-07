/**
 * Web duel lobby presence — own doc write + online user snapshots (W1).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-duel-presence]';
  var GLOBAL_TENANT_ID = '__global__';
  var ONLINE_QUERY_LIMIT = 50;
  var ONLINE_MAX_AGE_MS = 2 * 60 * 1000;
  var HEARTBEAT_INTERVAL_MS = 45 * 1000;

  var onlineUnsubs = [];
  var heartbeatTimerId = null;
  var heartbeatContextKey = null;

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth) return fb.auth;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.auth) {
      return window.firebase.auth();
    }
    return null;
  }

  function getFieldValue() {
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore.FieldValue;
    }
    return null;
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function resolveInstitutionContext() {
    var sessionApi = window.SA_WEB_SESSION;
    if (!sessionApi || typeof sessionApi.requireWebStudentSession !== 'function') {
      return null;
    }
    try {
      var session = sessionApi.requireWebStudentSession();
      if (!session || !session.uid || !session.tenantId) return null;
      return {
        kind: 'institution_student',
        uid: normalizeString(session.uid),
        tenantId: normalizeString(session.tenantId),
        tenantName: normalizeString(session.tenantName) || null,
        displayName: normalizeString(session.displayName) || null,
        username: normalizeString(session.username) || null
      };
    } catch (_) {
      return null;
    }
  }

  function resolvePublicContext() {
    var sessionApi = window.SA_PUBLIC_SESSION;
    if (!sessionApi || typeof sessionApi.getPublicSession !== 'function') return null;

    var session = sessionApi.getPublicSession();
    if (!session || normalizeString(session.role) !== 'public_user') return null;

    var uid = normalizeString(session.uid);
    if (!uid) return null;

    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user || !user.uid || normalizeString(user.uid) !== uid) return null;

    var displayName =
      normalizeString(session.displayName) ||
      normalizeString(session.firstName) ||
      (normalizeString(session.email).split('@')[0] || '') ||
      'Üye';

    return {
      kind: 'public_user',
      uid: uid,
      tenantId: GLOBAL_TENANT_ID,
      tenantName: null,
      displayName: displayName,
      username: null
    };
  }

  function hasPublicSessionWithoutAuthMatch() {
    var sessionApi = window.SA_PUBLIC_SESSION;
    if (!sessionApi || typeof sessionApi.getPublicSession !== 'function') return false;
    var session = sessionApi.getPublicSession();
    if (!session || normalizeString(session.role) !== 'public_user') return false;
    var uid = normalizeString(session.uid);
    if (!uid) return false;
    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    return !user || !user.uid || normalizeString(user.uid) !== uid;
  }

  function hasWebSessionWithoutAuthMatch() {
    var sessionApi = window.SA_WEB_SESSION;
    if (!sessionApi) return false;
    var session = typeof sessionApi.getWebSession === 'function' ? sessionApi.getWebSession() : null;
    if (!session || !normalizeString(session.uid) || !normalizeString(session.tenantId)) return false;
    var matched =
      typeof sessionApi.requireWebStudentSession === 'function'
        ? sessionApi.requireWebStudentSession()
        : null;
    return !matched;
  }

  function resolveDuelContext() {
    var institution = resolveInstitutionContext();
    if (institution) return institution;

    var pub = resolvePublicContext();
    if (pub) return pub;

    if (hasWebSessionWithoutAuthMatch() || hasPublicSessionWithoutAuthMatch()) {
      return { kind: 'unresolved' };
    }

    return { kind: 'guest' };
  }

  function buildPresencePayload(context) {
    var ctx = context || {};
    var FieldValue = getFieldValue();
    var displayName =
      normalizeString(ctx.displayName) ||
      normalizeString(ctx.username) ||
      (ctx.kind === 'public_user' ? 'Üye' : 'Öğrenci');

    var payload = {
      uid: ctx.uid,
      displayName: displayName,
      tenantId: ctx.kind === 'institution_student' ? ctx.tenantId : GLOBAL_TENANT_ID,
      isStudent: true,
      userType: ctx.kind === 'institution_student' ? 'institution_student' : 'public_user',
      platform: 'web'
    };

    if (ctx.username) payload.username = ctx.username;
    if (ctx.kind === 'institution_student' && ctx.tenantName) {
      payload.tenantName = ctx.tenantName;
    }

    if (FieldValue && FieldValue.serverTimestamp) {
      payload.lastSeen = FieldValue.serverTimestamp();
      payload.updatedAt = FieldValue.serverTimestamp();
    }

    return payload;
  }

  function lastSeenMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
  }

  function mapPresenceDoc(id, data, nowMs) {
    var raw = data || {};
    var seenMs = lastSeenMillis(raw.lastSeen);
    var online = seenMs > 0 && nowMs - seenMs <= ONLINE_MAX_AGE_MS;
    return {
      uid: normalizeString(id),
      displayName: normalizeString(raw.displayName) || 'Kullanıcı',
      tenantId: normalizeString(raw.tenantId) || null,
      lastSeenMs: seenMs,
      online: online
    };
  }

  async function writeOwnPresence(context) {
    var ctx = context || resolveDuelContext();
    if (!ctx || ctx.kind === 'guest') {
      return { ok: false, skipped: true, reason: 'guest' };
    }

    var db = getDb();
    if (!db) {
      return { ok: false, skipped: true, reason: 'db_unavailable' };
    }

    var payload = buildPresencePayload(ctx);
    if (!payload.uid) {
      return { ok: false, skipped: true, reason: 'invalid_uid' };
    }

    try {
      await db.collection('duel_presence').doc(payload.uid).set(payload, { merge: true });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' write failed', e);
      return { ok: false, error: e };
    }
  }

  function resolveScope(context, options) {
    var opts = options || {};
    var scope = normalizeString(opts.scope);
    // publicGlobal historically filtered tenantId==__global__ and hid institution users.
    // Türkiye Geneli must use the shared duel pool (isStudent==true).
    if (scope === 'publicGlobal') {
      return 'global';
    }
    if (scope === 'tenant' || scope === 'global') {
      return scope;
    }
    if (!context || context.kind === 'guest') return null;
    if (context.kind === 'institution_student') return 'tenant';
    return 'global';
  }

  function processSnapshotDocs(docs, ctx, nowMs) {
    var users = [];
    var list = docs || [];
    for (var i = 0; i < list.length; i++) {
      var doc = list[i];
      if (!doc || !doc.id) continue;
      if (normalizeString(doc.id) === normalizeString(ctx.uid)) continue;
      var mapped = mapPresenceDoc(doc.id, doc.data(), nowMs);
      if (mapped.online) users.push(mapped);
    }
    users.sort(function (a, b) {
      return (b.lastSeenMs || 0) - (a.lastSeenMs || 0);
    });
    return users;
  }

  function addOnlineUnsub(unsub) {
    if (typeof unsub !== 'function') return;
    onlineUnsubs.push(unsub);
  }

  function subscribeOnlineUsers(context, callback, options) {
    var ctx = context || resolveDuelContext();
    var scope = resolveScope(ctx, options);

    if (!ctx || ctx.kind === 'guest' || !scope) {
      if (typeof callback === 'function') callback({ ok: true, users: [], skipped: true, scope: scope });
      return function () {};
    }

    var db = getDb();
    if (!db) {
      if (typeof callback === 'function') {
        callback({ ok: false, users: [], error: 'db_unavailable', scope: scope });
      }
      return function () {};
    }

    var queryRef = db.collection('duel_presence');
    if (scope === 'global') {
      queryRef = queryRef.where('isStudent', '==', true);
    } else {
      var tenantFilter =
        scope === 'tenant' ? normalizeString(ctx.tenantId) : GLOBAL_TENANT_ID;
      if (!tenantFilter) {
        if (typeof callback === 'function') {
          callback({ ok: false, users: [], error: 'invalid_tenant', scope: scope });
        }
        return function () {};
      }
      queryRef = queryRef
        .where('tenantId', '==', tenantFilter)
        .where('isStudent', '==', true);
    }

    try {
      var unsub = queryRef.limit(ONLINE_QUERY_LIMIT).onSnapshot(
        function (snap) {
          var nowMs = Date.now();
          var docs = snap && snap.docs ? snap.docs : [];
          var users = processSnapshotDocs(docs, ctx, nowMs);
          if (typeof callback === 'function') {
            callback({ ok: true, users: users, scope: scope });
          }
        },
        function (err) {
          console.warn(LOG_PREFIX + ' online snapshot failed (' + scope + ')', err);
          if (typeof callback === 'function') {
            callback({ ok: false, users: [], error: err, scope: scope });
          }
        }
      );
      addOnlineUnsub(unsub);
      return unsub;
    } catch (e) {
      console.warn(LOG_PREFIX + ' subscribe failed (' + scope + ')', e);
      if (typeof callback === 'function') {
        callback({ ok: false, users: [], error: e, scope: scope });
      }
      return function () {};
    }
  }

  function subscribeOnlineUsersGlobal(context, callback) {
    return subscribeOnlineUsers(context, callback, { scope: 'global' });
  }

  function subscribeOnlineUsersTenant(context, callback) {
    return subscribeOnlineUsers(context, callback, { scope: 'tenant' });
  }

  function cleanupPresenceListeners() {
    onlineUnsubs.forEach(function (unsub) {
      if (typeof unsub === 'function') {
        try {
          unsub();
        } catch (_) {}
      }
    });
    onlineUnsubs = [];
  }

  function contextHeartbeatKey(ctx) {
    if (!ctx || !ctx.uid) return '';
    return (ctx.kind || 'unknown') + ':' + normalizeString(ctx.uid);
  }

  function stopPresenceHeartbeat() {
    if (heartbeatTimerId) {
      window.clearInterval(heartbeatTimerId);
      heartbeatTimerId = null;
    }
    heartbeatContextKey = null;
  }

  function startPresenceHeartbeat(context) {
    var ctx = context || resolveDuelContext();
    if (!ctx || ctx.kind === 'guest' || !ctx.uid) {
      stopPresenceHeartbeat();
      return;
    }

    var key = contextHeartbeatKey(ctx);
    if (heartbeatTimerId && heartbeatContextKey === key) {
      return;
    }

    stopPresenceHeartbeat();
    heartbeatContextKey = key;

    writeOwnPresence(ctx).catch(function (e) {
      console.warn(LOG_PREFIX + ' heartbeat initial write failed', e);
    });

    heartbeatTimerId = window.setInterval(function () {
      writeOwnPresence(ctx).catch(function (e) {
        console.warn(LOG_PREFIX + ' heartbeat write failed', e);
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  window.SA_WEB_DUEL_PRESENCE = {
    GLOBAL_TENANT_ID: GLOBAL_TENANT_ID,
    resolveDuelContext: resolveDuelContext,
    buildPresencePayload: buildPresencePayload,
    writeOwnPresence: writeOwnPresence,
    startPresenceHeartbeat: startPresenceHeartbeat,
    stopPresenceHeartbeat: stopPresenceHeartbeat,
    subscribeOnlineUsers: subscribeOnlineUsers,
    subscribeOnlineUsersGlobal: subscribeOnlineUsersGlobal,
    subscribeOnlineUsersTenant: subscribeOnlineUsersTenant,
    cleanupPresenceListeners: cleanupPresenceListeners
  };
})();
