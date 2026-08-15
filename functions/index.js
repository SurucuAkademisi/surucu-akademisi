const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { dispatchNotificationPush, dispatchPrivateMessagePush, dispatchGroupMessagePush, dispatchLessonAssignedPush } = require('./push_dispatch');
const {
  submitContactRequest,
  updateContactRequest,
  softDeleteContactRequest
} = require('./contact_requests');
const {
  createInstitutionOnboardingDraft,
  getInstitutionOnboardingLogoAccess
} = require('./institution_onboarding');

admin.initializeApp();

/** Public contact request create (Admin SDK write; guest allowed). */
exports.submitContactRequest = submitContactRequest;
/** Super Admin contact request status / adminNote update. */
exports.updateContactRequest = updateContactRequest;
/** Super Admin contact request soft-delete (CRM hide only; no hard delete / onboarding cascade). */
exports.softDeleteContactRequest = softDeleteContactRequest;
/** Institution onboarding draft create (Admin SDK Storage staging logo; no payment/tenant). */
exports.createInstitutionOnboardingDraft = createInstitutionOnboardingDraft;
/** Super Admin only — signed view/download URLs for onboarding staging logos. */
exports.getInstitutionOnboardingLogoAccess = getInstitutionOnboardingLogoAccess;

const db = admin.firestore();
const messaging = admin.messaging();

/**
 * Firestore tetikleyicisi:
 * notifications/{notificationId} onCreate
 *
 * N2A: membership-first recipient resolution via push_dispatch.js
 */
exports.onNotificationCreate = onDocumentCreated('notifications/{notificationId}', async (event) => {
    const notificationId = event.params.notificationId;
    const snap = event.data;
    if (!snap) {
      console.log('[onNotificationCreate] Event data yok, Ã§Ä±kÄ±lÄ±yor.');
      return null;
    }
    const data = snap.data() || {};

    console.log('[onNotificationCreate] Triggered for id=', notificationId, 'tenantId=', data.tenantId, 'targetType=', data.targetType);

    try {
      await dispatchNotificationPush({
        db,
        messaging,
        admin,
        notificationId,
        data,
      });
    } catch (e) {
      console.error('[onNotificationCreate] dispatch failed:', e && e.message ? e.message : e);
    }

    return null;
  });

/**
 * Bulk classifier for mailbox notification eligibility (D1A2).
 * Direct/reply messages must remain non-bulk.
 * @param {Object} data
 * @returns {boolean}
 */
function isMailboxBulkMessage(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.isBulk === true) return true;
  if (String(data.bulkBatchId || '').trim()) return true;
  return false;
}

/**
 * Explicit audience program only — never default missing/invalid to driving_license.
 * @param {*} raw
 * @returns {string|null}
 */
function resolveExplicitMailboxAudienceProgram(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (v === 'driving_license' || v === 'machine_operator') return v;
  return null;
}

/**
 * @param {*} raw
 * @returns {boolean}
 */
function isValidMailboxAudiencePeriodGroup(raw) {
  return /^\d{4}-\d{2}$/.test(String(raw == null ? '' : raw).trim());
}

/**
 * Bulk-only student notification eligibility vs canonical membership.
 * Throws on unexpected Firestore membership read failures (CF retry).
 * @param {{ tenantId: string, messageId: string, recipientId: string, data: Object }} args
 * @returns {Promise<{ ok: boolean, reason?: string, audienceProgramType?: string|null, audiencePeriodGroup?: string|null, membershipProgramType?: string|null, membershipPeriodGroup?: string|null }>}
 */
async function evaluateStudentBulkMailboxNotifyEligibility(args) {
  const tenantId = String((args && args.tenantId) || '').trim();
  const messageId = String((args && args.messageId) || '').trim();
  const recipientId = String((args && args.recipientId) || '').trim();
  const data = (args && args.data) || {};

  const audienceProgramType = resolveExplicitMailboxAudienceProgram(data.audienceProgramType);
  if (!audienceProgramType) {
    return { ok: false, reason: 'bulk_skip_missing_or_invalid_audience_program' };
  }

  const audiencePeriodRaw = data.audiencePeriodGroup == null ? '' : String(data.audiencePeriodGroup).trim();
  let audiencePeriodGroup = '';
  if (audiencePeriodRaw) {
    if (!isValidMailboxAudiencePeriodGroup(audiencePeriodRaw)) {
      return {
        ok: false,
        reason: 'bulk_skip_invalid_audience_period',
        audienceProgramType,
        audiencePeriodGroup: audiencePeriodRaw
      };
    }
    audiencePeriodGroup = audiencePeriodRaw;
  }

  const membershipId = recipientId + '_' + tenantId;
  let memSnap;
  try {
    memSnap = await db.collection('tenantMemberships').doc(membershipId).get();
  } catch (e) {
    console.error('[onMailboxMessageCreate] membership_read_failed', {
      messageId,
      tenantId,
      reason: 'membership_read_failed',
      message: e && e.message ? e.message : String(e)
    });
    throw e;
  }

  if (!memSnap.exists) {
    return {
      ok: false,
      reason: 'bulk_skip_membership_missing_or_invalid',
      audienceProgramType,
      audiencePeriodGroup: audiencePeriodGroup || null
    };
  }

  const m = memSnap.data() || {};
  const role = String(m.role || '').trim().toLowerCase();
  if (role !== 'student') {
    return {
      ok: false,
      reason: 'bulk_skip_membership_missing_or_invalid',
      audienceProgramType,
      audiencePeriodGroup: audiencePeriodGroup || null
    };
  }

  const memUid = String(m.uid || m.userId || '').trim();
  if (memUid && memUid !== recipientId) {
    return {
      ok: false,
      reason: 'bulk_skip_membership_missing_or_invalid',
      audienceProgramType,
      audiencePeriodGroup: audiencePeriodGroup || null
    };
  }

  const memTenantId = String(m.tenantId || '').trim();
  if (memTenantId && memTenantId !== tenantId) {
    return {
      ok: false,
      reason: 'bulk_skip_membership_missing_or_invalid',
      audienceProgramType,
      audiencePeriodGroup: audiencePeriodGroup || null
    };
  }

  const membershipProgramType = normalizeMembershipProgramType(m.programType);
  if (membershipProgramType !== audienceProgramType) {
    return {
      ok: false,
      reason: 'bulk_skip_program_mismatch',
      audienceProgramType,
      audiencePeriodGroup: audiencePeriodGroup || null,
      membershipProgramType
    };
  }

  if (audiencePeriodGroup) {
    const membershipPeriodGroup = String(m.periodGroup == null ? '' : m.periodGroup).trim();
    if (!membershipPeriodGroup || membershipPeriodGroup !== audiencePeriodGroup) {
      return {
        ok: false,
        reason: 'bulk_skip_period_mismatch',
        audienceProgramType,
        audiencePeriodGroup,
        membershipProgramType,
        membershipPeriodGroup: membershipPeriodGroup || null
      };
    }
  }

  return {
    ok: true,
    audienceProgramType,
    audiencePeriodGroup: audiencePeriodGroup || null,
    membershipProgramType
  };
}

/**
 * Bridge: tenantMailbox/{tenantId}/messages/{messageId} onCreate
 * Product rule: mailbox message delivery must NOT auto-create a notifications
 * document (no "Yeni Mesaj" / type:mailbox side effect). Push for mailbox is
 * intentionally not triggered here; manual type:tenant / system notifications
 * continue via onNotificationCreate.
 * Kept as a no-op trigger for safe deploy compatibility.
 */
exports.onMailboxMessageCreate = onDocumentCreated('tenantMailbox/{tenantId}/messages/{messageId}', async (event) => {
  return null;
});

/** Admin Activity Center — messaging events only (Phase 2). */
const ADMIN_ACTIVITY_PREVIEW_MAX = 180;
const ADMIN_ACTIVITY_USER_BATCH = 10;
const ROLE_INSTITUTION_ADMIN_ACTIVITY = 'institution_admin';
const ADMIN_ACTIVITY_ROOM_TYPE_GROUP = 'instructor_group';

function truncateAdminActivityPreview(value, maxCodePoints) {
  const max =
    Number.isFinite(maxCodePoints) && maxCodePoints > 0
      ? Math.floor(maxCodePoints)
      : ADMIN_ACTIVITY_PREVIEW_MAX;
  const collapsed = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const chars = Array.from(collapsed);
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}

function isFirestoreAlreadyExistsError(err) {
  if (!err) return false;
  const code = err.code;
  if (code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS') return true;
  const msg = String(err.message || '');
  return /ALREADY_EXISTS|already exists/i.test(msg);
}

function adminActivityDocRef(tenantId, recipientUid, activityId) {
  return db
    .collection('tenantAdminActivities')
    .doc(String(tenantId || '').trim())
    .collection('recipients')
    .doc(String(recipientUid || '').trim())
    .collection('activities')
    .doc(String(activityId || '').trim());
}

/**
 * Idempotent create: retries must not duplicate or reset unread/readAt.
 */
async function createAdminActivityIdempotent(tenantId, recipientUid, activityId, fields) {
  const tid = String(tenantId || '').trim();
  const rid = String(recipientUid || '').trim();
  const aid = String(activityId || '').trim();
  if (!tid || !rid || !aid) {
    return { ok: false, reason: 'missing_ids' };
  }
  const ref = adminActivityDocRef(tid, rid, aid);
  const payload = Object.assign({}, fields || {}, {
    type: fields && fields.type != null ? fields.type : '',
    tenantId: tid,
    recipientUid: rid,
    unread: true,
    readAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  try {
    await ref.create(payload);
    return { ok: true, created: true };
  } catch (e) {
    if (isFirestoreAlreadyExistsError(e)) {
      return { ok: true, created: false, reason: 'already_exists' };
    }
    throw e;
  }
}

async function isActiveInstitutionAdminForTenant(tenantId, uid) {
  const tid = String(tenantId || '').trim();
  const u = String(uid || '').trim();
  if (!tid || !u) return false;

  const memSnap = await db
    .collection('tenantMemberships')
    .where('tenantId', '==', tid)
    .where('uid', '==', u)
    .limit(5)
    .get();
  const membershipOk = (memSnap.docs || []).some((d) => {
    const data = d.data() || {};
    return (
      String(data.role || '').trim().toLowerCase() === ROLE_INSTITUTION_ADMIN_ACTIVITY &&
      String(data.status || '').trim().toLowerCase() === 'active'
    );
  });
  if (!membershipOk) return false;

  const userSnap = await db.collection('users').doc(u).get();
  if (!userSnap.exists) return false;
  const user = userSnap.data() || {};
  if (user.isActive === false) return false;
  const role = String(user.role || user.globalRole || '')
    .trim()
    .toLowerCase();
  return role === ROLE_INSTITUTION_ADMIN_ACTIVITY;
}

async function resolveActiveInstitutionAdminUidsForTenant(tenantId, excludeUid) {
  const tid = String(tenantId || '').trim();
  const exclude = String(excludeUid || '').trim();
  if (!tid) return [];

  const memSnap = await db.collection('tenantMemberships').where('tenantId', '==', tid).get();
  const candidateUids = [];
  (memSnap.docs || []).forEach((d) => {
    const data = d.data() || {};
    if (String(data.role || '').trim().toLowerCase() !== ROLE_INSTITUTION_ADMIN_ACTIVITY) return;
    if (String(data.status || '').trim().toLowerCase() !== 'active') return;
    const uid = String(data.uid || '').trim();
    if (!uid || (exclude && uid === exclude)) return;
    candidateUids.push(uid);
  });
  const unique = [...new Set(candidateUids)];
  if (!unique.length) return [];

  const eligible = [];
  for (let i = 0; i < unique.length; i += ADMIN_ACTIVITY_USER_BATCH) {
    const chunk = unique.slice(i, i + ADMIN_ACTIVITY_USER_BATCH);
    const refs = chunk.map((uid) => db.collection('users').doc(uid));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, idx) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (data.isActive === false) return;
      const role = String(data.role || data.globalRole || '')
        .trim()
        .toLowerCase();
      if (role !== ROLE_INSTITUTION_ADMIN_ACTIVITY) return;
      eligible.push(chunk[idx]);
    });
  }
  return eligible;
}

/**
 * MESSAGE_PRIVATE activity for the OTHER participant when they are an active institution_admin.
 * Instructor recipients are handled by native push only — no Admin activity for them.
 */
async function writePrivateMessageAdminActivity({
  tenantId,
  threadId,
  messageId,
  messageData,
  threadData,
}) {
  const tid = String(tenantId || '').trim();
  const tidThread = String(threadId || '').trim();
  const mid = String(messageId || '').trim();
  const msg = messageData && typeof messageData === 'object' ? messageData : {};
  const thread = threadData && typeof threadData === 'object' ? threadData : {};

  if (!tid || !tidThread || !mid) {
    console.log('[admin_activity] MESSAGE_PRIVATE skipped', { reason: 'missing_ids', tenantId: tid, threadId: tidThread, messageId: mid });
    return { ok: false, reason: 'missing_ids' };
  }
  if (msg.isDeleted === true) {
    console.log('[admin_activity] MESSAGE_PRIVATE skipped', { reason: 'message_deleted', tenantId: tid, messageId: mid });
    return { ok: true, reason: 'message_deleted' };
  }

  const senderUid = String(msg.senderUid || '').trim();
  if (!senderUid) {
    console.log('[admin_activity] MESSAGE_PRIVATE skipped', { reason: 'missing_senderUid', tenantId: tid, messageId: mid });
    return { ok: false, reason: 'missing_senderUid' };
  }

  const participantsRaw = Array.isArray(thread.participantUids) ? thread.participantUids : [];
  const participants = [
    ...new Set(participantsRaw.map((u) => String(u || '').trim()).filter(Boolean)),
  ];
  if (participants.length !== 2) {
    console.log('[admin_activity] MESSAGE_PRIVATE skipped', {
      reason: 'invalid_participant_count',
      tenantId: tid,
      messageId: mid,
      participantCount: participants.length,
    });
    return { ok: false, reason: 'invalid_participant_count' };
  }

  const recipientUid = participants.find((uid) => uid !== senderUid) || '';
  if (!recipientUid || recipientUid === senderUid) {
    console.log('[admin_activity] MESSAGE_PRIVATE skipped', { reason: 'recipient_unresolved', tenantId: tid, messageId: mid });
    return { ok: false, reason: 'recipient_unresolved' };
  }

  const adminOk = await isActiveInstitutionAdminForTenant(tid, recipientUid);
  if (!adminOk) {
    console.log('[admin_activity] MESSAGE_PRIVATE skipped', {
      reason: 'recipient_not_active_institution_admin',
      tenantId: tid,
      messageId: mid,
      recipientUid,
    });
    return { ok: true, reason: 'recipient_not_active_institution_admin' };
  }

  const preview = truncateAdminActivityPreview(msg.text, ADMIN_ACTIVITY_PREVIEW_MAX);
  const actorNameRaw = String(msg.senderName || '').trim();
  const actorName = truncateAdminActivityPreview(actorNameRaw || 'Kullanıcı', 80);
  const activityId = `MESSAGE_PRIVATE_${mid}`;
  const sourcePath = `tenantInstructorPrivateThreads/${tid}/threads/${tidThread}/messages/${mid}`;

  const result = await createAdminActivityIdempotent(tid, recipientUid, activityId, {
    type: 'MESSAGE_PRIVATE',
    actorUid: senderUid,
    actorName,
    title: 'Yeni özel mesaj',
    preview,
    messageId: mid,
    threadId: tidThread,
    peerUid: senderUid,
    sourcePath,
  });

  console.log('[admin_activity] MESSAGE_PRIVATE written', {
    tenantId: tid,
    messageId: mid,
    recipientUid,
    activityId,
    created: result.created === true,
    reason: result.reason || null,
  });
  return { ok: true, recipientUid, activityId, ...result };
}

/**
 * MESSAGE_GROUP activities for other active institution_admin recipients in the tenant.
 */
async function writeGroupMessageAdminActivities({ tenantId, messageId, messageData }) {
  const tid = String(tenantId || '').trim();
  const mid = String(messageId || '').trim();
  const msg = messageData && typeof messageData === 'object' ? messageData : {};

  if (!tid || !mid) {
    console.log('[admin_activity] MESSAGE_GROUP skipped', { reason: 'missing_ids', tenantId: tid, messageId: mid });
    return { ok: false, reason: 'missing_ids' };
  }
  if (msg.isDeleted === true) {
    console.log('[admin_activity] MESSAGE_GROUP skipped', { reason: 'message_deleted', tenantId: tid, messageId: mid });
    return { ok: true, reason: 'message_deleted' };
  }

  const senderUid = String(msg.senderUid || '').trim();
  if (!senderUid) {
    console.log('[admin_activity] MESSAGE_GROUP skipped', { reason: 'missing_senderUid', tenantId: tid, messageId: mid });
    return { ok: false, reason: 'missing_senderUid' };
  }

  const recipientUids = await resolveActiveInstitutionAdminUidsForTenant(tid, senderUid);
  if (!recipientUids.length) {
    console.log('[admin_activity] MESSAGE_GROUP skipped', {
      reason: 'no_eligible_admin_recipients',
      tenantId: tid,
      messageId: mid,
      senderUid,
    });
    return { ok: true, reason: 'no_eligible_admin_recipients' };
  }

  const preview = truncateAdminActivityPreview(msg.text, ADMIN_ACTIVITY_PREVIEW_MAX);
  const actorNameRaw = String(msg.senderName || '').trim();
  const actorName = truncateAdminActivityPreview(actorNameRaw || 'Kullanıcı', 80);
  const activityId = `MESSAGE_GROUP_${mid}`;
  const sourcePath = `tenantInstructorRooms/${tid}/messages/${mid}`;

  const settled = await Promise.allSettled(
    recipientUids.map((recipientUid) =>
      createAdminActivityIdempotent(tid, recipientUid, activityId, {
        type: 'MESSAGE_GROUP',
        actorUid: senderUid,
        actorName,
        title: 'Yeni grup mesajı',
        preview,
        messageId: mid,
        roomType: ADMIN_ACTIVITY_ROOM_TYPE_GROUP,
        sourcePath,
      }).then((result) => ({ recipientUid, ...result }))
    )
  );

  let successCount = 0;
  let failureCount = 0;
  settled.forEach((entry, idx) => {
    if (entry.status === 'fulfilled' && entry.value && entry.value.ok) {
      successCount += 1;
      return;
    }
    failureCount += 1;
    const reason =
      entry.status === 'rejected'
        ? entry.reason && entry.reason.message
          ? entry.reason.message
          : String(entry.reason)
        : entry.value && entry.value.reason
          ? entry.value.reason
          : 'unknown';
    console.error('[admin_activity] MESSAGE_GROUP recipient_failed', {
      tenantId: tid,
      messageId: mid,
      recipientUid: recipientUids[idx],
      reason,
    });
  });

  console.log('[admin_activity] MESSAGE_GROUP fanout_completed', {
    tenantId: tid,
    messageId: mid,
    senderUid,
    recipientCount: recipientUids.length,
    successCount,
    failureCount,
    activityId,
  });

  return {
    ok: true,
    recipientCount: recipientUids.length,
    successCount,
    failureCount,
    activityId,
  };
}

/**
 * DM2-1: Private instructor message CREATE → native_v2 push to recipient devices.
 * Path: tenantInstructorPrivateThreads/{tenantId}/threads/{threadId}/messages/{messageId}
 * Edit/delete do not fire onCreate. Push failure never reverses the message write.
 * Phase 2: also writes MESSAGE_PRIVATE Admin Activity Center docs for active institution_admin recipients.
 */
exports.onTenantInstructorPrivateMessageCreate = onDocumentCreated(
  'tenantInstructorPrivateThreads/{tenantId}/threads/{threadId}/messages/{messageId}',
  async (event) => {
    const tenantId = event.params && event.params.tenantId ? String(event.params.tenantId) : '';
    const threadId = event.params && event.params.threadId ? String(event.params.threadId) : '';
    const messageId = event.params && event.params.messageId ? String(event.params.messageId) : '';
    const snap = event.data;
    if (!snap) {
      console.log('[onTenantInstructorPrivateMessageCreate] Event data yok, çıkılıyor.');
      return null;
    }
    const messageData = snap.data() || {};

    console.log('[onTenantInstructorPrivateMessageCreate] Triggered', {
      tenantId,
      threadId,
      messageId,
      senderUid: messageData.senderUid ? String(messageData.senderUid) : null,
    });

    let threadData = null;
    try {
      const threadRef = db
        .collection('tenantInstructorPrivateThreads')
        .doc(tenantId)
        .collection('threads')
        .doc(threadId);
      const threadSnap = await threadRef.get();
      if (!threadSnap.exists) {
        console.log('[onTenantInstructorPrivateMessageCreate] thread missing', {
          tenantId,
          threadId,
          messageId,
        });
        return null;
      }
      threadData = threadSnap.data() || {};
    } catch (e) {
      console.error(
        '[onTenantInstructorPrivateMessageCreate] thread load failed:',
        e && e.message ? e.message : e
      );
      return null;
    }

    try {
      await dispatchPrivateMessagePush({
        db,
        messaging,
        admin,
        tenantId,
        threadId,
        messageId,
        messageData,
        threadData,
      });
    } catch (e) {
      console.error(
        '[onTenantInstructorPrivateMessageCreate] dispatch failed:',
        e && e.message ? e.message : e
      );
    }

    try {
      await writePrivateMessageAdminActivity({
        tenantId,
        threadId,
        messageId,
        messageData,
        threadData,
      });
    } catch (e) {
      console.error(
        '[onTenantInstructorPrivateMessageCreate] admin activity failed:',
        e && e.message ? e.message : e
      );
    }

    return null;
  }
);

/**
 * Group Room message CREATE → native_v2 push to other active Instructors in the tenant.
 * Path: tenantInstructorRooms/{tenantId}/messages/{messageId}
 * Edit/delete/history-clear metadata updates do not fire onCreate.
 * Push failure never reverses the message write.
 * Phase 2: also writes MESSAGE_GROUP Admin Activity Center docs for other active institution_admins.
 */
exports.onTenantInstructorRoomMessageCreate = onDocumentCreated(
  'tenantInstructorRooms/{tenantId}/messages/{messageId}',
  async (event) => {
    const tenantId = event.params && event.params.tenantId ? String(event.params.tenantId) : '';
    const messageId = event.params && event.params.messageId ? String(event.params.messageId) : '';
    const snap = event.data;
    if (!snap) {
      console.log('[onTenantInstructorRoomMessageCreate] Event data yok, çıkılıyor.');
      return null;
    }
    const messageData = snap.data() || {};

    console.log('[onTenantInstructorRoomMessageCreate] Triggered', {
      tenantId,
      messageId,
      senderUid: messageData.senderUid ? String(messageData.senderUid) : null,
    });

    try {
      await dispatchGroupMessagePush({
        db,
        messaging,
        admin,
        tenantId,
        messageId,
        messageData,
      });
    } catch (e) {
      console.error(
        '[onTenantInstructorRoomMessageCreate] dispatch failed:',
        e && e.message ? e.message : e
      );
    }

    try {
      await writeGroupMessageAdminActivities({
        tenantId,
        messageId,
        messageData,
      });
    } catch (e) {
      console.error(
        '[onTenantInstructorRoomMessageCreate] admin activity failed:',
        e && e.message ? e.message : e
      );
    }

    return null;
  }
);

/**
 * Agenda assignment CREATE → native_v2 push to assigned active Instructor.
 * Path: drivingLessonNotifications/{notificationId}
 * Only type=lesson_assigned + recipientRole=instructor.
 * Other lesson notification types ignored. Push failure never mutates the notification/lesson.
 */
exports.onDrivingLessonNotificationCreate = onDocumentCreated(
  'drivingLessonNotifications/{notificationId}',
  async (event) => {
    const notificationId = event.params && event.params.notificationId
      ? String(event.params.notificationId)
      : '';
    const snap = event.data;
    if (!snap) {
      console.log('[onDrivingLessonNotificationCreate] Event data yok, çıkılıyor.');
      return null;
    }
    const notificationData = snap.data() || {};
    const type = String(notificationData.type || '').trim().toLowerCase();
    const recipientRole = String(notificationData.recipientRole || '').trim().toLowerCase();

    console.log('[onDrivingLessonNotificationCreate] Triggered', {
      notificationId,
      type: type || null,
      recipientRole: recipientRole || null,
      tenantId: notificationData.tenantId ? String(notificationData.tenantId) : null,
      recipientUid: notificationData.recipientUid ? String(notificationData.recipientUid) : null,
      lessonId: notificationData.lessonId ? String(notificationData.lessonId) : null,
    });

    if (type !== 'lesson_assigned') {
      console.log('[onDrivingLessonNotificationCreate] skipped non-assignment type', {
        notificationId,
        type: type || null,
      });
      return null;
    }
    if (recipientRole !== 'instructor') {
      console.log('[onDrivingLessonNotificationCreate] skipped non-instructor recipient', {
        notificationId,
        recipientRole: recipientRole || null,
      });
      return null;
    }

    try {
      await dispatchLessonAssignedPush({
        db,
        messaging,
        admin,
        notificationId,
        notificationData,
      });
    } catch (e) {
      console.error(
        '[onDrivingLessonNotificationCreate] dispatch failed:',
        e && e.message ? e.message : e
      );
    }

    return null;
  }
);

/**
 * Callable: askLegislationAI
 * Mevzuat AsistanÄ±: keyword-based retrieval over Firestore mevzuat (published only) + deterministic answer.
 *
 * IMPORTANT:
 * - No OpenAI / no external models
 * - Answers only from Firestore mevzuat data
 * - Caller must be authenticated
 */
exports.askLegislationAI = onCall(async (request) => {
  const uid = request && request.auth ? request.auth.uid : null;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const question = data && typeof data.question === 'string' ? data.question : '';
  const q = question.trim();
  if (!q) {
    throw new HttpsError('invalid-argument', 'question must be a non-empty string.');
  }

  function normalizeText(input) {
    const s = (input == null ? '' : String(input));
    // Turkish-tolerant normalization + punctuation removal.
    return s
      .toLowerCase()
      .trim()
      .replace(/ÅŸ/g, 's')
      .replace(/Å/g, 's')
      .replace(/Ã§/g, 'c')
      .replace(/Ã‡/g, 'c')
      .replace(/ÄŸ/g, 'g')
      .replace(/Ä/g, 'g')
      .replace(/Ã¶/g, 'o')
      .replace(/Ã–/g, 'o')
      .replace(/Ã¼/g, 'u')
      .replace(/Ãœ/g, 'u')
      // dotless/dotted i handling: map I->i and Ä±->i for tolerant matching
      .replace(/Ä±/g, 'i')
      .replace(/Ä°/g, 'i')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ') // remove punctuation/symbols
      .replace(/\s+/g, ' ');
  }

  const STOPWORDS_CALLABLE = new Set(['super', 'admin', 'panel', 'yonetim', 'ekran', 'sayfa', 'ana', 'detay', 'git', 'mevzuat', 'asistan', 'kurum', 'tenant']);
  function extractKeywords(questionText) {
    const norm = normalizeText(questionText);
    const tokens = norm.split(' ').map(t => t.trim()).filter(Boolean).filter(t => t.length >= 3);
    return tokens.filter(t => !STOPWORDS_CALLABLE.has(t));
  }

  function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let idx = 0;
    while (true) {
      idx = haystack.indexOf(needle, idx);
      if (idx === -1) break;
      count++;
      idx += needle.length;
    }
    return count;
  }

  function scoreLegislationDoc(doc, keywords) {
    // doc is raw Firestore data
    const title = doc && doc.title ? String(doc.title) : '';
    const body = doc && doc.body ? String(doc.body) : '';
    const tags = doc && doc.tags ? String(doc.tags) : (Array.isArray(doc && doc.tags) ? doc.tags.join(' ') : '');
    const category = doc && doc.category ? String(doc.category) : '';
    const summary = doc && doc.summary ? String(doc.summary) : (doc && doc.plainText ? String(doc.plainText) : '');

    const nTitle = normalizeText(title);
    const nTags = normalizeText(tags);
    const nCategory = normalizeText(category);
    const nSummary = normalizeText(summary);
    const nBody = normalizeText(body);

    let score = 0;

    // Weights (simple V1 heuristic)
    const wTitle = 12;
    const wTags = 10;
    const wCategory = 8;
    const wSummary = 6;
    const wBody = 2;

    // Title exact substring / phrase bonus
    const phrase = normalizeText(question).slice(0, 120);
    const normQ = normalizeText(question);
    if (normQ && nTitle.includes(normQ)) score += 25;
    if (phrase && phrase.length >= 8 && nTitle.includes(phrase)) score += 15;

    for (const kw of keywords) {
      if (!kw) continue;
      const occTitle = countOccurrences(nTitle, kw);
      const occTags = countOccurrences(nTags, kw);
      const occCategory = countOccurrences(nCategory, kw);
      const occSummary = countOccurrences(nSummary, kw);
      const occBody = countOccurrences(nBody, kw);

      if (occTitle > 0) score += wTitle * occTitle;
      if (occTags > 0) score += wTags * occTags;
      if (occCategory > 0) score += wCategory * occCategory;
      if (occSummary > 0) score += wSummary * occSummary;
      if (occBody > 0) score += wBody * occBody;

      // Keyword concentration bonus: multiple keywords in title
      // (small bonus handled naturally by occurrences; keeps logic minimal)
    }

    // Reduce score if doc has no signals
    return score;
  }

  function formatDocExcerpt(text, keywords, maxChars) {
    const src = text == null ? '' : String(text);
    const lower = src.toLowerCase();
    const kws = (keywords || []).filter(Boolean);
    for (const kw of kws) {
      const idx = lower.indexOf(kw);
      if (idx >= 0) {
        const start = Math.max(0, idx - 140);
        const end = Math.min(src.length, idx + (maxChars - 40));
        const snippet = src.slice(start, end).trim();
        return (start > 0 ? 'â€¦ ' : '') + snippet + (end < src.length ? ' â€¦' : '');
      }
    }
    return src.trim().slice(0, maxChars);
  }

  function mevzuatPublishedOnlyQuery() {
    return admin.firestore().collection('mevzuat').where('published', '==', true);
  }

  const keywords = extractKeywords(q);
  const questionLen = q.length;

  console.log('[askLegislationAI] uid=', uid, 'questionLen=', questionLen, 'keywords=', keywords.length);

  if (!keywords.length) {
    return {
      ok: true,
      answer: 'Sorunuza uygun bir mevzuat bulunamadÄ±.',
      matchedLegislation: null,
      relatedItems: [],
      cta: null
    };
  }

  // Retrieval: simple keyword scoring over published mevzuat
  const snap = await mevzuatPublishedOnlyQuery().get();
  const docs = snap.docs || [];

  let matches = [];
  for (const d of docs) {
    const doc = d.data() || {};
    const score = scoreLegislationDoc(doc, keywords);
    // Minimal "meaningful match" threshold: at least some score.
    if (score <= 0) continue;
    matches.push({
      id: d.id,
      title: doc.title || '(BaÅŸlÄ±ksÄ±z)',
      body: doc.body || '',
      score,
      raw: doc
    });
  }

  // Sort by score and keep top 3
  matches.sort((a, b) => b.score - a.score);
  matches = matches.slice(0, 3);

  const MIN_SCORE_THRESHOLD = 10;
  if (!matches.length || matches[0].score < MIN_SCORE_THRESHOLD) {
    return {
      ok: true,
      answer: 'Sorunuza uygun bir mevzuat bulunamadÄ±.',
      matchedLegislation: null,
      relatedItems: [],
      cta: null
    };
  }

  const top = matches[0];
  const relatedItems = matches.map(m => ({ id: m.id, title: m.title }));

  const topRaw = top.raw || {};
  const summary =
    (topRaw.summary && String(topRaw.summary).trim()) ||
    formatDocExcerpt(top.body || '', keywords, 520) ||
    (top.body || '').trim().slice(0, 520);

  const answer =
    `Sorunuzla en ilgili yayÄ±mlanmÄ±ÅŸ mevzuat: "${top.title}".\n\n` +
    `KÄ±sa Ã¶zet: ${summary}`;

  return {
    ok: true,
    answer,
    matchedLegislation: {
      id: top.id,
      title: top.title,
      excerpt: summary
    },
    relatedItems,
    cta: {
      type: 'open_legislation',
      targetId: top.id
    }
  };
});

/**
 * HTTP: askLegislationAI - manual token verification (bypasses callable framework 401)
 * Same logic as askLegislationAI callable; use when callable auth fails.
 */
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

async function getUserRoleByUid(uid) {
  if (!uid) return '';
  const userSnap = await admin.firestore().collection('users').doc(uid).get();
  if (!userSnap.exists) return '';
  return String((userSnap.data() || {}).role || '').trim().toLowerCase();
}

function isAllowedLegislationAiRole(role) {
  return role === 'super_admin' || role === 'institution_admin';
}

async function runMevzuatAsistanLogic(q) {
  function normalizeText(input) {
    const s = (input == null ? '' : String(input));
    return s.toLowerCase().trim()
      .replace(/ÅŸ/g, 's').replace(/Å/g, 's').replace(/Ã§/g, 'c').replace(/Ã‡/g, 'c')
      .replace(/ÄŸ/g, 'g').replace(/Ä/g, 'g').replace(/Ã¶/g, 'o').replace(/Ã–/g, 'o')
      .replace(/Ã¼/g, 'u').replace(/Ãœ/g, 'u').replace(/Ä±/g, 'i').replace(/Ä°/g, 'i')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ');
  }
  const STOPWORDS = new Set(['super', 'admin', 'panel', 'yonetim', 'ekran', 'sayfa', 'ana', 'detay', 'git', 'mevzuat', 'asistan', 'kurum', 'tenant']);
  function extractKeywords(t) {
    const norm = normalizeText(t);
    const raw = norm.split(' ').map(x => x.trim()).filter(Boolean).filter(x => x.length >= 3);
    return raw.filter(x => !STOPWORDS.has(x));
  }
  function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let c = 0, i = 0;
    while ((i = haystack.indexOf(needle, i)) >= 0) { c++; i += needle.length; }
    return c;
  }
  function scoreLegislationDoc(doc, keywords, question) {
    const title = (doc && doc.title ? String(doc.title) : '');
    const body = (doc && doc.body ? String(doc.body) : '');
    const tags = doc && doc.tags ? (Array.isArray(doc.tags) ? doc.tags.join(' ') : String(doc.tags)) : '';
    const category = (doc && doc.category ? String(doc.category) : '');
    const summary = (doc && doc.summary ? String(doc.summary) : (doc && doc.plainText ? String(doc.plainText) : ''));
    const nTitle = normalizeText(title), nTags = normalizeText(tags), nCategory = normalizeText(category), nSummary = normalizeText(summary), nBody = normalizeText(body);
    let score = 0;
    const wTitle = 12, wTags = 10, wCategory = 8, wSummary = 6, wBody = 2;
    const phrase = normalizeText(question).slice(0, 120), normQ = normalizeText(question);
    if (normQ && nTitle.includes(normQ)) score += 25;
    if (phrase && phrase.length >= 8 && nTitle.includes(phrase)) score += 15;
    for (const kw of keywords) {
      if (!kw) continue;
      const oT = countOccurrences(nTitle, kw), oG = countOccurrences(nTags, kw), oC = countOccurrences(nCategory, kw), oS = countOccurrences(nSummary, kw), oB = countOccurrences(nBody, kw);
      if (oT > 0) score += wTitle * oT;
      if (oG > 0) score += wTags * oG;
      if (oC > 0) score += wCategory * oC;
      if (oS > 0) score += wSummary * oS;
      if (oB > 0) score += wBody * oB;
    }
    return score;
  }
  function formatDocExcerpt(text, keywords, maxChars) {
    const src = (text == null ? '' : String(text));
    const lower = src.toLowerCase();
    for (const kw of (keywords || []).filter(Boolean)) {
      const idx = lower.indexOf(kw);
      if (idx >= 0) {
        const start = Math.max(0, idx - 140), end = Math.min(src.length, idx + (maxChars - 40));
        const snippet = src.slice(start, end).trim();
        return (start > 0 ? 'â€¦ ' : '') + snippet + (end < src.length ? ' â€¦' : '');
      }
    }
    return src.trim().slice(0, maxChars);
  }
  const keywords = extractKeywords(q);
  // #region agent log
  console.log('[MevzuatAsistan] questionLen=', q.length, '| keywords=', keywords.length);
  // #endregion
  if (!keywords.length) {
    return { ok: true, answer: 'Sorunuza uygun bir mevzuat bulunamadÄ±.', matchedLegislation: null, relatedItems: [], cta: null };
  }
  const snap = await admin.firestore().collection('mevzuat').where('published', '==', true).get();
  const docs = snap.docs || [];
  const matches = [];
  for (const d of docs) {
    const doc = d.data() || {};
    const score = scoreLegislationDoc(doc, keywords, q);
    if (score <= 0) continue;
    matches.push({ id: d.id, title: doc.title || '(BaÅŸlÄ±ksÄ±z)', body: doc.body || '', score, raw: doc });
  }
  matches.sort((a, b) => b.score - a.score);
  const top3 = matches.slice(0, 3);
  const MIN_SCORE_THRESHOLD = 10;
  // #region agent log
  const top3Log = top3.map(m => ({ id: m.id, title: (m.title || '').slice(0, 60), score: m.score }));
  console.log('[MevzuatAsistan] top3=', JSON.stringify(top3Log), '| threshold=', MIN_SCORE_THRESHOLD, '| pass=', top3.length > 0 && top3[0].score >= MIN_SCORE_THRESHOLD);
  if (top3.length > 0 && top3[0].score >= MIN_SCORE_THRESHOLD) {
    const t = top3[0].raw || {};
    const nt = normalizeText(t.title || ''), nTag = normalizeText(t.tags || ''), nCat = normalizeText(t.category || ''), nSum = normalizeText(t.summary || t.plainText || ''), nB = normalizeText(t.body || '');
    const hits = keywords.map(kw => ({ kw, title: nt.includes(kw), tags: nTag.includes(kw), category: nCat.includes(kw), summary: nSum.includes(kw), body: nB.includes(kw) }));
    console.log('[MevzuatAsistan] topMatchBreakdown=', JSON.stringify(hits));
  }
  // #endregion
  if (!top3.length || top3[0].score < MIN_SCORE_THRESHOLD) {
    return { ok: true, answer: 'Sorunuza uygun bir mevzuat bulunamadÄ±.', matchedLegislation: null, relatedItems: [], cta: null };
  }
  const top = top3[0];
  const relatedItems = top3.map(m => ({ id: m.id, title: m.title }));
  const topRaw = top.raw || {};
  const summary = (topRaw.summary && String(topRaw.summary).trim()) || formatDocExcerpt(top.body || '', keywords, 520) || (top.body || '').trim().slice(0, 520);
  const answer = `Sorunuzla en ilgili yayÄ±mlanmÄ±ÅŸ mevzuat: "${top.title}".\n\nKÄ±sa Ã¶zet: ${summary}`;
  return { ok: true, answer, matchedLegislation: { id: top.id, title: top.title, excerpt: summary }, relatedItems, cta: { type: 'open_legislation', targetId: top.id } };
}

exports.askLegislationAIHttp = onRequest(async (req, res) => {
  res.set(corsHeaders);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  let uid = null;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    uid = decoded && decoded.uid ? decoded.uid : null;
  } catch (e) {
    console.warn('[askLegislationAIHttp] verifyIdToken failed:', e && e.message ? e.message : e);
    res.status(401).json({ error: 'Invalid authentication token.' });
    return;
  }
  if (!uid) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  let body = {};
  try {
    body = typeof req.body === 'object' && req.body ? req.body : {};
  } catch (_) {}
  const data = body.data || body;
  const question = (data && typeof data.question === 'string' ? data.question : '').trim();
  if (!question) {
    res.status(400).json({ error: 'question required' });
    return;
  }
  if (question.length < 3 || question.length > 1000) {
    res.status(400).json({ error: 'question length invalid' });
    return;
  }
  try {
    const role = await getUserRoleByUid(uid);
    if (!isAllowedLegislationAiRole(role)) {
      res.status(403).json({ error: 'permission-denied' });
      return;
    }
    console.log('[askLegislationAIHttp] uid=', uid, 'role=', role, 'questionLen=', question.length);
    const result = await runMevzuatAsistanLogic(question);
    res.status(200).json({ result: { data: result } });
  } catch (e) {
    console.error('[askLegislationAIHttp] error:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Callable: askLegislationAIV2
 * Security-first foundation for future OpenAI integration.
 * TODO: OpenAI API call will be added backend-only in a next step.
 * TODO: API key must be loaded from Secret Manager, never from client/code.
 * TODO: Add per-user and per-tenant rate limit before enabling real AI.
 */
exports.askLegislationAIV2 = onCall(async (request) => {
  const uid = request && request.auth ? request.auth.uid : null;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const question = data && typeof data.question === 'string' ? data.question : '';
  const q = question.trim();
  if (!q) {
    throw new HttpsError('invalid-argument', 'question must be a non-empty string.');
  }
  if (q.length < 3 || q.length > 1000) {
    throw new HttpsError('invalid-argument', 'question length must be between 3 and 1000 characters.');
  }

  const role = await getUserRoleByUid(uid);
  if (!isAllowedLegislationAiRole(role)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions for legislation assistant.');
  }

  console.log('[askLegislationAIV2] uid=', uid, 'role=', role, 'questionLen=', q.length);

  try {
    const deterministic = await runMevzuatAsistanLogic(q);
    const matched = deterministic && deterministic.matchedLegislation ? deterministic.matchedLegislation : null;
    const relatedItems = deterministic && Array.isArray(deterministic.relatedItems) ? deterministic.relatedItems : [];
    const cta = deterministic && deterministic.cta ? deterministic.cta : { type: 'open_legislation', targetId: null };
    const sources = matched ? [{
      id: matched.id || null,
      title: matched.title || null,
      excerpt: matched.excerpt || null
    }] : [];

    const answerPrefix = 'Mevzuat AsistanÄ± V2 gÃ¼venli altyapÄ±sÄ± hazÄ±rlandÄ±. GerÃ§ek AI cevabÄ± bir sonraki entegrasyon adÄ±mÄ±nda aktif edilecek.';
    const answer = matched && matched.title
      ? (answerPrefix + ' Åu anki en ilgili yayÄ±mlanmÄ±ÅŸ mevzuat: "' + matched.title + '".')
      : answerPrefix;

    return {
      answer,
      matchedLegislation: matched,
      relatedItems,
      cta,
      sources,
      meta: {
        provider: 'local-placeholder',
        aiEnabled: false
      }
    };
  } catch (e) {
    console.error('[askLegislationAIV2] error:', e && e.message ? e.message : e);
    throw new HttpsError('internal', 'Legislation assistant failed.');
  }
});

/**
 * Callable: Super Admin -> Tenant Admin password reset link
 * - No direct password editing
 * - Returns reset link only after strict server-side authorization
 */
exports.resetTenantAdminPassword = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};

  try {
    const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
    const targetUid = (data && data.targetUid ? String(data.targetUid) : '').trim();
    const targetEmailRaw = (data && data.targetEmail ? String(data.targetEmail) : '').trim().toLowerCase();

    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid is required.');

    // Authorize caller: must be super_admin (source: users/{uid}.role)
    const callerSnap = await db.collection('users').doc(callerUid).get();
    const callerRole = (callerSnap.exists && callerSnap.data() && callerSnap.data().role ? String(callerSnap.data().role) : '').toLowerCase();
    if (callerRole !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Only super_admin can reset tenant admin passwords.');
    }

    // Validate target membership: institution_admin + active for the given tenant
    const memSnap = await db
      .collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .where('uid', '==', targetUid)
      .get();

    const matching = (memSnap.docs || []).map((d) => d.data() || {}).find((d) => {
      const role = String(d.role || '').toLowerCase();
      const status = String(d.status || '').toLowerCase();
      return role === 'institution_admin' && status === 'active';
    });

    if (!matching) {
      throw new HttpsError('not-found', 'Target is not an active institution_admin for this tenant.');
    }

    // Resolve target email from users doc
    const targetUserSnap = await db.collection('users').doc(targetUid).get();
    if (!targetUserSnap.exists) throw new HttpsError('not-found', 'Target user not found.');
    const targetUser = targetUserSnap.data() || {};
    const resolvedEmail = (targetUser.email ? String(targetUser.email) : '').trim().toLowerCase();
    if (!resolvedEmail) throw new HttpsError('failed-precondition', 'Target user email is missing.');

    // Cross-check targetUid + targetEmail (optional input)
    if (targetEmailRaw && targetEmailRaw !== resolvedEmail) {
      throw new HttpsError('invalid-argument', 'targetEmail does not match targetUid.');
    }

    // Generate reset link (no email auto-send in this version)
    const resetLink = await admin.auth().generatePasswordResetLink(resolvedEmail);

    await db.collection('adminPasswordResetLogs').add({
      triggeredByUid: callerUid,
      targetUid,
      targetEmail: resolvedEmail,
      tenantId,
      triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
      method: 'reset_link',
      success: true
    });

    return { resetLink };
  } catch (e) {
    // Audit failure as well (avoid exposing details to caller)
    try {
      const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
      const targetUid = (data && data.targetUid ? String(data.targetUid) : '').trim();
      const targetEmailRaw = (data && data.targetEmail ? String(data.targetEmail) : '').trim().toLowerCase();
      await db.collection('adminPasswordResetLogs').add({
        triggeredByUid: callerUid,
        targetUid,
        targetEmail: targetEmailRaw || null,
        tenantId,
        triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
        method: 'reset_link',
        success: false,
        errorCode: (e && e.code) ? String(e.code) : 'error',
        message: (e && e.message) ? String(e.message) : 'failed'
      });
    } catch (_) {}

    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Reset failed.');
  }
});

function timestampToMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts === 'object' && ts._seconds != null) return ts._seconds * 1000;
  if (typeof ts === 'object' && ts.seconds != null) return ts.seconds * 1000;
  return null;
}

function formatAccessDateTr(ms) {
  if (ms == null) return 'â€”';
  try {
    return new Date(ms).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (_) {
    return 'â€”';
  }
}

/**
 * @param {Object} memData tenantMemberships fields
 * @returns {Object} access metadata for admin UI (display-only)
 */
function buildInstitutionAccessMetadata(memData) {
  const m = memData || {};
  const status = String(m.status || '').trim().toLowerCase();
  const expiresMs = timestampToMillis(m.institutionAccessExpiresAt);
  const startsMs = timestampToMillis(m.institutionAccessStartsAt);
  const durationDays = m.institutionAccessDurationDays != null && Number.isFinite(Number(m.institutionAccessDurationDays))
    ? Number(m.institutionAccessDurationDays)
    : null;

  let accessDaysRemaining = null;
  let accessExpiresDisplay = 'â€”';
  let accessLabel = 'SÃ¼resiz';
  let accessClass = 'ok';

  if (status === 'suspended') {
    accessLabel = 'Pasif';
    accessClass = 'muted';
  } else if (expiresMs == null) {
    accessLabel = 'SÃ¼resiz';
    accessClass = 'ok';
  } else {
    const now = Date.now();
    accessDaysRemaining = Math.max(0, Math.ceil((expiresMs - now) / (24 * 60 * 60 * 1000)));
    accessExpiresDisplay = formatAccessDateTr(expiresMs);
    if (expiresMs <= now) {
      accessLabel = 'SÃ¼resi doldu';
      accessClass = 'muted';
    } else {
      accessLabel = 'Aktif';
      accessClass = 'ok';
    }
  }

  return {
    institutionAccessStartsAt: startsMs,
    institutionAccessExpiresAt: expiresMs,
    institutionAccessDurationDays: durationDays,
    accessDaysRemaining,
    accessExpiresDisplay,
    accessLabel,
    accessClass
  };
}

const SA_PROGRAM_DRIVING = 'driving_license';
const SA_PROGRAM_MACHINE = 'machine_operator';
const SA_ENROLLMENT_INSTITUTION = 'institution';
const SA_ENROLLMENT_PUBLIC = 'public';

/**
 * Read-normalize membership.programType (legacy/missing → driving_license).
 * @param {*} value
 * @returns {string}
 */
function normalizeMembershipProgramType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === SA_PROGRAM_MACHINE) return SA_PROGRAM_MACHINE;
  return SA_PROGRAM_DRIVING;
}

/**
 * Read-normalize enrollmentSource for institution-tenant admin views.
 * Missing → institution. Does not invent public for legacy rows.
 * @param {*} value
 * @returns {string}
 */
function normalizeMembershipEnrollmentSource(value) {
  const e = String(value || '').trim().toLowerCase();
  if (e === SA_ENROLLMENT_PUBLIC) return SA_ENROLLMENT_PUBLIC;
  return SA_ENROLLMENT_INSTITUTION;
}

/**
 * Allowlist request program type. Missing/empty → driving_license.
 * @param {*} raw
 * @returns {string}
 */
function resolveRequestedProgramType(raw) {
  if (raw == null || String(raw).trim() === '') return SA_PROGRAM_DRIVING;
  const v = String(raw).trim().toLowerCase();
  if (v === SA_PROGRAM_DRIVING || v === SA_PROGRAM_MACHINE) return v;
  throw new HttpsError('invalid-argument', 'requestedProgramType must be driving_license or machine_operator.');
}

/**
 * Optional expectedProgramType for detail guard. Omitted → null (no guard).
 * @param {*} raw
 * @returns {string|null}
 */
function resolveExpectedProgramType(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const v = String(raw).trim().toLowerCase();
  if (v === SA_PROGRAM_DRIVING || v === SA_PROGRAM_MACHINE) return v;
  throw new HttpsError('invalid-argument', 'expectedProgramType must be driving_license or machine_operator.');
}

/**
 * Callable: institution_admin -> Tenant students list (bypasses client Firestore rules)
 * Caller must be institution_admin for the given tenant.
 */
exports.getTenantStudentsForInstitutionAdmin = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }
  const requestedProgramType = resolveRequestedProgramType(data && data.requestedProgramType);

  try {
    const adminMemSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .where('uid', '==', callerUid)
      .get();

    const adminMatch = (adminMemSnap.docs || []).map((d) => d.data() || {}).find((d) => {
      const role = String(d.role || '').toLowerCase();
      const status = String(d.status || '').toLowerCase();
      return role === 'institution_admin' && status === 'active';
    });

    if (!adminMatch) {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }

    const studentMemSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .where('role', '==', 'student')
      .get();

    const memberships = (studentMemSnap.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => normalizeMembershipProgramType(m.programType) === requestedProgramType);

    const total = memberships.length;
    const active = memberships.filter((m) => (m.status || '').toLowerCase() === 'active').length;

    if (memberships.length === 0) {
      return { totalStudents: 0, activeStudents: 0, students: [] };
    }

    const uids = [...new Set(memberships.map((m) => m.uid || m.userId).filter(Boolean))];
    const usersMap = {};
    for (const uid of uids) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) {
        const u = userSnap.data() || {};
        usersMap[uid] = u;
      }
    }

    function formatCreatedAt(ts) {
      try {
        if (!ts) return '-';
        const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts && ts._seconds ? new Date(ts._seconds * 1000) : null);
        return d ? d.toLocaleString('tr-TR') : '-';
      } catch (_) {
        return '-';
      }
    }

    const students = [];
    for (const m of memberships) {
      const uid = m.uid || m.userId;
      const user = usersMap[uid] || {};
      const username = user.username || (user.email ? String(user.email).split('@')[0] : '') || '-';
      const fullName = (user.fullName && String(user.fullName).trim()) ? String(user.fullName).trim() : 'â€”';
      const email = user.email || '-';
      const periodGroup = (m.periodGroup && String(m.periodGroup).trim()) ? String(m.periodGroup).trim() : 'â€”';
      const status = m.status || '';
      const statusLabel = status.toLowerCase() === 'active' ? 'Aktif' : (status.toLowerCase() === 'suspended' ? 'Pasif' : (status || '-'));
      const createdAt = formatCreatedAt(user.createdAt) !== '-' ? formatCreatedAt(user.createdAt) : formatCreatedAt(m.createdAt);
      const accessMeta = buildInstitutionAccessMetadata(m);
      const programType = normalizeMembershipProgramType(m.programType);
      const enrollmentSource = normalizeMembershipEnrollmentSource(m.enrollmentSource);

      students.push({
        uid,
        membershipId: m.id,
        username,
        fullName,
        email,
        periodGroup,
        status,
        statusLabel,
        createdAt,
        programType,
        enrollmentSource,
        institutionAccessStartsAt: accessMeta.institutionAccessStartsAt,
        institutionAccessExpiresAt: accessMeta.institutionAccessExpiresAt,
        institutionAccessDurationDays: accessMeta.institutionAccessDurationDays,
        accessDaysRemaining: accessMeta.accessDaysRemaining,
        accessExpiresDisplay: accessMeta.accessExpiresDisplay,
        accessLabel: accessMeta.accessLabel,
        accessClass: accessMeta.accessClass
      });
    }

    return {
      totalStudents: total,
      activeStudents: active,
      students
    };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to load students.');
  }
});

/**
 * Callable: institution_admin -> Tenant student detail (single student)
 * Returns user + membership + payment summary + payment log.
 */
exports.getTenantStudentDetailForInstitutionAdmin = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
  const uid = (data && data.uid ? String(data.uid) : '').trim();
  if (!tenantId || !uid) {
    throw new HttpsError('invalid-argument', 'tenantId and uid are required.');
  }
  const expectedProgramType = resolveExpectedProgramType(data && data.expectedProgramType);

  try {
    const adminMemSnap = await db.collection('tenantMemberships')
      .where('tenantId', '==', tenantId)
      .where('uid', '==', callerUid)
      .get();

    const adminMatch = (adminMemSnap.docs || []).map((d) => d.data() || {}).find((d) => {
      const role = String(d.role || '').toLowerCase();
      const status = String(d.status || '').toLowerCase();
      return role === 'institution_admin' && status === 'active';
    });

    if (!adminMatch) {
      throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
    }

    const [userSnap, memSnap, paySnap, logSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('tenantMemberships').doc(uid + '_' + tenantId).get(),
      db.collection('tenants').doc(tenantId).collection('studentPayments').doc(uid).get(),
      db.collection('tenants').doc(tenantId).collection('studentPayments').doc(uid).collection('paymentLog')
        .orderBy('date', 'desc').limit(30).get()
    ]);

    if (expectedProgramType) {
      if (!memSnap.exists) {
        throw new HttpsError('not-found', 'Membership not found.');
      }
      const guardProgram = normalizeMembershipProgramType((memSnap.data() || {}).programType);
      if (guardProgram !== expectedProgramType) {
        throw new HttpsError('not-found', 'Membership not found.');
      }
    }

    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    const memData = memSnap.exists ? (memSnap.data() || {}) : {};
    const payData = (paySnap && paySnap.exists) ? (paySnap.data() || {}) : {};

    const username = userData.username || (userData.email ? String(userData.email).split('@')[0] : '') || '-';
    const fullName = (userData.fullName && String(userData.fullName).trim()) ? String(userData.fullName).trim() : 'â€”';
    const email = userData.email || '-';
    const periodGroup = (memData.periodGroup && String(memData.periodGroup).trim()) ? String(memData.periodGroup).trim() : 'â€”';
    const status = memData.status || '';
    const statusLabel = status.toLowerCase() === 'active' ? 'Aktif' : (status.toLowerCase() === 'suspended' ? 'Pasif' : (status || '-'));
    const programType = normalizeMembershipProgramType(memData.programType);
    const enrollmentSource = normalizeMembershipEnrollmentSource(memData.enrollmentSource);

    function formatTs(ts) {
      try {
        if (!ts) return '-';
        const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts && ts._seconds ? new Date(ts._seconds * 1000) : null);
        return d ? d.toLocaleString('tr-TR') : '-';
      } catch (_) {
        return '-';
      }
    }

    const createdAt = formatTs(userData.createdAt) !== '-' ? formatTs(userData.createdAt) : formatTs(memData.createdAt);
    const accessMeta = buildInstitutionAccessMetadata(memData);

    const paymentLog = [];
    if (logSnap && logSnap.docs) {
      for (const d of logSnap.docs) {
        const x = d.data() || {};
        paymentLog.push({
          dateDisplay: formatTs(x.date),
          amount: x.amount != null ? Number(x.amount) : 0,
          remainingAfter: x.remainingAfter != null ? Number(x.remainingAfter) : 0,
          note: (x.note != null ? String(x.note) : '').trim()
        });
      }
    }

    return {
      uid,
      membershipId: memSnap.exists ? memSnap.id : (uid + '_' + tenantId),
      username,
      fullName,
      email,
      periodGroup,
      status,
      statusLabel,
      createdAt,
      programType,
      enrollmentSource,
      institutionAccessStartsAt: accessMeta.institutionAccessStartsAt,
      institutionAccessExpiresAt: accessMeta.institutionAccessExpiresAt,
      institutionAccessDurationDays: accessMeta.institutionAccessDurationDays,
      accessDaysRemaining: accessMeta.accessDaysRemaining,
      accessExpiresDisplay: accessMeta.accessExpiresDisplay,
      accessLabel: accessMeta.accessLabel,
      accessClass: accessMeta.accessClass,
      payment: {
        totalAmount: payData.totalAmount != null ? Number(payData.totalAmount) : 0,
        paidAmount: payData.paidAmount != null ? Number(payData.paidAmount) : 0,
        installmentEnabled: payData.installmentEnabled === true,
        monthlyInstallmentAmount: payData.monthlyInstallmentAmount != null ? Number(payData.monthlyInstallmentAmount) : 0,
        note: (payData.note != null ? String(payData.note) : '').trim()
      },
      paymentLog
    };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to load student detail.');
  }
});

/**
 * Callable: Remove student membership only (membership-level delete)
 * super_admin or institution_admin for that tenant.
 * Deletes ONLY tenantMemberships/{membershipId}.
 */
exports.removeTenantStudentMembership = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const tenantId = (data && data.tenantId ? String(data.tenantId) : '').trim();
  const membershipId = (data && data.membershipId ? String(data.membershipId) : '').trim();
  if (!tenantId || !membershipId) {
    throw new HttpsError('invalid-argument', 'tenantId and membershipId are required.');
  }

  try {
    const callerSnap = await db.collection('users').doc(callerUid).get();
    const callerRole = (callerSnap.exists && callerSnap.data() && callerSnap.data().role ? String(callerSnap.data().role) : '').toLowerCase();
    const isSuperAdmin = callerRole === 'super_admin';

    if (!isSuperAdmin) {
      const adminMemSnap = await db.collection('tenantMemberships')
        .where('tenantId', '==', tenantId)
        .where('uid', '==', callerUid)
        .get();

      const adminMatch = (adminMemSnap.docs || []).map((d) => d.data() || {}).find((d) => {
        const role = String(d.role || '').toLowerCase();
        const status = String(d.status || '').toLowerCase();
        return role === 'institution_admin' && status === 'active';
      });

      if (!adminMatch) {
        throw new HttpsError('permission-denied', 'Not an active institution_admin for this tenant.');
      }
    }

    const targetMemSnap = await db.collection('tenantMemberships').doc(membershipId).get();
    if (!targetMemSnap.exists) {
      throw new HttpsError('not-found', 'Membership not found.');
    }

    const target = targetMemSnap.data() || {};
    const targetTenantId = (target.tenantId && String(target.tenantId)).trim();
    const targetRole = (target.role && String(target.role)).toLowerCase();

    if (targetTenantId !== tenantId) {
      throw new HttpsError('permission-denied', 'Target membership does not belong to this tenant.');
    }

    if (targetRole !== 'student') {
      throw new HttpsError('invalid-argument', 'Only student memberships can be removed.');
    }

    await db.collection('tenantMemberships').doc(membershipId).delete();

    return { ok: true, membershipId, tenantId };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to remove membership.');
  }
});

const PREVIEW_PROTECTED_TENANT_ID = 'surucu_akademisi';
const PREVIEW_TENANT_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
const PREVIEW_AUTH_IMPACT_MAX_MEMBERS = 500;
const PREVIEW_AUTH_IMPACT_CONCURRENCY = 8;
const PREVIEW_VERSION = 1;

function previewValidateTenantId(raw) {
  if (typeof raw !== 'string') {
    throw new HttpsError('invalid-argument', 'tenantId must be a string.');
  }
  const tenantId = raw.trim();
  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required.');
  }
  if (!PREVIEW_TENANT_ID_PATTERN.test(tenantId)) {
    throw new HttpsError('invalid-argument', 'tenantId has invalid format.');
  }
  return tenantId;
}

function previewIsProtectedTenant(tenantId) {
  return tenantId === PREVIEW_PROTECTED_TENANT_ID;
}

async function previewAssertSuperAdmin(callerUid) {
  const callerSnap = await db.collection('users').doc(callerUid).get();
  const callerRole = (callerSnap.exists && callerSnap.data() && callerSnap.data().role
    ? String(callerSnap.data().role) : '').toLowerCase();
  if (callerRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super_admin can preview tenant deletion.');
  }
}

async function previewSafeCountQuery(queryRef, warningCode) {
  try {
    const snap = await queryRef.count().get();
    return { value: snap.data().count, warning: null };
  } catch (e) {
    console.error('[previewTenantDeletion] count failed:', warningCode || 'COUNT_FAILED', e && e.message ? e.message : e);
    return { value: null, warning: warningCode || 'COUNT_FAILED' };
  }
}

async function previewSafeCountCollection(collectionRef, warningCode) {
  try {
    const snap = await collectionRef.count().get();
    return { value: snap.data().count, warning: null };
  } catch (e) {
    console.error('[previewTenantDeletion] collection count failed:', warningCode || 'COUNT_FAILED', e && e.message ? e.message : e);
    return { value: null, warning: warningCode || 'COUNT_FAILED' };
  }
}

async function previewDirectDocExists(collectionName, docId, warningCode) {
  try {
    const snap = await db.collection(collectionName).doc(docId).get();
    return { value: snap.exists ? 1 : 0, warning: null };
  } catch (e) {
    console.error('[previewTenantDeletion] doc existence failed:', warningCode || 'DOC_EXISTS_FAILED', e && e.message ? e.message : e);
    return { value: null, warning: warningCode || 'DOC_EXISTS_FAILED' };
  }
}

function previewPushWarning(warnings, code) {
  if (!code || warnings.indexOf(code) !== -1) return;
  warnings.push(code);
}

function previewNormalizeMembershipRole(role) {
  return String(role || '').trim().toLowerCase();
}

async function previewCountStoragePrefix(tenantId) {
  const prefix = 'tenant-logos/' + tenantId + '/';
  try {
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix });
    let totalBytes = 0;
    for (let i = 0; i < files.length; i++) {
      const meta = files[i].metadata || {};
      const size = meta.size != null ? Number(meta.size) : 0;
      if (Number.isFinite(size)) totalBytes += size;
    }
    return {
      status: 'complete',
      prefix,
      objectCount: files.length,
      totalBytes: files.length > 0 ? totalBytes : 0,
      warning: null
    };
  } catch (e) {
    console.error('[previewTenantDeletion] storage preview failed:', e && e.message ? e.message : e);
    return {
      status: 'error',
      prefix,
      objectCount: null,
      totalBytes: null,
      warning: 'STORAGE_PREVIEW_FAILED'
    };
  }
}

async function previewMapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex;
      nextIndex += 1;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Math.min(concurrency, items.length);
  if (workers <= 0) return results;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function previewEvaluateAuthPreserve(uid, tenantId) {
  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.exists) {
    const userRole = previewNormalizeMembershipRole((userSnap.data() || {}).role);
    if (userRole === 'super_admin') {
      return { preserve: true, hasOtherTenantMembership: false };
    }
  }

  const memSnap = await db.collection('tenantMemberships').where('uid', '==', uid).limit(25).get();
  let hasOtherTenantMembership = false;
  for (let i = 0; i < memSnap.docs.length; i++) {
    const mem = memSnap.docs[i].data() || {};
    const memTenantId = String(mem.tenantId || '').trim();
    if (memTenantId && memTenantId !== tenantId) {
      hasOtherTenantMembership = true;
      break;
    }
  }

  if (hasOtherTenantMembership) {
    return { preserve: true, hasOtherTenantMembership: true };
  }

  const checks = await Promise.all([
    db.collection('publicProfiles').doc(uid).get(),
    db.collection('userEntitlements').doc(uid).get(),
    db.collection('duelLeague').doc(uid).get(),
    db.collection('users').doc(uid).collection('web_exam_attempts').limit(1).get(),
    db.collection('users').doc(uid).collection('web_lesson_progress').limit(1).get()
  ]);

  const hasGlobalHistory = checks[0].exists
    || checks[1].exists
    || checks[2].exists
    || !checks[3].empty
    || !checks[4].empty;

  return {
    preserve: hasGlobalHistory,
    hasOtherTenantMembership: false
  };
}

async function previewComputeAuthImpact(tenantId, membershipUsersTotal, warnings) {
  if (membershipUsersTotal == null) {
    previewPushWarning(warnings, 'AUTH_IMPACT_REQUIRES_PAGINATED_JOB');
    return {
      status: 'deferred',
      membershipUsersTotal: null,
      usersWithAnotherTenantMembership: null,
      usersWithNoOtherTenantMembership: null,
      authDeleteCandidates: null,
      authPreserveCount: null
    };
  }

  if (membershipUsersTotal > PREVIEW_AUTH_IMPACT_MAX_MEMBERS) {
    previewPushWarning(warnings, 'AUTH_IMPACT_REQUIRES_PAGINATED_JOB');
    return {
      status: 'deferred',
      membershipUsersTotal,
      usersWithAnotherTenantMembership: null,
      usersWithNoOtherTenantMembership: null,
      authDeleteCandidates: null,
      authPreserveCount: null
    };
  }

  const memSnap = await db.collection('tenantMemberships').where('tenantId', '==', tenantId).get();
  const uidSet = new Set();
  for (let i = 0; i < memSnap.docs.length; i++) {
    const mem = memSnap.docs[i].data() || {};
    const uid = String(mem.uid || mem.userId || '').trim();
    if (uid) uidSet.add(uid);
  }
  const uids = Array.from(uidSet);

  const evaluations = await previewMapWithConcurrency(
    uids,
    PREVIEW_AUTH_IMPACT_CONCURRENCY,
    (uid) => previewEvaluateAuthPreserve(uid, tenantId)
  );

  let usersWithAnotherTenantMembership = 0;
  let usersWithNoOtherTenantMembership = 0;
  let authDeleteCandidates = 0;
  let authPreserveCount = 0;

  for (let i = 0; i < evaluations.length; i++) {
    const ev = evaluations[i] || {};
    if (ev.hasOtherTenantMembership) {
      usersWithAnotherTenantMembership += 1;
      authPreserveCount += 1;
    } else {
      usersWithNoOtherTenantMembership += 1;
      if (ev.preserve) {
        authPreserveCount += 1;
      } else {
        authDeleteCandidates += 1;
      }
    }
  }

  return {
    status: 'complete',
    membershipUsersTotal: uids.length,
    usersWithAnotherTenantMembership,
    usersWithNoOtherTenantMembership,
    authDeleteCandidates,
    authPreserveCount
  };
}

function previewFormatTenantStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (status === 'active' || status === 'suspended') return status;
  return 'unknown';
}

function previewFormatResponse(params) {
  const {
    tenantId,
    protectedTenant,
    tenantExists,
    tenantStatus,
    counts,
    authImpact,
    storage,
    warnings
  } = params;

  return {
    ok: true,
    previewVersion: PREVIEW_VERSION,
    tenantId,
    protected: protectedTenant,
    canDelete: !protectedTenant,
    tenantExists,
    tenantStatus,
    counts,
    authImpact,
    storage,
    warnings
  };
}

/**
 * Callable: Super Admin read-only tenant deletion impact preview.
 * No Firestore, Auth, or Storage mutations.
 */
exports.previewTenantDeletion = onCall(async (request) => {
  const data = request && request.data ? request.data : {};
  const tenantId = previewValidateTenantId(data && data.tenantId != null ? String(data.tenantId) : '');

  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  await previewAssertSuperAdmin(callerUid);

  const protectedTenant = previewIsProtectedTenant(tenantId);
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  const tenantExists = tenantSnap.exists;

  let tenantStatus;
  if (protectedTenant) {
    tenantStatus = tenantExists
      ? previewFormatTenantStatus((tenantSnap.data() || {}).status)
      : 'unknown';
  } else if (!tenantExists) {
    throw new HttpsError('not-found', 'Tenant not found.');
  } else {
    tenantStatus = previewFormatTenantStatus((tenantSnap.data() || {}).status);
  }

  const warnings = [];

  previewPushWarning(warnings, 'USER_MAILBOX_TENANT_REFERENCE_COUNT_DEFERRED');
  previewPushWarning(warnings, 'DUEL_TENANT_REFERENCE_COUNT_DEFERRED');
  previewPushWarning(warnings, 'NESTED_PAYMENT_LOG_COUNT_DEFERRED');

  const membershipsBase = db.collection('tenantMemberships').where('tenantId', '==', tenantId);

  const countJobs = await Promise.allSettled([
    previewSafeCountQuery(membershipsBase, 'MEMBERSHIPS_TOTAL_COUNT_FAILED'),
    previewSafeCountQuery(membershipsBase.where('role', '==', 'student'), 'MEMBERSHIPS_STUDENT_COUNT_FAILED'),
    previewSafeCountQuery(membershipsBase.where('role', '==', 'institution_admin'), 'MEMBERSHIPS_ADMIN_COUNT_FAILED'),
    previewDirectDocExists('tenants', tenantId, 'DIRECT_TENANT_DOC_FAILED'),
    previewDirectDocExists('tenantSettings', tenantId, 'DIRECT_SETTINGS_DOC_FAILED'),
    previewDirectDocExists('tenantBilling', tenantId, 'DIRECT_BILLING_DOC_FAILED'),
    previewSafeCountCollection(db.collection('tenantMailbox').doc(tenantId).collection('messages'), 'MAILBOX_MESSAGES_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('tenants').doc(tenantId).collection('announcements'), 'ANNOUNCEMENTS_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('tenants').doc(tenantId).collection('studentPayments'), 'STUDENT_PAYMENTS_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('tenants').doc(tenantId).collection('exam_attempts'), 'EXAM_ATTEMPTS_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('tenants').doc(tenantId).collection('lesson_progress'), 'LESSON_PROGRESS_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('tenants').doc(tenantId).collection('mailboxThreadStates'), 'MAILBOX_THREAD_STATES_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('institutionChatReadStates').doc(tenantId).collection('rooms'), 'INSTITUTION_CHAT_READ_STATES_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('tenantPanelReadStates').doc(tenantId).collection('sections'), 'TENANT_PANEL_READ_STATES_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('tenantExams').doc(tenantId).collection('exams'), 'TENANT_EXAMS_COUNT_FAILED'),
    previewSafeCountCollection(db.collection('tenantExams').doc(tenantId).collection('questions'), 'TENANT_EXAM_QUESTIONS_COUNT_FAILED'),
    previewSafeCountQuery(db.collection('notifications').where('tenantId', '==', tenantId), 'NOTIFICATIONS_COUNT_FAILED'),
    previewSafeCountQuery(db.collection('forum_posts').where('tenantId', '==', tenantId), 'FORUM_POSTS_COUNT_FAILED'),
    previewCountStoragePrefix(tenantId)
  ]);

  function settledValue(settled, index) {
    if (!settled[index] || settled[index].status !== 'fulfilled') return { value: null, warning: 'COUNT_JOB_FAILED' };
    return settled[index].value;
  }

  const membershipsTotalR = settledValue(countJobs, 0);
  const membershipsStudentR = settledValue(countJobs, 1);
  const membershipsAdminR = settledValue(countJobs, 2);
  const directTenantR = settledValue(countJobs, 3);
  const directSettingsR = settledValue(countJobs, 4);
  const directBillingR = settledValue(countJobs, 5);
  const mailboxMessagesR = settledValue(countJobs, 6);
  const announcementsR = settledValue(countJobs, 7);
  const studentPaymentsR = settledValue(countJobs, 8);
  const examAttemptsR = settledValue(countJobs, 9);
  const lessonProgressR = settledValue(countJobs, 10);
  const mailboxThreadStatesR = settledValue(countJobs, 11);
  const institutionChatReadStatesR = settledValue(countJobs, 12);
  const tenantPanelReadStatesR = settledValue(countJobs, 13);
  const tenantExamsR = settledValue(countJobs, 14);
  const tenantExamQuestionsR = settledValue(countJobs, 15);
  const notificationsR = settledValue(countJobs, 16);
  const forumPostsR = settledValue(countJobs, 17);
  const storageR = settledValue(countJobs, 18);

  [
    membershipsTotalR,
    membershipsStudentR,
    membershipsAdminR,
    directTenantR,
    directSettingsR,
    directBillingR,
    mailboxMessagesR,
    announcementsR,
    studentPaymentsR,
    examAttemptsR,
    lessonProgressR,
    mailboxThreadStatesR,
    institutionChatReadStatesR,
    tenantPanelReadStatesR,
    tenantExamsR,
    tenantExamQuestionsR,
    notificationsR,
    forumPostsR
  ].forEach((r) => {
    if (r && r.warning) previewPushWarning(warnings, r.warning);
  });

  if (storageR && storageR.warning) previewPushWarning(warnings, storageR.warning);

  const membershipsTotal = membershipsTotalR.value;
  const membershipsStudent = membershipsStudentR.value;
  const membershipsAdmin = membershipsAdminR.value;
  let membershipsOther = null;
  if (membershipsTotal != null && membershipsStudent != null && membershipsAdmin != null) {
    membershipsOther = Math.max(0, membershipsTotal - membershipsStudent - membershipsAdmin);
  }

  const authImpact = await previewComputeAuthImpact(tenantId, membershipsTotal, warnings);

  const counts = {
    memberships: {
      total: membershipsTotal,
      student: membershipsStudent,
      institutionAdmin: membershipsAdmin,
      otherRole: membershipsOther
    },
    directDocuments: {
      tenant: directTenantR.value,
      settings: directSettingsR.value,
      billing: directBillingR.value
    },
    mailboxMessages: mailboxMessagesR.value,
    announcements: announcementsR.value,
    studentPayments: studentPaymentsR.value,
    nestedPaymentLogs: null,
    examAttempts: examAttemptsR.value,
    lessonProgress: lessonProgressR.value,
    mailboxThreadStates: mailboxThreadStatesR.value,
    institutionChatReadStates: institutionChatReadStatesR.value,
    tenantPanelReadStates: tenantPanelReadStatesR.value,
    tenantExams: {
      exams: tenantExamsR.value,
      questions: tenantExamQuestionsR.value,
      protected: protectedTenant
    },
    notifications: notificationsR.value,
    forumPosts: forumPostsR.value
  };

  const storage = {
    status: storageR.status || 'error',
    prefix: storageR.prefix || ('tenant-logos/' + tenantId + '/'),
    objectCount: storageR.objectCount,
    totalBytes: storageR.totalBytes
  };

  return previewFormatResponse({
    tenantId,
    protectedTenant,
    tenantExists: protectedTenant ? tenantExists : true,
    tenantStatus,
    counts,
    authImpact,
    storage,
    warnings
  });
});

// --- Permanent tenant deletion pilot (Patch C1) ---
const DELETE_PROTECTED_TENANT_ID = 'surucu_akademisi';
const DELETE_PREVIEW_VERSION = 1;
const DELETE_JOB_VERSION = 1;
const DELETE_BATCH_SIZE = 400;
const DELETE_LEASE_MS = 8 * 60 * 1000;
const DELETE_ACTIVE_STATUSES = [
  'queued', 'validating', 'locking_memberships', 'deleting_memberships',
  'deleting_nested_firestore', 'deleting_top_level_references',
  'deleting_cross_references', 'deleting_storage', 'finalizing'
];
const DELETE_SAFE_PHASES = [
  'queued', 'validating', 'locking_memberships', 'deleting_memberships',
  'deleting_nested_firestore', 'deleting_top_level_references',
  'deleting_cross_references', 'deleting_storage', 'finalizing', 'completed',
  'blocked', 'failed'
];

function deleteIsProtectedTenant(tenantId) {
  return tenantId === DELETE_PROTECTED_TENANT_ID;
}

function deleteIsEligibleForPermanentDeletion(tenantId) {
  return !deleteIsProtectedTenant(tenantId);
}

function deleteIsActiveDeletionStatus(status) {
  return DELETE_ACTIVE_STATUSES.indexOf(String(status || '')) !== -1;
}

function deleteSanitizePhase(phase) {
  const p = String(phase || '').trim();
  return DELETE_SAFE_PHASES.indexOf(p) !== -1 ? p : 'unknown';
}

function deleteSanitizeJobForClient(data) {
  if (!data) return null;
  return {
    tenantId: data.tenantId || null,
    status: data.status || null,
    phase: deleteSanitizePhase(data.phase),
    pilotMode: data.pilotMode === true,
    requestGeneration: data.requestGeneration != null ? Number(data.requestGeneration) : null,
    counts: data.counts || {},
    warningCodes: Array.isArray(data.warningCodes) ? data.warningCodes : [],
    errorCode: data.errorCode ? String(data.errorCode) : null,
    startedAt: data.startedAt || null,
    updatedAt: data.updatedAt || null,
    completedAt: data.completedAt || null
  };
}

function deleteBuildQueuedJobPayload(tenantId, callerUid, requestGeneration) {
  return {
    jobVersion: DELETE_JOB_VERSION,
    tenantId,
    status: 'queued',
    phase: 'queued',
    pilotMode: false,
    requestGeneration,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    startedByUid: callerUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    counts: {},
    warningCodes: [],
    errorCode: null,
    phaseCursor: null
  };
}

function deleteIsIndexError(e) {
  const code = Number(e && e.code);
  const msg = String((e && e.message) || '').toLowerCase();
  return code === 9 || msg.indexOf('index') !== -1 || msg.indexOf('failed_precondition') !== -1;
}

async function deleteQueryBatch(queryRef, batchSize) {
  const limit = batchSize || DELETE_BATCH_SIZE;
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

async function deleteCollectionPaginated(collectionRef, batchSize) {
  const limit = batchSize || DELETE_BATCH_SIZE;
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

async function deleteRecursiveSafe(docRef) {
  try {
    await db.recursiveDelete(docRef);
    return true;
  } catch (e) {
    const snap = await docRef.get();
    if (!snap.exists) return true;
    throw e;
  }
}

async function deleteStorageTenantLogos(tenantId) {
  const prefix = 'tenant-logos/' + tenantId + '/';
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix });
  for (let i = 0; i < files.length; i++) {
    try {
      await files[i].delete({ ignoreNotFound: true });
    } catch (e) {
      const code = String((e && e.code) || '');
      if (code !== '404' && code.indexOf('not-found') === -1) throw e;
    }
  }
  return files.length;
}

async function deleteTryAcquireLease(tenantId) {
  return db.runTransaction(async (tx) => {
    const ref = db.collection('tenantDeletionJobs').doc(tenantId);
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const job = snap.data() || {};
    if (job.status === 'completed') return null;
    if (job.status === 'failed' || job.status === 'blocked') return null;
    if (job.status !== 'queued' && !deleteIsActiveDeletionStatus(job.status)) return null;
    const leaseExp = job.workerLeaseExpiresAt;
    if (leaseExp && typeof leaseExp.toMillis === 'function' && leaseExp.toMillis() > Date.now()) {
      return null;
    }
    const leaseId = 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const leaseExpires = admin.firestore.Timestamp.fromMillis(Date.now() + DELETE_LEASE_MS);
    const nextStatus = job.status === 'queued' ? 'validating' : job.status;
    const nextPhase = job.status === 'queued' ? 'validating' : (job.phase || nextStatus);
    tx.update(ref, {
      workerLeaseId: leaseId,
      workerLeaseExpiresAt: leaseExpires,
      status: nextStatus,
      phase: nextPhase,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { leaseId, requestGeneration: job.requestGeneration || 1 };
  });
}

async function deleteUpdateJobProgress(tenantId, leaseId, requestGeneration, status, phase, counts, extra) {
  const ref = db.collection('tenantDeletionJobs').doc(tenantId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const job = snap.data() || {};
  if (job.requestGeneration !== requestGeneration || job.workerLeaseId !== leaseId) return false;
  const patch = {
    status,
    phase: deleteSanitizePhase(phase),
    counts: counts || {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    workerLeaseExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + DELETE_LEASE_MS)
  };
  if (extra) Object.assign(patch, extra);
  await ref.update(patch);
  return true;
}

async function deleteMarkBlocked(tenantId, leaseId, requestGeneration, phase, errorCode, counts) {
  const ref = db.collection('tenantDeletionJobs').doc(tenantId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const job = snap.data() || {};
  if (job.requestGeneration !== requestGeneration || job.workerLeaseId !== leaseId) return;
  await ref.update({
    status: 'blocked',
    phase: deleteSanitizePhase(phase),
    errorCode: errorCode || 'FINAL_VERIFICATION_FAILED',
    counts: counts || {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    workerLeaseId: admin.firestore.FieldValue.delete(),
    workerLeaseExpiresAt: admin.firestore.FieldValue.delete()
  });
}

async function deleteMarkFailed(tenantId, leaseId, requestGeneration, errorCode, counts, phase) {
  const ref = db.collection('tenantDeletionJobs').doc(tenantId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const job = snap.data() || {};
  if (job.requestGeneration !== requestGeneration || job.workerLeaseId !== leaseId) return;
  await ref.update({
    status: 'failed',
    phase: deleteSanitizePhase(phase || job.phase),
    errorCode: errorCode || 'INTERNAL_DELETION_ERROR',
    counts: counts || {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    workerLeaseId: admin.firestore.FieldValue.delete(),
    workerLeaseExpiresAt: admin.firestore.FieldValue.delete()
  });
}

async function deleteMarkCompleted(tenantId, leaseId, requestGeneration, counts) {
  const ref = db.collection('tenantDeletionJobs').doc(tenantId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const job = snap.data() || {};
  if (job.requestGeneration !== requestGeneration || job.workerLeaseId !== leaseId) return;
  await ref.update({
    status: 'completed',
    phase: 'completed',
    counts: counts || {},
    errorCode: admin.firestore.FieldValue.delete(),
    phaseCursor: admin.firestore.FieldValue.delete(),
    workerLeaseId: admin.firestore.FieldValue.delete(),
    workerLeaseExpiresAt: admin.firestore.FieldValue.delete(),
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function deleteAssertWorkerLease(tenantId, leaseId, requestGeneration) {
  const snap = await db.collection('tenantDeletionJobs').doc(tenantId).get();
  if (!snap.exists) return false;
  const job = snap.data() || {};
  return job.requestGeneration === requestGeneration
    && job.workerLeaseId === leaseId
    && job.status !== 'completed'
    && job.status !== 'failed'
    && job.status !== 'blocked';
}

async function deleteProbeRequiredIndexes(tenantId) {
  try {
    await db.collectionGroup('messages').where('sourceTenantId', '==', tenantId).limit(1).get();
    await db.collectionGroup('messages').where('replyTargetTenantId', '==', tenantId).limit(1).get();
    await db.collectionGroup('deviceTokens').where('tenantId', '==', tenantId).limit(1).get();
    return null;
  } catch (e) {
    if (deleteIsIndexError(e)) return 'INDEX_REQUIRED';
    throw e;
  }
}

async function deleteRecomputeDeletionImpact(tenantId) {
  const warningCodes = [];
  const counts = {};
  try {
    const memCount = await db.collection('tenantMemberships').where('tenantId', '==', tenantId).count().get();
    counts.membershipsTotal = memCount.data().count;
  } catch (e) {
    warningCodes.push('MEMBERSHIPS_TOTAL_COUNT_FAILED');
  }
  const indexError = await deleteProbeRequiredIndexes(tenantId);
  if (indexError) warningCodes.push(indexError);
  return { counts, warningCodes, indexError };
}

async function deleteCollectionHasDocs(queryRef) {
  const snap = await queryRef.limit(1).get();
  return !snap.empty;
}

async function deleteLockMemberships(tenantId) {
  let locked = 0;
  const q = db.collection('tenantMemberships').where('tenantId', '==', tenantId);
  while (true) {
    const snap = await q.limit(DELETE_BATCH_SIZE).get();
    if (!snap || snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'deleting',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    locked += snap.size;
    if (snap.size < DELETE_BATCH_SIZE) break;
  }
  return locked;
}

async function deleteMembershipsWithAuthCounts(tenantId) {
  const snap = await db.collection('tenantMemberships').where('tenantId', '==', tenantId).get();
  let membershipsRemoved = 0;
  let multiTenantUsersPreserved = 0;
  let orphanReviewRecommended = 0;

  for (let i = 0; i < snap.docs.length; i++) {
    const doc = snap.docs[i];
    const mem = doc.data() || {};
    const uid = String(mem.uid || mem.userId || '').trim();
    if (uid) {
      const otherSnap = await db.collection('tenantMemberships').where('uid', '==', uid).limit(25).get();
      let hasOther = false;
      for (let j = 0; j < otherSnap.docs.length; j++) {
        const other = otherSnap.docs[j];
        if (other.id !== doc.id) {
          const otherTenant = String((other.data().tenantId || '')).trim();
          if (otherTenant && otherTenant !== tenantId) {
            hasOther = true;
            break;
          }
        }
      }
      if (hasOther) {
        multiTenantUsersPreserved += 1;
      } else {
        const ev = await previewEvaluateAuthPreserve(uid, tenantId);
        if (ev.preserve) orphanReviewRecommended += 1;
      }
    }
    await doc.ref.delete();
    membershipsRemoved += 1;
  }

  return {
    membershipsRemoved,
    authAccountsPreserved: membershipsRemoved,
    multiTenantUsersPreserved,
    orphanReviewRecommended
  };
}

async function deleteNestedFirestore(tenantId) {
  let nestedDocsRemoved = 0;
  const tenantRef = db.collection('tenants').doc(tenantId);

  const settingsRef = db.collection('tenantSettings').doc(tenantId);
  if ((await settingsRef.get()).exists) {
    await settingsRef.delete();
    nestedDocsRemoved += 1;
  }

  const billingRef = db.collection('tenantBilling').doc(tenantId);
  if ((await billingRef.get()).exists) {
    await billingRef.delete();
    nestedDocsRemoved += 1;
  }

  await deleteRecursiveSafe(db.collection('tenantMailbox').doc(tenantId));

  nestedDocsRemoved += await deleteCollectionPaginated(tenantRef.collection('announcements'));
  nestedDocsRemoved += await deleteCollectionPaginated(tenantRef.collection('exam_attempts'));
  nestedDocsRemoved += await deleteCollectionPaginated(tenantRef.collection('lesson_progress'));
  nestedDocsRemoved += await deleteCollectionPaginated(tenantRef.collection('mailboxThreadStates'));

  const studentPaymentsSnap = await tenantRef.collection('studentPayments').get();
  for (let i = 0; i < studentPaymentsSnap.docs.length; i++) {
    const spDoc = studentPaymentsSnap.docs[i];
    nestedDocsRemoved += await deleteCollectionPaginated(spDoc.ref.collection('paymentLog'));
    await spDoc.ref.delete();
    nestedDocsRemoved += 1;
  }

  await deleteRecursiveSafe(db.collection('institutionChatReadStates').doc(tenantId));
  await deleteRecursiveSafe(db.collection('tenantPanelReadStates').doc(tenantId));
  await deleteRecursiveSafe(db.collection('tenantExams').doc(tenantId));

  return { nestedDocsRemoved };
}

async function deleteTopLevelReferences(tenantId) {
  let topLevelRemoved = 0;
  topLevelRemoved += await deleteQueryBatch(db.collection('notifications').where('tenantId', '==', tenantId));
  topLevelRemoved += await deleteQueryBatch(db.collection('forum_posts').where('tenantId', '==', tenantId));
  topLevelRemoved += await deleteQueryBatch(db.collection('duelInvites').where('tenantId', '==', tenantId));
  topLevelRemoved += await deleteQueryBatch(db.collection('duel_presence').where('tenantId', '==', tenantId));

  const duelQuery = db.collection('duels').where('tenantId', '==', tenantId);
  while (true) {
    const snap = await duelQuery.limit(DELETE_BATCH_SIZE).get();
    if (!snap || snap.empty) break;
    for (let i = 0; i < snap.docs.length; i++) {
      await deleteRecursiveSafe(snap.docs[i].ref);
      topLevelRemoved += 1;
    }
    if (snap.size < DELETE_BATCH_SIZE) break;
  }

  return { topLevelRemoved };
}

async function deleteCrossUserReferences(tenantId) {
  const seen = new Set();
  let crossUserRemoved = 0;

  async function batchDelete(queryRef) {
    while (true) {
      const snap = await queryRef.limit(DELETE_BATCH_SIZE).get();
      if (!snap || snap.empty) break;
      const batch = db.batch();
      let batchCount = 0;
      snap.docs.forEach((doc) => {
        if (seen.has(doc.ref.path)) return;
        seen.add(doc.ref.path);
        batch.delete(doc.ref);
        batchCount += 1;
      });
      if (batchCount > 0) await batch.commit();
      crossUserRemoved += batchCount;
      if (snap.size < DELETE_BATCH_SIZE) break;
    }
  }

  try {
    await batchDelete(db.collectionGroup('messages').where('sourceTenantId', '==', tenantId));
    await batchDelete(db.collectionGroup('messages').where('replyTargetTenantId', '==', tenantId));
    await batchDelete(db.collectionGroup('deviceTokens').where('tenantId', '==', tenantId));
  } catch (e) {
    if (deleteIsIndexError(e)) {
      throw Object.assign(new Error('INDEX_REQUIRED'), { safeCode: 'INDEX_REQUIRED' });
    }
    throw e;
  }

  return { crossUserRemoved };
}

async function deleteVerifyFinalization(tenantId) {
  const tenantRef = db.collection('tenants').doc(tenantId);

  if (await deleteCollectionHasDocs(db.collection('tenantMemberships').where('tenantId', '==', tenantId))) {
    return { ok: false, errorCode: 'MEMBERSHIP_CLEANUP_INCOMPLETE', phase: 'finalizing' };
  }

  const studentPaymentsSnap = await tenantRef.collection('studentPayments').limit(1).get();
  if (!studentPaymentsSnap.empty) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }

  try {
    const srcSnap = await db.collectionGroup('messages').where('sourceTenantId', '==', tenantId).limit(1).get();
    if (!srcSnap.empty) {
      return { ok: false, errorCode: 'USER_MAILBOX_CLEANUP_INCOMPLETE', phase: 'finalizing' };
    }
    const replySnap = await db.collectionGroup('messages').where('replyTargetTenantId', '==', tenantId).limit(1).get();
    if (!replySnap.empty) {
      return { ok: false, errorCode: 'USER_MAILBOX_CLEANUP_INCOMPLETE', phase: 'finalizing' };
    }
    const dtSnap = await db.collectionGroup('deviceTokens').where('tenantId', '==', tenantId).limit(1).get();
    if (!dtSnap.empty) {
      return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
    }
  } catch (e) {
    if (deleteIsIndexError(e)) {
      return { ok: false, errorCode: 'INDEX_REQUIRED', phase: 'finalizing' };
    }
    throw e;
  }

  if (await deleteCollectionHasDocs(db.collection('notifications').where('tenantId', '==', tenantId))) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  if (await deleteCollectionHasDocs(db.collection('forum_posts').where('tenantId', '==', tenantId))) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  if (await deleteCollectionHasDocs(db.collection('duelInvites').where('tenantId', '==', tenantId))) {
    return { ok: false, errorCode: 'DUEL_CLEANUP_INCOMPLETE', phase: 'finalizing' };
  }
  if (await deleteCollectionHasDocs(db.collection('duels').where('tenantId', '==', tenantId))) {
    return { ok: false, errorCode: 'DUEL_CLEANUP_INCOMPLETE', phase: 'finalizing' };
  }
  if (await deleteCollectionHasDocs(db.collection('duel_presence').where('tenantId', '==', tenantId))) {
    return { ok: false, errorCode: 'DUEL_CLEANUP_INCOMPLETE', phase: 'finalizing' };
  }

  const settingsSnap = await db.collection('tenantSettings').doc(tenantId).get();
  if (settingsSnap.exists) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  const billingSnap = await db.collection('tenantBilling').doc(tenantId).get();
  if (billingSnap.exists) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  const mailboxSnap = await db.collection('tenantMailbox').doc(tenantId).get();
  if (mailboxSnap.exists) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }

  if (await deleteCollectionHasDocs(tenantRef.collection('announcements'))) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  if (await deleteCollectionHasDocs(tenantRef.collection('exam_attempts'))) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  if (await deleteCollectionHasDocs(tenantRef.collection('lesson_progress'))) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  if (await deleteCollectionHasDocs(tenantRef.collection('mailboxThreadStates'))) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  const instSnap = await db.collection('institutionChatReadStates').doc(tenantId).get();
  if (instSnap.exists) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  const panelSnap = await db.collection('tenantPanelReadStates').doc(tenantId).get();
  if (panelSnap.exists) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }
  const examsSnap = await db.collection('tenantExams').doc(tenantId).get();
  if (examsSnap.exists) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }

  const prefix = 'tenant-logos/' + tenantId + '/';
  const [files] = await admin.storage().bucket().getFiles({ prefix });
  if (files.length > 0) {
    return { ok: false, errorCode: 'FINAL_VERIFICATION_FAILED', phase: 'finalizing' };
  }

  return { ok: true };
}

async function deleteRunTenantDeletionWorker(tenantId, leaseId, requestGeneration) {
  const jobRef = db.collection('tenantDeletionJobs').doc(tenantId);
  let counts = {};
  let phase = 'validating';

  try {
    while (await deleteAssertWorkerLease(tenantId, leaseId, requestGeneration)) {
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) return;
      const job = jobSnap.data() || {};
      counts = Object.assign({}, job.counts || {}, counts);
      phase = deleteSanitizePhase(job.phase || phase);

      if (phase === 'validating' || phase === 'queued') {
        if (!deleteIsEligibleForPermanentDeletion(tenantId)) {
          await deleteMarkBlocked(tenantId, leaseId, requestGeneration, 'validating', 'PROTECTED_TENANT', counts);
          return;
        }
        const impact = await deleteRecomputeDeletionImpact(tenantId);
        counts.impactPreview = impact.counts;
        if (impact.indexError) {
          await deleteMarkBlocked(tenantId, leaseId, requestGeneration, 'validating', 'INDEX_REQUIRED', counts);
          return;
        }
        await deleteUpdateJobProgress(tenantId, leaseId, requestGeneration, 'locking_memberships', 'locking_memberships', counts, {
          warningCodes: impact.warningCodes || []
        });
        continue;
      }

      if (phase === 'locking_memberships') {
        counts.membershipsLocked = await deleteLockMemberships(tenantId);
        await deleteUpdateJobProgress(tenantId, leaseId, requestGeneration, 'deleting_memberships', 'deleting_memberships', counts);
        continue;
      }

      if (phase === 'deleting_memberships') {
        const memCounts = await deleteMembershipsWithAuthCounts(tenantId);
        Object.assign(counts, memCounts);
        await deleteUpdateJobProgress(tenantId, leaseId, requestGeneration, 'deleting_nested_firestore', 'deleting_nested_firestore', counts);
        continue;
      }

      if (phase === 'deleting_nested_firestore') {
        const nested = await deleteNestedFirestore(tenantId);
        Object.assign(counts, nested);
        await deleteUpdateJobProgress(tenantId, leaseId, requestGeneration, 'deleting_top_level_references', 'deleting_top_level_references', counts);
        continue;
      }

      if (phase === 'deleting_top_level_references') {
        const top = await deleteTopLevelReferences(tenantId);
        Object.assign(counts, top);
        await deleteUpdateJobProgress(tenantId, leaseId, requestGeneration, 'deleting_cross_references', 'deleting_cross_references', counts);
        continue;
      }

      if (phase === 'deleting_cross_references') {
        try {
          const cross = await deleteCrossUserReferences(tenantId);
          Object.assign(counts, cross);
        } catch (e) {
          const code = e && e.safeCode ? e.safeCode : (deleteIsIndexError(e) ? 'INDEX_REQUIRED' : 'INTERNAL_DELETION_ERROR');
          if (code === 'INDEX_REQUIRED') {
            await deleteMarkBlocked(tenantId, leaseId, requestGeneration, 'deleting_cross_references', code, counts);
          } else {
            await deleteMarkFailed(tenantId, leaseId, requestGeneration, code, counts, 'deleting_cross_references');
          }
          return;
        }
        await deleteUpdateJobProgress(tenantId, leaseId, requestGeneration, 'deleting_storage', 'deleting_storage', counts);
        continue;
      }

      if (phase === 'deleting_storage') {
        try {
          counts.storageObjectsRemoved = await deleteStorageTenantLogos(tenantId);
        } catch (e) {
          console.error('[onTenantDeletionJobWrite] storage cleanup failed tenantId=', tenantId, e && e.message ? e.message : e);
          await deleteMarkFailed(tenantId, leaseId, requestGeneration, 'STORAGE_CLEANUP_FAILED', counts, 'deleting_storage');
          return;
        }
        await deleteUpdateJobProgress(tenantId, leaseId, requestGeneration, 'finalizing', 'finalizing', counts);
        continue;
      }

      if (phase === 'finalizing') {
        const verify = await deleteVerifyFinalization(tenantId);
        if (!verify.ok) {
          await deleteMarkBlocked(tenantId, leaseId, requestGeneration, verify.phase || 'finalizing', verify.errorCode, counts);
          return;
        }
        const tenantRef = db.collection('tenants').doc(tenantId);
        if ((await tenantRef.get()).exists) {
          await tenantRef.delete();
        }
        await deleteMarkCompleted(tenantId, leaseId, requestGeneration, counts);
        return;
      }

      await deleteMarkFailed(tenantId, leaseId, requestGeneration, 'INTERNAL_DELETION_ERROR', counts, phase);
      return;
    }
  } catch (e) {
    const code = e && e.safeCode ? e.safeCode : 'INTERNAL_DELETION_ERROR';
    console.error('[onTenantDeletionJobWrite] worker error tenantId=', tenantId, code, e && e.message ? e.message : e);
    if (code === 'WORKER_LEASE_LOST') return;
    await deleteMarkFailed(tenantId, leaseId, requestGeneration, code, counts, phase);
  }
}

function deleteValidateStartGuards(tenantId) {
  if (!deleteIsEligibleForPermanentDeletion(tenantId)) {
    throw new HttpsError('failed-precondition', 'PROTECTED_TENANT');
  }
}

exports.startPermanentTenantDeletion = onCall(async (request) => {
  const data = request && request.data ? request.data : {};
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const tenantId = previewValidateTenantId(data && data.tenantId != null ? String(data.tenantId) : '');
  await previewAssertSuperAdmin(callerUid);

  const confirmationRaw = data && data.confirmationTenantId;
  if (typeof confirmationRaw !== 'string') {
    throw new HttpsError('failed-precondition', 'CONFIRMATION_MISMATCH');
  }
  const confirmationTenantId = confirmationRaw;
  if (confirmationTenantId.trim() !== tenantId) {
    throw new HttpsError('failed-precondition', 'CONFIRMATION_MISMATCH');
  }

  const previewVersion = data && data.previewVersion != null ? Number(data.previewVersion) : null;
  if (previewVersion !== DELETE_PREVIEW_VERSION) {
    throw new HttpsError('failed-precondition', 'PREVIEW_VERSION_MISMATCH');
  }

  deleteValidateStartGuards(tenantId);

  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) {
    throw new HttpsError('not-found', 'TENANT_NOT_FOUND');
  }

  const impact = await deleteRecomputeDeletionImpact(tenantId);
  if (impact.indexError) {
    throw new HttpsError('failed-precondition', 'INDEX_REQUIRED');
  }

  const jobRef = db.collection('tenantDeletionJobs').doc(tenantId);
  const existingSnap = await jobRef.get();
  if (existingSnap.exists) {
    const existing = existingSnap.data() || {};
    if (existing.status === 'completed') {
      throw new HttpsError('failed-precondition', 'JOB_ALREADY_COMPLETED');
    }
    if (existing.status === 'queued' || deleteIsActiveDeletionStatus(existing.status)) {
      return deleteSanitizeJobForClient(existing);
    }
  }

  const txnResult = await db.runTransaction(async (tx) => {
    const tenantRef = db.collection('tenants').doc(tenantId);
    const jobRefTx = db.collection('tenantDeletionJobs').doc(tenantId);
    const tenantDoc = await tx.get(tenantRef);
    const jobDoc = await tx.get(jobRefTx);
    if (!tenantDoc.exists) {
      throw new HttpsError('not-found', 'TENANT_NOT_FOUND');
    }

    if (jobDoc.exists) {
      const existing = jobDoc.data() || {};
      if (existing.status === 'completed') {
        throw new HttpsError('failed-precondition', 'JOB_ALREADY_COMPLETED');
      }
      if (existing.status !== 'failed' && existing.status !== 'blocked') {
        return { existing };
      }
    }

    const nextGen = jobDoc.exists
      ? ((jobDoc.data() || {}).requestGeneration || 1) + 1
      : 1;
    const payload = deleteBuildQueuedJobPayload(tenantId, callerUid, nextGen);
    payload.warningCodes = impact.warningCodes || [];
    payload.counts = impact.counts || {};
    tx.set(jobRefTx, payload);
    tx.update(tenantRef, {
      status: 'deleting',
      deletionLockedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { payload };
  });

  if (txnResult && txnResult.existing) {
    return deleteSanitizeJobForClient(txnResult.existing);
  }

  const createdSnap = await jobRef.get();
  return deleteSanitizeJobForClient(createdSnap.exists ? createdSnap.data() : txnResult.payload);
});

exports.getPermanentTenantDeletionStatus = onCall(async (request) => {
  const data = request && request.data ? request.data : {};
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  await previewAssertSuperAdmin(callerUid);
  const tenantId = previewValidateTenantId(data && data.tenantId != null ? String(data.tenantId) : '');

  if (!deleteIsEligibleForPermanentDeletion(tenantId)) {
    throw new HttpsError('failed-precondition', 'PROTECTED_TENANT');
  }

  const jobSnap = await db.collection('tenantDeletionJobs').doc(tenantId).get();
  if (!jobSnap.exists) {
    throw new HttpsError('not-found', 'JOB_NOT_FOUND');
  }

  return deleteSanitizeJobForClient(jobSnap.data());
});

exports.onTenantDeletionJobWrite = onDocumentWritten({
  document: 'tenantDeletionJobs/{tenantId}',
  timeoutSeconds: 540,
  memory: '512MiB'
}, async (event) => {
  const tenantId = event.params.tenantId;
  try {
    const lease = await deleteTryAcquireLease(tenantId);
    if (!lease) return;
    await deleteRunTenantDeletionWorker(tenantId, lease.leaseId, lease.requestGeneration);
  } catch (e) {
    console.error('[onTenantDeletionJobWrite] trigger error tenantId=', tenantId, e && e.message ? e.message : e);
  }
});

// --- Post-deletion audit (Patch C3-A) ---
const POST_DELETE_AUDIT_VERSION = 1;

function auditPushBlocker(blockers, code) {
  if (!code || blockers.indexOf(code) !== -1) return;
  blockers.push(code);
}

function auditIsIndexError(e) {
  const code = Number(e && e.code);
  const msg = String((e && e.message) || '').toLowerCase();
  return code === 9 || msg.indexOf('index') !== -1 || msg.indexOf('failed_precondition') !== -1;
}

async function auditSafeDocExists(collectionName, docId) {
  try {
    const snap = await db.collection(collectionName).doc(docId).get();
    return snap.exists ? 1 : 0;
  } catch (e) {
    return null;
  }
}

async function auditSafeCountQuery(queryRef) {
  const snap = await queryRef.count().get();
  return snap.data().count;
}

async function auditSafeCollectionCount(collectionRef) {
  const snap = await collectionRef.count().get();
  return snap.data().count;
}

async function auditCountPaymentLogs(tenantId) {
  const tenantRef = db.collection('tenants').doc(tenantId);
  const spSnap = await tenantRef.collection('studentPayments').get();
  let total = 0;
  for (let i = 0; i < spSnap.docs.length; i++) {
    const plSnap = await spSnap.docs[i].ref.collection('paymentLog').count().get();
    total += plSnap.data().count;
  }
  return total;
}

async function auditStorageObjectCount(tenantId) {
  const prefix = 'tenant-logos/' + tenantId + '/';
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix });
  return files.length;
}

function auditSanitizeDeletionJob(snap) {
  if (!snap || !snap.exists) {
    return {
      exists: false,
      status: null,
      phase: null,
      errorCode: null,
      warningCodes: []
    };
  }
  const data = snap.data() || {};
  const warningCodes = Array.isArray(data.warningCodes)
    ? data.warningCodes.map((c) => String(c))
    : [];
  return {
    exists: true,
    status: data.status != null ? String(data.status) : null,
    phase: data.phase != null ? String(data.phase) : null,
    errorCode: data.errorCode != null && data.errorCode !== '' ? String(data.errorCode) : null,
    warningCodes
  };
}

function auditEvaluateJobBlockers(deletionJob, blockers) {
  if (!deletionJob.exists) {
    auditPushBlocker(blockers, 'JOB_NOT_FOUND');
    return;
  }
  if (deletionJob.status !== 'completed' || deletionJob.phase !== 'completed') {
    auditPushBlocker(blockers, 'JOB_NOT_COMPLETED');
  }
  if (deletionJob.errorCode != null) {
    auditPushBlocker(blockers, 'JOB_ERROR_CODE_PRESENT');
  }
  if (deletionJob.warningCodes && deletionJob.warningCodes.length > 0) {
    auditPushBlocker(blockers, 'JOB_WARNING_CODES_PRESENT');
  }
}

function auditRemainingHasNull(remaining) {
  const direct = remaining.directDocuments || {};
  const directVals = [
    direct.tenants, direct.tenantSettings, direct.tenantBilling, direct.tenantMailbox,
    direct.institutionChatReadStates, direct.tenantPanelReadStates, direct.tenantExams
  ];
  for (let i = 0; i < directVals.length; i++) {
    if (directVals[i] === null) return true;
  }
  const nested = remaining.tenantNested || {};
  const nestedVals = [
    nested.announcements, nested.examAttempts, nested.lessonProgress,
    nested.mailboxThreadStates, nested.studentPayments, nested.paymentLogs
  ];
  for (let i = 0; i < nestedVals.length; i++) {
    if (nestedVals[i] === null) return true;
  }
  const topVals = [
    remaining.memberships, remaining.notifications, remaining.forumPosts,
    remaining.duelInvites, remaining.duels, remaining.duelPresence,
    remaining.sourceTenantMessages, remaining.replyTargetMessages,
    remaining.deviceTokens, remaining.storageObjects
  ];
  for (let i = 0; i < topVals.length; i++) {
    if (topVals[i] === null) return true;
  }
  return false;
}

function auditRemainingAllZero(remaining) {
  const direct = remaining.directDocuments || {};
  const directVals = [
    direct.tenants, direct.tenantSettings, direct.tenantBilling, direct.tenantMailbox,
    direct.institutionChatReadStates, direct.tenantPanelReadStates, direct.tenantExams
  ];
  for (let i = 0; i < directVals.length; i++) {
    if (directVals[i] !== 0) return false;
  }
  const nested = remaining.tenantNested || {};
  const nestedVals = [
    nested.announcements, nested.examAttempts, nested.lessonProgress,
    nested.mailboxThreadStates, nested.studentPayments, nested.paymentLogs
  ];
  for (let i = 0; i < nestedVals.length; i++) {
    if (nestedVals[i] !== 0) return false;
  }
  const topVals = [
    remaining.memberships, remaining.notifications, remaining.forumPosts,
    remaining.duelInvites, remaining.duels, remaining.duelPresence,
    remaining.sourceTenantMessages, remaining.replyTargetMessages,
    remaining.deviceTokens, remaining.storageObjects
  ];
  for (let i = 0; i < topVals.length; i++) {
    if (topVals[i] !== 0) return false;
  }
  return true;
}

function auditEvaluateRemainingBlockers(remaining, blockers) {
  const direct = remaining.directDocuments || {};
  if (direct.tenants != null && direct.tenants > 0) {
    auditPushBlocker(blockers, 'REMAINING_TENANT_ROOT');
  }
  const directKeys = [
    'tenantSettings', 'tenantBilling', 'tenantMailbox',
    'institutionChatReadStates', 'tenantPanelReadStates', 'tenantExams'
  ];
  for (let i = 0; i < directKeys.length; i++) {
    if (direct[directKeys[i]] != null && direct[directKeys[i]] > 0) {
      auditPushBlocker(blockers, 'REMAINING_DIRECT_DOCUMENT');
      break;
    }
  }
  const nested = remaining.tenantNested || {};
  const nestedKeys = ['announcements', 'examAttempts', 'lessonProgress', 'mailboxThreadStates', 'studentPayments'];
  for (let i = 0; i < nestedKeys.length; i++) {
    if (nested[nestedKeys[i]] != null && nested[nestedKeys[i]] > 0) {
      auditPushBlocker(blockers, 'REMAINING_TENANT_NESTED');
      break;
    }
  }
  if (nested.paymentLogs != null && nested.paymentLogs > 0) {
    auditPushBlocker(blockers, 'REMAINING_PAYMENT_LOG');
  }
  if (remaining.memberships != null && remaining.memberships > 0) {
    auditPushBlocker(blockers, 'REMAINING_MEMBERSHIPS');
  }
  if (remaining.notifications != null && remaining.notifications > 0) {
    auditPushBlocker(blockers, 'REMAINING_NOTIFICATIONS');
  }
  if (remaining.forumPosts != null && remaining.forumPosts > 0) {
    auditPushBlocker(blockers, 'REMAINING_FORUM_POSTS');
  }
  if (remaining.duelInvites != null && remaining.duelInvites > 0) {
    auditPushBlocker(blockers, 'REMAINING_DUEL_INVITES');
  }
  if (remaining.duels != null && remaining.duels > 0) {
    auditPushBlocker(blockers, 'REMAINING_DUELS');
  }
  if (remaining.duelPresence != null && remaining.duelPresence > 0) {
    auditPushBlocker(blockers, 'REMAINING_DUEL_PRESENCE');
  }
  if (remaining.sourceTenantMessages != null && remaining.sourceTenantMessages > 0) {
    auditPushBlocker(blockers, 'REMAINING_SOURCE_TENANT_MESSAGES');
  }
  if (remaining.replyTargetMessages != null && remaining.replyTargetMessages > 0) {
    auditPushBlocker(blockers, 'REMAINING_REPLY_TARGET_MESSAGES');
  }
  if (remaining.deviceTokens != null && remaining.deviceTokens > 0) {
    auditPushBlocker(blockers, 'REMAINING_DEVICE_TOKENS');
  }
  if (remaining.storageObjects != null && remaining.storageObjects > 0) {
    auditPushBlocker(blockers, 'REMAINING_STORAGE_OBJECTS');
  }
}

async function auditRunProbe(probeFn, blockers, failureCode) {
  try {
    const value = await probeFn();
    if (value === null) {
      auditPushBlocker(blockers, failureCode || 'AUDIT_PROBE_FAILED');
    }
    return value;
  } catch (e) {
    if (auditIsIndexError(e)) {
      auditPushBlocker(blockers, 'INDEX_REQUIRED');
    } else {
      auditPushBlocker(blockers, failureCode || 'AUDIT_PROBE_FAILED');
    }
    return null;
  }
}

exports.auditPermanentTenantDeletion = onCall(async (request) => {
  const startMs = Date.now();
  const data = request && request.data ? request.data : {};
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  await previewAssertSuperAdmin(callerUid);
  const tenantId = previewValidateTenantId(data && data.tenantId != null ? String(data.tenantId) : '');

  if (!deleteIsEligibleForPermanentDeletion(tenantId)) {
    throw new HttpsError('failed-precondition', 'PROTECTED_TENANT');
  }

  const blockers = [];
  const tenantRef = db.collection('tenants').doc(tenantId);

  const jobSnap = await db.collection('tenantDeletionJobs').doc(tenantId).get();
  const deletionJob = auditSanitizeDeletionJob(jobSnap);
  auditEvaluateJobBlockers(deletionJob, blockers);

  const [
    tenantsExists,
    tenantSettingsExists,
    tenantBillingExists,
    tenantMailboxExists,
    institutionChatExists,
    tenantPanelExists,
    tenantExamsExists,
    announcementsCount,
    examAttemptsCount,
    lessonProgressCount,
    mailboxThreadStatesCount,
    studentPaymentsCount,
    paymentLogsCount,
    membershipsCount,
    notificationsCount,
    forumPostsCount,
    duelInvitesCount,
    duelsCount,
    duelPresenceCount,
    sourceTenantMessagesCount,
    replyTargetMessagesCount,
    deviceTokensCount,
    storageObjectsCount
  ] = await Promise.all([
    auditRunProbe(() => auditSafeDocExists('tenants', tenantId), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeDocExists('tenantSettings', tenantId), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeDocExists('tenantBilling', tenantId), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeDocExists('tenantMailbox', tenantId), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeDocExists('institutionChatReadStates', tenantId), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeDocExists('tenantPanelReadStates', tenantId), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeDocExists('tenantExams', tenantId), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeCollectionCount(tenantRef.collection('announcements')), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeCollectionCount(tenantRef.collection('exam_attempts')), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeCollectionCount(tenantRef.collection('lesson_progress')), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeCollectionCount(tenantRef.collection('mailboxThreadStates')), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditSafeCollectionCount(tenantRef.collection('studentPayments')), blockers, 'AUDIT_PROBE_FAILED'),
    auditRunProbe(() => auditCountPaymentLogs(tenantId), blockers, 'AUDIT_PAYMENT_LOG_PROBE_FAILED'),
    auditRunProbe(
      () => auditSafeCountQuery(db.collection('tenantMemberships').where('tenantId', '==', tenantId)),
      blockers,
      'AUDIT_PROBE_FAILED'
    ),
    auditRunProbe(
      () => auditSafeCountQuery(db.collection('notifications').where('tenantId', '==', tenantId)),
      blockers,
      'AUDIT_PROBE_FAILED'
    ),
    auditRunProbe(
      () => auditSafeCountQuery(db.collection('forum_posts').where('tenantId', '==', tenantId)),
      blockers,
      'AUDIT_PROBE_FAILED'
    ),
    auditRunProbe(
      () => auditSafeCountQuery(db.collection('duelInvites').where('tenantId', '==', tenantId)),
      blockers,
      'AUDIT_PROBE_FAILED'
    ),
    auditRunProbe(
      () => auditSafeCountQuery(db.collection('duels').where('tenantId', '==', tenantId)),
      blockers,
      'AUDIT_PROBE_FAILED'
    ),
    auditRunProbe(
      () => auditSafeCountQuery(db.collection('duel_presence').where('tenantId', '==', tenantId)),
      blockers,
      'AUDIT_PROBE_FAILED'
    ),
    auditRunProbe(
      () => auditSafeCountQuery(db.collectionGroup('messages').where('sourceTenantId', '==', tenantId)),
      blockers,
      'INDEX_REQUIRED'
    ),
    auditRunProbe(
      () => auditSafeCountQuery(db.collectionGroup('messages').where('replyTargetTenantId', '==', tenantId)),
      blockers,
      'INDEX_REQUIRED'
    ),
    auditRunProbe(
      () => auditSafeCountQuery(db.collectionGroup('deviceTokens').where('tenantId', '==', tenantId)),
      blockers,
      'INDEX_REQUIRED'
    ),
    auditRunProbe(() => auditStorageObjectCount(tenantId), blockers, 'STORAGE_AUDIT_FAILED')
  ]);

  const remaining = {
    directDocuments: {
      tenants: tenantsExists,
      tenantSettings: tenantSettingsExists,
      tenantBilling: tenantBillingExists,
      tenantMailbox: tenantMailboxExists,
      institutionChatReadStates: institutionChatExists,
      tenantPanelReadStates: tenantPanelExists,
      tenantExams: tenantExamsExists
    },
    tenantNested: {
      announcements: announcementsCount,
      examAttempts: examAttemptsCount,
      lessonProgress: lessonProgressCount,
      mailboxThreadStates: mailboxThreadStatesCount,
      studentPayments: studentPaymentsCount,
      paymentLogs: paymentLogsCount
    },
    memberships: membershipsCount,
    notifications: notificationsCount,
    forumPosts: forumPostsCount,
    duelInvites: duelInvitesCount,
    duels: duelsCount,
    duelPresence: duelPresenceCount,
    sourceTenantMessages: sourceTenantMessagesCount,
    replyTargetMessages: replyTargetMessagesCount,
    deviceTokens: deviceTokensCount,
    storageObjects: storageObjectsCount
  };

  auditEvaluateRemainingBlockers(remaining, blockers);

  const clean = (
    !auditRemainingHasNull(remaining)
    && auditRemainingAllZero(remaining)
    && deletionJob.exists === true
    && deletionJob.status === 'completed'
    && deletionJob.phase === 'completed'
    && deletionJob.errorCode == null
    && Array.isArray(deletionJob.warningCodes)
    && deletionJob.warningCodes.length === 0
    && remaining.storageObjects === 0
    && blockers.length === 0
  );

  const durationMs = Date.now() - startMs;
  console.log('[auditPermanentTenantDeletion]', {
    action: 'auditPermanentTenantDeletion',
    tenantId,
    clean,
    blockerCodes: blockers,
    durationMs
  });

  return {
    ok: true,
    tenantId,
    auditVersion: POST_DELETE_AUDIT_VERSION,
    deletionJob,
    remaining,
    authPolicy: {
      accountsDeleted: false,
      accountsPreservedByDesign: true
    },
    clean,
    blockerCodes: blockers
  };
});
