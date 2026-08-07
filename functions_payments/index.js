'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const PAYMENT_NOT_ACTIVE_CODE = 'PAYMENT_NOT_ACTIVE';
const PAYMENT_NOT_ACTIVE_MESSAGE =
  'Ödeme altyapısı henüz aktif değil. Online satın alma yakında açılacaktır.';

/**
 * @returns {{ ok: false, active: false, code: string, message: string }}
 */
function buildNotActiveResponse() {
  return {
    ok: false,
    active: false,
    code: PAYMENT_NOT_ACTIVE_CODE,
    message: PAYMENT_NOT_ACTIVE_MESSAGE
  };
}

/**
 * Callable: future iyzico Checkout Form session (stub).
 */
exports.createWebIyzicoCheckoutSession = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request.data;
    if (!request || !request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    return buildNotActiveResponse();
  }
);

/**
 * HTTPS: future iyzico callback endpoint (stub).
 * Does not trust request body; does not grant entitlement.
 */
exports.handleIyzicoCallback = onRequest(
  { region: 'us-central1' },
  async (req, res) => {
    res.status(200).json({
      ok: false,
      active: false,
      code: PAYMENT_NOT_ACTIVE_CODE,
      message: 'Payment callback infrastructure is not active yet.'
    });
  }
);

/**
 * Callable: future Google Play purchase verification (stub).
 */
exports.verifyGooglePlayPurchaseAndGrantEntitlement = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request.data;
    if (!request || !request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    return buildNotActiveResponse();
  }
);

/**
 * Callable: future Apple IAP purchase verification (stub).
 */
exports.verifyApplePurchaseAndGrantEntitlement = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request.data;
    if (!request || !request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    return buildNotActiveResponse();
  }
);

// Internal grant helper (lib/grant-video-premium.js) is not exported as callable.
