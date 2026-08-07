import {
  TENANT_MEMBERSHIP_STATUSES,
  TENANT_ROLES,
  TENANT_STATUSES,
} from './tenant-domain.constants.js';
import {
  isValidTenantMembershipStatus,
  isValidTenantRole,
  isValidTenantStatus,
  getDefaultTenantStatus,
} from './tenant-domain.helpers.js';
import {
  getPlatformUser,
  getTenant,
  getUserMemberships,
} from './tenant.repository.js';

// Tenant context resolver (Phase 1).
// Read-only resolver for tenant identity backbone.

function normalizeUid(userIdentity) {
  if (typeof userIdentity === 'string') return userIdentity.trim();
  if (userIdentity && typeof userIdentity === 'object' && typeof userIdentity.uid === 'string') {
    return userIdentity.uid.trim();
  }
  return '';
}

function normalizeRole(value) {
  if (!isValidTenantRole(value)) return null;
  return String(value).trim().toLowerCase();
}

function normalizeMembershipStatus(value) {
  if (!isValidTenantMembershipStatus(value)) return null;
  return String(value).trim().toLowerCase();
}

function normalizeTenantStatus(value) {
  const candidate = value || getDefaultTenantStatus();
  if (!isValidTenantStatus(candidate)) return null;
  return String(candidate).trim().toLowerCase();
}

export async function getUserTenantMemberships(userIdentity) {
  const uid = normalizeUid(userIdentity);
  if (!uid) return [];
  return getUserMemberships(uid);
}

export function selectDefaultTenant(memberships) {
  const list = Array.isArray(memberships) ? memberships : [];
  const allowedTenantRoles = [
    TENANT_ROLES.INSTITUTION_ADMIN,
    TENANT_ROLES.STUDENT,
  ];

  const activeMemberships = list.filter((item) => {
    if (!item || typeof item !== 'object') return false;

    const role = normalizeRole(item.role);
    const status = normalizeMembershipStatus(item.status);
    const tenantStatus = normalizeTenantStatus(item.tenantStatus);

    return (
      !!role
      && !!status
      && !!tenantStatus
      && allowedTenantRoles.includes(role)
      && status === TENANT_MEMBERSHIP_STATUSES.ACTIVE
      && tenantStatus === TENANT_STATUSES.ACTIVE
    );
  });

  return activeMemberships.length ? activeMemberships[0] : null;
}

/**
 * Seçilen tenantId ile membership doğrula.
 * memberships içinde tenantId eşleşen ve active olan kaydı bulur.
 */
function findMembershipByTenantId(memberships, selectedTenantId) {
  const normalized = String(selectedTenantId || '').trim();
  if (!normalized) return null;

  const list = Array.isArray(memberships) ? memberships : [];
  return list.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const tid = typeof item.tenantId === 'string' ? item.tenantId.trim() : '';
    const role = normalizeRole(item.role);
    const status = normalizeMembershipStatus(item.status);
    const tenantStatus = normalizeTenantStatus(item.tenantStatus);

    return (
      tid === normalized
      && !!role
      && status === TENANT_MEMBERSHIP_STATUSES.ACTIVE
      && tenantStatus === TENANT_STATUSES.ACTIVE
    );
  }) || null;
}

export async function resolveTenantContext(userIdentity, selectedTenantId = null) {
  const uid = normalizeUid(userIdentity);
  if (!uid) {
    return {
      uid: '',
      globalRole: null,
      membershipId: null,
      tenantId: null,
      tenantRole: null,
      tenantStatus: null,
      membershipStatus: null,
      tenant: null,
    };
  }

  const platformUser = await getPlatformUser(uid);
  const globalRole = normalizeRole(platformUser?.globalRole);

  const memberships = await getUserTenantMemberships(uid);

  // selectedTenantId verildiyse: o tenant için active membership ara
  let activeMembership = null;
  if (selectedTenantId) {
    activeMembership = findMembershipByTenantId(memberships, selectedTenantId);
  }
  // selectedTenantId yoksa: mevcut fallback (ilk uygun membership)
  if (!activeMembership) {
    activeMembership = selectDefaultTenant(memberships);
  }

  const membershipId = activeMembership
    ? (typeof activeMembership.membershipId === 'string'
      ? activeMembership.membershipId
      : (activeMembership.id || null))
    : null;

  const tenantId = activeMembership && typeof activeMembership.tenantId === 'string'
    ? activeMembership.tenantId.trim() || null
    : null;

  const tenantRole = activeMembership ? normalizeRole(activeMembership.role) : null;
  const membershipStatus = activeMembership ? normalizeMembershipStatus(activeMembership.status) : null;

  const tenant = tenantId ? await getTenant(tenantId) : null;
  const tenantStatus = normalizeTenantStatus(
    (tenant && tenant.status) || (activeMembership && activeMembership.tenantStatus)
  );

  // super_admin can be valid without tenant membership in Phase 1.
  if (globalRole === TENANT_ROLES.SUPER_ADMIN && !activeMembership) {
    return {
      uid,
      globalRole,
      membershipId: null,
      tenantId: null,
      tenantRole: null,
      tenantStatus: null,
      membershipStatus: null,
      tenant: null,
    };
  }

  return {
    uid,
    globalRole,
    membershipId,
    tenantId,
    tenantRole,
    tenantStatus,
    membershipStatus,
    tenant,
  };
}