/**
 * Web lesson unit completion progress (read/write summary docs only).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web lesson progress]';

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
        username: normalizeString(session.username) || null,
        email: null
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

    var email = normalizeString(session.email) || normalizeString(user.email) || null;

    return {
      kind: 'public_user',
      uid: uid,
      tenantId: null,
      tenantName: null,
      displayName: normalizeString(session.displayName) || null,
      username: null,
      email: email
    };
  }

  function resolveProgressContext() {
    var institution = resolveInstitutionContext();
    if (institution) return institution;

    var pub = resolvePublicContext();
    if (pub) return pub;

    return { kind: 'guest' };
  }

  function buildProgressId(categoryId, unitId) {
    var cid = normalizeString(categoryId);
    var uid = normalizeString(unitId);
    if (!cid || !uid) return '';
    return cid + '__' + uid;
  }

  function getProgressRef(context, progressId) {
    var db = getDb();
    if (!db || !context || !progressId) return null;

    if (context.kind === 'institution_student') {
      return db
        .collection('tenants')
        .doc(context.tenantId)
        .collection('lesson_progress')
        .doc(progressId);
    }

    if (context.kind === 'public_user') {
      return db
        .collection('users')
        .doc(context.uid)
        .collection('web_lesson_progress')
        .doc(progressId);
    }

    return null;
  }

  function isProgressCompleted(data) {
    if (!data || typeof data !== 'object') return false;
    if (normalizeString(data.status) === 'completed') return true;
    if (data.completed === true) return true;
    var pct = Number(data.progressPercent);
    return isFinite(pct) && pct >= 100;
  }

  function getUserLessonProgressRef(uid, unitId) {
    var db = getDb();
    var userId = normalizeString(uid);
    var uId = normalizeString(unitId);
    if (!db || !userId || !uId) return null;
    return db.collection('users').doc(userId).collection('lessonProgress').doc(uId);
  }

  function getTenantLessonProgressRef(tenantId, progressId) {
    var db = getDb();
    var tid = normalizeString(tenantId);
    var pid = normalizeString(progressId);
    if (!db || !tid || !pid) return null;
    return db.collection('tenants').doc(tid).collection('lesson_progress').doc(pid);
  }

  function getWebLessonProgressRef(uid, progressId) {
    var db = getDb();
    var userId = normalizeString(uid);
    var pid = normalizeString(progressId);
    if (!db || !userId || !pid) return null;
    return db.collection('users').doc(userId).collection('web_lesson_progress').doc(pid);
  }

  async function readDocCompleted(ref) {
    if (!ref) return { completed: false, exists: false };
    try {
      var snap = await ref.get();
      if (!snap.exists) return { completed: false, exists: false };
      var data = snap.data() || {};
      return { completed: isProgressCompleted(data), exists: true, data: data };
    } catch (e) {
      console.warn(LOG_PREFIX + ' read doc failed', e);
      return { completed: false, exists: false, error: e };
    }
  }

  function mergeProgressEntry(existing, patch) {
    var base = existing || { completed: false, sources: {} };
    var sources = Object.assign({}, base.sources || {}, patch.sources || {});
    return {
      completed: !!(base.completed || patch.completed),
      sources: sources
    };
  }

  async function fetchLessonProgressMapForUnits(context, categoryId, unitIds) {
    var ctx = context || resolveProgressContext();
    var catId = normalizeString(categoryId);
    var ids = Array.isArray(unitIds)
      ? unitIds.map(function (id) { return normalizeString(id); }).filter(Boolean)
      : [];

    if (!ctx || ctx.kind === 'guest' || !normalizeString(ctx.uid) || !ids.length) {
      return {};
    }

    var map = {};
    var tasks = ids.map(function (unitId) {
      return (async function () {
        var progressId = buildProgressId(catId, unitId);
        var entry = { completed: false, sources: {} };

        if (ctx.kind === 'institution_student' && ctx.tenantId && progressId) {
          var tenantRef = getTenantLessonProgressRef(ctx.tenantId, progressId);
          var tenantResult = await readDocCompleted(tenantRef);
          if (tenantResult.completed) {
            entry = mergeProgressEntry(entry, { completed: true, sources: { tenant: true } });
          }
        }

        if (ctx.kind === 'public_user' && progressId) {
          var webRef = getWebLessonProgressRef(ctx.uid, progressId);
          var webResult = await readDocCompleted(webRef);
          if (webResult.completed) {
            entry = mergeProgressEntry(entry, { completed: true, sources: { web: true } });
          }
        }

        var userRef = getUserLessonProgressRef(ctx.uid, unitId);
        var userResult = await readDocCompleted(userRef);
        if (userResult.completed) {
          entry = mergeProgressEntry(entry, { completed: true, sources: { user: true } });
        }

        map[unitId] = entry;
      })();
    });

    try {
      await Promise.all(tasks);
    } catch (e) {
      console.warn(LOG_PREFIX + ' fetchLessonProgressMapForUnits failed', e);
    }

    return map;
  }

  function isUnitCompletedInMap(progressMap, categoryId, unitId) {
    var uId = normalizeString(unitId);
    if (!uId || !progressMap || typeof progressMap !== 'object') return false;
    var entry = progressMap[uId];
    return !!(entry && entry.completed === true);
  }

  async function getLessonProgressStatus(context, categoryId, unitId) {
    var ctx = context || resolveProgressContext();
    if (!ctx || ctx.kind === 'guest') {
      return { ok: true, skipped: true, completed: false, exists: false };
    }

    var progressId = buildProgressId(categoryId, unitId);
    if (!progressId) {
      return { ok: false, completed: false, exists: false, error: 'invalid_ids' };
    }

    var ref = getProgressRef(ctx, progressId);
    if (!ref) {
      return { ok: false, completed: false, exists: false, error: 'ref_unavailable' };
    }

    try {
      var snap = await ref.get();
      if (!snap.exists) {
        return { ok: true, completed: false, exists: false, progressId: progressId };
      }
      var data = snap.data() || {};
      return {
        ok: true,
        completed: isProgressCompleted(data),
        exists: true,
        progressId: progressId,
        data: data
      };
    } catch (e) {
      console.warn(LOG_PREFIX + ' get status failed', e);
      return { ok: false, completed: false, exists: false, error: e };
    }
  }

  function buildProgressPayload(context, input, existingData) {
    var ctx = context || {};
    var data = input || {};
    var FieldValue = getFieldValue();
    var existing = existingData || {};

    var payload = {
      uid: ctx.uid,
      userType: ctx.kind === 'institution_student' ? 'institution_student' : 'public_user',
      categoryId: normalizeString(data.categoryId),
      categoryTitle: normalizeString(data.categoryTitle) || null,
      unitId: normalizeString(data.unitId),
      unitTitle: normalizeString(data.unitTitle) || null,
      status: 'completed',
      completed: true,
      source: 'web',
      platform: 'web'
    };

    if (ctx.kind === 'institution_student') {
      payload.tenantId = ctx.tenantId;
      if (ctx.tenantName) payload.tenantName = ctx.tenantName;
      if (ctx.displayName) payload.displayName = ctx.displayName;
      if (ctx.username) payload.username = ctx.username;
    } else if (ctx.kind === 'public_user') {
      if (ctx.displayName) payload.displayName = ctx.displayName;
      if (ctx.email) payload.email = ctx.email;
    }

    if (FieldValue && FieldValue.serverTimestamp) {
      payload.completedAt = FieldValue.serverTimestamp();
      payload.updatedAt = FieldValue.serverTimestamp();
      if (!existing.createdAt) {
        payload.createdAt = FieldValue.serverTimestamp();
      }
    }

    return payload;
  }

  function buildMirrorPayload(context, payload) {
    var ctx = context || {};
    var data = payload || {};
    var FieldValue = getFieldValue();
    var mirror = {
      categoryId: normalizeString(data.categoryId),
      unitId: normalizeString(data.unitId),
      completed: true,
      status: 'completed',
      progressPercent: 100,
      source: 'web',
      platform: 'web',
      userType: ctx.kind === 'institution_student' ? 'institution_student' : 'public_user'
    };

    if (ctx.kind === 'institution_student' && ctx.tenantId) {
      mirror.tenantId = ctx.tenantId;
    }

    if (FieldValue && FieldValue.serverTimestamp) {
      mirror.completedAt = FieldValue.serverTimestamp();
      mirror.updatedAt = FieldValue.serverTimestamp();
      mirror.lastSeenAt = FieldValue.serverTimestamp();
    }

    return mirror;
  }

  async function writeMirrorLessonProgress(context, payload) {
    var ctx = context || {};
    var unitId = normalizeString(payload && payload.unitId);
    if (!ctx.uid || !unitId || ctx.kind === 'guest') {
      return { ok: false, skipped: true, reason: 'invalid_mirror_context' };
    }

    var mirrorRef = getUserLessonProgressRef(ctx.uid, unitId);
    if (!mirrorRef) {
      return { ok: false, skipped: true, reason: 'mirror_ref_unavailable' };
    }

    try {
      await mirrorRef.set(buildMirrorPayload(ctx, payload), { merge: true });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' mirror write failed', e);
      return { ok: false, error: e };
    }
  }

  async function markLessonCompleted(context, payload) {
    var ctx = context || resolveProgressContext();
    if (!ctx || ctx.kind === 'guest') {
      return { ok: false, skipped: true, reason: 'guest_or_unauthenticated' };
    }

    var progressId = buildProgressId(payload && payload.categoryId, payload && payload.unitId);
    if (!progressId) {
      return { ok: false, skipped: true, reason: 'invalid_ids' };
    }

    var ref = getProgressRef(ctx, progressId);
    if (!ref) {
      return { ok: false, skipped: true, reason: 'ref_unavailable' };
    }

    var existingData = null;
    try {
      var existingSnap = await ref.get();
      if (existingSnap.exists) {
        existingData = existingSnap.data() || {};
      }
    } catch (e) {
      console.warn(LOG_PREFIX + ' existing read failed', e);
    }

    var docPayload = buildProgressPayload(ctx, payload, existingData);

    try {
      await ref.set(docPayload, { merge: true });
      var mirrorResult = await writeMirrorLessonProgress(ctx, payload);
      if (!mirrorResult.ok && !mirrorResult.skipped) {
        console.warn(LOG_PREFIX + ' canonical ok but mirror failed', mirrorResult.error || mirrorResult);
      }
      return {
        ok: true,
        progressId: progressId,
        userType: ctx.kind,
        mirrorOk: !!(mirrorResult && mirrorResult.ok)
      };
    } catch (e) {
      console.warn(LOG_PREFIX + ' mark completed failed', e);
      return { ok: false, error: e };
    }
  }

  window.SA_WEB_LESSON_PROGRESS = {
    resolveProgressContext: resolveProgressContext,
    buildProgressId: buildProgressId,
    getLessonProgressStatus: getLessonProgressStatus,
    markLessonCompleted: markLessonCompleted,
    fetchLessonProgressMapForUnits: fetchLessonProgressMapForUnits,
    isUnitCompletedInMap: isUnitCompletedInMap
  };
})();
