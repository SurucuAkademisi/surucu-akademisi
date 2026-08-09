/**
 * Machine web session — sessionStorage only.
 * Authorization remains Firebase Auth + Machine callables.
 */
(function () {
  'use strict';

  var MACHINE_SESSION_KEY = 'sa_machine_web_session_v1';
  var PROGRAM_TYPE = 'machine_operator';
  var PLATFORM_TENANT_ID = 'surucu_akademisi';
  var DEFAULT_SA_LOGO = '/assets/images/logo.png';
  var DEFAULT_TENANT_LOGO_PREFIX = '/assets/tenant-logos/';

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth) return fb.auth;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.auth) {
      return window.firebase.auth();
    }
    return null;
  }

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function saveMachineSession(session) {
    if (!session || typeof session !== 'object') return false;
    var programType = normalizeString(session.programType) || PROGRAM_TYPE;
    if (programType !== PROGRAM_TYPE) return false;
    var payload = {
      uid: normalizeString(session.uid),
      tenantId: normalizeString(session.tenantId),
      programType: PROGRAM_TYPE,
      enrollmentSource: normalizeString(session.enrollmentSource),
      mode: normalizeString(session.mode),
      membershipId: normalizeString(session.membershipId),
      accessStatus: normalizeString(session.accessStatus),
      accessExpiresAt:
        session.accessExpiresAt == null || session.accessExpiresAt === ''
          ? null
          : Number(session.accessExpiresAt),
      accessDaysRemaining:
        session.accessDaysRemaining == null || session.accessDaysRemaining === ''
          ? null
          : Number(session.accessDaysRemaining),
      displayName: normalizeString(session.displayName),
      fullName: normalizeString(session.fullName),
      tenantName: normalizeString(session.tenantName),
      tenantLogoUrl: normalizeString(session.tenantLogoUrl),
      showInstitutionLogo: session.showInstitutionLogo !== false,
      savedAt: session.savedAt || Date.now()
    };
    if (!payload.uid || !payload.tenantId || !payload.mode || !payload.enrollmentSource) {
      return false;
    }
    try {
      sessionStorage.setItem(MACHINE_SESSION_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn('[machine-web-session] save failed', e);
      return false;
    }
  }

  function getMachineSession() {
    try {
      var raw = sessionStorage.getItem(MACHINE_SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (normalizeString(parsed.programType) !== PROGRAM_TYPE) return null;
      if (!normalizeString(parsed.uid) || !normalizeString(parsed.tenantId)) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearMachineSession() {
    try {
      sessionStorage.removeItem(MACHINE_SESSION_KEY);
    } catch (e) {
      console.warn('[machine-web-session] clear failed', e);
    }
  }

  function requireMachineSession() {
    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    var session = getMachineSession();
    if (!user || !user.uid || !session) return null;
    if (normalizeString(session.uid) !== normalizeString(user.uid)) return null;
    if (normalizeString(session.programType) !== PROGRAM_TYPE) return null;
    if (!normalizeString(session.tenantId)) return null;
    var mode = normalizeString(session.mode);
    if (mode !== 'public' && mode !== 'institution') return null;
    return session;
  }

  function pickLogoRaw(tenantData) {
    if (!tenantData || typeof tenantData !== 'object') return '';
    var fields = ['logoUrl', 'logo', 'logoPath', 'logoFile'];
    for (var i = 0; i < fields.length; i++) {
      var v = tenantData[fields[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  function pickTenantName(tenantData, tenantId) {
    if (tenantData && typeof tenantData === 'object') {
      var n =
        tenantData.displayName ||
        tenantData.name ||
        tenantData.title ||
        '';
      if (n && String(n).trim()) return String(n).trim();
    }
    return normalizeString(tenantId) || 'Kurum';
  }

  function resolveLogoUrl(tenantId, tenantData) {
    var raw = pickLogoRaw(tenantData);
    if (raw) {
      if (/^https?:\/\//i.test(raw)) return raw;
      var normalized = raw.replace(/^\/+/, '').replace(/^\.\/+/, '');
      normalized = normalized.replace(/^mobile_app\/src\//i, '').replace(/^src\//i, '');
      if (/^assets\//i.test(normalized)) return '/' + normalized;
      if (/^tenant-logos\//i.test(normalized)) return '/assets/' + normalized;
      return '/' + normalized;
    }
    var tid = normalizeString(tenantId);
    if (tid) return DEFAULT_TENANT_LOGO_PREFIX + tid + '.png';
    return DEFAULT_SA_LOGO;
  }

  function getMonogram(name, tenantId) {
    var n = normalizeString(name);
    if (n) return n.charAt(0).toLocaleUpperCase('tr-TR');
    var tid = normalizeString(tenantId);
    if (tid) return tid.charAt(0).toLocaleUpperCase('tr-TR');
    return 'K';
  }

  /**
   * Fresh branding from verified tenantId (not dropdown trust).
   */
  async function loadTenantBranding(tenantId) {
    var tid = normalizeString(tenantId);
    var result = {
      tenantId: tid,
      tenantName: tid === PLATFORM_TENANT_ID ? 'Sürücü Akademisi' : tid || 'Kurum',
      logoUrl: tid === PLATFORM_TENANT_ID ? DEFAULT_SA_LOGO : DEFAULT_TENANT_LOGO_PREFIX + (tid || PLATFORM_TENANT_ID) + '.png',
      showInstitutionLogo: true,
      monogram: 'S'
    };

    if (!tid) {
      result.logoUrl = DEFAULT_SA_LOGO;
      result.tenantName = 'Sürücü Akademisi';
      return result;
    }

    var db = getDb();
    if (!db) {
      result.monogram = getMonogram(result.tenantName, tid);
      return result;
    }

    try {
      var snap = await db.collection('tenants').doc(tid).get();
      var data = snap.exists ? snap.data() || {} : {};
      result.tenantName = pickTenantName(data, tid);
      result.logoUrl = resolveLogoUrl(tid, data);
      result.monogram = getMonogram(result.tenantName, tid);
    } catch (e) {
      console.warn('[machine-web-session] tenant read failed', e);
      result.monogram = getMonogram(result.tenantName, tid);
    }

    try {
      var settingsSnap = await db.collection('tenantSettings').doc(tid).get();
      if (settingsSnap.exists && settingsSnap.data()) {
        result.showInstitutionLogo = settingsSnap.data().showInstitutionLogo !== false;
      }
    } catch (e2) {
      /* keep default show */
    }

    return result;
  }

  function applyLogoWithFallback(imgEl, monogramEl, primaryUrl, fallbackUrls, altText, monogramChar) {
    if (!imgEl) return;
    var candidates = [];
    var seen = {};
    function push(u) {
      var s = normalizeString(u);
      if (!s || seen[s]) return;
      seen[s] = true;
      candidates.push(s);
    }
    push(primaryUrl);
    (fallbackUrls || []).forEach(push);
    push(DEFAULT_SA_LOGO);

    imgEl.alt = altText || 'Logo';
    var index = 0;

    function failToMonogram() {
      imgEl.hidden = true;
      imgEl.removeAttribute('src');
      if (monogramEl) {
        monogramEl.hidden = false;
        monogramEl.textContent = monogramChar || 'K';
      }
    }

    function tryNext() {
      if (index >= candidates.length) {
        failToMonogram();
        return;
      }
      var url = candidates[index++];
      imgEl.onload = function () {
        imgEl.hidden = false;
        imgEl.style.display = '';
        if (monogramEl) monogramEl.hidden = true;
      };
      imgEl.onerror = function () {
        tryNext();
      };
      imgEl.hidden = false;
      imgEl.src = url;
    }

    if (monogramEl) monogramEl.hidden = true;
    tryNext();
  }

  async function logoutMachine() {
    clearMachineSession();
    var auth = getAuth();
    if (auth && typeof auth.signOut === 'function') {
      try {
        await auth.signOut();
      } catch (e) {
        console.warn('[machine-web-session] signOut failed', e);
      }
    }
  }

  window.SA_MACHINE_WEB_SESSION = {
    MACHINE_SESSION_KEY: MACHINE_SESSION_KEY,
    PROGRAM_TYPE: PROGRAM_TYPE,
    PLATFORM_TENANT_ID: PLATFORM_TENANT_ID,
    DEFAULT_SA_LOGO: DEFAULT_SA_LOGO,
    saveMachineSession: saveMachineSession,
    getMachineSession: getMachineSession,
    clearMachineSession: clearMachineSession,
    requireMachineSession: requireMachineSession,
    loadTenantBranding: loadTenantBranding,
    applyLogoWithFallback: applyLogoWithFallback,
    getMonogram: getMonogram,
    logoutMachine: logoutMachine
  };
})();
