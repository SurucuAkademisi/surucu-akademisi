// Firestore tenant identity repository (Phase 1).
// Read-only layer for: users, tenants, tenantMemberships.

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getFirestore() {
  const firebaseGlobal = (typeof window !== 'undefined' && window.firebase)
    ? window.firebase
    : (typeof globalThis !== 'undefined' ? globalThis.firebase : undefined);

  if (!firebaseGlobal || typeof firebaseGlobal.firestore !== 'function') {
    return null;
  }

  return firebaseGlobal.firestore();
}

function mapDoc(snapshot) {
  if (!snapshot || !snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

function mapQuerySnapshot(querySnapshot) {
  if (!querySnapshot || !Array.isArray(querySnapshot.docs)) return [];
  return querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Kullanıcı profilini Firestore users koleksiyonundan okur.
 * Resolver uyumluluğu için role alanı globalRole olarak da döner.
 */
export async function getPlatformUser(uid) {
  const normalizedUid = normalizeId(uid);
  if (!normalizedUid) return null;

  const db = getFirestore();
  if (!db) return null;

  try {
    const snapshot = await db.collection('users').doc(normalizedUid).get();
    const raw = mapDoc(snapshot);
    if (!raw) return null;
    return { ...raw, globalRole: raw.role != null ? raw.role : raw.globalRole };
  } catch {
    return null;
  }
}

export async function getTenant(tenantId) {
  const normalizedTenantId = normalizeId(tenantId);
  if (!normalizedTenantId) return null;

  const db = getFirestore();
  if (!db) return null;

  const snapshot = await db.collection('tenants').doc(normalizedTenantId).get();
  return mapDoc(snapshot);
}

export async function getUserMemberships(uid) {
  const normalizedUid = normalizeId(uid);
  if (!normalizedUid) return [];

  const db = getFirestore();
  if (!db) return [];

  const querySnapshot = await db
    .collection('tenantMemberships')
    .where('uid', '==', normalizedUid)
    .get();

  return mapQuerySnapshot(querySnapshot);
}

/**
 * tenantMemberships dokümanı: id = {uid}_{tenantId} (admin ile uyumlu).
 */
export async function getTenantMembershipByCompositeId(uid, tenantId) {
  const u = normalizeId(uid);
  const t = normalizeId(tenantId);
  if (!u || !t) return null;

  const db = getFirestore();
  if (!db) return null;

  try {
    const snapshot = await db.collection('tenantMemberships').doc(`${u}_${t}`).get();
    return mapDoc(snapshot);
  } catch {
    return null;
  }
}

/**
 * Kurum faturalama: tenantBilling/{tenantId}
 */
function emptyTenantBilling() {
  return {
    billingStatus: null,
    packageName: null,
    noExpiry: false,
    accessStartsAt: null,
    accessEndsAt: null,
    nextDueDate: null,
    lastPaymentDate: null,
    monthlyFee: null,
  };
}

function normalizeBillingStatusText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('tr-TR');
}

/**
 * @param {unknown} value
 * @param {{ endOfDay?: boolean }} [options]
 * @returns {number|null}
 */
export function billingDateToMillis(value, options) {
  const opts = options || {};
  const endOfDay = opts.endOfDay === true;
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const parts = trimmed.slice(0, 10).split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
      if (endOfDay) return new Date(y, m, d, 23, 59, 59, 999).getTime();
      return new Date(y, m, d, 0, 0, 0, 0).getTime();
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object' && value !== null && typeof value.toDate === 'function') {
    try {
      const asDate = value.toDate();
      if (asDate instanceof Date) {
        const ms = asDate.getTime();
        return Number.isFinite(ms) ? ms : null;
      }
    } catch (_) {}
  }
  if (typeof value === 'object' && value !== null && typeof value.toMillis === 'function') {
    try {
      return value.toMillis();
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Runtime kurum muhasebe erişimi geçerli mi? packageName kullanılmaz.
 * @param {object|null|undefined} billing
 * @returns {boolean}
 */
export function isTenantBillingAccessValid(billing) {
  if (!billing || typeof billing !== 'object') return false;
  const status = normalizeBillingStatusText(billing.billingStatus);
  if (status === 'paused' || status === 'duraklatıldı' || status === 'duraklatildi' || status === 'suspended') {
    return false;
  }
  if (billing.noExpiry === true) return true;

  const startMs = billingDateToMillis(billing.accessStartsAt, { endOfDay: false });
  if (startMs != null && Date.now() < startMs) return false;

  const endRaw = billing.accessEndsAt != null && String(billing.accessEndsAt).trim() !== ''
    ? billing.accessEndsAt
    : billing.nextDueDate;
  const endMs = billingDateToMillis(endRaw, { endOfDay: true });
  if (endMs == null) return false;
  return Date.now() <= endMs;
}

export async function getTenantBilling(tenantId) {
  const empty = emptyTenantBilling();
  const t = normalizeId(tenantId);
  if (!t) return empty;

  const db = getFirestore();
  if (!db) return empty;

  try {
    const snapshot = await db.collection('tenantBilling').doc(t).get();
    if (!snapshot.exists) return empty;
    const d = snapshot.data() || {};
    return {
      billingStatus: d.billingStatus != null ? String(d.billingStatus) : null,
      packageName: d.packageName != null ? String(d.packageName) : null,
      noExpiry: d.noExpiry === true,
      accessStartsAt: d.accessStartsAt != null ? d.accessStartsAt : null,
      accessEndsAt: d.accessEndsAt != null ? d.accessEndsAt : null,
      nextDueDate: d.nextDueDate != null ? d.nextDueDate : null,
      lastPaymentDate: d.lastPaymentDate != null ? d.lastPaymentDate : null,
      monthlyFee: d.monthlyFee != null ? Number(d.monthlyFee) : null,
    };
  } catch {
    return empty;
  }
}

export async function getTenantBillingStatus(tenantId) {
  const billing = await getTenantBilling(tenantId);
  return billing.billingStatus != null ? billing.billingStatus : null;
}

/** true only if tenantSettings.adsEnabled === false */
export async function isTenantAdsExplicitlyDisabled(tenantId) {
  const t = normalizeId(tenantId);
  if (!t) return false;

  const db = getFirestore();
  if (!db) return false;

  try {
    const snapshot = await db.collection('tenantSettings').doc(t).get();
    if (!snapshot.exists) return false;
    const d = snapshot.data() || {};
    return d.adsEnabled === false;
  } catch {
    return false;
  }
}

/**
 * Kullanıcı reklamsız entitlement: userEntitlements/{uid}
 * @returns {object|null} doc data or null if missing
 * @throws on Firestore read failure (caller fail-open)
 */
export async function getUserEntitlement(uid) {
  const normalizedUid = normalizeId(uid);
  if (!normalizedUid) return null;

  const db = getFirestore();
  if (!db) {
    throw new Error('Firestore unavailable');
  }

  const snapshot = await db.collection('userEntitlements').doc(normalizedUid).get();
  return mapDoc(snapshot);
}

// Backward-compatible aliases for existing placeholder naming.
export const fetchTenant = getTenant;
export const fetchUserMemberships = getUserMemberships;
