const { onCall, HttpsError } =
  require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

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
