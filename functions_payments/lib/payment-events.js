'use strict';

const admin = require('firebase-admin');

/**
 * Append-only payment audit event (Admin SDK only).
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} params
 * @param {string} params.orderId
 * @param {string} params.uid
 * @param {string} params.provider
 * @param {string} params.source
 * @param {string} params.eventType
 * @param {string|null} [params.statusBefore]
 * @param {string|null} [params.statusAfter]
 * @param {Record<string, unknown>|null} [params.payloadSafe]
 * @param {string} [params.processedBy]
 * @returns {Promise<string>} event document id
 */
async function appendPaymentEvent(db, params) {
  const orderId = String(params && params.orderId ? params.orderId : '').trim();
  const uid = String(params && params.uid ? params.uid : '').trim();
  const provider = String(params && params.provider ? params.provider : '').trim();
  const source = String(params && params.source ? params.source : '').trim();
  const eventType = String(params && params.eventType ? params.eventType : '').trim();

  if (!orderId || !uid || !provider || !source || !eventType) {
    throw new Error('appendPaymentEvent: orderId, uid, provider, source, eventType are required.');
  }

  /** @type {Record<string, unknown>} */
  const doc = {
    orderId,
    uid,
    provider,
    source,
    eventType,
    statusBefore: params.statusBefore != null ? String(params.statusBefore) : null,
    statusAfter: params.statusAfter != null ? String(params.statusAfter) : null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    processedBy: String(params.processedBy || 'system').trim() || 'system'
  };

  if (params.payloadSafe && typeof params.payloadSafe === 'object' && !Array.isArray(params.payloadSafe)) {
    doc.payloadSafe = params.payloadSafe;
  }

  const ref = await db.collection('paymentEvents').add(doc);
  return ref.id;
}

module.exports = {
  appendPaymentEvent
};
