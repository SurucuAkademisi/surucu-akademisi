/**
 * Read-only ad policy for mobile runtime (lessons). Fail-open on errors.
 * Priority: userEntitlements > tenant session + billing/settings.
 */
import { getActiveTenantSession } from './tenant-session.store.js';
import {
  getTenantMembershipByCompositeId,
  getTenantBilling,
  isTenantBillingAccessValid,
  isTenantAdsExplicitlyDisabled,
  getUserEntitlement,
} from './tenant.repository.js';

const TRIAL_MS = 45 * 24 * 60 * 60 * 1000;

const ACTIVE_PREMIUM_BILLING = ['aktif', 'paid', 'premium'];
const INACTIVE_PREMIUM_BILLING = ['ödeme bekleniyor', 'gecikmiş ödeme'];

function normalizeBillingText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('tr-TR');
}

/**
 * Premium Reklamsız Paket + active billing status (admin Hesap ile uyumlu).
 */
export function isTenantPremiumPackageActive(billing) {
  if (!billing || typeof billing !== 'object') return false;
  const pkg = normalizeBillingText(billing.packageName);
  const bs = normalizeBillingText(billing.billingStatus);
  if (!pkg || !bs) return false;
  if (INACTIVE_PREMIUM_BILLING.includes(bs)) return false;
  if (!ACTIVE_PREMIUM_BILLING.includes(bs)) return false;
  return pkg.includes('reklamsız');
}

function timestampToMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  return null;
}

/** Active iff adFree === true and expiresAt is null or in the future. */
function isUserAdFreeEntitlementActive(entitlement) {
  if (!entitlement || entitlement.adFree !== true) return false;
  const expiresMs = timestampToMillis(entitlement.expiresAt);
  if (expiresMs == null) return true;
  return expiresMs > Date.now();
}

function userAdFreeContext(entitlement) {
  const expiresMs = entitlement && entitlement.expiresAt != null
    ? timestampToMillis(entitlement.expiresAt)
    : null;
  const ctx = {
    isInstitutionStudent: false,
    membershipCreatedAt: null,
    membershipCreatedAtMs: null,
    isInTrial: false,
    tenantBillingStatus: null,
    tenantPackageName: null,
    tenantAdsEnabled: true,
    tenantAdsDesiredOff: false,
    tenantBillingAccessValid: false,
    institutionAdFreeEffective: false,
    isPremiumInstitution: false,
    isPremiumPackageActive: false,
    canShowAds: false,
    userAdFree: true,
    userEntitlementSource: entitlement && entitlement.source != null ? String(entitlement.source) : null,
    userEntitlementExpiresAtMs: expiresMs,
    fetchFailed: false,
  };
  if (typeof window !== 'undefined') {
    window.__SA_AD_POLICY_CONTEXT = ctx;
  }
  return ctx;
}

function failOpenContext(message, err) {
  if (message) console.warn('[AdPolicy]', message, err || '');
  const ctx = {
    isInstitutionStudent: false,
    membershipCreatedAt: null,
    membershipCreatedAtMs: null,
    isInTrial: false,
    tenantBillingStatus: null,
    tenantPackageName: null,
    tenantAdsEnabled: true,
    tenantAdsDesiredOff: false,
    tenantBillingAccessValid: false,
    institutionAdFreeEffective: false,
    isPremiumInstitution: false,
    isPremiumPackageActive: false,
    canShowAds: true,
    fetchFailed: true,
  };
  if (typeof window !== 'undefined') {
    window.__SA_AD_POLICY_CONTEXT = ctx;
  }
  return ctx;
}

function externalUserContext() {
  const ctx = {
    isInstitutionStudent: false,
    membershipCreatedAt: null,
    membershipCreatedAtMs: null,
    isInTrial: false,
    tenantBillingStatus: null,
    tenantPackageName: null,
    tenantAdsEnabled: true,
    tenantAdsDesiredOff: false,
    tenantBillingAccessValid: false,
    institutionAdFreeEffective: false,
    isPremiumInstitution: false,
    isPremiumPackageActive: false,
    canShowAds: true,
    fetchFailed: false,
  };
  if (typeof window !== 'undefined') {
    window.__SA_AD_POLICY_CONTEXT = ctx;
  }
  return ctx;
}

/**
 * Resolve policy for the signed-in user; requires tenant session already set.
 */
function isPublicUserModeActive() {
  if (typeof window === 'undefined') return false;
  return !!(
    window.SA_PUBLIC_USER_SESSION
    && typeof window.SA_PUBLIC_USER_SESSION.isPublicUserSessionActive === 'function'
    && window.SA_PUBLIC_USER_SESSION.isPublicUserSessionActive()
  );
}

export async function refreshAdPolicyForCurrentUser(user) {
  if (!user || !user.uid) {
    return externalUserContext();
  }

  try {
    if (isPublicUserModeActive()) {
      try {
        const entitlement = await getUserEntitlement(user.uid);
        if (isUserAdFreeEntitlementActive(entitlement)) {
          console.log('[AdPolicy] public user entitlement ad-free override active');
          return userAdFreeContext(entitlement);
        }
      } catch (entErr) {
        console.warn('[AdPolicy] public user entitlement read failed; using external policy', entErr);
      }
      return externalUserContext();
    }

    try {
      const entitlement = await getUserEntitlement(user.uid);
      if (isUserAdFreeEntitlementActive(entitlement)) {
        console.log('[AdPolicy] user entitlement ad-free override active');
        return userAdFreeContext(entitlement);
      }
    } catch (entErr) {
      console.warn('[AdPolicy] user entitlement read failed; continuing existing policy', entErr);
    }

    const session = getActiveTenantSession();
    const tenantId = session.tenantId;
    const role = String(session.tenantRole || '').trim().toLowerCase();
    const mStatus = String(session.membershipStatus || '').trim().toLowerCase();

    const isInstitutionStudent = role === 'student' && mStatus === 'active' && !!tenantId;

    if (!isInstitutionStudent) {
      return externalUserContext();
    }

    const mem = await getTenantMembershipByCompositeId(user.uid, tenantId);
    const membershipCreatedAt = mem && mem.createdAt != null ? mem.createdAt : null;
    const membershipCreatedAtMs = timestampToMillis(membershipCreatedAt);
    const membershipWithin45d = membershipCreatedAtMs != null && (Date.now() - membershipCreatedAtMs < TRIAL_MS);

    // Legacy tenant advertisement trial (adTrialStartedAt / adTrialEndsAt) is retired
    // from all runtime ad decisions. Existing Firestore values remain stored but are
    // no longer read here.
    const isInTrial = false;

    let tenantBilling = {
      billingStatus: null,
      packageName: null,
      noExpiry: false,
      accessStartsAt: null,
      accessEndsAt: null,
      nextDueDate: null,
      lastPaymentDate: null,
      monthlyFee: null,
    };
    let adsExplicitlyOff = false;
    try {
      tenantBilling = await getTenantBilling(tenantId);
    } catch (e) {
      console.warn('[AdPolicy] tenantBilling read failed; billing treated as non-premium', e);
    }
    try {
      adsExplicitlyOff = await isTenantAdsExplicitlyDisabled(tenantId);
    } catch (e) {
      console.warn('[AdPolicy] tenantSettings read failed; adsEnabled not treated as false', e);
    }

    const tenantBillingStatus = tenantBilling.billingStatus;
    const tenantPackageName = tenantBilling.packageName;
    const tenantBillingAccessValid = isTenantBillingAccessValid(tenantBilling);
    const tenantAdsDesiredOff = adsExplicitlyOff;
    // Institution ad-free status follows the explicit tenant setting only;
    // tenantBilling validity no longer gates it.
    const institutionAdFreeEffective = adsExplicitlyOff;
    const isPremiumPackageActive = isTenantPremiumPackageActive(tenantBilling);
    const isPremiumInstitution = isPremiumPackageActive;
    const tenantAdsEnabled = !adsExplicitlyOff;

    const canShowAds = !institutionAdFreeEffective;

    const ctx = {
      isInstitutionStudent: true,
      membershipCreatedAt,
      membershipCreatedAtMs,
      isInTrial,
      tenantBillingStatus,
      tenantPackageName,
      tenantAdsEnabled,
      tenantAdsDesiredOff,
      tenantBillingAccessValid,
      institutionAdFreeEffective,
      isPremiumInstitution,
      isPremiumPackageActive,
      canShowAds,
      fetchFailed: false,
    };
    if (typeof window !== 'undefined') {
      window.__SA_AD_POLICY_CONTEXT = ctx;
    }
    return ctx;
  } catch (e) {
    return failOpenContext('resolve failed, fail-open (ads allowed)', e);
  }
}

export function getAdPolicyContext() {
  if (typeof window === 'undefined') return null;
  return window.__SA_AD_POLICY_CONTEXT || null;
}

/** Unknown / missing context => true (fail open). */
export function getCanShowAds() {
  const c = typeof window !== 'undefined' ? window.__SA_AD_POLICY_CONTEXT : null;
  if (!c) return true;
  return c.canShowAds === true;
}

if (typeof window !== 'undefined') {
  window.SA_AD_POLICY = {
    getContext: getAdPolicyContext,
    getCanShowAds,
    refreshAdPolicyForCurrentUser,
  };
}
