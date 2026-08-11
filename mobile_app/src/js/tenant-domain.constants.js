// Multi-tenant domain constants foundation.
// Safe non-breaking module: exported only, not wired to runtime yet.

export const TENANT_ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  INSTITUTION_ADMIN: 'institution_admin',
  STUDENT: 'student',
  INSTRUCTOR: 'instructor',
});

export const TENANT_MEMBERSHIP_STATUSES = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
});

export const TENANT_STATUSES = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
});

export const TENANT_ROLE_VALUES = Object.freeze(Object.values(TENANT_ROLES));
export const TENANT_MEMBERSHIP_STATUS_VALUES = Object.freeze(Object.values(TENANT_MEMBERSHIP_STATUSES));
export const TENANT_STATUS_VALUES = Object.freeze(Object.values(TENANT_STATUSES));
