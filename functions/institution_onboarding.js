/**
 * Institution onboarding draft — Phase A/B.
 * Admin SDK writes only (Firestore + Storage staging).
 * No payment, tenant, Auth, or membership side effects.
 * Firebase Admin is initialized only in functions/index.js.
 */
'use strict';

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

var ONBOARDING_SCHEMA_VERSION = 1;
var NOTICE_VERSION = 'contact-v1';
var ONBOARDING_COLLECTION = 'institutionOnboardingApplications';
var CONTACT_COLLECTION = 'contactRequests';
var RATE_LIMIT_COLLECTION = 'contactRequestRateLimits';
var ONBOARDING_STATUS = 'awaiting_payment';
var LOGO_STAGING_PREFIX = 'onboarding-logos';

var INTERESTED_PROGRAMS = {
  driving_license: true,
  machine_operator: true,
  both: true
};

var LOGO_ALLOWED = {
  'image/png': { ext: 'png' },
  'image/jpeg': { ext: 'jpg' },
  'image/webp': { ext: 'webp' }
};

var LIMITS = {
  fullNameMin: 2,
  fullNameMax: 100,
  emailMax: 160,
  phoneMax: 30,
  institutionNameMax: 160,
  cityMax: 80,
  districtMax: 80,
  titleMax: 100,
  fullAddressMin: 5,
  fullAddressMax: 500,
  messageMax: 5000,
  userAgentMax: 300,
  logoMaxBytes: 2 * 1024 * 1024,
  logoOriginalNameMax: 180,
  estimatedStudentCountMax: 100000,
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

function asTrimmedMultiline(value, maxLen) {
  if (typeof value !== 'string') return '';
  var s = stripControlChars(value).replace(/\r\n/g, '\n').trim();
  if (maxLen > 0 && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function isValidEmail(email) {
  if (!email || email.length > LIMITS.emailMax) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  if (!phone || phone.length > LIMITS.phoneMax) return false;
  if (/[\u0000-\u001F\u007F]/.test(phone)) return false;
  return /^[0-9+\-\s()]+$/.test(phone);
}

function normalizeEstimatedStudentCount(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    var n = Math.floor(raw);
    if (n < 1 || n > LIMITS.estimatedStudentCountMax) {
      throw new HttpsError('invalid-argument', 'estimatedStudentCount is invalid.');
    }
    return n;
  }
  if (typeof raw !== 'string') {
    throw new HttpsError('invalid-argument', 'estimatedStudentCount is invalid.');
  }
  var s = stripControlChars(raw).trim();
  if (!s) return null;
  if (!/^\d{1,6}$/.test(s)) {
    throw new HttpsError('invalid-argument', 'estimatedStudentCount is invalid.');
  }
  var parsed = parseInt(s, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > LIMITS.estimatedStudentCountMax) {
    throw new HttpsError('invalid-argument', 'estimatedStudentCount is invalid.');
  }
  return parsed;
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

function sanitizeLogoOriginalName(raw) {
  var s = stripControlChars(typeof raw === 'string' ? raw : '')
    .replace(/[/\\]/g, '')
    .trim();
  if (!s) s = 'logo';
  if (s.length > LIMITS.logoOriginalNameMax) s = s.slice(0, LIMITS.logoOriginalNameMax);
  return s;
}

function detectImageContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function parseAndValidateLogo(data) {
  var claimedType =
    typeof data.logoContentType === 'string' ? data.logoContentType.trim().toLowerCase() : '';
  if (!LOGO_ALLOWED[claimedType]) {
    throw new HttpsError(
      'invalid-argument',
      'Lütfen PNG, JPG veya WEBP formatında bir logo seçin.'
    );
  }

  var base64Raw = typeof data.logoBase64 === 'string' ? data.logoBase64.trim() : '';
  if (!base64Raw) {
    throw new HttpsError('invalid-argument', 'Lütfen kurum logosunu seçin.');
  }
  if (base64Raw.indexOf('base64,') !== -1) {
    base64Raw = base64Raw.split('base64,').pop() || '';
  }
  base64Raw = base64Raw.replace(/\s+/g, '');

  var buffer;
  try {
    buffer = Buffer.from(base64Raw, 'base64');
  } catch (e) {
    throw new HttpsError(
      'invalid-argument',
      'Lütfen PNG, JPG veya WEBP formatında bir logo seçin.'
    );
  }

  if (!buffer || !buffer.length) {
    throw new HttpsError('invalid-argument', 'Lütfen kurum logosunu seçin.');
  }
  if (buffer.length > LIMITS.logoMaxBytes) {
    throw new HttpsError('invalid-argument', 'Logo dosyası en fazla 2 MB olabilir.');
  }

  var detected = detectImageContentType(buffer);
  if (!detected || !LOGO_ALLOWED[detected]) {
    throw new HttpsError(
      'invalid-argument',
      'Lütfen PNG, JPG veya WEBP formatında bir logo seçin.'
    );
  }
  if (detected !== claimedType) {
    // Prefer magic-byte detection over client claim.
    claimedType = detected;
  }

  return {
    buffer: buffer,
    contentType: claimedType,
    ext: LOGO_ALLOWED[claimedType].ext,
    originalName: sanitizeLogoOriginalName(data.logoOriginalName),
    byteLength: buffer.length
  };
}

async function uploadOnboardingLogo(applicationId, logo) {
  var stagingPath = LOGO_STAGING_PREFIX + '/' + applicationId + '/logo.' + logo.ext;
  var bucket = admin.storage().bucket();
  var file = bucket.file(stagingPath);

  await file.save(logo.buffer, {
    resumable: false,
    contentType: logo.contentType,
    metadata: {
      contentType: logo.contentType,
      metadata: {
        purpose: 'institution_onboarding_logo',
        applicationId: applicationId,
        originalName: logo.originalName
      }
    }
  });

  return stagingPath;
}

async function deleteStagingLogoQuietly(stagingPath) {
  if (!stagingPath) return;
  try {
    await admin.storage().bucket().file(stagingPath).delete({ ignoreNotFound: true });
  } catch (e) {
    console.warn(
      '[createInstitutionOnboardingDraft] staging logo cleanup failed:',
      e && e.message ? e.message : e
    );
  }
}

/**
 * Public (guest or signed-in) institution onboarding draft create.
 * Auth optional. Honeypot + validation + rate limits + Admin SDK logo staging.
 * Does NOT create tenant, Auth user, membership, or payment order.
 * Does NOT write tenant-logos/*.
 */
exports.createInstitutionOnboardingDraft = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60
  },
  async function (request) {
  var data = request && request.data && typeof request.data === 'object' ? request.data : {};
  var uid = request && request.auth && request.auth.uid ? String(request.auth.uid) : null;

  var honeypotRaw = typeof data.website === 'string' ? data.website : '';
  if (stripControlChars(honeypotRaw).trim()) {
    return { ok: true };
  }

  var institutionName = asCollapsedString(data.institutionName, LIMITS.institutionNameMax);
  var authorizedPersonName = asCollapsedString(data.authorizedPersonName, LIMITS.fullNameMax);
  var authorizedPersonTitleRaw = asCollapsedString(data.authorizedPersonTitle, LIMITS.titleMax);
  var authorizedPersonTitle = authorizedPersonTitleRaw || null;
  var email =
    typeof data.email === 'string'
      ? stripControlChars(data.email).trim().toLowerCase().slice(0, LIMITS.emailMax)
      : '';
  var phoneRaw =
    typeof data.phone === 'string' ? stripControlChars(data.phone).trim().slice(0, LIMITS.phoneMax) : '';
  var phone = phoneRaw || '';
  var city = asCollapsedString(data.city, LIMITS.cityMax);
  var district = asCollapsedString(data.district, LIMITS.districtMax);
  var fullAddress = asTrimmedMultiline(data.fullAddress, LIMITS.fullAddressMax);
  var interestedProgram =
    typeof data.interestedProgram === 'string' ? data.interestedProgram.trim() : '';
  var estimatedStudentCount = normalizeEstimatedStudentCount(data.estimatedStudentCount);
  var message = asTrimmedMultiline(data.message, LIMITS.messageMax);
  var noticeAcknowledged = data.noticeAcknowledged === true;
  var logo = parseAndValidateLogo(data);

  if (!institutionName) {
    throw new HttpsError('invalid-argument', 'institutionName is required.');
  }
  if (authorizedPersonName.length < LIMITS.fullNameMin) {
    throw new HttpsError('invalid-argument', 'authorizedPersonName is required.');
  }
  if (!isValidEmail(email)) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }
  if (!phone || !isValidPhone(phone)) {
    throw new HttpsError('invalid-argument', 'phone is required.');
  }
  if (!city) {
    throw new HttpsError('invalid-argument', 'city is required.');
  }
  if (!district) {
    throw new HttpsError('invalid-argument', 'district is required.');
  }
  if (fullAddress.length < LIMITS.fullAddressMin) {
    throw new HttpsError('invalid-argument', 'fullAddress is required.');
  }
  if (!INTERESTED_PROGRAMS[interestedProgram]) {
    throw new HttpsError('invalid-argument', 'interestedProgram is invalid.');
  }
  if (!noticeAcknowledged) {
    throw new HttpsError('invalid-argument', 'noticeAcknowledged must be true.');
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
    console.error('[createInstitutionOnboardingDraft] rate limit failed:', e && e.message ? e.message : e);
    throw new HttpsError('internal', 'Unable to process request.');
  }

  var nowTs = admin.firestore.Timestamp.now();
  var onboardingRef = db.collection(ONBOARDING_COLLECTION).doc();
  var contactRef = db.collection(CONTACT_COLLECTION).doc();
  var applicationId = onboardingRef.id;
  var contactRequestId = contactRef.id;
  var logoStagingPath = null;

  try {
    logoStagingPath = await uploadOnboardingLogo(applicationId, logo);
  } catch (e) {
    console.error('[createInstitutionOnboardingDraft] logo upload failed:', e && e.message ? e.message : e);
    throw new HttpsError('internal', 'Logo yüklenemedi. Lütfen tekrar deneyin.');
  }

  var onboardingDoc = {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    status: ONBOARDING_STATUS,
    institutionName: institutionName,
    authorizedPersonName: authorizedPersonName,
    authorizedPersonTitle: authorizedPersonTitle,
    email: email,
    phone: phone,
    city: city,
    district: district,
    fullAddress: fullAddress,
    interestedProgram: interestedProgram,
    estimatedStudentCount: estimatedStudentCount,
    message: message || null,
    logoStagingPath: logoStagingPath,
    logoContentType: logo.contentType,
    logoOriginalName: logo.originalName,
    logoUploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    noticeAcknowledged: true,
    noticeVersion: NOTICE_VERSION,
    sourcePage: 'kurumsal-basvuru',
    submitterUid: uid,
    tenantId: null,
    paymentOrderId: null,
    contactRequestId: contactRequestId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    userAgent: clientUserAgent(request)
  };

  var crmMessage = message || 'Kurumsal onboarding başvurusu (ödeme aşaması henüz aktif değil).';

  var contactDoc = {
    schemaVersion: 1,
    status: 'new',
    requestType: 'institution_application',
    userType: 'institution_representative',
    fullName: authorizedPersonName,
    authorizedPersonName: authorizedPersonName,
    authorizedPersonTitle: authorizedPersonTitle,
    email: email,
    phone: phone,
    institutionName: institutionName,
    city: city,
    district: district,
    fullAddress: fullAddress,
    interestedProgram: interestedProgram,
    estimatedStudentCount: estimatedStudentCount,
    message: crmMessage,
    noticeAcknowledged: true,
    noticeVersion: NOTICE_VERSION,
    sourcePage: 'kurumsal-basvuru',
    submitterUid: uid,
    tenantId: null,
    onboardingApplicationId: applicationId,
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
    var batch = db.batch();
    batch.set(onboardingRef, onboardingDoc);
    batch.set(contactRef, contactDoc);
    await batch.commit();
  } catch (e) {
    console.error('[createInstitutionOnboardingDraft] write failed:', e && e.message ? e.message : e);
    await deleteStagingLogoQuietly(logoStagingPath);
    throw new HttpsError('internal', 'Unable to save onboarding application.');
  }

  return {
    ok: true,
    applicationId: applicationId,
    contactRequestId: contactRequestId,
    status: ONBOARDING_STATUS
  };
});

async function requireSuperAdmin(uid) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  var snap = await getDb().collection('users').doc(uid).get();
  var role =
    snap.exists && snap.data() && snap.data().role ? String(snap.data().role).toLowerCase() : '';
  if (role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super_admin can access onboarding logos.');
  }
}

function isSafeOnboardingLogoPath(applicationId, stagingPath) {
  var path = String(stagingPath || '').trim();
  var appId = String(applicationId || '').trim();
  if (!path || !appId) return false;
  if (path.indexOf('..') !== -1 || path.indexOf('\\') !== -1) return false;
  var prefix = LOGO_STAGING_PREFIX + '/' + appId + '/logo.';
  if (path.indexOf(prefix) !== 0) return false;
  var ext = path.slice(prefix.length).toLowerCase();
  return ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp';
}

function sanitizeDownloadFileName(raw, contentType) {
  var name = sanitizeLogoOriginalName(raw);
  name = name.replace(/["\r\n]/g, '').trim() || 'logo';
  if (!/\.(png|jpe?g|webp)$/i.test(name)) {
    var ct = String(contentType || '').toLowerCase();
    var ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg';
    name = name + '.' + ext;
  }
  return name;
}

/**
 * Super Admin only — short-lived signed URLs for onboarding staging logos.
 * Client cannot supply Storage path; path is read from onboarding doc.
 */
exports.getInstitutionOnboardingLogoAccess = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30
  },
  async function (request) {
    var callerUid = request && request.auth ? request.auth.uid : null;
    await requireSuperAdmin(callerUid);

    var data = request && request.data && typeof request.data === 'object' ? request.data : {};
    var applicationId =
      typeof data.applicationId === 'string' ? stripControlChars(data.applicationId).trim() : '';
    if (
      !applicationId ||
      applicationId.length > 128 ||
      /[\/.\\]/.test(applicationId)
    ) {
      throw new HttpsError('invalid-argument', 'applicationId is required.');
    }

    var snap = await getDb().collection(ONBOARDING_COLLECTION).doc(applicationId).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Onboarding application not found.');
    }

    var doc = snap.data() || {};
    var stagingPath = typeof doc.logoStagingPath === 'string' ? doc.logoStagingPath.trim() : '';
    if (!stagingPath) {
      return {
        ok: true,
        applicationId: applicationId,
        hasLogo: false
      };
    }
    if (!isSafeOnboardingLogoPath(applicationId, stagingPath)) {
      console.error(
        '[getInstitutionOnboardingLogoAccess] unsafe logoStagingPath for',
        applicationId
      );
      throw new HttpsError('failed-precondition', 'Logo staging path is invalid.');
    }

    var contentType =
      typeof doc.logoContentType === 'string' && doc.logoContentType.trim()
        ? doc.logoContentType.trim().toLowerCase()
        : 'application/octet-stream';
    var originalName = sanitizeDownloadFileName(doc.logoOriginalName, contentType);
    var expiresMs = Date.now() + 15 * 60 * 1000;
    var file = admin.storage().bucket().file(stagingPath);

    try {
      var existsResp = await file.exists();
      if (!existsResp || !existsResp[0]) {
        return {
          ok: true,
          applicationId: applicationId,
          hasLogo: false
        };
      }

      var viewUrls = await file.getSignedUrl({
        action: 'read',
        expires: expiresMs,
        responseDisposition: 'inline',
        responseType: contentType
      });
      var downloadUrls = await file.getSignedUrl({
        action: 'read',
        expires: expiresMs,
        responseDisposition: 'attachment; filename="' + originalName.replace(/"/g, '') + '"',
        responseType: contentType
      });

      return {
        ok: true,
        applicationId: applicationId,
        hasLogo: true,
        viewUrl: viewUrls && viewUrls[0] ? viewUrls[0] : null,
        downloadUrl: downloadUrls && downloadUrls[0] ? downloadUrls[0] : null,
        logoOriginalName: originalName,
        logoContentType: contentType,
        logoUploadedAt: doc.logoUploadedAt || null,
        expiresAtMs: expiresMs
      };
    } catch (e) {
      console.error(
        '[getInstitutionOnboardingLogoAccess] signed URL failed:',
        e && e.message ? e.message : e
      );
      throw new HttpsError('internal', 'Unable to create logo access URL.');
    }
  }
);

