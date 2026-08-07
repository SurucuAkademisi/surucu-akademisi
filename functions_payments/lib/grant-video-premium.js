'use strict';

const admin = require('firebase-admin');
const { ORDER_STATUS, canTransitionOrderStatus } = require('./order-status');
const { appendPaymentEvent } = require('./payment-events');
const { VIDEO_LESSONS_180_DAYS } = require('./products');

const PAYMENT_VIDEO_LESSONS_SOURCES = Object.freeze([
  'web_iyzico',
  'google_play',
  'apple_iap',
  'manual_bank_transfer'
]);

const GRANT_UPDATED_BY_PREFIX = 'payment:';

/**
 * @param {string} dateStr
 * @returns {Date|null}
 */
function parseYyyyMmDdDate(dateStr) {
  const s = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const parts = s.slice(0, 10).split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m, d);
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatYyyyMmDd(date) {
  const dt = date instanceof Date ? date : new Date();
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * @returns {string}
 */
function todayYyyyMmDdLocal() {
  return formatYyyyMmDd(new Date());
}

/**
 * @param {string} startStr
 * @param {number} days
 * @returns {string}
 */
function addDaysToYyyyMmDd(startStr, days) {
  const start = parseYyyyMmDdDate(startStr);
  if (!start) return '';
  const durationDays = Number.isFinite(Number(days)) ? Math.floor(Number(days)) : VIDEO_LESSONS_180_DAYS.durationDays;
  start.setDate(start.getDate() + durationDays);
  return formatYyyyMmDd(start);
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function isAllowedPaymentVideoLessonsSource(source) {
  return PAYMENT_VIDEO_LESSONS_SOURCES.indexOf(String(source || '').trim()) !== -1;
}

/**
 * Grant video premium after verified payment (internal — not client-callable).
 * Idempotent when entitlementGrantedAt is already set on the order.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args
 * @param {string} args.orderId
 * @param {string} args.videoLessonsSource
 * @param {string} [args.startDate] YYYY-MM-DD
 * @param {number} [args.durationDays]
 * @param {number} [args.paymentAmount]
 * @param {string} [args.providerPaymentId]
 * @param {string} [args.processedBy]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, uid?: string, orderId?: string }>}
 */
async function grantVideoLessonsPremiumFromPayment(db, args) {
  const orderId = String(args && args.orderId ? args.orderId : '').trim();
  const videoLessonsSource = String(args && args.videoLessonsSource ? args.videoLessonsSource : '').trim();
  const processedBy = String(args && args.processedBy ? args.processedBy : 'grantVideoLessonsPremiumFromPayment').trim();

  if (!orderId) {
    throw new Error('grantVideoLessonsPremiumFromPayment: orderId is required.');
  }
  if (!isAllowedPaymentVideoLessonsSource(videoLessonsSource)) {
    throw new Error('grantVideoLessonsPremiumFromPayment: invalid videoLessonsSource.');
  }

  const orderRef = db.collection('paymentOrders').doc(orderId);

  const existingSnap = await orderRef.get();
  if (!existingSnap.exists) {
    throw new Error('grantVideoLessonsPremiumFromPayment: order not found.');
  }

  const existing = existingSnap.data() || {};
  const uid = String(existing.uid || '').trim();
  const provider = String(existing.provider || '').trim();
  const source = String(existing.source || '').trim();

  if (!uid) {
    throw new Error('grantVideoLessonsPremiumFromPayment: order uid missing.');
  }

  if (existing.entitlementGrantedAt != null) {
    await appendPaymentEvent(db, {
      orderId,
      uid,
      provider,
      source,
      eventType: 'grant_skipped_duplicate',
      statusBefore: String(existing.status || ''),
      statusAfter: String(existing.status || ''),
      payloadSafe: { reason: 'entitlement_already_granted' },
      processedBy
    });
    return { ok: true, skipped: true, uid, orderId };
  }

  const currentStatus = String(existing.status || '').trim();
  if (!canTransitionOrderStatus(currentStatus, ORDER_STATUS.PAID)) {
    throw new Error(
      `grantVideoLessonsPremiumFromPayment: cannot transition status ${currentStatus} to paid.`
    );
  }

  let startDate = String(args && args.startDate ? args.startDate : '').trim();
  if (!startDate) startDate = todayYyyyMmDdLocal();
  if (!parseYyyyMmDdDate(startDate)) {
    throw new Error('grantVideoLessonsPremiumFromPayment: invalid startDate.');
  }

  let durationDays = args && args.durationDays != null
    ? Number(args.durationDays)
    : Number(existing.durationDays != null ? existing.durationDays : VIDEO_LESSONS_180_DAYS.durationDays);
  if (!Number.isFinite(durationDays) || durationDays < 1) {
    durationDays = VIDEO_LESSONS_180_DAYS.durationDays;
  }
  durationDays = Math.floor(durationDays);

  const expiresAt = addDaysToYyyyMmDd(startDate, durationDays);
  if (!expiresAt) {
    throw new Error('grantVideoLessonsPremiumFromPayment: could not compute expiresAt.');
  }

  const paymentAmountRaw = args && args.paymentAmount != null
    ? Number(args.paymentAmount)
    : Number(existing.amount != null ? existing.amount : VIDEO_LESSONS_180_DAYS.amount);
  const paymentAmount = Number.isFinite(paymentAmountRaw) ? paymentAmountRaw : VIDEO_LESSONS_180_DAYS.amount;

  const providerPaymentId = String(
    (args && args.providerPaymentId) || existing.providerPaymentId || ''
  ).trim() || null;

  const entitlementRef = db.collection('userEntitlements').doc(uid);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const updatedBy = GRANT_UPDATED_BY_PREFIX + orderId;

  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error('grantVideoLessonsPremiumFromPayment: order not found in transaction.');
    }
    const orderData = orderSnap.data() || {};

    if (orderData.entitlementGrantedAt != null) {
      return;
    }

    const txStatus = String(orderData.status || '').trim();
    if (!canTransitionOrderStatus(txStatus, ORDER_STATUS.PAID)) {
      throw new Error(`grantVideoLessonsPremiumFromPayment: invalid status ${txStatus} in transaction.`);
    }

  /** @type {Record<string, unknown>} */
    const entitlementPayload = {
      videoLessonsPremium: true,
      videoLessonsStartedAt: startDate,
      videoLessonsExpiresAt: expiresAt,
      videoLessonsSource: videoLessonsSource,
      videoLessonsDurationDays: durationDays,
      videoLessonsUpdatedAt: now,
      videoLessonsUpdatedBy: updatedBy,
      videoLessonsPaymentAmount: paymentAmount,
      videoLessonsPaymentOrderId: orderId
    };
    if (providerPaymentId) {
      entitlementPayload.videoLessonsProviderPaymentId = providerPaymentId;
    }

    tx.set(entitlementRef, entitlementPayload, { merge: true });

    /** @type {Record<string, unknown>} */
    const orderUpdate = {
      status: ORDER_STATUS.PAID,
      entitlementGrantedAt: now,
      entitlementUid: uid,
      paidAt: orderData.paidAt || now,
      updatedAt: now
    };
    if (providerPaymentId && !orderData.providerPaymentId) {
      orderUpdate.providerPaymentId = providerPaymentId;
    }

    tx.update(orderRef, orderUpdate);
  });

  const afterSnap = await orderRef.get();
  const after = afterSnap.exists ? (afterSnap.data() || {}) : {};
  if (after.entitlementGrantedAt == null) {
    return { ok: true, skipped: true, uid, orderId };
  }

  await appendPaymentEvent(db, {
    orderId,
    uid,
    provider,
    source,
    eventType: 'entitlement_granted',
    statusBefore: currentStatus,
    statusAfter: ORDER_STATUS.PAID,
    payloadSafe: {
      videoLessonsSource,
      durationDays,
      paymentAmount
    },
    processedBy
  });

  return { ok: true, skipped: false, uid, orderId };
}

module.exports = {
  PAYMENT_VIDEO_LESSONS_SOURCES,
  grantVideoLessonsPremiumFromPayment
};
