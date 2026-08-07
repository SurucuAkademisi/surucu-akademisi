/**
 * Web exam attempt summary writes (Phase 2A) — Firestore add only, no reads.
 */
(function () {
  'use strict';

  var EXAM_CONTENT_TENANT_ID = 'surucu_akademisi';
  var LOG_PREFIX = '[web exam attempts]';
  var MIRROR_LOG_PREFIX = '[ProgressWriteMirror]';

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

  function resolveAttemptContext() {
    var institution = resolveInstitutionContext();
    if (institution) return institution;

    var pub = resolvePublicContext();
    if (pub) return pub;

    return { kind: 'guest' };
  }

  function resolveExamContentTenantId() {
    var catalog = window.SA_WEB_EXAM_CATALOG;
    if (catalog && catalog.SHARED_EXAM_TENANT_ID) {
      return String(catalog.SHARED_EXAM_TENANT_ID).trim() || EXAM_CONTENT_TENANT_ID;
    }
    return EXAM_CONTENT_TENANT_ID;
  }

  function buildAttemptPayload(context, input) {
    var ctx = context || {};
    var data = input || {};
    var results = data.results || {};
    var FieldValue = getFieldValue();

    var payload = {
      uid: ctx.uid,
      userType: ctx.kind === 'institution_student' ? 'institution_student' : 'public_user',
      examId: normalizeString(data.examId),
      examTitle: normalizeString(data.examTitle) || null,
      category: normalizeString(data.category) || null,
      categoryLabel: normalizeString(data.categoryLabel) || null,
      examContentTenantId: resolveExamContentTenantId(),
      totalQuestions: Number(results.total) || 0,
      correctCount: Number(results.correct) || 0,
      wrongCount: Number(results.wrong) || 0,
      blankCount: Number(results.blank) || 0,
      scorePercent: Number(results.percentage) || 0,
      durationSeconds: Number(data.durationSeconds) || 0,
      timerExpiredAutoFinish: !!data.timerExpiredAutoFinish,
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

    if (data.startedAt) {
      payload.startedAt = data.startedAt;
    }

    if (FieldValue && FieldValue.serverTimestamp) {
      payload.completedAt = FieldValue.serverTimestamp();
      payload.createdAt = FieldValue.serverTimestamp();
    }

    return payload;
  }

  function buildPublicTenantMirrorPayload(primaryPayload, brandTenantId) {
    var p = primaryPayload || {};
    var scorePercent = Number(p.scorePercent) || 0;
    var durationSeconds = Number(p.durationSeconds) || 0;

    var mirror = {
      uid: p.uid,
      examId: p.examId,
      examTitle: p.examTitle || null,
      category: p.category || null,
      categoryLabel: p.categoryLabel || null,
      examContentTenantId: p.examContentTenantId || null,
      totalQuestions: p.totalQuestions,
      correctCount: p.correctCount,
      wrongCount: p.wrongCount,
      blankCount: p.blankCount,
      scorePercent: scorePercent,
      percentage: scorePercent,
      durationSeconds: durationSeconds,
      elapsedSeconds: durationSeconds,
      completedAt: p.completedAt,
      createdAt: p.createdAt,
      tenantId: brandTenantId,
      userType: 'public_user',
      source: 'web',
      platform: 'web',
      mirrorSource: 'users_web_exam_attempts'
    };

    if (p.displayName) mirror.displayName = p.displayName;
    if (p.email) mirror.email = p.email;
    if (p.startedAt) mirror.startedAt = p.startedAt;
    if (p.timerExpiredAutoFinish) mirror.timerExpiredAutoFinish = p.timerExpiredAutoFinish;

    return mirror;
  }

  async function savePublicExamAttemptWithMirror(db, context, payload) {
    var brandTenantId = resolveExamContentTenantId();
    var primaryRef = db.collection('users').doc(context.uid).collection('web_exam_attempts').doc();
    var mirrorRef = db
      .collection('tenants')
      .doc(brandTenantId)
      .collection('exam_attempts')
      .doc(primaryRef.id);

    try {
      var batch = db.batch();
      batch.set(primaryRef, payload);
      batch.set(mirrorRef, buildPublicTenantMirrorPayload(payload, brandTenantId));
      await batch.commit();
      return { ok: true, userType: context.kind, id: primaryRef.id, mirrorOk: true };
    } catch (batchErr) {
      console.warn(
        MIRROR_LOG_PREFIX + ' web public exam mirror batch failed, falling back to primary-only',
        batchErr
      );
      try {
        var fallbackRef = await db
          .collection('users')
          .doc(context.uid)
          .collection('web_exam_attempts')
          .add(payload);
        return { ok: true, userType: context.kind, id: fallbackRef.id, mirrorOk: false };
      } catch (fallbackErr) {
        console.warn(LOG_PREFIX + ' save failed', fallbackErr);
        return { ok: false, error: fallbackErr };
      }
    }
  }

  async function saveWebExamAttempt(input) {
    var context = resolveAttemptContext();
    if (!context || context.kind === 'guest') {
      return { ok: false, skipped: true, reason: 'guest_or_unauthenticated' };
    }

    var db = getDb();
    if (!db) {
      return { ok: false, skipped: true, reason: 'db_unavailable' };
    }

    var payload = buildAttemptPayload(context, input);
    if (!payload.uid || !payload.examId) {
      return { ok: false, skipped: true, reason: 'invalid_payload' };
    }

    try {
      if (context.kind === 'institution_student') {
        await db
          .collection('tenants')
          .doc(context.tenantId)
          .collection('exam_attempts')
          .add(payload);
      } else if (context.kind === 'public_user') {
        return await savePublicExamAttemptWithMirror(db, context, payload);
      } else {
        return { ok: false, skipped: true, reason: 'unknown_context' };
      }

      return { ok: true, userType: context.kind };
    } catch (e) {
      console.warn(LOG_PREFIX + ' save failed', e);
      return { ok: false, error: e };
    }
  }

  window.SA_WEB_EXAM_ATTEMPTS = {
    resolveAttemptContext: resolveAttemptContext,
    buildAttemptPayload: buildAttemptPayload,
    saveWebExamAttempt: saveWebExamAttempt
  };
})();
