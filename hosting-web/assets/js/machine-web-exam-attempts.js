/**
 * Machine web exam attempt persistence — mirrors mobile persistMachineExamAttempt.
 * source/platform = web. No Driving writer.
 */
(function () {
  'use strict';

  var PROGRAM_TYPE = 'machine_operator';
  var PLATFORM_TENANT_ID = 'surucu_akademisi';
  var CATEGORY_ALLOWLIST = ['work_machines', 'first_aid'];

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof firebase !== 'undefined' && firebase.firestore) return firebase.firestore();
    return null;
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth) return fb.auth;
    if (typeof firebase !== 'undefined' && firebase.auth) return firebase.auth();
    return null;
  }

  function isCategoryAllowed(categoryId) {
    return CATEGORY_ALLOWLIST.indexOf(normalizeString(categoryId)) >= 0;
  }

  function isPublicSession(session) {
    return !!(
      session &&
      (normalizeString(session.mode) === 'public' ||
        normalizeString(session.enrollmentSource) === 'public')
    );
  }

  function getMachineExamTenantId(session) {
    if (session && session.tenantId) {
      var tid = normalizeString(session.tenantId);
      if (tid) return tid;
    }
    var api = window.SA_MACHINE_WEB_SESSION;
    if (api && api.PLATFORM_TENANT_ID) {
      return normalizeString(api.PLATFORM_TENANT_ID) || PLATFORM_TENANT_ID;
    }
    return PLATFORM_TENANT_ID;
  }

  function buildMachineExamAttemptPayload(result, session, categoryId, examId, examTitle, tenantId) {
    var r = result || {};
    var total = Math.max(0, Number(r.total) || 0);
    var correct = Math.max(0, Number(r.correct) || 0);
    var wrong = Math.max(0, Number(r.wrong) || 0);
    var blank = Math.max(0, Number(r.blank) || 0);
    var percentage = Math.round(Number(r.percentage) || 0);
    var elapsed = Math.max(0, Number(r.elapsedSeconds) || 0);
    return {
      uid: normalizeString(session && session.uid),
      tenantId: normalizeString(tenantId),
      examId: normalizeString(examId),
      examTitle: examTitle ? normalizeString(examTitle) : null,
      category: normalizeString(categoryId),
      programType: PROGRAM_TYPE,
      totalQuestions: total,
      correctCount: correct,
      wrongCount: wrong,
      blankCount: blank,
      percentage: percentage,
      elapsedSeconds: elapsed,
      source: 'web',
      platform: 'web'
    };
  }

  /**
   * @param {{ session, categoryId, examId, examTitle, result }} input
   */
  async function persistMachineWebExamAttempt(input) {
    var data = input || {};
    var session = data.session;
    if (!session || normalizeString(session.programType) !== PROGRAM_TYPE) {
      return { ok: false, skipped: true, reason: 'invalid_session' };
    }
    var uid = normalizeString(session.uid);
    if (!uid) return { ok: false, skipped: true, reason: 'missing_uid' };

    var auth = getAuth();
    var authUser = auth && auth.currentUser ? auth.currentUser : null;
    if (!authUser || normalizeString(authUser.uid) !== uid) {
      return { ok: false, skipped: true, reason: 'auth_mismatch' };
    }

    var categoryId = normalizeString(data.categoryId);
    if (!isCategoryAllowed(categoryId)) {
      return { ok: false, skipped: true, reason: 'category_not_allowed' };
    }
    var examId = normalizeString(data.examId);
    if (!examId) return { ok: false, skipped: true, reason: 'missing_exam_id' };
    if (!data.result || typeof data.result !== 'object') {
      return { ok: false, skipped: true, reason: 'missing_result' };
    }

    var db = getDb();
    if (!db || typeof firebase === 'undefined' || !firebase.firestore) {
      return { ok: false, skipped: true, reason: 'firestore_unavailable' };
    }

    var tenantId = getMachineExamTenantId(session);
    if (!tenantId) return { ok: false, skipped: true, reason: 'missing_tenant' };

    var examTitle = normalizeString(data.examTitle);
    var payload = buildMachineExamAttemptPayload(
      data.result,
      session,
      categoryId,
      examId,
      examTitle,
      tenantId
    );
    if (!payload.uid || !payload.tenantId || !payload.examId || !payload.category) {
      return { ok: false, skipped: true, reason: 'incomplete_payload' };
    }

    var ts = firebase.firestore.FieldValue.serverTimestamp();
    var primaryPayload = Object.assign({}, payload, {
      completedAt: ts,
      createdAt: ts
    });

    var isPublic = isPublicSession(session);

    if (isPublic) {
      var primaryRef = db.collection('tenants').doc(tenantId).collection('exam_attempts').doc();
      var mirrorRef = db.collection('users').doc(uid).collection('web_exam_attempts').doc(primaryRef.id);
      var mirrorPayload = {
        uid: uid,
        examId: payload.examId,
        examTitle: payload.examTitle,
        category: payload.category,
        programType: PROGRAM_TYPE,
        totalQuestions: payload.totalQuestions,
        correctCount: payload.correctCount,
        wrongCount: payload.wrongCount,
        blankCount: payload.blankCount,
        scorePercent: Math.round(Number(payload.percentage) || 0),
        percentage: payload.percentage,
        durationSeconds: payload.elapsedSeconds,
        elapsedSeconds: payload.elapsedSeconds,
        completedAt: ts,
        createdAt: ts,
        userType: 'public_user',
        source: 'web',
        platform: 'web',
        mirrorSource: 'machine_exam_attempts'
      };
      try {
        var batch = db.batch();
        batch.set(primaryRef, primaryPayload);
        batch.set(mirrorRef, mirrorPayload);
        await batch.commit();
        return { ok: true, id: primaryRef.id, mode: 'public_batch' };
      } catch (batchErr) {
        console.warn('[machine-web-exam-attempts] public batch failed, primary-only fallback', batchErr);
        try {
          var fallbackRef = await db
            .collection('tenants')
            .doc(tenantId)
            .collection('exam_attempts')
            .add(primaryPayload);
          return { ok: true, id: fallbackRef && fallbackRef.id, mode: 'public_primary_only' };
        } catch (primaryErr) {
          console.warn('[machine-web-exam-attempts] public save failed', primaryErr);
          return { ok: false, reason: 'write_failed' };
        }
      }
    }

    try {
      var instRef = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('exam_attempts')
        .add(primaryPayload);
      return { ok: true, id: instRef && instRef.id, mode: 'institution' };
    } catch (instErr) {
      console.warn('[machine-web-exam-attempts] institution save failed', instErr);
      return { ok: false, reason: 'write_failed' };
    }
  }

  window.SA_MACHINE_WEB_EXAM_ATTEMPTS = {
    PROGRAM_TYPE: PROGRAM_TYPE,
    PLATFORM_TENANT_ID: PLATFORM_TENANT_ID,
    CATEGORY_ALLOWLIST: CATEGORY_ALLOWLIST.slice(),
    isCategoryAllowed: isCategoryAllowed,
    getMachineExamTenantId: getMachineExamTenantId,
    buildMachineExamAttemptPayload: buildMachineExamAttemptPayload,
    persistMachineWebExamAttempt: persistMachineWebExamAttempt
  };
})();
