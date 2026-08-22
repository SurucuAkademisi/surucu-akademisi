/*
Canonical active runtime login for mobile_app (index.html loads ./js/login.js).
Tenant selection foundation: selectedTenantId, storage fallback, bootstrap after login.
*/
(function () {
  'use strict';

  const SELECTED_TENANT_STORAGE_KEY = 'sa_selected_tenant_id';
  let tenantBootstrapModulesPromise = null;

  /**
   * AUTH CORRECTIVE — mark controlled institution-login validation signOut so
   * onAuthStateChanged(null) stays on Driving login instead of program select.
   * In-memory one-shot only; never persisted.
   */
  function markDrivingInstitutionLoginAuthNullRoute() {
    try {
      window.__saAuthNullRouteIntent = 'driving_institution_login';
    } catch (_) {}
  }

  function getSelectedTenantIdFromStorage() {
    try {
      const v = sessionStorage.getItem(SELECTED_TENANT_STORAGE_KEY);
      return typeof v === 'string' ? v.trim() || null : null;
    } catch { return null; }
  }

  async function loadTenantBootstrapModules() {
    if (!tenantBootstrapModulesPromise) {
      tenantBootstrapModulesPromise = Promise.all([
        import('./tenant-context.resolver.js'),
        import('./tenant-session.store.js'),
      ]);
    }
    return tenantBootstrapModulesPromise;
  }

  async function tryBootstrapTenantSessionFromUser(user, selectedTenantId = null) {
    if (!user || !user.uid) return;
    try {
      const [resolverModule, sessionModule] = await loadTenantBootstrapModules();
      let tenantId = selectedTenantId || getSelectedTenantIdFromStorage();
      // Driving bootstrap must not adopt a Machine-only membership as institution context.
      if (tenantId) {
        try {
          const mem = await getActiveMembershipForTenant(user.uid, tenantId);
          const cls = classifyMembershipForDriving(mem);
          if (cls.kind === 'NON_DRIVING_MEMBERSHIP') {
            try { await clearInstitutionTenantState(); } catch (_) {}
            tenantId = null;
          }
        } catch (_) {}
      }
      const context = await resolverModule.resolveTenantContext(user, tenantId);
      sessionModule.setActiveTenantSession(context);
      if (context && context.tenantId && window.SA_TENANT && typeof window.SA_TENANT.setSelectedTenantId === 'function') {
        window.SA_TENANT.setSelectedTenantId(context.tenantId);
      }
      try {
        const adPolicy = await import('./ad-policy.resolver.js');
        await adPolicy.refreshAdPolicyForCurrentUser(user);
      } catch (adErr) {
        console.warn('[AdPolicy] refresh after tenant bootstrap failed:', adErr);
      }
    } catch (error) {
      console.warn('Tenant context bootstrap atlandi:', error);
    }
  }

  function normalizeUsername(input) {
    return String(input || '').trim().toLowerCase();
  }

  function usernameOrEmailToEmail(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    if (raw.includes('@')) return raw.toLowerCase();
    const normalized = normalizeUsername(raw);
    return normalized ? (normalized + '@surucu.app') : '';
  }

  function remainingDaysFromMillis(expiresAtMs) {
    const diff = Number(expiresAtMs || 0) - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  function setRemainingDaysBadge(days) {
    // İstenilen değişiklik: "Kalan Gün Sayısı" ibaresi ve elementi tamamen kaldırıldı.
    // Artık badge oluşturulmayacak ve gösterilmeyecek.
  }

  function clearRemainingDaysBadge() {
    const badge = document.getElementById('student-remaining-days');
    if (badge) badge.remove();
  }

  function mapAuthErrorToMessage(error) {
    const code = (error && error.code) ? String(error.code) : '';
    const message = (error && error.message) ? String(error.message) : '';

    if (code === 'auth/invalid-email') return 'Geçersiz kullanıcı adı.';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-login-credentials') {
      return 'Kullanıcı adı veya şifre hatalı.';
    }
    if (message.includes('INVALID_LOGIN_CREDENTIALS')) return 'Kullanıcı adı veya şifre hatalı.';
    if (code === 'auth/too-many-requests') return 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.';
    return 'Giriş başarısız.';
  }

  function mapSignupErrorToMessage(error) {
    const code = (error && error.code) ? String(error.code) : '';
    if (code === 'auth/invalid-email') return 'Geçersiz e-posta adresi.';
    if (code === 'auth/email-already-in-use') return 'Bu e-posta ile kayıtlı bir hesap zaten var.';
    if (code === 'auth/weak-password') return 'Şifre en az 6 karakter olmalıdır.';
    if (code === 'auth/operation-not-allowed') return 'E-posta/şifre kaydı şu anda kapalı.';
    return 'Hesap oluşturulamadı.';
  }

  function mapGoogleAuthErrorToMessage(error) {
    const code = (error && error.code) ? String(error.code) : '';
    const message = (error && error.message) ? String(error.message) : '';
    if (code === 'auth/popup-closed-by-user') return 'Google giriş işlemi iptal edildi.';
    if (code === 'auth/cancelled-popup-request') return 'Google giriş işlemi iptal edildi.';
    if (code === 'auth/popup-blocked') return 'Google giriş işlemi engellendi.';
    if (code === 'auth/operation-not-supported-in-this-environment') return 'Google giriş bu ortamda desteklenmiyor.';
    if (code === 'auth/account-exists-with-different-credential') return 'Bu e-posta farklı bir giriş yöntemiyle kayıtlı.';
    if (code === '10' || message.includes('DEVELOPER_ERROR') || message.includes('10:')) {
      return 'Google yapılandırması eksik/hatalı (DEVELOPER_ERROR). Firebase Android OAuth istemcisi ve default_web_client_id kontrol edin.';
    }
    if (message.includes('default_web_client_id') || message.includes('WILL_BE_OVERRIDDEN')) {
      return 'Google yapılandırması eksik: default_web_client_id bulunamadı. Firebase google-services.json dosyasını Web OAuth istemcisi ile yeniden indirin.';
    }
    return 'Google ile giriş başarısız.';
  }

  function mapMicrosoftAuthErrorToMessage(error) {
    const code = (error && error.code) ? String(error.code) : '';
    const message = (error && error.message) ? String(error.message) : '';
    if (code === 'auth/popup-closed-by-user') return 'Microsoft giriş işlemi iptal edildi.';
    if (code === 'auth/cancelled-popup-request') return 'Microsoft giriş işlemi iptal edildi.';
    if (code === 'auth/popup-blocked') return 'Microsoft giriş işlemi engellendi.';
    if (code === 'auth/operation-not-supported-in-this-environment') return 'Microsoft giriş bu ortamda desteklenmiyor.';
    if (code === 'auth/account-exists-with-different-credential') return 'Bu e-posta farklı bir giriş yöntemiyle kayıtlı.';
    if (code === 'auth/operation-not-allowed' || message.includes('OPERATION_NOT_ALLOWED')) {
      return 'Microsoft sağlayıcısı Firebase Console\'da etkin değil. Authentication > Sign-in method > Microsoft sağlayıcısını etkinleştirin ve OAuth bilgilerini girin.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/invalid-oauth-client-id' || message.includes('AADSTS') || message.includes('invalid_client')) {
      return 'Microsoft OAuth yapılandırması eksik/hatalı. Firebase Console\'daki Microsoft sağlayıcı Client ID/Secret ve Azure redirect URI ayarlarını kontrol edin.';
    }
    if (code === 'auth/unauthorized-domain') {
      return 'Yetkisiz alan adı. Firebase Console > Authentication > Settings > Authorized domains bölümüne gerekli domain eklenmeli.';
    }
    return 'Microsoft ile giriş başarısız.';
  }

  function getNativeFirebaseAuthPlugin() {
    return window.Capacitor?.Plugins?.FirebaseAuthentication || null;
  }

  const MS_AUTH_PENDING_STORAGE_KEY = 'sa_ms_auth_pending_v1';
  const MS_PENDING_STORAGE_KEY = 'ms_auth_pending_v1';
  const MS_CLIENT_ID = '06db8e75-24b1-42a3-9d43-a323a092cf4c';
  const MS_OAUTH_AUTHORITY_BASE = 'https://login.microsoftonline.com';
  const MS_OAUTH_TENANT = 'common';
  const MS_OAUTH_AUTHORIZE_PATH = '/oauth2/v2.0/authorize';
  const MS_OAUTH_REDIRECT_URI = 'surucuakademisi://auth/microsoft/callback';
  const MS_OAUTH_RESPONSE_TYPE = 'code';
  const MS_OAUTH_RESPONSE_MODE = 'query';
  const MS_OAUTH_SCOPES = ['openid', 'profile', 'email'];
  const MS_EXCHANGE_FUNCTION_URL_DEFAULT = 'https://us-central1-surucuakademisi-f5e1f.cloudfunctions.net/microsoftExchange';
  const MS_AUTH_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
  let __msAuthCallbackConsumeInFlight = false;

  function getMicrosoftOAuthClientId() {
    return typeof MS_CLIENT_ID === 'string' ? MS_CLIENT_ID.trim() : '';
  }

  function base64UrlEncode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomBase64Url(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  }

  async function sha256Base64Url(input) {
    const subtle = crypto && crypto.subtle ? crypto.subtle : null;
    if (!subtle || typeof subtle.digest !== 'function') {
      throw new Error('PKCE için gerekli crypto.subtle API bulunamadı.');
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(String(input || ''));
    const digest = await subtle.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(digest));
  }

  function persistMicrosoftAuthPending(payload) {
    window.__msAuthPending = payload;
    try {
      sessionStorage.setItem(MS_AUTH_PENDING_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {}
    try {
      localStorage.setItem(MS_PENDING_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function loadMicrosoftAuthPending() {
    if (window.__msAuthPending && typeof window.__msAuthPending === 'object') return window.__msAuthPending;
    try {
      const raw = sessionStorage.getItem(MS_AUTH_PENDING_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          window.__msAuthPending = parsed;
          return parsed;
        }
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(MS_PENDING_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      window.__msAuthPending = parsed;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function clearMicrosoftAuthPending() {
    window.__msAuthPending = null;
    try { sessionStorage.removeItem(MS_AUTH_PENDING_STORAGE_KEY); } catch (_) {}
    try { localStorage.removeItem(MS_PENDING_STORAGE_KEY); } catch (_) {}
  }

  function clearMicrosoftCallbackPayload() {
    try { window.__msAuthCallbackPayload = null; } catch (_) {}
  }

  function getMicrosoftExchangeFunctionUrl() {
    try {
      const override = window && typeof window.SA_MICROSOFT_EXCHANGE_URL === 'string'
        ? window.SA_MICROSOFT_EXCHANGE_URL.trim()
        : '';
      if (override) return override;
    } catch (_) {}
    return MS_EXCHANGE_FUNCTION_URL_DEFAULT;
  }

  function buildMicrosoftAuthorizeUrl(params) {
    const base = MS_OAUTH_AUTHORITY_BASE + '/' + encodeURIComponent(MS_OAUTH_TENANT) + MS_OAUTH_AUTHORIZE_PATH;
    const qs = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      response_type: MS_OAUTH_RESPONSE_TYPE,
      redirect_uri: params.redirectUri,
      response_mode: MS_OAUTH_RESPONSE_MODE,
      scope: params.scopes.join(' '),
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256'
    });
    return base + '?' + qs.toString();
  }

  async function openExternalAuthUrl(url) {
    window.location.href = String(url);
  }

  function trimIdentityString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isValidInternalUsername(name) {
    if (!name) return false;
    const n = String(name).trim();
    if (n.length < 3 || n.length > 20) return false;
    return /^[a-zA-Z0-9_]+$/.test(n);
  }

  function buildGoogleUsernameSlug(user, existingData) {
    const data = existingData || {};
    const existing = trimIdentityString(data.username);
    if (isValidInternalUsername(existing)) return null;
    const authDn = trimIdentityString(user && user.displayName);
    const emailLocal = trimIdentityString(user && user.email).split('@')[0] || '';
    let base = authDn || emailLocal || 'user';
    base = base
      .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
      .replace(/ü/g, 'u').replace(/Ü/g, 'U')
      .replace(/ş/g, 's').replace(/Ş/g, 'S')
      .replace(/ı/g, 'i').replace(/İ/g, 'I')
      .replace(/ö/g, 'o').replace(/Ö/g, 'O')
      .replace(/ç/g, 'c').replace(/Ç/g, 'C');
    base = base.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (base.length > 20) base = base.slice(0, 20);
    if (base.length < 3) {
      const idPart = String(user && user.uid ? user.uid : '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toLowerCase();
      base = 'uye_' + (idPart || 'user');
    }
    if (base.length > 20) base = base.slice(0, 20);
    return isValidInternalUsername(base) ? base : null;
  }

  async function ensureGoogleUserProfile(user) {
    if (!user || !user.uid) return;

    const email = String(user.email || '').trim().toLowerCase();
    const userRef = firebase.firestore().collection('users').doc(user.uid);
    const snap = await userRef.get();
    const existing = snap.exists ? (snap.data() || {}) : {};
    const patch = {
      uid: user.uid,
      email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!snap.exists) {
      patch.role = 'student';
      patch.isActive = true;
      patch.signupSource = 'google';
      patch.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    const authDisplayName = trimIdentityString(user.displayName);
    if (authDisplayName) {
      if (!trimIdentityString(existing.displayName)) patch.displayName = authDisplayName;
      if (!trimIdentityString(existing.fullName)) patch.fullName = authDisplayName;
    }

    const photoURL = trimIdentityString(user.photoURL);
    if (photoURL && !trimIdentityString(existing.photoUrl || existing.photoURL)) {
      patch.photoUrl = photoURL;
    }

    const slug = buildGoogleUsernameSlug(user, existing);
    if (slug) patch.username = slug;

    try {
      await userRef.set(patch, { merge: true });
    } catch (e) {
      console.warn('[UsernameGate] Google profile merge skipped', e);
    }
  }

  function isAppleSignInCancelled(error) {
    const code = String((error && error.code) || '').trim().toLowerCase();
    const message = String((error && error.message) || '').trim().toLowerCase();
    if (code === 'apple_signin_cancelled' || code === '1001') return true;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return true;
    if (message.includes('error 1001') || message.includes('authorizationerror error 1001')) return true;
    if (message.includes('com.apple.authenticationservices.authorizationerror') && (message.includes('1001') || message.includes('canceled') || message.includes('cancelled'))) return true;
    if (message.includes('the user canceled') || message.includes('the user cancelled')) return true;
    return false;
  }

  function mapAppleAuthErrorToMessage(error) {
    const code = (error && error.code) ? String(error.code) : '';
    if (isAppleSignInCancelled(error) || code === 'APPLE_SIGNIN_CANCELLED') return '';
    if (code === 'auth/account-exists-with-different-credential') return 'Bu e-posta farklı bir giriş yöntemiyle kayıtlı.';
    if (code === 'auth/network-request-failed' || code === 'auth/unavailable' || code === 'unavailable') {
      return 'Bağlantı kurulamadı. Lütfen tekrar deneyin.';
    }
    return 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
  }

  function throwAppleCancelled() {
    const err = new Error('');
    err.code = 'APPLE_SIGNIN_CANCELLED';
    err.userMessage = '';
    throw err;
  }

  async function ensureAppleUserProfile(user, nativeDisplayName) {
    if (!user || !user.uid) return;

    const userRef = firebase.firestore().collection('users').doc(user.uid);
    const snap = await userRef.get();
    const existing = snap.exists ? (snap.data() || {}) : {};
    const patch = {
      uid: user.uid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!snap.exists) {
      patch.role = 'student';
      patch.isActive = true;
      patch.signupSource = 'apple';
      patch.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    const nextEmail = String(user.email || '').trim().toLowerCase();
    const existingEmail = String(existing.email || '').trim().toLowerCase();
    if (nextEmail && !existingEmail) {
      patch.email = nextEmail;
    }

    const nextName = trimIdentityString(nativeDisplayName) || trimIdentityString(user.displayName);
    if (nextName) {
      if (!trimIdentityString(existing.displayName)) patch.displayName = nextName;
      if (!trimIdentityString(existing.fullName)) patch.fullName = nextName;
    }

    const slugIdentity = {
      uid: user.uid,
      email: nextEmail || existingEmail,
      displayName: nextName || trimIdentityString(existing.displayName) || trimIdentityString(existing.fullName)
    };
    const slug = buildGoogleUsernameSlug(slugIdentity, existing);
    if (slug) patch.username = slug;

    try {
      await userRef.set(patch, { merge: true });
    } catch (e) {
      console.warn('[UsernameGate] Apple profile merge skipped', e);
    }
  }

  async function ensureMicrosoftUserProfile(user) {
    if (!user || !user.uid) return;

    const email = String(user.email || '').trim().toLowerCase();
    const username = (email.split('@')[0] || '').trim();
    const userRef = firebase.firestore().collection('users').doc(user.uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      await userRef.set({
        uid: user.uid,
        email,
        username,
        role: 'student',
        isActive: true,
        signupSource: 'microsoft',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  }

  async function validateStudentAccess(user) {
    if (!user || !user.uid) {
      return { ok: false, userMessage: 'Giriş başarısız.' };
    }

    try {
      const userRef = firebase.firestore().collection('users').doc(user.uid);
      const snap = await userRef.get();
      if (!snap.exists) {
        const email = String(user.email || '').trim().toLowerCase();
        const username = (email.split('@')[0] || '').trim();
        const signupSource = (Array.isArray(user.providerData) && user.providerData.some(p => p && p.providerId === 'google.com'))
          ? 'google'
          : 'email_password';

        await userRef.set({
          uid: user.uid,
          email,
          username,
          role: 'student',
          isActive: true,
          signupSource,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      clearRemainingDaysBadge();
      return { ok: true };
    } catch (e) {
      try {
        console.error('[Auth] validateStudentAccess failed:', {
          code: e && e.code ? String(e.code) : null,
          message: e && e.message ? String(e.message) : null,
          uid: user && user.uid ? String(user.uid) : null
        }, e);
      } catch (_) {}
      try { await firebase.auth().signOut(); } catch (_) {}
      clearRemainingDaysBadge();
      const code = (e && e.code) ? String(e.code) : '';
      if (code === 'permission-denied') return { ok: false, userMessage: 'Erişim izni yok (permission-denied). Lütfen destek ile iletişime geçin.' };
      if (code === 'unauthenticated') return { ok: false, userMessage: 'Oturum doğrulanamadı (unauthenticated). Lütfen tekrar giriş yapın.' };
      if (code === 'unavailable') return { ok: false, userMessage: 'Bağlantı sorunu (unavailable). İnternetinizi kontrol edip tekrar deneyin.' };
      return { ok: false, userMessage: 'Giriş başarısız.' };
    }
  }

  function normalizeMembershipRole(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function isInstructorMembership(membership) {
    return normalizeMembershipRole(membership && membership.role) === 'instructor';
  }

  function isStudentMembershipRole(membership) {
    return normalizeMembershipRole(membership && membership.role) === 'student';
  }

  /**
   * Membership for tenant regardless of status (active/suspended).
   */
  async function getMembershipForTenant(uid, tenantId) {
    if (!uid || !tenantId || typeof firebase === 'undefined' || !firebase.firestore) return null;
    const tid = String(tenantId).trim();
    const db = firebase.firestore();
    try {
      const snap = await db.collection('tenantMemberships').where('uid', '==', uid).get();
      if (!snap || !snap.docs) return null;
      for (var i = 0; i < snap.docs.length; i++) {
        const d2 = snap.docs[i].data() || {};
        if ((d2.tenantId || '').trim() === tid) {
          return Object.assign({ id: snap.docs[i].id }, d2);
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function getUserDocData(uid) {
    if (!uid || typeof firebase === 'undefined' || !firebase.firestore) return null;
    try {
      const snap = await firebase.firestore().collection('users').doc(uid).get();
      if (!snap || !snap.exists) return null;
      return snap.data() || {};
    } catch (_) {
      return null;
    }
  }

  /**
   * Canonical institution persona after Auth + selected tenant.
   * Role check BEFORE student Driving programType assumptions.
   */
  async function resolveInstitutionSessionPersona(user, tenantId) {
    const uid = user && user.uid ? String(user.uid) : '';
    const tid = String(tenantId || '').trim();
    if (!uid || !tid) {
      return {
        ok: false,
        persona: null,
        userMessage: 'Lütfen giriş yapmadan önce kurumunuzu seçin.',
        code: 'tenant_required'
      };
    }

    const membership = await getMembershipForTenant(uid, tid);
    if (!membership) {
      return {
        ok: false,
        persona: null,
        userMessage: 'Bu kuruma kayıtlı değilsiniz. Kurumunuzla iletişime geçin.',
        code: 'membership_missing'
      };
    }

    if (String(membership.tenantId || '').trim() !== tid) {
      return {
        ok: false,
        persona: null,
        userMessage: 'Bu kuruma kayıtlı değilsiniz. Kurumunuzla iletişime geçin.',
        code: 'tenant_mismatch'
      };
    }

    const memRole = normalizeMembershipRole(membership.role);
    const memStatus = String(membership.status || '').trim().toLowerCase();
    const userData = await getUserDocData(uid);
    const userRole = normalizeMembershipRole(userData && userData.role);

    if (memStatus !== 'active') {
      if (memRole === 'instructor') {
        return {
          ok: false,
          persona: 'instructor',
          membership: membership,
          userData: userData,
          userMessage: 'Direksiyon Usta Öğretici hesabınız aktif değil. Lütfen kurum yöneticinizle iletişime geçin.',
          code: 'inactive_instructor'
        };
      }
      return {
        ok: false,
        persona: memRole || null,
        membership: membership,
        userData: userData,
        userMessage: 'Hesabınız aktif değil. Lütfen kurum yöneticinizle iletişime geçin.',
        code: 'inactive_membership'
      };
    }

    if (!memRole || !userRole || memRole !== userRole) {
      return {
        ok: false,
        persona: null,
        membership: membership,
        userData: userData,
        userMessage: 'Hesap rolü doğrulanamadı. Lütfen kurum yöneticinizle iletişime geçin.',
        code: 'role_mismatch'
      };
    }

    if (memRole === 'instructor') {
      return {
        ok: true,
        persona: 'instructor',
        membership: membership,
        userData: userData,
        code: 'instructor'
      };
    }

    if (memRole === 'student') {
      return {
        ok: true,
        persona: 'student',
        membership: membership,
        userData: userData,
        code: 'student'
      };
    }

    return {
      ok: false,
      persona: null,
      membership: membership,
      userData: userData,
      userMessage: 'Hesap rolü doğrulanamadı. Lütfen kurum yöneticinizle iletişime geçin.',
      code: 'unsupported_role'
    };
  }

  /**
   * Kurum (institution) girişi için: seçilen tenant'ta kullanıcının active membership dokümanını döner.
   * Sadece e-posta/şifre kurum girişinde / driving guard yollarında kullanılır.
   */
  async function getActiveMembershipForTenant(uid, tenantId) {
    const membership = await getMembershipForTenant(uid, tenantId);
    if (!membership) return null;
    if (String(membership.status || '').trim().toLowerCase() !== 'active') return null;
    return membership;
  }

  async function checkTenantMembership(uid, tenantId) {
    const membership = await getActiveMembershipForTenant(uid, tenantId);
    const hasActive = !!membership;
    return hasActive;
  }

  const MSG_MACHINE_REQUIRES_MACHINE_ENTRY =
    'Bu hesap İş Makineleri Aday Girişi için tanımlıdır. Lütfen modül seçiminden İş Makineleri bölümünü kullanın.';
  const MSG_MACHINE_REQUIRES_RELOGIN =
    'Bu hesap İş Makineleri Aday Girişi için tanımlıdır. Lütfen kurumunuzu seçerek yeniden giriş yapın.';

  function normalizeMembershipProgramType(value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (v === 'machine_operator') return 'machine_operator';
    if (v === 'driving_license') return 'driving_license';
    // Legacy / missing → Driving (existing convention).
    return 'driving_license';
  }

  function isDrivingProgramMembership(membership) {
    if (!membership || typeof membership !== 'object') return false;
    // Instructor memberships must never be treated as student Driving context
    // (missing programType must NOT normalize into Driving student behavior).
    if (isInstructorMembership(membership)) return false;
    return normalizeMembershipProgramType(membership.programType) !== 'machine_operator';
  }

  /**
   * Classify membership for Driving entry.
   * Machine membership is NOT an error and MUST NOT block Driving UID access;
   * it also MUST NOT be treated as Driving institution context.
   * Instructor membership is NOT Driving student context.
   */
  function classifyMembershipForDriving(membership) {
    if (!membership || typeof membership !== 'object') {
      return { ok: true, kind: 'NONE', membership: null, programType: null };
    }
    if (isInstructorMembership(membership)) {
      return {
        ok: true,
        kind: 'INSTRUCTOR_MEMBERSHIP',
        membership: membership,
        programType: null
      };
    }
    const programType = normalizeMembershipProgramType(membership.programType);
    if (programType === 'machine_operator') {
      return {
        ok: true,
        kind: 'NON_DRIVING_MEMBERSHIP',
        membership: membership,
        programType: 'machine_operator'
      };
    }
    return {
      ok: true,
      kind: 'DRIVING_MEMBERSHIP',
      membership: membership,
      programType: programType
    };
  }

  /**
   * Driving-entry classification (no throw for machine_operator).
   * Callers must not bootstrap NON_DRIVING_MEMBERSHIP as Driving tenant context.
   */
  function assertDrivingCompatibleMembership(membership) {
    const cls = classifyMembershipForDriving(membership);
    if (cls.kind === 'NONE') {
      return { ok: true, kind: 'NONE', programType: 'driving_license', membership: null };
    }
    return {
      ok: true,
      kind: cls.kind,
      programType: cls.programType,
      membership: cls.membership
    };
  }

  async function assertDrivingCompatibleTenantMembership(uid, tenantId) {
    const membership = await getActiveMembershipForTenant(uid, tenantId);
    if (!membership) return { ok: false, kind: 'NONE', membership: null };
    const cls = assertDrivingCompatibleMembership(membership);
    if (cls.kind === 'NON_DRIVING_MEMBERSHIP') {
      return { ok: false, kind: 'NON_DRIVING_MEMBERSHIP', membership: membership, programType: 'machine_operator' };
    }
    if (cls.kind === 'INSTRUCTOR_MEMBERSHIP') {
      return { ok: false, kind: 'INSTRUCTOR_MEMBERSHIP', membership: membership, programType: null };
    }
    return { ok: true, kind: 'DRIVING_MEMBERSHIP', membership: membership, programType: cls.programType };
  }

  /**
   * Restored Driving session: Machine-only selected tenant is sanitized (ignored),
   * not a global sign-out / "use Machine module" rejection.
   */
  async function assertRestoredSessionDrivingCompatible(user) {
    if (!user || !user.uid) return { ok: true };
    const tenantId = (window.SA_TENANT && typeof window.SA_TENANT.getSelectedTenantId === 'function')
      ? window.SA_TENANT.getSelectedTenantId()
      : null;
    if (!tenantId) return { ok: true };
    try {
      const membership = await getActiveMembershipForTenant(user.uid, tenantId);
      if (!membership) return { ok: true };
      const cls = assertDrivingCompatibleMembership(membership);
      if (cls.kind === 'INSTRUCTOR_MEMBERSHIP') {
        // Instructor restore is handled by persona branch; do not sanitize or force student path.
        return { ok: true, kind: 'INSTRUCTOR_MEMBERSHIP' };
      }
      if (cls.kind === 'NON_DRIVING_MEMBERSHIP') {
        try { await clearInstitutionTenantState(); } catch (_) {}
        return { ok: true, sanitized: true, kind: 'NON_DRIVING_MEMBERSHIP' };
      }
      return { ok: true, kind: 'DRIVING_MEMBERSHIP' };
    } catch (e) {
      return {
        ok: false,
        userMessage: (e && e.userMessage) ? String(e.userMessage) : 'Giriş başarısız.',
        code: (e && (e.machineCode || e.code)) ? String(e.machineCode || e.code) : 'restore_failed'
      };
    }
  }

  /** Active Driving institution tenantIds only (machine_operator + instructor excluded). */
  async function getActiveDrivingTenantIdsForUser(uid) {
    if (!uid || typeof firebase === 'undefined' || !firebase.firestore) return [];
    try {
      const snap = await firebase.firestore().collection('tenantMemberships').where('uid', '==', uid).get();
      if (!snap || !snap.docs) return [];
      return snap.docs
        .map((d) => {
          const x = d.data() || {};
          if ((x.status || '') !== 'active' || !x.tenantId) return null;
          if (isInstructorMembership(x)) return null;
          if (!isDrivingProgramMembership(x)) return null;
          return x.tenantId;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Active instructor institution tenantIds only. */
  async function getActiveInstructorTenantIdsForUser(uid) {
    if (!uid || typeof firebase === 'undefined' || !firebase.firestore) return [];
    try {
      const snap = await firebase.firestore().collection('tenantMemberships').where('uid', '==', uid).get();
      if (!snap || !snap.docs) return [];
      return snap.docs
        .map((d) => {
          const x = d.data() || {};
          if ((x.status || '') !== 'active' || !x.tenantId) return null;
          if (!isInstructorMembership(x)) return null;
          return x.tenantId;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Driving finalize helper: if selected tenant is Machine-only, clear it for Driving
   * and optionally require kurum when other Driving memberships exist.
   * Returns { continuePublic: boolean } or throws after signOut when Driving kurum required.
   */
  async function resolveDrivingTenantSelectionOrThrow(user) {
    const selectedTenantId = getSelectedTenantIdFromStorage();
    if (!selectedTenantId) {
      const drivingTenantIds = await getActiveDrivingTenantIdsForUser(user.uid);
      return {
        selectedTenantId: null,
        drivingTenantIds: drivingTenantIds,
        membership: null,
        kind: 'NONE'
      };
    }

    const membership = await getActiveMembershipForTenant(user.uid, selectedTenantId);
    const cls = assertDrivingCompatibleMembership(membership);
    if (cls.kind === 'NON_DRIVING_MEMBERSHIP') {
      try { await clearInstitutionTenantState(); } catch (_) {}
      const drivingTenantIds = await getActiveDrivingTenantIdsForUser(user.uid);
      return {
        selectedTenantId: null,
        drivingTenantIds: drivingTenantIds,
        membership: membership,
        kind: 'NON_DRIVING_MEMBERSHIP',
        machineIgnored: true
      };
    }
    if (cls.kind === 'DRIVING_MEMBERSHIP') {
      return {
        selectedTenantId: selectedTenantId,
        drivingTenantIds: [selectedTenantId],
        membership: membership,
        kind: 'DRIVING_MEMBERSHIP'
      };
    }
    return {
      selectedTenantId: selectedTenantId,
      drivingTenantIds: await getActiveDrivingTenantIdsForUser(user.uid),
      membership: null,
      kind: 'NONE'
    };
  }

  function resolveDrivingEnrollmentSource(kindOrSource) {
    const v = String(kindOrSource == null ? '' : kindOrSource).trim().toLowerCase();
    if (v === 'institution' || v === 'driving_membership') return 'institution';
    return 'public';
  }

  /**
   * Persist Driving program participation on users/{uid}.
   * Writes ONLY nested programEnrollments.driving_license via update() FieldPath.
   * Also reads legacy literal top-level "programEnrollments.driving_license" for lazy repair.
   * Fail-soft: never blocks an otherwise successful Driving session.
   * Does NOT delete the legacy literal field in this patch.
   */
  async function ensureDrivingProgramEnrollment(user, options) {
    if (!user || !user.uid) return;
    if (typeof firebase === 'undefined' || !firebase || !firebase.firestore) return;

    var requestedSource = resolveDrivingEnrollmentSource(options && options.source);
    try {
      var userRef = firebase.firestore().collection('users').doc(String(user.uid));
      var snap = await userRef.get();
      var existing = (snap && snap.exists) ? (snap.data() || {}) : {};
      var pe = (existing.programEnrollments && typeof existing.programEnrollments === 'object')
        ? existing.programEnrollments
        : {};
      var nestedPrev = (pe.driving_license && typeof pe.driving_license === 'object')
        ? pe.driving_license
        : null;
      var literalPrev = (existing['programEnrollments.driving_license'] &&
        typeof existing['programEnrollments.driving_license'] === 'object')
        ? existing['programEnrollments.driving_license']
        : null;

      var resolvedSource = requestedSource;
      var nestedIsInstitution = !!(nestedPrev &&
        String(nestedPrev.source || '').trim().toLowerCase() === 'institution');
      var literalIsInstitution = !!(literalPrev &&
        String(literalPrev.source || '').trim().toLowerCase() === 'institution');
      if (nestedIsInstitution || literalIsInstitution) {
        resolvedSource = 'institution';
      }

      var payload = {
        status: 'active',
        source: resolvedSource,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (nestedPrev && nestedPrev.enrolledAt != null) {
        payload.enrolledAt = nestedPrev.enrolledAt;
      } else if (literalPrev && literalPrev.enrolledAt != null) {
        payload.enrolledAt = literalPrev.enrolledAt;
      } else {
        payload.enrolledAt = firebase.firestore.FieldValue.serverTimestamp();
      }

      // Compat update() interprets dotted keys as nested FieldPaths (unlike set/merge).
      // Does not replace the whole programEnrollments map — sibling keys stay safe.
      await userRef.update({
        'programEnrollments.driving_license': payload
      });
    } catch (e) {
      try {
        console.warn('[DrivingEnrollment] ensureDrivingProgramEnrollment skipped', {
          code: e && e.code ? String(e.code) : null
        });
      } catch (_) {}
    }
  }

  /** Kullanıcının aktif kurum (tenant) üyeliklerinin tenantId listesini döner. Kurumsuz kullanıcılar için []. */
  const MSG_PUBLIC_STUDENT_ACCOUNT =
    'Bu hesap kurum öğrencisi hesabıdır. Lütfen Sürücü Kursları Öğrenci Girişi bölümünden kurum seçerek giriş yapın.';
  const MSG_PUBLIC_UNSUPPORTED = 'Bu hesap mobil public giriş için uygun değil.';
  const MSG_PUBLIC_WEB_SIGNUP = 'Bireysel kayıt için web sitesindeki Kayıt Ol bölümünü kullanın.';

  function isPublicEmailLoginInput(input) {
    return String(input || '').trim().includes('@');
  }

  function buildPublicSessionFromUserDoc(user, userDoc) {
    var data = userDoc && typeof userDoc === 'object' ? userDoc : {};
    return {
      uid: user && user.uid ? String(user.uid) : '',
      email: (user && user.email) || data.email || '',
      firstName: data.firstName,
      lastName: data.lastName,
      displayName: data.displayName,
      role: 'public_user',
      accountType: data.accountType || 'public',
      savedAt: Date.now()
    };
  }

  async function clearInstitutionTenantState() {
    if (window.SA_TENANT && typeof window.SA_TENANT.clearSelectedTenantId === 'function') {
      window.SA_TENANT.clearSelectedTenantId();
    }
    try {
      const sessionModule = await import('./tenant-session.store.js');
      if (sessionModule && typeof sessionModule.clearActiveTenantSession === 'function') {
        sessionModule.clearActiveTenantSession();
      }
    } catch (e) {
      console.warn('[PublicAuth] clearInstitutionTenantState failed', e);
    }
  }

  async function refreshAdPolicyForUser(user) {
    try {
      const adPolicy = await import('./ad-policy.resolver.js');
      await adPolicy.refreshAdPolicyForCurrentUser(user);
    } catch (adErr) {
      console.warn('[PublicAuth] ad policy refresh failed:', adErr);
    }
  }

  async function validatePublicUserAccess(user) {
    if (!user || !user.uid) {
      return { ok: false, isPublicUser: false, userMessage: MSG_PUBLIC_UNSUPPORTED };
    }
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      return { ok: false, isPublicUser: false, userMessage: 'Giriş sistemi yüklenemedi.' };
    }

    try {
      const snap = await firebase.firestore().collection('users').doc(user.uid).get();
      if (!snap.exists) {
        return { ok: false, isPublicUser: false, userMessage: MSG_PUBLIC_UNSUPPORTED };
      }
      const data = snap.data() || {};
      const role = String(data.role || data.globalRole || '').trim().toLowerCase();
      if (role === 'public_user') {
        return { ok: true, isPublicUser: true, isStudent: false, userDoc: data };
      }
      if (role === 'student') {
        return {
          ok: false,
          isPublicUser: false,
          isStudent: true,
          userMessage: MSG_PUBLIC_STUDENT_ACCOUNT,
          isStudentAccount: true
        };
      }
      if (role === 'instructor') {
        return {
          ok: false,
          isPublicUser: false,
          isStudent: false,
          userMessage: MSG_PUBLIC_UNSUPPORTED
        };
      }
      return { ok: false, isPublicUser: false, isStudent: false, userMessage: MSG_PUBLIC_UNSUPPORTED };
    } catch (e) {
      console.warn('[PublicAuth] validatePublicUserAccess failed', e);
      return { ok: false, isPublicUser: false, userMessage: MSG_PUBLIC_UNSUPPORTED };
    }
  }

  async function applyPublicUserSession(user, userDoc) {
    await clearInstitutionTenantState();
    if (window.SA_PUBLIC_USER_SESSION && typeof window.SA_PUBLIC_USER_SESSION.setPublicUserSession === 'function') {
      window.SA_PUBLIC_USER_SESSION.setPublicUserSession(buildPublicSessionFromUserDoc(user, userDoc));
    }
    await refreshAdPolicyForUser(user);
  }

  async function signInAsPublicUser(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const pass = String(password || '');

    if (!normalizedEmail || !pass) {
      const err = new Error('E-posta veya şifre hatalı.');
      err.userMessage = 'E-posta veya şifre hatalı.';
      throw err;
    }

    if (typeof firebase === 'undefined' || !firebase || !firebase.auth || !firebase.firestore) {
      const err = new Error('Giriş sistemi yüklenemedi.');
      err.userMessage = 'Giriş sistemi yüklenemedi.';
      throw err;
    }

    try {
      await firebase.auth().signInWithEmailAndPassword(normalizedEmail, pass);
      const user = firebase.auth().currentUser;
      const access = await validatePublicUserAccess(user);
      if (!access.ok) {
        try { await firebase.auth().signOut(); } catch (_) {}
        if (window.SA_PUBLIC_USER_SESSION && window.SA_PUBLIC_USER_SESSION.clearPublicUserSession) {
          window.SA_PUBLIC_USER_SESSION.clearPublicUserSession();
        }
        const err = new Error(access.userMessage || MSG_PUBLIC_UNSUPPORTED);
        err.userMessage = access.userMessage || MSG_PUBLIC_UNSUPPORTED;
        if (access.isStudentAccount || access.isStudent) err.isStudentAccount = true;
        throw err;
      }
      await applyPublicUserSession(user, access.userDoc);
      return true;
    } catch (e) {
      const message = e && e.userMessage ? String(e.userMessage) : mapAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      if (e && e.isStudentAccount) err.isStudentAccount = true;
      throw err;
    }
  }

  async function bootstrapPublicUserIfAuthenticated(user) {
    if (!user || !user.uid) {
      return { ok: false, mode: 'institution' };
    }
    const access = await validatePublicUserAccess(user);
    if (!access.ok || !access.isPublicUser) {
      return { ok: false, mode: 'institution' };
    }
    await applyPublicUserSession(user, access.userDoc);
    return { ok: true, mode: 'public' };
  }

  async function getActiveTenantIdsForUser(uid) {
    if (!uid || typeof firebase === 'undefined' || !firebase.firestore) return [];
    try {
      const snap = await firebase.firestore().collection('tenantMemberships').where('uid', '==', uid).get();
      if (!snap || !snap.docs) return [];
      return snap.docs
        .map((d) => {
          const x = d.data() || {};
          return (x.status === 'active' && x.tenantId) ? x.tenantId : null;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function signIn(usernameOrEmail, password, selectedTenantId = null) {
    const rawInput = String(usernameOrEmail || '').trim();
    if (isPublicEmailLoginInput(rawInput)) {
      try {
        return await signInAsPublicUser(rawInput.toLowerCase(), password);
      } catch (publicErr) {
        // Email/password Driving individual accounts are role:student.
        // Fall through to student Driving sign-in (do not treat as Market public_user).
        const accessHint = publicErr && publicErr.userMessage
          ? String(publicErr.userMessage)
          : '';
        const isStudentAccount = accessHint === MSG_PUBLIC_STUDENT_ACCOUNT
          || !!(publicErr && publicErr.isStudentAccount);
        if (!isStudentAccount) throw publicErr;
      }
    }

    const email = usernameOrEmailToEmail(usernameOrEmail);
    const pass = String(password || '');

    if (window.SA_PUBLIC_USER_SESSION && window.SA_PUBLIC_USER_SESSION.clearPublicUserSession) {
      window.SA_PUBLIC_USER_SESSION.clearPublicUserSession();
    }

    if (!email || !pass) {
      const err = new Error('Kullanıcı adı veya şifre hatalı.');
      err.userMessage = 'Kullanıcı adı veya şifre hatalı.';
      throw err;
    }

    if (typeof firebase === 'undefined' || !firebase || !firebase.auth || !firebase.firestore) {
      const err = new Error('Giriş sistemi yüklenemedi.');
      err.userMessage = 'Giriş sistemi yüklenemedi.';
      throw err;
    }

    try {
      await firebase.auth().signInWithEmailAndPassword(email, pass);
      const user = firebase.auth().currentUser;
      const access = await validateStudentAccess(user);
      if (!access.ok) {
        const err = new Error(access.userMessage || 'Giriş başarısız.');
        err.userMessage = access.userMessage || 'Giriş başarısız.';
        throw err;
      }
      const effectiveTenantId = selectedTenantId || getSelectedTenantIdFromStorage();

      // Role resolution BEFORE student-only Driving programType assumptions.
      if (effectiveTenantId) {
        const resolved = await resolveInstitutionSessionPersona(user, effectiveTenantId);
        if (!resolved.ok) {
          markDrivingInstitutionLoginAuthNullRoute();
          await firebase.auth().signOut();
          const err = new Error(resolved.userMessage || 'Giriş başarısız.');
          err.userMessage = resolved.userMessage || 'Giriş başarısız.';
          if (resolved.code) err.code = String(resolved.code);
          throw err;
        }

        if (resolved.persona === 'instructor') {
          await tryBootstrapTenantSessionFromUser(user, selectedTenantId || effectiveTenantId);
          return { ok: true, persona: 'instructor' };
        }

        // Student branch only: existing Driving-compatible program checks.
        const membership = resolved.membership;
        const cls = assertDrivingCompatibleMembership(membership);
        if (cls.kind === 'NON_DRIVING_MEMBERSHIP') {
          try { await clearInstitutionTenantState(); } catch (_) {}
          const drivingTenantIds = await getActiveDrivingTenantIdsForUser(user.uid);
          if (drivingTenantIds.length > 0) {
            markDrivingInstitutionLoginAuthNullRoute();
            await firebase.auth().signOut();
            const err = new Error('Lütfen giriş yapmadan önce kurumunuzu seçin.');
            err.userMessage = 'Lütfen giriş yapmadan önce kurumunuzu seçin.';
            throw err;
          }
          await tryBootstrapTenantSessionFromUser(user, null);
          await ensureDrivingProgramEnrollment(user, { source: 'public' });
          return { ok: true, persona: 'student' };
        }
        if (cls.kind !== 'DRIVING_MEMBERSHIP') {
          markDrivingInstitutionLoginAuthNullRoute();
          await firebase.auth().signOut();
          const err = new Error('Bu kuruma kayıtlı değilsiniz. Kurumunuzla iletişime geçin.');
          err.userMessage = 'Bu kuruma kayıtlı değilsiniz. Kurumunuzla iletişime geçin.';
          throw err;
        }
        await tryBootstrapTenantSessionFromUser(user, selectedTenantId || effectiveTenantId);
        await ensureDrivingProgramEnrollment(user, { source: 'institution' });
        return { ok: true, persona: 'student' };
      }

      const drivingTenantIds = await getActiveDrivingTenantIdsForUser(user.uid);
      const instructorTenantIds = await getActiveInstructorTenantIdsForUser(user.uid);
      if (drivingTenantIds.length > 0 || instructorTenantIds.length > 0) {
        markDrivingInstitutionLoginAuthNullRoute();
        await firebase.auth().signOut();
        const err = new Error('Lütfen giriş yapmadan önce kurumunuzu seçin.');
        err.userMessage = 'Lütfen giriş yapmadan önce kurumunuzu seçin.';
        throw err;
      }
      await tryBootstrapTenantSessionFromUser(user, selectedTenantId);
      await ensureDrivingProgramEnrollment(user, { source: 'public' });
      return { ok: true, persona: 'student' };
    } catch (e) {
      const message = e && e.userMessage ? String(e.userMessage) : mapAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      if (e && e.code) err.code = String(e.code);
      if (e && e.machineCode) err.machineCode = String(e.machineCode);
      throw err;
    }
  }

  function normalizeIndividualFullName(input) {
    return String(input == null ? '' : input).trim().replace(/\s+/g, ' ');
  }

  function isValidIndividualResetEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || e.indexOf('@') < 0) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  /**
   * Individual email/password Firebase Auth reset.
   * Does NOT map bare usernames / TC to @surucu.app.
   */
  async function sendIndividualPasswordResetEmail(emailInput) {
    const email = String(emailInput || '').trim().toLowerCase();
    if (!isValidIndividualResetEmail(email)) {
      const err = new Error('Şifre sıfırlamak için kayıtlı e-posta adresinizi girin.');
      err.userMessage = 'Şifre sıfırlamak için kayıtlı e-posta adresinizi girin.';
      err.code = 'auth/invalid-email';
      throw err;
    }
    if (typeof firebase === 'undefined' || !firebase || !firebase.auth) {
      const err = new Error('Giriş sistemi yüklenemedi.');
      err.userMessage = 'Giriş sistemi yüklenemedi.';
      throw err;
    }
    const NEUTRAL_RESET_MSG =
      'Şifre sıfırlama bağlantısı gönderildiyse e-posta kutunuzu kontrol edin.';
    try {
      await firebase.auth().sendPasswordResetEmail(email);
      return { ok: true, userMessage: NEUTRAL_RESET_MSG };
    } catch (e) {
      const code = (e && e.code) ? String(e.code) : '';
      // Avoid account enumeration for common "missing user" outcomes.
      if (
        code === 'auth/user-not-found'
        || code === 'auth/invalid-email'
        || code === 'auth/missing-email'
      ) {
        return { ok: true, userMessage: NEUTRAL_RESET_MSG };
      }
      if (code === 'auth/too-many-requests') {
        const err = new Error('Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.');
        err.userMessage = 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.';
        err.code = code;
        throw err;
      }
      if (code === 'auth/network-request-failed') {
        const err = new Error('Bağlantı sorunu. Lütfen tekrar deneyin.');
        err.userMessage = 'Bağlantı sorunu. Lütfen tekrar deneyin.';
        err.code = code;
        throw err;
      }
      const err = new Error(NEUTRAL_RESET_MSG);
      err.userMessage = NEUTRAL_RESET_MSG;
      if (code) err.code = code;
      throw err;
    }
  }

  async function signUp(emailInput, password, fullNameInput) {
    const email = String(emailInput || '').trim().toLowerCase();
    const pass = String(password || '');
    const fullName = normalizeIndividualFullName(fullNameInput);

    if (!fullName) {
      const err = new Error('Lütfen adınızı ve soyadınızı girin.');
      err.userMessage = 'Lütfen adınızı ve soyadınızı girin.';
      throw err;
    }
    if (fullName.length < 2) {
      const err = new Error('Ad Soyad en az 2 karakter olmalıdır.');
      err.userMessage = 'Ad Soyad en az 2 karakter olmalıdır.';
      throw err;
    }
    if (fullName.length > 200) {
      const err = new Error('Ad Soyad en fazla 200 karakter olabilir.');
      err.userMessage = 'Ad Soyad en fazla 200 karakter olabilir.';
      throw err;
    }

    if (!email || email.indexOf('@') < 0 || !isValidIndividualResetEmail(email)) {
      const err = new Error('Geçerli bir e-posta adresi girin.');
      err.userMessage = 'Geçerli bir e-posta adresi girin.';
      throw err;
    }

    if (pass.length < 6) {
      const err = new Error('Şifre en az 6 karakter olmalıdır.');
      err.userMessage = 'Şifre en az 6 karakter olmalıdır.';
      throw err;
    }

    if (typeof firebase === 'undefined' || !firebase || !firebase.auth || !firebase.firestore) {
      const err = new Error('Kayıt sistemi yüklenemedi.');
      err.userMessage = 'Kayıt sistemi yüklenemedi.';
      throw err;
    }

    try {
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
      const user = cred && cred.user ? cred.user : firebase.auth().currentUser;
      if (!user || !user.uid) {
        throw new Error('Hesap oluşturulamadı.');
      }

      try {
        if (typeof user.updateProfile === 'function') {
          await user.updateProfile({ displayName: fullName });
        }
      } catch (_) {
        // Auth displayName is optional; Firestore remains the profile source.
      }

      const username = email.split('@')[0] || '';
      const userRef = firebase.firestore().collection('users').doc(user.uid);
      try {
        await userRef.set({
          uid: user.uid,
          email,
          username,
          fullName,
          displayName: fullName,
          role: 'student',
          isActive: true,
          signupSource: 'email_password',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch {
        try { await firebase.auth().signOut(); } catch {}
        const err = new Error('Hesap oluşturuldu ancak profil kaydı tamamlanamadı. Lütfen tekrar deneyin veya kurumunuzla iletişime geçin.');
        err.userMessage = 'Hesap oluşturuldu ancak profil kaydı tamamlanamadı. Lütfen tekrar deneyin veya kurumunuzla iletişime geçin.';
        throw err;
      }

      await tryBootstrapTenantSessionFromUser(user, null);
      await ensureDrivingProgramEnrollment(user, { source: 'public' });
      return { ok: true, persona: 'student' };
    } catch (e) {
      const message = (e && e.userMessage) ? String(e.userMessage) : mapSignupErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      throw err;
    }
  }

  async function signInWithGoogle() {
    if (typeof firebase === 'undefined' || !firebase || !firebase.auth || !firebase.firestore) {
      const err = new Error('Google giriş sistemi yüklenemedi.');
      err.userMessage = 'Google giriş sistemi yüklenemedi.';
      throw err;
    }

    const nativeAuth = getNativeFirebaseAuthPlugin();
    if (!nativeAuth || typeof nativeAuth.signInWithGoogle !== 'function') {
      const err = new Error('Native Google giriş eklentisi bulunamadı.');
      err.userMessage = 'Native Google giriş eklentisi bulunamadı.';
      throw err;
    }

    try {
      const isAndroidPlatform = !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
      const nativeResult = await nativeAuth.signInWithGoogle({
        skipNativeAuth: true,
        scopes: ['email', 'profile'],
        // Android only: disable Credential Manager path for stability testing.
        ...(isAndroidPlatform ? { useCredentialManager: false } : {})
      });

      const credential = (nativeResult && nativeResult.credential) ? nativeResult.credential : null;
      const idToken =
        (credential && credential.idToken ? credential.idToken : null)
        || (nativeResult && nativeResult.idToken ? nativeResult.idToken : null)
        || null;
      const accessToken =
        (credential && credential.accessToken ? credential.accessToken : null)
        || (nativeResult && nativeResult.accessToken ? nativeResult.accessToken : null)
        || null;

      if (!idToken && !accessToken) {
        const summary = {
          hasCredential: Boolean(credential),
          hasCredentialIdToken: Boolean(credential && credential.idToken),
          hasCredentialAccessToken: Boolean(credential && credential.accessToken),
          hasTopLevelIdToken: Boolean(nativeResult && nativeResult.idToken),
          hasTopLevelAccessToken: Boolean(nativeResult && nativeResult.accessToken),
          hasServerAuthCode: Boolean(credential && credential.serverAuthCode),
          credentialProviderId: credential && credential.providerId ? String(credential.providerId) : null
        };
        console.error('[GoogleAuth] Native signInWithGoogle token extraction failed:', summary);
        const err = new Error('Google kimlik doğrulama bilgisi alınamadı.');
        err.userMessage = 'Google kimlik doğrulama bilgisi alınamadı.';
        throw err;
      }

      // Presentational only: show after native chooser returns with tokens; never during chooser.
      try {
        if (window.SA_AUTH_PREPARING && typeof window.SA_AUTH_PREPARING.show === 'function') {
          window.SA_AUTH_PREPARING.show(300);
        }
      } catch (_) {}

      // accessToken opsiyonel: idToken tek başına da credential oluşturmak için yeterlidir.
      const firebaseCredential = firebase.auth.GoogleAuthProvider.credential(idToken, accessToken);
      await firebase.auth().signInWithCredential(firebaseCredential);
    } catch (e) {
      let serialized = null;
      try { serialized = JSON.stringify(e, Object.getOwnPropertyNames(e)); } catch (_) {}
      console.error('[GoogleAuth] Native sign-in stage failed:', {
        code: e && e.code ? String(e.code) : null,
        message: e && e.message ? String(e.message) : null,
        name: e && e.name ? String(e.name) : null,
        serialized
      }, e);
      const message = mapGoogleAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      throw err;
    }

    try {
      const user = firebase.auth().currentUser;
      await ensureGoogleUserProfile(user);
      const access = await validateStudentAccess(user);
      if (!access.ok) {
        const err = new Error(access.userMessage || 'Giriş başarısız.');
        err.userMessage = access.userMessage || 'Giriş başarısız.';
        throw err;
      }
      const tenantResolution = await resolveDrivingTenantSelectionOrThrow(user);
      if (!tenantResolution.selectedTenantId) {
        if (tenantResolution.drivingTenantIds && tenantResolution.drivingTenantIds.length > 0) {
          markDrivingInstitutionLoginAuthNullRoute();
          await firebase.auth().signOut();
          const err = new Error('Lütfen giriş yapmadan önce kurumunuzu seçin.');
          err.userMessage = 'Lütfen giriş yapmadan önce kurumunuzu seçin.';
          throw err;
        }
      }
      await tryBootstrapTenantSessionFromUser(user);
      await ensureDrivingProgramEnrollment(user, {
        source: (tenantResolution.kind === 'DRIVING_MEMBERSHIP' && tenantResolution.selectedTenantId)
          ? 'institution'
          : 'public'
      });
      return { ok: true };
    } catch (e) {
      const code = (e && e.code) ? String(e.code) : '';
      const rawMsg = (e && e.message) ? String(e.message) : '';
      try {
        console.error('[GoogleAuth] Post-login finalize failed:', {
          code: code || null,
          message: rawMsg || null,
          userMessage: e && e.userMessage ? String(e.userMessage) : null,
          uid: firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid ? String(firebase.auth().currentUser.uid) : null
        }, e);
      } catch (_) {}

      let message = (e && e.userMessage) ? String(e.userMessage) : '';
      if (!message) {
        if (code === 'MACHINE_ACCOUNT_REQUIRES_MACHINE_ENTRY') message = MSG_MACHINE_REQUIRES_MACHINE_ENTRY;
        else if (code === 'permission-denied') message = 'Google girişi tamamlanamadı: erişim izni yok (permission-denied).';
        else if (code === 'unauthenticated') message = 'Google girişi tamamlanamadı: oturum doğrulanamadı (unauthenticated).';
        else if (code === 'unavailable') message = 'Google girişi tamamlanamadı: bağlantı sorunu (unavailable).';
        else if (code) message = 'Google girişi tamamlanamadı (' + code + ').';
        else message = 'Google ile giriş tamamlanamadı.';
      }

      const err = new Error(message);
      err.userMessage = message;
      if (code) err.code = code;
      if (e && e.machineCode) err.machineCode = String(e.machineCode);
      err.cause = e;
      throw err;
    }
  }

  async function signInWithApple() {
    if (typeof firebase === 'undefined' || !firebase || !firebase.auth || !firebase.firestore) {
      const err = new Error('Apple ile giriş yapılamadı. Lütfen tekrar deneyin.');
      err.userMessage = 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
      throw err;
    }

    const nativeAuth = getNativeFirebaseAuthPlugin();
    if (!nativeAuth || typeof nativeAuth.signInWithApple !== 'function') {
      const err = new Error('Apple ile giriş yapılamadı. Lütfen tekrar deneyin.');
      err.userMessage = 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
      throw err;
    }

    let nativeDisplayName = '';
    try {
      const nativeResult = await nativeAuth.signInWithApple({
        skipNativeAuth: true
      });

      const credential = (nativeResult && nativeResult.credential) ? nativeResult.credential : null;
      const idToken = (credential && credential.idToken) ? String(credential.idToken) : '';
      const nonce = (credential && credential.nonce) ? String(credential.nonce) : '';
      nativeDisplayName = trimIdentityString(nativeResult && nativeResult.user && nativeResult.user.displayName);

      if (!idToken || !nonce) {
        try {
          console.error('[AppleAuth] Native signInWithApple credential incomplete:', {
            hasCredential: Boolean(credential),
            hasIdToken: Boolean(idToken),
            hasNonce: Boolean(nonce)
          });
        } catch (_) {}
        const err = new Error('Apple kimlik doğrulama bilgisi alınamadı. Lütfen tekrar deneyin.');
        err.userMessage = 'Apple kimlik doğrulama bilgisi alınamadı. Lütfen tekrar deneyin.';
        throw err;
      }

      try {
        if (window.SA_AUTH_PREPARING && typeof window.SA_AUTH_PREPARING.show === 'function') {
          window.SA_AUTH_PREPARING.show(300);
        }
      } catch (_) {}

      if (!firebase.auth.OAuthProvider) {
        const err = new Error('Apple ile giriş yapılamadı. Lütfen tekrar deneyin.');
        err.userMessage = 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
        throw err;
      }

      const provider = new firebase.auth.OAuthProvider('apple.com');
      const firebaseCredential = provider.credential({
        idToken: idToken,
        rawNonce: nonce
      });
      await firebase.auth().signInWithCredential(firebaseCredential);
    } catch (e) {
      if (isAppleSignInCancelled(e) || (e && e.code === 'APPLE_SIGNIN_CANCELLED')) {
        throwAppleCancelled();
      }
      try {
        console.error('[AppleAuth] Native sign-in stage failed:', {
          code: e && e.code ? String(e.code) : null,
          message: e && e.message ? String(e.message) : null,
          name: e && e.name ? String(e.name) : null
        });
      } catch (_) {}
      if (e && e.userMessage) {
        const err = new Error(String(e.userMessage));
        err.userMessage = String(e.userMessage);
        if (e.code) err.code = String(e.code);
        throw err;
      }
      const message = mapAppleAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      if (e && e.code) err.code = String(e.code);
      throw err;
    }

    try {
      const user = firebase.auth().currentUser;
      await ensureAppleUserProfile(user, nativeDisplayName);
      const access = await validateStudentAccess(user);
      if (!access.ok) {
        const err = new Error(access.userMessage || 'Giriş başarısız.');
        err.userMessage = access.userMessage || 'Giriş başarısız.';
        throw err;
      }
      const tenantResolution = await resolveDrivingTenantSelectionOrThrow(user);
      if (!tenantResolution.selectedTenantId) {
        if (tenantResolution.drivingTenantIds && tenantResolution.drivingTenantIds.length > 0) {
          markDrivingInstitutionLoginAuthNullRoute();
          await firebase.auth().signOut();
          const err = new Error('Lütfen giriş yapmadan önce kurumunuzu seçin.');
          err.userMessage = 'Lütfen giriş yapmadan önce kurumunuzu seçin.';
          throw err;
        }
      }
      await tryBootstrapTenantSessionFromUser(user);
      await ensureDrivingProgramEnrollment(user, {
        source: (tenantResolution.kind === 'DRIVING_MEMBERSHIP' && tenantResolution.selectedTenantId)
          ? 'institution'
          : 'public'
      });
      return { ok: true };
    } catch (e) {
      const code = (e && e.code) ? String(e.code) : '';
      try {
        console.error('[AppleAuth] Post-login finalize failed:', {
          code: code || null,
          userMessage: e && e.userMessage ? String(e.userMessage) : null,
          uid: firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid ? String(firebase.auth().currentUser.uid) : null
        });
      } catch (_) {}

      let message = (e && e.userMessage) ? String(e.userMessage) : '';
      if (!message) {
        if (code === 'MACHINE_ACCOUNT_REQUIRES_MACHINE_ENTRY') message = MSG_MACHINE_REQUIRES_MACHINE_ENTRY;
        else if (code === 'permission-denied') message = 'Apple girişi tamamlanamadı: erişim izni yok.';
        else if (code === 'unauthenticated') message = 'Apple girişi tamamlanamadı: oturum doğrulanamadı.';
        else if (code === 'unavailable' || code === 'auth/unavailable' || code === 'auth/network-request-failed') {
          message = 'Bağlantı kurulamadı. Lütfen tekrar deneyin.';
        } else {
          message = 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
        }
      }

      const err = new Error(message);
      err.userMessage = message;
      if (code) err.code = code;
      if (e && e.machineCode) err.machineCode = String(e.machineCode);
      err.cause = e;
      throw err;
    }
  }

  async function signInWithMicrosoft() {
    try {
      const clientId = getMicrosoftOAuthClientId();
      if (!clientId) {
        const err = new Error('Microsoft OAuth istemci kimliği bulunamadı.');
        err.userMessage = 'Microsoft giriş yapılandırması eksik (client id).';
        throw err;
      }

      const state = randomBase64Url(16);
      const codeVerifier = randomBase64Url(48);
      const codeChallenge = await sha256Base64Url(codeVerifier);
      const startedAt = Date.now();

      const pending = {
        state,
        codeVerifier,
        redirectUri: MS_OAUTH_REDIRECT_URI,
        startedAt,
        authority: MS_OAUTH_AUTHORITY_BASE,
        tenant: MS_OAUTH_TENANT
      };
      persistMicrosoftAuthPending(pending);
      try {
        console.info('[MicrosoftAuth] PKCE transaction created', {
          hasState: Boolean(state),
          hasCodeVerifier: Boolean(codeVerifier),
          startedAt
        });
      } catch (_) {}

      const authorizeUrl = buildMicrosoftAuthorizeUrl({
        clientId,
        redirectUri: MS_OAUTH_REDIRECT_URI,
        scopes: MS_OAUTH_SCOPES,
        state,
        codeChallenge
      });
      try {
        console.info('[MicrosoftAuth] Browser authorize launch starting', {
          tenant: MS_OAUTH_TENANT,
          hasClientId: Boolean(clientId),
          redirectUri: MS_OAUTH_REDIRECT_URI
        });
      } catch (_) {}

      await openExternalAuthUrl(authorizeUrl);
      try { console.info('[MicrosoftAuth] Browser authorize launch success'); } catch (_) {}
      return { ok: false, pending: true, stage: 'microsoft_browser_auth_started' };
    } catch (e) {
      try {
        console.error('[MicrosoftAuth] Browser auth start failed:', {
          code: e && e.code ? String(e.code) : null,
          message: e && e.message ? String(e.message) : null
        }, e);
      } catch (_) {}
      const message = (e && e.userMessage)
        ? String(e.userMessage)
        : mapMicrosoftAuthErrorToMessage(e);
      return { ok: false, pending: false, error: message };
    }
  }

  async function exchangeMicrosoftCodeForFirebaseToken(code, state) {
    const pending = loadMicrosoftAuthPending();
    if (!pending) {
      return { ok: false, errorCode: 'ms_pending_missing', message: 'Microsoft oturum bilgisi bulunamadı. Lütfen tekrar deneyin.' };
    }

    const pendingState = typeof pending.state === 'string' ? pending.state.trim() : '';
    const codeVerifier = typeof pending.codeVerifier === 'string' ? pending.codeVerifier.trim() : '';
    const redirectUri = typeof pending.redirectUri === 'string' ? pending.redirectUri.trim() : '';
    const startedAt = Number(pending.startedAt || 0);

    if (!pendingState || !codeVerifier || !redirectUri) {
      clearMicrosoftAuthPending();
      return { ok: false, errorCode: 'ms_pending_invalid', message: 'Microsoft oturum bilgisi geçersiz. Lütfen tekrar giriş yapın.' };
    }
    if (redirectUri !== MS_OAUTH_REDIRECT_URI) {
      clearMicrosoftAuthPending();
      return { ok: false, errorCode: 'ms_redirect_mismatch', message: 'Microsoft yönlendirme doğrulaması başarısız oldu.' };
    }
    if (!state || String(state).trim() !== pendingState) {
      clearMicrosoftAuthPending();
      return { ok: false, errorCode: 'ms_state_mismatch', message: 'Microsoft oturum doğrulaması başarısız oldu. Lütfen tekrar deneyin.' };
    }
    if (!startedAt || Number.isNaN(startedAt) || (Date.now() - startedAt) > MS_AUTH_PENDING_MAX_AGE_MS) {
      clearMicrosoftAuthPending();
      return { ok: false, errorCode: 'ms_pending_expired', message: 'Microsoft giriş oturumu zaman aşımına uğradı. Lütfen tekrar deneyin.' };
    }

    const endpointUrl = getMicrosoftExchangeFunctionUrl();
    try {
      console.warn('[MicrosoftAuth]', {
        tag: '[MicrosoftAuth]',
        message: 'Exchange endpoint URL',
        endpointUrl,
        saMicrosoftExchangeUrlExists: typeof window !== 'undefined' && typeof window.SA_MICROSOFT_EXCHANGE_URL === 'string',
        redirectUri
      });
    } catch (_) {}
    try {
      const resp = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: String(code || ''),
          state: String(state || ''),
          codeVerifier,
          redirectUri
        })
      });

      let data = {};
      try { data = await resp.json(); } catch (_) { data = {}; }
      const token =
        data.firebaseCustomToken ||
        data.customToken ||
        data.token ||
        data.firebaseToken ||
        null;
      if (!resp.ok || !data || data.ok !== true) {
        return {
          ok: false,
          errorCode: (data && data.errorCode) ? String(data.errorCode) : 'ms_exchange_failed',
          message: (data && data.message) ? String(data.message) : 'Microsoft doğrulaması tamamlanamadı.'
        };
      }
      if (!token) throw new Error('ms_token_missing');

      return { ok: true, firebaseCustomToken: String(token) };
    } catch (e) {
      if (e && e.message === 'ms_token_missing') {
        return { ok: false, errorCode: 'ms_token_missing', message: 'Microsoft doğrulaması tamamlanamadı.' };
      }
      return { ok: false, errorCode: 'ms_exchange_network', message: 'Microsoft doğrulama servisine ulaşılamadı.' };
    }
  }

  async function consumeMicrosoftAuthCallbackPayload(payload) {
    if (__msAuthCallbackConsumeInFlight) {
      return { ok: false, errorCode: 'ms_consume_in_flight', message: 'Microsoft giriş işlemi devam ediyor.' };
    }
    __msAuthCallbackConsumeInFlight = true;
    try {
      const callbackPayload = payload && typeof payload === 'object' ? payload : null;
      if (!callbackPayload) {
        return { ok: false, errorCode: 'ms_callback_missing', message: 'Microsoft dönüş verisi bulunamadı.' };
      }

      const code = callbackPayload.code ? String(callbackPayload.code).trim() : '';
      const state = callbackPayload.state ? String(callbackPayload.state).trim() : '';
      const error = callbackPayload.error ? String(callbackPayload.error).trim() : '';
      const errorDescription = callbackPayload.errorDescription ? String(callbackPayload.errorDescription).trim() : '';

      try {
        console.info('[MicrosoftAuth] Callback consume started', {
          hasCode: Boolean(code),
          hasState: Boolean(state),
          hasError: Boolean(error)
        });
      } catch (_) {}

      if (error) {
        clearMicrosoftAuthPending();
        clearMicrosoftCallbackPayload();
        const message = errorDescription || 'Microsoft giriş işlemi tamamlanamadı.';
        return { ok: false, errorCode: error, message };
      }
      if (!code || !state) {
        clearMicrosoftAuthPending();
        clearMicrosoftCallbackPayload();
        return { ok: false, errorCode: 'ms_callback_invalid', message: 'Microsoft dönüş verisi eksik.' };
      }

      const pending = loadMicrosoftAuthPending();
      if (!pending) {
        clearMicrosoftCallbackPayload();
        return { ok: false, errorCode: 'ms_pending_missing', message: 'Microsoft oturum bilgisi bulunamadı. Lütfen tekrar deneyin.' };
      }
      if (String(pending.state || '').trim() !== state) {
        clearMicrosoftAuthPending();
        clearMicrosoftCallbackPayload();
        return { ok: false, errorCode: 'ms_state_mismatch', message: 'Microsoft oturum doğrulaması başarısız oldu. Lütfen tekrar deneyin.' };
      }
      try { console.info('[MicrosoftAuth] Callback state validated'); } catch (_) {}

      const exchange = await exchangeMicrosoftCodeForFirebaseToken(code, state);
      if (!exchange.ok || !exchange.firebaseCustomToken) {
        clearMicrosoftAuthPending();
        clearMicrosoftCallbackPayload();
        try { console.warn('[MicrosoftAuth] Backend exchange failed', { errorCode: exchange.errorCode || null }); } catch (_) {}
        return {
          ok: false,
          errorCode: exchange.errorCode || 'ms_exchange_failed',
          message: exchange.message || 'Microsoft doğrulaması tamamlanamadı.'
        };
      }
      try { console.info('[MicrosoftAuth] Backend exchange success'); } catch (_) {}

      const token = exchange.firebaseCustomToken;
      const credential = await firebase.auth().signInWithCustomToken(token);
      const user = credential && credential.user ? credential.user : null;
      if (!user || !user.uid) {
        clearMicrosoftAuthPending();
        clearMicrosoftCallbackPayload();
        return { ok: false, errorCode: 'ms_firebase_session_missing', message: 'Microsoft oturumu oluşturulamadı.' };
      }
      try { console.info('[MicrosoftAuth] signInWithCustomToken success', { uid: String(user.uid) }); } catch (_) {}

      try {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
          await window.Capacitor.Plugins.Browser.close();
        }
      } catch (e) {
        console.warn("Browser close failed", e);
      }

      await ensureMicrosoftUserProfile(user);
      const access = await validateStudentAccess(user);
      if (!access.ok) {
        clearMicrosoftAuthPending();
        clearMicrosoftCallbackPayload();
        return {
          ok: false,
          errorCode: 'ms_access_denied',
          message: access.userMessage || 'Giriş başarısız.'
        };
      }
      const selectedTenantId = getSelectedTenantIdFromStorage();
      var msDrivingEnrollmentSource = 'public';
      if (!selectedTenantId) {
        const tenantIds = await getActiveDrivingTenantIdsForUser(user.uid);
        if (tenantIds.length > 0) {
          markDrivingInstitutionLoginAuthNullRoute();
          await firebase.auth().signOut();
          clearMicrosoftAuthPending();
          clearMicrosoftCallbackPayload();
          return {
            ok: false,
            errorCode: 'ms_tenant_required',
            message: 'Lütfen giriş yapmadan önce kurumunuzu seçin.'
          };
        }
        msDrivingEnrollmentSource = 'public';
      } else {
        const membership = await getActiveMembershipForTenant(user.uid, selectedTenantId);
        if (membership) {
          const cls = assertDrivingCompatibleMembership(membership);
          if (cls.kind === 'NON_DRIVING_MEMBERSHIP') {
            try { await clearInstitutionTenantState(); } catch (_) {}
            const drivingTenantIds = await getActiveDrivingTenantIdsForUser(user.uid);
            if (drivingTenantIds.length > 0) {
              markDrivingInstitutionLoginAuthNullRoute();
              await firebase.auth().signOut();
              clearMicrosoftAuthPending();
              clearMicrosoftCallbackPayload();
              return {
                ok: false,
                errorCode: 'ms_tenant_required',
                message: 'Lütfen giriş yapmadan önce kurumunuzu seçin.'
              };
            }
            msDrivingEnrollmentSource = 'public';
          } else if (cls.kind === 'DRIVING_MEMBERSHIP') {
            msDrivingEnrollmentSource = 'institution';
          }
        } else {
          msDrivingEnrollmentSource = 'public';
        }
      }
      await tryBootstrapTenantSessionFromUser(user);
      await ensureDrivingProgramEnrollment(user, { source: msDrivingEnrollmentSource });

      clearMicrosoftAuthPending();
      clearMicrosoftCallbackPayload();
      return { ok: true, user };
    } catch (e) {
      clearMicrosoftAuthPending();
      clearMicrosoftCallbackPayload();
      return {
        ok: false,
        errorCode: (e && e.code) ? String(e.code) : 'ms_consume_failed',
        message: (e && e.userMessage) ? String(e.userMessage) : ((e && e.message) ? String(e.message) : 'Microsoft ile giriş başarısız.')
      };
    } finally {
      __msAuthCallbackConsumeInFlight = false;
    }
  }

  async function validateCurrentUser() {
    const user = firebase && firebase.auth ? firebase.auth().currentUser : null;
    if (!user) {
      clearRemainingDaysBadge();
      if (window.SA_PUBLIC_USER_SESSION && window.SA_PUBLIC_USER_SESSION.clearPublicUserSession) {
        window.SA_PUBLIC_USER_SESSION.clearPublicUserSession();
      }
      return { ok: false, userMessage: 'Giriş başarısız.' };
    }

    const publicAccess = await validatePublicUserAccess(user);
    if (publicAccess.ok && publicAccess.isPublicUser) {
      if (window.SA_PUBLIC_USER_SESSION && !window.SA_PUBLIC_USER_SESSION.isPublicUserSessionActive()) {
        await applyPublicUserSession(user, publicAccess.userDoc);
      }
      return { ok: true, mode: 'public' };
    }

    if (window.SA_PUBLIC_USER_SESSION && window.SA_PUBLIC_USER_SESSION.isPublicUserSessionActive()) {
      window.SA_PUBLIC_USER_SESSION.clearPublicUserSession();
    }

    const studentAccess = await validateStudentAccess(user);
    if (!studentAccess.ok) {
      return studentAccess;
    }

    const selectedTenantId = getSelectedTenantIdFromStorage();
    if (selectedTenantId) {
      const resolved = await resolveInstitutionSessionPersona(user, selectedTenantId);
      if (resolved.ok && resolved.persona === 'instructor') {
        return { ok: true, mode: 'instructor' };
      }
      if (!resolved.ok) {
        const rejectCodes = {
          inactive_instructor: true,
          role_mismatch: true,
          unsupported_role: true
        };
        if (resolved.code && rejectCodes[resolved.code]) {
          markDrivingInstitutionLoginAuthNullRoute();
          try { await firebase.auth().signOut(); } catch (_) {}
          return {
            ok: false,
            userMessage: resolved.userMessage || 'Giriş başarısız.',
            code: resolved.code
          };
        }
      }
      if (resolved.ok && resolved.persona === 'student') {
        return { ok: true, mode: 'institution' };
      }
    }

    // Cold restore may lack sessionStorage tenant; detect instructor-only memberships.
    try {
      const instructorTenantIds = await getActiveInstructorTenantIdsForUser(user.uid);
      const drivingTenantIds = await getActiveDrivingTenantIdsForUser(user.uid);
      if (instructorTenantIds.length > 0 && drivingTenantIds.length === 0) {
        return { ok: true, mode: 'instructor_pending_tenant' };
      }
    } catch (_) {}

    return { ok: true, mode: 'institution' };
  }

  window.SA_TENANT = {
    setSelectedTenantId: (tid) => {
      try {
        const v = typeof tid === 'string' ? tid.trim() : '';
        if (v) {
          sessionStorage.setItem(SELECTED_TENANT_STORAGE_KEY, v);
          console.log('[TenantDebug] sessionStorage.setItem(sa_selected_tenant_id)=', v);
        } else {
          sessionStorage.removeItem(SELECTED_TENANT_STORAGE_KEY);
          console.log('[TenantDebug] sessionStorage.removeItem(sa_selected_tenant_id)');
        }
      } catch (e) { console.warn('[TenantDebug] setSelectedTenantId error', e); }
    },
    getSelectedTenantId: () => {
      try {
        const v = sessionStorage.getItem(SELECTED_TENANT_STORAGE_KEY);
        return typeof v === 'string' ? v.trim() || null : null;
      } catch { return null; }
    },
    clearSelectedTenantId: () => {
      try {
        sessionStorage.removeItem(SELECTED_TENANT_STORAGE_KEY);
        console.log('[TenantDebug] tenant cleared because= clearSelectedTenantId() called');
      } catch {}
    },
  };

  window.SA_LOGIN = {
    signIn,
    signInAsPublicUser,
    signUp,
    sendIndividualPasswordResetEmail,
    signInWithGoogle,
    signInWithApple,
    signInWithMicrosoft,
    exchangeMicrosoftCodeForFirebaseToken,
    consumeMicrosoftAuthCallbackPayload,
    validateCurrentUser,
    validatePublicUserAccess,
    bootstrapPublicUserIfAuthenticated,
    normalizeUsername,
    restoreTenantSession: tryBootstrapTenantSessionFromUser,
    normalizeMembershipProgramType: normalizeMembershipProgramType,
    assertDrivingCompatibleMembership: assertDrivingCompatibleMembership,
    assertRestoredSessionDrivingCompatible: assertRestoredSessionDrivingCompatible,
    getActiveMembershipForTenant: getActiveMembershipForTenant,
    resolveInstitutionSessionPersona: resolveInstitutionSessionPersona,
    markDrivingInstitutionLoginAuthNullRoute: markDrivingInstitutionLoginAuthNullRoute,
    clearInstitutionTenantState: clearInstitutionTenantState,
    MSG_MACHINE_REQUIRES_MACHINE_ENTRY: MSG_MACHINE_REQUIRES_MACHINE_ENTRY,
    MSG_MACHINE_REQUIRES_RELOGIN: MSG_MACHINE_REQUIRES_RELOGIN
  };

  const MACHINE_SESSION_HINT_KEY = 'sa_machine_session_hint_v1';
  const PLATFORM_MACHINE_TENANT_ID = 'surucu_akademisi';

  function clearMachineSessionHint() {
    try { localStorage.removeItem(MACHINE_SESSION_HINT_KEY); } catch (_) {}
  }

  function normalizeMachineHintPayload(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    if (Number(parsed.version) !== 1) return null;
    const uid = String(parsed.uid || '').trim();
    const mode = String(parsed.mode || '').trim().toLowerCase();
    const tenantId = String(parsed.tenantId || '').trim();
    const programType = String(parsed.programType || '').trim();
    const enrollmentSource = String(parsed.enrollmentSource || '').trim();
    if (!uid || programType !== 'machine_operator') return null;
    if (mode === 'institution') {
      if (!tenantId || enrollmentSource !== 'institution') return null;
      return {
        version: 1,
        uid: uid,
        mode: 'institution',
        tenantId: tenantId,
        programType: 'machine_operator',
        enrollmentSource: 'institution'
      };
    }
    if (mode === 'public') {
      if (tenantId !== PLATFORM_MACHINE_TENANT_ID || enrollmentSource !== 'public') return null;
      return {
        version: 1,
        uid: uid,
        mode: 'public',
        tenantId: PLATFORM_MACHINE_TENANT_ID,
        programType: 'machine_operator',
        enrollmentSource: 'public'
      };
    }
    return null;
  }

  function readMachineSessionHint() {
    try {
      const raw = localStorage.getItem(MACHINE_SESSION_HINT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const normalized = normalizeMachineHintPayload(parsed);
      if (!normalized) {
        clearMachineSessionHint();
        return null;
      }
      return normalized;
    } catch (_) {
      clearMachineSessionHint();
      return null;
    }
  }

  function writeMachineSessionHint(session) {
    const src = session && typeof session === 'object' ? session : {};
    const uid = String(src.uid || '').trim();
    const mode = String(src.mode || src.enrollmentSource || '').trim().toLowerCase() === 'public'
      ? 'public'
      : (String(src.mode || '').trim().toLowerCase() === 'institution'
        ? 'institution'
        : (String(src.enrollmentSource || '').trim().toLowerCase() === 'institution' ? 'institution' : ''));
    if (!uid || (mode !== 'institution' && mode !== 'public')) return false;
    const payload = mode === 'public'
      ? {
          version: 1,
          uid: uid,
          mode: 'public',
          tenantId: PLATFORM_MACHINE_TENANT_ID,
          programType: 'machine_operator',
          enrollmentSource: 'public'
        }
      : {
          version: 1,
          uid: uid,
          mode: 'institution',
          tenantId: String(src.tenantId || '').trim(),
          programType: 'machine_operator',
          enrollmentSource: 'institution'
        };
    if (mode === 'institution' && !payload.tenantId) return false;
    try {
      localStorage.setItem(MACHINE_SESSION_HINT_KEY, JSON.stringify(payload));
      return true;
    } catch (_) {
      return false;
    }
  }

  function isMachineSessionHintForUser(hint, uid) {
    if (!hint || typeof hint !== 'object') return false;
    const expected = String(uid || '').trim();
    if (!expected) return false;
    if (String(hint.uid || '').trim() !== expected) return false;
    if (String(hint.programType || '') !== 'machine_operator') return false;
    const mode = String(hint.mode || '').trim().toLowerCase();
    if (mode === 'institution') {
      return String(hint.enrollmentSource || '') === 'institution'
        && String(hint.tenantId || '').trim() !== '';
    }
    if (mode === 'public') {
      return String(hint.enrollmentSource || '') === 'public'
        && String(hint.tenantId || '').trim() === PLATFORM_MACHINE_TENANT_ID;
    }
    return false;
  }

  function extractMachineErrorCode(error) {
    if (!error) return '';
    try {
      var details = error.details;
      if (details && typeof details === 'object') {
        if (details.code != null && String(details.code).trim()) return String(details.code).trim();
        if (details.errorCode != null && String(details.errorCode).trim()) return String(details.errorCode).trim();
      }
      if (typeof details === 'string' && details.trim()) {
        try {
          var parsed = JSON.parse(details);
          if (parsed && parsed.code) return String(parsed.code).trim();
          if (parsed && parsed.errorCode) return String(parsed.errorCode).trim();
        } catch (_) {
          if (/^MACHINE_[A-Z0-9_]+$/.test(details.trim())) return details.trim();
        }
      }
      if (error.machineCode != null && String(error.machineCode).trim()) return String(error.machineCode).trim();
      if (error.code != null && String(error.code).trim()) {
        var c = String(error.code).trim();
        if (/^MACHINE_[A-Z0-9_]+$/.test(c)) return c;
        if (c.indexOf('/') >= 0) {
          // keep functions/* for mapping; also try details already handled
        }
        return c;
      }
    } catch (_) {}
    return '';
  }

  function ensureMachineFunctionsAvailable() {
    if (typeof firebase === 'undefined' || !firebase || !firebase.app) {
      const err = new Error('Giriş sistemi yüklenemedi.');
      err.userMessage = 'Giriş sistemi yüklenemedi.';
      throw err;
    }
    if (typeof firebase.app().functions !== 'function') {
      const err = new Error('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
      err.userMessage = 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
      throw err;
    }
  }

  function wrapMachineCallableError(e, fallbackMessage) {
    const machineCode = extractMachineErrorCode(e);
    const err = new Error((e && e.message) ? String(e.message) : (fallbackMessage || 'Giriş sırasında bir sorun oluştu.'));
    err.machineCode = machineCode;
    err.code = (e && e.code) ? String(e.code) : (machineCode || '');
    err.details = e && e.details;
    err.cause = e;
    if (e && e.userMessage) err.userMessage = String(e.userMessage);
    return err;
  }

  async function signInInstitutionCredentials(usernameOrEmail, password) {
    const email = usernameOrEmailToEmail(usernameOrEmail);
    const pass = String(password || '');
    if (!email || !pass) {
      const err = new Error('Kullanıcı adı veya şifre hatalı.');
      err.userMessage = 'Kullanıcı adı veya şifre hatalı.';
      throw err;
    }
    if (typeof firebase === 'undefined' || !firebase || !firebase.auth) {
      const err = new Error('Giriş sistemi yüklenemedi.');
      err.userMessage = 'Giriş sistemi yüklenemedi.';
      throw err;
    }
    try {
      const cred = await firebase.auth().signInWithEmailAndPassword(email, pass);
      return {
        ok: true,
        user: (cred && cred.user) ? cred.user : firebase.auth().currentUser
      };
    } catch (e) {
      const message = mapAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      err.code = e && e.code ? String(e.code) : '';
      err.cause = e;
      throw err;
    }
  }

  async function signInPublicCredentials(emailInput, password) {
    const email = String(emailInput || '').trim().toLowerCase();
    const pass = String(password || '');
    if (!email || !pass || email.indexOf('@') < 0) {
      const err = new Error('E-posta veya şifre hatalı.');
      err.userMessage = 'E-posta veya şifre hatalı.';
      err.code = 'auth/invalid-email';
      throw err;
    }
    if (typeof firebase === 'undefined' || !firebase || !firebase.auth) {
      const err = new Error('Giriş sistemi yüklenemedi.');
      err.userMessage = 'Giriş sistemi yüklenemedi.';
      throw err;
    }
    try {
      const cred = await firebase.auth().signInWithEmailAndPassword(email, pass);
      return {
        ok: true,
        user: (cred && cred.user) ? cred.user : firebase.auth().currentUser
      };
    } catch (e) {
      const message = mapAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      err.code = e && e.code ? String(e.code) : '';
      err.cause = e;
      throw err;
    }
  }

  async function createPublicAccount(emailInput, password) {
    const email = String(emailInput || '').trim().toLowerCase();
    const pass = String(password || '');
    if (!email || email.indexOf('@') < 0) {
      const err = new Error('Geçerli bir e-posta adresi girin.');
      err.userMessage = 'Geçerli bir e-posta adresi girin.';
      err.code = 'auth/invalid-email';
      throw err;
    }
    if (pass.length < 6) {
      const err = new Error('Şifreniz en az 6 karakter olmalıdır.');
      err.userMessage = 'Şifreniz en az 6 karakter olmalıdır.';
      err.code = 'auth/weak-password';
      throw err;
    }
    if (typeof firebase === 'undefined' || !firebase || !firebase.auth) {
      const err = new Error('Giriş sistemi yüklenemedi.');
      err.userMessage = 'Giriş sistemi yüklenemedi.';
      throw err;
    }
    try {
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
      return {
        ok: true,
        user: (cred && cred.user) ? cred.user : firebase.auth().currentUser
      };
    } catch (e) {
      const message = mapSignupErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      err.code = e && e.code ? String(e.code) : '';
      err.cause = e;
      throw err;
    }
  }

  async function resolveInstitutionSession(tenantId) {
    const tid = String(tenantId || '').trim();
    if (!tid) {
      const err = new Error('Lütfen kurumunuzu seçin.');
      err.userMessage = 'Lütfen kurumunuzu seçin.';
      err.machineCode = 'invalid-argument';
      throw err;
    }
    ensureMachineFunctionsAvailable();
    try {
      const callable = firebase.app().functions('us-central1').httpsCallable('resolveMachineCandidateSession');
      const result = await callable({ mode: 'institution', tenantId: tid });
      const data = (result && result.data && typeof result.data === 'object') ? result.data : {};
      return {
        ok: data.ok === true,
        uid: data.uid != null ? String(data.uid) : '',
        tenantId: data.tenantId != null ? String(data.tenantId) : tid,
        programType: data.programType != null ? String(data.programType) : '',
        enrollmentSource: data.enrollmentSource != null ? String(data.enrollmentSource) : '',
        accessStatus: data.accessStatus != null ? String(data.accessStatus) : '',
        accessDaysRemaining: (data.accessDaysRemaining == null || data.accessDaysRemaining === '')
          ? null
          : Number(data.accessDaysRemaining),
        accessExpiresAt: (data.accessExpiresAt == null || data.accessExpiresAt === '')
          ? null
          : Number(data.accessExpiresAt)
      };
    } catch (e) {
      throw wrapMachineCallableError(e, 'Giriş sırasında bir sorun oluştu.');
    }
  }

  async function resolvePublicSession() {
    ensureMachineFunctionsAvailable();
    try {
      const callable = firebase.app().functions('us-central1').httpsCallable('resolveMachineCandidateSession');
      const result = await callable({ mode: 'public' });
      const data = (result && result.data && typeof result.data === 'object') ? result.data : {};
      return {
        ok: data.ok === true,
        uid: data.uid != null ? String(data.uid) : '',
        tenantId: data.tenantId != null ? String(data.tenantId) : PLATFORM_MACHINE_TENANT_ID,
        programType: data.programType != null ? String(data.programType) : '',
        enrollmentSource: data.enrollmentSource != null ? String(data.enrollmentSource) : '',
        accessStatus: data.accessStatus != null ? String(data.accessStatus) : '',
        accessDaysRemaining: (data.accessDaysRemaining == null || data.accessDaysRemaining === '')
          ? null
          : Number(data.accessDaysRemaining),
        accessExpiresAt: (data.accessExpiresAt == null || data.accessExpiresAt === '')
          ? null
          : Number(data.accessExpiresAt)
      };
    } catch (e) {
      throw wrapMachineCallableError(e, 'İş makineleri aday girişi sırasında bir sorun oluştu.');
    }
  }

  async function bootstrapPublicCandidate(fullName) {
    ensureMachineFunctionsAvailable();
    try {
      const callable = firebase.app().functions('us-central1').httpsCallable('bootstrapPublicMachineCandidate');
      const normalizedFullName = String(fullName == null ? '' : fullName).trim().replace(/\s+/g, ' ');
      const payload = normalizedFullName ? { fullName: normalizedFullName } : {};
      const result = await callable(payload);
      const data = (result && result.data && typeof result.data === 'object') ? result.data : {};
      return {
        ok: data.ok === true,
        uid: data.uid != null ? String(data.uid) : '',
        tenantId: data.tenantId != null ? String(data.tenantId) : PLATFORM_MACHINE_TENANT_ID,
        membershipId: data.membershipId != null ? String(data.membershipId) : '',
        programType: data.programType != null ? String(data.programType) : '',
        enrollmentSource: data.enrollmentSource != null ? String(data.enrollmentSource) : ''
      };
    } catch (e) {
      throw wrapMachineCallableError(e, 'İş makineleri aday kaydı oluşturulamadı.');
    }
  }

  async function resolveOrBootstrapPublicSession() {
    try {
      return await resolvePublicSession();
    } catch (e) {
      const code = extractMachineErrorCode(e);
      if (code !== 'MACHINE_ENROLLMENT_REQUIRED') throw e;
      await bootstrapPublicCandidate();
      return await resolvePublicSession();
    }
  }

  async function signInPublicWithGoogleCredential() {
    if (typeof firebase === 'undefined' || !firebase || !firebase.auth) {
      const err = new Error('Google giriş sistemi yüklenemedi.');
      err.userMessage = 'Google giriş sistemi yüklenemedi.';
      throw err;
    }
    const nativeAuth = getNativeFirebaseAuthPlugin();
    if (!nativeAuth || typeof nativeAuth.signInWithGoogle !== 'function') {
      const err = new Error('Native Google giriş eklentisi bulunamadı.');
      err.userMessage = 'Native Google giriş eklentisi bulunamadı.';
      throw err;
    }
    try {
      const isAndroidPlatform = !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
      const nativeResult = await nativeAuth.signInWithGoogle({
        skipNativeAuth: true,
        scopes: ['email', 'profile'],
        ...(isAndroidPlatform ? { useCredentialManager: false } : {})
      });
      const credential = (nativeResult && nativeResult.credential) ? nativeResult.credential : null;
      const idToken =
        (credential && credential.idToken ? credential.idToken : null)
        || (nativeResult && nativeResult.idToken ? nativeResult.idToken : null)
        || null;
      const accessToken =
        (credential && credential.accessToken ? credential.accessToken : null)
        || (nativeResult && nativeResult.accessToken ? nativeResult.accessToken : null)
        || null;
      if (!idToken && !accessToken) {
        const err = new Error('Google kimlik doğrulama bilgisi alınamadı.');
        err.userMessage = 'Google kimlik doğrulama bilgisi alınamadı.';
        throw err;
      }
      const firebaseCredential = firebase.auth.GoogleAuthProvider.credential(idToken, accessToken);
      await firebase.auth().signInWithCredential(firebaseCredential);
      return {
        ok: true,
        user: firebase.auth().currentUser
      };
    } catch (e) {
      const message = (e && e.userMessage) ? String(e.userMessage) : mapGoogleAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      err.code = e && e.code ? String(e.code) : '';
      err.cause = e;
      throw err;
    }
  }

  async function signInPublicWithAppleCredential() {
    if (typeof firebase === 'undefined' || !firebase || !firebase.auth || !firebase.firestore) {
      const err = new Error('Apple ile giriş yapılamadı. Lütfen tekrar deneyin.');
      err.userMessage = 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
      throw err;
    }
    const nativeAuth = getNativeFirebaseAuthPlugin();
    if (!nativeAuth || typeof nativeAuth.signInWithApple !== 'function') {
      const err = new Error('Apple ile giriş yapılamadı. Lütfen tekrar deneyin.');
      err.userMessage = 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
      throw err;
    }
    try {
      const nativeResult = await nativeAuth.signInWithApple({
        skipNativeAuth: true
      });
      const credential = (nativeResult && nativeResult.credential) ? nativeResult.credential : null;
      const idToken = (credential && credential.idToken) ? String(credential.idToken) : '';
      const nonce = (credential && credential.nonce) ? String(credential.nonce) : '';
      const nativeDisplayName = trimIdentityString(nativeResult && nativeResult.user && nativeResult.user.displayName);
      if (!idToken || !nonce) {
        try {
          console.error('[AppleAuth] Native signInWithApple credential incomplete:', {
            hasCredential: Boolean(credential),
            hasIdToken: Boolean(idToken),
            hasNonce: Boolean(nonce)
          });
        } catch (_) {}
        const err = new Error('Apple kimlik doğrulama bilgisi alınamadı. Lütfen tekrar deneyin.');
        err.userMessage = 'Apple kimlik doğrulama bilgisi alınamadı. Lütfen tekrar deneyin.';
        throw err;
      }
      if (!firebase.auth.OAuthProvider) {
        const err = new Error('Apple ile giriş yapılamadı. Lütfen tekrar deneyin.');
        err.userMessage = 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
        throw err;
      }
      const provider = new firebase.auth.OAuthProvider('apple.com');
      const firebaseCredential = provider.credential({
        idToken: idToken,
        rawNonce: nonce
      });
      await firebase.auth().signInWithCredential(firebaseCredential);
      const user = firebase.auth().currentUser;
      await ensureAppleUserProfile(user, nativeDisplayName);
      return {
        ok: true,
        user: user
      };
    } catch (e) {
      if (isAppleSignInCancelled(e) || (e && e.code === 'APPLE_SIGNIN_CANCELLED')) {
        throwAppleCancelled();
      }
      const message = (e && e.userMessage) ? String(e.userMessage) : mapAppleAuthErrorToMessage(e);
      const err = new Error(message || 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.');
      err.userMessage = message || 'Apple ile giriş yapılamadı. Lütfen tekrar deneyin.';
      err.code = e && e.code ? String(e.code) : '';
      err.cause = e;
      throw err;
    }
  }

  window.SA_MACHINE_AUTH = {
    PLATFORM_MACHINE_TENANT_ID: PLATFORM_MACHINE_TENANT_ID,
    signInInstitutionCredentials: signInInstitutionCredentials,
    signInPublicCredentials: signInPublicCredentials,
    createPublicAccount: createPublicAccount,
    resolveInstitutionSession: resolveInstitutionSession,
    resolvePublicSession: resolvePublicSession,
    bootstrapPublicCandidate: bootstrapPublicCandidate,
    resolveOrBootstrapPublicSession: resolveOrBootstrapPublicSession,
    signInPublicWithGoogleCredential: signInPublicWithGoogleCredential,
    signInPublicWithAppleCredential: signInPublicWithAppleCredential,
    extractMachineErrorCode: extractMachineErrorCode,
    usernameOrEmailToEmail: usernameOrEmailToEmail,
    MACHINE_SESSION_HINT_KEY: MACHINE_SESSION_HINT_KEY,
    readMachineSessionHint: readMachineSessionHint,
    writeMachineSessionHint: writeMachineSessionHint,
    clearMachineSessionHint: clearMachineSessionHint,
    isMachineSessionHintForUser: isMachineSessionHintForUser
  };
})();
