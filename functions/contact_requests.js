/**
 * Contact Requests — public submit + Super Admin status/note updates.
 * Writes only via Admin SDK. Clients have no Firestore create/update/delete.
 * Firebase Admin is initialized only in functions/index.js.
 */
'use strict';

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

var SCHEMA_VERSION = 1;
var NOTICE_VERSION = 'contact-v1';
var SOURCE_PAGE = 'iletisim';
var COLLECTION = 'contactRequests';
var RATE_LIMIT_COLLECTION = 'contactRequestRateLimits';

var STATUSES = {
  new: true,
  read: true,
  in_progress: true,
  answered: true,
  closed: true
};

var REQUEST_TYPES = {
  premium_access: true,
  institution_membership: true,
  institution_student_support: true,
  technical_support: true,
  education_content: true,
  partnership: true,
  other: true
};

var USER_TYPES = {
  individual: true,
  institution_student: true,
  institution_representative: true,
  other: true
};

var LIMITS = {
  fullNameMin: 2,
  fullNameMax: 100,
  emailMax: 160,
  phoneMax: 30,
  institutionNameMax: 160,
  cityMax: 80,
  messageMin: 10,
  messageMax: 5000,
  adminNoteMax: 2000,
  honeypotMax: 200,
  userAgentMax: 300,
  requestIdMax: 128,
  rateEmailMax30m: 3,
  rateIpMax30m: 5,
  rateIpMax24h: 20,
  window30mMs: 30 * 60 * 1000,
  window24hMs: 24 * 60 * 60 * 1000
};

function getDb() {
  return admin.firestore();
}

function collapseWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function stripControlChars(s) {
  return String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function asCollapsedString(value, maxLen) {
  if (typeof value !== 'string') return '';
  var s = collapseWhitespace(stripControlChars(value));
  if (maxLen > 0 && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function asTrimmedMessage(value, maxLen) {
  if (typeof value !== 'string') return '';
  var s = stripControlChars(value).trim();
  if (maxLen > 0 && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function isValidEmail(email) {
  if (!email || email.length > LIMITS.emailMax) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  if (!phone) return true;
  if (phone.length > LIMITS.phoneMax) return false;
  if (/[\u0000-\u001F\u007F]/.test(phone)) return false;
  return /^[0-9+\-\s()]+$/.test(phone);
}

function hashKey(prefix, raw) {
  var h = crypto.createHash('sha256').update(String(raw || ''), 'utf8').digest('hex');
  return prefix + '_' + h;
}

function clientIp(request) {
  try {
    var raw = request && request.rawRequest ? request.rawRequest : null;
    if (!raw) return '';
    var xf = raw.headers && (raw.headers['x-forwarded-for'] || raw.headers['X-Forwarded-For']);
    if (typeof xf === 'string' && xf.trim()) {
      return xf.split(',')[0].trim().slice(0, 80);
    }
    if (raw.ip && typeof raw.ip === 'string') return raw.ip.trim().slice(0, 80);
  } catch (e) {
    /* ignore */
  }
  return '';
}

function clientUserAgent(request) {
  try {
    var raw = request && request.rawRequest ? request.rawRequest : null;
    if (!raw || !raw.headers) return null;
    var ua = raw.headers['user-agent'] || raw.headers['User-Agent'];
    if (typeof ua !== 'string') return null;
    var cleaned = stripControlChars(ua).trim();
    if (!cleaned) return null;
    if (cleaned.length > LIMITS.userAgentMax) cleaned = cleaned.slice(0, LIMITS.userAgentMax);
    return cleaned;
  } catch (e) {
    return null;
  }
}

/**
 * Sliding-window counter. Stores only hashed doc ids + counters (no raw IP/email).
 */
async function assertRateLimit(db, docId, maxCount, windowMs) {
  var ref = db.collection(RATE_LIMIT_COLLECTION).doc(docId);
  var now = Date.now();

  await db.runTransaction(async function (tx) {
    var snap = await tx.get(ref);
    var data = snap.exists ? snap.data() || {} : {};
    var windowStartMs = typeof data.windowStartMs === 'number' ? data.windowStartMs : 0;
    var count = typeof data.count === 'number' ? data.count : 0;

    if (!windowStartMs || now - windowStartMs > windowMs) {
      windowStartMs = now;
      count = 0;
    }

    if (count >= maxCount) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
    }

    tx.set(
      ref,
      {
        windowStartMs: windowStartMs,
        count: count + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  });
}

async function requireSuperAdmin(uid) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  var snap = await getDb().collection('users').doc(uid).get();
  var role =
    snap.exists && snap.data() && snap.data().role ? String(snap.data().role).toLowerCase() : '';
  if (role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super_admin can update contact requests.');
  }
}

function isEmptyValue(existingField) {
  return existingField == null || existingField === '';
}

/**
 * Public (guest or signed-in) contact request create.
 * Auth optional. Honeypot + validation + accepted-request rate limits.
 */
exports.submitContactRequest = onCall(async function (request) {
  var data = request && request.data && typeof request.data === 'object' ? request.data : {};
  var uid = request && request.auth && request.auth.uid ? String(request.auth.uid) : null;

  // Honeypot: any non-empty website → no document, no rate-limit increment.
  // Response intentionally omits requestId (same shape, non-revealing).
  var honeypotRaw = typeof data.website === 'string' ? data.website : '';
  if (stripControlChars(honeypotRaw).trim()) {
    return { ok: true };
  }

  var fullName = asCollapsedString(data.fullName, LIMITS.fullNameMax);
  var email =
    typeof data.email === 'string'
      ? stripControlChars(data.email).trim().toLowerCase().slice(0, LIMITS.emailMax)
      : '';
  var phoneRaw =
    typeof data.phone === 'string' ? stripControlChars(data.phone).trim().slice(0, LIMITS.phoneMax) : '';
  var phone = phoneRaw || null;
  var institutionNameRaw = asCollapsedString(data.institutionName, LIMITS.institutionNameMax);
  var institutionName = institutionNameRaw || null;
  var cityRaw = asCollapsedString(data.city, LIMITS.cityMax);
  var city = cityRaw || null;
  var message = asTrimmedMessage(data.message, LIMITS.messageMax);
  var userType = typeof data.userType === 'string' ? data.userType.trim() : '';
  var requestType = typeof data.requestType === 'string' ? data.requestType.trim() : '';
  var noticeAcknowledged = data.noticeAcknowledged;

  if (fullName.length < LIMITS.fullNameMin) {
    throw new HttpsError('invalid-argument', 'fullName is required.');
  }
  if (!isValidEmail(email)) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }
  if (!USER_TYPES[userType]) {
    throw new HttpsError('invalid-argument', 'userType is invalid.');
  }
  if (!REQUEST_TYPES[requestType]) {
    throw new HttpsError('invalid-argument', 'requestType is invalid.');
  }
  if (message.length < LIMITS.messageMin) {
    throw new HttpsError('invalid-argument', 'message is required.');
  }
  if (noticeAcknowledged !== true) {
    throw new HttpsError('invalid-argument', 'noticeAcknowledged must be true.');
  }
  if (phone && !isValidPhone(phone)) {
    throw new HttpsError('invalid-argument', 'phone is invalid.');
  }

  if (requestType === 'institution_membership') {
    if (!institutionName) {
      throw new HttpsError('invalid-argument', 'institutionName is required.');
    }
    if (!city) {
      throw new HttpsError('invalid-argument', 'city is required.');
    }
  }
  if (requestType === 'institution_student_support') {
    if (!institutionName) {
      throw new HttpsError('invalid-argument', 'institutionName is required.');
    }
  }

  var db = getDb();
  var ip = clientIp(request);

  try {
    await assertRateLimit(
      db,
      hashKey('email30', email),
      LIMITS.rateEmailMax30m,
      LIMITS.window30mMs
    );
    if (ip) {
      await assertRateLimit(db, hashKey('ip30', ip), LIMITS.rateIpMax30m, LIMITS.window30mMs);
      await assertRateLimit(db, hashKey('ip24', ip), LIMITS.rateIpMax24h, LIMITS.window24hMs);
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('[submitContactRequest] rate limit failed:', e && e.message ? e.message : e);
    throw new HttpsError('internal', 'Unable to process request.');
  }

  var nowTs = admin.firestore.Timestamp.now();
  var doc = {
    schemaVersion: SCHEMA_VERSION,
    status: 'new',
    requestType: requestType,
    userType: userType,
    fullName: fullName,
    email: email,
    phone: phone,
    institutionName: institutionName,
    city: city,
    message: message,
    noticeAcknowledged: true,
    noticeVersion: NOTICE_VERSION,
    sourcePage: SOURCE_PAGE,
    submitterUid: uid,
    tenantId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    readAt: null,
    answeredAt: null,
    closedAt: null,
    adminNote: '',
    statusHistory: [
      {
        status: 'new',
        at: nowTs,
        byUid: null
      }
    ],
    userAgent: clientUserAgent(request)
  };

  try {
    var ref = await db.collection(COLLECTION).add(doc);
    return { ok: true, requestId: ref.id, status: 'new' };
  } catch (e) {
    console.error('[submitContactRequest] write failed:', e && e.message ? e.message : e);
    throw new HttpsError('internal', 'Unable to save contact request.');
  }
});

/**
 * Super Admin only — update status and/or internal adminNote.
 */
exports.updateContactRequest = onCall(async function (request) {
  var callerUid = request && request.auth ? request.auth.uid : null;
  await requireSuperAdmin(callerUid);

  var data = request && request.data && typeof request.data === 'object' ? request.data : {};
  var requestId =
    typeof data.requestId === 'string' ? stripControlChars(data.requestId).trim() : '';
  if (!requestId || requestId.length > LIMITS.requestIdMax || /[\/\.]/.test(requestId)) {
    throw new HttpsError('invalid-argument', 'requestId is required.');
  }

  var hasStatus = Object.prototype.hasOwnProperty.call(data, 'status');
  var hasNote = Object.prototype.hasOwnProperty.call(data, 'adminNote');
  if (!hasStatus && !hasNote) {
    throw new HttpsError('invalid-argument', 'status or adminNote is required.');
  }

  var nextStatus = null;
  if (hasStatus) {
    nextStatus = typeof data.status === 'string' ? data.status.trim() : '';
    if (!STATUSES[nextStatus]) {
      throw new HttpsError(
        'invalid-argument',
        'status must be one of: new, read, in_progress, answered, closed.'
      );
    }
  }

  var nextNote = null;
  if (hasNote) {
    if (data.adminNote != null && typeof data.adminNote !== 'string') {
      throw new HttpsError('invalid-argument', 'adminNote must be a string.');
    }
    nextNote =
      data.adminNote == null
        ? ''
        : asTrimmedMessage(data.adminNote, LIMITS.adminNoteMax);
  }

  var db = getDb();
  var ref = db.collection(COLLECTION).doc(requestId);
  var resultingStatus = null;

  try {
    await db.runTransaction(async function (tx) {
      var snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Contact request not found.');
      }
      var existing = snap.data() || {};
      resultingStatus = existing.status || 'new';
      var patch = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (nextStatus != null && nextStatus !== existing.status) {
        patch.status = nextStatus;
        resultingStatus = nextStatus;

        var history = Array.isArray(existing.statusHistory) ? existing.statusHistory.slice() : [];
        history.push({
          status: nextStatus,
          at: admin.firestore.Timestamp.now(),
          byUid: callerUid
        });
        if (history.length > 40) history = history.slice(history.length - 40);
        patch.statusHistory = history;

        if (nextStatus === 'read' && isEmptyValue(existing.readAt)) {
          patch.readAt = admin.firestore.FieldValue.serverTimestamp();
        }
        if (nextStatus === 'answered') {
          patch.answeredAt = admin.firestore.FieldValue.serverTimestamp();
        }
        if (nextStatus === 'closed') {
          patch.closedAt = admin.firestore.FieldValue.serverTimestamp();
        }
      }

      if (nextNote != null) {
        patch.adminNote = nextNote;
      }

      tx.update(ref, patch);
    });

    return { ok: true, requestId: requestId, status: resultingStatus };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('[updateContactRequest] failed:', e && e.message ? e.message : e);
    throw new HttpsError('internal', 'Unable to update contact request.');
  }
});
