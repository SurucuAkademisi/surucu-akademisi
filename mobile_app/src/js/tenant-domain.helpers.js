import {
  TENANT_ROLES,
  TENANT_MEMBERSHIP_STATUSES,
  TENANT_STATUSES,
  TENANT_ROLE_VALUES,
  TENANT_MEMBERSHIP_STATUS_VALUES,
  TENANT_STATUS_VALUES,
} from './tenant-domain.constants.js';

// Multi-tenant domain helper foundation.
// Safe non-breaking module: exported only, not wired to runtime yet.

function toNormalizedString(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

export function isValidTenantRole(value) {
  const normalized = toNormalizedString(value);
  return TENANT_ROLE_VALUES.includes(normalized);
}

export function isValidTenantMembershipStatus(value) {
  const normalized = toNormalizedString(value);
  return TENANT_MEMBERSHIP_STATUS_VALUES.includes(normalized);
}

export function isValidTenantStatus(value) {
  const normalized = toNormalizedString(value);
  return TENANT_STATUS_VALUES.includes(normalized);
}

export function getDefaultTenantMembershipStatus() {
  return TENANT_MEMBERSHIP_STATUSES.ACTIVE;
}

export function getDefaultTenantStatus() {
  return TENANT_STATUSES.ACTIVE;
}

export {
  TENANT_ROLES,
  TENANT_MEMBERSHIP_STATUSES,
  TENANT_STATUSES,
};
