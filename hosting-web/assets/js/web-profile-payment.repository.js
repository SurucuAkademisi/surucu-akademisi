/**
 * Profilim — read institution student payment summary (no writes).
 * Path: tenants/{tenantId}/studentPayments/{uid}
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-profile-payment]';

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function emptySummary() {
    return {
      exists: false,
      totalAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      installmentEnabled: false,
      monthlyInstallmentAmount: 0,
      note: '',
      updatedAt: null,
      updatedBy: ''
    };
  }

  function normalizePaymentDoc(data) {
    var raw = data || {};
    var totalAmount = toNumber(raw.totalAmount, 0);
    var paidAmount = toNumber(raw.paidAmount, 0);
    var remainingAmount = Math.max(totalAmount - paidAmount, 0);

    return {
      exists: true,
      totalAmount: totalAmount,
      paidAmount: paidAmount,
      remainingAmount: remainingAmount,
      installmentEnabled: raw.installmentEnabled === true,
      monthlyInstallmentAmount: toNumber(raw.monthlyInstallmentAmount, 0),
      note: normalizeString(raw.note),
      updatedAt: raw.updatedAt || null,
      updatedBy: normalizeString(raw.updatedBy)
    };
  }

  async function getStudentPaymentSummary(tenantId, uid) {
    var tid = normalizeString(tenantId);
    var id = normalizeString(uid);

    if (!tid || !id) {
      return {
        ok: false,
        exists: false,
        error: 'missing_context',
        summary: emptySummary()
      };
    }

    var db = getDb();
    if (!db) {
      return {
        ok: false,
        exists: false,
        error: 'db_unavailable',
        summary: emptySummary()
      };
    }

    try {
      var snap = await db
        .collection('tenants')
        .doc(tid)
        .collection('studentPayments')
        .doc(id)
        .get();

      if (!snap.exists) {
        return {
          ok: true,
          exists: false,
          error: null,
          summary: emptySummary()
        };
      }

      var summary = normalizePaymentDoc(snap.data());
      return {
        ok: true,
        exists: true,
        error: null,
        summary: summary
      };
    } catch (e) {
      console.warn(LOG_PREFIX + ' getStudentPaymentSummary failed', e);
      return {
        ok: false,
        exists: false,
        error: e,
        summary: emptySummary()
      };
    }
  }

  window.SA_WEB_PROFILE_PAYMENT_REPOSITORY = {
    getStudentPaymentSummary: getStudentPaymentSummary
  };
})();
