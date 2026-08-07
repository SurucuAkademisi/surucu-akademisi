// Tenant session/state foundation.
// Safe non-breaking in-memory store: exported only, not wired to runtime yet.

function createEmptyTenantSession() {
  return {
    uid: null,
    globalRole: null,
    membershipId: null,
    tenantId: null,
    tenantRole: null,
    tenantStatus: null,
    membershipStatus: null,
    tenant: null,
  };
}

let tenantSessionState = createEmptyTenantSession();

function normalizeStringOrNull(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeTenantObjectOrNull(value) {
  if (!value || typeof value !== 'object') return null;
  return { ...value };
}

function normalizeTenantSession(context) {
  const source = (context && typeof context === 'object') ? context : {};

  return {
    uid: normalizeStringOrNull(source.uid),
    globalRole: normalizeStringOrNull(source.globalRole),
    membershipId: normalizeStringOrNull(source.membershipId),
    tenantId: normalizeStringOrNull(source.tenantId),
    tenantRole: normalizeStringOrNull(source.tenantRole),
    tenantStatus: normalizeStringOrNull(source.tenantStatus),
    membershipStatus: normalizeStringOrNull(source.membershipStatus),
    tenant: normalizeTenantObjectOrNull(source.tenant),
  };
}

function cloneTenantSession() {
  return {
    ...tenantSessionState,
    tenant: normalizeTenantObjectOrNull(tenantSessionState.tenant),
  };
}

export function setActiveTenantSession(context) {
  tenantSessionState = normalizeTenantSession(context);
  return cloneTenantSession();
}

export function getActiveTenantSession() {
  return cloneTenantSession();
}

export function clearActiveTenantSession() {
  tenantSessionState = createEmptyTenantSession();
  return cloneTenantSession();
}

// Backward-compatible aliases for older naming in runtime.
export const setActiveTenant = setActiveTenantSession;
export const getActiveTenant = getActiveTenantSession;
export const clearTenantSession = clearActiveTenantSession;

export function getActiveTenantId() {
  return tenantSessionState.tenantId || null;
}

// Seçilen tenantId (login öncesi kurum seçimi) — sessionStorage
const SELECTED_TENANT_KEY = 'sa_selected_tenant_id';

export function setSelectedTenantId(tenantId) {
  const value = typeof tenantId === 'string' ? tenantId.trim() : '';
  try {
    if (value) {
      sessionStorage.setItem(SELECTED_TENANT_KEY, value);
    } else {
      sessionStorage.removeItem(SELECTED_TENANT_KEY);
    }
  } catch {
    // sessionStorage erişilemezse sessizce geç
  }
}

export function getSelectedTenantId() {
  try {
    const value = sessionStorage.getItem(SELECTED_TENANT_KEY);
    return typeof value === 'string' ? value.trim() || null : null;
  } catch {
    return null;
  }
}

export function clearSelectedTenantId() {
  try {
    sessionStorage.removeItem(SELECTED_TENANT_KEY);
  } catch {
    // sessizce geç
  }
}
