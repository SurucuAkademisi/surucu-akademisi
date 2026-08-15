const { onCall, HttpsError } =
  require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const INSTRUCTOR_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const INSTRUCTOR_PHOTO_ALLOWED = {
  'image/png': { ext: 'png' },
  'image/jpeg': { ext: 'jpg' },
  'image/webp': { ext: 'webp' }
};

const INSTITUTION_ACCESS_DURATION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MACHINE_PROGRAM_TYPE = 'machine_operator';
const DRIVING_PROGRAM_TYPE = 'driving_license';
const ENROLLMENT_SOURCE_INSTITUTION = 'institution';
const ENROLLMENT_SOURCE_PUBLIC = 'public';
const PLATFORM_MACHINE_TENANT_ID = 'surucu_akademisi';

/**
 * Normalize stored membership programType (read path).
 * Unknown/missing → driving_license.
 * @param {*} value
 * @returns {string}
 */
function normalizeProgramType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === MACHINE_PROGRAM_TYPE) return MACHINE_PROGRAM_TYPE;
  return DRIVING_PROGRAM_TYPE;
}

/**
 * Normalize stored membership enrollmentSource (read path).
 * @param {*} value
 * @param {string} [tenantId]
 * @param {*} [programType]
 * @returns {string}
 */
function normalizeEnrollmentSource(value, tenantId, programType) {
  const e = String(value || '').trim().toLowerCase();
  if (e === ENROLLMENT_SOURCE_PUBLIC) return ENROLLMENT_SOURCE_PUBLIC;
  if (e === ENROLLMENT_SOURCE_INSTITUTION) return ENROLLMENT_SOURCE_INSTITUTION;
  const tid = String(tenantId || '').trim();
  if (tid === PLATFORM_MACHINE_TENANT_ID && normalizeProgramType(programType) === MACHINE_PROGRAM_TYPE) {
    return ENROLLMENT_SOURCE_PUBLIC;
  }
  return ENROLLMENT_SOURCE_INSTITUTION;
}

/**
 * Validate optional create request programType (write path).
 * Missing/empty → driving_license; invalid → throws.
 * @param {*} raw
 * @returns {string}
 */
function resolveRequestedProgramType(raw) {
  if (raw == null || String(raw).trim() === '') return DRIVING_PROGRAM_TYPE;
  const v = String(raw).trim().toLowerCase();
  if (v === DRIVING_PROGRAM_TYPE || v === MACHINE_PROGRAM_TYPE) return v;
  throw new HttpsError('invalid-argument', 'programType must be driving_license or machine_operator.');
}

/**
 * Convert expiry-like values to epoch ms. Does not write back to Firestore.
 * @param {*} value
 * @returns {number|null}
 */
function membershipExpiryToMillis(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toMillis === 'function') {
    try {
      const ms = value.toMillis();
      return Number.isFinite(ms) ? ms : null;
    } catch (_) {
      return null;
    }
  }
  if (typeof value.toDate === 'function') {
    try {
      const d = value.toDate();
      if (d instanceof Date) {
        const ms = d.getTime();
        return Number.isFinite(ms) ? ms : null;
      }
    } catch (_) {
      return null;
    }
  }
  if (typeof value.seconds === 'number' && Number.isFinite(value.seconds)) {
    return value.seconds * 1000;
  }
  if (typeof value._seconds === 'number' && Number.isFinite(value._seconds)) {
    return value._seconds * 1000;
  }
  return null;
}

/**
 * @param {Date} [fromDate]
 * @param {number} [days]
 * @returns {admin.firestore.Timestamp}
 */
function computeAccessExpiresAt(fromDate, days) {
  const durationDays = days != null ? days : INSTITUTION_ACCESS_DURATION_DAYS;
  const base = fromDate instanceof Date ? fromDate : new Date();
  return admin.firestore.Timestamp.fromDate(
    new Date(base.getTime() + durationDays * MS_PER_DAY)
  );
}

/**
 * @param {string} extendedBy
 * @param {Date} [fromDate]
 * @returns {Object}
 */
function buildInstitutionAccessFields(extendedBy, fromDate) {
  const base = fromDate instanceof Date ? fromDate : new Date();
  const startsAt = admin.firestore.Timestamp.fromDate(base);
  return {
    institutionAccessStartsAt: startsAt,
    institutionAccessExpiresAt: computeAccessExpiresAt(base),
    institutionAccessDurationDays: INSTITUTION_ACCESS_DURATION_DAYS,
    institutionAccessLastExtendedAt: startsAt,
    institutionAccessExtendedBy: extendedBy
  };
}

/**
 * Callable: institution_admin -> Tenant student create
 * Creates Auth user + users doc + tenantMemberships doc for own tenant only.
 */
exports.createTenantStudentForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
  const usernameRaw = (data && data.username ? String(data.username) : '');
  const password = (data && data.password ? String(data.password) : '');
  const emailOverrideRaw = (data && data.emailOverride ? String(data.emailOverride) : '');
  const fullNameRaw = (data && data.fullName ? String(data.fullName) : '');
  const periodGroupRaw = (data && data.periodGroup ? String(data.periodGroup) : '');
  const resolvedProgramType = resolveRequestedProgramType(data && data.programType);

  const username = usernameRaw.trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
  const emailOverride = emailOverrideRaw.trim().toLowerCase();
  const fallbackEmail = username ? (username + '@surucu.app') : '';
  const email = emailOverride || fallbackEmail;
  const fullName = fullNameRaw.trim();
  const periodGroup = periodGroupRaw.trim();

  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }
  if (!username) {
    throw new HttpsError('invalid-argument', 'username is required.');
  }
  if (!password || password.length < 6) {
    throw new HttpsError('invalid-argument', 'Şifre en az 6 karakter olmalı.');
  }
  if (!email) {
    throw new HttpsError('invalid-argument', 'Geçerli e-posta üretilemedi.');
  }

  const callerMembershipId = callerUid + '_' + tenantId;
  const callerMembershipSnap = await db.collection('tenantMemberships').doc(callerMembershipId).get();
  const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
  const callerRole = String(callerMembership.role || '').toLowerCase();
  const callerStatus = String(callerMembership.status || '').toLowerCase();
  if (!callerMembershipSnap.exists || callerRole !== 'institution_admin' || callerStatus !== 'active') {
    throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
  }

  const existingUsernameSnap = await db.collection('users').where('username', '==', username).limit(1).get();
  if (existingUsernameSnap && !existingUsernameSnap.empty) {
    throw new HttpsError('already-exists', 'Bu kullanıcı adı zaten kullanılıyor.');
  }

  let newUid = '';
  try {
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password
    });
    newUid = userRecord && userRecord.uid ? String(userRecord.uid) : '';
    if (!newUid) {
      throw new HttpsError('internal', 'Kullanıcı oluşturulamadı.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const userPayload = {
      username: username,
      email: email,
      role: 'student',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: callerUid
    };
    if (fullName) userPayload.fullName = fullName;

    const membershipId = newUid + '_' + tenantId;
    const memPayload = {
      uid: newUid,
      tenantId: tenantId,
      role: 'student',
      status: 'active',
      programType: resolvedProgramType,
      enrollmentSource: ENROLLMENT_SOURCE_INSTITUTION,
      createdAt: now,
      updatedAt: now,
      createdBy: callerUid,
      ...buildInstitutionAccessFields(callerUid)
    };
    if (periodGroup) memPayload.periodGroup = periodGroup;

    await db.collection('users').doc(newUid).set(userPayload, { merge: true });
    await db.collection('tenantMemberships').doc(membershipId).set(memPayload, { merge: true });

    console.info('[createTenantStudentForInstitutionAdmin] student created with institution access window', {
      tenantId: tenantId,
      membershipId: membershipId,
      activeDays: INSTITUTION_ACCESS_DURATION_DAYS,
      programType: resolvedProgramType,
      enrollmentSource: ENROLLMENT_SOURCE_INSTITUTION
    });

    return {
      ok: true,
      uid: newUid,
      username: username,
      tenantId: tenantId,
      programType: resolvedProgramType,
      enrollmentSource: ENROLLMENT_SOURCE_INSTITUTION
    };
  } catch (e) {
    if (newUid) {
      try {
        await admin.auth().deleteUser(newUid);
      } catch (_) {}
    }
    if (e instanceof HttpsError) throw e;
    const code = String((e && e.code) || '');
    if (code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Bu kullanıcı adı zaten kullanılıyor.');
    }
    if (code === 'auth/invalid-password') {
      throw new HttpsError('invalid-argument', 'Şifre en az 6 karakter olmalı.');
    }
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to create tenant student.');
  }
});

/**
 * Callable: authenticated user -> bootstrap public machine_operator membership on platform tenant.
 * Idempotent. Does not grant entitlements or create tenants/surucu_akademisi.
 */
exports.bootstrapPublicMachineCandidate = onCall(
  { region: 'us-central1' },
  async (request) => {
    const uid = request && request.auth ? request.auth.uid : null;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const requestData = (request && request.data && typeof request.data === 'object') ? request.data : {};
    const fullNameProvided = Object.prototype.hasOwnProperty.call(requestData, 'fullName');
    let normalizedFullName = '';
    if (fullNameProvided) {
      if (typeof requestData.fullName !== 'string') {
        throw new HttpsError('invalid-argument', 'Ad Soyad geçerli bir metin olmalıdır.');
      }
      normalizedFullName = String(requestData.fullName).trim().replace(/\s+/g, ' ');
      if (!normalizedFullName) {
        throw new HttpsError('invalid-argument', 'Lütfen adınızı ve soyadınızı girin.');
      }
      if (normalizedFullName.length < 2) {
        throw new HttpsError('invalid-argument', 'Ad Soyad en az 2 karakter olmalıdır.');
      }
      if (normalizedFullName.length > 200) {
        throw new HttpsError('invalid-argument', 'Ad Soyad en fazla 200 karakter olabilir.');
      }
    }

    const tenantId = PLATFORM_MACHINE_TENANT_ID;
    const membershipId = uid + '_' + tenantId;

    let authUser;
    try {
      authUser = await admin.auth().getUser(uid);
    } catch (e) {
      throw new HttpsError('not-found', 'Kullanıcı bulunamadı.');
    }
    if (authUser && authUser.disabled === true) {
      throw new HttpsError('failed-precondition', 'Hesap devre dışı.', {
        code: 'MACHINE_ACCOUNT_CONFLICT'
      });
    }

    const userRef = db.collection('users').doc(uid);
    const membershipRef = db.collection('tenantMemberships').doc(membershipId);
    const [userSnap, membershipSnap] = await Promise.all([userRef.get(), membershipRef.get()]);

    if (userSnap.exists) {
      const userData = userSnap.data() || {};
      const role = normalizeRole(userData.role || userData.globalRole);
      if (role === 'super_admin' || role === 'institution_admin') {
        throw new HttpsError('permission-denied', 'Bu hesap iş makineleri aday kaydı için uygun değil.', {
          code: 'MACHINE_ACCOUNT_CONFLICT'
        });
      }
      if (role === 'public_user') {
        throw new HttpsError(
          'failed-precondition',
          'Bu hesap bireysel public_user hesabıdır. İş makineleri kaydı için uygun değil.',
          { code: 'MACHINE_ACCOUNT_CONFLICT' }
        );
      }
      if (role && role !== 'student') {
        throw new HttpsError('failed-precondition', 'Bu hesap iş makineleri aday kaydı için uygun değil.', {
          code: 'MACHINE_ACCOUNT_CONFLICT'
        });
      }
      if (userData.isActive === false) {
        throw new HttpsError('failed-precondition', 'Hesap aktif değil.', {
          code: 'MACHINE_ACCOUNT_CONFLICT'
        });
      }
    }

    if (membershipSnap.exists) {
      const mem = membershipSnap.data() || {};
      const memRole = normalizeRole(mem.role);
      const memTenantId = String(mem.tenantId || '').trim();
      const memProgram = normalizeProgramType(mem.programType);
      const memEnrollment = normalizeEnrollmentSource(mem.enrollmentSource, memTenantId, mem.programType);
      const compatible =
        memRole === 'student' &&
        memProgram === MACHINE_PROGRAM_TYPE &&
        memEnrollment === ENROLLMENT_SOURCE_PUBLIC &&
        memTenantId === PLATFORM_MACHINE_TENANT_ID;
      if (!compatible) {
        throw new HttpsError(
          'failed-precondition',
          'Mevcut platform üyeliği iş makineleri public kaydı ile uyumlu değil.',
          { code: 'MACHINE_ACCOUNT_CONFLICT' }
        );
      }
      if (normalizedFullName) {
        const existingFullName = String(((userSnap.exists ? userSnap.data() : {}) || {}).fullName || '').trim();
        if (!existingFullName) {
          await userRef.set(
            {
              fullName: normalizedFullName,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
      }
      await membershipRef.set(
        { updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      return {
        ok: true,
        uid: uid,
        tenantId: tenantId,
        membershipId: membershipId,
        programType: MACHINE_PROGRAM_TYPE,
        enrollmentSource: ENROLLMENT_SOURCE_PUBLIC
      };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const authEmail = authUser && authUser.email ? String(authUser.email).trim().toLowerCase() : '';

    if (!userSnap.exists) {
      const newUserPayload = {
        role: 'student',
        isActive: true,
        createdAt: now,
        updatedAt: now
      };
      if (authEmail) newUserPayload.email = authEmail;
      if (normalizedFullName) newUserPayload.fullName = normalizedFullName;
      await userRef.set(newUserPayload, { merge: true });
    } else {
      const existingData = userSnap.data() || {};
      const patch = {
        role: 'student',
        isActive: true,
        updatedAt: now
      };
      const existingEmail = String(existingData.email || '').trim();
      if (!existingEmail && authEmail) patch.email = authEmail;
      const existingFullName = String(existingData.fullName || '').trim();
      if (normalizedFullName && !existingFullName) patch.fullName = normalizedFullName;
      await userRef.set(patch, { merge: true });
    }

    await membershipRef.set({
      uid: uid,
      tenantId: tenantId,
      role: 'student',
      status: 'active',
      programType: MACHINE_PROGRAM_TYPE,
      enrollmentSource: ENROLLMENT_SOURCE_PUBLIC,
      createdAt: now,
      updatedAt: now
    }, { merge: true });

    return {
      ok: true,
      uid: uid,
      tenantId: tenantId,
      membershipId: membershipId,
      programType: MACHINE_PROGRAM_TYPE,
      enrollmentSource: ENROLLMENT_SOURCE_PUBLIC
    };
  }
);

/**
 * Callable: authenticated user -> resolve machine_operator session (institution or public).
 */
exports.resolveMachineCandidateSession = onCall(
  { region: 'us-central1' },
  async (request) => {
    const uid = request && request.auth ? request.auth.uid : null;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request.data || {};
    const mode = String(data.mode || '').trim().toLowerCase();
    if (mode !== 'institution' && mode !== 'public') {
      throw new HttpsError('invalid-argument', 'mode must be institution or public.');
    }

    let authUser;
    try {
      authUser = await admin.auth().getUser(uid);
    } catch (e) {
      throw new HttpsError('not-found', 'Kullanıcı bulunamadı.');
    }
    if (authUser && authUser.disabled === true) {
      throw new HttpsError('failed-precondition', 'Hesap devre dışı.', {
        code: 'MACHINE_ACCOUNT_CONFLICT'
      });
    }

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      if (mode === 'public') {
        throw new HttpsError(
          'failed-precondition',
          'İş makineleri bireysel aday kaydı oluşturulmalıdır.',
          { code: 'MACHINE_ENROLLMENT_REQUIRED' }
        );
      }
      throw new HttpsError('not-found', 'Kullanıcı kaydı bulunamadı.');
    }
    const userData = userSnap.data() || {};
    const userRole = normalizeRole(userData.role || userData.globalRole);
    if (userRole !== 'student') {
      throw new HttpsError('permission-denied', 'Bu hesap öğrenci hesabı değil.');
    }
    if (userData.isActive === false) {
      throw new HttpsError('failed-precondition', 'Hesap aktif değil.', {
        code: 'MACHINE_ACCOUNT_CONFLICT'
      });
    }

    let resolvedTenantId = '';
    if (mode === 'public') {
      resolvedTenantId = PLATFORM_MACHINE_TENANT_ID;
    } else {
      resolvedTenantId = (data.tenantId != null ? String(data.tenantId) : '').trim();
      if (!resolvedTenantId) {
        throw new HttpsError('invalid-argument', 'tenantId is required.');
      }
    }

    const membershipId = uid + '_' + resolvedTenantId;
    const membershipSnap = await db.collection('tenantMemberships').doc(membershipId).get();
    if (!membershipSnap.exists) {
      if (mode === 'public') {
        throw new HttpsError(
          'failed-precondition',
          'İş makineleri kaydı bulunamadı. Lütfen önce hesap oluşturun.',
          { code: 'MACHINE_ENROLLMENT_REQUIRED' }
        );
      }
      throw new HttpsError('not-found', 'Üyelik bulunamadı.');
    }

    const mem = membershipSnap.data() || {};
    if (mem.uid != null && String(mem.uid).trim() && String(mem.uid).trim() !== uid) {
      throw new HttpsError('permission-denied', 'Üyelik kullanıcı ile eşleşmiyor.');
    }
    const memTenantId = String(mem.tenantId || '').trim();
    if (memTenantId !== resolvedTenantId) {
      throw new HttpsError('permission-denied', 'Üyelik kurum ile eşleşmiyor.');
    }
    if (normalizeRole(mem.role) !== 'student') {
      throw new HttpsError('permission-denied', 'Üyelik öğrenci değil.');
    }
    if (normalizeRole(mem.status) !== 'active') {
      throw new HttpsError('failed-precondition', 'Üyelik aktif değil.', {
        code: 'MACHINE_MEMBERSHIP_INACTIVE'
      });
    }

    const programType = normalizeProgramType(mem.programType);
    if (programType !== MACHINE_PROGRAM_TYPE) {
      throw new HttpsError('failed-precondition', 'Bu üyelik iş makineleri programına ait değil.', {
        code: 'MACHINE_PROGRAM_MISMATCH'
      });
    }

    const expectedEnrollment =
      mode === 'public' ? ENROLLMENT_SOURCE_PUBLIC : ENROLLMENT_SOURCE_INSTITUTION;
    const enrollmentSource = normalizeEnrollmentSource(
      mem.enrollmentSource,
      memTenantId,
      mem.programType
    );
    if (enrollmentSource !== expectedEnrollment) {
      throw new HttpsError('failed-precondition', 'Kayıt kaynağı giriş türü ile uyuşmuyor.', {
        code: 'MACHINE_ENROLLMENT_SOURCE_MISMATCH'
      });
    }

    let accessExpiresAt = null;
    let accessDaysRemaining = null;
    let accessStatus = 'unlimited';

    if (mode === 'institution') {
      const expiresMs = membershipExpiryToMillis(mem.institutionAccessExpiresAt);
      if (expiresMs != null) {
        accessExpiresAt = expiresMs;
        const now = Date.now();
        accessDaysRemaining = Math.max(0, Math.ceil((expiresMs - now) / MS_PER_DAY));
        if (expiresMs <= now) {
          throw new HttpsError('failed-precondition', 'Kurum erişim süresi dolmuş.', {
            code: 'MACHINE_ACCESS_EXPIRED'
          });
        }
        accessStatus = 'active';
      } else {
        accessStatus = 'unlimited';
      }
    }

    return {
      ok: true,
      uid: uid,
      tenantId: resolvedTenantId,
      membershipId: membershipId,
      programType: MACHINE_PROGRAM_TYPE,
      enrollmentSource: enrollmentSource,
      accessExpiresAt: accessExpiresAt,
      accessDaysRemaining: accessDaysRemaining,
      accessStatus: accessStatus
    };
  }
);

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

async function assertTenantAdminAccess(callerUid, tenantId) {
  const callerMembershipId = callerUid + '_' + tenantId;
  const [callerUserSnap, callerMembershipSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('tenantMemberships').doc(callerMembershipId).get()
  ]);
  const callerRole = normalizeRole(callerUserSnap.exists ? (callerUserSnap.data() || {}).role : '');
  if (callerRole === 'super_admin') {
    return { isSuperAdmin: true };
  }

  const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
  const membershipRole = normalizeRole(callerMembership.role);
  const membershipStatus = normalizeRole(callerMembership.status);
  if (!callerMembershipSnap.exists || membershipRole !== 'institution_admin' || membershipStatus !== 'active') {
    throw new HttpsError('permission-denied', 'Not authorized for this tenant.');
  }

  return { isSuperAdmin: false };
}

function resolveMembershipId(data, tenantId) {
  const membershipIdRaw = data && data.membershipId ? String(data.membershipId).trim() : '';
  if (membershipIdRaw) return membershipIdRaw;
  const uidRaw = data && data.uid ? String(data.uid).trim() : '';
  if (!uidRaw) {
    throw new HttpsError('invalid-argument', 'uid or membershipId is required.');
  }
  return uidRaw + '_' + tenantId;
}

/** Max writes per Firestore batch for student hard-delete cascade cleanup. */
const STUDENT_CLEANUP_BATCH_SIZE = 400;

/**
 * Paginated delete for an arbitrary Firestore query (bounded batches).
 * Empty query / already-cleared docs → success (0).
 * @param {FirebaseFirestore.Query} queryRef
 * @param {number} [batchSize]
 * @returns {Promise<number>}
 */
async function deleteQueryDocsPaginated(queryRef, batchSize) {
  const limit = batchSize || STUDENT_CLEANUP_BATCH_SIZE;
  let deleted = 0;
  while (true) {
    const snap = await queryRef.limit(limit).get();
    if (!snap || snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < limit) break;
  }
  return deleted;
}

/**
 * Paginated delete of all docs in a collection (no recursion into nested subs).
 * @param {FirebaseFirestore.CollectionReference} collectionRef
 * @param {number} [batchSize]
 * @returns {Promise<number>}
 */
async function deleteCollectionDocsPaginated(collectionRef, batchSize) {
  const limit = batchSize || STUDENT_CLEANUP_BATCH_SIZE;
  let deleted = 0;
  while (true) {
    const snap = await collectionRef.limit(limit).get();
    if (!snap || snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < limit) break;
  }
  return deleted;
}

/**
 * Recursive delete of a document and all descendant subcollections.
 * Missing root doc → success.
 * @param {FirebaseFirestore.DocumentReference} docRef
 * @returns {Promise<boolean>}
 */
async function deleteDocRecursiveSafe(docRef) {
  try {
    await db.recursiveDelete(docRef);
    return true;
  } catch (e) {
    const snap = await docRef.get();
    if (!snap.exists) return true;
    try {
      await docRef.delete();
      return true;
    } catch (_) {
      const again = await docRef.get();
      if (!again.exists) return true;
      throw e;
    }
  }
}

/**
 * Delete a top-level doc if present. Missing → success.
 * @param {FirebaseFirestore.DocumentReference} docRef
 * @returns {Promise<boolean>} true if deleted or already absent
 */
async function deleteDocIfExists(docRef) {
  const snap = await docRef.get();
  if (!snap.exists) return true;
  await docRef.delete();
  return true;
}

/**
 * Internal cascade cleanup for hard-deleted institution student identity.
 * Call ONLY after single-membership guard has passed.
 * Does NOT touch tenantMailbox, forum, shared duels, paymentOrders/paymentEvents, Storage.
 *
 * @param {{ tenantId: string, uid: string }} params
 * @returns {Promise<object>}
 */
async function cleanupDeletedStudentOwnedData(params) {
  const tenantId = String((params && params.tenantId) || '').trim();
  const uid = String((params && params.uid) || '').trim();
  if (!tenantId || !uid) {
    throw new HttpsError('invalid-argument', 'tenantId and uid are required for student cleanup.');
  }

  const counts = {
    tenantExamAttempts: 0,
    tenantLessonProgress: 0,
    webExamAttempts: 0,
    lessonProgress: 0,
    webLessonProgress: 0,
    announcementPopupState: 0,
    deviceTokens: 0,
    mailboxThreadStates: 0
  };

  // Tenant-scoped learning data (this tenant only).
  counts.tenantExamAttempts = await deleteQueryDocsPaginated(
    db.collection('tenants').doc(tenantId).collection('exam_attempts').where('uid', '==', uid)
  );
  counts.tenantLessonProgress = await deleteQueryDocsPaginated(
    db.collection('tenants').doc(tenantId).collection('lesson_progress').where('uid', '==', uid)
  );

  // User-owned learning mirrors / progress (global to deleted Auth identity).
  const userRef = db.collection('users').doc(uid);
  counts.webExamAttempts = await deleteCollectionDocsPaginated(userRef.collection('web_exam_attempts'));
  counts.lessonProgress = await deleteCollectionDocsPaginated(userRef.collection('lessonProgress'));
  counts.webLessonProgress = await deleteCollectionDocsPaginated(userRef.collection('web_lesson_progress'));
  counts.announcementPopupState = await deleteCollectionDocsPaginated(userRef.collection('announcementPopupState'));
  counts.deviceTokens = await deleteCollectionDocsPaginated(userRef.collection('deviceTokens'));
  counts.mailboxThreadStates = await deleteCollectionDocsPaginated(userRef.collection('mailboxThreadStates'));

  // Private mailbox tree (NOT tenantMailbox).
  await deleteDocRecursiveSafe(db.collection('userMailbox').doc(uid));

  // Live access grant + public display + duel ephemeral / user league tree.
  await deleteDocIfExists(db.collection('userEntitlements').doc(uid));
  await deleteDocIfExists(db.collection('publicProfiles').doc(uid));
  await deleteDocIfExists(db.collection('duel_presence').doc(uid));
  await deleteDocRecursiveSafe(db.collection('duelLeague').doc(uid));

  return counts;
}

/** Temporary duration-only diagnostics for deactivateTenantStudentForInstitutionAdmin. */
function saTpServerPerfNowMs() {
  try {
    if (typeof process !== 'undefined' && process.hrtime && typeof process.hrtime.bigint === 'function') {
      return Number(process.hrtime.bigint()) / 1e6;
    }
  } catch (_) {}
  return Date.now();
}

function saTpServerPerfLog(phase, fields) {
  try {
    const payload = Object.assign({ action: 'deactivate', phase: phase }, fields || {});
    console.info('[SA-TP-SERVER-PERF] ' + phase + ' ' + JSON.stringify(payload));
  } catch (_) {}
}

exports.deactivateTenantStudentForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const invStart = saTpServerPerfNowMs();
  let currentPhase = 'invocation:start';
  try {
    saTpServerPerfLog('invocation:start', {
      totalDurationMs: 0,
      instanceUptimeMs: Math.round((typeof process !== 'undefined' && typeof process.uptime === 'function' ? process.uptime() : 0) * 1000)
    });

    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    const membershipId = resolveMembershipId(data, tenantId);

    currentPhase = 'tenant-admin-access';
    const accessStart = saTpServerPerfNowMs();
    await assertTenantAdminAccess(callerUid, tenantId);
    saTpServerPerfLog('tenant-admin-access:end', { durationMs: Math.round(saTpServerPerfNowMs() - accessStart) });

    currentPhase = 'target-membership-read';
    const readStart = saTpServerPerfNowMs();
    const membershipRef = db.collection('tenantMemberships').doc(membershipId);
    const membershipSnap = await membershipRef.get();
    saTpServerPerfLog('target-membership-read:end', { durationMs: Math.round(saTpServerPerfNowMs() - readStart) });
    if (!membershipSnap.exists) {
      throw new HttpsError('not-found', 'Membership not found.');
    }

    const membershipData = membershipSnap.data() || {};
    const targetTenantId = String(membershipData.tenantId || '').trim();
    const targetRole = normalizeRole(membershipData.role);
    const targetUid = String(membershipData.uid || '').trim();
    if (!targetUid) {
      throw new HttpsError('failed-precondition', 'Target uid is missing in membership.');
    }
    if (targetTenantId !== tenantId) {
      throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
    }
    if (targetRole !== 'student') {
      throw new HttpsError('invalid-argument', 'Only student memberships can be deactivated.');
    }

    const suspendedReason = (data && data.reason ? String(data.reason) : '').trim();
    currentPhase = 'membership-write';
    const writeStart = saTpServerPerfNowMs();
    await membershipRef.set({
      status: 'suspended',
      suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
      suspendedBy: callerUid,
      suspendedReason: suspendedReason || admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    saTpServerPerfLog('membership-write:end', { durationMs: Math.round(saTpServerPerfNowMs() - writeStart) });

    currentPhase = 'other-active-membership-query';
    const queryStart = saTpServerPerfNowMs();
    const activeMembershipSnap = await db.collection('tenantMemberships')
      .where('uid', '==', targetUid)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    saTpServerPerfLog('other-active-membership-query:end', { durationMs: Math.round(saTpServerPerfNowMs() - queryStart) });
    const hasOtherActiveMembership = activeMembershipSnap && !activeMembershipSnap.empty;

    let authDisabled = false;
    currentPhase = 'auth-disable';
    if (!hasOtherActiveMembership) {
      const authStart = saTpServerPerfNowMs();
      try {
        await admin.auth().updateUser(targetUid, { disabled: true });
        authDisabled = true;
        saTpServerPerfLog('auth-disable:end', { durationMs: Math.round(saTpServerPerfNowMs() - authStart), skipped: false });
      } catch (e) {
        const code = String((e && e.code) || '');
        if (code !== 'auth/user-not-found') {
          throw e;
        }
        saTpServerPerfLog('auth-disable:end', { durationMs: Math.round(saTpServerPerfNowMs() - authStart), skipped: false });
      }
    } else {
      saTpServerPerfLog('auth-disable:end', { durationMs: 0, skipped: true });
    }

    saTpServerPerfLog('invocation:end', {
      totalDurationMs: Math.round(saTpServerPerfNowMs() - invStart),
      success: true
    });

    return {
      ok: true,
      uid: targetUid,
      tenantId: tenantId,
      membershipId: membershipId,
      authDisabled: authDisabled
    };
  } catch (err) {
    try {
      const errorCode = (err && err.code) ? String(err.code) : 'unknown';
      saTpServerPerfLog('invocation:error', {
        phase: currentPhase,
        totalDurationMs: Math.round(saTpServerPerfNowMs() - invStart),
        success: false,
        errorCode: errorCode
      });
    } catch (_) {}
    throw err;
  }
});

exports.reactivateTenantStudentForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }

  const membershipId = resolveMembershipId(data, tenantId);
  await assertTenantAdminAccess(callerUid, tenantId);

  const membershipRef = db.collection('tenantMemberships').doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) {
    throw new HttpsError('not-found', 'Membership not found.');
  }

  const membershipData = membershipSnap.data() || {};
  const targetTenantId = String(membershipData.tenantId || '').trim();
  const targetRole = normalizeRole(membershipData.role);
  const targetUid = String(membershipData.uid || '').trim();
  if (!targetUid) {
    throw new HttpsError('failed-precondition', 'Target uid is missing in membership.');
  }
  if (targetTenantId !== tenantId) {
    throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
  }
  if (targetRole !== 'student') {
    throw new HttpsError('invalid-argument', 'Only student memberships can be reactivated.');
  }

  await membershipRef.set({
    status: 'active',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reactivatedBy: callerUid
  }, { merge: true });

  let authEnabled = false;
  try {
    await admin.auth().updateUser(targetUid, { disabled: false });
    authEnabled = true;
  } catch (e) {
    const code = String((e && e.code) || '');
    if (code !== 'auth/user-not-found') {
      throw e;
    }
  }

  return {
    ok: true,
    uid: targetUid,
    tenantId: tenantId,
    membershipId: membershipId,
    authEnabled: authEnabled
  };
});

/**
 * Callable: institution_admin -> Extend institution student access by 90 days
 */
exports.extendInstitutionStudentAccessForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
  const studentUid = (data && data.studentUid ? String(data.studentUid) : '').trim();
  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }
  if (!studentUid) {
    throw new HttpsError('invalid-argument', 'studentUid is required.');
  }

  await assertTenantAdminAccess(callerUid, tenantId);

  const membershipId = studentUid + '_' + tenantId;
  const membershipRef = db.collection('tenantMemberships').doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) {
    throw new HttpsError('not-found', 'Membership not found.');
  }

  const membershipData = membershipSnap.data() || {};
  const targetTenantId = String(membershipData.tenantId || '').trim();
  const targetRole = normalizeRole(membershipData.role);
  const targetUid = String(membershipData.uid || '').trim();
  if (!targetUid) {
    throw new HttpsError('failed-precondition', 'Target uid is missing in membership.');
  }
  if (targetUid !== studentUid) {
    throw new HttpsError('permission-denied', 'Membership uid does not match studentUid.');
  }
  if (targetTenantId !== tenantId) {
    throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
  }
  if (targetRole !== 'student') {
    throw new HttpsError('invalid-argument', 'Only student memberships can be extended.');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const accessFields = buildInstitutionAccessFields(callerUid);
  const updatePayload = {
    status: 'active',
    updatedAt: now,
    reactivatedAt: now,
    reactivatedBy: callerUid,
    ...accessFields
  };

  const suspendedReason = String(membershipData.suspendedReason || '').trim().toLowerCase();
  if (suspendedReason === 'access_expired') {
    updatePayload.suspendedReason = admin.firestore.FieldValue.delete();
  }

  await membershipRef.set(updatePayload, { merge: true });

  let authEnabled = false;
  try {
    await admin.auth().updateUser(targetUid, { disabled: false });
    authEnabled = true;
  } catch (e) {
    const code = String((e && e.code) || '');
    if (code !== 'auth/user-not-found') {
      throw e;
    }
  }

  console.info('[extendInstitutionStudentAccessForInstitutionAdmin] access extended', {
    tenantId: tenantId,
    membershipId: membershipId,
    activeDays: INSTITUTION_ACCESS_DURATION_DAYS,
    authEnabled: authEnabled
  });

  return {
    ok: true,
    studentUid: targetUid,
    tenantId: tenantId,
    activeDays: INSTITUTION_ACCESS_DURATION_DAYS,
    message: 'Öğrenci 90 gün boyunca tekrar aktif hale getirildi.'
  };
});

exports.deleteTenantStudentForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }

  const membershipId = resolveMembershipId(data, tenantId);
  await assertTenantAdminAccess(callerUid, tenantId);

  const membershipRef = db.collection('tenantMemberships').doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) {
    throw new HttpsError('not-found', 'Membership not found.');
  }

  const membershipData = membershipSnap.data() || {};
  const targetTenantId = String(membershipData.tenantId || '').trim();
  const targetRole = normalizeRole(membershipData.role);
  const targetUid = String(membershipData.uid || '').trim();
  if (!targetUid) {
    throw new HttpsError('failed-precondition', 'Target uid is missing in membership.');
  }
  if (targetTenantId !== tenantId) {
    throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
  }
  if (targetRole !== 'student') {
    throw new HttpsError('invalid-argument', 'Only student memberships can be deleted.');
  }

  const targetMembershipsSnap = await db.collection('tenantMemberships')
    .where('uid', '==', targetUid)
    .get();
  if (targetMembershipsSnap.size > 1) {
    throw new HttpsError(
      'failed-precondition',
      'Bu öğrencinin birden fazla kurum üyeliği var. Kalıcı silme için Super Admin özel temizlik akışı gerekir.'
    );
  }

  // Cascade owned/private data BEFORE membership / users / Auth finalization.
  // Abort hard delete if cleanup fails so identity remains recoverable.
  let cleanupCounts = null;
  try {
    cleanupCounts = await cleanupDeletedStudentOwnedData({
      tenantId: tenantId,
      uid: targetUid
    });
  } catch (cleanupErr) {
    if (cleanupErr instanceof HttpsError) throw cleanupErr;
    console.error('[deleteTenantStudentForInstitutionAdmin] cascade cleanup failed', {
      tenantId: tenantId,
      uid: targetUid,
      membershipId: membershipId,
      error: cleanupErr && cleanupErr.message ? cleanupErr.message : String(cleanupErr)
    });
    throw new HttpsError(
      'internal',
      'Öğrenciye bağlı veriler temizlenirken hata oluştu. Kalıcı silme iptal edildi.'
    );
  }

  const paymentRef = db.collection('tenants').doc(tenantId).collection('studentPayments').doc(targetUid);
  const paymentLogRef = paymentRef.collection('paymentLog');
  const paymentSnap = await paymentRef.get();

  let paymentLogDeletedCount = 0;
  while (true) {
    const logSnap = await paymentLogRef.limit(200).get();
    if (!logSnap || logSnap.empty) break;
    const batch = db.batch();
    logSnap.docs.forEach((doc) => {
      batch.delete(doc.ref);
      paymentLogDeletedCount++;
    });
    await batch.commit();
  }

  let paymentDeleted = false;
  if (paymentSnap.exists) {
    await paymentRef.delete();
    paymentDeleted = true;
  } else if (paymentLogDeletedCount > 0) {
    paymentDeleted = true;
  }

  await membershipRef.delete();
  const membershipDeleted = true;

  const userRef = db.collection('users').doc(targetUid);
  const userSnap = await userRef.get();
  let userDocDeleted = false;
  if (userSnap.exists) {
    await userRef.delete();
    userDocDeleted = true;
  }

  let authDeleted = false;
  try {
    await admin.auth().deleteUser(targetUid);
    authDeleted = true;
  } catch (e) {
    const code = String((e && e.code) || '');
    if (code !== 'auth/user-not-found') {
      throw e;
    }
  }

  return {
    ok: true,
    uid: targetUid,
    tenantId: tenantId,
    authDeleted: authDeleted,
    userDocDeleted: userDocDeleted,
    membershipDeleted: membershipDeleted,
    paymentDeleted: paymentDeleted,
    cleanup: cleanupCounts || {}
  };
});

const ENTITLEMENT_SOURCE_SUPER_ADMIN = 'super_admin_manual';

/**
 * @param {string} callerUid
 * @returns {Promise<void>}
 */
async function assertSuperAdminOnly(callerUid) {
  const callerUserSnap = await db.collection('users').doc(callerUid).get();
  const callerRole = normalizeRole(callerUserSnap.exists ? (callerUserSnap.data() || {}).role : '');
  if (callerRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super_admin can manage user entitlements.');
  }
}

/**
 * @param {string} studentUid
 * @returns {Promise<Object>}
 */
async function assertTargetStudentUser(studentUid) {
  const uid = String(studentUid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'studentUid is required.');
  }
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'Target user not found.');
  }
  const userData = userSnap.data() || {};
  const role = normalizeRole(userData.role);
  if (role !== 'student') {
    throw new HttpsError('invalid-argument', 'Target user must have role student.');
  }
  return { uid, userData };
}

/**
 * Entitlement callables: student or public_user targets only.
 * @param {string} targetUid
 * @returns {Promise<Object>}
 */
async function assertTargetEntitlementUser(targetUid) {
  const uid = String(targetUid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Target user id is required.');
  }
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'Target user not found.');
  }
  const userData = userSnap.data() || {};
  const role = normalizeRole(userData.role || userData.globalRole);
  if (role !== 'student' && role !== 'public_user') {
    throw new HttpsError(
      'invalid-argument',
      'Target user must have role student or public_user.'
    );
  }
  return { uid, userData };
}

/**
 * Callable: super_admin -> Grant manual ad-free entitlement for a student
 */
exports.setUserAdFreeEntitlementForSuperAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  await assertSuperAdminOnly(callerUid);

  const studentUid = (data && data.studentUid ? String(data.studentUid) : '').trim();
  const reasonRaw = data && data.reason != null ? String(data.reason) : '';
  const reason = reasonRaw.trim() || null;

  const target = await assertTargetEntitlementUser(studentUid);

  const payload = {
    adFree: true,
    source: ENTITLEMENT_SOURCE_SUPER_ADMIN,
    expiresAt: null,
    reason: reason,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: callerUid
  };

  await db.collection('userEntitlements').doc(target.uid).set(payload, { merge: true });

  return {
    ok: true,
    studentUid: target.uid,
    adFree: true,
    source: ENTITLEMENT_SOURCE_SUPER_ADMIN,
    message: 'Reklamsız kullanım yetkisi verildi.'
  };
});

/**
 * Callable: super_admin -> Revoke manual ad-free entitlement (doc retained for audit)
 */
exports.revokeUserAdFreeEntitlementForSuperAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  await assertSuperAdminOnly(callerUid);

  const studentUid = (data && data.studentUid ? String(data.studentUid) : '').trim();
  const reasonRaw = data && data.reason != null ? String(data.reason) : '';
  const reason = reasonRaw.trim() || null;

  const target = await assertTargetEntitlementUser(studentUid);

  const payload = {
    adFree: false,
    source: ENTITLEMENT_SOURCE_SUPER_ADMIN,
    expiresAt: null,
    reason: reason,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: callerUid
  };

  await db.collection('userEntitlements').doc(target.uid).set(payload, { merge: true });

  return {
    ok: true,
    studentUid: target.uid,
    adFree: false,
    source: ENTITLEMENT_SOURCE_SUPER_ADMIN,
    message: 'Reklamsız kullanım yetkisi kaldırıldı.'
  };
});

const DEFAULT_VIDEO_LESSONS_DURATION_DAYS = 180;

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
  const durationDays = Number.isFinite(Number(days)) ? Math.floor(Number(days)) : DEFAULT_VIDEO_LESSONS_DURATION_DAYS;
  start.setDate(start.getDate() + durationDays);
  return formatYyyyMmDd(start);
}

/**
 * @param {Object} data
 * @returns {string}
 */
function resolveEntitlementTargetUid(data) {
  return String(
    (data && (data.uid || data.userId || data.studentUid)) ? (data.uid || data.userId || data.studentUid) : ''
  ).trim();
}

/**
 * Callable: super_admin -> Grant 180-day teacher video premium for a student
 */
exports.grantUserVideoLessonsPremiumForSuperAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  await assertSuperAdminOnly(callerUid);

  const studentUid = resolveEntitlementTargetUid(data);
  const target = await assertTargetEntitlementUser(studentUid);

  let startDate = (data && data.startDate != null ? String(data.startDate) : '').trim();
  if (!startDate) startDate = todayYyyyMmDdLocal();
  if (!parseYyyyMmDdDate(startDate)) {
    throw new HttpsError('invalid-argument', 'startDate must be YYYY-MM-DD.');
  }

  let durationDays = data && data.durationDays != null ? Number(data.durationDays) : DEFAULT_VIDEO_LESSONS_DURATION_DAYS;
  if (!Number.isFinite(durationDays) || durationDays < 1) {
    durationDays = DEFAULT_VIDEO_LESSONS_DURATION_DAYS;
  }
  durationDays = Math.floor(durationDays);

  const expiresAt = addDaysToYyyyMmDd(startDate, durationDays);
  if (!expiresAt) {
    throw new HttpsError('invalid-argument', 'Could not compute videoLessonsExpiresAt.');
  }

  const paymentAmountRaw = data && data.paymentAmount != null ? Number(data.paymentAmount) : null;
  const paymentAmount = paymentAmountRaw != null && Number.isFinite(paymentAmountRaw) ? paymentAmountRaw : null;
  const noteRaw = data && data.note != null ? String(data.note) : '';
  const note = noteRaw.trim() || null;

  /** @type {Record<string, unknown>} */
  const payload = {
    videoLessonsPremium: true,
    videoLessonsStartedAt: startDate,
    videoLessonsExpiresAt: expiresAt,
    videoLessonsSource: ENTITLEMENT_SOURCE_SUPER_ADMIN,
    videoLessonsDurationDays: durationDays,
    videoLessonsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    videoLessonsUpdatedBy: callerUid
  };
  if (paymentAmount != null) payload.videoLessonsPaymentAmount = paymentAmount;
  if (note) payload.videoLessonsNote = note;

  await db.collection('userEntitlements').doc(target.uid).set(payload, { merge: true });

  return {
    ok: true,
    uid: target.uid,
    videoLessonsPremium: true,
    videoLessonsStartedAt: startDate,
    videoLessonsExpiresAt: expiresAt
  };
});

/**
 * Callable: super_admin -> Revoke teacher video premium (audit fields preserved)
 */
exports.revokeUserVideoLessonsPremiumForSuperAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
  const data = request.data;
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  await assertSuperAdminOnly(callerUid);

  const studentUid = resolveEntitlementTargetUid(data);
  const target = await assertTargetEntitlementUser(studentUid);

  const reasonRaw = data && data.reason != null ? String(data.reason) : '';
  const reason = reasonRaw.trim() || null;

  /** @type {Record<string, unknown>} */
  const payload = {
    videoLessonsPremium: false,
    videoLessonsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    videoLessonsUpdatedBy: callerUid
  };
  if (reason) payload.videoLessonsRevokeReason = reason;

  await db.collection('userEntitlements').doc(target.uid).set(payload, { merge: true });

  return {
    ok: true,
    uid: target.uid,
    videoLessonsPremium: false,
    videoLessonsStartedAt: null,
    videoLessonsExpiresAt: null
  };
});

/**
 * Phase 1 — Direksiyon Usta Öğretici create (institution_admin only).
 * Auth email is always {username}@surucu.app. Optional contactEmail is profile-only.
 */
exports.createTenantInstructorForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request.data;
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const usernameRaw = (data && data.username ? String(data.username) : '');
    const password = (data && data.password ? String(data.password) : '');
    const fullNameRaw = (data && data.fullName ? String(data.fullName) : '');
    const phoneRaw = (data && data.phone ? String(data.phone) : '');
    const contactEmailRaw = (data && data.contactEmail ? String(data.contactEmail) : '');

    const username = usernameRaw.trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    const authEmail = username ? username + '@surucu.app' : '';
    const fullName = fullNameRaw.trim().replace(/\s+/g, ' ');
    const phone = phoneRaw.trim();
    const contactEmail = contactEmailRaw.trim().toLowerCase();

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!fullName || fullName.length < 2) {
      throw new HttpsError('invalid-argument', 'Ad Soyad gereklidir.');
    }
    if (fullName.length > 200) {
      throw new HttpsError('invalid-argument', 'Ad Soyad en fazla 200 karakter olabilir.');
    }
    if (!username) {
      throw new HttpsError('invalid-argument', 'username is required.');
    }
    if (!password || password.length < 6) {
      throw new HttpsError('invalid-argument', 'Şifre en az 6 karakter olmalı.');
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new HttpsError('invalid-argument', 'İletişim e-postası geçersiz.');
    }
    if (phone && phone.length > 40) {
      throw new HttpsError('invalid-argument', 'Telefon en fazla 40 karakter olabilir.');
    }

    const callerMembershipId = callerUid + '_' + tenantId;
    const callerMembershipSnap = await db.collection('tenantMemberships').doc(callerMembershipId).get();
    const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
    const callerRole = normalizeRole(callerMembership.role);
    const callerStatus = normalizeRole(callerMembership.status);
    if (!callerMembershipSnap.exists || callerRole !== 'institution_admin' || callerStatus !== 'active') {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }

    const callerUserSnap = await db.collection('users').doc(callerUid).get();
    if (!callerUserSnap.exists) {
      throw new HttpsError('permission-denied', 'User profile could not be verified.');
    }
    assertElevatedInstitutionAdminPosition(callerUserSnap.data() || {});

    const existingUsernameSnap = await db.collection('users').where('username', '==', username).limit(1).get();
    if (existingUsernameSnap && !existingUsernameSnap.empty) {
      throw new HttpsError('already-exists', 'Bu kullanıcı adı zaten kullanılıyor.');
    }

    let newUid = '';
    try {
      const userRecord = await admin.auth().createUser({
        email: authEmail,
        password: password
      });
      newUid = userRecord && userRecord.uid ? String(userRecord.uid) : '';
      if (!newUid) {
        throw new HttpsError('internal', 'Kullanıcı oluşturulamadı.');
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const userPayload = {
        username: username,
        email: authEmail,
        fullName: fullName,
        role: 'instructor',
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: callerUid
      };
      if (phone) userPayload.phone = phone;
      if (contactEmail) userPayload.contactEmail = contactEmail;

      const membershipId = newUid + '_' + tenantId;
      const memPayload = {
        uid: newUid,
        tenantId: tenantId,
        role: 'instructor',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: callerUid
      };

      await db.collection('users').doc(newUid).set(userPayload, { merge: true });
      await db.collection('tenantMemberships').doc(membershipId).set(memPayload, { merge: true });

      return {
        ok: true,
        uid: newUid,
        username: username,
        tenantId: tenantId,
        membershipId: membershipId,
        role: 'instructor'
      };
    } catch (e) {
      if (newUid) {
        try {
          await admin.auth().deleteUser(newUid);
        } catch (_) {}
      }
      if (e instanceof HttpsError) throw e;
      const code = String((e && e.code) || '');
      if (code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'Bu kullanıcı adı zaten kullanılıyor.');
      }
      if (code === 'auth/invalid-password') {
        throw new HttpsError('invalid-argument', 'Şifre en az 6 karakter olmalı.');
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to create tenant instructor.'
      );
    }
  }
);

/**
 * Kurum Özeti — lightweight membership KPI summary for tenant panel Overview.
 * Auth: super_admin OR active institution_admin for the tenant (assertTenantAdminAccess).
 * Single tenantId query only; no user/profile payload loading.
 */
exports.getTenantOverviewStatsForAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    await assertTenantAdminAccess(callerUid, tenantId);

    const memSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .get();

    let studentTotal = 0;
    let studentDrivingCount = 0;
    let studentMachineCount = 0;
    let studentActiveCount = 0;
    let studentPassiveCount = 0;
    let instructorTotal = 0;
    let instructorActiveCount = 0;
    let instructorPassiveCount = 0;

    (memSnap.docs || []).forEach((doc) => {
      const m = doc.data() || {};
      const role = normalizeRole(m.role);
      const status = normalizeRole(m.status);
      const isActive = status === 'active';

      if (role === 'student') {
        studentTotal += 1;
        const programType = normalizeProgramType(m.programType);
        if (programType === MACHINE_PROGRAM_TYPE) {
          studentMachineCount += 1;
        } else {
          studentDrivingCount += 1;
        }
        if (isActive) studentActiveCount += 1;
        else studentPassiveCount += 1;
        return;
      }

      if (role === 'instructor') {
        instructorTotal += 1;
        if (isActive) instructorActiveCount += 1;
        else instructorPassiveCount += 1;
      }
    });

    return {
      ok: true,
      tenantId: tenantId,
      studentTotal: studentTotal,
      studentDrivingCount: studentDrivingCount,
      studentMachineCount: studentMachineCount,
      studentActiveCount: studentActiveCount,
      studentPassiveCount: studentPassiveCount,
      instructorTotal: instructorTotal,
      instructorActiveCount: instructorActiveCount,
      instructorPassiveCount: instructorPassiveCount
    };
  }
);

/**
 * Phase 1 — List Direksiyon Usta Öğreticiler for caller's tenant (institution_admin only).
 */
exports.listTenantInstructorsForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    const callerMembershipId = callerUid + '_' + tenantId;
    const callerMembershipSnap = await db.collection('tenantMemberships').doc(callerMembershipId).get();
    const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
    if (
      !callerMembershipSnap.exists ||
      normalizeRole(callerMembership.role) !== 'institution_admin' ||
      normalizeRole(callerMembership.status) !== 'active'
    ) {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }

    const memSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .where('role', '==', 'instructor')
      .get();

    const memberships = (memSnap.docs || []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const uids = [...new Set(memberships.map((m) => String(m.uid || '').trim()).filter(Boolean))];
    const usersMap = {};
    for (const uid of uids) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) usersMap[uid] = userSnap.data() || {};
    }

    function formatCreatedAt(ts) {
      try {
        if (!ts) return '—';
        const d = ts && typeof ts.toDate === 'function'
          ? ts.toDate()
          : (ts && ts._seconds ? new Date(ts._seconds * 1000) : null);
        return d ? d.toLocaleString('tr-TR') : '—';
      } catch (_) {
        return '—';
      }
    }

    const instructors = memberships.map((m) => {
      const uid = String(m.uid || '').trim();
      const user = usersMap[uid] || {};
      const status = String(m.status || '').trim().toLowerCase();
      const statusLabel = status === 'active' ? 'Aktif' : (status === 'suspended' ? 'Pasif' : (status || '—'));
      return {
        uid: uid,
        membershipId: m.id,
        username: user.username || (user.email ? String(user.email).split('@')[0] : '') || '—',
        fullName: (user.fullName && String(user.fullName).trim()) ? String(user.fullName).trim() : '—',
        phone: user.phone ? String(user.phone).trim() : '',
        contactEmail: user.contactEmail ? String(user.contactEmail).trim() : '',
        photoUrl: user.photoUrl ? String(user.photoUrl).trim() : (user.photoURL ? String(user.photoURL).trim() : ''),
        status: status,
        statusLabel: statusLabel,
        isActive: user.isActive !== false && status === 'active',
        createdAt: formatCreatedAt(user.createdAt) !== '—' ? formatCreatedAt(user.createdAt) : formatCreatedAt(m.createdAt)
      };
    });

    instructors.sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'tr'));

    return {
      ok: true,
      tenantId: tenantId,
      total: instructors.length,
      active: instructors.filter((i) => i.status === 'active').length,
      instructors: instructors
    };
  }
);

/**
 * ADMIN-MGMT-A — Create additional institution_admin in caller's tenant.
 * Auth email is always {username}@surucu.app. adminPosition is title-only (not Auth role).
 */
exports.createTenantInstitutionAdminForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const usernameRaw = (data && data.username ? String(data.username) : '');
    const password = (data && data.password ? String(data.password) : '');
    const fullNameRaw = (data && data.fullName ? String(data.fullName) : '');

    const authCtx = await assertActiveInstitutionAdminForTenant(callerUid, tenantId);
    assertElevatedInstitutionAdminPosition(authCtx && authCtx.userData);

    const username = usernameRaw.trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    const authEmail = username ? username + '@surucu.app' : '';
    const fullName = fullNameRaw.trim().replace(/\s+/g, ' ');
    const adminPosition = parseRequiredAdminPosition(data && data.adminPosition);

    if (!fullName || fullName.length < 2) {
      throw new HttpsError('invalid-argument', 'Ad Soyad gereklidir.');
    }
    if (fullName.length > 200) {
      throw new HttpsError('invalid-argument', 'Ad Soyad en fazla 200 karakter olabilir.');
    }
    if (!username) {
      throw new HttpsError('invalid-argument', 'username is required.');
    }
    if (!password || password.length < 6) {
      throw new HttpsError('invalid-argument', 'Şifre en az 6 karakter olmalı.');
    }

    const existingUsernameSnap = await db.collection('users').where('username', '==', username).limit(1).get();
    if (existingUsernameSnap && !existingUsernameSnap.empty) {
      throw new HttpsError('already-exists', 'Bu kullanıcı adı zaten kullanılıyor.');
    }

    let newUid = '';
    try {
      const userRecord = await admin.auth().createUser({
        email: authEmail,
        password: password
      });
      newUid = userRecord && userRecord.uid ? String(userRecord.uid) : '';
      if (!newUid) {
        throw new HttpsError('internal', 'Kullanıcı oluşturulamadı.');
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const userPayload = {
        username: username,
        email: authEmail,
        fullName: fullName,
        adminPosition: adminPosition,
        role: 'institution_admin',
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: callerUid
      };

      const membershipId = newUid + '_' + tenantId;
      const memPayload = {
        uid: newUid,
        tenantId: tenantId,
        role: 'institution_admin',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: callerUid
      };

      await db.collection('users').doc(newUid).set(userPayload, { merge: true });
      await db.collection('tenantMemberships').doc(membershipId).set(memPayload, { merge: true });

      return {
        ok: true,
        uid: newUid,
        username: username,
        tenantId: tenantId,
        membershipId: membershipId,
        role: 'institution_admin',
        adminPosition: adminPosition
      };
    } catch (e) {
      if (newUid) {
        try {
          await admin.auth().deleteUser(newUid);
        } catch (_) {}
      }
      if (e instanceof HttpsError) throw e;
      const code = String((e && e.code) || '');
      if (code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'Bu kullanıcı adı zaten kullanılıyor.');
      }
      if (code === 'auth/invalid-password') {
        throw new HttpsError('invalid-argument', 'Şifre en az 6 karakter olmalı.');
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to create tenant institution admin.'
      );
    }
  }
);

/**
 * ADMIN-MGMT-A — List institution_admin accounts for caller's tenant.
 */
exports.listTenantInstitutionAdminsForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const authCtx = await assertActiveInstitutionAdminForTenant(callerUid, tenantId);
    assertElevatedInstitutionAdminPosition(authCtx && authCtx.userData);

    const memSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .where('role', '==', 'institution_admin')
      .get();

    const memberships = (memSnap.docs || []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const uids = [...new Set(memberships.map((m) => String(m.uid || '').trim()).filter(Boolean))];
    const usersMap = {};
    for (const uid of uids) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) usersMap[uid] = userSnap.data() || {};
    }

    function formatCreatedAt(ts) {
      try {
        if (!ts) return '—';
        const d = ts && typeof ts.toDate === 'function'
          ? ts.toDate()
          : (ts && ts._seconds ? new Date(ts._seconds * 1000) : null);
        return d ? d.toLocaleString('tr-TR') : '—';
      } catch (_) {
        return '—';
      }
    }

    const admins = memberships.map((m) => {
      const uid = String(m.uid || '').trim();
      const user = usersMap[uid] || {};
      const status = String(m.status || '').trim().toLowerCase();
      const statusLabel = status === 'active' ? 'Aktif' : (status === 'suspended' ? 'Pasif' : (status || '—'));
      const adminPosition = normalizeAdminPosition(user.adminPosition);
      return {
        uid: uid,
        membershipId: m.id,
        username: user.username || (user.email ? String(user.email).split('@')[0] : '') || '—',
        email: user.email ? String(user.email).trim() : '',
        fullName: (user.fullName && String(user.fullName).trim()) ? String(user.fullName).trim() : '',
        adminPosition: ADMIN_POSITION_VALUES[adminPosition] ? adminPosition : '',
        adminPositionLabel: adminPositionLabel(adminPosition) || '',
        status: status,
        statusLabel: statusLabel,
        createdBy: m.createdBy ? String(m.createdBy).trim() : (user.createdBy ? String(user.createdBy).trim() : ''),
        createdAt: formatCreatedAt(user.createdAt) !== '—' ? formatCreatedAt(user.createdAt) : formatCreatedAt(m.createdAt)
      };
    });

    admins.sort((a, b) => String(a.fullName || a.username || '').localeCompare(String(b.fullName || b.username || ''), 'tr'));

    return {
      ok: true,
      tenantId: tenantId,
      total: admins.length,
      admins: admins
    };
  }
);

/**
 * POSITION-A — Own profile: fullName always (when authorized);
 * adminPosition only via one-time legacy bootstrap (missing position + missing createdBy).
 */
exports.updateOwnInstitutionAdminProfile = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const authCtx = await assertActiveInstitutionAdminForTenant(callerUid, tenantId);
    const userData = (authCtx && authCtx.userData) || {};

    const fullName = String((data && data.fullName) || '').trim().replace(/\s+/g, ' ');
    if (!fullName || fullName.length < 2) {
      throw new HttpsError('invalid-argument', 'Ad Soyad gereklidir.');
    }
    if (fullName.length > 200) {
      throw new HttpsError('invalid-argument', 'Ad Soyad en fazla 200 karakter olabilir.');
    }

    const existingPos = normalizeAdminPosition(userData.adminPosition);
    const hasValidExisting = !!ADMIN_POSITION_VALUES[existingPos];
    const clientPosRaw = data && data.adminPosition != null ? String(data.adminPosition) : '';
    const clientPosProvided = String(clientPosRaw || '').trim() !== '';

    if (hasValidExisting) {
      if (clientPosProvided) {
        const requestedPos = normalizeAdminPosition(clientPosRaw);
        if (requestedPos && requestedPos !== existingPos) {
          throw new HttpsError(
            'permission-denied',
            'Statü bilginiz güncellenemez. Yalnızca ad soyad değiştirilebilir.'
          );
        }
      }
      await db.collection('users').doc(callerUid).set({
        fullName: fullName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return {
        ok: true,
        uid: callerUid,
        fullName: fullName,
        adminPosition: existingPos,
        bootstrap: false
      };
    }

    if (isLegacyInstitutionAdminBootstrapEligible(userData)) {
      const adminPosition = parseRequiredAdminPosition(data && data.adminPosition);
      await db.collection('users').doc(callerUid).set({
        fullName: fullName,
        adminPosition: adminPosition,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return {
        ok: true,
        uid: callerUid,
        fullName: fullName,
        adminPosition: adminPosition,
        bootstrap: true
      };
    }

    if (clientPosProvided) {
      throw new HttpsError(
        'permission-denied',
        'Statü bilginiz güncellenemez. Yalnızca ad soyad değiştirilebilir.'
      );
    }

    await db.collection('users').doc(callerUid).set({
      fullName: fullName,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      ok: true,
      uid: callerUid,
      fullName: fullName,
      adminPosition: '',
      bootstrap: false
    };
  }
);

/**
 * ROOM-B1.6-A — Elevated admin updates own OR another same-tenant institution_admin adminPosition.
 * Self-demotion to professional_staff denied when caller is the last elevated admin.
 * updateOwnInstitutionAdminProfile remains position-immutable after set.
 */
exports.updateTenantInstitutionAdminPositionForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const targetUid = (data && data.targetUid ? String(data.targetUid) : '').trim();
    const authCtx = await assertActiveInstitutionAdminForTenant(callerUid, tenantId);
    assertElevatedInstitutionAdminPosition(authCtx && authCtx.userData);

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'targetUid is required.');
    }

    const adminPosition = parseRequiredAdminPosition(data && data.adminPosition);

    const targetUserSnap = await db.collection('users').doc(targetUid).get();
    if (!targetUserSnap.exists) {
      throw new HttpsError('not-found', 'Kurum yöneticisi kaydı bulunamadı.');
    }
    const targetUser = targetUserSnap.data() || {};
    if (normalizeRole(targetUser.role) !== 'institution_admin') {
      throw new HttpsError('permission-denied', 'Hedef hesap kurum yöneticisi değil.');
    }

    const targetMembershipId = targetUid + '_' + tenantId;
    const targetMembershipSnap = await db.collection('tenantMemberships').doc(targetMembershipId).get();
    if (!targetMembershipSnap.exists) {
      throw new HttpsError('not-found', 'Kurum yöneticisi kaydı bulunamadı.');
    }
    const targetMembership = targetMembershipSnap.data() || {};
    const memTenantId = String(targetMembership.tenantId || '').trim();
    if (memTenantId && memTenantId !== tenantId) {
      throw new HttpsError('permission-denied', 'Cross-tenant target is not allowed.');
    }
    if (normalizeRole(targetMembership.role) !== 'institution_admin') {
      throw new HttpsError('permission-denied', 'Hedef hesap kurum yöneticisi değil.');
    }

    if (targetUid === callerUid && adminPosition === 'professional_staff') {
      const hasOtherElevated = await hasOtherElevatedInstitutionAdminInTenant(tenantId, callerUid);
      if (!hasOtherElevated) {
        throw new HttpsError(
          'failed-precondition',
          'Son yetkili kurum yöneticisi olarak kendinizi Mesleki Personel statüsüne alamazsınız.'
        );
      }
    }

    try {
      await db.collection('users').doc(targetUid).set({
        adminPosition: adminPosition,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstitutionAdminPosition] update failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Statü güncellenemedi. Lütfen tekrar deneyin.');
    }

    return {
      ok: true,
      tenantId: tenantId,
      targetUid: targetUid,
      adminPosition: adminPosition
    };
  }
);

/**
 * Phase 1 — Aktif / Pasif for Direksiyon Usta Öğretici (institution_admin only).
 * status: 'active' | 'suspended'
 */
exports.updateTenantInstructorStatusForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    const nextStatusRaw = (data && data.status ? String(data.status) : '').trim().toLowerCase();
    if (nextStatusRaw !== 'active' && nextStatusRaw !== 'suspended') {
      throw new HttpsError('invalid-argument', 'status must be active or suspended.');
    }

    const membershipId = resolveMembershipId(data, tenantId);

    const callerMembershipId = callerUid + '_' + tenantId;
    const callerMembershipSnap = await db.collection('tenantMemberships').doc(callerMembershipId).get();
    const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
    if (
      !callerMembershipSnap.exists ||
      normalizeRole(callerMembership.role) !== 'institution_admin' ||
      normalizeRole(callerMembership.status) !== 'active'
    ) {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }

    const callerUserSnap = await db.collection('users').doc(callerUid).get();
    if (!callerUserSnap.exists) {
      throw new HttpsError('permission-denied', 'User profile could not be verified.');
    }
    assertElevatedInstitutionAdminPosition(callerUserSnap.data() || {});

    const membershipRef = db.collection('tenantMemberships').doc(membershipId);
    const membershipSnap = await membershipRef.get();
    if (!membershipSnap.exists) {
      throw new HttpsError('not-found', 'Membership not found.');
    }

    const membershipData = membershipSnap.data() || {};
    const targetTenantId = String(membershipData.tenantId || '').trim();
    const targetRole = normalizeRole(membershipData.role);
    const targetUid = String(membershipData.uid || '').trim();
    if (!targetUid) {
      throw new HttpsError('failed-precondition', 'Target uid is missing in membership.');
    }
    if (targetTenantId !== tenantId) {
      throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
    }
    if (targetRole !== 'instructor') {
      throw new HttpsError('invalid-argument', 'Only instructor memberships can be updated.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const memPatch = {
      status: nextStatusRaw,
      updatedAt: now
    };
    if (nextStatusRaw === 'suspended') {
      memPatch.suspendedAt = now;
      memPatch.suspendedBy = callerUid;
    } else {
      memPatch.reactivatedAt = now;
      memPatch.reactivatedBy = callerUid;
    }

    await membershipRef.set(memPatch, { merge: true });
    await db.collection('users').doc(targetUid).set({
      isActive: nextStatusRaw === 'active',
      updatedAt: now
    }, { merge: true });

    let authDisabled = false;
    let authEnabled = false;
    if (nextStatusRaw === 'suspended') {
      const activeOther = await db.collection('tenantMemberships')
        .where('uid', '==', targetUid)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      if (!activeOther || activeOther.empty) {
        try {
          await admin.auth().updateUser(targetUid, { disabled: true });
          authDisabled = true;
        } catch (e) {
          const code = String((e && e.code) || '');
          if (code !== 'auth/user-not-found') throw e;
        }
      }
    } else {
      try {
        await admin.auth().updateUser(targetUid, { disabled: false });
        authEnabled = true;
      } catch (e) {
        const code = String((e && e.code) || '');
        if (code !== 'auth/user-not-found') throw e;
      }
    }

    return {
      ok: true,
      uid: targetUid,
      tenantId: tenantId,
      membershipId: membershipId,
      status: nextStatusRaw,
      authDisabled: authDisabled,
      authEnabled: authEnabled
    };
  }
);

/**
 * Elevated-only profile edit for Direksiyon Usta Öğretici.
 * Safe V1 fields only: fullName, phone, contactEmail. No username / Auth email / password / role.
 */
exports.updateTenantInstructorProfileForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const instructorUid = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    const fullNameRaw = (data && data.fullName ? String(data.fullName) : '');
    const phoneRaw = (data && data.phone ? String(data.phone) : '');
    const contactEmailRaw = (data && data.contactEmail ? String(data.contactEmail) : '');

    const fullName = fullNameRaw.trim().replace(/\s+/g, ' ');
    const phone = phoneRaw.trim();
    const contactEmail = contactEmailRaw.trim().toLowerCase();

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!instructorUid) {
      throw new HttpsError('invalid-argument', 'instructorUid is required.');
    }
    if (!fullName || fullName.length < 2) {
      throw new HttpsError('invalid-argument', 'Ad Soyad gereklidir.');
    }
    if (fullName.length > 200) {
      throw new HttpsError('invalid-argument', 'Ad Soyad en fazla 200 karakter olabilir.');
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new HttpsError('invalid-argument', 'İletişim e-postası geçersiz.');
    }
    if (phone && phone.length > 40) {
      throw new HttpsError('invalid-argument', 'Telefon en fazla 40 karakter olabilir.');
    }

    const callerMembershipId = callerUid + '_' + tenantId;
    const callerMembershipSnap = await db.collection('tenantMemberships').doc(callerMembershipId).get();
    const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
    if (
      !callerMembershipSnap.exists ||
      normalizeRole(callerMembership.role) !== 'institution_admin' ||
      normalizeRole(callerMembership.status) !== 'active'
    ) {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }

    const callerUserSnap = await db.collection('users').doc(callerUid).get();
    if (!callerUserSnap.exists) {
      throw new HttpsError('permission-denied', 'User profile could not be verified.');
    }
    assertElevatedInstitutionAdminPosition(callerUserSnap.data() || {});

    const targetMembershipId = instructorUid + '_' + tenantId;
    const targetMembershipSnap = await db.collection('tenantMemberships').doc(targetMembershipId).get();
    if (!targetMembershipSnap.exists) {
      throw new HttpsError('not-found', 'Instructor membership not found.');
    }
    const targetMembership = targetMembershipSnap.data() || {};
    if (String(targetMembership.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
    }
    if (normalizeRole(targetMembership.role) !== 'instructor') {
      throw new HttpsError('permission-denied', 'Target is not a Direksiyon Usta Öğretici.');
    }
    if (String(targetMembership.uid || '').trim() !== instructorUid) {
      throw new HttpsError('failed-precondition', 'Membership uid mismatch.');
    }

    const targetUserRef = db.collection('users').doc(instructorUid);
    const targetUserSnap = await targetUserRef.get();
    if (!targetUserSnap.exists) {
      throw new HttpsError('not-found', 'Instructor user not found.');
    }
    const targetUser = targetUserSnap.data() || {};
    if (normalizeRole(targetUser.role) !== 'instructor') {
      throw new HttpsError('permission-denied', 'Target user is not an instructor.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await targetUserRef.set({
      fullName: fullName,
      phone: phone,
      contactEmail: contactEmail,
      updatedAt: now
    }, { merge: true });

    return {
      ok: true,
      uid: instructorUid,
      tenantId: tenantId,
      fullName: fullName,
      phone: phone,
      contactEmail: contactEmail
    };
  }
);

/**
 * Detect image content type from magic bytes (PNG / JPEG / WEBP).
 * @param {Buffer} buffer
 * @returns {string|null}
 */
function detectInstructorPhotoContentType(buffer) {
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

/**
 * @param {*} raw
 * @returns {string}
 */
function sanitizeInstructorPhotoOriginalName(raw) {
  var s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '')
    .trim();
  if (!s) s = 'profile';
  if (s.length > 180) s = s.slice(0, 180);
  return s;
}

/**
 * Parse + validate instructor profile photo from callable payload.
 * Prefers magic-byte detection over client MIME claim.
 * @param {*} data
 * @returns {{ buffer: Buffer, contentType: string, ext: string, originalName: string, byteLength: number }}
 */
function parseAndValidateInstructorPhoto(data) {
  var claimedType =
    typeof data.photoContentType === 'string' ? data.photoContentType.trim().toLowerCase() : '';
  if (!INSTRUCTOR_PHOTO_ALLOWED[claimedType]) {
    throw new HttpsError(
      'invalid-argument',
      'Lütfen PNG, JPG veya WEBP formatında bir fotoğraf seçin.'
    );
  }

  var base64Raw = typeof data.photoBase64 === 'string' ? data.photoBase64.trim() : '';
  if (!base64Raw) {
    throw new HttpsError('invalid-argument', 'Lütfen bir profil fotoğrafı seçin.');
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
      'Lütfen PNG, JPG veya WEBP formatında bir fotoğraf seçin.'
    );
  }

  if (!buffer || !buffer.length) {
    throw new HttpsError('invalid-argument', 'Lütfen bir profil fotoğrafı seçin.');
  }
  if (buffer.length > INSTRUCTOR_PHOTO_MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'Profil fotoğrafı en fazla 2 MB olabilir.');
  }

  var detected = detectInstructorPhotoContentType(buffer);
  if (!detected || !INSTRUCTOR_PHOTO_ALLOWED[detected]) {
    throw new HttpsError(
      'invalid-argument',
      'Lütfen PNG, JPG veya WEBP formatında bir fotoğraf seçin.'
    );
  }
  if (detected !== claimedType) {
    claimedType = detected;
  }

  return {
    buffer: buffer,
    contentType: claimedType,
    ext: INSTRUCTOR_PHOTO_ALLOWED[claimedType].ext,
    originalName: sanitizeInstructorPhotoOriginalName(data.photoOriginalName),
    byteLength: buffer.length
  };
}

/**
 * Build a persistent Firebase Storage download URL (token metadata; not a short-lived signed URL).
 * @param {string} bucketName
 * @param {string} storagePath
 * @param {string} downloadToken
 * @returns {string}
 */
function buildPersistentStorageDownloadUrl(bucketName, storagePath, downloadToken) {
  var encoded = encodeURIComponent(storagePath);
  return (
    'https://firebasestorage.googleapis.com/v0/b/' +
    bucketName +
    '/o/' +
    encoded +
    '?alt=media&token=' +
    downloadToken
  );
}

/**
 * Phase 1B — Upload / replace Direksiyon Usta Öğretici profile photo (institution_admin only).
 * Admin SDK write to user-profiles/{uid}/… — no client Storage path, no storage.rules change.
 */
exports.uploadTenantInstructorPhotoForInstitutionAdmin = onCall(
  { region: 'us-central1', memory: '512MiB' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const instructorUid = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!instructorUid) {
      throw new HttpsError('invalid-argument', 'instructorUid is required.');
    }

    const callerMembershipId = callerUid + '_' + tenantId;
    const callerMembershipSnap = await db.collection('tenantMemberships').doc(callerMembershipId).get();
    const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
    if (
      !callerMembershipSnap.exists ||
      normalizeRole(callerMembership.role) !== 'institution_admin' ||
      normalizeRole(callerMembership.status) !== 'active'
    ) {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }

    const callerUserSnap = await db.collection('users').doc(callerUid).get();
    if (!callerUserSnap.exists) {
      throw new HttpsError('permission-denied', 'User profile could not be verified.');
    }
    assertElevatedInstitutionAdminPosition(callerUserSnap.data() || {});

    const targetMembershipId = instructorUid + '_' + tenantId;
    const targetMembershipSnap = await db.collection('tenantMemberships').doc(targetMembershipId).get();
    if (!targetMembershipSnap.exists) {
      throw new HttpsError('not-found', 'Instructor membership not found.');
    }
    const targetMembership = targetMembershipSnap.data() || {};
    if (String(targetMembership.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
    }
    if (normalizeRole(targetMembership.role) !== 'instructor') {
      throw new HttpsError('permission-denied', 'Target is not a Direksiyon Usta Öğretici.');
    }
    if (String(targetMembership.uid || '').trim() !== instructorUid) {
      throw new HttpsError('failed-precondition', 'Membership uid mismatch.');
    }

    const targetUserSnap = await db.collection('users').doc(instructorUid).get();
    if (!targetUserSnap.exists) {
      throw new HttpsError('not-found', 'Instructor user not found.');
    }
    const targetUser = targetUserSnap.data() || {};
    if (normalizeRole(targetUser.role) !== 'instructor') {
      throw new HttpsError('permission-denied', 'Target user is not an instructor.');
    }

    const photo = parseAndValidateInstructorPhoto(data);
    const previousPath = targetUser.photoStoragePath
      ? String(targetUser.photoStoragePath).trim()
      : '';

    const downloadToken = crypto.randomUUID();
    const storagePath =
      'user-profiles/' + instructorUid + '/profile_' + Date.now() + '.' + photo.ext;
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    let uploaded = false;

    try {
      await file.save(photo.buffer, {
        resumable: false,
        metadata: {
          contentType: photo.contentType,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            purpose: 'instructor_profile_photo',
            tenantId: tenantId,
            instructorUid: instructorUid,
            uploadedBy: callerUid,
            originalName: photo.originalName
          }
        }
      });
      uploaded = true;

      const photoUrl = buildPersistentStorageDownloadUrl(bucket.name, storagePath, downloadToken);
      const now = admin.firestore.FieldValue.serverTimestamp();
      await db.collection('users').doc(instructorUid).set({
        photoUrl: photoUrl,
        photoStoragePath: storagePath,
        photoUpdatedAt: now,
        updatedAt: now
      }, { merge: true });

      if (previousPath && previousPath !== storagePath) {
        try {
          await bucket.file(previousPath).delete({ ignoreNotFound: true });
        } catch (cleanupErr) {
          console.warn(
            '[uploadTenantInstructorPhotoForInstitutionAdmin] previous photo cleanup failed:',
            cleanupErr && cleanupErr.message ? cleanupErr.message : cleanupErr
          );
        }
      }

      return {
        ok: true,
        uid: instructorUid,
        photoUrl: photoUrl,
        photoUpdatedAt: new Date().toISOString()
      };
    } catch (e) {
      if (uploaded) {
        try {
          await file.delete({ ignoreNotFound: true });
        } catch (_) {}
      }
      if (e instanceof HttpsError) throw e;
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to upload instructor photo.'
      );
    }
  }
);

/**
 * Phase 1B — Hard-delete Direksiyon Usta Öğretici (institution_admin only).
 * Mirrors deleteTenantStudentForInstitutionAdmin guards where compatible.
 *
 * NOTE (future): When instructor-linked scheduling records become active
 * (drivingLessons / availability / lesson requests / staff chat), hard delete
 * must be blocked or converted to archival behavior. Do not hard-delete
 * instructors that are still referenced by live scheduling data.
 */
exports.deleteTenantInstructorForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    const instructorUidRaw = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    const membershipId = instructorUidRaw
      ? (instructorUidRaw + '_' + tenantId)
      : resolveMembershipId(data, tenantId);

    const callerMembershipId = callerUid + '_' + tenantId;
    const callerMembershipSnap = await db.collection('tenantMemberships').doc(callerMembershipId).get();
    const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
    if (
      !callerMembershipSnap.exists ||
      normalizeRole(callerMembership.role) !== 'institution_admin' ||
      normalizeRole(callerMembership.status) !== 'active'
    ) {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }

    const callerUserSnap = await db.collection('users').doc(callerUid).get();
    if (!callerUserSnap.exists) {
      throw new HttpsError('permission-denied', 'User profile could not be verified.');
    }
    assertElevatedInstitutionAdminPosition(callerUserSnap.data() || {});

    const membershipRef = db.collection('tenantMemberships').doc(membershipId);
    const membershipSnap = await membershipRef.get();
    if (!membershipSnap.exists) {
      throw new HttpsError('not-found', 'Instructor membership not found.');
    }

    const membershipData = membershipSnap.data() || {};
    const targetTenantId = String(membershipData.tenantId || '').trim();
    const targetRole = normalizeRole(membershipData.role);
    const targetUid = String(membershipData.uid || '').trim();
    if (!targetUid) {
      throw new HttpsError('failed-precondition', 'Target uid is missing in membership.');
    }
    if (targetTenantId !== tenantId) {
      throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
    }
    if (targetRole !== 'instructor') {
      throw new HttpsError('invalid-argument', 'Only instructor memberships can be deleted.');
    }

    const targetUserSnap = await db.collection('users').doc(targetUid).get();
    if (!targetUserSnap.exists) {
      throw new HttpsError('not-found', 'Instructor user not found.');
    }
    const targetUser = targetUserSnap.data() || {};
    if (normalizeRole(targetUser.role) !== 'instructor') {
      throw new HttpsError('permission-denied', 'Target user is not an instructor.');
    }

    const targetMembershipsSnap = await db.collection('tenantMemberships')
      .where('uid', '==', targetUid)
      .get();
    if (targetMembershipsSnap.size > 1) {
      throw new HttpsError(
        'failed-precondition',
        'Bu direksiyon usta öğreticinin birden fazla kurum üyeliği var. Kalıcı silme için Super Admin özel temizlik akışı gerekir.'
      );
    }

    const photoStoragePath = targetUser.photoStoragePath
      ? String(targetUser.photoStoragePath).trim()
      : '';

    await membershipRef.delete();
    const membershipDeleted = true;

    const userRef = db.collection('users').doc(targetUid);
    await userRef.delete();
    const userDocDeleted = true;

    let authDeleted = false;
    try {
      await admin.auth().deleteUser(targetUid);
      authDeleted = true;
    } catch (e) {
      const code = String((e && e.code) || '');
      if (code !== 'auth/user-not-found') {
        throw e;
      }
    }

    let photoCleanupAttempted = false;
    let photoCleanupOk = false;
    try {
      photoCleanupAttempted = true;
      const bucket = admin.storage().bucket();
      if (photoStoragePath) {
        try {
          await bucket.file(photoStoragePath).delete({ ignoreNotFound: true });
        } catch (pathErr) {
          console.warn(
            '[deleteTenantInstructorForInstitutionAdmin] photoStoragePath cleanup failed',
            {
              uid: targetUid,
              tenantId: tenantId,
              error: pathErr && pathErr.message ? pathErr.message : String(pathErr)
            }
          );
        }
      }
      try {
        await bucket.deleteFiles({
          prefix: 'user-profiles/' + targetUid + '/',
          force: true
        });
        photoCleanupOk = true;
      } catch (prefixErr) {
        console.warn(
          '[deleteTenantInstructorForInstitutionAdmin] user-profiles prefix cleanup failed',
          {
            uid: targetUid,
            tenantId: tenantId,
            error: prefixErr && prefixErr.message ? prefixErr.message : String(prefixErr)
          }
        );
      }
    } catch (cleanupErr) {
      console.warn(
        '[deleteTenantInstructorForInstitutionAdmin] photo cleanup failed',
        {
          uid: targetUid,
          tenantId: tenantId,
          error: cleanupErr && cleanupErr.message ? cleanupErr.message : String(cleanupErr)
        }
      );
    }

    return {
      ok: true,
      uid: targetUid,
      tenantId: tenantId,
      membershipId: membershipId,
      authDeleted: authDeleted,
      userDocDeleted: userDocDeleted,
      membershipDeleted: membershipDeleted,
      photoCleanupAttempted: photoCleanupAttempted,
      photoCleanupOk: photoCleanupOk
    };
  }
);

/* -------------------------------------------------------------------------- */
/* Phase 2B — Canonical drivingLessons (Institution Admin assignment)         */
/* -------------------------------------------------------------------------- */

const DRIVING_LESSON_STATUSES_BLOCKING = {
  pending_instructor: true,
  pending_admin: true,
  confirmed: true,
  consultation_requested: true,
  completed: true
};

const DRIVING_LESSON_DURATION_MINUTES_V1 = 120;
const DRIVING_LESSON_ALLOWED_START_HOURS_V1 = {
  8: true,
  10: true,
  12: true,
  14: true,
  16: true,
  18: true,
  20: true
};
const DRIVING_LESSON_EDITABLE_STATUSES = {
  pending_instructor: true,
  pending_admin: true,
  confirmed: true,
  consultation_requested: true
};
const DRIVING_LESSON_CANCELLABLE_STATUSES = {
  pending_instructor: true,
  pending_admin: true,
  confirmed: true,
  consultation_requested: true
};
const DRIVING_LESSON_ADDRESS_MAX = 500;
const DRIVING_LESSON_OVERLAP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function assertActiveInstitutionAdminForTenant(callerUid, tenantId) {
  // Intentionally institution_admin-only (matches instructor module; not super_admin).
  // Also verifies users.role === institution_admin (ADMIN-MGMT-A).
  const tid = String(tenantId || '').trim();
  if (!tid) {
    return Promise.reject(new HttpsError('invalid-argument', 'tenantId is required.'));
  }
  return Promise.all([
    db.collection('tenantMemberships').doc(callerUid + '_' + tid).get(),
    db.collection('users').doc(callerUid).get()
  ]).then(([callerMembershipSnap, userSnap]) => {
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'User profile could not be verified.');
    }
    const userData = userSnap.data() || {};
    if (normalizeRole(userData.role) !== 'institution_admin') {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }
    const callerMembership = callerMembershipSnap.exists ? (callerMembershipSnap.data() || {}) : {};
    const membershipTenantId = String(callerMembership.tenantId || '').trim();
    if (
      !callerMembershipSnap.exists ||
      (membershipTenantId && membershipTenantId !== tid) ||
      normalizeRole(callerMembership.role) !== 'institution_admin' ||
      normalizeRole(callerMembership.status) !== 'active'
    ) {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }
    return { membership: callerMembership, userData: userData };
  });
}

function parseTurkeyDateTimeIso(raw, fieldName) {
  const label = fieldName || 'time';
  const iso = String(raw || '').trim();
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+03:00$/);
  if (!m) {
    throw new HttpsError(
      'invalid-argument',
      label + ' must be YYYY-MM-DDTHH:mm:ss+03:00.'
    );
  }
  const ymd = m[1] + '-' + m[2] + '-' + m[3];
  const hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  const second = parseInt(m[6], 10);
  if (second !== 0) {
    throw new HttpsError('invalid-argument', label + ' seconds must be 00.');
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new HttpsError('invalid-argument', label + ' minutes must be 00–59.');
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new HttpsError('invalid-argument', label + ' hour is invalid.');
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new HttpsError('invalid-argument', label + ' could not be parsed.');
  }
  return {
    iso: iso,
    ymd: ymd,
    hour: hour,
    minute: minute,
    ms: ms,
    ts: admin.firestore.Timestamp.fromMillis(ms)
  };
}

function parseTurkeyLessonWindow(slotStartRaw, slotEndRaw) {
  const start = parseTurkeyDateTimeIso(slotStartRaw, 'slotStart');
  const end = parseTurkeyDateTimeIso(slotEndRaw, 'slotEnd');
  if (start.ymd !== end.ymd) {
    throw new HttpsError('invalid-argument', 'Lesson start and end must be on the same Istanbul date.');
  }
  if (!(end.ms > start.ms)) {
    throw new HttpsError('invalid-argument', 'Lesson end must be after start.');
  }
  const earliestStartMs = Date.parse(start.ymd + 'T08:00:00+03:00');
  const latestEndMs = Date.parse(start.ymd + 'T22:00:00+03:00');
  if (!Number.isFinite(earliestStartMs) || !Number.isFinite(latestEndMs)) {
    throw new HttpsError('invalid-argument', 'Lesson window could not be parsed.');
  }
  if (start.ms < earliestStartMs) {
    throw new HttpsError('invalid-argument', 'Lesson must start at 08:00 or later.');
  }
  if (end.ms > latestEndMs) {
    throw new HttpsError('invalid-argument', 'Lesson must end by 22:00.');
  }
  const durationMinutes = (end.ms - start.ms) / 60000;
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new HttpsError('invalid-argument', 'Lesson duration must be a positive whole number of minutes.');
  }
  return {
    iso: start.iso,
    hour: start.hour,
    minute: start.minute,
    startMs: start.ms,
    endMs: end.ms,
    durationMinutes: durationMinutes,
    startTs: start.ts,
    endTs: end.ts,
    ymd: start.ymd
  };
}

function parseTurkeyDateStartIso(dateYmd) {
  const raw = String(dateYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpsError('invalid-argument', 'Date must be YYYY-MM-DD.');
  }
  const ms = Date.parse(raw + 'T00:00:00+03:00');
  if (!Number.isFinite(ms)) {
    throw new HttpsError('invalid-argument', 'Date could not be parsed.');
  }
  return ms;
}

function intervalsOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  return aStartMs < bEndMs && aEndMs > bStartMs;
}

function lessonBlocksOverlap(status) {
  return !!DRIVING_LESSON_STATUSES_BLOCKING[normalizeRole(status)];
}

function serializeDrivingLessonDoc(id, data) {
  const d = data || {};
  function tsToIso(ts) {
    try {
      if (!ts) return null;
      const date = typeof ts.toDate === 'function'
        ? ts.toDate()
        : (ts && typeof ts._seconds === 'number' ? new Date(ts._seconds * 1000) : null);
      if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
      return date.toISOString();
    } catch (_) {
      return null;
    }
  }
  function tsToMillis(ts) {
    try {
      if (!ts) return null;
      if (typeof ts.toMillis === 'function') return ts.toMillis();
      if (typeof ts.toDate === 'function') return ts.toDate().getTime();
      if (typeof ts._seconds === 'number') return ts._seconds * 1000;
      return null;
    } catch (_) {
      return null;
    }
  }
  const noteRaw = d.instructorResponseNote != null ? String(d.instructorResponseNote).trim() : '';
  const responseAction = normalizeRole(d.instructorResponseAction != null ? d.instructorResponseAction : '');
  const respondedAt = tsToIso(d.instructorRespondedAt);
  const respondedAtMs = tsToMillis(d.instructorRespondedAt);
  const out = {
    id: id,
    tenantId: String(d.tenantId || '').trim(),
    instructorUid: String(d.instructorUid || '').trim(),
    studentUid: String(d.studentUid || '').trim(),
    studentNameSnap: d.studentNameSnap ? String(d.studentNameSnap).trim() : '',
    instructorNameSnap: d.instructorNameSnap ? String(d.instructorNameSnap).trim() : '',
    startAt: tsToIso(d.startAt),
    endAt: tsToIso(d.endAt),
    startAtMs: tsToMillis(d.startAt),
    endAtMs: tsToMillis(d.endAt),
    durationMinutes: Number(d.durationMinutes) || DRIVING_LESSON_DURATION_MINUTES_V1,
    lessonAddress: d.lessonAddress ? String(d.lessonAddress).trim() : '',
    addressSource: d.addressSource ? String(d.addressSource).trim() : '',
    status: normalizeRole(d.status),
    source: d.source ? String(d.source).trim() : '',
    createdBy: d.createdBy ? String(d.createdBy).trim() : '',
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
    createdAtMs: tsToMillis(d.createdAt),
    updatedAtMs: tsToMillis(d.updatedAt)
  };
  // C1 — optional consultation response fields (omit when absent / empty)
  if (noteRaw) out.instructorResponseNote = noteRaw;
  if (responseAction) out.instructorResponseAction = responseAction;
  if (respondedAt) out.instructorRespondedAt = respondedAt;
  if (respondedAtMs != null) out.instructorRespondedAtMs = respondedAtMs;
  const specialRequestId = d.specialLessonRequestId != null
    ? String(d.specialLessonRequestId).trim()
    : '';
  if (specialRequestId) out.specialLessonRequestId = specialRequestId;
  const specialFinalApprovedAt = tsToIso(d.specialFinalApprovedAt);
  if (specialFinalApprovedAt) out.specialFinalApprovedAt = specialFinalApprovedAt;
  const specialFinalApprovedAtMs = tsToMillis(d.specialFinalApprovedAt);
  if (specialFinalApprovedAtMs != null) out.specialFinalApprovedAtMs = specialFinalApprovedAtMs;
  return out;
}

async function queryPotentialOverlaps(fieldName, fieldValue, tenantId, startMs, endMs) {
  const lookbackStart = admin.firestore.Timestamp.fromMillis(startMs - DRIVING_LESSON_OVERLAP_LOOKBACK_MS);
  const endTs = admin.firestore.Timestamp.fromMillis(endMs);
  const snap = await db.collection('drivingLessons')
    .where('tenantId', '==', tenantId)
    .where(fieldName, '==', fieldValue)
    .where('startAt', '>=', lookbackStart)
    .where('startAt', '<', endTs)
    .get();
  return (snap.docs || []).map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function findOverlapConflict(rows, candidateStartMs, candidateEndMs) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!lessonBlocksOverlap(row.status)) continue;
    const existingStart = membershipExpiryToMillis(row.startAt);
    const existingEnd = membershipExpiryToMillis(row.endAt);
    if (existingStart == null || existingEnd == null) continue;
    if (intervalsOverlap(existingStart, existingEnd, candidateStartMs, candidateEndMs)) {
      return row;
    }
  }
  return null;
}

const DRIVING_LESSON_NOTIFICATIONS_COLLECTION = 'drivingLessonNotifications';
const DRIVING_LESSON_NOTIFICATION_TYPES = {
  lesson_assigned: true,
  lesson_updated: true,
  lesson_cancelled: true,
  lesson_confirmed: true,
  lesson_consultation: true,
  lesson_completed: true
};

function normalizeDrivingLessonNotificationAddress(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function drivingLessonNotificationStartMs(lesson) {
  return membershipExpiryToMillis(lesson && lesson.startAt);
}

function drivingLessonNotificationEndMs(lesson) {
  const endMs = membershipExpiryToMillis(lesson && lesson.endAt);
  if (endMs != null) return endMs;
  const startMs = drivingLessonNotificationStartMs(lesson);
  if (startMs == null) return null;
  const durationRaw = Number(lesson && lesson.durationMinutes);
  const durationMinutes = (Number.isFinite(durationRaw) && durationRaw > 0)
    ? durationRaw
    : DRIVING_LESSON_DURATION_MINUTES_V1;
  return startMs + (durationMinutes * 60 * 1000);
}

function formatDrivingLessonAgendaWeekStartYmd(startMs) {
  const ms = Number(startMs);
  if (!Number.isFinite(ms)) return '';
  try {
    const dayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(ms));
    const y = ((dayParts.find((p) => p.type === 'year') || {}).value) || '';
    const mo = ((dayParts.find((p) => p.type === 'month') || {}).value) || '';
    const d = ((dayParts.find((p) => p.type === 'day') || {}).value) || '';
    if (!y || !mo || !d) return '';
    const dayStartMs = Date.parse(y + '-' + mo + '-' + d + 'T00:00:00+03:00');
    if (!Number.isFinite(dayStartMs)) return '';
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Istanbul',
      weekday: 'short'
    }).format(new Date(dayStartMs));
    const offsetByWeekday = { Sun: 6, Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5 };
    const offsetDays = Object.prototype.hasOwnProperty.call(offsetByWeekday, weekday)
      ? offsetByWeekday[weekday]
      : 0;
    const mondayMs = dayStartMs - (offsetDays * MS_PER_DAY);
    const mondayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(mondayMs));
    const my = ((mondayParts.find((p) => p.type === 'year') || {}).value) || '';
    const mm = ((mondayParts.find((p) => p.type === 'month') || {}).value) || '';
    const md = ((mondayParts.find((p) => p.type === 'day') || {}).value) || '';
    if (!my || !mm || !md) return '';
    return my + '-' + mm + '-' + md;
  } catch (_) {
    return '';
  }
}

function formatDrivingLessonSlotPreview(startMs, endMs) {
  const start = Number(startMs);
  if (!Number.isFinite(start)) return '';
  try {
    const dateLabel = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(new Date(start));
    const startTime = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(start));
    const end = Number(endMs);
    if (!Number.isFinite(end)) return dateLabel + ', ' + startTime;
    const endTime = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(end));
    return dateLabel + ', ' + startTime + '–' + endTime;
  } catch (_) {
    return '';
  }
}

function drivingLessonUpdatedFingerprint(fields) {
  const f = fields || {};
  const raw = [
    String(f.startAtMs != null ? f.startAtMs : ''),
    String(f.endAtMs != null ? f.endAtMs : ''),
    String(f.durationMinutes != null ? f.durationMinutes : ''),
    String(f.studentUid || ''),
    normalizeDrivingLessonNotificationAddress(f.lessonAddress),
    String(f.status || '')
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function drivingLessonNotificationDocId(lessonId, type, recipientUid, fingerprint) {
  const lid = String(lessonId || '').trim().replace(/\//g, '_');
  const t = String(type || '').trim();
  const uid = String(recipientUid || '').trim().replace(/\//g, '_');
  const fp = String(fingerprint || '').trim();
  if (t === 'lesson_updated' && fp) return lid + '_updated_' + fp + '_' + uid;
  const typeKey = {
    lesson_assigned: 'assigned',
    lesson_cancelled: 'cancelled',
    lesson_confirmed: 'confirmed',
    lesson_consultation: 'consultation',
    lesson_completed: 'completed'
  }[t];
  if (!typeKey || !lid || !uid) return '';
  return lid + '_' + typeKey + '_' + uid;
}

function drivingLessonNotificationDisplayName(lesson, fallback) {
  const d = lesson || {};
  const instructorName = String(d.instructorNameSnap || '').trim();
  if (instructorName) return instructorName;
  return String(fallback || 'Usta öğretici').trim() || 'Usta öğretici';
}

async function listActiveInstitutionAdminUidsForTenant(tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) return [];
  try {
    const memSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tid)
      .where('role', '==', 'institution_admin')
      .get();
    const seen = Object.create(null);
    const uids = [];
    (memSnap.docs || []).forEach((docSnap) => {
      const m = docSnap.data() || {};
      const uid = String(m.uid || '').trim();
      if (!uid || seen[uid]) return;
      if (normalizeRole(m.status) !== 'active') return;
      const memTenantId = String(m.tenantId || '').trim();
      if (memTenantId && memTenantId !== tid) return;
      seen[uid] = true;
      uids.push(uid);
    });
    return uids;
  } catch (e) {
    console.error('[drivingLessonNotifications] admin recipient query failed', e && e.message ? e.message : e);
    return [];
  }
}

/**
 * Create-if-absent fan-out for drivingLessonNotifications.
 * Never overwrites unread/readAt on an existing deterministic id.
 */
async function writeDrivingLessonNotificationDocs(payloads) {
  const items = (Array.isArray(payloads) ? payloads : []).filter((p) => {
    if (!p || typeof p !== 'object') return false;
    const id = String(p.notificationId || '').trim();
    const recipientUid = String(p.recipientUid || '').trim();
    const type = String(p.type || '').trim();
    return !!(id && recipientUid && DRIVING_LESSON_NOTIFICATION_TYPES[type]);
  });
  if (!items.length) return;
  try {
    const existing = Object.create(null);
    const GETALL_CHUNK = 100;
    for (let i = 0; i < items.length; i += GETALL_CHUNK) {
      const chunk = items.slice(i, i + GETALL_CHUNK);
      const refs = chunk.map((p) =>
        db.collection(DRIVING_LESSON_NOTIFICATIONS_COLLECTION).doc(p.notificationId)
      );
      const snaps = await db.getAll.apply(db, refs);
      (snaps || []).forEach((snap) => {
        if (snap && snap.exists) existing[snap.id] = true;
      });
    }
    const toCreate = items.filter((p) => !existing[p.notificationId]);
    if (!toCreate.length) return;
    const WRITE_CHUNK = 400;
    for (let i = 0; i < toCreate.length; i += WRITE_CHUNK) {
      const chunk = toCreate.slice(i, i + WRITE_CHUNK);
      const batch = db.batch();
      chunk.forEach((p) => {
        const ref = db.collection(DRIVING_LESSON_NOTIFICATIONS_COLLECTION).doc(p.notificationId);
        const docPayload = {
          tenantId: String(p.tenantId || '').trim(),
          recipientUid: String(p.recipientUid || '').trim(),
          recipientRole: String(p.recipientRole || '').trim(),
          actorUid: String(p.actorUid || '').trim(),
          actorRole: String(p.actorRole || '').trim(),
          type: String(p.type || '').trim(),
          lessonId: String(p.lessonId || '').trim(),
          instructorUid: String(p.instructorUid || '').trim(),
          studentUid: String(p.studentUid || '').trim(),
          studentName: String(p.studentName || '').trim(),
          title: String(p.title || '').trim(),
          preview: String(p.preview || '').trim(),
          agendaWeekStart: String(p.agendaWeekStart || '').trim(),
          unread: true,
          readAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          dedupeKey: String(p.dedupeKey || p.notificationId || '').trim()
        };
        const specialLessonRequestId = String(p.specialLessonRequestId || '').trim();
        if (specialLessonRequestId) {
          docPayload.specialLessonRequestId = specialLessonRequestId;
        }
        batch.set(ref, docPayload);
      });
      await batch.commit();
    }
  } catch (e) {
    console.error('[drivingLessonNotifications] write failed', e && e.message ? e.message : e);
  }
}

function buildInstructorDrivingLessonNotification(params) {
  const p = params || {};
  const recipientUid = String(p.recipientUid || '').trim();
  const type = String(p.type || '').trim();
  const lessonId = String(p.lessonId || '').trim();
  const fingerprint = String(p.fingerprint || '').trim();
  const notificationId = drivingLessonNotificationDocId(lessonId, type, recipientUid, fingerprint);
  if (!notificationId) return null;
  return {
    notificationId: notificationId,
    tenantId: String(p.tenantId || '').trim(),
    recipientUid: recipientUid,
    recipientRole: String(p.recipientRole || '').trim(),
    actorUid: String(p.actorUid || '').trim(),
    actorRole: String(p.actorRole || '').trim(),
    type: type,
    lessonId: lessonId,
    instructorUid: String(p.instructorUid || '').trim(),
    studentUid: String(p.studentUid || '').trim(),
    studentName: String(p.studentName || '').trim(),
    title: String(p.title || '').trim(),
    preview: String(p.preview || '').trim(),
    agendaWeekStart: String(p.agendaWeekStart || '').trim(),
    specialLessonRequestId: String(p.specialLessonRequestId || '').trim(),
    dedupeKey: notificationId
  };
}

/**
 * Phase 2B — Create canonical drivingLessons assignment (institution_admin only).
 */
exports.createDrivingLessonAssignmentForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const instructorUid = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    const studentUid = (data && data.studentUid ? String(data.studentUid) : '').trim();
    const slotStartRaw = data && data.slotStart != null ? data.slotStart : '';
    const slotEndRaw = data && data.slotEnd != null ? data.slotEnd : '';
    const addressOverrideRaw = data && data.lessonAddressOverride != null
      ? String(data.lessonAddressOverride)
      : null;

    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    if (!instructorUid) throw new HttpsError('invalid-argument', 'instructorUid is required.');
    if (!studentUid) throw new HttpsError('invalid-argument', 'studentUid is required.');
    if (instructorUid === studentUid) {
      throw new HttpsError('invalid-argument', 'Instructor and student must be different.');
    }

    await assertActiveInstitutionAdminForTenant(callerUid, tenantId);

    const slot = parseTurkeyLessonWindow(slotStartRaw, slotEndRaw);

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
      throw new HttpsError('not-found', 'Tenant not found.');
    }
    const tenantData = tenantSnap.data() || {};
    const tenantAddress = String(tenantData.address || '').trim();

    let lessonAddress = '';
    let addressSource = 'tenant_default';
    if (addressOverrideRaw != null) {
      const trimmedOverride = String(addressOverrideRaw).trim().replace(/\s+/g, ' ');
      if (trimmedOverride) {
        if (trimmedOverride.length > DRIVING_LESSON_ADDRESS_MAX) {
          throw new HttpsError('invalid-argument', 'Ders adresi en fazla 500 karakter olabilir.');
        }
        if (trimmedOverride !== tenantAddress) {
          lessonAddress = trimmedOverride;
          addressSource = 'override';
        } else {
          lessonAddress = tenantAddress;
          addressSource = 'tenant_default';
        }
      }
    }
    if (!lessonAddress) {
      lessonAddress = tenantAddress;
      addressSource = 'tenant_default';
    }
    if (!lessonAddress) {
      throw new HttpsError('failed-precondition', 'Ders adresi gereklidir. Kurum adresini girin veya bu ders için adres yazın.');
    }
    if (lessonAddress.length > DRIVING_LESSON_ADDRESS_MAX) {
      throw new HttpsError('invalid-argument', 'Ders adresi en fazla 500 karakter olabilir.');
    }

    const instructorMembershipId = instructorUid + '_' + tenantId;
    const studentMembershipId = studentUid + '_' + tenantId;
    const [
      instructorMemSnap,
      studentMemSnap,
      instructorUserSnap,
      studentUserSnap
    ] = await Promise.all([
      db.collection('tenantMemberships').doc(instructorMembershipId).get(),
      db.collection('tenantMemberships').doc(studentMembershipId).get(),
      db.collection('users').doc(instructorUid).get(),
      db.collection('users').doc(studentUid).get()
    ]);

    if (!instructorMemSnap.exists) {
      throw new HttpsError('not-found', 'Instructor membership not found.');
    }
    const instructorMem = instructorMemSnap.data() || {};
    if (String(instructorMem.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Instructor does not belong to this tenant.');
    }
    if (normalizeRole(instructorMem.role) !== 'instructor') {
      throw new HttpsError('invalid-argument', 'Target membership is not an instructor.');
    }
    if (normalizeRole(instructorMem.status) !== 'active') {
      throw new HttpsError('failed-precondition', 'Instructor membership is not active.');
    }
    if (!instructorUserSnap.exists) {
      throw new HttpsError('not-found', 'Instructor user not found.');
    }
    const instructorUser = instructorUserSnap.data() || {};
    if (normalizeRole(instructorUser.role) !== 'instructor') {
      throw new HttpsError('permission-denied', 'Target user is not an instructor.');
    }

    if (!studentMemSnap.exists) {
      throw new HttpsError('not-found', 'Student membership not found.');
    }
    const studentMem = studentMemSnap.data() || {};
    if (String(studentMem.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Student does not belong to this tenant.');
    }
    if (normalizeRole(studentMem.role) !== 'student') {
      throw new HttpsError('invalid-argument', 'Target membership is not a student.');
    }
    if (normalizeProgramType(studentMem.programType) !== DRIVING_PROGRAM_TYPE) {
      throw new HttpsError('failed-precondition', 'Only Driving/Ehliyet students can be assigned.');
    }
    if (normalizeRole(studentMem.status) !== 'active') {
      throw new HttpsError('failed-precondition', 'Student membership is not active.');
    }
    if (!studentUserSnap.exists) {
      throw new HttpsError('not-found', 'Student user not found.');
    }
    const studentUser = studentUserSnap.data() || {};
    if (normalizeRole(studentUser.role) !== 'student') {
      throw new HttpsError('permission-denied', 'Target user is not a student.');
    }

    const instructorNameSnap = (instructorUser.fullName && String(instructorUser.fullName).trim())
      ? String(instructorUser.fullName).trim()
      : (instructorUser.username ? String(instructorUser.username).trim() : instructorUid);
    const studentNameSnap = (studentUser.fullName && String(studentUser.fullName).trim())
      ? String(studentUser.fullName).trim()
      : (studentUser.username ? String(studentUser.username).trim() : studentUid);

    // Prefer deterministic id. If an edited lesson still occupies that id but no longer
    // overlaps this slot, create with an auto id (narrow collision-safety only).
    const preferredSlotKey = tenantId + '_' + instructorUid + '_' + String(slot.startMs);
    let lessonRef = db.collection('drivingLessons').doc(preferredSlotKey);
    let instructorSlotKey = preferredSlotKey;
    const preferredSnap = await lessonRef.get();
    if (preferredSnap.exists) {
      const preferredData = preferredSnap.data() || {};
      if (lessonBlocksOverlap(preferredData.status)) {
        const preferredStart = membershipExpiryToMillis(preferredData.startAt);
        const preferredEnd = membershipExpiryToMillis(preferredData.endAt);
        const preferredOverlaps = preferredStart != null && preferredEnd != null &&
          intervalsOverlap(preferredStart, preferredEnd, slot.startMs, slot.endMs);
        if (preferredOverlaps || preferredStart === slot.startMs) {
          throw new HttpsError('already-exists', 'Bu saatte öğreticinin başka bir dersi var.');
        }
        lessonRef = db.collection('drivingLessons').doc();
        instructorSlotKey = lessonRef.id;
      }
    }

    const [instructorCandidates, studentCandidates] = await Promise.all([
      queryPotentialOverlaps('instructorUid', instructorUid, tenantId, slot.startMs, slot.endMs),
      queryPotentialOverlaps('studentUid', studentUid, tenantId, slot.startMs, slot.endMs)
    ]);

    const instructorConflict = findOverlapConflict(
      instructorCandidates.filter((row) => row.id !== lessonRef.id),
      slot.startMs,
      slot.endMs
    );
    if (instructorConflict) {
      throw new HttpsError('already-exists', 'Bu saatte öğreticinin başka bir dersi var.');
    }
    const studentConflict = findOverlapConflict(
      studentCandidates.filter((row) => row.id !== lessonRef.id),
      slot.startMs,
      slot.endMs
    );
    if (studentConflict) {
      throw new HttpsError('already-exists', 'Bu saatte öğrencinin başka bir dersi var.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const lessonPayload = {
      tenantId: tenantId,
      instructorUid: instructorUid,
      studentUid: studentUid,
      studentNameSnap: studentNameSnap,
      instructorNameSnap: instructorNameSnap,
      startAt: slot.startTs,
      endAt: slot.endTs,
      durationMinutes: slot.durationMinutes,
      lessonAddress: lessonAddress,
      addressSource: addressSource,
      status: 'pending_instructor',
      source: 'admin_manual',
      createdBy: callerUid,
      createdAt: now,
      updatedAt: now,
      instructorSlotKey: instructorSlotKey
    };

    try {
      await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get(lessonRef);
        if (existingSnap.exists) {
          const existing = existingSnap.data() || {};
          if (lessonBlocksOverlap(existing.status)) {
            throw new HttpsError('already-exists', 'Bu saatte öğreticinin başka bir dersi var.');
          }
        }

        const instructorRequery = await tx.get(
          db.collection('drivingLessons')
            .where('tenantId', '==', tenantId)
            .where('instructorUid', '==', instructorUid)
            .where('startAt', '>=', admin.firestore.Timestamp.fromMillis(slot.startMs - DRIVING_LESSON_OVERLAP_LOOKBACK_MS))
            .where('startAt', '<', slot.endTs)
        );
        const instructorRows = (instructorRequery.docs || [])
          .map((d) => ({ id: d.id, ...(d.data() || {}) }))
          .filter((row) => row.id !== lessonRef.id);
        if (findOverlapConflict(instructorRows, slot.startMs, slot.endMs)) {
          throw new HttpsError('already-exists', 'Bu saatte öğreticinin başka bir dersi var.');
        }

        const studentRequery = await tx.get(
          db.collection('drivingLessons')
            .where('tenantId', '==', tenantId)
            .where('studentUid', '==', studentUid)
            .where('startAt', '>=', admin.firestore.Timestamp.fromMillis(slot.startMs - DRIVING_LESSON_OVERLAP_LOOKBACK_MS))
            .where('startAt', '<', slot.endTs)
        );
        const studentRows = (studentRequery.docs || [])
          .map((d) => ({ id: d.id, ...(d.data() || {}) }))
          .filter((row) => row.id !== lessonRef.id);
        if (findOverlapConflict(studentRows, slot.startMs, slot.endMs)) {
          throw new HttpsError('already-exists', 'Bu saatte öğrencinin başka bir dersi var.');
        }

        if (existingSnap.exists) {
          const prev = existingSnap.data() || {};
          tx.set(lessonRef, Object.assign({}, lessonPayload, {
            createdAt: prev.createdAt || now,
            createdBy: prev.createdBy || callerUid
          }), { merge: false });
        } else {
          tx.set(lessonRef, lessonPayload);
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for drivingLessons overlap checks. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to create driving lesson assignment.'
      );
    }

    const assignedSlotLabel = formatDrivingLessonSlotPreview(slot.startMs, slot.endMs);
    const assignedPreview = studentNameSnap && assignedSlotLabel
      ? (studentNameSnap + ' için ' + assignedSlotLabel + ' dersi atandı.')
      : (assignedSlotLabel
        ? (assignedSlotLabel + ' için yeni direksiyon dersi atandı.')
        : 'Yeni direksiyon dersi atandı.');
    await writeDrivingLessonNotificationDocs([
      buildInstructorDrivingLessonNotification({
        type: 'lesson_assigned',
        tenantId: tenantId,
        recipientUid: instructorUid,
        recipientRole: 'instructor',
        actorUid: callerUid,
        actorRole: 'institution_admin',
        lessonId: lessonRef.id,
        instructorUid: instructorUid,
        studentUid: studentUid,
        studentName: studentNameSnap,
        title: 'Yeni Direksiyon Dersi',
        preview: assignedPreview,
        agendaWeekStart: formatDrivingLessonAgendaWeekStartYmd(slot.startMs)
      })
    ]);

    return {
      ok: true,
      lessonId: lessonRef.id,
      tenantId: tenantId,
      instructorUid: instructorUid,
      studentUid: studentUid,
      status: 'pending_instructor',
      source: 'admin_manual',
      durationMinutes: slot.durationMinutes,
      startAt: new Date(slot.startMs).toISOString(),
      endAt: new Date(slot.endMs).toISOString(),
      lessonAddress: lessonAddress,
      addressSource: addressSource,
      studentNameSnap: studentNameSnap,
      instructorNameSnap: instructorNameSnap
    };
  }
);

/**
 * Phase 2B — List drivingLessons for Institution Admin agenda / recent / month stats.
 */
exports.listDrivingLessonsForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const instructorUid = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    const weekStartYmd = (data && data.weekStart ? String(data.weekStart) : '').trim();

    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    if (!instructorUid) throw new HttpsError('invalid-argument', 'instructorUid is required.');
    if (!weekStartYmd) throw new HttpsError('invalid-argument', 'weekStart is required (YYYY-MM-DD Monday).');

    await assertActiveInstitutionAdminForTenant(callerUid, tenantId);

    const instructorMembershipId = instructorUid + '_' + tenantId;
    const instructorMemSnap = await db.collection('tenantMemberships').doc(instructorMembershipId).get();
    if (!instructorMemSnap.exists) {
      throw new HttpsError('not-found', 'Instructor membership not found.');
    }
    const instructorMem = instructorMemSnap.data() || {};
    if (String(instructorMem.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Instructor does not belong to this tenant.');
    }
    if (normalizeRole(instructorMem.role) !== 'instructor') {
      throw new HttpsError('invalid-argument', 'Target is not an instructor.');
    }

    const weekStartMs = parseTurkeyDateStartIso(weekStartYmd);
    // Verify Monday in Turkey (+03): getUTCDay for +03 midnight maps awkwardly; use ISO weekday via formatter.
    const weekStartProbe = new Date(weekStartMs);
    const turkeyWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Istanbul',
      weekday: 'short'
    }).format(weekStartProbe);
    if (turkeyWeekday !== 'Mon') {
      throw new HttpsError('invalid-argument', 'weekStart must be a Monday (Europe/Istanbul).');
    }
    const weekEndMs = weekStartMs + (7 * 24 * 60 * 60 * 1000);

    const monthParts = weekStartYmd.split('-');
    const monthYear = parseInt(monthParts[0], 10);
    const monthIndex = parseInt(monthParts[1], 10); // 1-12
    if (!Number.isFinite(monthYear) || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) {
      throw new HttpsError('invalid-argument', 'weekStart month is invalid.');
    }
    const monthStartYmd = monthParts[0] + '-' + monthParts[1] + '-01';
    const monthStartMs = parseTurkeyDateStartIso(monthStartYmd);
    const nextMonthYear = monthIndex === 12 ? monthYear + 1 : monthYear;
    const nextMonthIndex = monthIndex === 12 ? 1 : monthIndex + 1;
    const nextMonthYmd =
      String(nextMonthYear) + '-' +
      (nextMonthIndex < 10 ? '0' : '') + String(nextMonthIndex) + '-01';
    const monthEndMs = parseTurkeyDateStartIso(nextMonthYmd);

    const weekStartTs = admin.firestore.Timestamp.fromMillis(weekStartMs);
    const weekEndTs = admin.firestore.Timestamp.fromMillis(weekEndMs);
    const monthStartTs = admin.firestore.Timestamp.fromMillis(monthStartMs);
    const monthEndTs = admin.firestore.Timestamp.fromMillis(monthEndMs);

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    const tenantAddress = tenantSnap.exists
      ? String((tenantSnap.data() || {}).address || '').trim()
      : '';

    let weekSnap;
    let monthSnap;
    let recentSnap;
    try {
      [weekSnap, monthSnap, recentSnap] = await Promise.all([
        db.collection('drivingLessons')
          .where('tenantId', '==', tenantId)
          .where('instructorUid', '==', instructorUid)
          .where('startAt', '>=', weekStartTs)
          .where('startAt', '<', weekEndTs)
          .get(),
        db.collection('drivingLessons')
          .where('tenantId', '==', tenantId)
          .where('instructorUid', '==', instructorUid)
          .where('startAt', '>=', monthStartTs)
          .where('startAt', '<', monthEndTs)
          .get(),
        db.collection('drivingLessons')
          .where('tenantId', '==', tenantId)
          .where('instructorUid', '==', instructorUid)
          .orderBy('updatedAt', 'desc')
          .limit(5)
          .get()
      ]);
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for drivingLessons list. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to list driving lessons.'
      );
    }

    // Exclude any non-lesson sentinel docs if present.
    function mapLessonDocs(snap) {
      return (snap.docs || [])
        .filter((doc) => doc && doc.id && String(doc.id).indexOf('slot_') !== 0)
        .map((doc) => serializeDrivingLessonDoc(doc.id, doc.data() || {}));
    }

    const weekLessons = mapLessonDocs(weekSnap);
    const monthLessons = mapLessonDocs(monthSnap);
    let recentLessons = mapLessonDocs(recentSnap);
    if (!recentLessons.length) {
      const merged = {};
      weekLessons.concat(monthLessons).forEach((L) => { merged[L.id] = L; });
      recentLessons = Object.keys(merged).map((k) => merged[k]).sort((a, b) => {
        const am = a.updatedAtMs != null ? a.updatedAtMs : (a.createdAtMs || 0);
        const bm = b.updatedAtMs != null ? b.updatedAtMs : (b.createdAtMs || 0);
        return bm - am;
      }).slice(0, 5);
    }

    let monthCompletedMinutes = 0;
    let pendingCount = 0;
    let consultationCount = 0;
    monthLessons.forEach((L) => {
      if (L.status === 'completed') {
        monthCompletedMinutes += Number(L.durationMinutes) || DRIVING_LESSON_DURATION_MINUTES_V1;
      }
      if (L.status === 'pending_instructor') pendingCount += 1;
      if (L.status === 'consultation_requested') consultationCount += 1;
    });

    const monthLabelTr = (() => {
      try {
        return new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          month: 'long',
          year: 'numeric'
        }).format(new Date(monthStartMs));
      } catch (_) {
        return monthParts[1] + ' ' + monthParts[0];
      }
    })();

    return {
      ok: true,
      tenantId: tenantId,
      instructorUid: instructorUid,
      tenantAddress: tenantAddress,
      weekStart: weekStartYmd,
      weekStartMs: weekStartMs,
      weekEndMs: weekEndMs,
      monthStart: monthStartYmd,
      monthEndExclusive: nextMonthYmd,
      monthLabel: monthLabelTr,
      weekLessons: weekLessons,
      recentLessons: recentLessons,
      monthCompletedMinutes: monthCompletedMinutes,
      monthCompletedHours: Math.round((monthCompletedMinutes / 60) * 100) / 100,
      pendingCount: pendingCount,
      consultationCount: consultationCount
    };
  }
);

/**
 * Independent Instructor monthly performance summary (institution_admin only).
 * Does not return week/recent lessons. Month membership uses startAt (Europe/Istanbul).
 */
exports.getDrivingLessonMonthSummaryForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const instructorUid = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    const monthStartYmd = (data && data.monthStart ? String(data.monthStart) : '').trim();

    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    if (!instructorUid) throw new HttpsError('invalid-argument', 'instructorUid is required.');
    if (!/^\d{4}-\d{2}-01$/.test(monthStartYmd)) {
      throw new HttpsError('invalid-argument', 'monthStart must be YYYY-MM-01.');
    }

    const monthParts = monthStartYmd.split('-');
    const monthYear = parseInt(monthParts[0], 10);
    const monthIndex = parseInt(monthParts[1], 10);
    if (!Number.isFinite(monthYear) || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) {
      throw new HttpsError('invalid-argument', 'monthStart month is invalid.');
    }

    await assertActiveInstitutionAdminForTenant(callerUid, tenantId);

    const instructorMembershipId = instructorUid + '_' + tenantId;
    const instructorMemSnap = await db.collection('tenantMemberships').doc(instructorMembershipId).get();
    if (!instructorMemSnap.exists) {
      throw new HttpsError('not-found', 'Instructor membership not found.');
    }
    const instructorMem = instructorMemSnap.data() || {};
    if (String(instructorMem.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Instructor does not belong to this tenant.');
    }
    if (normalizeRole(instructorMem.role) !== 'instructor') {
      throw new HttpsError('invalid-argument', 'Target is not an instructor.');
    }

    const monthStartMs = parseTurkeyDateStartIso(monthStartYmd);
    const nextMonthYear = monthIndex === 12 ? monthYear + 1 : monthYear;
    const nextMonthIndex = monthIndex === 12 ? 1 : monthIndex + 1;
    const nextMonthYmd =
      String(nextMonthYear) + '-' +
      (nextMonthIndex < 10 ? '0' : '') + String(nextMonthIndex) + '-01';
    const monthEndMs = parseTurkeyDateStartIso(nextMonthYmd);
    const monthStartTs = admin.firestore.Timestamp.fromMillis(monthStartMs);
    const monthEndTs = admin.firestore.Timestamp.fromMillis(monthEndMs);

    let monthSnap;
    try {
      monthSnap = await db.collection('drivingLessons')
        .where('tenantId', '==', tenantId)
        .where('instructorUid', '==', instructorUid)
        .where('startAt', '>=', monthStartTs)
        .where('startAt', '<', monthEndTs)
        .get();
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for drivingLessons list. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to load month summary.'
      );
    }

    const monthLessons = (monthSnap.docs || [])
      .filter((doc) => doc && doc.id && String(doc.id).indexOf('slot_') !== 0)
      .map((doc) => serializeDrivingLessonDoc(doc.id, doc.data() || {}));

    let monthCompletedMinutes = 0;
    let pendingCount = 0;
    let consultationCount = 0;
    monthLessons.forEach((L) => {
      if (L.status === 'completed') {
        monthCompletedMinutes += Number(L.durationMinutes) || DRIVING_LESSON_DURATION_MINUTES_V1;
      }
      if (L.status === 'pending_instructor') pendingCount += 1;
      if (L.status === 'consultation_requested') consultationCount += 1;
    });

    const monthLabelTr = (() => {
      try {
        return new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          month: 'long',
          year: 'numeric'
        }).format(new Date(monthStartMs));
      } catch (_) {
        return monthParts[1] + ' ' + monthParts[0];
      }
    })();

    return {
      ok: true,
      tenantId: tenantId,
      instructorUid: instructorUid,
      monthStart: monthStartYmd,
      monthEndExclusive: nextMonthYmd,
      monthLabel: monthLabelTr,
      monthCompletedMinutes: monthCompletedMinutes,
      monthCompletedHours: Math.round((monthCompletedMinutes / 60) * 100) / 100,
      pendingCount: pendingCount,
      consultationCount: consultationCount
    };
  }
);

/**
 * Independent Instructor Profile monthly driving summary (own lessons only).
 * Month membership uses startAt (Europe/Istanbul). instructorUid is always auth.uid.
 */
exports.getDrivingLessonMonthSummaryForInstructor = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const monthStartYmd = (data && data.monthStart ? String(data.monthStart) : '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    if (!/^\d{4}-\d{2}-01$/.test(monthStartYmd)) {
      throw new HttpsError('invalid-argument', 'monthStart must be YYYY-MM-01.');
    }

    const monthParts = monthStartYmd.split('-');
    const monthYear = parseInt(monthParts[0], 10);
    const monthIndex = parseInt(monthParts[1], 10);
    if (!Number.isFinite(monthYear) || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) {
      throw new HttpsError('invalid-argument', 'monthStart month is invalid.');
    }

    await assertActiveInstructorForTenant(callerUid, tenantId);

    const monthStartMs = parseTurkeyDateStartIso(monthStartYmd);
    const nextMonthYear = monthIndex === 12 ? monthYear + 1 : monthYear;
    const nextMonthIndex = monthIndex === 12 ? 1 : monthIndex + 1;
    const nextMonthYmd =
      String(nextMonthYear) + '-' +
      (nextMonthIndex < 10 ? '0' : '') + String(nextMonthIndex) + '-01';
    const monthEndMs = parseTurkeyDateStartIso(nextMonthYmd);
    const monthStartTs = admin.firestore.Timestamp.fromMillis(monthStartMs);
    const monthEndTs = admin.firestore.Timestamp.fromMillis(monthEndMs);

    let monthSnap;
    try {
      monthSnap = await db.collection('drivingLessons')
        .where('tenantId', '==', tenantId)
        .where('instructorUid', '==', callerUid)
        .where('startAt', '>=', monthStartTs)
        .where('startAt', '<', monthEndTs)
        .get();
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for drivingLessons list. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to load month summary.'
      );
    }

    const monthLessons = (monthSnap.docs || [])
      .filter((doc) => doc && doc.id && String(doc.id).indexOf('slot_') !== 0)
      .map((doc) => serializeDrivingLessonDoc(doc.id, doc.data() || {}))
      .filter((L) => String(L.instructorUid || '').trim() === callerUid
        && String(L.tenantId || '').trim() === tenantId);

    let monthCompletedMinutes = 0;
    monthLessons.forEach((L) => {
      if (L.status === 'completed') {
        monthCompletedMinutes += Number(L.durationMinutes) || DRIVING_LESSON_DURATION_MINUTES_V1;
      }
    });

    const monthLabelTr = (() => {
      try {
        return new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          month: 'long',
          year: 'numeric'
        }).format(new Date(monthStartMs));
      } catch (_) {
        return monthParts[1] + ' ' + monthParts[0];
      }
    })();

    return {
      monthStart: monthStartYmd,
      monthLabel: monthLabelTr,
      monthCompletedMinutes: monthCompletedMinutes,
      monthCompletedHours: Math.round((monthCompletedMinutes / 60) * 100) / 100
    };
  }
);

/**
 * Phase 2C-3A — Soft-cancel a drivingLessons assignment (institution_admin only).
 */
exports.cancelDrivingLessonAssignmentForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const lessonId = (data && data.lessonId ? String(data.lessonId) : '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    if (!lessonId) throw new HttpsError('invalid-argument', 'lessonId is required.');

    await assertActiveInstitutionAdminForTenant(callerUid, tenantId);

    const lessonRef = db.collection('drivingLessons').doc(lessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) {
      throw new HttpsError('not-found', 'Driving lesson not found.');
    }
    const lesson = lessonSnap.data() || {};
    if (String(lesson.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Lesson does not belong to this tenant.');
    }

    const status = normalizeRole(lesson.status);
    if (status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Lesson is already cancelled.');
    }
    if (status === 'completed') {
      throw new HttpsError('failed-precondition', 'Completed lessons cannot be cancelled.');
    }
    if (!DRIVING_LESSON_CANCELLABLE_STATUSES[status]) {
      throw new HttpsError('failed-precondition', 'Lesson cannot be cancelled in its current status.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(lessonRef);
        if (!freshSnap.exists) {
          throw new HttpsError('not-found', 'Driving lesson not found.');
        }
        const fresh = freshSnap.data() || {};
        if (String(fresh.tenantId || '').trim() !== tenantId) {
          throw new HttpsError('permission-denied', 'Lesson does not belong to this tenant.');
        }
        const freshStatus = normalizeRole(fresh.status);
        if (freshStatus === 'cancelled') {
          throw new HttpsError('failed-precondition', 'Lesson is already cancelled.');
        }
        if (freshStatus === 'completed') {
          throw new HttpsError('failed-precondition', 'Completed lessons cannot be cancelled.');
        }
        if (!DRIVING_LESSON_CANCELLABLE_STATUSES[freshStatus]) {
          throw new HttpsError('failed-precondition', 'Lesson cannot be cancelled in its current status.');
        }
        tx.update(lessonRef, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: callerUid,
          updatedAt: now
        });

        // Special lesson agenda Sil left orphaned waiting requests — cascade soft-cancel.
        const specialRequestId = String(fresh.specialLessonRequestId || '').trim();
        if (
          normalizeRole(fresh.source) === SPECIAL_LESSON_DRIVING_SOURCE &&
          specialRequestId
        ) {
          const reqRef = db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION).doc(specialRequestId);
          const reqSnap = await tx.get(reqRef);
          if (reqSnap.exists) {
            const req = reqSnap.data() || {};
            if (String(req.tenantId || '').trim() === tenantId) {
              const reqStatus = deriveSpecialRequestStatus(req);
              if (reqStatus !== 'cancelled' && reqStatus !== 'rejected' && reqStatus !== 'approved') {
                tx.set(reqRef, {
                  status: 'cancelled',
                  cancelledAt: now,
                  cancelledBy: 'institution_admin',
                  cancellationType: 'removed_by_admin',
                  cancelledByUid: callerUid,
                  updatedAt: now,
                  drivingLessonId: lessonId
                }, { merge: true });
              }
            }
          }
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to cancel driving lesson assignment.'
      );
    }

    const cancelInstructorUid = String(lesson.instructorUid || '').trim();
    const cancelStartMs = drivingLessonNotificationStartMs(lesson);
    const cancelEndMs = drivingLessonNotificationEndMs(lesson);
    const cancelSlotLabel = formatDrivingLessonSlotPreview(cancelStartMs, cancelEndMs);
    const cancelStudentName = String(lesson.studentNameSnap || '').trim();
    const cancelPreview = cancelStudentName && cancelSlotLabel
      ? (cancelStudentName + ' için ' + cancelSlotLabel + ' dersi kurum tarafından iptal edildi.')
      : (cancelSlotLabel
        ? (cancelSlotLabel + ' dersi kurum tarafından iptal edildi.')
        : 'Direksiyon dersi kurum tarafından iptal edildi.');
    await writeDrivingLessonNotificationDocs([
      buildInstructorDrivingLessonNotification({
        type: 'lesson_cancelled',
        tenantId: tenantId,
        recipientUid: cancelInstructorUid,
        recipientRole: 'instructor',
        actorUid: callerUid,
        actorRole: 'institution_admin',
        lessonId: lessonId,
        instructorUid: cancelInstructorUid,
        studentUid: String(lesson.studentUid || '').trim(),
        studentName: cancelStudentName,
        title: 'Direksiyon Dersi İptal Edildi',
        preview: cancelPreview,
        agendaWeekStart: formatDrivingLessonAgendaWeekStartYmd(cancelStartMs)
      })
    ]);

    return {
      ok: true,
      lessonId: lessonId,
      tenantId: tenantId,
      status: 'cancelled'
    };
  }
);

/**
 * Phase 2C-3A — Update a drivingLessons assignment in place (institution_admin only).
 * Keeps lessonId stable. Instructor reassignment is not allowed.
 */
exports.updateDrivingLessonAssignmentForInstitutionAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const lessonId = (data && data.lessonId ? String(data.lessonId) : '').trim();
    const studentUid = (data && data.studentUid ? String(data.studentUid) : '').trim();
    const slotStartRaw = data && data.slotStart != null ? data.slotStart : '';
    const slotEndRaw = data && data.slotEnd != null ? data.slotEnd : '';
    const addressOverrideRaw = data && data.lessonAddressOverride != null
      ? String(data.lessonAddressOverride)
      : null;

    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    if (!lessonId) throw new HttpsError('invalid-argument', 'lessonId is required.');
    if (!studentUid) throw new HttpsError('invalid-argument', 'studentUid is required.');
    if (addressOverrideRaw == null) {
      throw new HttpsError('invalid-argument', 'lessonAddressOverride is required.');
    }

    await assertActiveInstitutionAdminForTenant(callerUid, tenantId);

    const slot = parseTurkeyLessonWindow(slotStartRaw, slotEndRaw);

    const lessonRef = db.collection('drivingLessons').doc(lessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) {
      throw new HttpsError('not-found', 'Driving lesson not found.');
    }
    const existingLesson = lessonSnap.data() || {};
    if (String(existingLesson.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Lesson does not belong to this tenant.');
    }

    const currentStatus = normalizeRole(existingLesson.status);
    if (currentStatus === 'completed') {
      throw new HttpsError('failed-precondition', 'Completed lessons cannot be edited.');
    }
    if (currentStatus === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Cancelled lessons cannot be edited.');
    }
    if (!DRIVING_LESSON_EDITABLE_STATUSES[currentStatus]) {
      throw new HttpsError('failed-precondition', 'Lesson cannot be edited in its current status.');
    }

    const instructorUid = String(existingLesson.instructorUid || '').trim();
    if (!instructorUid) {
      throw new HttpsError('failed-precondition', 'Lesson instructor is missing.');
    }
    if (instructorUid === studentUid) {
      throw new HttpsError('invalid-argument', 'Instructor and student must be different.');
    }

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
      throw new HttpsError('not-found', 'Tenant not found.');
    }
    const tenantAddress = String((tenantSnap.data() || {}).address || '').trim();

    const trimmedOverride = String(addressOverrideRaw || '').trim().replace(/\s+/g, ' ');
    if (!trimmedOverride) {
      throw new HttpsError('failed-precondition', 'Ders adresi gereklidir. Kurum adresini girin veya bu ders için adres yazın.');
    }
    if (trimmedOverride.length > DRIVING_LESSON_ADDRESS_MAX) {
      throw new HttpsError('invalid-argument', 'Ders adresi en fazla 500 karakter olabilir.');
    }
    let lessonAddress = trimmedOverride;
    let addressSource = trimmedOverride === tenantAddress ? 'tenant_default' : 'override';

    const studentMembershipId = studentUid + '_' + tenantId;
    const instructorMembershipId = instructorUid + '_' + tenantId;
    const [
      instructorMemSnap,
      studentMemSnap,
      studentUserSnap
    ] = await Promise.all([
      db.collection('tenantMemberships').doc(instructorMembershipId).get(),
      db.collection('tenantMemberships').doc(studentMembershipId).get(),
      db.collection('users').doc(studentUid).get()
    ]);

    if (!instructorMemSnap.exists) {
      throw new HttpsError('not-found', 'Instructor membership not found.');
    }
    const instructorMem = instructorMemSnap.data() || {};
    if (String(instructorMem.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Instructor does not belong to this tenant.');
    }
    if (normalizeRole(instructorMem.role) !== 'instructor') {
      throw new HttpsError('invalid-argument', 'Target membership is not an instructor.');
    }
    if (normalizeRole(instructorMem.status) !== 'active') {
      throw new HttpsError('failed-precondition', 'Instructor membership is not active.');
    }

    if (!studentMemSnap.exists) {
      throw new HttpsError('not-found', 'Student membership not found.');
    }
    const studentMem = studentMemSnap.data() || {};
    if (String(studentMem.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Student does not belong to this tenant.');
    }
    if (normalizeRole(studentMem.role) !== 'student') {
      throw new HttpsError('invalid-argument', 'Target membership is not a student.');
    }
    if (normalizeProgramType(studentMem.programType) !== DRIVING_PROGRAM_TYPE) {
      throw new HttpsError('failed-precondition', 'Only Driving/Ehliyet students can be assigned.');
    }
    if (normalizeRole(studentMem.status) !== 'active') {
      throw new HttpsError('failed-precondition', 'Student membership is not active.');
    }
    if (!studentUserSnap.exists) {
      throw new HttpsError('not-found', 'Student user not found.');
    }
    const studentUser = studentUserSnap.data() || {};
    if (normalizeRole(studentUser.role) !== 'student') {
      throw new HttpsError('permission-denied', 'Target user is not a student.');
    }

    const studentNameSnap = (studentUser.fullName && String(studentUser.fullName).trim())
      ? String(studentUser.fullName).trim()
      : (studentUser.username ? String(studentUser.username).trim() : studentUid);

    const previousStartMs = membershipExpiryToMillis(existingLesson.startAt);
    const previousEndMsForSchedule = membershipExpiryToMillis(existingLesson.endAt);
    const previousStudentUid = String(existingLesson.studentUid || '').trim();
    const scheduleChanged = previousStartMs !== slot.startMs || previousEndMsForSchedule !== slot.endMs;
    const studentChanged = previousStudentUid !== studentUid;
    const materialChange = scheduleChanged || studentChanged;

    let nextStatus = currentStatus;
    if (materialChange && (currentStatus === 'confirmed' || currentStatus === 'consultation_requested')) {
      nextStatus = 'pending_instructor';
    }

    const [instructorCandidates, studentCandidates] = await Promise.all([
      queryPotentialOverlaps('instructorUid', instructorUid, tenantId, slot.startMs, slot.endMs),
      queryPotentialOverlaps('studentUid', studentUid, tenantId, slot.startMs, slot.endMs)
    ]);

    if (findOverlapConflict(
      instructorCandidates.filter((row) => row.id !== lessonId),
      slot.startMs,
      slot.endMs
    )) {
      throw new HttpsError('already-exists', 'Bu saatte öğreticinin başka bir dersi var.');
    }
    if (findOverlapConflict(
      studentCandidates.filter((row) => row.id !== lessonId),
      slot.startMs,
      slot.endMs
    )) {
      throw new HttpsError('already-exists', 'Bu saatte öğrencinin başka bir dersi var.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch = {
      studentUid: studentUid,
      studentNameSnap: studentNameSnap,
      startAt: slot.startTs,
      endAt: slot.endTs,
      durationMinutes: slot.durationMinutes,
      lessonAddress: lessonAddress,
      addressSource: addressSource,
      status: nextStatus,
      updatedAt: now,
      updatedBy: callerUid
    };
    if (materialChange) {
      patch.instructorResponseNote = admin.firestore.FieldValue.delete();
      patch.instructorRespondedAt = admin.firestore.FieldValue.delete();
      patch.instructorResponseAction = admin.firestore.FieldValue.delete();
    }

    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(lessonRef);
        if (!freshSnap.exists) {
          throw new HttpsError('not-found', 'Driving lesson not found.');
        }
        const fresh = freshSnap.data() || {};
        if (String(fresh.tenantId || '').trim() !== tenantId) {
          throw new HttpsError('permission-denied', 'Lesson does not belong to this tenant.');
        }
        if (String(fresh.instructorUid || '').trim() !== instructorUid) {
          throw new HttpsError('failed-precondition', 'Lesson instructor changed unexpectedly.');
        }
        const freshStatus = normalizeRole(fresh.status);
        if (freshStatus === 'completed') {
          throw new HttpsError('failed-precondition', 'Completed lessons cannot be edited.');
        }
        if (freshStatus === 'cancelled') {
          throw new HttpsError('failed-precondition', 'Cancelled lessons cannot be edited.');
        }
        if (!DRIVING_LESSON_EDITABLE_STATUSES[freshStatus]) {
          throw new HttpsError('failed-precondition', 'Lesson cannot be edited in its current status.');
        }

        const instructorRequery = await tx.get(
          db.collection('drivingLessons')
            .where('tenantId', '==', tenantId)
            .where('instructorUid', '==', instructorUid)
            .where('startAt', '>=', admin.firestore.Timestamp.fromMillis(slot.startMs - DRIVING_LESSON_OVERLAP_LOOKBACK_MS))
            .where('startAt', '<', slot.endTs)
        );
        const instructorRows = (instructorRequery.docs || [])
          .map((d) => ({ id: d.id, ...(d.data() || {}) }))
          .filter((row) => row.id !== lessonId);
        if (findOverlapConflict(instructorRows, slot.startMs, slot.endMs)) {
          throw new HttpsError('already-exists', 'Bu saatte öğreticinin başka bir dersi var.');
        }

        const studentRequery = await tx.get(
          db.collection('drivingLessons')
            .where('tenantId', '==', tenantId)
            .where('studentUid', '==', studentUid)
            .where('startAt', '>=', admin.firestore.Timestamp.fromMillis(slot.startMs - DRIVING_LESSON_OVERLAP_LOOKBACK_MS))
            .where('startAt', '<', slot.endTs)
        );
        const studentRows = (studentRequery.docs || [])
          .map((d) => ({ id: d.id, ...(d.data() || {}) }))
          .filter((row) => row.id !== lessonId);
        if (findOverlapConflict(studentRows, slot.startMs, slot.endMs)) {
          throw new HttpsError('already-exists', 'Bu saatte öğrencinin başka bir dersi var.');
        }

        let txStatus = freshStatus;
        const freshStartMs = membershipExpiryToMillis(fresh.startAt);
        const freshEndMs = membershipExpiryToMillis(fresh.endAt);
        const freshStudentUid = String(fresh.studentUid || '').trim();
        const txMaterial =
          freshStartMs !== slot.startMs
          || freshEndMs !== slot.endMs
          || freshStudentUid !== studentUid;
        if (txMaterial && (freshStatus === 'confirmed' || freshStatus === 'consultation_requested')) {
          txStatus = 'pending_instructor';
        }
        const txPatch = Object.assign({}, patch, { status: txStatus });
        if (!txMaterial) {
          delete txPatch.instructorResponseNote;
          delete txPatch.instructorRespondedAt;
          delete txPatch.instructorResponseAction;
        }
        tx.update(lessonRef, txPatch);
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for drivingLessons overlap checks. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to update driving lesson assignment.'
      );
    }

    const previousEndMs = membershipExpiryToMillis(existingLesson.endAt);
    const previousDurationRaw = Number(existingLesson.durationMinutes);
    const previousDuration = (Number.isFinite(previousDurationRaw) && previousDurationRaw > 0)
      ? previousDurationRaw
      : DRIVING_LESSON_DURATION_MINUTES_V1;
    const previousAddress = String(existingLesson.lessonAddress || '').trim();
    const previousStudentName = String(existingLesson.studentNameSnap || '').trim();
    const addressChanged = normalizeDrivingLessonNotificationAddress(previousAddress)
      !== normalizeDrivingLessonNotificationAddress(lessonAddress);
    const durationChanged = previousDuration !== slot.durationMinutes;
    const endChanged = previousEndMs !== slot.endMs;
    const studentNameChanged = previousStudentName !== String(studentNameSnap || '').trim();
    const statusResetToPending = nextStatus !== currentStatus;
    const notifyWorthyUpdate = !!(
      scheduleChanged
      || studentChanged
      || studentNameChanged
      || addressChanged
      || durationChanged
      || endChanged
      || statusResetToPending
    );
    if (notifyWorthyUpdate) {
      const updatedSlotLabel = formatDrivingLessonSlotPreview(slot.startMs, slot.endMs);
      const updatedPreview = studentNameSnap && updatedSlotLabel
        ? (studentNameSnap + ' için ' + updatedSlotLabel + ' dersi güncellendi.')
        : (updatedSlotLabel
          ? (updatedSlotLabel + ' dersiniz güncellendi.')
          : 'Direksiyon dersiniz güncellendi.');
      const updateFingerprint = drivingLessonUpdatedFingerprint({
        startAtMs: slot.startMs,
        endAtMs: slot.endMs,
        durationMinutes: slot.durationMinutes,
        studentUid: studentUid,
        lessonAddress: lessonAddress,
        status: nextStatus
      });
      await writeDrivingLessonNotificationDocs([
        buildInstructorDrivingLessonNotification({
          type: 'lesson_updated',
          fingerprint: updateFingerprint,
          tenantId: tenantId,
          recipientUid: instructorUid,
          recipientRole: 'instructor',
          actorUid: callerUid,
          actorRole: 'institution_admin',
          lessonId: lessonId,
          instructorUid: instructorUid,
          studentUid: studentUid,
          studentName: studentNameSnap,
          title: 'Direksiyon Dersi Güncellendi',
          preview: updatedPreview,
          agendaWeekStart: formatDrivingLessonAgendaWeekStartYmd(slot.startMs)
        })
      ]);
    }

    return {
      ok: true,
      lessonId: lessonId,
      tenantId: tenantId,
      instructorUid: instructorUid,
      studentUid: studentUid,
      studentNameSnap: studentNameSnap,
      status: nextStatus,
      durationMinutes: slot.durationMinutes,
      startAt: new Date(slot.startMs).toISOString(),
      endAt: new Date(slot.endMs).toISOString(),
      lessonAddress: lessonAddress,
      addressSource: addressSource,
      scheduleChanged: !!scheduleChanged,
      studentChanged: !!studentChanged
    };
  }
);

/* -------------------------------------------------------------------------- */
/* Phase 2C-2B — Instructor mobile agenda (read-only)                         */
/* -------------------------------------------------------------------------- */

const INSTRUCTOR_AGENDA_HARD_CAP = 100;
const INSTRUCTOR_AGENDA_FORWARD_DAYS = 31;
const INSTRUCTOR_AGENDA_PENDING_LOOKBACK_DAYS = 180;

function getEuropeIstanbulDayStartMs(nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(now));
    const y = parts.find((p) => p.type === 'year');
    const m = parts.find((p) => p.type === 'month');
    const d = parts.find((p) => p.type === 'day');
    const ymd = (y && y.value) + '-' + (m && m.value) + '-' + (d && d.value);
    const ms = Date.parse(ymd + 'T00:00:00+03:00');
    if (Number.isFinite(ms)) return ms;
  } catch (_) {}
  const fallback = new Date(now);
  fallback.setHours(0, 0, 0, 0);
  return fallback.getTime();
}

async function assertActiveInstructorForTenant(callerUid, tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }
  const [membershipSnap, userSnap] = await Promise.all([
    db.collection('tenantMemberships').doc(callerUid + '_' + tid).get(),
    db.collection('users').doc(callerUid).get()
  ]);
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile could not be verified.');
  }
  const userData = userSnap.data() || {};
  if (normalizeRole(userData.role) !== 'instructor') {
    throw new HttpsError('permission-denied', 'Only instructors can access the driving agenda.');
  }
  if (!membershipSnap.exists) {
    throw new HttpsError('permission-denied', 'Not an active instructor for this tenant.');
  }
  const membership = membershipSnap.data() || {};
  const membershipTenantId = String(membership.tenantId || '').trim();
  if (
    (membershipTenantId && membershipTenantId !== tid) ||
    normalizeRole(membership.role) !== 'instructor' ||
    normalizeRole(membership.status) !== 'active'
  ) {
    throw new HttpsError('permission-denied', 'Not an active instructor for this tenant.');
  }
  return { tenantId: tid, membership: membership, userData: userData };
}

function serializeDrivingLessonForInstructorAgenda(id, data) {
  const d = data || {};
  function tsToMillis(ts) {
    try {
      if (!ts) return null;
      if (typeof ts.toMillis === 'function') return ts.toMillis();
      if (typeof ts.toDate === 'function') return ts.toDate().getTime();
      if (typeof ts._seconds === 'number') return ts._seconds * 1000;
      return null;
    } catch (_) {
      return null;
    }
  }
  const noteRaw = d.instructorResponseNote != null ? String(d.instructorResponseNote).trim() : '';
  const out = {
    id: id,
    tenantId: String(d.tenantId || '').trim(),
    studentUid: String(d.studentUid || '').trim(),
    studentNameSnap: d.studentNameSnap ? String(d.studentNameSnap).trim() : '',
    startAtMs: tsToMillis(d.startAt),
    endAtMs: tsToMillis(d.endAt),
    durationMinutes: Number(d.durationMinutes) || DRIVING_LESSON_DURATION_MINUTES_V1,
    lessonAddress: d.lessonAddress ? String(d.lessonAddress).trim() : '',
    status: normalizeRole(d.status),
    source: d.source ? String(d.source).trim() : '',
    createdAtMs: tsToMillis(d.createdAt),
    updatedAtMs: tsToMillis(d.updatedAt)
  };
  if (noteRaw) out.instructorResponseNote = noteRaw;
  const specialRequestId = d.specialLessonRequestId != null
    ? String(d.specialLessonRequestId).trim()
    : '';
  if (specialRequestId) out.specialLessonRequestId = specialRequestId;
  const specialFinalMs = tsToMillis(d.specialFinalApprovedAt);
  if (specialFinalMs != null) out.specialFinalApprovedAtMs = specialFinalMs;
  const completedAtMs = tsToMillis(d.completedAt);
  if (completedAtMs != null) out.completedAtMs = completedAtMs;
  return out;
}

/**
 * Phase 2C-2B / 2C-3B — List drivingLessons for the authenticated instructor (own lessons only).
 * Optional weekStart (YYYY-MM-DD Monday, Europe/Istanbul) returns that week only.
 * Without weekStart, preserves the original today → +31d window (+ pending lookback).
 */
exports.listDrivingLessonsForInstructor = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    await assertActiveInstructorForTenant(callerUid, tenantId);

    const weekStartRaw = data && data.weekStart != null ? String(data.weekStart).trim() : '';
    const dayStartMs = getEuropeIstanbulDayStartMs(Date.now());

    let windowStartMs;
    let windowEndMs;
    let weekMode = false;
    let weekStartYmd = null;

    if (weekStartRaw) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw)) {
        throw new HttpsError('invalid-argument', 'weekStart must be YYYY-MM-DD.');
      }
      const weekStartMs = parseTurkeyDateStartIso(weekStartRaw);
      const turkeyWeekday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Istanbul',
        weekday: 'short'
      }).format(new Date(weekStartMs));
      if (turkeyWeekday !== 'Mon') {
        throw new HttpsError('invalid-argument', 'weekStart must be a Monday (Europe/Istanbul).');
      }
      weekMode = true;
      weekStartYmd = weekStartRaw;
      windowStartMs = weekStartMs;
      windowEndMs = weekStartMs + (7 * MS_PER_DAY);
    } else {
      windowStartMs = dayStartMs;
      windowEndMs = dayStartMs + (INSTRUCTOR_AGENDA_FORWARD_DAYS * MS_PER_DAY);
    }

    const windowStartTs = admin.firestore.Timestamp.fromMillis(windowStartMs);
    const windowEndTs = admin.firestore.Timestamp.fromMillis(windowEndMs);

    let windowSnap;
    let pendingLookbackSnap = null;
    try {
      if (weekMode) {
        windowSnap = await db.collection('drivingLessons')
          .where('tenantId', '==', tenantId)
          .where('instructorUid', '==', callerUid)
          .where('startAt', '>=', windowStartTs)
          .where('startAt', '<', windowEndTs)
          .orderBy('startAt', 'asc')
          .limit(INSTRUCTOR_AGENDA_HARD_CAP)
          .get();
      } else {
        const pendingLookbackMs = dayStartMs - (INSTRUCTOR_AGENDA_PENDING_LOOKBACK_DAYS * MS_PER_DAY);
        const pendingLookbackTs = admin.firestore.Timestamp.fromMillis(pendingLookbackMs);
        [windowSnap, pendingLookbackSnap] = await Promise.all([
          db.collection('drivingLessons')
            .where('tenantId', '==', tenantId)
            .where('instructorUid', '==', callerUid)
            .where('startAt', '>=', windowStartTs)
            .where('startAt', '<', windowEndTs)
            .orderBy('startAt', 'asc')
            .limit(INSTRUCTOR_AGENDA_HARD_CAP)
            .get(),
          db.collection('drivingLessons')
            .where('tenantId', '==', tenantId)
            .where('instructorUid', '==', callerUid)
            .where('startAt', '>=', pendingLookbackTs)
            .where('startAt', '<', windowStartTs)
            .orderBy('startAt', 'asc')
            .limit(INSTRUCTOR_AGENDA_HARD_CAP)
            .get()
        ]);
      }
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for drivingLessons list. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to list instructor agenda.'
      );
    }

    const byId = {};
    function ingest(snap, pendingOnly) {
      (snap.docs || []).forEach((doc) => {
        if (!doc || !doc.id || String(doc.id).indexOf('slot_') === 0) return;
        const raw = doc.data() || {};
        if (String(raw.instructorUid || '').trim() !== callerUid) return;
        if (String(raw.tenantId || '').trim() !== tenantId) return;
        const status = normalizeRole(raw.status);
        if (pendingOnly && status !== 'pending_instructor' && status !== 'pending_admin') return;
        byId[doc.id] = serializeDrivingLessonForInstructorAgenda(doc.id, raw);
      });
    }
    ingest(windowSnap, false);
    if (pendingLookbackSnap) ingest(pendingLookbackSnap, true);

    const lessons = Object.keys(byId).map((k) => byId[k]).sort((a, b) => {
      const am = a.startAtMs != null ? a.startAtMs : 0;
      const bm = b.startAtMs != null ? b.startAtMs : 0;
      return am - bm;
    }).slice(0, INSTRUCTOR_AGENDA_HARD_CAP);

    const out = {
      ok: true,
      tenantId: tenantId,
      dayStartMs: dayStartMs,
      windowEndMs: windowEndMs,
      lessons: lessons
    };
    if (weekMode) {
      out.weekStart = weekStartYmd;
      out.weekStartMs = windowStartMs;
      out.weekEndMs = windowEndMs;
    }
    return out;
  }
);

/**
 * Phase 2C-3C — Instructor responds to a pending driving lesson assignment.
 * confirm | consultation only.
 */
exports.respondDrivingLessonForInstructor = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const lessonId = (data && data.lessonId ? String(data.lessonId) : '').trim();
    const action = normalizeRole(data && data.action != null ? data.action : '');
    const noteRaw = data && data.note != null ? String(data.note) : '';

    if (!lessonId) {
      throw new HttpsError('invalid-argument', 'lessonId is required.');
    }
    if (action !== 'confirm' && action !== 'consultation') {
      throw new HttpsError('invalid-argument', 'action must be confirm or consultation.');
    }

    let note = '';
    if (action === 'consultation') {
      note = String(noteRaw || '').trim().replace(/\s+/g, ' ');
      if (note.length > 300) {
        throw new HttpsError('invalid-argument', 'İstişare notu en fazla 300 karakter olabilir.');
      }
    }

    const lessonRef = db.collection('drivingLessons').doc(lessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) {
      throw new HttpsError('not-found', 'Driving lesson not found.');
    }
    const lesson = lessonSnap.data() || {};
    const tenantId = String(lesson.tenantId || '').trim();
    if (!tenantId) {
      throw new HttpsError('failed-precondition', 'Lesson tenant is missing.');
    }

    await assertActiveInstructorForTenant(callerUid, tenantId);

    if (String(lesson.instructorUid || '').trim() !== callerUid) {
      throw new HttpsError('permission-denied', 'This lesson is not assigned to you.');
    }

    const specialRequestId = String(lesson.specialLessonRequestId || '').trim();
    const isSpecialLesson = isSpecialDrivingLessonDoc(lesson) && !!specialRequestId;

    if (isSpecialLesson) {
      const status = normalizeRole(lesson.status);
      if (status === 'cancelled') {
        throw new HttpsError('failed-precondition', 'Cancelled lessons cannot be answered.');
      }
      if (status === 'completed') {
        throw new HttpsError('failed-precondition', 'Completed lessons cannot be answered.');
      }
      if (status === 'confirmed' || status === 'pending_admin') {
        throw new HttpsError('failed-precondition', 'Lesson is already confirmed.');
      }
      if (status === 'consultation_requested') {
        throw new HttpsError('failed-precondition', 'Consultation was already requested.');
      }
      if (status !== 'pending_instructor') {
        throw new HttpsError('failed-precondition', 'Lesson cannot be answered in its current status.');
      }

      const requestRef = db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION).doc(specialRequestId);
      const now = admin.firestore.FieldValue.serverTimestamp();
      // Sequential: instructor confirm always waits for institution admin (never jumps to confirmed).
      let nextLessonStatus = action === 'confirm' ? 'pending_admin' : 'consultation_requested';
      let outRequestStatus = 'waiting';
      let outInstructorDecision = action === 'confirm' ? 'approved' : 'consultation';

      try {
        await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(lessonRef);
          if (!freshSnap.exists) {
            throw new HttpsError('not-found', 'Driving lesson not found.');
          }
          const fresh = freshSnap.data() || {};
          if (String(fresh.tenantId || '').trim() !== tenantId) {
            throw new HttpsError('permission-denied', 'Lesson tenant mismatch.');
          }
          if (String(fresh.instructorUid || '').trim() !== callerUid) {
            throw new HttpsError('permission-denied', 'This lesson is not assigned to you.');
          }
          if (!isSpecialDrivingLessonDoc(fresh)) {
            throw new HttpsError('failed-precondition', 'Lesson source mismatch.');
          }
          if (String(fresh.specialLessonRequestId || '').trim() !== specialRequestId) {
            throw new HttpsError('failed-precondition', 'Special lesson link mismatch.');
          }
          const freshStatus = normalizeRole(fresh.status);
          if (freshStatus !== 'pending_instructor') {
            if (freshStatus === 'confirmed' || freshStatus === 'pending_admin') {
              throw new HttpsError('failed-precondition', 'Lesson is already confirmed.');
            }
            if (freshStatus === 'consultation_requested') {
              throw new HttpsError('failed-precondition', 'Consultation was already requested.');
            }
            if (freshStatus === 'completed') {
              throw new HttpsError('failed-precondition', 'Completed lessons cannot be answered.');
            }
            if (freshStatus === 'cancelled') {
              throw new HttpsError('failed-precondition', 'Cancelled lessons cannot be answered.');
            }
            throw new HttpsError('failed-precondition', 'Lesson cannot be answered in its current status.');
          }

          const reqSnap = await tx.get(requestRef);
          if (!reqSnap.exists) {
            throw new HttpsError('not-found', 'Özel ders talebi bulunamadı.');
          }
          const req = reqSnap.data() || {};
          if (String(req.tenantId || '').trim() !== tenantId) {
            throw new HttpsError('permission-denied', 'Special request tenant mismatch.');
          }
          const reqStatus = deriveSpecialRequestStatus(req);
          if (reqStatus === 'rejected' || normalizeRole(req.adminDecision) === 'rejected') {
            throw new HttpsError('failed-precondition', 'Reddedilmiş özel ders talebi yanıtlanamaz.');
          }
          if (reqStatus === 'cancelled') {
            throw new HttpsError('failed-precondition', 'İptal edilmiş özel ders talebi yanıtlanamaz.');
          }

          outRequestStatus = 'waiting';
          outInstructorDecision = action === 'confirm' ? 'approved' : 'consultation';
          nextLessonStatus = action === 'confirm' ? 'pending_admin' : 'consultation_requested';

          const lessonPatch = {
            status: nextLessonStatus,
            updatedAt: now,
            instructorRespondedAt: now,
            instructorResponseAction: action,
            source: SPECIAL_LESSON_DRIVING_SOURCE,
            specialLessonRequestId: specialRequestId
          };
          if (action === 'consultation') {
            if (note) lessonPatch.instructorResponseNote = note;
            else lessonPatch.instructorResponseNote = admin.firestore.FieldValue.delete();
          } else {
            lessonPatch.instructorResponseNote = admin.firestore.FieldValue.delete();
          }
          tx.update(lessonRef, lessonPatch);

          const reqPatch = {
            instructorDecision: outInstructorDecision,
            adminDecision: 'pending',
            instructorRespondedAt: now,
            updatedAt: now,
            status: outRequestStatus,
            drivingLessonId: lessonId
          };
          if (action === 'consultation') {
            if (note) reqPatch.instructorResponseNote = note;
            else reqPatch.instructorResponseNote = admin.firestore.FieldValue.delete();
          } else {
            reqPatch.instructorResponseNote = admin.firestore.FieldValue.delete();
          }
          tx.set(requestRef, reqPatch, { merge: true });
        });
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new HttpsError(
          'internal',
          (e && e.message) ? e.message : 'Failed to respond to special driving lesson.'
        );
      }

      const respondAdminUids = await listActiveInstitutionAdminUidsForTenant(tenantId);
      const respondInstructorName = drivingLessonNotificationDisplayName(lesson);
      const respondType = action === 'confirm' ? 'lesson_confirmed' : 'lesson_consultation';
      const respondTitle = action === 'confirm'
        ? 'Usta Öğretici Özel Ders Talebini Onayladı'
        : 'Özel Ders İstişare Talebi';
      const respondPreview = action === 'confirm'
        ? (respondInstructorName
          + ' özel ders talebini onayladı. Kurum yönetimi onayı bekleniyor.')
        : (respondInstructorName + ' özel ders talebi için istişare gönderdi.');
      const respondStartMs = drivingLessonNotificationStartMs(lesson);
      await writeDrivingLessonNotificationDocs(respondAdminUids.map((adminUid) =>
        buildInstructorDrivingLessonNotification({
          type: respondType,
          tenantId: tenantId,
          recipientUid: adminUid,
          recipientRole: 'institution_admin',
          actorUid: callerUid,
          actorRole: 'instructor',
          lessonId: lessonId,
          instructorUid: callerUid,
          studentUid: String(lesson.studentUid || '').trim(),
          studentName: String(lesson.studentNameSnap || '').trim(),
          title: respondTitle,
          preview: respondPreview,
          agendaWeekStart: formatDrivingLessonAgendaWeekStartYmd(respondStartMs)
        })
      ));

      return {
        ok: true,
        lessonId: lessonId,
        tenantId: tenantId,
        status: nextLessonStatus,
        action: action,
        specialLessonRequestId: specialRequestId,
        requestStatus: outRequestStatus,
        instructorDecision: outInstructorDecision
      };
    }

    const status = normalizeRole(lesson.status);
    if (status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Cancelled lessons cannot be answered.');
    }
    if (status === 'completed') {
      throw new HttpsError('failed-precondition', 'Completed lessons cannot be answered.');
    }
    if (status === 'confirmed') {
      throw new HttpsError('failed-precondition', 'Lesson is already confirmed.');
    }
    if (status === 'consultation_requested') {
      throw new HttpsError('failed-precondition', 'Consultation was already requested.');
    }
    if (status !== 'pending_instructor') {
      throw new HttpsError('failed-precondition', 'Lesson cannot be answered in its current status.');
    }

    const nextStatus = action === 'confirm' ? 'confirmed' : 'consultation_requested';
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(lessonRef);
        if (!freshSnap.exists) {
          throw new HttpsError('not-found', 'Driving lesson not found.');
        }
        const fresh = freshSnap.data() || {};
        if (String(fresh.tenantId || '').trim() !== tenantId) {
          throw new HttpsError('permission-denied', 'Lesson tenant mismatch.');
        }
        if (String(fresh.instructorUid || '').trim() !== callerUid) {
          throw new HttpsError('permission-denied', 'This lesson is not assigned to you.');
        }
        const freshStatus = normalizeRole(fresh.status);
        if (freshStatus !== 'pending_instructor') {
          if (freshStatus === 'confirmed') {
            throw new HttpsError('failed-precondition', 'Lesson is already confirmed.');
          }
          if (freshStatus === 'consultation_requested') {
            throw new HttpsError('failed-precondition', 'Consultation was already requested.');
          }
          if (freshStatus === 'completed') {
            throw new HttpsError('failed-precondition', 'Completed lessons cannot be answered.');
          }
          if (freshStatus === 'cancelled') {
            throw new HttpsError('failed-precondition', 'Cancelled lessons cannot be answered.');
          }
          throw new HttpsError('failed-precondition', 'Lesson cannot be answered in its current status.');
        }

        const patch = {
          status: nextStatus,
          updatedAt: now,
          instructorRespondedAt: now,
          instructorResponseAction: action
        };
        if (action === 'consultation') {
          if (note) patch.instructorResponseNote = note;
          else patch.instructorResponseNote = admin.firestore.FieldValue.delete();
        } else {
          patch.instructorResponseNote = admin.firestore.FieldValue.delete();
        }
        tx.update(lessonRef, patch);
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to respond to driving lesson.'
      );
    }

    const respondAdminUids = await listActiveInstitutionAdminUidsForTenant(tenantId);
    const respondInstructorName = drivingLessonNotificationDisplayName(lesson);
    const respondType = action === 'confirm' ? 'lesson_confirmed' : 'lesson_consultation';
    const respondTitle = action === 'confirm' ? 'Direksiyon Dersi Onaylandı' : 'İstişare Talebi';
    const respondPreview = action === 'confirm'
      ? (respondInstructorName + ' direksiyon dersini onayladı.')
      : (respondInstructorName + ' direksiyon dersi için istişare talebi gönderdi.');
    const respondStartMs = drivingLessonNotificationStartMs(lesson);
    await writeDrivingLessonNotificationDocs(respondAdminUids.map((adminUid) =>
      buildInstructorDrivingLessonNotification({
        type: respondType,
        tenantId: tenantId,
        recipientUid: adminUid,
        recipientRole: 'institution_admin',
        actorUid: callerUid,
        actorRole: 'instructor',
        lessonId: lessonId,
        instructorUid: callerUid,
        studentUid: String(lesson.studentUid || '').trim(),
        studentName: String(lesson.studentNameSnap || '').trim(),
        title: respondTitle,
        preview: respondPreview,
        agendaWeekStart: formatDrivingLessonAgendaWeekStartYmd(respondStartMs)
      })
    ));

    return {
      ok: true,
      lessonId: lessonId,
      tenantId: tenantId,
      status: nextStatus,
      action: action
    };
  }
);

/**
 * Canonical driving-lesson end as epoch ms.
 * Prefer persisted endAt; otherwise startAt + (durationMinutes || 120).
 * @param {object} lesson
 * @returns {number|null}
 */
function resolveCanonicalDrivingLessonEndMs(lesson) {
  const d = lesson || {};
  const endMs = membershipExpiryToMillis(d.endAt);
  if (endMs != null) return endMs;
  const startMs = membershipExpiryToMillis(d.startAt);
  if (startMs == null) return null;
  const durationRaw = Number(d.durationMinutes);
  const durationMinutes = (Number.isFinite(durationRaw) && durationRaw > 0)
    ? durationRaw
    : DRIVING_LESSON_DURATION_MINUTES_V1;
  return startMs + (durationMinutes * 60 * 1000);
}

/**
 * Instructor completes a confirmed driving lesson after canonical end time.
 * confirmed → completed. Idempotent if already completed.
 */
exports.completeDrivingLessonForInstructor = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const lessonId = (data && data.lessonId ? String(data.lessonId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!lessonId) {
      throw new HttpsError('invalid-argument', 'lessonId is required.');
    }

    await assertActiveInstructorForTenant(callerUid, tenantId);

    const lessonRef = db.collection('drivingLessons').doc(lessonId);
    let alreadyCompleted = false;
    let completedLesson = null;

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(lessonRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Driving lesson not found.');
        }
        const lesson = snap.data() || {};
        completedLesson = lesson;
        if (String(lesson.tenantId || '').trim() !== tenantId) {
          throw new HttpsError('permission-denied', 'Lesson does not belong to this tenant.');
        }
        if (String(lesson.instructorUid || '').trim() !== callerUid) {
          throw new HttpsError('permission-denied', 'This lesson is not assigned to you.');
        }

        const status = normalizeRole(lesson.status);
        if (status === 'completed') {
          alreadyCompleted = true;
          return;
        }
        if (status === 'pending_instructor') {
          throw new HttpsError('failed-precondition', 'Pending lessons cannot be completed.');
        }
        if (status === 'consultation_requested') {
          throw new HttpsError('failed-precondition', 'Consultation lessons cannot be completed.');
        }
        if (status === 'cancelled') {
          throw new HttpsError('failed-precondition', 'Cancelled lessons cannot be completed.');
        }
        if (status !== 'confirmed') {
          throw new HttpsError('failed-precondition', 'Lesson cannot be completed in its current status.');
        }

        const endMs = resolveCanonicalDrivingLessonEndMs(lesson);
        if (endMs == null) {
          throw new HttpsError('failed-precondition', 'Lesson end time is missing.');
        }
        const serverNowMs = Date.now();
        if (!(serverNowMs >= endMs)) {
          throw new HttpsError('failed-precondition', 'Lesson cannot be completed before it ends.');
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        tx.update(lessonRef, {
          status: 'completed',
          completedAt: now,
          completedBy: callerUid,
          updatedAt: now
        });
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to complete driving lesson.'
      );
    }

    if (!alreadyCompleted) {
      const completeAdminUids = await listActiveInstitutionAdminUidsForTenant(tenantId);
      const completeInstructorName = drivingLessonNotificationDisplayName(completedLesson);
      const completeStartMs = drivingLessonNotificationStartMs(completedLesson);
      await writeDrivingLessonNotificationDocs(completeAdminUids.map((adminUid) =>
        buildInstructorDrivingLessonNotification({
          type: 'lesson_completed',
          tenantId: tenantId,
          recipientUid: adminUid,
          recipientRole: 'institution_admin',
          actorUid: callerUid,
          actorRole: 'instructor',
          lessonId: lessonId,
          instructorUid: callerUid,
          studentUid: String((completedLesson && completedLesson.studentUid) || '').trim(),
          studentName: String((completedLesson && completedLesson.studentNameSnap) || '').trim(),
          title: 'Direksiyon Dersi Tamamlandı',
          preview: completeInstructorName + ' dersi tamamlandı olarak işaretledi.',
          agendaWeekStart: formatDrivingLessonAgendaWeekStartYmd(completeStartMs)
        })
      ));
    }

    return {
      ok: true,
      lessonId: lessonId,
      tenantId: tenantId,
      status: 'completed',
      alreadyCompleted: alreadyCompleted
    };
  }
);

const DRIVING_LESSON_MANAGEMENT_ACK_TYPES = {
  lesson_assigned: true,
  lesson_confirmed: true,
  lesson_consultation: true,
  lesson_completed: true
};

/**
 * N1 — Mark all institution_admin fan-out unread docs for one lesson as
 * management-acknowledged (elevated business_owner / manager only).
 */
exports.acknowledgeDrivingLessonManagementNotifications = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const lessonId = (data && data.lessonId ? String(data.lessonId) : '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    if (!lessonId) throw new HttpsError('invalid-argument', 'lessonId is required.');

    const authCtx = await assertActiveInstitutionAdminForTenant(callerUid, tenantId);
    const adminPosition = assertElevatedInstitutionAdminPosition(authCtx && authCtx.userData);

    const lessonSnap = await db.collection('drivingLessons').doc(lessonId).get();
    if (!lessonSnap.exists) {
      throw new HttpsError('not-found', 'Driving lesson not found.');
    }
    const lesson = lessonSnap.data() || {};
    if (String(lesson.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Lesson does not belong to this tenant.');
    }

    const snap = await db.collection(DRIVING_LESSON_NOTIFICATIONS_COLLECTION)
      .where('tenantId', '==', tenantId)
      .get();

    const matching = [];
    (snap.docs || []).forEach((docSnap) => {
      const d = docSnap.data() || {};
      if (normalizeRole(d.recipientRole) !== 'institution_admin') return;
      if (String(d.recipientUid || '').trim() !== callerUid) return;
      if (String(d.lessonId || '').trim() !== lessonId) return;
      if (d.unread !== true) return;
      const type = String(d.type || '').trim();
      if (!DRIVING_LESSON_MANAGEMENT_ACK_TYPES[type]) return;
      matching.push(docSnap.ref);
    });

    if (!matching.length) {
      return {
        ok: true,
        tenantId: tenantId,
        lessonId: lessonId,
        acknowledgedCount: 0
      };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const WRITE_CHUNK = 400;
    let acknowledgedCount = 0;
    for (let i = 0; i < matching.length; i += WRITE_CHUNK) {
      const chunk = matching.slice(i, i + WRITE_CHUNK);
      const batch = db.batch();
      chunk.forEach((ref) => {
        batch.update(ref, {
          unread: false,
          readAt: now,
          acknowledgedAt: now,
          acknowledgedByUid: callerUid,
          acknowledgedByAdminPosition: adminPosition
        });
      });
      await batch.commit();
      acknowledgedCount += chunk.length;
    }

    return {
      ok: true,
      tenantId: tenantId,
      lessonId: lessonId,
      acknowledgedCount: acknowledgedCount
    };
  }
);

/**
 * N1 — Propagate historical per-admin read evidence across sibling fan-out docs.
 * Only groups with at least one already-read/acked sibling are cleared.
 */
exports.reconcileDrivingLessonManagementNotificationAcks = onCall(
  { region: 'us-central1' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');

    const authCtx = await assertActiveInstitutionAdminForTenant(callerUid, tenantId);
    const adminPosition = assertElevatedInstitutionAdminPosition(authCtx && authCtx.userData);

    const snap = await db.collection(DRIVING_LESSON_NOTIFICATIONS_COLLECTION)
      .where('tenantId', '==', tenantId)
      .get();

    const groups = Object.create(null);
    let unresolvedMissingLessonIdCount = 0;

    (snap.docs || []).forEach((docSnap) => {
      const d = docSnap.data() || {};
      if (normalizeRole(d.recipientRole) !== 'institution_admin') return;
      if (String(d.recipientUid || '').trim() !== callerUid) return;
      const type = String(d.type || '').trim();
      if (!DRIVING_LESSON_MANAGEMENT_ACK_TYPES[type]) return;
      const lessonId = String(d.lessonId || '').trim();
      if (!lessonId) {
        unresolvedMissingLessonIdCount += 1;
        return;
      }
      const key = lessonId + '\0' + type;
      if (!groups[key]) {
        groups[key] = {
          lessonId: lessonId,
          type: type,
          docs: []
        };
      }
      groups[key].docs.push({
        ref: docSnap.ref,
        unread: d.unread === true,
        hasReadEvidence: (
          d.unread === false
          || !!(d.readAt)
          || !!(d.acknowledgedAt)
        )
      });
    });

    const toAck = [];
    let groupsWithEvidence = 0;
    let groupsWithoutEvidence = 0;

    Object.keys(groups).forEach((key) => {
      const group = groups[key];
      const hasEvidence = (group.docs || []).some((row) => row.hasReadEvidence);
      if (!hasEvidence) {
        groupsWithoutEvidence += 1;
        return;
      }
      groupsWithEvidence += 1;
      (group.docs || []).forEach((row) => {
        if (row.unread === true) toAck.push(row.ref);
      });
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const WRITE_CHUNK = 400;
    let reconciledCount = 0;
    for (let i = 0; i < toAck.length; i += WRITE_CHUNK) {
      const chunk = toAck.slice(i, i + WRITE_CHUNK);
      const batch = db.batch();
      chunk.forEach((ref) => {
        batch.update(ref, {
          unread: false,
          readAt: now,
          acknowledgedAt: now,
          acknowledgedByUid: callerUid,
          acknowledgedByAdminPosition: adminPosition
        });
      });
      await batch.commit();
      reconciledCount += chunk.length;
    }

    return {
      ok: true,
      tenantId: tenantId,
      reconciledCount: reconciledCount,
      groupsWithEvidence: groupsWithEvidence,
      groupsWithoutEvidence: groupsWithoutEvidence,
      unresolvedMissingLessonIdCount: unresolvedMissingLessonIdCount
    };
  }
);

const INSTRUCTOR_ROOM_TYPE = 'instructor_group';
const INSTRUCTOR_ROOM_TEXT_MAX = 1500;
const INSTRUCTOR_ROOM_REPLY_SNIPPET_MAX = 160;
const INSTRUCTOR_ROOM_DELETED_PREVIEW = 'Bu mesaj silindi.';
const INSTRUCTOR_ROOM_ALLOWED_ROLES = {
  institution_admin: true,
  instructor: true
};

const ADMIN_POSITION_VALUES = {
  professional_staff: true,
  manager: true,
  business_owner: true
};

const ADMIN_POSITION_LABELS = {
  professional_staff: 'Mesleki Personel',
  manager: 'Yönetici',
  business_owner: 'İşletme Sahibi'
};

function normalizeAdminPosition(value) {
  return String(value || '').trim().toLowerCase();
}

function isElevatedInstitutionAdminPosition(position) {
  const p = normalizeAdminPosition(position);
  return p === 'manager' || p === 'business_owner';
}

function assertElevatedInstitutionAdminPosition(userData) {
  const position = normalizeAdminPosition(userData && userData.adminPosition);
  if (!isElevatedInstitutionAdminPosition(position)) {
    throw new HttpsError(
      'permission-denied',
      'Bu işlem yalnız Yönetici veya İşletme Sahibi statüsündeki kurum yöneticileri tarafından yapılabilir.'
    );
  }
  return position;
}

function parseRequiredAdminPosition(value) {
  const position = normalizeAdminPosition(value);
  if (!ADMIN_POSITION_VALUES[position]) {
    throw new HttpsError('invalid-argument', 'Geçerli bir yönetici statüsü seçin.');
  }
  return position;
}

function adminPositionLabel(value) {
  const position = normalizeAdminPosition(value);
  return ADMIN_POSITION_LABELS[position] || '';
}

/**
 * Returns true if at least one OTHER active same-tenant institution_admin
 * has elevated adminPosition (manager | business_owner).
 */
async function hasOtherElevatedInstitutionAdminInTenant(tenantId, excludeUid) {
  const tid = String(tenantId || '').trim();
  const exclude = String(excludeUid || '').trim();
  if (!tid) return false;

  const memSnap = await db.collection('tenantMemberships')
    .where('tenantId', '==', tid)
    .where('role', '==', 'institution_admin')
    .get();

  const candidateUids = [];
  (memSnap.docs || []).forEach((docSnap) => {
    const m = docSnap.data() || {};
    const uid = String(m.uid || '').trim();
    if (!uid || uid === exclude) return;
    if (normalizeRole(m.status) !== 'active') return;
    const memTenantId = String(m.tenantId || '').trim();
    if (memTenantId && memTenantId !== tid) return;
    candidateUids.push(uid);
  });

  for (const uid of candidateUids) {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) continue;
    const userData = userSnap.data() || {};
    if (normalizeRole(userData.role) !== 'institution_admin') continue;
    if (isElevatedInstitutionAdminPosition(userData.adminPosition)) {
      return true;
    }
  }
  return false;
}

function hasReliableInstructorRoomPersonName(userData) {
  const d = userData && typeof userData === 'object' ? userData : {};
  return !!(
    String(d.fullName || '').trim()
    || String(d.displayName || '').trim()
    || String(d.username || '').trim()
  );
}

function isLegacyInstitutionAdminBootstrapEligible(userData) {
  const d = userData && typeof userData === 'object' ? userData : {};
  const existingPos = normalizeAdminPosition(d.adminPosition);
  if (ADMIN_POSITION_VALUES[existingPos]) return false;
  const createdBy = String(d.createdBy || '').trim();
  return !createdBy;
}

function resolveInstructorRoomPersonName(userData, uid, role) {
  const d = userData && typeof userData === 'object' ? userData : {};
  const fullName = String(d.fullName || '').trim().replace(/\s+/g, ' ');
  if (fullName) return fullName.slice(0, 200);
  const displayName = String(d.displayName || '').trim().replace(/\s+/g, ' ');
  if (displayName) return displayName.slice(0, 200);
  const username = String(d.username || '').trim();
  if (username) return username.slice(0, 80);
  if (normalizeRole(role) === 'institution_admin') return 'Kurum Yöneticisi';
  if (normalizeRole(role) === 'instructor') return 'Usta Öğretici';
  const fallbackUid = String(uid || '').trim();
  return fallbackUid ? ('Kullanıcı ' + fallbackUid.slice(0, 8)) : 'Kullanıcı';
}

function resolveInstructorRoomSenderName(userData, uid, role) {
  if (normalizeRole(role) !== 'institution_admin') {
    return resolveInstructorRoomPersonName(userData, uid, role);
  }

  const positionLabel = adminPositionLabel((userData && userData.adminPosition) || '');
  const personName = resolveInstructorRoomPersonName(userData, uid, role);
  // ROOM-B1.6-A UI: Person (Position), e.g. "Sefa Dere (Mesleki Personel)"
  if (positionLabel) {
    return (personName + ' (' + positionLabel + ')').slice(0, 240);
  }
  if (hasReliableInstructorRoomPersonName(userData)) {
    return (personName + ' (Kurum Yöneticisi)').slice(0, 240);
  }
  return 'Kurum Yöneticisi';
}

function normalizeInstructorRoomReplySnippet(value, maxLength) {
  const max = (typeof maxLength === 'number' && maxLength > 0)
    ? maxLength
    : INSTRUCTOR_ROOM_REPLY_SNIPPET_MAX;
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max);
}

async function assertActiveInstructorRoomParticipant(callerUid, tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }
  const membershipId = callerUid + '_' + tid;
  const [membershipSnap, userSnap] = await Promise.all([
    db.collection('tenantMemberships').doc(membershipId).get(),
    db.collection('users').doc(callerUid).get()
  ]);

  if (!membershipSnap.exists) {
    throw new HttpsError('permission-denied', 'Not an active room participant for this tenant.');
  }
  const membership = membershipSnap.data() || {};
  const membershipTenantId = String(membership.tenantId || '').trim();
  if (membershipTenantId && membershipTenantId !== tid) {
    throw new HttpsError('permission-denied', 'Not an active room participant for this tenant.');
  }
  if (normalizeRole(membership.status) !== 'active') {
    throw new HttpsError('failed-precondition', 'Membership is not active.');
  }
  const membershipRole = normalizeRole(membership.role);
  if (!INSTRUCTOR_ROOM_ALLOWED_ROLES[membershipRole]) {
    throw new HttpsError('permission-denied', 'Not an active room participant for this tenant.');
  }
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile could not be verified.');
  }
  const userData = userSnap.data() || {};
  const userRole = normalizeRole(userData.role);
  if (!userRole || userRole !== membershipRole) {
    throw new HttpsError('permission-denied', 'Account role could not be verified.');
  }
  if (userRole === 'student' || userRole === 'machine_operator' || userRole === 'public_user') {
    throw new HttpsError('permission-denied', 'Not an active room participant for this tenant.');
  }
  return {
    tenantId: tid,
    membership: membership,
    membershipRole: membershipRole,
    userData: userData
  };
}

function resolveInstructorRoomHistoryGeneration(roomData) {
  const n = Number(roomData && roomData.historyGeneration);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function resolveInstructorRoomReplyMetadata(roomRef, tenantId, replyToMessageId) {
  const sourceSnap = await roomRef.collection('messages').doc(replyToMessageId).get();
  if (!sourceSnap.exists) {
    throw new HttpsError('not-found', 'Yanıtlanmak istenen mesaj bulunamadı.');
  }
  const source = sourceSnap.data() || {};
  const sourceTenantId = String(source.tenantId || '').trim();
  if (sourceTenantId && sourceTenantId !== tenantId) {
    throw new HttpsError('permission-denied', 'Yanıtlanmak istenen mesaj bu odaya ait değil.');
  }
  if (source.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'Yanıtlanmak istenen mesaj artık kullanılamıyor.');
  }
  const sourceText = (typeof source.text === 'string') ? source.text : '';
  return {
    replyToMessageId: replyToMessageId,
    replyToSenderUid: String(source.senderUid || '').trim(),
    replyToSenderName: String(source.senderName || '').trim() || 'Kullanıcı',
    replyToTextSnippet: normalizeInstructorRoomReplySnippet(
      sourceText,
      INSTRUCTOR_ROOM_REPLY_SNIPPET_MAX
    )
  };
}

function parseOptionalInstructorRoomReplyToMessageId(data) {
  if (!data || data.replyToMessageId == null || data.replyToMessageId === undefined) {
    return '';
  }
  if (typeof data.replyToMessageId !== 'string') {
    throw new HttpsError('invalid-argument', 'replyToMessageId must be a string.');
  }
  return data.replyToMessageId.trim();
}

/**
 * ROOM-P1 — Directory caption for Room participants (display-only; no presence).
 * instructor → Usta Öğretici
 * IA professional_staff → Mesleki Personel
 * IA manager / business_owner / legacy → Kurum Yönetimi
 */
function resolveInstructorRoomDirectoryRoleCaption(role, adminPosition) {
  const r = normalizeRole(role);
  if (r === 'instructor') return 'Usta Öğretici';
  if (r === 'institution_admin') {
    const pos = normalizeAdminPosition(adminPosition);
    if (pos === 'professional_staff') return 'Mesleki Personel';
    return 'Kurum Yönetimi';
  }
  return '';
}

function resolveInstructorRoomDirectoryPhotoUrl(userData) {
  const d = userData && typeof userData === 'object' ? userData : {};
  const photoUrl = String(d.photoUrl || d.photoURL || '').trim();
  return photoUrl || '';
}

/**
 * ROOM-P1 — List active Room participants for Kullanıcılar / Kişiler directory.
 * Auth: assertActiveInstructorRoomParticipant (IA any position OR instructor).
 * Returns minimal identity only: uid, displayName, senderRole, roleCaption, photoUrl.
 */
exports.listTenantInstructorRoomParticipants = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const memSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .get();

    const eligible = [];
    (memSnap.docs || []).forEach((docSnap) => {
      const m = docSnap.data() || {};
      const memTenantId = String(m.tenantId || '').trim();
      if (memTenantId && memTenantId !== tenantId) return;
      if (normalizeRole(m.status) !== 'active') return;
      const membershipRole = normalizeRole(m.role);
      if (!INSTRUCTOR_ROOM_ALLOWED_ROLES[membershipRole]) return;
      const uid = String(m.uid || '').trim();
      if (!uid) return;
      eligible.push({ uid: uid, membershipRole: membershipRole });
    });

    const usersMap = {};
    for (const row of eligible) {
      if (usersMap[row.uid]) continue;
      const userSnap = await db.collection('users').doc(row.uid).get();
      if (userSnap.exists) usersMap[row.uid] = userSnap.data() || {};
    }

    const participants = [];
    eligible.forEach((row) => {
      const user = usersMap[row.uid] || {};
      const userRole = normalizeRole(user.role);
      if (!userRole || userRole !== row.membershipRole) return;
      if (userRole === 'student' || userRole === 'machine_operator' || userRole === 'public_user') return;

      participants.push({
        uid: row.uid,
        displayName: resolveInstructorRoomPersonName(user, row.uid, row.membershipRole),
        senderRole: row.membershipRole,
        roleCaption: resolveInstructorRoomDirectoryRoleCaption(
          row.membershipRole,
          user.adminPosition
        ),
        photoUrl: resolveInstructorRoomDirectoryPhotoUrl(user)
      });
    });

    participants.sort((a, b) =>
      String(a.displayName || '').localeCompare(String(b.displayName || ''), 'tr')
    );

    return {
      ok: true,
      tenantId: tenantId,
      participants: participants
    };
  }
);

/**
 * ROOM-B1 / ROOM-B1.6-A — Send text message (optional reply snapshot) to tenant instructor group room.
 * Auth: active same-tenant institution_admin OR instructor; users.role must agree.
 */
/**
 * Group send idempotent doc id — same sha256 + req_ pattern as private send.
 * Room scope = tenant instructor group (no otherUid); include roomType to avoid cross-surface key mixups.
 */
function buildRoomMessageIdempotentDocId(callerUid, tenantId, clientRequestId) {
  const digest = crypto
    .createHash('sha256')
    .update(
      [
        String(callerUid || ''),
        String(tenantId || ''),
        String(INSTRUCTOR_ROOM_TYPE || 'instructor_group'),
        String(clientRequestId || '')
      ].join('\n'),
      'utf8'
    )
    .digest('hex');
  return 'req_' + digest;
}

exports.sendTenantInstructorRoomMessage = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const textRaw = data && typeof data.text === 'string' ? data.text : null;
    // Reuse proven private clientRequestId validation (optional; legacy callers omit).
    const clientRequestId = parseOptionalPrivateMessageClientRequestId(data);

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (typeof textRaw !== 'string') {
      throw new HttpsError('invalid-argument', 'text must be a string.');
    }
    const text = textRaw.trim();
    if (!text) {
      throw new HttpsError('invalid-argument', 'text cannot be empty.');
    }
    if (text.length > INSTRUCTOR_ROOM_TEXT_MAX) {
      throw new HttpsError('invalid-argument', 'text must be 1500 characters or less.');
    }

    const authCtx = await assertActiveInstructorRoomParticipant(callerUid, tenantId);
    const membershipRole = authCtx.membershipRole;
    const userData = authCtx.userData;
    const replyToMessageId = parseOptionalInstructorRoomReplyToMessageId(data);

    const senderName = resolveInstructorRoomSenderName(
      userData,
      callerUid,
      membershipRole
    );
    const roomRef = db.collection('tenantInstructorRooms').doc(tenantId);
    const useIdempotentId = !!clientRequestId;
    const messageRef = useIdempotentId
      ? roomRef.collection('messages').doc(
          buildRoomMessageIdempotentDocId(callerUid, tenantId, clientRequestId)
        )
      : roomRef.collection('messages').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const preview = text.length > 180 ? text.slice(0, 180) : text;

    let replyMetadata = null;
    if (replyToMessageId) {
      try {
        replyMetadata = await resolveInstructorRoomReplyMetadata(roomRef, tenantId, replyToMessageId);
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error('[InstructorRoomReply] resolve failed', {
          code: e && e.code ? String(e.code) : null,
          message: e && e.message ? String(e.message) : String(e)
        });
        throw new HttpsError('internal', 'Mesaj gönderilemedi. Lütfen tekrar deneyin.');
      }
    }

    const messagePayload = {
      tenantId: tenantId,
      roomType: INSTRUCTOR_ROOM_TYPE,
      senderUid: callerUid,
      senderName: senderName,
      senderRole: membershipRole,
      messageType: 'text',
      text: text,
      createdAt: now,
      isDeleted: false
    };
    if (replyMetadata) {
      messagePayload.replyToMessageId = replyMetadata.replyToMessageId;
      messagePayload.replyToSenderUid = replyMetadata.replyToSenderUid;
      messagePayload.replyToSenderName = replyMetadata.replyToSenderName;
      messagePayload.replyToTextSnippet = replyMetadata.replyToTextSnippet;
    }
    if (useIdempotentId) {
      messagePayload.clientRequestId = clientRequestId;
    }

    let deduplicated = false;
    try {
      await db.runTransaction(async (tx) => {
        if (useIdempotentId) {
          const existingMessageSnap = await tx.get(messageRef);
          if (existingMessageSnap.exists) {
            const existingMsg = existingMessageSnap.data() || {};
            const existingSender = String(existingMsg.senderUid || '').trim();
            const existingTenant = String(existingMsg.tenantId || '').trim();
            const existingRoomType = String(existingMsg.roomType || '').trim();
            const existingReq = String(existingMsg.clientRequestId || '').trim();
            if (
              existingSender !== callerUid ||
              (existingTenant && existingTenant !== tenantId) ||
              (existingRoomType && existingRoomType !== INSTRUCTOR_ROOM_TYPE) ||
              (existingReq && existingReq !== clientRequestId)
            ) {
              throw new HttpsError('failed-precondition', 'Idempotent message collision.');
            }
            deduplicated = true;
            return;
          }
        }

        const roomSnap = await tx.get(roomRef);
        const roomData = roomSnap.exists ? (roomSnap.data() || {}) : {};
        const currentGeneration = resolveInstructorRoomHistoryGeneration(roomData);
        messagePayload.historyGeneration = currentGeneration;
        const roomUpdate = {
          tenantId: tenantId,
          roomType: INSTRUCTOR_ROOM_TYPE,
          updatedAt: now,
          lastMessageAt: now,
          lastMessageText: preview,
          lastMessageSenderUid: callerUid,
          lastMessageSenderName: senderName,
          lastMessageId: messageRef.id
        };
        if (!roomSnap.exists) {
          roomUpdate.createdAt = now;
        }
        tx.set(roomRef, roomUpdate, { merge: true });
        tx.set(messageRef, messagePayload);
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorRoomMessage] send failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e),
        tenantId: tenantId
      });
      throw new HttpsError('internal', 'Failed to send message.');
    }

    const result = {
      ok: true,
      tenantId: tenantId,
      messageId: messageRef.id,
      deduplicated: deduplicated
    };
    if (useIdempotentId) {
      result.clientRequestId = clientRequestId;
    }
    return result;
  }
);

/**
 * ROOM-B1.6-A — Edit own instructor-room message text.
 */
exports.editTenantInstructorRoomMessage = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const messageId = (data && data.messageId ? String(data.messageId) : '').trim();
    const textRaw = data && typeof data.text === 'string' ? data.text : null;

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!messageId) {
      throw new HttpsError('invalid-argument', 'messageId is required.');
    }
    if (typeof textRaw !== 'string') {
      throw new HttpsError('invalid-argument', 'text must be a string.');
    }
    const text = textRaw.trim();
    if (!text) {
      throw new HttpsError('invalid-argument', 'text cannot be empty.');
    }
    if (text.length > INSTRUCTOR_ROOM_TEXT_MAX) {
      throw new HttpsError('invalid-argument', 'text must be 1500 characters or less.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const roomRef = db.collection('tenantInstructorRooms').doc(tenantId);
    const msgRef = roomRef.collection('messages').doc(messageId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const preview = text.length > 180 ? text.slice(0, 180) : text;

    try {
      await db.runTransaction(async (tx) => {
        const msgSnap = await tx.get(msgRef);
        if (!msgSnap.exists) {
          throw new HttpsError('not-found', 'Message not found.');
        }
        const msgData = msgSnap.data() || {};
        if (String(msgData.senderUid || '').trim() !== callerUid) {
          throw new HttpsError('permission-denied', 'Bu mesajı düzenleme yetkiniz bulunmuyor.');
        }
        if (msgData.isDeleted === true) {
          throw new HttpsError('failed-precondition', 'Deleted messages cannot be edited.');
        }

        const roomSnap = await tx.get(roomRef);
        const roomData = roomSnap.exists ? (roomSnap.data() || {}) : {};
        const isLast = String(roomData.lastMessageId || '').trim() === messageId;

        tx.set(msgRef, {
          text: text,
          editedAt: now,
          editedBy: callerUid
        }, { merge: true });

        if (isLast) {
          tx.set(roomRef, {
            lastMessageText: preview,
            updatedAt: now
          }, { merge: true });
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorRoomEdit] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Mesaj düzenlenemedi. Lütfen tekrar deneyin.');
    }

    return { ok: true, tenantId: tenantId, messageId: messageId };
  }
);

/**
 * ROOM-B1.6-A — Soft-delete own instructor-room message. Original text preserved.
 */
exports.deleteTenantInstructorRoomMessage = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const messageId = (data && data.messageId ? String(data.messageId) : '').trim();

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!messageId) {
      throw new HttpsError('invalid-argument', 'messageId is required.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const roomRef = db.collection('tenantInstructorRooms').doc(tenantId);
    const msgRef = roomRef.collection('messages').doc(messageId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      await db.runTransaction(async (tx) => {
        const msgSnap = await tx.get(msgRef);
        if (!msgSnap.exists) {
          throw new HttpsError('not-found', 'Message not found.');
        }
        const msgData = msgSnap.data() || {};
        if (String(msgData.senderUid || '').trim() !== callerUid) {
          throw new HttpsError('permission-denied', 'Bu mesajı silme yetkiniz bulunmuyor.');
        }
        if (msgData.isDeleted === true) {
          return;
        }

        const roomSnap = await tx.get(roomRef);
        const roomData = roomSnap.exists ? (roomSnap.data() || {}) : {};
        const isLast = String(roomData.lastMessageId || '').trim() === messageId;

        tx.set(msgRef, {
          isDeleted: true,
          deletedAt: now,
          deletedBy: callerUid
        }, { merge: true });

        if (isLast) {
          tx.set(roomRef, {
            lastMessageText: INSTRUCTOR_ROOM_DELETED_PREVIEW,
            updatedAt: now
          }, { merge: true });
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorRoomDelete] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Mesaj silinemedi. Lütfen tekrar deneyin.');
    }

    return { ok: true, tenantId: tenantId, messageId: messageId };
  }
);

/**
 * ROOM-B1.6-B — Toggle like on another participant's non-deleted instructor-room message.
 * Writes likes/{uid} + cached message.likeCount via Admin SDK only.
 */
exports.toggleTenantInstructorRoomMessageLike = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const messageId = (data && data.messageId ? String(data.messageId) : '').trim();

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!messageId) {
      throw new HttpsError('invalid-argument', 'messageId is required.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const roomRef = db.collection('tenantInstructorRooms').doc(tenantId);
    const msgRef = roomRef.collection('messages').doc(messageId);
    const likeRef = msgRef.collection('likes').doc(callerUid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    let liked = false;
    let likeCount = 0;

    try {
      await db.runTransaction(async (tx) => {
        const msgSnap = await tx.get(msgRef);
        if (!msgSnap.exists) {
          throw new HttpsError('not-found', 'Mesaj bulunamadı.');
        }
        const msgData = msgSnap.data() || {};
        const msgTenantId = String(msgData.tenantId || '').trim();
        if (msgTenantId && msgTenantId !== tenantId) {
          throw new HttpsError('permission-denied', 'Bu mesajı beğenme yetkiniz bulunmuyor.');
        }
        if (msgData.isDeleted === true) {
          throw new HttpsError('failed-precondition', 'Silinmiş bir mesaj beğenilemez.');
        }
        const senderUid = String(msgData.senderUid || '').trim();
        if (senderUid && senderUid === callerUid) {
          throw new HttpsError('permission-denied', 'Kendi mesajınızı beğenemezsiniz.');
        }

        const likeSnap = await tx.get(likeRef);
        const currentCountRaw = Number(msgData.likeCount);
        const currentCount = Number.isFinite(currentCountRaw) ? Math.max(0, Math.floor(currentCountRaw)) : 0;

        if (likeSnap.exists) {
          likeCount = Math.max(0, currentCount - 1);
          liked = false;
          tx.delete(likeRef);
          tx.set(msgRef, { likeCount: likeCount }, { merge: true });
        } else {
          likeCount = currentCount + 1;
          liked = true;
          tx.set(likeRef, {
            uid: callerUid,
            createdAt: now
          });
          tx.set(msgRef, { likeCount: likeCount }, { merge: true });
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorRoomLike] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Beğeni güncellenemedi. Lütfen tekrar deneyin.');
    }

    return {
      ok: true,
      liked: liked,
      likeCount: likeCount
    };
  }
);

/**
 * DM1 — Toggle like on another participant's non-deleted private message.
 * Path: tenantInstructorPrivateThreads/{tenantId}/threads/{threadId}/messages/{messageId}/likes/{uid}
 * Writes likes/{uid} + cached message.likeCount via Admin SDK only.
 */
exports.toggleTenantInstructorPrivateMessageLike = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const threadId = (data && data.threadId ? String(data.threadId) : '').trim();
    const messageId = (data && data.messageId ? String(data.messageId) : '').trim();

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!threadId) {
      throw new HttpsError('invalid-argument', 'threadId is required.');
    }
    if (!messageId) {
      throw new HttpsError('invalid-argument', 'messageId is required.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const threadRef = privateThreadsRootRef(tenantId).doc(threadId);
    const msgRef = threadRef.collection('messages').doc(messageId);
    const likeRef = msgRef.collection('likes').doc(callerUid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    let liked = false;
    let likeCount = 0;

    try {
      await db.runTransaction(async (tx) => {
        const threadSnap = await tx.get(threadRef);
        if (!threadSnap.exists) {
          throw new HttpsError('not-found', 'Özel sohbet bulunamadı.');
        }
        const threadData = threadSnap.data() || {};
        const existingTenantId = String(threadData.tenantId || '').trim();
        if (existingTenantId && existingTenantId !== tenantId) {
          throw new HttpsError('permission-denied', 'Bu sohbet için erişim yetkiniz bulunmuyor.');
        }
        assertCallerIsPrivateThreadParticipant(threadData, callerUid);

        const msgSnap = await tx.get(msgRef);
        if (!msgSnap.exists) {
          throw new HttpsError('not-found', 'Mesaj bulunamadı.');
        }
        const msgData = msgSnap.data() || {};
        const msgTenantId = String(msgData.tenantId || '').trim();
        if (msgTenantId && msgTenantId !== tenantId) {
          throw new HttpsError('permission-denied', 'Bu mesajı beğenme yetkiniz bulunmuyor.');
        }
        const msgThreadId = String(msgData.threadId || '').trim();
        if (msgThreadId && msgThreadId !== threadId) {
          throw new HttpsError('permission-denied', 'Bu mesajı beğenme yetkiniz bulunmuyor.');
        }
        if (msgData.isDeleted === true) {
          throw new HttpsError('failed-precondition', 'Silinmiş bir mesaj beğenilemez.');
        }
        const senderUid = String(msgData.senderUid || '').trim();
        if (senderUid && senderUid === callerUid) {
          throw new HttpsError('permission-denied', 'Kendi mesajınızı beğenemezsiniz.');
        }

        const likeSnap = await tx.get(likeRef);
        const currentCountRaw = Number(msgData.likeCount);
        const currentCount = Number.isFinite(currentCountRaw) ? Math.max(0, Math.floor(currentCountRaw)) : 0;

        if (likeSnap.exists) {
          likeCount = Math.max(0, currentCount - 1);
          liked = false;
          tx.delete(likeRef);
          tx.set(msgRef, { likeCount: likeCount }, { merge: true });
        } else {
          likeCount = currentCount + 1;
          liked = true;
          tx.set(likeRef, {
            uid: callerUid,
            createdAt: now
          });
          tx.set(msgRef, { likeCount: likeCount }, { merge: true });
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorPrivateLike] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Beğeni güncellenemedi. Lütfen tekrar deneyin.');
    }

    return {
      ok: true,
      liked: liked,
      likeCount: likeCount
    };
  }
);

/**
 * ROOM-B1.6-C — Permanent purge of own soft-deleted instructor-room message.
 * Soft delete (deleteTenantInstructorRoomMessage) remains stage 1 and unchanged.
 * Recursively removes message + likes; rebuilds room last* when needed.
 */
exports.purgeTenantInstructorRoomMessage = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const messageId = (data && data.messageId ? String(data.messageId) : '').trim();

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!messageId) {
      throw new HttpsError('invalid-argument', 'messageId is required.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const roomRef = db.collection('tenantInstructorRooms').doc(tenantId);
    const msgRef = roomRef.collection('messages').doc(messageId);

    let wasLastMessage = false;

    try {
      const [msgSnap, roomSnap] = await Promise.all([
        msgRef.get(),
        roomRef.get()
      ]);

      if (!msgSnap.exists) {
        throw new HttpsError('not-found', 'Mesaj zaten kaldırılmış.');
      }

      const msgData = msgSnap.data() || {};
      const msgTenantId = String(msgData.tenantId || '').trim();
      if (msgTenantId && msgTenantId !== tenantId) {
        throw new HttpsError('permission-denied', 'Bu mesajı kalıcı olarak silme yetkiniz bulunmuyor.');
      }
      if (String(msgData.senderUid || '').trim() !== callerUid) {
        throw new HttpsError('permission-denied', 'Bu mesajı kalıcı olarak silme yetkiniz bulunmuyor.');
      }
      if (msgData.isDeleted !== true) {
        throw new HttpsError('failed-precondition', 'Önce mesajı silmeniz gerekir.');
      }

      const roomData = roomSnap.exists ? (roomSnap.data() || {}) : {};
      wasLastMessage = String(roomData.lastMessageId || '').trim() === messageId;

      await deleteDocRecursiveSafe(msgRef);

      if (wasLastMessage) {
        const now = admin.firestore.FieldValue.serverTimestamp();
        const newestSnap = await roomRef.collection('messages')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (!newestSnap || newestSnap.empty) {
          await roomRef.set({
            lastMessageId: admin.firestore.FieldValue.delete(),
            lastMessageAt: admin.firestore.FieldValue.delete(),
            lastMessageText: admin.firestore.FieldValue.delete(),
            lastMessageSenderUid: admin.firestore.FieldValue.delete(),
            lastMessageSenderName: admin.firestore.FieldValue.delete(),
            updatedAt: now
          }, { merge: true });
        } else {
          const newestDoc = newestSnap.docs[0];
          const newest = newestDoc.data() || {};
          const newestText = typeof newest.text === 'string' ? newest.text : '';
          const preview = newest.isDeleted === true
            ? INSTRUCTOR_ROOM_DELETED_PREVIEW
            : (newestText.length > 180 ? newestText.slice(0, 180) : newestText);

          await roomRef.set({
            lastMessageId: newestDoc.id,
            lastMessageAt: newest.createdAt || now,
            lastMessageText: preview,
            lastMessageSenderUid: String(newest.senderUid || '').trim(),
            lastMessageSenderName: String(newest.senderName || '').trim() || 'Kullanıcı',
            updatedAt: now
          }, { merge: true });
        }
      }
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorRoomPurge] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Mesaj kalıcı olarak silinemedi. Lütfen tekrar deneyin.');
    }

    return {
      ok: true,
      tenantId: tenantId,
      messageId: messageId,
      purged: true
    };
  }
);

/**
 * Group Room — local-only history clear for the current participant.
 * Writes memberState/{uid}.historyClearedAt; does not modify shared messages.
 */
exports.clearTenantInstructorRoomHistoryForSelf = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const memberStateRef = db.collection('tenantInstructorRooms').doc(tenantId)
      .collection('memberState').doc(callerUid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      await memberStateRef.set({
        uid: callerUid,
        historyClearedAt: now,
        updatedAt: now
      }, { merge: true });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorRoomClearSelf] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e),
        tenantId: tenantId
      });
      throw new HttpsError('internal', 'Sohbet geçmişi temizlenemedi. Lütfen tekrar deneyin.');
    }

    return { ok: true, tenantId: tenantId };
  }
);

/**
 * Group Room — all-parties history clear (elevated institution_admin only).
 * Increments room.historyGeneration and resets lastMessage* preview fields.
 * Does not delete message docs, likes, presence, or memberState.
 */
exports.clearTenantInstructorRoomHistoryForAll = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    const authCtx = await assertActiveInstructorRoomParticipant(callerUid, tenantId);
    if (normalizeRole(authCtx && authCtx.membershipRole) !== 'institution_admin') {
      throw new HttpsError(
        'permission-denied',
        'Bu işlem yalnız Yönetici veya İşletme Sahibi statüsündeki kurum yöneticileri tarafından yapılabilir.'
      );
    }
    assertElevatedInstitutionAdminPosition(authCtx && authCtx.userData);

    const roomRef = db.collection('tenantInstructorRooms').doc(tenantId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const del = admin.firestore.FieldValue.delete();

    try {
      await db.runTransaction(async (tx) => {
        const roomSnap = await tx.get(roomRef);
        const roomData = roomSnap.exists ? (roomSnap.data() || {}) : {};
        const previousGeneration = resolveInstructorRoomHistoryGeneration(roomData);
        const nextGeneration = previousGeneration + 1;
        const roomUpdate = {
          tenantId: tenantId,
          roomType: INSTRUCTOR_ROOM_TYPE,
          historyGeneration: nextGeneration,
          historyClearedAt: now,
          historyClearedByUid: callerUid,
          updatedAt: now,
          lastMessageId: del,
          lastMessageAt: del,
          lastMessageText: del,
          lastMessageSenderUid: del,
          lastMessageSenderName: del
        };
        if (!roomSnap.exists) {
          roomUpdate.createdAt = now;
        }
        tx.set(roomRef, roomUpdate, { merge: true });
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorRoomClearAll] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e),
        tenantId: tenantId
      });
      throw new HttpsError('internal', 'Sohbet geçmişi temizlenemedi. Lütfen tekrar deneyin.');
    }

    return { ok: true, tenantId: tenantId };
  }
);

// =============================================================================
// DM1 — Tenant private 1:1 messaging (callable-only writes; no FCM in DM1)
// Path: tenantInstructorPrivateThreads/{tenantId}/threads/{threadId}/messages/{messageId}
// =============================================================================

const INSTRUCTOR_PRIVATE_DELETED_PREVIEW = 'Mesaj silindi';
const INSTRUCTOR_PRIVATE_SNIPPET_MAX = 180;

function buildTenantInstructorPrivateThreadId(uidA, uidB) {
  const a = String(uidA || '').trim();
  const b = String(uidB || '').trim();
  if (!a || !b) {
    throw new HttpsError('invalid-argument', 'Both participant UIDs are required.');
  }
  if (a === b) {
    throw new HttpsError('invalid-argument', 'Self messaging is not allowed.');
  }
  return a < b ? (a + '_' + b) : (b + '_' + a);
}

function privateThreadsRootRef(tenantId) {
  return db.collection('tenantInstructorPrivateThreads').doc(tenantId).collection('threads');
}

function normalizePrivateMessageSnippet(value, maxLength) {
  const max = (typeof maxLength === 'number' && maxLength > 0)
    ? maxLength
    : INSTRUCTOR_PRIVATE_SNIPPET_MAX;
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max);
}

async function resolvePrivateMessageReplyMetadata(threadRef, tenantId, threadId, replyToMessageId) {
  const sourceSnap = await threadRef.collection('messages').doc(replyToMessageId).get();
  if (!sourceSnap.exists) {
    throw new HttpsError('not-found', 'Yanıtlanmak istenen mesaj bulunamadı.');
  }
  const source = sourceSnap.data() || {};
  const sourceTenantId = String(source.tenantId || '').trim();
  if (sourceTenantId && sourceTenantId !== tenantId) {
    throw new HttpsError('permission-denied', 'Yanıtlanmak istenen mesaj bu sohbete ait değil.');
  }
  const sourceThreadId = String(source.threadId || '').trim();
  if (sourceThreadId && sourceThreadId !== threadId) {
    throw new HttpsError('permission-denied', 'Yanıtlanmak istenen mesaj bu sohbete ait değil.');
  }
  if (source.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'Yanıtlanmak istenen mesaj artık kullanılamıyor.');
  }
  const sourceText = (typeof source.text === 'string') ? source.text : '';
  return {
    replyToMessageId: replyToMessageId,
    replyToSenderUid: String(source.senderUid || '').trim(),
    replyToSenderName: String(source.senderName || '').trim() || 'Kullanıcı',
    replyToTextSnippet: normalizeInstructorRoomReplySnippet(
      sourceText,
      INSTRUCTOR_ROOM_REPLY_SNIPPET_MAX
    )
  };
}

function assertCallerIsPrivateThreadParticipant(threadData, callerUid) {
  const uids = Array.isArray(threadData && threadData.participantUids)
    ? threadData.participantUids.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  if (uids.indexOf(String(callerUid || '').trim()) === -1) {
    throw new HttpsError('permission-denied', 'Bu özel sohbete erişim yetkiniz yok.');
  }
}

function parseOptionalPrivateMessageClientRequestId(data) {
  if (!data || data.clientRequestId == null || data.clientRequestId === undefined) {
    return '';
  }
  if (typeof data.clientRequestId !== 'string') {
    throw new HttpsError('invalid-argument', 'clientRequestId must be a string.');
  }
  const id = data.clientRequestId;
  if (!id) return '';
  if (id.length < 16 || id.length > 100) {
    throw new HttpsError('invalid-argument', 'clientRequestId is invalid.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new HttpsError('invalid-argument', 'clientRequestId is invalid.');
  }
  return id;
}

function buildPrivateMessageIdempotentDocId(callerUid, tenantId, otherUid, clientRequestId) {
  const digest = crypto
    .createHash('sha256')
    .update(
      [
        String(callerUid || ''),
        String(tenantId || ''),
        String(otherUid || ''),
        String(clientRequestId || '')
      ].join('\n'),
      'utf8'
    )
    .digest('hex');
  return 'req_' + digest;
}

/**
 * DM1 — Send private 1:1 message. Creates thread only on first successful send.
 * No FCM / push in DM1.
 */
exports.sendTenantInstructorPrivateMessage = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const otherUid = (data && data.otherUid ? String(data.otherUid) : '').trim();
    const textRaw = data && typeof data.text === 'string' ? data.text : null;
    const clientRequestId = parseOptionalPrivateMessageClientRequestId(data);

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!otherUid) {
      throw new HttpsError('invalid-argument', 'otherUid is required.');
    }
    if (otherUid === callerUid) {
      throw new HttpsError('invalid-argument', 'Self messaging is not allowed.');
    }
    if (typeof textRaw !== 'string') {
      throw new HttpsError('invalid-argument', 'text must be a string.');
    }
    const text = textRaw.trim();
    if (!text) {
      throw new HttpsError('invalid-argument', 'text cannot be empty.');
    }
    if (text.length > INSTRUCTOR_ROOM_TEXT_MAX) {
      throw new HttpsError('invalid-argument', 'text must be 1500 characters or less.');
    }

    const authCtx = await assertActiveInstructorRoomParticipant(callerUid, tenantId);
    await assertActiveInstructorRoomParticipant(otherUid, tenantId);

    const threadId = buildTenantInstructorPrivateThreadId(callerUid, otherUid);
    const replyToMessageId = parseOptionalInstructorRoomReplyToMessageId(data);

    const senderName = resolveInstructorRoomSenderName(
      authCtx.userData,
      callerUid,
      authCtx.membershipRole
    );

    const threadRef = privateThreadsRootRef(tenantId).doc(threadId);
    const useIdempotentId = !!clientRequestId;
    const messageRef = useIdempotentId
      ? threadRef.collection('messages').doc(
          buildPrivateMessageIdempotentDocId(callerUid, tenantId, otherUid, clientRequestId)
        )
      : threadRef.collection('messages').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const snippet = normalizePrivateMessageSnippet(text, INSTRUCTOR_PRIVATE_SNIPPET_MAX);

    let replyMetadata = null;
    if (replyToMessageId) {
      try {
        replyMetadata = await resolvePrivateMessageReplyMetadata(
          threadRef,
          tenantId,
          threadId,
          replyToMessageId
        );
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error('[InstructorPrivateReply] resolve failed', {
          code: e && e.code ? String(e.code) : null,
          message: e && e.message ? String(e.message) : String(e)
        });
        throw new HttpsError('internal', 'Mesaj gönderilemedi. Lütfen tekrar deneyin.');
      }
    }

    const participantAUid = callerUid < otherUid ? callerUid : otherUid;
    const participantBUid = callerUid < otherUid ? otherUid : callerUid;

    const messagePayload = {
      tenantId: tenantId,
      threadId: threadId,
      senderUid: callerUid,
      senderName: senderName,
      senderRole: authCtx.membershipRole,
      text: text,
      createdAt: now,
      isDeleted: false
    };
    if (replyMetadata) {
      messagePayload.replyToMessageId = replyMetadata.replyToMessageId;
      messagePayload.replyToSenderUid = replyMetadata.replyToSenderUid;
      messagePayload.replyToSenderName = replyMetadata.replyToSenderName;
      messagePayload.replyToTextSnippet = replyMetadata.replyToTextSnippet;
    }
    if (useIdempotentId) {
      messagePayload.clientRequestId = clientRequestId;
    }

    let deduplicated = false;
    try {
      await db.runTransaction(async (tx) => {
        if (useIdempotentId) {
          const existingMessageSnap = await tx.get(messageRef);
          if (existingMessageSnap.exists) {
            const existingMsg = existingMessageSnap.data() || {};
            const existingSender = String(existingMsg.senderUid || '').trim();
            const existingTenant = String(existingMsg.tenantId || '').trim();
            const existingThread = String(existingMsg.threadId || '').trim();
            const existingReq = String(existingMsg.clientRequestId || '').trim();
            if (
              existingSender !== callerUid ||
              (existingTenant && existingTenant !== tenantId) ||
              (existingThread && existingThread !== threadId) ||
              (existingReq && existingReq !== clientRequestId)
            ) {
              throw new HttpsError('failed-precondition', 'Idempotent message collision.');
            }
            deduplicated = true;
            return;
          }
        }

        const threadSnap = await tx.get(threadRef);
        const threadUpdate = {
          tenantId: tenantId,
          participantUids: [participantAUid, participantBUid],
          participantAUid: participantAUid,
          participantBUid: participantBUid,
          updatedAt: now,
          lastMessageAt: now,
          lastMessageTextSnippet: snippet,
          lastSenderUid: callerUid,
          lastMessageId: messageRef.id
        };
        if (!threadSnap.exists) {
          threadUpdate.createdAt = now;
        } else {
          const existing = threadSnap.data() || {};
          assertCallerIsPrivateThreadParticipant(existing, callerUid);
          const existingTenantId = String(existing.tenantId || '').trim();
          if (existingTenantId && existingTenantId !== tenantId) {
            throw new HttpsError('permission-denied', 'Thread tenant mismatch.');
          }
        }
        tx.set(threadRef, threadUpdate, { merge: true });
        tx.set(messageRef, messagePayload);
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorPrivateMessage] send failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e),
        tenantId: tenantId
      });
      throw new HttpsError('internal', 'Failed to send private message.');
    }

    return {
      ok: true,
      tenantId: tenantId,
      threadId: threadId,
      messageId: messageRef.id,
      deduplicated: deduplicated
    };
  }
);

/**
 * DM1 — Edit own private message.
 */
exports.editTenantInstructorPrivateMessage = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const threadId = (data && data.threadId ? String(data.threadId) : '').trim();
    const messageId = (data && data.messageId ? String(data.messageId) : '').trim();
    const textRaw = data && typeof data.text === 'string' ? data.text : null;

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!threadId) {
      throw new HttpsError('invalid-argument', 'threadId is required.');
    }
    if (!messageId) {
      throw new HttpsError('invalid-argument', 'messageId is required.');
    }
    if (typeof textRaw !== 'string') {
      throw new HttpsError('invalid-argument', 'text must be a string.');
    }
    const text = textRaw.trim();
    if (!text) {
      throw new HttpsError('invalid-argument', 'text cannot be empty.');
    }
    if (text.length > INSTRUCTOR_ROOM_TEXT_MAX) {
      throw new HttpsError('invalid-argument', 'text must be 1500 characters or less.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const threadRef = privateThreadsRootRef(tenantId).doc(threadId);
    const msgRef = threadRef.collection('messages').doc(messageId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const snippet = normalizePrivateMessageSnippet(text, INSTRUCTOR_PRIVATE_SNIPPET_MAX);

    try {
      await db.runTransaction(async (tx) => {
        const threadSnap = await tx.get(threadRef);
        if (!threadSnap.exists) {
          throw new HttpsError('not-found', 'Private thread not found.');
        }
        const threadData = threadSnap.data() || {};
        assertCallerIsPrivateThreadParticipant(threadData, callerUid);
        const existingTenantId = String(threadData.tenantId || '').trim();
        if (existingTenantId && existingTenantId !== tenantId) {
          throw new HttpsError('permission-denied', 'Thread tenant mismatch.');
        }

        const msgSnap = await tx.get(msgRef);
        if (!msgSnap.exists) {
          throw new HttpsError('not-found', 'Message not found.');
        }
        const msgData = msgSnap.data() || {};
        if (String(msgData.senderUid || '').trim() !== callerUid) {
          throw new HttpsError('permission-denied', 'Bu mesajı düzenleme yetkiniz bulunmuyor.');
        }
        if (msgData.isDeleted === true) {
          throw new HttpsError('failed-precondition', 'Deleted messages cannot be edited.');
        }

        const isLast = String(threadData.lastMessageId || '').trim() === messageId;
        tx.set(msgRef, {
          text: text,
          editedAt: now
        }, { merge: true });

        if (isLast) {
          tx.set(threadRef, {
            lastMessageTextSnippet: snippet,
            updatedAt: now
          }, { merge: true });
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorPrivateEdit] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Mesaj düzenlenemedi. Lütfen tekrar deneyin.');
    }

    return { ok: true, tenantId: tenantId, threadId: threadId, messageId: messageId };
  }
);

/**
 * DM1 — Soft-delete own private message. Last-message summary uses stable deleted snippet
 * (no history reconstruction / extra index).
 */
exports.deleteTenantInstructorPrivateMessage = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const data = request && request.data ? request.data : {};
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const threadId = (data && data.threadId ? String(data.threadId) : '').trim();
    const messageId = (data && data.messageId ? String(data.messageId) : '').trim();

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    if (!threadId) {
      throw new HttpsError('invalid-argument', 'threadId is required.');
    }
    if (!messageId) {
      throw new HttpsError('invalid-argument', 'messageId is required.');
    }

    await assertActiveInstructorRoomParticipant(callerUid, tenantId);

    const threadRef = privateThreadsRootRef(tenantId).doc(threadId);
    const msgRef = threadRef.collection('messages').doc(messageId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      await db.runTransaction(async (tx) => {
        const threadSnap = await tx.get(threadRef);
        if (!threadSnap.exists) {
          throw new HttpsError('not-found', 'Private thread not found.');
        }
        const threadData = threadSnap.data() || {};
        assertCallerIsPrivateThreadParticipant(threadData, callerUid);
        const existingTenantId = String(threadData.tenantId || '').trim();
        if (existingTenantId && existingTenantId !== tenantId) {
          throw new HttpsError('permission-denied', 'Thread tenant mismatch.');
        }

        const msgSnap = await tx.get(msgRef);
        if (!msgSnap.exists) {
          throw new HttpsError('not-found', 'Message not found.');
        }
        const msgData = msgSnap.data() || {};
        if (String(msgData.senderUid || '').trim() !== callerUid) {
          throw new HttpsError('permission-denied', 'Bu mesajı silme yetkiniz bulunmuyor.');
        }
        if (msgData.isDeleted === true) {
          return;
        }

        const isLast = String(threadData.lastMessageId || '').trim() === messageId;
        tx.set(msgRef, {
          isDeleted: true,
          deletedAt: now,
          deletedByUid: callerUid
        }, { merge: true });

        if (isLast) {
          tx.set(threadRef, {
            lastMessageTextSnippet: INSTRUCTOR_PRIVATE_DELETED_PREVIEW,
            updatedAt: now
          }, { merge: true });
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[InstructorPrivateDelete] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Mesaj silinemedi. Lütfen tekrar deneyin.');
    }

    return { ok: true, tenantId: tenantId, threadId: threadId, messageId: messageId };
  }
);

/* -------------------------------------------------------------------------- */
/* Phase 1 — Special lesson requests (student-safe callables)                 */
/* -------------------------------------------------------------------------- */

const SPECIAL_LESSON_REQUESTS_COLLECTION = 'specialLessonRequests';
const SPECIAL_LESSON_REQUEST_SOURCE_V1 = 'student_special_lesson';
const SPECIAL_LESSON_DRIVING_SOURCE = 'special_lesson_request';

/** Special driving lesson: source and/or linked specialLessonRequestId. */
function isSpecialDrivingLessonDoc(data) {
  const d = data || {};
  const source = normalizeRole(d.source);
  const specialRequestId = String(d.specialLessonRequestId || '').trim();
  return source === SPECIAL_LESSON_DRIVING_SOURCE || !!specialRequestId;
}

const SPECIAL_LESSON_PUBLIC_CONFLICT_MSG =
  'Seçtiğiniz tarih ve saat artık müsait değil.';
const SPECIAL_LESSON_ADMIN_CONFLICT_MSG =
  'Seçilen tarih ve saat artık müsait değil.';
const SPECIAL_LESSON_REJECT_REASON_MAX = 500;
const SPECIAL_LESSON_ACTIVE_REQUEST_STATUSES = {
  pending: true,
  waiting: true
};

/**
 * Optional clientRequestId for special-lesson create idempotency (legacy callers omit).
 * @param {object} data
 * @returns {string}
 */
function parseOptionalSpecialLessonClientRequestId(data) {
  if (!data || data.clientRequestId == null || data.clientRequestId === undefined) {
    return '';
  }
  if (typeof data.clientRequestId !== 'string') {
    throw new HttpsError('invalid-argument', 'clientRequestId must be a string.');
  }
  const id = String(data.clientRequestId || '').trim();
  if (!id) return '';
  if (id.length < 16 || id.length > 100) {
    throw new HttpsError('invalid-argument', 'clientRequestId is invalid.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new HttpsError('invalid-argument', 'clientRequestId is invalid.');
  }
  return id;
}

/**
 * Deterministic specialLessonRequests doc id for student+clientRequestId.
 * @param {string} tenantId
 * @param {string} studentUid
 * @param {string} clientRequestId
 * @returns {string}
 */
function buildSpecialLessonRequestIdempotentDocId(tenantId, studentUid, clientRequestId) {
  const digest = crypto
    .createHash('sha256')
    .update(
      [
        String(tenantId || ''),
        String(studentUid || ''),
        String(clientRequestId || '')
      ].join('\n'),
      'utf8'
    )
    .digest('hex');
  return 'slr_' + digest.slice(0, 40);
}

/**
 * @param {string} instructorUid
 * @param {string} dateYmd
 * @param {string} startHm
 * @param {string} endHm
 * @returns {string}
 */
function buildSpecialLessonCreatePayloadKey(instructorUid, dateYmd, startHm, endHm) {
  return [
    String(instructorUid || '').trim(),
    String(dateYmd || '').trim(),
    String(startHm || '').trim(),
    String(endHm || '').trim()
  ].join('|');
}

/**
 * Exact logical duplicate key for a special lesson request document.
 * @param {object} requestData
 * @returns {string}
 */
function buildSpecialLessonLogicalDuplicateKey(requestData) {
  const d = requestData || {};
  const startMs = membershipExpiryToMillis(d.requestedStartAt);
  const endMs = membershipExpiryToMillis(d.requestedEndAt);
  return [
    String(d.tenantId || '').trim(),
    String(d.studentUid || '').trim(),
    String(d.instructorUid || '').trim(),
    String(Number.isFinite(startMs) ? startMs : ''),
    String(Number.isFinite(endMs) ? endMs : '')
  ].join('|');
}

/**
 * Collapse exact logical duplicate student requests into one canonical card.
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
function collapseStudentSpecialLessonRequestDuplicates(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = Object.create(null);
  const order = [];

  function rankStatus(st) {
    const s = String(st || '').trim().toLowerCase();
    if (s === 'waiting' || s === 'pending') return 0;
    if (s === 'approved') return 1;
    if (s === 'rejected') return 2;
    return 9;
  }

  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {};
    const startMs = Date.parse(String(row.requestedStartAt || ''));
    const endMs = Date.parse(String(row.requestedEndAt || ''));
    const key = [
      String(row.instructorUid || '').trim(),
      String(Number.isFinite(startMs) ? startMs : row.requestedStartAt || ''),
      String(Number.isFinite(endMs) ? endMs : row.requestedEndAt || '')
    ].join('|');
    if (!groups[key]) {
      groups[key] = row;
      order.push(key);
      continue;
    }
    const cur = groups[key];
    const curRank = rankStatus(cur.status);
    const nextRank = rankStatus(row.status);
    if (nextRank < curRank) {
      groups[key] = row;
    } else if (nextRank === curRank) {
      const curId = String(cur.requestId || '');
      const nextId = String(row.requestId || '');
      if (nextId && (!curId || nextId < curId)) {
        groups[key] = row;
      }
    }
  }
  return order.map((k) => groups[k]);
}

/** Canonical student special-lesson slots only (2h + 1h break pattern). */
const SPECIAL_LESSON_CANONICAL_SLOTS = Object.freeze([
  Object.freeze({ startTime: '09:00', endTime: '11:00' }),
  Object.freeze({ startTime: '12:00', endTime: '14:00' }),
  Object.freeze({ startTime: '15:00', endTime: '17:00' }),
  Object.freeze({ startTime: '18:00', endTime: '20:00' })
]);
const SPECIAL_LESSON_CANONICAL_DURATION_MINUTES = 120;
const SPECIAL_LESSON_NON_CANONICAL_MSG =
  'Özel ders yalnızca sistemin sunduğu sabit saat aralıklarından biri için talep edilebilir.';

/**
 * @param {string} dateYmd
 * @param {string} hm
 * @returns {number}
 */
function specialLessonTurkeyHmToMs(dateYmd, hm) {
  const ms = Date.parse(String(dateYmd || '').trim() + 'T' + String(hm || '').trim() + ':00+03:00');
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Validate exact canonical special-lesson pair.
 * @param {string} startTime
 * @param {string} endTime
 * @returns {{ startTime: string, endTime: string }}
 */
function assertCanonicalSpecialLessonSlot(startTime, endTime) {
  const startHm = normalizeSpecialLessonHm(startTime, 'startTime');
  const endHm = normalizeSpecialLessonHm(endTime, 'endTime');
  for (let i = 0; i < SPECIAL_LESSON_CANONICAL_SLOTS.length; i++) {
    const slot = SPECIAL_LESSON_CANONICAL_SLOTS[i];
    if (slot.startTime === startHm && slot.endTime === endHm) {
      return { startTime: startHm, endTime: endHm };
    }
  }
  throw new HttpsError('invalid-argument', SPECIAL_LESSON_NON_CANONICAL_MSG);
}

/**
 * Map busy absolute intervals onto the four canonical slots.
 * @param {string} dateYmd
 * @param {Array<{ startMs: number, endMs: number }>} busyRanges
 * @returns {Array<{ startTime: string, endTime: string, status: 'available'|'busy' }>}
 */
function buildCanonicalSpecialLessonSlotStatuses(dateYmd, busyRanges) {
  const busy = Array.isArray(busyRanges) ? busyRanges : [];
  return SPECIAL_LESSON_CANONICAL_SLOTS.map((slot) => {
    const slotStartMs = specialLessonTurkeyHmToMs(dateYmd, slot.startTime);
    const slotEndMs = specialLessonTurkeyHmToMs(dateYmd, slot.endTime);
    let isBusy = false;
    if (Number.isFinite(slotStartMs) && Number.isFinite(slotEndMs)) {
      for (let i = 0; i < busy.length; i++) {
        const row = busy[i];
        if (!row) continue;
        if (intervalsOverlap(row.startMs, row.endMs, slotStartMs, slotEndMs)) {
          isBusy = true;
          break;
        }
      }
    }
    return {
      startTime: slot.startTime,
      endTime: slot.endTime,
      status: isBusy ? 'busy' : 'available'
    };
  });
}

/**
 * Authenticated active driving_license student; tenant resolved server-side only.
 * @param {string} callerUid
 * @returns {Promise<{ tenantId: string, studentUid: string, userData: object, membership: object }>}
 */
async function assertActiveDrivingStudentCaller(callerUid) {
  const uid = String(callerUid || '').trim();
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile could not be verified.');
  }
  const userData = userSnap.data() || {};
  if (normalizeRole(userData.role) !== 'student') {
    throw new HttpsError('permission-denied', 'Only students may perform this action.');
  }
  if (userData.isActive === false) {
    throw new HttpsError('failed-precondition', 'Hesap aktif değil.');
  }

  const memSnap = await db.collection('tenantMemberships')
    .where('uid', '==', uid)
    .where('role', '==', 'student')
    .where('status', '==', 'active')
    .get();

  const candidates = (memSnap.docs || [])
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((m) => {
      const tid = String(m.tenantId || '').trim();
      if (!tid) return false;
      if (normalizeProgramType(m.programType) !== DRIVING_PROGRAM_TYPE) return false;
      if (tid === PLATFORM_MACHINE_TENANT_ID) return false;
      return true;
    });

  if (!candidates.length) {
    throw new HttpsError(
      'failed-precondition',
      'Bu işlem yalnızca aktif direksiyon (ehliyet) öğrencileri içindir.'
    );
  }

  candidates.sort((a, b) => {
    const aInst = normalizeEnrollmentSource(a.enrollmentSource, a.tenantId, a.programType)
      === ENROLLMENT_SOURCE_INSTITUTION ? 0 : 1;
    const bInst = normalizeEnrollmentSource(b.enrollmentSource, b.tenantId, b.programType)
      === ENROLLMENT_SOURCE_INSTITUTION ? 0 : 1;
    if (aInst !== bInst) return aInst - bInst;
    return String(a.tenantId || '').localeCompare(String(b.tenantId || ''));
  });

  const selected = candidates[0];
  const tenantId = String(selected.tenantId || '').trim();
  if (!tenantId) {
    throw new HttpsError('failed-precondition', 'Öğrenci kurum üyeliği çözülemedi.');
  }

  return {
    tenantId: tenantId,
    studentUid: uid,
    userData: userData,
    membership: selected
  };
}

/**
 * Active instructor of the caller's tenant (same-tenant only).
 * @param {string} tenantId
 * @param {string} instructorUid
 * @returns {Promise<{ instructorUid: string, userData: object, membership: object }>}
 */
async function assertActiveInstructorInTenant(tenantId, instructorUid) {
  const tid = String(tenantId || '').trim();
  const iid = String(instructorUid || '').trim();
  if (!tid) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }
  if (!iid) {
    throw new HttpsError('invalid-argument', 'instructorUid is required.');
  }

  const membershipId = iid + '_' + tid;
  const [memSnap, userSnap] = await Promise.all([
    db.collection('tenantMemberships').doc(membershipId).get(),
    db.collection('users').doc(iid).get()
  ]);

  if (!memSnap.exists) {
    throw new HttpsError('permission-denied', 'Instructor is not available for this student.');
  }
  const membership = memSnap.data() || {};
  if (String(membership.tenantId || '').trim() !== tid) {
    throw new HttpsError('permission-denied', 'Instructor is not available for this student.');
  }
  if (normalizeRole(membership.role) !== 'instructor') {
    throw new HttpsError('permission-denied', 'Instructor is not available for this student.');
  }
  if (normalizeRole(membership.status) !== 'active') {
    throw new HttpsError('permission-denied', 'Instructor is not available for this student.');
  }
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'Instructor is not available for this student.');
  }
  const userData = userSnap.data() || {};
  if (normalizeRole(userData.role) !== 'instructor') {
    throw new HttpsError('permission-denied', 'Instructor is not available for this student.');
  }
  if (userData.isActive === false) {
    throw new HttpsError('permission-denied', 'Instructor is not available for this student.');
  }

  return { instructorUid: iid, userData: userData, membership: membership };
}

/**
 * @param {number} ms
 * @returns {string} HH:mm in Europe/Istanbul
 */
function formatIstanbulHm(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date(n));
    const h = ((parts.find((p) => p.type === 'hour') || {}).value) || '';
    const m = ((parts.find((p) => p.type === 'minute') || {}).value) || '';
    if (!h || !m) return '';
    const hourNum = parseInt(h, 10);
    const hour = Number.isFinite(hourNum) && hourNum === 24 ? '00' : h.padStart(2, '0');
    return hour + ':' + m.padStart(2, '0');
  } catch (_) {
    return '';
  }
}

/**
 * @param {number} ms
 * @returns {string} YYYY-MM-DDTHH:mm:ss+03:00
 */
function buildTurkeyIsoFromMillis(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) {
    throw new HttpsError('invalid-argument', 'Time could not be parsed.');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(n));
  const y = ((parts.find((p) => p.type === 'year') || {}).value) || '';
  const mo = ((parts.find((p) => p.type === 'month') || {}).value) || '';
  const d = ((parts.find((p) => p.type === 'day') || {}).value) || '';
  let h = ((parts.find((p) => p.type === 'hour') || {}).value) || '';
  const mi = ((parts.find((p) => p.type === 'minute') || {}).value) || '';
  const s = ((parts.find((p) => p.type === 'second') || {}).value) || '';
  if (!y || !mo || !d || !h || !mi || !s) {
    throw new HttpsError('invalid-argument', 'Time could not be formatted.');
  }
  if (parseInt(h, 10) === 24) h = '00';
  return y + '-' + mo + '-' + d + 'T' + h.padStart(2, '0') + ':' + mi.padStart(2, '0') + ':' + s.padStart(2, '0') + '+03:00';
}

/**
 * Normalize HH:mm for special-lesson start/end (minute-sensitive, no grid).
 * @param {string} raw
 * @param {string} fieldName
 * @returns {string} HH:mm
 */
function normalizeSpecialLessonHm(raw, fieldName) {
  const label = fieldName || 'time';
  const hm = String(raw || '').trim();
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    throw new HttpsError('invalid-argument', label + ' must be HH:mm.');
  }
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new HttpsError('invalid-argument', label + ' hour is invalid.');
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new HttpsError('invalid-argument', label + ' minutes must be 00–59.');
  }
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

/**
 * Special-lesson window from date + start + end (variable duration).
 * @param {string} dateYmd
 * @param {string} startTimeHm
 * @param {string} endTimeHm
 * @returns {ReturnType<typeof parseTurkeyLessonWindow>}
 */
function buildSpecialLessonWindowFromDateStartEnd(dateYmd, startTimeHm, endTimeHm) {
  const ymd = String(dateYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new HttpsError('invalid-argument', 'dateYmd must be YYYY-MM-DD.');
  }
  const startHm = normalizeSpecialLessonHm(startTimeHm, 'startTime');
  const endHm = normalizeSpecialLessonHm(endTimeHm, 'endTime');
  const startIso = ymd + 'T' + startHm + ':00+03:00';
  const endIso = ymd + 'T' + endHm + ':00+03:00';
  return parseTurkeyLessonWindow(startIso, endIso);
}

/**
 * Active (soft-hold) specialLessonRequests that may overlap — legacy pending + waiting.
 * Uses existing composite index (tenantId, instructorUid, status, requestedStartAt) twice.
 * @param {string} tenantId
 * @param {string} instructorUid
 * @param {number} startMs
 * @param {number} endMs
 * @returns {Promise<object[]>}
 */
async function queryPotentialPendingSpecialRequestOverlaps(tenantId, instructorUid, startMs, endMs) {
  const lookbackStart = admin.firestore.Timestamp.fromMillis(startMs - DRIVING_LESSON_OVERLAP_LOOKBACK_MS);
  const endTs = admin.firestore.Timestamp.fromMillis(endMs);
  const base = db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION)
    .where('tenantId', '==', tenantId)
    .where('instructorUid', '==', instructorUid);
  const [pendingSnap, waitingSnap] = await Promise.all([
    base.where('status', '==', 'pending')
      .where('requestedStartAt', '>=', lookbackStart)
      .where('requestedStartAt', '<', endTs)
      .get(),
    base.where('status', '==', 'waiting')
      .where('requestedStartAt', '>=', lookbackStart)
      .where('requestedStartAt', '<', endTs)
      .get()
  ]);
  const byId = Object.create(null);
  (pendingSnap.docs || []).forEach((doc) => {
    byId[doc.id] = { id: doc.id, ...(doc.data() || {}) };
  });
  (waitingSnap.docs || []).forEach((doc) => {
    byId[doc.id] = { id: doc.id, ...(doc.data() || {}) };
  });
  return Object.keys(byId).map((id) => byId[id]);
}

/**
 * @param {object[]} rows
 * @param {number} candidateStartMs
 * @param {number} candidateEndMs
 * @param {string} [excludeRequestId]
 * @returns {object|null}
 */
function findPendingSpecialRequestOverlapConflict(rows, candidateStartMs, candidateEndMs, excludeRequestId) {
  const excludeId = excludeRequestId != null ? String(excludeRequestId).trim() : '';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (excludeId && String(row.id || '').trim() === excludeId) continue;
    const st = normalizeRole(row.status);
    if (!SPECIAL_LESSON_ACTIVE_REQUEST_STATUSES[st]) continue;
    // Linked provisional lesson already covers the hold via drivingLessons overlap.
    if (String(row.drivingLessonId || '').trim()) continue;
    const existingStart = membershipExpiryToMillis(row.requestedStartAt);
    const existingEnd = membershipExpiryToMillis(row.requestedEndAt);
    if (existingStart == null || existingEnd == null) continue;
    if (intervalsOverlap(existingStart, existingEnd, candidateStartMs, candidateEndMs)) {
      return row;
    }
  }
  return null;
}

/**
 * Student-safe derived status (legacy pending → waiting).
 * @param {string} status
 * @returns {string}
 */
function normalizeStudentFacingSpecialRequestStatus(status) {
  const s = normalizeRole(status);
  if (s === 'pending') return 'waiting';
  if (s === 'waiting' || s === 'approved' || s === 'rejected' || s === 'cancelled') return s;
  return 'waiting';
}

/**
 * Admin/list operational status (legacy pending → waiting).
 * @param {object} requestData
 * @returns {string}
 */
function deriveSpecialRequestStatus(requestData) {
  const d = requestData || {};
  const s = normalizeRole(d.status);
  if (s === 'pending') return 'waiting';
  if (s === 'waiting' || s === 'approved' || s === 'rejected' || s === 'cancelled') return s;
  const adminDecision = normalizeRole(d.adminDecision);
  const instructorDecision = normalizeRole(d.instructorDecision);
  if (adminDecision === 'rejected') return 'rejected';
  if (adminDecision === 'approved' && instructorDecision === 'approved') return 'approved';
  return 'waiting';
}

/**
 * @param {object} requestData
 * @returns {boolean}
 */
function isSpecialRequestOpenForAdminDecision(requestData) {
  const status = deriveSpecialRequestStatus(requestData);
  return status === 'waiting';
}

/**
 * @param {number} startMs
 * @param {number} endMs
 * @param {number} dayStartMs
 * @param {number} dayEndMs
 * @returns {{ startTime: string, endTime: string, status: string }|null}
 */
function toSanitizedBusyInterval(startMs, endMs, dayStartMs, dayEndMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (!intervalsOverlap(startMs, endMs, dayStartMs, dayEndMs)) return null;
  const clippedStart = Math.max(startMs, dayStartMs);
  const clippedEnd = Math.min(endMs, dayEndMs);
  if (!(clippedEnd > clippedStart)) return null;
  const startTime = formatIstanbulHm(clippedStart);
  const endTime = formatIstanbulHm(clippedEnd);
  if (!startTime || !endTime) return null;
  return { startTime: startTime, endTime: endTime, status: 'busy' };
}

function safeUserDisplayName(userData) {
  const name = userData && userData.fullName != null ? String(userData.fullName).trim() : '';
  return name || '—';
}

function safeUserPhotoUrl(userData) {
  if (!userData) return '';
  if (userData.photoUrl) return String(userData.photoUrl).trim();
  if (userData.photoURL) return String(userData.photoURL).trim();
  return '';
}

function serializeSpecialRequestTs(ts) {
  try {
    if (!ts) return null;
    const date = typeof ts.toDate === 'function'
      ? ts.toDate()
      : (ts && typeof ts._seconds === 'number' ? new Date(ts._seconds * 1000) : null);
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  } catch (_) {
    return null;
  }
}

/**
 * Student: list active instructors in own tenant (safe fields only).
 */
exports.listActiveInstructorsForStudent = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { tenantId } = await assertActiveDrivingStudentCaller(callerUid);

    const memSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .where('role', '==', 'instructor')
      .where('status', '==', 'active')
      .get();

    const memberships = (memSnap.docs || []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const uids = [...new Set(memberships.map((m) => String(m.uid || '').trim()).filter(Boolean))];

    const usersMap = {};
    await Promise.all(uids.map(async (uid) => {
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) usersMap[uid] = userSnap.data() || {};
    }));

    const instructors = [];
    for (let i = 0; i < memberships.length; i++) {
      const m = memberships[i];
      const uid = String(m.uid || '').trim();
      if (!uid) continue;
      const user = usersMap[uid];
      if (!user) continue;
      if (normalizeRole(user.role) !== 'instructor') continue;
      if (user.isActive === false) continue;
      instructors.push({
        uid: uid,
        fullName: safeUserDisplayName(user),
        photoUrl: safeUserPhotoUrl(user)
      });
    }

    instructors.sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'tr'));

    return {
      ok: true,
      instructors: instructors
    };
  }
);

/**
 * Student: sanitized canonical special-lesson slots for instructor/date.
 */
exports.getSpecialLessonAvailabilityForStudent = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const instructorUid = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    const dateYmd = (data && data.dateYmd ? String(data.dateYmd) : '').trim();
    if (!instructorUid) {
      throw new HttpsError('invalid-argument', 'instructorUid is required.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
      throw new HttpsError('invalid-argument', 'dateYmd must be YYYY-MM-DD.');
    }

    const { tenantId } = await assertActiveDrivingStudentCaller(callerUid);
    await assertActiveInstructorInTenant(tenantId, instructorUid);

    const dayStartMs = Date.parse(dateYmd + 'T08:00:00+03:00');
    const dayEndMs = Date.parse(dateYmd + 'T22:00:00+03:00');
    if (!Number.isFinite(dayStartMs) || !Number.isFinite(dayEndMs)) {
      throw new HttpsError('invalid-argument', 'dateYmd could not be parsed.');
    }

    const [lessonRows, activeRequestRows] = await Promise.all([
      queryPotentialOverlaps('instructorUid', instructorUid, tenantId, dayStartMs, dayEndMs),
      queryPotentialPendingSpecialRequestOverlaps(tenantId, instructorUid, dayStartMs, dayEndMs)
    ]);

    const busyRanges = [];
    const busyIntervals = [];
    const seenKeys = Object.create(null);

    function pushBusy(startMs, endMs) {
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
      busyRanges.push({ startMs: startMs, endMs: endMs });
      const interval = toSanitizedBusyInterval(startMs, endMs, dayStartMs, dayEndMs);
      if (!interval) return;
      const key = interval.startTime + '|' + interval.endTime;
      if (seenKeys[key]) return;
      seenKeys[key] = true;
      busyIntervals.push(interval);
    }

    for (let i = 0; i < lessonRows.length; i++) {
      const row = lessonRows[i];
      if (!lessonBlocksOverlap(row.status)) continue;
      const startMs = membershipExpiryToMillis(row.startAt);
      const endMs = membershipExpiryToMillis(row.endAt);
      pushBusy(startMs, endMs);
    }

    // Legacy request-only soft holds (no linked provisional lesson yet).
    for (let i = 0; i < activeRequestRows.length; i++) {
      const row = activeRequestRows[i];
      const st = normalizeRole(row.status);
      if (!SPECIAL_LESSON_ACTIVE_REQUEST_STATUSES[st]) continue;
      if (String(row.drivingLessonId || '').trim()) continue;
      const startMs = membershipExpiryToMillis(row.requestedStartAt);
      const endMs = membershipExpiryToMillis(row.requestedEndAt);
      pushBusy(startMs, endMs);
    }

    busyIntervals.sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
    const slots = buildCanonicalSpecialLessonSlotStatuses(dateYmd, busyRanges);

    return {
      instructorUid: instructorUid,
      dateYmd: dateYmd,
      dayStart: '09:00',
      dayEnd: '20:00',
      slots: slots,
      busyIntervals: busyIntervals
    };
  }
);

/**
 * Student-safe weekly agenda projection for a selected instructor.
 * Returns only start/end + presentation kind (busy|closed|own_waiting|own_approved).
 * Own special waiting rows may include privacy-safe approvalStage:
 * pending_instructor | pending_admin.
 * Never includes other students' PII or raw lesson documents.
 * @param {object} row
 * @param {string} studentUid
 * @param {number} nowMs
 * @param {number} startMs
 * @param {number} endMs
 * @returns {{ kind: string, isPast: boolean, approvalStage?: string }|null}
 */
function deriveStudentWeeklyAgendaPresentation(row, studentUid, nowMs, startMs, endMs) {
  const d = row || {};
  const status = normalizeRole(d.status);
  if (!lessonBlocksOverlap(status)) return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) return null;

  const ownerUid = String(d.studentUid || '').trim();
  const isOwn = !!(studentUid && ownerUid && ownerUid === studentUid);
  const source = normalizeRole(d.source);
  const isOwnSpecial = isOwn && (
    source === SPECIAL_LESSON_DRIVING_SOURCE ||
    source === SPECIAL_LESSON_REQUEST_SOURCE_V1 ||
    !!String(d.specialLessonRequestId || '').trim() ||
    !!d.__softHoldSpecialRequest
  );
  const isPast = endMs <= Number(nowMs) || status === 'completed';

  if (isOwnSpecial) {
    if (status === 'completed') {
      return { kind: 'closed', isPast: true };
    }
    if (status === 'confirmed') {
      const finalMs = membershipExpiryToMillis(d.specialFinalApprovedAt);
      const hasFinal =
        (finalMs != null)
        || (d.specialFinalApprovedAtMs != null && Number.isFinite(Number(d.specialFinalApprovedAtMs)));
      if (hasFinal) {
        return { kind: 'own_approved', isPast: isPast };
      }
      // Legacy premature confirmed: still waiting institution admin final approval.
      return { kind: 'own_waiting', approvalStage: 'pending_admin', isPast: isPast };
    }
    if (status === 'pending_admin') {
      return { kind: 'own_waiting', approvalStage: 'pending_admin', isPast: isPast };
    }
    // pending_instructor | consultation_requested | waiting soft-hold
    return { kind: 'own_waiting', approvalStage: 'pending_instructor', isPast: isPast };
  }

  // Own admin_manual and all other students: busy / closed only (no name / no stage).
  return { kind: isPast ? 'closed' : 'busy', isPast: isPast };
}

/**
 * Student: sanitized weekly instructor agenda (read-only projection).
 * Uses existing drivingLessons + legacy soft-hold specialLessonRequests indexes.
 */
exports.getInstructorWeeklyAgendaForStudent = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const instructorUid = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    const weekStartYmd = (data && data.weekStart ? String(data.weekStart) : '').trim();
    if (!instructorUid) {
      throw new HttpsError('invalid-argument', 'instructorUid is required.');
    }
    if (!weekStartYmd || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartYmd)) {
      throw new HttpsError('invalid-argument', 'weekStart must be YYYY-MM-DD.');
    }

    const { tenantId, studentUid } = await assertActiveDrivingStudentCaller(callerUid);
    await assertActiveInstructorInTenant(tenantId, instructorUid);

    const weekStartMs = parseTurkeyDateStartIso(weekStartYmd);
    const turkeyWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Istanbul',
      weekday: 'short'
    }).format(new Date(weekStartMs));
    if (turkeyWeekday !== 'Mon') {
      throw new HttpsError('invalid-argument', 'weekStart must be a Monday (Europe/Istanbul).');
    }
    const weekEndMs = weekStartMs + (7 * MS_PER_DAY);
    const weekStartTs = admin.firestore.Timestamp.fromMillis(weekStartMs);
    const weekEndTs = admin.firestore.Timestamp.fromMillis(weekEndMs);
    const nowMs = Date.now();

    let lessonSnap;
    let pendingSnap;
    let waitingSnap;
    try {
      const requestBase = db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION)
        .where('tenantId', '==', tenantId)
        .where('instructorUid', '==', instructorUid);
      [lessonSnap, pendingSnap, waitingSnap] = await Promise.all([
        db.collection('drivingLessons')
          .where('tenantId', '==', tenantId)
          .where('instructorUid', '==', instructorUid)
          .where('startAt', '>=', weekStartTs)
          .where('startAt', '<', weekEndTs)
          .get(),
        requestBase
          .where('status', '==', 'pending')
          .where('requestedStartAt', '>=', weekStartTs)
          .where('requestedStartAt', '<', weekEndTs)
          .get(),
        requestBase
          .where('status', '==', 'waiting')
          .where('requestedStartAt', '>=', weekStartTs)
          .where('requestedStartAt', '<', weekEndTs)
          .get()
      ]);
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for student weekly agenda. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to load instructor weekly agenda.'
      );
    }

    const entries = [];
    const seenIntervalKeys = Object.create(null);
    const linkedRequestIds = Object.create(null);

    function pushEntry(startMs, endMs, kind, isPast, approvalStage) {
      if (!kind) return;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) return;
      // Clip to week window for safety (still same-day lessons typically).
      if (endMs <= weekStartMs || startMs >= weekEndMs) return;
      const stage = (kind === 'own_waiting'
        && (approvalStage === 'pending_instructor' || approvalStage === 'pending_admin'))
        ? approvalStage
        : '';
      const key = String(startMs) + '|' + String(endMs) + '|' + kind + '|' + stage;
      if (seenIntervalKeys[key]) return;
      seenIntervalKeys[key] = true;
      const entry = {
        startAt: buildTurkeyIsoFromMillis(startMs),
        endAt: buildTurkeyIsoFromMillis(endMs),
        kind: kind,
        isPast: !!isPast
      };
      if (stage) entry.approvalStage = stage;
      entries.push(entry);
    }

    (lessonSnap.docs || []).forEach((doc) => {
      if (!doc || !doc.id || String(doc.id).indexOf('slot_') === 0) return;
      const raw = doc.data() || {};
      if (String(raw.tenantId || '').trim() !== tenantId) return;
      if (String(raw.instructorUid || '').trim() !== instructorUid) return;
      const specialRequestId = String(raw.specialLessonRequestId || '').trim();
      if (specialRequestId) linkedRequestIds[specialRequestId] = true;

      const startMs = membershipExpiryToMillis(raw.startAt);
      const endMs = membershipExpiryToMillis(raw.endAt);
      const presentation = deriveStudentWeeklyAgendaPresentation(
        raw,
        studentUid,
        nowMs,
        startMs,
        endMs
      );
      if (!presentation) return;
      pushEntry(
        startMs,
        endMs,
        presentation.kind,
        presentation.isPast,
        presentation.approvalStage
      );
    });

    function ingestSoftHold(snap) {
      (snap.docs || []).forEach((doc) => {
        if (!doc || !doc.id) return;
        if (linkedRequestIds[doc.id]) return;
        const raw = doc.data() || {};
        if (String(raw.tenantId || '').trim() !== tenantId) return;
        if (String(raw.instructorUid || '').trim() !== instructorUid) return;
        const st = normalizeRole(raw.status);
        if (!SPECIAL_LESSON_ACTIVE_REQUEST_STATUSES[st]) return;
        const linkedLessonId = String(raw.drivingLessonId || '').trim();
        // Linked provisional lesson already represented (or cancelled → not occupying).
        if (linkedLessonId) return;
        const startMs = membershipExpiryToMillis(raw.requestedStartAt);
        const endMs = membershipExpiryToMillis(raw.requestedEndAt);
        const softLessonStatus = st === 'waiting' ? 'pending_admin' : 'pending_instructor';
        const presentation = deriveStudentWeeklyAgendaPresentation(
          Object.assign({}, raw, {
            status: softLessonStatus,
            source: SPECIAL_LESSON_REQUEST_SOURCE_V1,
            __softHoldSpecialRequest: true
          }),
          studentUid,
          nowMs,
          startMs,
          endMs
        );
        if (!presentation) return;
        pushEntry(
          startMs,
          endMs,
          presentation.kind,
          presentation.isPast,
          presentation.approvalStage
        );
      });
    }
    ingestSoftHold(pendingSnap);
    ingestSoftHold(waitingSnap);

    entries.sort((a, b) => {
      const am = Date.parse(String(a.startAt || ''));
      const bm = Date.parse(String(b.startAt || ''));
      return (Number.isFinite(am) ? am : 0) - (Number.isFinite(bm) ? bm : 0);
    });

    return {
      ok: true,
      instructorUid: instructorUid,
      weekStart: weekStartYmd,
      weekStartMs: weekStartMs,
      weekEndMs: weekEndMs,
      entries: entries
    };
  }
);

/**
 * Student: create waiting special lesson request + linked provisional drivingLesson.
 */
exports.createSpecialLessonRequestForStudent = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const instructorUid = (data && data.instructorUid ? String(data.instructorUid) : '').trim();
    const dateYmd = (data && data.dateYmd ? String(data.dateYmd) : '').trim();
    const startTime = (data && data.startTime != null ? String(data.startTime) : '').trim();
    const endTime = (data && data.endTime != null ? String(data.endTime) : '').trim();
    const clientRequestId = parseOptionalSpecialLessonClientRequestId(data);
    if (!instructorUid) {
      throw new HttpsError('invalid-argument', 'instructorUid is required.');
    }
    if (!dateYmd) {
      throw new HttpsError('invalid-argument', 'dateYmd is required.');
    }
    if (!startTime) {
      throw new HttpsError('invalid-argument', 'startTime is required.');
    }
    if (!endTime) {
      throw new HttpsError('invalid-argument', 'endTime is required.');
    }

    // Free HH:mm window (minute-sensitive). Canonical 2h slot lock applies only to
    // getSpecialLessonAvailabilityForStudent slot cards — not agenda-modal create.
    const startHm = normalizeSpecialLessonHm(startTime, 'startTime');
    const endHm = normalizeSpecialLessonHm(endTime, 'endTime');

    const studentCtx = await assertActiveDrivingStudentCaller(callerUid);
    const tenantId = studentCtx.tenantId;
    const studentUid = studentCtx.studentUid;

    if (instructorUid === studentUid) {
      throw new HttpsError('invalid-argument', 'Instructor and student must be different.');
    }

    const instructorCtx = await assertActiveInstructorInTenant(tenantId, instructorUid);
    let slot;
    try {
      slot = buildSpecialLessonWindowFromDateStartEnd(dateYmd, startHm, endHm);
    } catch (err) {
      if (err instanceof HttpsError && err.code === 'invalid-argument') {
        const m = String(err.message || '');
        if (m.indexOf('08:00') !== -1) {
          throw new HttpsError('invalid-argument', 'Ders 08:00 veya sonrasında başlamalıdır.');
        }
        if (m.indexOf('22:00') !== -1) {
          throw new HttpsError('invalid-argument', 'Ders 22:00 veya öncesinde bitmelidir.');
        }
        if (m.indexOf('after start') !== -1 || m.indexOf('same Istanbul date') !== -1) {
          throw new HttpsError('invalid-argument', 'Bitiş saati başlangıçtan sonra olmalıdır.');
        }
        if (/HH:mm|hour is invalid|minutes must|dateYmd must/i.test(m)) {
          throw new HttpsError('invalid-argument', 'Tarih veya saat bilgisi geçersiz.');
        }
      }
      throw err;
    }
    if (!(Number(slot.durationMinutes) > 0)) {
      throw new HttpsError('invalid-argument', 'Bitiş saati başlangıçtan sonra olmalıdır.');
    }
    if (slot.startMs < Date.now()) {
      throw new HttpsError(
        'failed-precondition',
        'Geçmiş tarih veya saat için özel ders talebi oluşturulamaz.'
      );
    }

    const studentNameSnap = safeUserDisplayName(studentCtx.userData);
    const instructorNameSnap = safeUserDisplayName(instructorCtx.userData);

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
      throw new HttpsError('not-found', 'Tenant not found.');
    }
    const tenantAddress = String((tenantSnap.data() || {}).address || '').trim();
    if (!tenantAddress) {
      throw new HttpsError(
        'failed-precondition',
        'Ders adresi gereklidir. Kurum adresini girin veya bu ders için adres yazın.'
      );
    }
    if (tenantAddress.length > DRIVING_LESSON_ADDRESS_MAX) {
      throw new HttpsError('invalid-argument', 'Ders adresi en fazla 500 karakter olabilir.');
    }

    const [lessonRows, pendingRows, studentLessonRows] = await Promise.all([
      queryPotentialOverlaps('instructorUid', instructorUid, tenantId, slot.startMs, slot.endMs),
      queryPotentialPendingSpecialRequestOverlaps(tenantId, instructorUid, slot.startMs, slot.endMs),
      queryPotentialOverlaps('studentUid', studentUid, tenantId, slot.startMs, slot.endMs)
    ]);

    if (findOverlapConflict(lessonRows, slot.startMs, slot.endMs)) {
      throw new HttpsError('failed-precondition', SPECIAL_LESSON_PUBLIC_CONFLICT_MSG);
    }
    if (findOverlapConflict(studentLessonRows, slot.startMs, slot.endMs)) {
      throw new HttpsError('failed-precondition', SPECIAL_LESSON_PUBLIC_CONFLICT_MSG);
    }
    if (findPendingSpecialRequestOverlapConflict(pendingRows, slot.startMs, slot.endMs)) {
      throw new HttpsError('failed-precondition', SPECIAL_LESSON_PUBLIC_CONFLICT_MSG);
    }

    const payloadKey = buildSpecialLessonCreatePayloadKey(
      instructorUid,
      slot.ymd,
      startHm,
      endHm
    );
    const requestRef = clientRequestId
      ? db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION).doc(
        buildSpecialLessonRequestIdempotentDocId(tenantId, studentUid, clientRequestId)
      )
      : db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION).doc();

    if (clientRequestId) {
      const existingRequestSnap = await requestRef.get();
      if (existingRequestSnap.exists) {
        const existingData = existingRequestSnap.data() || {};
        if (String(existingData.tenantId || '').trim() !== tenantId
          || String(existingData.studentUid || '').trim() !== studentUid) {
          throw new HttpsError('already-exists', 'clientRequestId conflict.');
        }
        const storedPayloadKey = String(existingData.clientRequestPayloadKey || '').trim();
        let payloadMatches = false;
        if (storedPayloadKey) {
          payloadMatches = storedPayloadKey === payloadKey;
        } else {
          const exStartMs = membershipExpiryToMillis(existingData.requestedStartAt);
          const exEndMs = membershipExpiryToMillis(existingData.requestedEndAt);
          payloadMatches = String(existingData.instructorUid || '').trim() === instructorUid
            && Number(exStartMs) === Number(slot.startMs)
            && Number(exEndMs) === Number(slot.endMs);
        }
        if (!payloadMatches) {
          throw new HttpsError(
            'invalid-argument',
            'clientRequestId başka bir özel ders talebi için kullanılmış.'
          );
        }
        return {
          ok: true,
          requestId: existingRequestSnap.id,
          status: normalizeStudentFacingSpecialRequestStatus(existingData.status) || 'waiting',
          drivingLessonId: String(existingData.drivingLessonId || '').trim() || null,
          idempotentReplay: true
        };
      }
    }

    const preferredSlotKey = tenantId + '_' + instructorUid + '_' + String(slot.startMs);
    let lessonRef = db.collection('drivingLessons').doc(preferredSlotKey);
    let instructorSlotKey = preferredSlotKey;

    const preferredSnap = await lessonRef.get();
    if (preferredSnap.exists) {
      const preferredData = preferredSnap.data() || {};
      if (lessonBlocksOverlap(preferredData.status)) {
        const preferredStart = membershipExpiryToMillis(preferredData.startAt);
        const preferredEnd = membershipExpiryToMillis(preferredData.endAt);
        const preferredOverlaps = preferredStart != null && preferredEnd != null &&
          intervalsOverlap(preferredStart, preferredEnd, slot.startMs, slot.endMs);
        if (preferredOverlaps || preferredStart === slot.startMs) {
          throw new HttpsError('failed-precondition', SPECIAL_LESSON_PUBLIC_CONFLICT_MSG);
        }
        lessonRef = db.collection('drivingLessons').doc();
        instructorSlotKey = lessonRef.id;
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    let createdRequestId = requestRef.id;
    let createdLessonId = lessonRef.id;
    let createdNew = false;

    try {
      await db.runTransaction(async (tx) => {
        const lookbackStart = admin.firestore.Timestamp.fromMillis(
          slot.startMs - DRIVING_LESSON_OVERLAP_LOOKBACK_MS
        );
        const endTs = admin.firestore.Timestamp.fromMillis(slot.endMs);

        const lessonQuery = db.collection('drivingLessons')
          .where('tenantId', '==', tenantId)
          .where('instructorUid', '==', instructorUid)
          .where('startAt', '>=', lookbackStart)
          .where('startAt', '<', endTs);
        const studentLessonQuery = db.collection('drivingLessons')
          .where('tenantId', '==', tenantId)
          .where('studentUid', '==', studentUid)
          .where('startAt', '>=', lookbackStart)
          .where('startAt', '<', endTs);
        const pendingQuery = db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION)
          .where('tenantId', '==', tenantId)
          .where('instructorUid', '==', instructorUid)
          .where('status', '==', 'pending')
          .where('requestedStartAt', '>=', lookbackStart)
          .where('requestedStartAt', '<', endTs);
        const waitingQuery = db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION)
          .where('tenantId', '==', tenantId)
          .where('instructorUid', '==', instructorUid)
          .where('status', '==', 'waiting')
          .where('requestedStartAt', '>=', lookbackStart)
          .where('requestedStartAt', '<', endTs);

        const [lessonSnap, studentLessonSnap, pendingSnap, waitingSnap, existingLessonSnap, existingRequestSnap] = await Promise.all([
          tx.get(lessonQuery),
          tx.get(studentLessonQuery),
          tx.get(pendingQuery),
          tx.get(waitingQuery),
          tx.get(lessonRef),
          tx.get(requestRef)
        ]);

        if (existingRequestSnap.exists) {
          const existingData = existingRequestSnap.data() || {};
          if (String(existingData.tenantId || '').trim() !== tenantId
            || String(existingData.studentUid || '').trim() !== studentUid) {
            throw new HttpsError('already-exists', 'clientRequestId conflict.');
          }
          const storedPayloadKey = String(existingData.clientRequestPayloadKey || '').trim();
          let payloadMatches = false;
          if (storedPayloadKey) {
            payloadMatches = storedPayloadKey === payloadKey;
          } else {
            const exStartMs = membershipExpiryToMillis(existingData.requestedStartAt);
            const exEndMs = membershipExpiryToMillis(existingData.requestedEndAt);
            payloadMatches = String(existingData.instructorUid || '').trim() === instructorUid
              && Number(exStartMs) === Number(slot.startMs)
              && Number(exEndMs) === Number(slot.endMs);
          }
          if (!payloadMatches) {
            throw new HttpsError(
              'invalid-argument',
              'clientRequestId başka bir özel ders talebi için kullanılmış.'
            );
          }
          createdRequestId = existingRequestSnap.id;
          createdLessonId = String(existingData.drivingLessonId || '').trim() || lessonRef.id;
          createdNew = false;
          return;
        }

        const txLessonRows = (lessonSnap.docs || [])
          .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
          .filter((row) => row.id !== lessonRef.id);
        const txStudentRows = (studentLessonSnap.docs || [])
          .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
          .filter((row) => row.id !== lessonRef.id);
        const txRequestRows = []
          .concat((pendingSnap.docs || []).map((doc) => ({ id: doc.id, ...(doc.data() || {}) })))
          .concat((waitingSnap.docs || []).map((doc) => ({ id: doc.id, ...(doc.data() || {}) })));

        if (findOverlapConflict(txLessonRows, slot.startMs, slot.endMs)) {
          throw new HttpsError('failed-precondition', SPECIAL_LESSON_PUBLIC_CONFLICT_MSG);
        }
        if (findOverlapConflict(txStudentRows, slot.startMs, slot.endMs)) {
          throw new HttpsError('failed-precondition', SPECIAL_LESSON_PUBLIC_CONFLICT_MSG);
        }
        if (findPendingSpecialRequestOverlapConflict(txRequestRows, slot.startMs, slot.endMs)) {
          throw new HttpsError('failed-precondition', SPECIAL_LESSON_PUBLIC_CONFLICT_MSG);
        }

        if (existingLessonSnap.exists) {
          const existing = existingLessonSnap.data() || {};
          if (lessonBlocksOverlap(existing.status)) {
            throw new HttpsError('failed-precondition', SPECIAL_LESSON_PUBLIC_CONFLICT_MSG);
          }
        }

        const requestPayload = {
          tenantId: tenantId,
          studentUid: studentUid,
          studentNameSnap: studentNameSnap,
          instructorUid: instructorUid,
          instructorNameSnap: instructorNameSnap,
          requestedStartAt: slot.startTs,
          requestedEndAt: slot.endTs,
          durationMinutes: slot.durationMinutes,
          status: 'waiting',
          adminDecision: 'pending',
          instructorDecision: 'pending',
          source: SPECIAL_LESSON_REQUEST_SOURCE_V1,
          createdBy: studentUid,
          createdAt: now,
          updatedAt: now,
          drivingLessonId: lessonRef.id,
          clientRequestPayloadKey: payloadKey
        };
        if (clientRequestId) {
          requestPayload.clientRequestId = clientRequestId;
        }

        const lessonPayload = {
          tenantId: tenantId,
          instructorUid: instructorUid,
          studentUid: studentUid,
          studentNameSnap: studentNameSnap,
          instructorNameSnap: instructorNameSnap,
          startAt: slot.startTs,
          endAt: slot.endTs,
          durationMinutes: slot.durationMinutes,
          lessonAddress: tenantAddress,
          addressSource: 'tenant_default',
          status: 'pending_instructor',
          source: SPECIAL_LESSON_DRIVING_SOURCE,
          specialLessonRequestId: requestRef.id,
          createdBy: studentUid,
          createdAt: now,
          updatedAt: now,
          instructorSlotKey: instructorSlotKey
        };

        tx.set(requestRef, requestPayload);
        if (existingLessonSnap.exists) {
          const prev = existingLessonSnap.data() || {};
          tx.set(lessonRef, Object.assign({}, lessonPayload, {
            createdAt: prev.createdAt || now,
            createdBy: prev.createdBy || studentUid
          }), { merge: false });
        } else {
          tx.set(lessonRef, lessonPayload);
        }

        createdRequestId = requestRef.id;
        createdLessonId = lessonRef.id;
        createdNew = true;
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for special lesson create. Deploy firestore.indexes.json.'
        );
      }
      console.error('[SpecialLessonCreate] failed', {
        code: e && e.code ? String(e.code) : null,
        message: msg
      });
      throw new HttpsError('internal', 'Özel ders talebi oluşturulamadı. Lütfen tekrar deneyin.');
    }

    if (createdNew) {
      const assignedSlotLabel = formatDrivingLessonSlotPreview(slot.startMs, slot.endMs);
      const assignedPreview = studentNameSnap && assignedSlotLabel
        ? (studentNameSnap + ' için ' + assignedSlotLabel + ' özel ders talebi oluşturuldu.')
        : (assignedSlotLabel
          ? (assignedSlotLabel + ' için özel ders talebi oluşturuldu.')
          : 'Yeni özel ders talebi oluşturuldu.');
      const agendaWeekStart = formatDrivingLessonAgendaWeekStartYmd(slot.startMs);
      const createNotifPayloads = [
        buildInstructorDrivingLessonNotification({
          type: 'lesson_assigned',
          tenantId: tenantId,
          recipientUid: instructorUid,
          recipientRole: 'instructor',
          actorUid: studentUid,
          actorRole: 'student',
          lessonId: createdLessonId,
          instructorUid: instructorUid,
          studentUid: studentUid,
          studentName: studentNameSnap,
          title: 'Özel Ders Talebi',
          preview: assignedPreview,
          agendaWeekStart: agendaWeekStart,
          specialLessonRequestId: createdRequestId
        })
      ];
      const createAdminUids = await listActiveInstitutionAdminUidsForTenant(tenantId);
      createAdminUids.forEach((adminUid) => {
        createNotifPayloads.push(buildInstructorDrivingLessonNotification({
          type: 'lesson_assigned',
          tenantId: tenantId,
          recipientUid: adminUid,
          recipientRole: 'institution_admin',
          actorUid: studentUid,
          actorRole: 'student',
          lessonId: createdLessonId,
          instructorUid: instructorUid,
          studentUid: studentUid,
          studentName: studentNameSnap,
          title: 'Yeni Özel Ders Talebi',
          preview: assignedPreview,
          agendaWeekStart: agendaWeekStart,
          specialLessonRequestId: createdRequestId
        }));
      });
      await writeDrivingLessonNotificationDocs(createNotifPayloads);
    }

    return {
      ok: true,
      requestId: createdRequestId,
      status: 'waiting',
      drivingLessonId: createdLessonId
    };
  }
);

/**
 * Student: list own special lesson requests (newest first) — safe derived status only.
 * Hides cancelled/withdrawn/removed and orphaned linked lessons.
 */
exports.listMySpecialLessonRequestsForStudent = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { tenantId, studentUid } = await assertActiveDrivingStudentCaller(callerUid);

    const snap = await db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION)
      .where('tenantId', '==', tenantId)
      .where('studentUid', '==', studentUid)
      .orderBy('createdAt', 'desc')
      .get();

    const docs = snap.docs || [];
    const lessonIds = [];
    const seenLesson = Object.create(null);
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i].data() || {};
      const st = normalizeStudentFacingSpecialRequestStatus(d.status);
      if (st === 'cancelled') continue;
      const lid = String(d.drivingLessonId || '').trim();
      if (lid && !seenLesson[lid]) {
        seenLesson[lid] = true;
        lessonIds.push(lid);
      }
    }

    const lessonMetaById = Object.create(null);
    await Promise.all(lessonIds.map(async (lid) => {
      try {
        const ls = await db.collection('drivingLessons').doc(lid).get();
        if (!ls.exists) {
          lessonMetaById[lid] = { status: '__missing__', completedAt: null };
          return;
        }
        const ld = ls.data() || {};
        lessonMetaById[lid] = {
          status: normalizeRole(ld.status),
          completedAt: serializeSpecialRequestTs(ld.completedAt)
        };
      } catch (_) {
        lessonMetaById[lid] = { status: '__missing__', completedAt: null };
      }
    }));

    const requests = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const d = doc.data() || {};
      const st = normalizeStudentFacingSpecialRequestStatus(d.status);
      if (st === 'cancelled') continue;
      const lid = String(d.drivingLessonId || '').trim();
      let lessonStatus = '';
      let completedAt = null;
      if (lid) {
        const meta = lessonMetaById[lid] || {};
        const ls = String(meta.status || '').trim().toLowerCase();
        lessonStatus = ls === '__missing__' ? '' : ls;
        completedAt = meta.completedAt || null;
        if (ls === '__missing__' || ls === 'cancelled' || ls === 'completed') continue;
        if (completedAt) continue;
      }
      const row = {
        requestId: doc.id,
        instructorUid: String(d.instructorUid || '').trim(),
        instructorName: d.instructorNameSnap != null
          ? String(d.instructorNameSnap).trim()
          : '',
        requestedStartAt: serializeSpecialRequestTs(d.requestedStartAt),
        requestedEndAt: serializeSpecialRequestTs(d.requestedEndAt),
        durationMinutes: Number(d.durationMinutes) || 0,
        status: st,
        createdAt: serializeSpecialRequestTs(d.createdAt)
      };
      if (lid) {
        row.lessonId = lid;
        row.lessonStatus = lessonStatus;
        if (completedAt) row.completedAt = completedAt;
      }
      requests.push(row);
    }

    return {
      ok: true,
      requests: collapseStudentSpecialLessonRequestDuplicates(requests)
    };
  }
);

/* -------------------------------------------------------------------------- */
/* Phase 2A — Special lesson requests (Institution Admin list/approve/reject) */
/* -------------------------------------------------------------------------- */

/**
 * Load specialLessonRequests/{requestId} and assert same-tenant Institution Admin.
 * @param {string} callerUid
 * @param {string} requestId
 * @returns {Promise<{ requestId: string, tenantId: string, requestRef: FirebaseFirestore.DocumentReference, requestData: object }>}
 */
async function loadSpecialLessonRequestForInstitutionAdmin(callerUid, requestId) {
  const rid = String(requestId || '').trim();
  if (!rid) {
    throw new HttpsError('invalid-argument', 'requestId is required.');
  }
  const requestRef = db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION).doc(rid);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpsError('not-found', 'Özel ders talebi bulunamadı.');
  }
  const requestData = requestSnap.data() || {};
  const tenantId = String(requestData.tenantId || '').trim();
  if (!tenantId) {
    throw new HttpsError('failed-precondition', 'Özel ders talebi geçersiz.');
  }
  await assertActiveInstitutionAdminForTenant(callerUid, tenantId);
  return {
    requestId: rid,
    tenantId: tenantId,
    requestRef: requestRef,
    requestData: requestData
  };
}

/**
 * Institution Admin: list special lesson requests for own tenant (newest first).
 */
exports.listSpecialLessonRequestsForInstitutionAdmin = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    await assertActiveInstitutionAdminForTenant(callerUid, tenantId);

    let snap;
    try {
      snap = await db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION)
        .where('tenantId', '==', tenantId)
        .orderBy('createdAt', 'desc')
        .get();
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for specialLessonRequests admin list. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to list special lesson requests.'
      );
    }

    const rows = (snap.docs || []).map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const instructorUids = [...new Set(
      rows.map((r) => String(r.instructorUid || '').trim()).filter(Boolean)
    )];
    const usersMap = {};
    await Promise.all(instructorUids.map(async (uid) => {
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) usersMap[uid] = userSnap.data() || {};
    }));

    const requests = rows.map((d) => {
      const instructorUid = String(d.instructorUid || '').trim();
      const instructorUser = usersMap[instructorUid] || {};
      const adminDecision = normalizeRole(d.adminDecision) || 'pending';
      const instructorDecision = normalizeRole(d.instructorDecision) || 'pending';
      const derivedStatus = deriveSpecialRequestStatus(d);
      if (derivedStatus === 'cancelled') return null;
      const out = {
        requestId: String(d.id || '').trim(),
        studentUid: String(d.studentUid || '').trim(),
        studentName: d.studentNameSnap != null ? String(d.studentNameSnap).trim() : '',
        instructorUid: instructorUid,
        instructorName: d.instructorNameSnap != null ? String(d.instructorNameSnap).trim() : '',
        instructorPhotoUrl: safeUserPhotoUrl(instructorUser),
        requestedStartAt: serializeSpecialRequestTs(d.requestedStartAt),
        requestedEndAt: serializeSpecialRequestTs(d.requestedEndAt),
        durationMinutes: Number(d.durationMinutes) || 0,
        status: derivedStatus,
        adminDecision: adminDecision === 'approved' || adminDecision === 'rejected'
          ? adminDecision
          : 'pending',
        instructorDecision: instructorDecision === 'approved' || instructorDecision === 'consultation'
          ? instructorDecision
          : 'pending',
        createdAt: serializeSpecialRequestTs(d.createdAt)
      };
      const reviewedAt = serializeSpecialRequestTs(d.reviewedAt);
      if (reviewedAt) out.reviewedAt = reviewedAt;
      const adminRespondedAt = serializeSpecialRequestTs(d.adminRespondedAt);
      if (adminRespondedAt) out.adminRespondedAt = adminRespondedAt;
      const instructorRespondedAt = serializeSpecialRequestTs(d.instructorRespondedAt);
      if (instructorRespondedAt) out.instructorRespondedAt = instructorRespondedAt;
      if (d.instructorResponseNote != null && String(d.instructorResponseNote).trim()) {
        out.instructorResponseNote = String(d.instructorResponseNote).trim();
      }
      if (d.rejectReason != null && String(d.rejectReason).trim()) {
        out.rejectReason = String(d.rejectReason).trim();
      }
      if (d.drivingLessonId != null && String(d.drivingLessonId).trim()) {
        out.drivingLessonId = String(d.drivingLessonId).trim();
      }
      return out;
    }).filter(Boolean);

    return {
      ok: true,
      tenantId: tenantId,
      requests: requests
    };
  }
);

/**
 * Institution Admin: final-approve special request ONLY after Instructor approved.
 */
exports.approveSpecialLessonRequestForInstitutionAdmin = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const requestId = (data && data.requestId ? String(data.requestId) : '').trim();
    const loaded = await loadSpecialLessonRequestForInstitutionAdmin(callerUid, requestId);
    const tenantId = loaded.tenantId;
    const requestRef = loaded.requestRef;
    const requestData = loaded.requestData;
    const status = deriveSpecialRequestStatus(requestData);
    const existingLessonId = String(requestData.drivingLessonId || '').trim();
    const adminDecisionExisting = normalizeRole(requestData.adminDecision);
    const instructorDecisionExisting = normalizeRole(requestData.instructorDecision) || 'pending';

    if (status === 'approved' || adminDecisionExisting === 'approved') {
      const instructorDecision = instructorDecisionExisting;
      return {
        ok: true,
        requestId: requestId,
        status: (adminDecisionExisting === 'approved' && instructorDecision === 'approved')
          ? 'approved'
          : (status === 'approved' ? 'approved' : 'waiting'),
        adminDecision: 'approved',
        instructorDecision: instructorDecision,
        drivingLessonId: existingLessonId || null
      };
    }
    if (status === 'rejected' || adminDecisionExisting === 'rejected') {
      throw new HttpsError('failed-precondition', 'Reddedilmiş talep onaylanamaz.');
    }
    if (status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'İptal edilmiş talep onaylanamaz.');
    }
    if (!isSpecialRequestOpenForAdminDecision(requestData)) {
      throw new HttpsError('failed-precondition', 'Yalnızca bekleyen talepler onaylanabilir.');
    }
    if (instructorDecisionExisting !== 'approved') {
      throw new HttpsError(
        'failed-precondition',
        'Özel ders, Usta Öğretici onayı tamamlanmadan kurum tarafından onaylanamaz.'
      );
    }
    if (!existingLessonId) {
      throw new HttpsError(
        'failed-precondition',
        'Özel ders talebine bağlı geçici ders kaydı bulunamadı.'
      );
    }

    const lessonRef = db.collection('drivingLessons').doc(existingLessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) {
      throw new HttpsError('not-found', 'Bağlı direksiyon dersi bulunamadı.');
    }
    const lesson = lessonSnap.data() || {};
    if (String(lesson.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Bağlı ders bu kuruma ait değil.');
    }
    if (String(lesson.specialLessonRequestId || '').trim() !== requestId) {
      throw new HttpsError('failed-precondition', 'Bağlı ders talep bağlantısı geçersiz.');
    }
    if (normalizeRole(lesson.source) !== SPECIAL_LESSON_DRIVING_SOURCE) {
      throw new HttpsError('failed-precondition', 'Bağlı ders özel ders kaynağı değil.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    let outStatus = 'approved';
    let outInstructorDecision = 'approved';
    let outLessonStatus = 'confirmed';

    try {
      await db.runTransaction(async (tx) => {
        const freshReqSnap = await tx.get(requestRef);
        if (!freshReqSnap.exists) {
          throw new HttpsError('not-found', 'Özel ders talebi bulunamadı.');
        }
        const freshReq = freshReqSnap.data() || {};
        const freshStatus = deriveSpecialRequestStatus(freshReq);
        const freshAdmin = normalizeRole(freshReq.adminDecision);
        outInstructorDecision = normalizeRole(freshReq.instructorDecision) || 'pending';

        if (freshStatus === 'approved' || freshAdmin === 'approved') {
          outStatus = (freshAdmin === 'approved' && outInstructorDecision === 'approved')
            ? 'approved'
            : (freshStatus === 'approved' ? 'approved' : 'waiting');
          return;
        }
        if (freshStatus === 'rejected' || freshAdmin === 'rejected') {
          throw new HttpsError('failed-precondition', 'Reddedilmiş talep onaylanamaz.');
        }
        if (freshStatus === 'cancelled') {
          throw new HttpsError('failed-precondition', 'İptal edilmiş talep onaylanamaz.');
        }
        if (!isSpecialRequestOpenForAdminDecision(freshReq)) {
          throw new HttpsError('failed-precondition', 'Yalnızca bekleyen talepler onaylanabilir.');
        }
        if (outInstructorDecision !== 'approved') {
          throw new HttpsError(
            'failed-precondition',
            'Özel ders, Usta Öğretici onayı tamamlanmadan kurum tarafından onaylanamaz.'
          );
        }

        const freshLessonSnap = await tx.get(lessonRef);
        if (!freshLessonSnap.exists) {
          throw new HttpsError('not-found', 'Bağlı direksiyon dersi bulunamadı.');
        }
        const freshLesson = freshLessonSnap.data() || {};
        if (String(freshLesson.tenantId || '').trim() !== tenantId) {
          throw new HttpsError('permission-denied', 'Bağlı ders bu kuruma ait değil.');
        }
        if (String(freshLesson.specialLessonRequestId || '').trim() !== requestId) {
          throw new HttpsError('failed-precondition', 'Bağlı ders talep bağlantısı geçersiz.');
        }
        const lessonStatus = normalizeRole(freshLesson.status);
        if (lessonStatus === 'cancelled') {
          throw new HttpsError('failed-precondition', 'İptal edilmiş ders onaylanamaz.');
        }

        outStatus = 'approved';

        tx.set(requestRef, {
          adminDecision: 'approved',
          adminRespondedAt: now,
          adminRespondedBy: callerUid,
          reviewedBy: callerUid,
          reviewedAt: now,
          updatedAt: now,
          status: outStatus,
          drivingLessonId: lessonRef.id
        }, { merge: true });

        if (lessonStatus !== 'completed') {
          tx.update(lessonRef, {
            status: 'confirmed',
            specialFinalApprovedAt: now,
            updatedAt: now
          });
          outLessonStatus = 'confirmed';
        } else {
          outLessonStatus = lessonStatus;
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[SpecialLessonApprove] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Özel ders talebi onaylanamadı. Lütfen tekrar deneyin.');
    }

    const instructorUidNotify = String(
      (requestData && requestData.instructorUid) || (lesson && lesson.instructorUid) || ''
    ).trim();
    if (instructorUidNotify && outStatus === 'approved') {
      const finalStartMs = drivingLessonNotificationStartMs(lesson);
      const finalSlotLabel = formatDrivingLessonSlotPreview(
        finalStartMs,
        drivingLessonNotificationEndMs(lesson)
      );
      const finalStudentName = String(lesson.studentNameSnap || requestData.studentNameSnap || '').trim();
      const finalPreview = finalStudentName && finalSlotLabel
        ? (finalStudentName + ' için ' + finalSlotLabel + ' özel dersi kurum tarafından onaylandı.')
        : (finalSlotLabel
          ? (finalSlotLabel + ' özel dersi kurum tarafından onaylandı.')
          : 'Özel ders talebi kurum tarafından onaylandı.');
      await writeDrivingLessonNotificationDocs([
        buildInstructorDrivingLessonNotification({
          type: 'lesson_confirmed',
          tenantId: tenantId,
          recipientUid: instructorUidNotify,
          recipientRole: 'instructor',
          actorUid: callerUid,
          actorRole: 'institution_admin',
          lessonId: existingLessonId,
          instructorUid: instructorUidNotify,
          studentUid: String(lesson.studentUid || requestData.studentUid || '').trim(),
          studentName: finalStudentName,
          title: 'Özel Ders Onaylandı',
          preview: finalPreview,
          agendaWeekStart: formatDrivingLessonAgendaWeekStartYmd(finalStartMs),
          fingerprint: 'special_final_admin'
        })
      ]);
    }

    return {
      ok: true,
      requestId: requestId,
      status: outStatus,
      adminDecision: 'approved',
      instructorDecision: outInstructorDecision,
      drivingLessonId: existingLessonId,
      lessonStatus: outLessonStatus
    };
  }
);

/**
 * Institution Admin: reject special request (terminal) + cancel linked provisional lesson.
 */
exports.rejectSpecialLessonRequestForInstitutionAdmin = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const requestId = (data && data.requestId ? String(data.requestId) : '').trim();
    const reasonRaw = data && Object.prototype.hasOwnProperty.call(data, 'reason')
      ? data.reason
      : null;

    let rejectReason = null;
    if (reasonRaw != null && String(reasonRaw).trim()) {
      rejectReason = String(reasonRaw).trim().replace(/\s+/g, ' ');
      if (rejectReason.length > SPECIAL_LESSON_REJECT_REASON_MAX) {
        throw new HttpsError(
          'invalid-argument',
          'Red gerekçesi en fazla ' + SPECIAL_LESSON_REJECT_REASON_MAX + ' karakter olabilir.'
        );
      }
    }

    const loaded = await loadSpecialLessonRequestForInstitutionAdmin(callerUid, requestId);
    const tenantId = loaded.tenantId;
    const requestRef = loaded.requestRef;
    const requestData = loaded.requestData;
    const status = deriveSpecialRequestStatus(requestData);
    const adminDecisionExisting = normalizeRole(requestData.adminDecision);
    const lessonId = String(requestData.drivingLessonId || '').trim();

    if (status === 'rejected' || adminDecisionExisting === 'rejected') {
      return {
        ok: true,
        requestId: requestId,
        status: 'rejected',
        adminDecision: 'rejected'
      };
    }
    if (status === 'approved') {
      throw new HttpsError('failed-precondition', 'Onaylanmış talep reddedilemez.');
    }
    if (status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'İptal edilmiş talep reddedilemez.');
    }
    if (!isSpecialRequestOpenForAdminDecision(requestData)) {
      throw new HttpsError('failed-precondition', 'Yalnızca bekleyen talepler reddedilebilir.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    let cancelledLessonId = '';

    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(requestRef);
        if (!freshSnap.exists) {
          throw new HttpsError('not-found', 'Özel ders talebi bulunamadı.');
        }
        const fresh = freshSnap.data() || {};
        const freshStatus = deriveSpecialRequestStatus(fresh);
        const freshAdmin = normalizeRole(fresh.adminDecision);
        if (freshStatus === 'rejected' || freshAdmin === 'rejected') {
          return;
        }
        if (freshStatus === 'approved') {
          throw new HttpsError('failed-precondition', 'Onaylanmış talep reddedilemez.');
        }
        if (freshStatus === 'cancelled') {
          throw new HttpsError('failed-precondition', 'İptal edilmiş talep reddedilemez.');
        }
        if (!isSpecialRequestOpenForAdminDecision(fresh)) {
          throw new HttpsError('failed-precondition', 'Yalnızca bekleyen talepler reddedilebilir.');
        }

        const patch = {
          adminDecision: 'rejected',
          status: 'rejected',
          adminRespondedAt: now,
          adminRespondedBy: callerUid,
          reviewedBy: callerUid,
          reviewedAt: now,
          updatedAt: now
        };
        if (rejectReason) {
          patch.rejectReason = rejectReason;
        }
        tx.set(requestRef, patch, { merge: true });

        const linkedLessonId = String(fresh.drivingLessonId || lessonId || '').trim();
        if (!linkedLessonId) return;
        const lessonRef = db.collection('drivingLessons').doc(linkedLessonId);
        const lessonSnap = await tx.get(lessonRef);
        if (!lessonSnap.exists) return;
        const lesson = lessonSnap.data() || {};
        if (String(lesson.tenantId || '').trim() !== tenantId) return;
        if (String(lesson.specialLessonRequestId || '').trim() !== requestId) return;
        const lessonStatus = normalizeRole(lesson.status);
        if (lessonStatus === 'cancelled' || lessonStatus === 'completed') return;
        if (!(DRIVING_LESSON_CANCELLABLE_STATUSES[lessonStatus] || lessonStatus === 'confirmed')) {
          return;
        }
        tx.update(lessonRef, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: callerUid,
          updatedAt: now
        });
        cancelledLessonId = linkedLessonId;
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('[SpecialLessonReject] failed', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : String(e)
      });
      throw new HttpsError('internal', 'Özel ders talebi reddedilemedi. Lütfen tekrar deneyin.');
    }

    return {
      ok: true,
      requestId: requestId,
      status: 'rejected',
      adminDecision: 'rejected',
      cancelledLessonId: cancelledLessonId || null
    };
  }
);

/**
 * Institution Admin: soft-remove special request (cancelled) + linked special lesson only.
 * Allows missing/cancelled linked lessons. May close own final-approved special lesson.
 * Never touches admin_manual / unrelated lessons.
 */
exports.removeSpecialLessonRequestForInstitutionAdmin = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const requestId = (data && data.requestId ? String(data.requestId) : '').trim();
    const loaded = await loadSpecialLessonRequestForInstitutionAdmin(callerUid, requestId);
    const tenantId = loaded.tenantId;
    const requestRef = loaded.requestRef;
    const requestData = loaded.requestData;
    const status = deriveSpecialRequestStatus(requestData);
    const lessonId = String(requestData.drivingLessonId || '').trim();

    if (status === 'cancelled') {
      return {
        ok: true,
        requestId: requestId,
        status: 'cancelled',
        cancelledLessonId: lessonId || null
      };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    let cancelledLessonId = '';

    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(requestRef);
        if (!freshSnap.exists) {
          throw new HttpsError('not-found', 'Özel ders talebi bulunamadı.');
        }
        const fresh = freshSnap.data() || {};
        const freshStatus = deriveSpecialRequestStatus(fresh);
        if (freshStatus === 'cancelled') return;

        const linkedLessonId = String(fresh.drivingLessonId || lessonId || '').trim();
        let lessonRef = null;
        let lessonSnap = null;
        let lesson = null;
        if (linkedLessonId) {
          lessonRef = db.collection('drivingLessons').doc(linkedLessonId);
          lessonSnap = await tx.get(lessonRef);
          if (lessonSnap.exists) {
            lesson = lessonSnap.data() || {};
          }
        }

        tx.set(requestRef, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'institution_admin',
          cancellationType: 'removed_by_admin',
          cancelledByUid: callerUid,
          updatedAt: now
        }, { merge: true });

        if (!lessonRef || !lessonSnap || !lessonSnap.exists || !lesson) return;
        if (String(lesson.tenantId || '').trim() !== tenantId) return;
        if (String(lesson.specialLessonRequestId || '').trim() !== requestId) return;
        if (!isSpecialDrivingLessonDoc(lesson)) return;
        if (normalizeRole(lesson.source) === 'admin_manual') return;
        const lessonStatus = normalizeRole(lesson.status);
        if (lessonStatus === 'cancelled') return;
        if (lessonStatus === 'completed') return;
        tx.update(lessonRef, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: callerUid,
          updatedAt: now
        });
        cancelledLessonId = linkedLessonId;
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError('internal', 'Özel ders talebi kaldırılamadı. Lütfen tekrar deneyin.');
    }

    return {
      ok: true,
      requestId: requestId,
      status: 'cancelled',
      cancelledLessonId: cancelledLessonId || null
    };
  }
);

/**
 * Student: withdraw own waiting special lesson request (soft cancel).
 * Cancels exact logical duplicates owned by the same student in one transaction.
 */
exports.withdrawSpecialLessonRequestForStudent = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const data = request && request.data ? request.data : {};
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const requestId = (data && data.requestId ? String(data.requestId) : '').trim();
    if (!requestId) {
      throw new HttpsError('invalid-argument', 'requestId is required.');
    }

    const { tenantId, studentUid } = await assertActiveDrivingStudentCaller(callerUid);
    const primaryRef = db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION).doc(requestId);
    const primarySnap = await primaryRef.get();
    if (!primarySnap.exists) {
      throw new HttpsError('not-found', 'Özel ders talebi bulunamadı.');
    }
    const primaryData = primarySnap.data() || {};
    if (String(primaryData.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('permission-denied', 'Bu talep bu kuruma ait değil.');
    }
    if (String(primaryData.studentUid || '').trim() !== studentUid) {
      throw new HttpsError('permission-denied', 'Bu talep size ait değil.');
    }

    const primaryStatus = deriveSpecialRequestStatus(primaryData);
    if (primaryStatus === 'cancelled') {
      return { ok: true, requestId: requestId, status: 'cancelled' };
    }
    if (primaryStatus === 'approved') {
      throw new HttpsError(
        'failed-precondition',
        'Onaylanmış özel ders talebi öğrenci tarafından geri çekilemez.'
      );
    }
    if (primaryStatus === 'rejected') {
      throw new HttpsError('failed-precondition', 'Reddedilmiş talep geri çekilemez.');
    }
    if (primaryStatus !== 'waiting') {
      throw new HttpsError('failed-precondition', 'Bu talep geri çekilemez.');
    }

    const logicalKey = buildSpecialLessonLogicalDuplicateKey(primaryData);
    if (!logicalKey || logicalKey.indexOf('||') !== -1 || /\|$/.test(logicalKey)) {
      throw new HttpsError('failed-precondition', 'Bu talep geri çekilemez.');
    }

    let ownSnap;
    try {
      ownSnap = await db.collection(SPECIAL_LESSON_REQUESTS_COLLECTION)
        .where('tenantId', '==', tenantId)
        .where('studentUid', '==', studentUid)
        .orderBy('createdAt', 'desc')
        .get();
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for special lesson withdraw. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError('internal', 'Özel ders talebi geri çekilemedi. Lütfen tekrar deneyin.');
    }

    const candidateRefs = [];
    const candidateIds = Object.create(null);
    (ownSnap.docs || []).forEach((doc) => {
      if (!doc || !doc.id) return;
      const d = doc.data() || {};
      if (String(d.tenantId || '').trim() !== tenantId) return;
      if (String(d.studentUid || '').trim() !== studentUid) return;
      if (buildSpecialLessonLogicalDuplicateKey(d) !== logicalKey) return;
      const st = deriveSpecialRequestStatus(d);
      if (st === 'cancelled' || st === 'rejected' || st === 'approved') return;
      if (st !== 'waiting') return;
      if (candidateIds[doc.id]) return;
      candidateIds[doc.id] = true;
      candidateRefs.push(doc.ref);
    });
    if (!candidateIds[requestId]) {
      candidateRefs.push(primaryRef);
      candidateIds[requestId] = true;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const cancelledRequestIds = [];
    const cancelledLessonIds = [];

    try {
      await db.runTransaction(async (tx) => {
        const requestSnaps = await Promise.all(candidateRefs.map((ref) => tx.get(ref)));
        const toCancelRequests = [];
        const lessonIdSet = Object.create(null);
        const requestIdSet = Object.create(null);

        for (let i = 0; i < requestSnaps.length; i++) {
          const snap = requestSnaps[i];
          if (!snap || !snap.exists) continue;
          const fresh = snap.data() || {};
          if (String(fresh.tenantId || '').trim() !== tenantId) continue;
          if (String(fresh.studentUid || '').trim() !== studentUid) continue;
          if (buildSpecialLessonLogicalDuplicateKey(fresh) !== logicalKey) continue;
          const freshStatus = deriveSpecialRequestStatus(fresh);
          if (freshStatus === 'cancelled') continue;
          if (freshStatus === 'approved') {
            throw new HttpsError(
              'failed-precondition',
              'Onaylanmış özel ders talebi öğrenci tarafından geri çekilemez.'
            );
          }
          if (freshStatus === 'rejected') continue;
          if (freshStatus !== 'waiting') continue;
          toCancelRequests.push({ ref: snap.ref, id: snap.id, data: fresh });
          requestIdSet[snap.id] = true;
          const lid = String(fresh.drivingLessonId || '').trim();
          if (lid) lessonIdSet[lid] = true;
        }

        if (!toCancelRequests.length) {
          return;
        }

        const lessonIds = Object.keys(lessonIdSet);
        const lessonRefs = lessonIds.map((id) => db.collection('drivingLessons').doc(id));
        const lessonSnaps = lessonRefs.length
          ? await Promise.all(lessonRefs.map((ref) => tx.get(ref)))
          : [];

        const cancelPatch = {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'student',
          cancellationType: 'withdrawn_by_student',
          cancelledByUid: studentUid,
          updatedAt: now
        };

        for (let r = 0; r < toCancelRequests.length; r++) {
          tx.set(toCancelRequests[r].ref, cancelPatch, { merge: true });
          cancelledRequestIds.push(toCancelRequests[r].id);
        }

        for (let li = 0; li < lessonSnaps.length; li++) {
          const lessonSnap = lessonSnaps[li];
          if (!lessonSnap || !lessonSnap.exists) continue;
          const lesson = lessonSnap.data() || {};
          if (String(lesson.tenantId || '').trim() !== tenantId) continue;
          if (String(lesson.studentUid || '').trim() !== studentUid) continue;
          if (String(lesson.instructorUid || '').trim() !== String(primaryData.instructorUid || '').trim()) {
            continue;
          }
          if (normalizeRole(lesson.source) !== SPECIAL_LESSON_DRIVING_SOURCE) continue;
          const linkedReq = String(lesson.specialLessonRequestId || '').trim();
          if (!linkedReq || !requestIdSet[linkedReq]) continue;
          const lessonStatus = normalizeRole(lesson.status);
          if (lessonStatus === 'cancelled' || lessonStatus === 'completed') continue;
          if (!(DRIVING_LESSON_CANCELLABLE_STATUSES[lessonStatus] || lessonStatus === 'confirmed')) {
            continue;
          }
          const lessonStart = membershipExpiryToMillis(lesson.startAt);
          const lessonEnd = membershipExpiryToMillis(lesson.endAt);
          const primaryStart = membershipExpiryToMillis(primaryData.requestedStartAt);
          const primaryEnd = membershipExpiryToMillis(primaryData.requestedEndAt);
          if (Number(lessonStart) !== Number(primaryStart) || Number(lessonEnd) !== Number(primaryEnd)) {
            continue;
          }
          tx.update(lessonSnap.ref, {
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: studentUid,
            updatedAt: now
          });
          cancelledLessonIds.push(lessonSnap.id);
        }
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError('internal', 'Özel ders talebi geri çekilemedi. Lütfen tekrar deneyin.');
    }

    return {
      ok: true,
      requestId: requestId,
      status: 'cancelled',
      cancelledRequestIds: cancelledRequestIds,
      cancelledLessonId: cancelledLessonIds[0] || null,
      cancelledLessonIds: cancelledLessonIds
    };
  }
);

/**
 * Student: own driving schedule for Direksiyon Ders Programım.
 * Includes normal lessons plus canonical final-approved special lessons.
 * Excludes pending/provisional specials (pending_instructor, pending_admin,
 * legacy confirmed without specialFinalApprovedAt, rejected/withdrawn/cancelled).
 */
exports.listMyDrivingLessonsForStudent = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const callerUid = request && request.auth ? request.auth.uid : null;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { tenantId, studentUid } = await assertActiveDrivingStudentCaller(callerUid);

    let snap;
    try {
      snap = await db.collection('drivingLessons')
        .where('tenantId', '==', tenantId)
        .where('studentUid', '==', studentUid)
        .orderBy('startAt', 'asc')
        .get();
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/FAILED_PRECONDITION|requires an index|index/i.test(msg)) {
        throw new HttpsError(
          'failed-precondition',
          'Firestore index required for student drivingLessons list. Deploy firestore.indexes.json.'
        );
      }
      throw new HttpsError(
        'internal',
        (e && e.message) ? e.message : 'Failed to list student driving lessons.'
      );
    }

    function tsToIso(ts) {
      try {
        if (!ts) return null;
        const date = typeof ts.toDate === 'function'
          ? ts.toDate()
          : (ts && typeof ts._seconds === 'number' ? new Date(ts._seconds * 1000) : null);
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
        return date.toISOString();
      } catch (_) {
        return null;
      }
    }

    function tsToMillis(ts) {
      try {
        if (!ts) return null;
        if (typeof ts.toMillis === 'function') return ts.toMillis();
        if (typeof ts.toDate === 'function') return ts.toDate().getTime();
        if (typeof ts._seconds === 'number') return ts._seconds * 1000;
        return null;
      } catch (_) {
        return null;
      }
    }

    const byId = Object.create(null);
    (snap.docs || []).forEach((doc) => {
      const d = doc.data() || {};
      const status = normalizeRole(d.status);
      if (status === 'cancelled') return;

      const specialRequestId = d.specialLessonRequestId != null
        ? String(d.specialLessonRequestId).trim()
        : '';
      const isSpecial = isSpecialDrivingLessonDoc(d);

      if (isSpecial) {
        // Program only shows final-approved specials (confirmed + specialFinalApprovedAt).
        if (status !== 'confirmed') return;
        const finalMs = tsToMillis(d.specialFinalApprovedAt);
        if (finalMs == null) return;
      }

      const lessonId = doc.id;
      if (byId[lessonId]) return;

      const row = {
        lessonId: lessonId,
        instructorUid: String(d.instructorUid || '').trim(),
        instructorName: d.instructorNameSnap != null ? String(d.instructorNameSnap).trim() : '',
        startAt: tsToIso(d.startAt),
        endAt: tsToIso(d.endAt),
        durationMinutes: Number(d.durationMinutes) || DRIVING_LESSON_DURATION_MINUTES_V1,
        status: status,
        source: d.source ? String(d.source).trim() : (isSpecial ? SPECIAL_LESSON_DRIVING_SOURCE : 'admin_manual')
      };
      if (specialRequestId) row.specialLessonRequestId = specialRequestId;
      const specialFinalApprovedAt = tsToIso(d.specialFinalApprovedAt);
      if (specialFinalApprovedAt) row.specialFinalApprovedAt = specialFinalApprovedAt;
      byId[lessonId] = row;
    });

    const lessons = Object.keys(byId).map((id) => byId[id]).sort((a, b) => {
      const aMs = a && a.startAt ? Date.parse(a.startAt) : NaN;
      const bMs = b && b.startAt ? Date.parse(b.startAt) : NaN;
      const aOk = Number.isFinite(aMs);
      const bOk = Number.isFinite(bMs);
      if (aOk && bOk) return aMs - bMs;
      if (aOk) return -1;
      if (bOk) return 1;
      return String(a.lessonId || '').localeCompare(String(b.lessonId || ''));
    });

    return {
      ok: true,
      tenantId: tenantId,
      lessons: lessons
    };
  }
);