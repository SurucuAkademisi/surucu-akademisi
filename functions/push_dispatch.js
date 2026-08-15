/**
 * Push notification dispatch helpers (N2A).
 * Membership-first recipient resolution, batched FCM, invalid token deactivation.
 */

const FCM_BATCH_SIZE = 500;
const TOKEN_UID_READ_CONCURRENCY = 25;
const USER_DOC_BATCH_SIZE = 10;

const ROLE_STUDENT = 'student';
const ROLE_INSTITUTION_ADMIN = 'institution_admin';

const PERMANENT_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const CONFIG_FCM_ERROR_CODES = new Set([
  'messaging/mismatched-credential',
  'messaging/third-party-auth-error',
]);

const PLATFORM_DISPLAY_NAME = 'Sürücü Akademisi';
const NATIVE_PUSH_RENDERER = 'android_large_icon_v2';
const NATIVE_PUSH_VERSION_MIN = 2;

function maskToken(token) {
  if (!token || typeof token !== 'string') return '[empty-token]';
  const t = token.trim();
  if (!t) return '[empty-token]';
  if (t.length <= 12) return `${t.slice(0, 4)}…`;
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function membershipUid(data) {
  const d = data || {};
  return String(d.uid || d.userId || '').trim();
}

function timestampToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts === 'object' && ts._seconds != null) return ts._seconds * 1000;
  if (typeof ts === 'object' && ts.seconds != null) return ts.seconds * 1000;
  return 0;
}

/**
 * Explicit routing from notification document fields.
 */
function resolveNotificationScenario({ tenantId, audienceScope, targetType, targetId }) {
  const tid = String(tenantId || '').trim();
  const scope = String(audienceScope || '').trim();
  const target = String(targetType || '').trim();
  const targetUid = String(targetId || '').trim();
  const isGlobal = tid === '__all__' && scope === 'all_users';
  const isTenant = tid && tid !== '__all__';

  if (isGlobal && target === 'all_students') return 'global_all_students';
  if (isGlobal && target === 'institution_admin') return 'global_institution_admins';
  if (isGlobal && target === 'single_student' && targetUid) return 'global_single_student';
  if (isTenant && target === 'all_students') return 'tenant_all_students';
  if (isTenant && target === 'institution_admin') return 'tenant_institution_admins';
  if (isTenant && target === 'single_student' && targetUid) return 'tenant_single_student';
  return null;
}

function isTenantDocumentEligible(tenantData) {
  if (!tenantData) return false;
  if (tenantData.isActive === false) return false;
  const status = String(tenantData.status || '').trim().toLowerCase();
  if (status === 'suspended') return false;
  return true;
}

async function loadTenantMap(db, tenantIds, cache) {
  const map = cache || new Map();
  const missing = [...tenantIds].filter((id) => id && !map.has(id));
  for (let i = 0; i < missing.length; i += USER_DOC_BATCH_SIZE) {
    const chunk = missing.slice(i, i + USER_DOC_BATCH_SIZE);
    const refs = chunk.map((id) => db.collection('tenants').doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, idx) => {
      const id = chunk[idx];
      map.set(id, snap.exists ? snap.data() || {} : null);
    });
  }
  return map;
}

async function validateTenantActive(db, tenantId, tenantCache) {
  const tid = String(tenantId || '').trim();
  if (!tid || tid === '__all__') return { ok: false, reason: 'invalid_tenant_id' };
  const cache = tenantCache || new Map();
  await loadTenantMap(db, [tid], cache);
  const data = cache.get(tid);
  if (data === undefined) {
    const snap = await db.collection('tenants').doc(tid).get();
    const payload = snap.exists ? snap.data() || {} : null;
    cache.set(tid, payload);
    if (!snap.exists) return { ok: false, reason: 'tenant_not_found' };
    return isTenantDocumentEligible(payload)
      ? { ok: true, tenantCache: cache }
      : { ok: false, reason: 'tenant_inactive' };
  }
  if (data === null) return { ok: false, reason: 'tenant_not_found' };
  return isTenantDocumentEligible(data)
    ? { ok: true, tenantCache: cache }
    : { ok: false, reason: 'tenant_inactive' };
}

function filterActiveMemberships(docs, requestedRole) {
  const role = normalizeRole(requestedRole);
  return (docs || []).filter((d) => {
    const data = d.data ? d.data() : d;
    if (!data) return false;
    if (normalizeRole(data.role) !== role) return false;
    if (normalizeRole(data.status) !== 'active') return false;
    const uid = membershipUid(data);
    const tenantId = String(data.tenantId || '').trim();
    return !!(uid && tenantId);
  });
}

/**
 * Canonical membership.programType for notification eligibility.
 * Matches project read-normalizer: missing/unsupported → driving_license.
 */
function normalizeNotificationMembershipProgramType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'machine_operator') return 'machine_operator';
  return 'driving_license';
}

function parseNotificationAudienceProgramType(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { status: 'missing' };
  }
  const v = String(raw).trim();
  if (v === 'all' || v === 'driving_license' || v === 'machine_operator') {
    return { status: 'valid', value: v };
  }
  return { status: 'invalid', value: v };
}

function isValidNotificationAudiencePeriodGroup(raw) {
  return /^\d{4}-\d{2}$/.test(String(raw == null ? '' : raw).trim());
}

/**
 * Group-student audience contract. Invalid payloads suppress all group recipients.
 * Missing audienceProgramType → legacy driving-only (not "all").
 */
function resolveNotificationGroupAudienceContract(notificationData) {
  const data = notificationData || {};
  const parsed = parseNotificationAudienceProgramType(data.audienceProgramType);
  const periodRaw =
    data.audiencePeriodGroup != null ? String(data.audiencePeriodGroup).trim() : '';

  if (parsed.status === 'invalid') {
    return { suppress: true, reason: 'notification_group_invalid_program' };
  }

  if (periodRaw) {
    if (!isValidNotificationAudiencePeriodGroup(periodRaw)) {
      return { suppress: true, reason: 'notification_group_invalid_period' };
    }
    if (parsed.status === 'valid' && parsed.value === 'all') {
      return { suppress: true, reason: 'notification_group_period_not_allowed_for_all' };
    }
  }

  return {
    suppress: false,
    audienceProgram: parsed.status === 'valid' ? parsed.value : null,
    legacyDrivingOnly: parsed.status === 'missing',
    period: periodRaw && isValidNotificationAudiencePeriodGroup(periodRaw) ? periodRaw : '',
  };
}

/**
 * Program + optional period eligibility for student-group notifications only.
 * Does not check role/status/tenant (those remain upstream).
 */
function isNotificationStudentMembershipEligible(notificationData, membershipData) {
  const contract = resolveNotificationGroupAudienceContract(notificationData);
  if (contract.suppress) return false;

  const memProgram = normalizeNotificationMembershipProgramType(
    membershipData && membershipData.programType
  );

  if (contract.legacyDrivingOnly || contract.audienceProgram === 'driving_license') {
    if (memProgram !== 'driving_license') return false;
  } else if (contract.audienceProgram === 'machine_operator') {
    if (memProgram !== 'machine_operator') return false;
  }
  // audienceProgram === 'all' → both programs eligible

  if (contract.period) {
    const memPeriod = String((membershipData && membershipData.periodGroup) || '').trim();
    if (!memPeriod || memPeriod !== contract.period) return false;
  }

  return true;
}

/**
 * In-memory filter of already-loaded student memberships for group scenarios.
 */
function filterStudentGroupMembershipsByAudience(membershipDatas, notificationData) {
  const list = membershipDatas || [];
  const contract = resolveNotificationGroupAudienceContract(notificationData);
  const audienceProgramType =
    notificationData && notificationData.audienceProgramType != null
      ? String(notificationData.audienceProgramType).trim() || null
      : null;
  const audiencePeriodGroup =
    notificationData && notificationData.audiencePeriodGroup != null
      ? String(notificationData.audiencePeriodGroup).trim() || null
      : null;

  if (contract.suppress) {
    return {
      memberships: [],
      skippedReason: contract.reason,
      eligibleCount: 0,
      filteredCount: list.length,
      logReason: contract.reason,
      audienceProgramType,
      audiencePeriodGroup,
    };
  }

  const memberships = list.filter((m) =>
    isNotificationStudentMembershipEligible(notificationData, m)
  );
  const filteredCount = list.length - memberships.length;
  let logReason = null;
  if (contract.legacyDrivingOnly) {
    logReason = 'notification_group_legacy_driving_only';
  } else if (filteredCount > 0) {
    logReason = contract.period
      ? 'notification_group_period_filtered'
      : 'notification_group_program_filtered';
  }

  const skippedReason =
    list.length > 0 && memberships.length === 0
      ? 'notification_group_no_eligible_recipients'
      : null;

  return {
    memberships,
    skippedReason,
    eligibleCount: memberships.length,
    filteredCount,
    logReason: skippedReason || logReason,
    audienceProgramType,
    audiencePeriodGroup,
  };
}

async function queryGlobalMembershipsByRole(db, requestedRole) {
  const snap = await db.collection('tenantMemberships').where('role', '==', requestedRole).get();
  return filterActiveMemberships(snap.docs, requestedRole);
}

async function queryTenantMemberships(db, tenantId) {
  const snap = await db.collection('tenantMemberships').where('tenantId', '==', tenantId).get();
  return snap.docs || [];
}

async function resolveMembershipUids(db, scenario, { tenantId, targetId, requestedRole, tenantCache, notificationData }) {
  const cache = tenantCache || new Map();
  const role = normalizeRole(requestedRole);

  if (scenario === 'global_all_students' || scenario === 'global_institution_admins') {
    const memberships = await queryGlobalMembershipsByRole(db, role);
    const tenantIds = new Set(memberships.map((d) => String((d.data() || {}).tenantId || '').trim()).filter(Boolean));
    await loadTenantMap(db, tenantIds, cache);
    let eligibleMemberships = memberships
      .map((d) => d.data() || {})
      .filter((m) => {
        const tid = String(m.tenantId || '').trim();
        const tenantData = cache.get(tid);
        return tenantData && isTenantDocumentEligible(tenantData);
      });

    if (scenario === 'global_all_students') {
      const audienceResult = filterStudentGroupMembershipsByAudience(
        eligibleMemberships,
        notificationData
      );
      eligibleMemberships = audienceResult.memberships;
      return {
        uids: [...new Set(eligibleMemberships.map((m) => membershipUid(m)).filter(Boolean))],
        tenantCache: cache,
        skippedReason: audienceResult.skippedReason,
        audienceFilterMeta: {
          reason: audienceResult.logReason,
          eligibleCount: audienceResult.eligibleCount,
          filteredCount: audienceResult.filteredCount,
          audienceProgramType: audienceResult.audienceProgramType,
          audiencePeriodGroup: audienceResult.audiencePeriodGroup,
        },
      };
    }

    return [...new Set(
      eligibleMemberships
        .map((m) => membershipUid(m))
        .filter(Boolean)
    )];
  }

  if (scenario === 'tenant_all_students' || scenario === 'tenant_institution_admins') {
    const tenantCheck = await validateTenantActive(db, tenantId, cache);
    if (!tenantCheck.ok) return { uids: [], skippedReason: tenantCheck.reason, tenantCache: cache };
    const memberships = filterActiveMemberships(await queryTenantMemberships(db, tenantId), role);

    if (scenario === 'tenant_all_students') {
      const membershipDatas = memberships.map((d) => d.data() || {});
      const audienceResult = filterStudentGroupMembershipsByAudience(
        membershipDatas,
        notificationData
      );
      return {
        uids: [...new Set(audienceResult.memberships.map((m) => membershipUid(m)).filter(Boolean))],
        tenantCache: cache,
        skippedReason: audienceResult.skippedReason,
        audienceFilterMeta: {
          reason: audienceResult.logReason,
          eligibleCount: audienceResult.eligibleCount,
          filteredCount: audienceResult.filteredCount,
          audienceProgramType: audienceResult.audienceProgramType,
          audiencePeriodGroup: audienceResult.audiencePeriodGroup,
        },
      };
    }

    return {
      uids: [...new Set(memberships.map((d) => membershipUid(d.data())).filter(Boolean))],
      tenantCache: cache,
    };
  }

  if (scenario === 'global_single_student') {
    const uid = String(targetId || '').trim();
    const snap = await db.collection('tenantMemberships').where('uid', '==', uid).get();
    const memberships = filterActiveMemberships(snap.docs, ROLE_STUDENT);
    const tenantIds = new Set(memberships.map((d) => String((d.data() || {}).tenantId || '').trim()).filter(Boolean));
    await loadTenantMap(db, tenantIds, cache);
    const eligible = memberships.some((d) => {
      const m = d.data() || {};
      const tid = String(m.tenantId || '').trim();
      const tenantData = cache.get(tid);
      return tenantData && isTenantDocumentEligible(tenantData);
    });
    return { uids: eligible ? [uid] : [], tenantCache: cache, skippedReason: eligible ? null : 'single_student_not_eligible' };
  }

  if (scenario === 'tenant_single_student') {
    const uid = String(targetId || '').trim();
    const tid = String(tenantId || '').trim();
    const tenantCheck = await validateTenantActive(db, tid, cache);
    if (!tenantCheck.ok) {
      return { uids: [], skippedReason: tenantCheck.reason, tenantCache: cache };
    }
    const membershipId = `${uid}_${tid}`;
    const memSnap = await db.collection('tenantMemberships').doc(membershipId).get();
    if (!memSnap.exists) {
      return { uids: [], skippedReason: 'membership_not_found', tenantCache: cache };
    }
    const m = memSnap.data() || {};
    const eligible =
      membershipUid(m) === uid &&
      String(m.tenantId || '').trim() === tid &&
      normalizeRole(m.role) === ROLE_STUDENT &&
      normalizeRole(m.status) === 'active';
    return {
      uids: eligible ? [uid] : [],
      skippedReason: eligible ? null : 'single_student_membership_invalid',
      tenantCache: cache,
    };
  }

  return { uids: [], skippedReason: 'unsupported_scenario' };
}

function isUserEligible(userData) {
  if (!userData) return false;
  if (userData.isActive === false) return false;
  const role = normalizeRole(userData.role || userData.globalRole);
  if (role === 'public_user' || role === 'super_admin') return false;
  return true;
}

async function filterEligibleUserUids(db, uids) {
  const unique = [...new Set((uids || []).map((u) => String(u || '').trim()).filter(Boolean))];
  const eligible = [];
  for (let i = 0; i < unique.length; i += USER_DOC_BATCH_SIZE) {
    const chunk = unique.slice(i, i + USER_DOC_BATCH_SIZE);
    const refs = chunk.map((uid) => db.collection('users').doc(uid));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, idx) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (isUserEligible(data)) eligible.push(chunk[idx]);
    });
  }
  return eligible;
}

function tokenFromDoc(doc) {
  const data = doc.data() || {};
  const tokenValue = String(data.token || doc.id || '').trim();
  if (!tokenValue) return null;
  if (data.token && String(data.token).trim() !== tokenValue) return null;
  const ownerUid = String(data.uid || '').trim();
  const parentUid = doc.ref.parent.parent ? doc.ref.parent.parent.id : '';
  if (ownerUid && parentUid && ownerUid !== parentUid) return null;
  if (data.isActive === false) return null;
  return {
    token: tokenValue,
    ownerUid: ownerUid || parentUid,
    ref: doc.ref,
    platform: data.platform != null ? String(data.platform) : null,
    nativePushVersion: data.nativePushVersion != null ? data.nativePushVersion : null,
    nativePushRenderer: data.nativePushRenderer != null ? String(data.nativePushRenderer) : null,
    updatedAtMs: timestampToMillis(data.updatedAt) || timestampToMillis(data.createdAt),
  };
}

async function loadActiveTokensForUids(db, uids) {
  const unique = [...new Set((uids || []).map((u) => String(u || '').trim()).filter(Boolean))];
  const entries = [];
  for (let i = 0; i < unique.length; i += TOKEN_UID_READ_CONCURRENCY) {
    const chunk = unique.slice(i, i + TOKEN_UID_READ_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (uid) => {
        try {
          const snap = await db.collection('users').doc(uid).collection('deviceTokens').get();
          return (snap.docs || []).map(tokenFromDoc).filter(Boolean);
        } catch (e) {
          console.error('[push_dispatch] token_lookup_failed', {
            uid,
            message: e && e.message ? e.message : String(e),
          });
          return [];
        }
      })
    );
    results.forEach((list) => {
      list.forEach((item) => entries.push(item));
    });
  }
  return entries;
}

function composePushDisplayBody(originalTitle, originalMessage) {
  const title = String(originalTitle || '').trim();
  const message = String(originalMessage || '').trim();
  if (title && message) {
    if (title === message) return title;
    return `${title} • ${message}`;
  }
  if (title) return title;
  if (message) return message;
  return 'Yeni bildiriminiz var';
}

function classifyPushBrandSource(type, tenantId) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const tid = String(tenantId || '').trim();
  if (
    (normalizedType === 'tenant'
      || normalizedType === 'mailbox'
      || normalizedType === 'private_message'
      || normalizedType === 'group_message'
      || normalizedType === 'lesson_assigned')
    && tid
    && tid !== '__all__'
  ) {
    return 'tenant';
  }
  return 'platform';
}

/** Code-point-safe truncation (emoji / Turkish-safe). No Buffer / encodeURIComponent. */
function truncateByCodePoints(value, maxCodePoints) {
  const max = Number.isFinite(maxCodePoints) && maxCodePoints > 0 ? Math.floor(maxCodePoints) : 0;
  const text = String(value == null ? '' : value);
  if (!max) return '';
  const chars = Array.from(text);
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}

function normalizePushMessageSnippet(value, maxCodePoints) {
  const collapsed = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return truncateByCodePoints(collapsed, maxCodePoints);
}

const PRIVATE_MESSAGE_PUSH_SNIPPET_MAX = 180;
const PRIVATE_MESSAGE_PUSH_TYPE = 'private_message';
const GROUP_MESSAGE_PUSH_SNIPPET_MAX = 180;
const GROUP_MESSAGE_PUSH_TYPE = 'group_message';
const GROUP_MESSAGE_ROOM_TYPE = 'instructor_group';
const ROLE_INSTRUCTOR = 'instructor';
const LESSON_ASSIGNED_PUSH_TYPE = 'lesson_assigned';
const LESSON_ASSIGNED_BODY_TITLE = 'Yeni Direksiyon Dersi';
const LESSON_ASSIGNED_PREVIEW_MAX = 180;

function isPrivateOrLocalHostname(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '[::1]' || h === '::1') return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map((n) => parseInt(n, 10));
    if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = octets;
    if (a === 127 || a === 0) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function resolveSafePushImageUrl(rawLogoUrl) {
  if (typeof rawLogoUrl !== 'string') return null;
  const trimmed = rawLogoUrl.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (isPrivateOrLocalHostname(url.hostname)) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

async function loadTenantBranding(db, tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid || tid === '__all__') {
    return { displayName: 'Kurum', logoUrl: null };
  }
  try {
    const snap = await db.collection('tenants').doc(tid).get();
    if (!snap.exists) {
      return { displayName: tid, logoUrl: null };
    }
    const data = snap.data() || {};
    const name = String(data.name || '').trim();
    const displayName = name || tid;
    const logoUrl = resolveSafePushImageUrl(data.logoUrl);
    return { displayName, logoUrl };
  } catch (e) {
    console.error('[push_dispatch] tenant_branding_lookup_failed', {
      tenantId: tid,
      message: e && e.message ? e.message : String(e),
    });
    return { displayName: tid, logoUrl: null };
  }
}

async function resolvePushDisplayBranding(db, { type, tenantId, title, message }) {
  const brandSource = classifyPushBrandSource(type, tenantId);
  const displayBody = composePushDisplayBody(title, message);
  if (brandSource === 'tenant') {
    const branding = await loadTenantBranding(db, tenantId);
    return {
      displayTitle: branding.displayName,
      displayBody,
      brandSource,
      brandImageUrl: branding.logoUrl,
      brandImageSource: branding.logoUrl ? 'tenant_logo' : 'none',
    };
  }
  return {
    displayTitle: PLATFORM_DISPLAY_NAME,
    displayBody,
    brandSource,
    brandImageUrl: null,
    brandImageSource: 'none',
  };
}

function dedupeTokenEntries(entries) {
  const map = new Map();
  let duplicateCount = 0;
  (entries || []).forEach((entry) => {
    const key = entry.token;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, entry);
      return;
    }
    duplicateCount += 1;
    if ((entry.updatedAtMs || 0) >= (existing.updatedAtMs || 0)) {
      map.set(key, entry);
    }
  });
  return { entries: [...map.values()], duplicateCount };
}

function normalizeNativePushVersion(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isNativeCapableToken(entry) {
  if (!entry) return false;
  const platform = String(entry.platform || '').trim().toLowerCase();
  if (platform !== 'android') return false;
  const version = normalizeNativePushVersion(entry.nativePushVersion);
  if (version === null || version < NATIVE_PUSH_VERSION_MIN) return false;
  const renderer = String(entry.nativePushRenderer || '').trim();
  if (renderer !== NATIVE_PUSH_RENDERER) return false;
  return true;
}

function isNativeRoutableNotificationType(type) {
  const normalizedType = String(type || '').trim().toLowerCase();
  return (
    normalizedType === 'tenant'
    || normalizedType === 'mailbox'
    || normalizedType === 'private_message'
    || normalizedType === 'group_message'
    || normalizedType === 'lesson_assigned'
  );
}

function partitionTokenEntriesForDispatch(entries, type) {
  const nativeRoutable = isNativeRoutableNotificationType(type);
  const nativeTokenEntries = [];
  const legacyTokenEntries = [];
  (entries || []).forEach((entry) => {
    if (nativeRoutable && isNativeCapableToken(entry)) {
      nativeTokenEntries.push(entry);
      return;
    }
    legacyTokenEntries.push(entry);
  });
  return { nativeTokenEntries, legacyTokenEntries };
}

function buildNativeAndroidDataPayload({
  displayTitle,
  displayBody,
  brandImageUrl,
  brandSource,
  notificationId,
  tenantId,
  type,
  targetType,
  audienceScope,
  threadId,
  messageId,
  senderUid,
  roomType,
  lessonId,
  agendaWeekStart,
}) {
  const data = {
    notificationId: String(notificationId || ''),
    tenantId: String(tenantId || ''),
    type: String(type || ''),
    targetType: String(targetType || ''),
    audienceScope: String(audienceScope || ''),
    displayTitle: String(displayTitle || ''),
    displayBody: String(displayBody || ''),
    brandSource: String(brandSource || ''),
    pushFormat: 'native_v2',
  };
  const safeThreadId = String(threadId || '').trim();
  const safeMessageId = String(messageId || '').trim();
  const safeSenderUid = String(senderUid || '').trim();
  const safeRoomType = String(roomType || '').trim();
  const safeLessonId = String(lessonId || '').trim();
  const safeAgendaWeekStart = String(agendaWeekStart || '').trim();
  if (safeThreadId) data.threadId = safeThreadId;
  if (safeMessageId) data.messageId = safeMessageId;
  if (safeSenderUid) data.senderUid = safeSenderUid;
  if (safeRoomType) data.roomType = safeRoomType;
  if (safeLessonId) data.lessonId = safeLessonId;
  if (safeAgendaWeekStart) data.agendaWeekStart = safeAgendaWeekStart;
  const safeImageUrl = brandImageUrl ? resolveSafePushImageUrl(brandImageUrl) : null;
  if (safeImageUrl) {
    data.brandImageUrl = safeImageUrl;
  }
  return {
    data,
    android: {
      priority: 'high',
    },
  };
}

function mergeSendResults(legacyResult, nativeResult) {
  const legacy = legacyResult || {
    batchCount: 0,
    successCount: 0,
    failureCount: 0,
    permanentInvalidCount: 0,
    failures: [],
    stopRemaining: false,
  };
  const native = nativeResult || {
    batchCount: 0,
    successCount: 0,
    failureCount: 0,
    permanentInvalidCount: 0,
    failures: [],
    stopRemaining: false,
  };
  return {
    batchCount: legacy.batchCount + native.batchCount,
    successCount: legacy.successCount + native.successCount,
    failureCount: legacy.failureCount + native.failureCount,
    permanentInvalidCount: legacy.permanentInvalidCount + native.permanentInvalidCount,
    failures: [...legacy.failures, ...native.failures],
    stopRemaining: legacy.stopRemaining || native.stopRemaining,
    legacyBatchCount: legacy.batchCount,
    nativeBatchCount: native.batchCount,
    legacySuccessCount: legacy.successCount,
    legacyFailureCount: legacy.failureCount,
    nativeSuccessCount: native.successCount,
    nativeFailureCount: native.failureCount,
  };
}

function buildMulticastPayload({
  displayTitle,
  displayBody,
  brandImageUrl,
  notificationId,
  tenantId,
  type,
  targetType,
  audienceScope,
  threadId,
  messageId,
  senderUid,
  roomType,
  lessonId,
  agendaWeekStart,
}) {
  const notification = {
    title: String(displayTitle || ''),
    body: String(displayBody || ''),
  };
  const data = {
    notificationId: String(notificationId || ''),
    tenantId: String(tenantId || ''),
    type: String(type || ''),
    targetType: String(targetType || ''),
    audienceScope: String(audienceScope || ''),
  };
  const safeThreadId = String(threadId || '').trim();
  const safeMessageId = String(messageId || '').trim();
  const safeSenderUid = String(senderUid || '').trim();
  const safeRoomType = String(roomType || '').trim();
  const safeLessonId = String(lessonId || '').trim();
  const safeAgendaWeekStart = String(agendaWeekStart || '').trim();
  if (safeThreadId) data.threadId = safeThreadId;
  if (safeMessageId) data.messageId = safeMessageId;
  if (safeSenderUid) data.senderUid = safeSenderUid;
  if (safeRoomType) data.roomType = safeRoomType;
  if (safeLessonId) data.lessonId = safeLessonId;
  if (safeAgendaWeekStart) data.agendaWeekStart = safeAgendaWeekStart;
  const payload = {
    notification,
    data,
  };
  const safeImageUrl = brandImageUrl ? resolveSafePushImageUrl(brandImageUrl) : null;
  if (safeImageUrl) {
    notification.imageUrl = safeImageUrl;
    payload.android = {
      notification: {
        imageUrl: safeImageUrl,
      },
    };
  }
  return payload;
}

async function sendTokensInBatches(messaging, basePayload, tokenEntries, logContext) {
  const ctx = logContext || {};
  const batches = [];
  for (let i = 0; i < tokenEntries.length; i += FCM_BATCH_SIZE) {
    batches.push(tokenEntries.slice(i, i + FCM_BATCH_SIZE));
  }

  let successCount = 0;
  let failureCount = 0;
  let permanentInvalidCount = 0;
  const failures = [];
  let stopRemaining = false;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    if (stopRemaining) break;
    const batchEntries = batches[batchIndex];
    const tokens = batchEntries.map((e) => e.token);
    const payload = { ...basePayload, tokens };

    try {
      const response = await messaging.sendEachForMulticast(payload);
      successCount += response.successCount || 0;
      failureCount += response.failureCount || 0;

      (response.responses || []).forEach((r, idx) => {
        if (r.success) return;
        const entry = batchEntries[idx];
        const code = r.error && r.error.code ? String(r.error.code) : 'unknown';
        const failure = { entry, code, message: r.error && r.error.message ? r.error.message : '' };
        failures.push(failure);
        if (PERMANENT_TOKEN_ERROR_CODES.has(code)) permanentInvalidCount += 1;
        if (CONFIG_FCM_ERROR_CODES.has(code)) stopRemaining = true;
        console.warn('[PushDispatch] Token delivery failed', {
          notificationId: ctx.notificationId || null,
          scenario: ctx.scenario || null,
          ownerUid: entry.ownerUid || null,
          maskedToken: maskToken(entry.token),
          errorCode: code,
          errorMessage: failure.message || '',
          batchIndex,
        });
      });
    } catch (e) {
      const code = e && e.code ? String(e.code) : 'fcm_batch_error';
      console.error('[push_dispatch] fcm_batch_send_failed', {
        batchIndex,
        code,
        message: e && e.message ? e.message : String(e),
      });
      failureCount += batchEntries.length;
      if (CONFIG_FCM_ERROR_CODES.has(code)) stopRemaining = true;
    }
  }

  return {
    batchCount: batches.length,
    successCount,
    failureCount,
    permanentInvalidCount,
    failures,
    stopRemaining,
  };
}

async function deactivateInvalidTokenDocs(db, admin, failures) {
  const toDeactivate = (failures || []).filter((f) => PERMANENT_TOKEN_ERROR_CODES.has(f.code) && f.entry && f.entry.ref);
  if (!toDeactivate.length) return 0;

  const writer = db.bulkWriter();
  let count = 0;
  toDeactivate.forEach((f) => {
    writer.set(
      f.entry.ref,
      {
        isActive: false,
        invalidatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastFailureCode: f.code,
      },
      { merge: true }
    );
    count += 1;
  });
  await writer.close();
  return count;
}

function scenarioRequestedRole(scenario) {
  if (
    scenario === 'global_all_students' ||
    scenario === 'tenant_all_students' ||
    scenario === 'global_single_student' ||
    scenario === 'tenant_single_student'
  ) {
    return ROLE_STUDENT;
  }
  if (scenario === 'global_institution_admins' || scenario === 'tenant_institution_admins') {
    return ROLE_INSTITUTION_ADMIN;
  }
  return null;
}

async function resolveNotificationRecipients(db, scenario, fields) {
  const requestedRole = scenarioRequestedRole(scenario);
  if (!requestedRole) {
    return { uids: [], membershipCount: 0, skippedReason: 'unsupported_scenario' };
  }

  const result = await resolveMembershipUids(db, scenario, {
    tenantId: fields.tenantId,
    targetId: fields.targetId,
    requestedRole,
    tenantCache: new Map(),
    notificationData: fields.notificationData || null,
  });

  const rawUids = Array.isArray(result) ? result : result.uids || [];
  const skippedReason = Array.isArray(result) ? null : result.skippedReason || null;
  const audienceFilterMeta = Array.isArray(result) ? null : result.audienceFilterMeta || null;
  const membershipCount = rawUids.length;
  const eligibleUids = await filterEligibleUserUids(db, rawUids);

  return {
    uids: eligibleUids,
    membershipCount,
    skippedReason,
    audienceFilterMeta,
  };
}

async function dispatchNotificationPush({ db, messaging, admin, notificationId, data }) {
  const tenantId = String(data.tenantId || '').trim();
  const status = String(data.status || '').toLowerCase();
  const title = String(data.title || '').trim();
  const message = String(data.message || '').trim();
  const type = String(data.type || '').trim();
  const audienceScope = String(data.audienceScope || '').trim();
  const targetType = String(data.targetType || '').trim();
  const targetId = String(data.targetId || '').trim();

  const audienceProgramType =
    data.audienceProgramType != null ? String(data.audienceProgramType).trim() || null : null;
  const audiencePeriodGroup =
    data.audiencePeriodGroup != null ? String(data.audiencePeriodGroup).trim() || null : null;

  const logBase = {
    notificationId,
    tenantId,
    targetType,
    audienceScope: audienceScope || null,
    audienceProgramType,
    audiencePeriodGroup,
  };

  if (!tenantId) {
    console.log('[push_dispatch] skipped', { ...logBase, reason: 'missing_tenantId' });
    return { ok: false, reason: 'missing_tenantId' };
  }
  if (status !== 'active') {
    console.log('[push_dispatch] skipped', { ...logBase, reason: 'status_not_active', status });
    return { ok: false, reason: 'status_not_active' };
  }
  if (!title || !message) {
    console.log('[push_dispatch] skipped', { ...logBase, reason: 'missing_title_or_message' });
    return { ok: false, reason: 'missing_title_or_message' };
  }

  const scenario = resolveNotificationScenario({ tenantId, audienceScope, targetType, targetId });
  if (!scenario) {
    console.log('[push_dispatch] skipped', {
      ...logBase,
      reason: 'unsupported_scenario',
      targetId: targetId || null,
    });
    return { ok: false, reason: 'unsupported_scenario' };
  }

  let recipientResult;
  try {
    recipientResult = await resolveNotificationRecipients(db, scenario, {
      tenantId,
      targetId,
      notificationData: data,
    });
  } catch (e) {
    console.error('[push_dispatch] membership_query_failed', {
      ...logBase,
      scenario,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'membership_query_failed' };
  }

  const audienceFilterMeta = recipientResult.audienceFilterMeta || null;
  if (audienceFilterMeta && audienceFilterMeta.reason) {
    console.log('[push_dispatch] student_group_audience_filter', {
      ...logBase,
      scenario,
      reason: audienceFilterMeta.reason,
      eligibleCount: audienceFilterMeta.eligibleCount,
      filteredCount: audienceFilterMeta.filteredCount,
    });
  }

  if (recipientResult.skippedReason) {
    console.log('[push_dispatch] no_recipients', {
      ...logBase,
      scenario,
      skippedReason: recipientResult.skippedReason,
      eligibleCount: audienceFilterMeta ? audienceFilterMeta.eligibleCount : undefined,
      filteredCount: audienceFilterMeta ? audienceFilterMeta.filteredCount : undefined,
    });
    return { ok: true, reason: 'no_recipients', scenario };
  }

  const eligibleUids = recipientResult.uids || [];
  const membershipCount = recipientResult.membershipCount || 0;

  let tokenEntries = [];
  try {
    tokenEntries = await loadActiveTokensForUids(db, eligibleUids);
  } catch (e) {
    console.error('[push_dispatch] token_lookup_failed', {
      ...logBase,
      scenario,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'token_lookup_failed' };
  }

  const { entries: dedupedEntries, duplicateCount } = dedupeTokenEntries(tokenEntries);
  const uidsWithTokens = new Set(dedupedEntries.map((e) => e.ownerUid).filter(Boolean));
  const usersWithNoTokens = eligibleUids.filter((uid) => !uidsWithTokens.has(uid)).length;

  if (!dedupedEntries.length) {
    console.log('[push_dispatch] no_recipients', {
      ...logBase,
      scenario,
      membershipCount,
      recipientUserCount: eligibleUids.length,
      usersWithNoTokens,
      deduplicatedTokenCount: 0,
      duplicateTokenCount: duplicateCount,
    });
    return { ok: true, reason: 'no_recipients', scenario };
  }

  let displayBranding;
  try {
    displayBranding = await resolvePushDisplayBranding(db, { type, tenantId, title, message });
  } catch (e) {
    console.error('[push_dispatch] branding_resolution_failed', {
      ...logBase,
      scenario,
      message: e && e.message ? e.message : String(e),
    });
    displayBranding = {
      displayTitle: PLATFORM_DISPLAY_NAME,
      displayBody: composePushDisplayBody(title, message),
      brandSource: 'platform',
      brandImageUrl: null,
      brandImageSource: 'none',
    };
  }

  const { nativeTokenEntries, legacyTokenEntries } = partitionTokenEntriesForDispatch(dedupedEntries, type);
  const nativePayloadEnabled = isNativeRoutableNotificationType(type) && nativeTokenEntries.length > 0;

  const legacyBasePayload = buildMulticastPayload({
    displayTitle: displayBranding.displayTitle,
    displayBody: displayBranding.displayBody,
    brandImageUrl: displayBranding.brandImageUrl,
    notificationId,
    tenantId,
    type,
    targetType,
    audienceScope,
  });

  const nativeBasePayload = nativePayloadEnabled
    ? buildNativeAndroidDataPayload({
      displayTitle: displayBranding.displayTitle,
      displayBody: displayBranding.displayBody,
      brandImageUrl: displayBranding.brandImageUrl,
      brandSource: displayBranding.brandSource,
      notificationId,
      tenantId,
      type,
      targetType,
      audienceScope,
    })
    : null;

  let legacySendResult = null;
  let nativeSendResult = null;
  try {
    if (legacyTokenEntries.length) {
      legacySendResult = await sendTokensInBatches(messaging, legacyBasePayload, legacyTokenEntries, {
        notificationId,
        scenario,
        payloadKind: 'legacy',
      });
    }
    if (nativeBasePayload && nativeTokenEntries.length) {
      nativeSendResult = await sendTokensInBatches(messaging, nativeBasePayload, nativeTokenEntries, {
        notificationId,
        scenario,
        payloadKind: 'native_v2',
      });
    }
  } catch (e) {
    console.error('[push_dispatch] fcm_send_failed', {
      ...logBase,
      scenario,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'fcm_send_failed' };
  }

  const sendResult = mergeSendResults(legacySendResult, nativeSendResult);

  let deactivatedCount = 0;
  try {
    deactivatedCount = await deactivateInvalidTokenDocs(db, admin, sendResult.failures);
  } catch (e) {
    console.error('[push_dispatch] token_deactivation_failed', {
      ...logBase,
      scenario,
      message: e && e.message ? e.message : String(e),
    });
  }

  console.log('[PushDispatch] Dispatch completed', {
    notificationId,
    scenario,
    tenantId,
    targetType,
    brandSource: displayBranding.brandSource,
    hasBrandImage: !!displayBranding.brandImageUrl,
    brandImageSource: displayBranding.brandImageSource || 'none',
    nativePayloadEnabled,
    nativeTokenCount: nativeTokenEntries.length,
    legacyTokenCount: legacyTokenEntries.length,
    membershipCount,
    recipientUserCount: eligibleUids.length,
    usersWithNoTokens,
    deduplicatedTokenCount: dedupedEntries.length,
    duplicateTokenCount: duplicateCount,
    batchCount: sendResult.batchCount,
    legacyBatchCount: sendResult.legacyBatchCount,
    nativeBatchCount: sendResult.nativeBatchCount,
    successCount: sendResult.successCount,
    legacySuccessCount: sendResult.legacySuccessCount,
    nativeSuccessCount: sendResult.nativeSuccessCount,
    failureCount: sendResult.failureCount,
    legacyFailureCount: sendResult.legacyFailureCount,
    nativeFailureCount: sendResult.nativeFailureCount,
    permanentlyInvalidTokenCount: sendResult.permanentInvalidCount,
    deactivatedTokenCount: deactivatedCount,
    stoppedEarly: sendResult.stopRemaining,
  });

  return {
    ok: true,
    scenario,
    membershipCount,
    recipientUserCount: eligibleUids.length,
    tokenCount: dedupedEntries.length,
    successCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
  };
}

/**
 * DM2 — Private instructor message push (native_v2 preferred).
 * Does not create notifications docs. Does not throw to reverse message writes.
 * Never logs full private message text.
 */
async function dispatchPrivateMessagePush({
  db,
  messaging,
  admin,
  tenantId,
  threadId,
  messageId,
  messageData,
  threadData,
}) {
  const type = PRIVATE_MESSAGE_PUSH_TYPE;
  const tid = String(tenantId || '').trim();
  const tidThread = String(threadId || '').trim();
  const mid = String(messageId || '').trim();
  const msg = messageData && typeof messageData === 'object' ? messageData : {};
  const thread = threadData && typeof threadData === 'object' ? threadData : {};

  const notificationId = mid ? `private_message:${mid}` : '';
  const logBase = {
    notificationId: notificationId || null,
    tenantId: tid || null,
    threadId: tidThread || null,
    messageId: mid || null,
    type,
  };

  if (!tid || !tidThread || !mid) {
    console.log('[push_dispatch] private_message skipped', { ...logBase, reason: 'missing_ids' });
    return { ok: false, reason: 'missing_ids' };
  }
  if (msg.isDeleted === true) {
    console.log('[push_dispatch] private_message skipped', { ...logBase, reason: 'message_deleted' });
    return { ok: true, reason: 'message_deleted' };
  }

  const msgTenantId = String(msg.tenantId || '').trim();
  if (msgTenantId && msgTenantId !== tid) {
    console.log('[push_dispatch] private_message skipped', { ...logBase, reason: 'message_tenant_mismatch' });
    return { ok: false, reason: 'message_tenant_mismatch' };
  }
  const msgThreadId = String(msg.threadId || '').trim();
  if (msgThreadId && msgThreadId !== tidThread) {
    console.log('[push_dispatch] private_message skipped', { ...logBase, reason: 'message_thread_mismatch' });
    return { ok: false, reason: 'message_thread_mismatch' };
  }

  const senderUid = String(msg.senderUid || '').trim();
  if (!senderUid) {
    console.log('[push_dispatch] private_message skipped', { ...logBase, reason: 'missing_senderUid' });
    return { ok: false, reason: 'missing_senderUid' };
  }

  const participantsRaw = Array.isArray(thread.participantUids) ? thread.participantUids : [];
  const participants = [...new Set(
    participantsRaw.map((u) => String(u || '').trim()).filter(Boolean)
  )];
  if (participants.length !== 2) {
    console.log('[push_dispatch] private_message skipped', {
      ...logBase,
      reason: 'invalid_participant_count',
      participantCount: participants.length,
    });
    return { ok: false, reason: 'invalid_participant_count' };
  }
  if (!participants.includes(senderUid)) {
    console.log('[push_dispatch] private_message skipped', { ...logBase, reason: 'sender_not_participant' });
    return { ok: false, reason: 'sender_not_participant' };
  }

  const recipientUid = participants.find((uid) => uid !== senderUid) || '';
  if (!recipientUid || recipientUid === senderUid) {
    console.log('[push_dispatch] private_message skipped', { ...logBase, reason: 'recipient_unresolved' });
    return { ok: false, reason: 'recipient_unresolved' };
  }

  const textRaw = typeof msg.text === 'string' ? msg.text : '';
  const snippet = normalizePushMessageSnippet(textRaw, PRIVATE_MESSAGE_PUSH_SNIPPET_MAX);
  if (!snippet) {
    console.log('[push_dispatch] private_message skipped', { ...logBase, reason: 'empty_snippet' });
    return { ok: true, reason: 'empty_snippet' };
  }

  const senderNameRaw = String(msg.senderName || '').trim();
  const senderName = truncateByCodePoints(senderNameRaw || 'Eğitmen', 80);

  let branding;
  try {
    branding = await loadTenantBranding(db, tid);
  } catch (e) {
    console.error('[push_dispatch] private_message branding_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
    branding = { displayName: tid, logoUrl: null };
  }

  const brandSource = classifyPushBrandSource(type, tid);
  const displayTitle = String(branding.displayName || tid || 'Kurum').trim() || 'Kurum';
  const displayBody = `${senderName}\n${snippet}`;
  const brandImageUrl = brandSource === 'tenant' ? (branding.logoUrl || null) : null;

  let eligibleUids = [];
  try {
    eligibleUids = await filterEligibleUserUids(db, [recipientUid]);
  } catch (e) {
    console.error('[push_dispatch] private_message recipient_eligibility_failed', {
      ...logBase,
      recipientUid,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'recipient_eligibility_failed' };
  }
  if (!eligibleUids.length) {
    console.log('[push_dispatch] private_message skipped', {
      ...logBase,
      recipientUid,
      reason: 'recipient_not_eligible',
    });
    return { ok: true, reason: 'recipient_not_eligible' };
  }

  let tokenEntries = [];
  try {
    tokenEntries = await loadActiveTokensForUids(db, eligibleUids);
  } catch (e) {
    console.error('[push_dispatch] private_message token_lookup_failed', {
      ...logBase,
      recipientUid,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'token_lookup_failed' };
  }

  const { entries: dedupedEntries, duplicateCount } = dedupeTokenEntries(tokenEntries);
  if (!dedupedEntries.length) {
    console.log('[push_dispatch] private_message no_tokens', {
      ...logBase,
      recipientUid,
      duplicateTokenCount: duplicateCount,
    });
    return { ok: true, reason: 'no_tokens' };
  }

  const { nativeTokenEntries, legacyTokenEntries } = partitionTokenEntriesForDispatch(dedupedEntries, type);
  const nativePayloadEnabled = isNativeRoutableNotificationType(type) && nativeTokenEntries.length > 0;

  const legacyBasePayload = buildMulticastPayload({
    displayTitle,
    displayBody,
    brandImageUrl,
    notificationId,
    tenantId: tid,
    type,
    targetType: '',
    audienceScope: '',
    threadId: tidThread,
    messageId: mid,
    senderUid,
  });

  const nativeBasePayload = nativePayloadEnabled
    ? buildNativeAndroidDataPayload({
      displayTitle,
      displayBody,
      brandImageUrl,
      brandSource,
      notificationId,
      tenantId: tid,
      type,
      targetType: '',
      audienceScope: '',
      threadId: tidThread,
      messageId: mid,
      senderUid,
    })
    : null;

  let legacySendResult = null;
  let nativeSendResult = null;
  try {
    if (legacyTokenEntries.length) {
      legacySendResult = await sendTokensInBatches(messaging, legacyBasePayload, legacyTokenEntries, {
        notificationId,
        scenario: 'private_message',
        payloadKind: 'legacy',
      });
    }
    if (nativeBasePayload && nativeTokenEntries.length) {
      nativeSendResult = await sendTokensInBatches(messaging, nativeBasePayload, nativeTokenEntries, {
        notificationId,
        scenario: 'private_message',
        payloadKind: 'native_v2',
      });
    }
  } catch (e) {
    console.error('[push_dispatch] private_message fcm_send_failed', {
      ...logBase,
      recipientUid,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'fcm_send_failed' };
  }

  const sendResult = mergeSendResults(legacySendResult, nativeSendResult);

  let deactivatedCount = 0;
  try {
    deactivatedCount = await deactivateInvalidTokenDocs(db, admin, sendResult.failures);
  } catch (e) {
    console.error('[push_dispatch] private_message token_deactivation_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
  }

  console.log('[PushDispatch] private_message completed', {
    ...logBase,
    recipientUid,
    senderUid,
    brandSource,
    hasBrandImage: !!brandImageUrl,
    snippetCodePointLength: Array.from(snippet).length,
    nativePayloadEnabled,
    nativeTokenCount: nativeTokenEntries.length,
    legacyTokenCount: legacyTokenEntries.length,
    deduplicatedTokenCount: dedupedEntries.length,
    duplicateTokenCount: duplicateCount,
    successCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
    permanentlyInvalidTokenCount: sendResult.permanentInvalidCount,
    deactivatedTokenCount: deactivatedCount,
    stoppedEarly: sendResult.stopRemaining,
  });

  return {
    ok: true,
    scenario: 'private_message',
    recipientUid,
    tokenCount: dedupedEntries.length,
    successCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
  };
}

/**
 * Resolve active instructor UIDs for a tenant from canonical tenantMemberships.
 * Server-side only — does not trust client recipient lists.
 */
async function resolveActiveInstructorUidsForTenant(db, tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) return [];
  const membershipDocs = filterActiveMemberships(
    await queryTenantMemberships(db, tid),
    ROLE_INSTRUCTOR
  );
  const uids = [...new Set(
    membershipDocs
      .map((d) => membershipUid(d.data ? d.data() : d))
      .map((u) => String(u || '').trim())
      .filter(Boolean)
  )];
  if (!uids.length) return [];

  const eligible = [];
  for (let i = 0; i < uids.length; i += USER_DOC_BATCH_SIZE) {
    const chunk = uids.slice(i, i + USER_DOC_BATCH_SIZE);
    const refs = chunk.map((uid) => db.collection('users').doc(uid));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, idx) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (!isUserEligible(data)) return;
      if (normalizeRole(data.role || data.globalRole) !== ROLE_INSTRUCTOR) return;
      eligible.push(chunk[idx]);
    });
  }
  return eligible;
}

/**
 * Group Room instructor message push (native_v2 preferred).
 * Recipients: other active instructors in the tenant only (not institution_admin).
 * Does not create notifications docs. Does not throw to reverse message writes.
 * Never logs full group message text.
 */
async function dispatchGroupMessagePush({
  db,
  messaging,
  admin,
  tenantId,
  messageId,
  messageData,
}) {
  const type = GROUP_MESSAGE_PUSH_TYPE;
  const tid = String(tenantId || '').trim();
  const mid = String(messageId || '').trim();
  const msg = messageData && typeof messageData === 'object' ? messageData : {};

  const notificationId = mid ? `group_message:${mid}` : '';
  const logBase = {
    notificationId: notificationId || null,
    tenantId: tid || null,
    messageId: mid || null,
    type,
    roomType: GROUP_MESSAGE_ROOM_TYPE,
  };

  if (!tid || !mid) {
    console.log('[push_dispatch] group_message skipped', { ...logBase, reason: 'missing_ids' });
    return { ok: false, reason: 'missing_ids' };
  }
  if (msg.isDeleted === true) {
    console.log('[push_dispatch] group_message skipped', { ...logBase, reason: 'message_deleted' });
    return { ok: true, reason: 'message_deleted' };
  }

  const msgTenantId = String(msg.tenantId || '').trim();
  if (msgTenantId && msgTenantId !== tid) {
    console.log('[push_dispatch] group_message skipped', { ...logBase, reason: 'message_tenant_mismatch' });
    return { ok: false, reason: 'message_tenant_mismatch' };
  }

  const senderUid = String(msg.senderUid || '').trim();
  if (!senderUid) {
    console.log('[push_dispatch] group_message skipped', { ...logBase, reason: 'missing_senderUid' });
    return { ok: false, reason: 'missing_senderUid' };
  }

  const textRaw = typeof msg.text === 'string' ? msg.text : '';
  const snippet = normalizePushMessageSnippet(textRaw, GROUP_MESSAGE_PUSH_SNIPPET_MAX);
  if (!snippet) {
    console.log('[push_dispatch] group_message skipped', { ...logBase, reason: 'empty_snippet' });
    return { ok: true, reason: 'empty_snippet' };
  }

  const senderNameRaw = String(msg.senderName || '').trim();
  const senderName = truncateByCodePoints(senderNameRaw || 'Eğitmen', 80);

  let branding;
  try {
    branding = await loadTenantBranding(db, tid);
  } catch (e) {
    console.error('[push_dispatch] group_message branding_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
    branding = { displayName: tid, logoUrl: null };
  }

  const brandSource = classifyPushBrandSource(type, tid);
  const displayTitle = String(branding.displayName || tid || 'Kurum').trim() || 'Kurum';
  const displayBody = `${senderName}\n${snippet}`;
  const brandImageUrl = brandSource === 'tenant' ? (branding.logoUrl || null) : null;

  let instructorUids = [];
  try {
    instructorUids = await resolveActiveInstructorUidsForTenant(db, tid);
  } catch (e) {
    console.error('[push_dispatch] group_message recipient_resolution_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'recipient_resolution_failed' };
  }

  const recipientUids = instructorUids.filter((uid) => uid !== senderUid);
  if (!recipientUids.length) {
    console.log('[push_dispatch] group_message skipped', {
      ...logBase,
      senderUid,
      instructorCount: instructorUids.length,
      reason: 'no_eligible_recipients',
    });
    return { ok: true, reason: 'no_eligible_recipients' };
  }

  let tokenEntries = [];
  try {
    tokenEntries = await loadActiveTokensForUids(db, recipientUids);
  } catch (e) {
    console.error('[push_dispatch] group_message token_lookup_failed', {
      ...logBase,
      recipientCount: recipientUids.length,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'token_lookup_failed' };
  }

  const { entries: dedupedEntries, duplicateCount } = dedupeTokenEntries(tokenEntries);
  if (!dedupedEntries.length) {
    console.log('[push_dispatch] group_message no_tokens', {
      ...logBase,
      senderUid,
      recipientCount: recipientUids.length,
      duplicateTokenCount: duplicateCount,
    });
    return { ok: true, reason: 'no_tokens' };
  }

  const { nativeTokenEntries, legacyTokenEntries } = partitionTokenEntriesForDispatch(dedupedEntries, type);
  const nativePayloadEnabled = isNativeRoutableNotificationType(type) && nativeTokenEntries.length > 0;

  const legacyBasePayload = buildMulticastPayload({
    displayTitle,
    displayBody,
    brandImageUrl,
    notificationId,
    tenantId: tid,
    type,
    targetType: '',
    audienceScope: '',
    messageId: mid,
    senderUid,
    roomType: GROUP_MESSAGE_ROOM_TYPE,
  });

  const nativeBasePayload = nativePayloadEnabled
    ? buildNativeAndroidDataPayload({
      displayTitle,
      displayBody,
      brandImageUrl,
      brandSource,
      notificationId,
      tenantId: tid,
      type,
      targetType: '',
      audienceScope: '',
      messageId: mid,
      senderUid,
      roomType: GROUP_MESSAGE_ROOM_TYPE,
    })
    : null;

  let legacySendResult = null;
  let nativeSendResult = null;
  try {
    if (legacyTokenEntries.length) {
      legacySendResult = await sendTokensInBatches(messaging, legacyBasePayload, legacyTokenEntries, {
        notificationId,
        scenario: 'group_message',
        payloadKind: 'legacy',
      });
    }
    if (nativeBasePayload && nativeTokenEntries.length) {
      nativeSendResult = await sendTokensInBatches(messaging, nativeBasePayload, nativeTokenEntries, {
        notificationId,
        scenario: 'group_message',
        payloadKind: 'native_v2',
      });
    }
  } catch (e) {
    console.error('[push_dispatch] group_message fcm_send_failed', {
      ...logBase,
      recipientCount: recipientUids.length,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'fcm_send_failed' };
  }

  const sendResult = mergeSendResults(legacySendResult, nativeSendResult);

  let deactivatedCount = 0;
  try {
    deactivatedCount = await deactivateInvalidTokenDocs(db, admin, sendResult.failures);
  } catch (e) {
    console.error('[push_dispatch] group_message token_deactivation_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
  }

  console.log('[PushDispatch] group_message completed', {
    ...logBase,
    senderUid,
    recipientCount: recipientUids.length,
    brandSource,
    hasBrandImage: !!brandImageUrl,
    snippetCodePointLength: Array.from(snippet).length,
    historyGeneration: msg.historyGeneration != null ? msg.historyGeneration : null,
    nativePayloadEnabled,
    nativeTokenCount: nativeTokenEntries.length,
    legacyTokenCount: legacyTokenEntries.length,
    deduplicatedTokenCount: dedupedEntries.length,
    duplicateTokenCount: duplicateCount,
    successCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
    permanentlyInvalidTokenCount: sendResult.permanentInvalidCount,
    deactivatedTokenCount: deactivatedCount,
    stoppedEarly: sendResult.stopRemaining,
  });

  return {
    ok: true,
    scenario: 'group_message',
    recipientCount: recipientUids.length,
    tokenCount: dedupedEntries.length,
    successCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
  };
}

/**
 * Prove recipientUid is an active instructor for the given tenant.
 * Membership + users.role must both be instructor/active.
 */
async function isActiveInstructorForTenant(db, tenantId, uid) {
  const tid = String(tenantId || '').trim();
  const u = String(uid || '').trim();
  if (!tid || !u) return false;

  const memSnap = await db.collection('tenantMemberships').doc(u + '_' + tid).get();
  if (!memSnap.exists) return false;
  const mem = memSnap.data() || {};
  if (String(mem.tenantId || '').trim() !== tid) return false;
  if (String(mem.uid || '').trim() && String(mem.uid || '').trim() !== u) return false;
  if (normalizeRole(mem.role) !== ROLE_INSTRUCTOR) return false;
  if (normalizeRole(mem.status) !== 'active') return false;

  const userSnap = await db.collection('users').doc(u).get();
  if (!userSnap.exists) return false;
  const user = userSnap.data() || {};
  if (!isUserEligible(user)) return false;
  if (normalizeRole(user.role || user.globalRole) !== ROLE_INSTRUCTOR) return false;
  return true;
}

/**
 * Agenda assignment push (native_v2 preferred).
 * Source: drivingLessonNotifications create with type=lesson_assigned.
 * Does not mutate notification unread/readAt. Fail-safe only.
 */
async function dispatchLessonAssignedPush({
  db,
  messaging,
  admin,
  notificationId,
  notificationData,
}) {
  const type = LESSON_ASSIGNED_PUSH_TYPE;
  const nid = String(notificationId || '').trim();
  const data = notificationData && typeof notificationData === 'object' ? notificationData : {};

  const tid = String(data.tenantId || '').trim();
  const recipientUid = String(data.recipientUid || '').trim();
  const lessonId = String(data.lessonId || '').trim();
  const agendaWeekStart = String(data.agendaWeekStart || '').trim();
  const recipientRole = String(data.recipientRole || '').trim().toLowerCase();
  const notifType = String(data.type || '').trim().toLowerCase();

  const logBase = {
    notificationId: nid || null,
    tenantId: tid || null,
    recipientUid: recipientUid || null,
    lessonId: lessonId || null,
    type,
  };

  if (!nid || !tid || !recipientUid) {
    console.log('[push_dispatch] lesson_assigned skipped', { ...logBase, reason: 'missing_ids' });
    return { ok: false, reason: 'missing_ids' };
  }
  if (notifType !== LESSON_ASSIGNED_PUSH_TYPE) {
    console.log('[push_dispatch] lesson_assigned skipped', { ...logBase, reason: 'type_mismatch', notifType });
    return { ok: true, reason: 'type_mismatch' };
  }
  if (recipientRole !== ROLE_INSTRUCTOR) {
    console.log('[push_dispatch] lesson_assigned skipped', {
      ...logBase,
      reason: 'recipient_role_not_instructor',
      recipientRole,
    });
    return { ok: true, reason: 'recipient_role_not_instructor' };
  }

  let instructorOk = false;
  try {
    instructorOk = await isActiveInstructorForTenant(db, tid, recipientUid);
  } catch (e) {
    console.error('[push_dispatch] lesson_assigned recipient_validation_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'recipient_validation_failed' };
  }
  if (!instructorOk) {
    console.log('[push_dispatch] lesson_assigned skipped', {
      ...logBase,
      reason: 'recipient_not_active_instructor',
    });
    return { ok: true, reason: 'recipient_not_active_instructor' };
  }

  const titleLine = String(data.title || '').trim() || LESSON_ASSIGNED_BODY_TITLE;
  const previewRaw = String(data.preview || '').trim();
  const preview = normalizePushMessageSnippet(previewRaw, LESSON_ASSIGNED_PREVIEW_MAX);
  const displayBody = preview
    ? `${titleLine}\n${preview}`
    : titleLine;

  let branding;
  try {
    branding = await loadTenantBranding(db, tid);
  } catch (e) {
    console.error('[push_dispatch] lesson_assigned branding_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
    branding = { displayName: tid, logoUrl: null };
  }

  const brandSource = classifyPushBrandSource(type, tid);
  const displayTitle = String(branding.displayName || tid || 'Kurum').trim() || 'Kurum';
  const brandImageUrl = brandSource === 'tenant' ? (branding.logoUrl || null) : null;

  let eligibleUids = [];
  try {
    eligibleUids = await filterEligibleUserUids(db, [recipientUid]);
  } catch (e) {
    console.error('[push_dispatch] lesson_assigned recipient_eligibility_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'recipient_eligibility_failed' };
  }
  if (!eligibleUids.length || !eligibleUids.includes(recipientUid)) {
    console.log('[push_dispatch] lesson_assigned skipped', {
      ...logBase,
      reason: 'recipient_not_eligible',
    });
    return { ok: true, reason: 'recipient_not_eligible' };
  }

  let tokenEntries = [];
  try {
    tokenEntries = await loadActiveTokensForUids(db, [recipientUid]);
  } catch (e) {
    console.error('[push_dispatch] lesson_assigned token_lookup_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'token_lookup_failed' };
  }

  const { entries: dedupedEntries, duplicateCount } = dedupeTokenEntries(tokenEntries);
  if (!dedupedEntries.length) {
    console.log('[push_dispatch] lesson_assigned no_tokens', {
      ...logBase,
      duplicateTokenCount: duplicateCount,
    });
    return { ok: true, reason: 'no_tokens' };
  }

  const { nativeTokenEntries, legacyTokenEntries } = partitionTokenEntriesForDispatch(dedupedEntries, type);
  const nativePayloadEnabled = isNativeRoutableNotificationType(type) && nativeTokenEntries.length > 0;

  const legacyBasePayload = buildMulticastPayload({
    displayTitle,
    displayBody,
    brandImageUrl,
    notificationId: nid,
    tenantId: tid,
    type,
    targetType: '',
    audienceScope: '',
    lessonId,
    agendaWeekStart,
  });

  const nativeBasePayload = nativePayloadEnabled
    ? buildNativeAndroidDataPayload({
      displayTitle,
      displayBody,
      brandImageUrl,
      brandSource,
      notificationId: nid,
      tenantId: tid,
      type,
      targetType: '',
      audienceScope: '',
      lessonId,
      agendaWeekStart,
    })
    : null;

  let legacySendResult = null;
  let nativeSendResult = null;
  try {
    if (legacyTokenEntries.length) {
      legacySendResult = await sendTokensInBatches(messaging, legacyBasePayload, legacyTokenEntries, {
        notificationId: nid,
        scenario: 'lesson_assigned',
        payloadKind: 'legacy',
      });
    }
    if (nativeBasePayload && nativeTokenEntries.length) {
      nativeSendResult = await sendTokensInBatches(messaging, nativeBasePayload, nativeTokenEntries, {
        notificationId: nid,
        scenario: 'lesson_assigned',
        payloadKind: 'native_v2',
      });
    }
  } catch (e) {
    console.error('[push_dispatch] lesson_assigned fcm_send_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
    return { ok: false, reason: 'fcm_send_failed' };
  }

  const sendResult = mergeSendResults(legacySendResult, nativeSendResult);

  let deactivatedCount = 0;
  try {
    deactivatedCount = await deactivateInvalidTokenDocs(db, admin, sendResult.failures);
  } catch (e) {
    console.error('[push_dispatch] lesson_assigned token_deactivation_failed', {
      ...logBase,
      message: e && e.message ? e.message : String(e),
    });
  }

  console.log('[PushDispatch] lesson_assigned completed', {
    ...logBase,
    brandSource,
    hasBrandImage: !!brandImageUrl,
    nativePayloadEnabled,
    nativeTokenCount: nativeTokenEntries.length,
    legacyTokenCount: legacyTokenEntries.length,
    deduplicatedTokenCount: dedupedEntries.length,
    duplicateTokenCount: duplicateCount,
    successCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
    permanentlyInvalidTokenCount: sendResult.permanentInvalidCount,
    deactivatedTokenCount: deactivatedCount,
    stoppedEarly: sendResult.stopRemaining,
  });

  return {
    ok: true,
    scenario: 'lesson_assigned',
    recipientUid,
    tokenCount: dedupedEntries.length,
    successCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
  };
}

module.exports = {
  FCM_BATCH_SIZE,
  PLATFORM_DISPLAY_NAME,
  maskToken,
  composePushDisplayBody,
  classifyPushBrandSource,
  truncateByCodePoints,
  normalizePushMessageSnippet,
  resolveSafePushImageUrl,
  loadTenantBranding,
  resolvePushDisplayBranding,
  resolveNotificationScenario,
  resolveNotificationRecipients,
  resolveMembershipUids,
  validateTenantActive,
  loadActiveTokensForUids,
  dedupeTokenEntries,
  isNativeCapableToken,
  isNativeRoutableNotificationType,
  partitionTokenEntriesForDispatch,
  buildNativeAndroidDataPayload,
  mergeSendResults,
  sendTokensInBatches,
  deactivateInvalidTokenDocs,
  dispatchNotificationPush,
  dispatchPrivateMessagePush,
  dispatchGroupMessagePush,
  dispatchLessonAssignedPush,
};
