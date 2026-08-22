/**
 * Public portal Firebase Auth + users/{uid} (P2.2b).
 * Separate from institution web-login.js / sa_web_session_v1.
 *
 * Phase A3: eligible Public Machine students (role=student) may attach Public
 * Ehliyet via ensurePublicEhliyetAccess without changing Firestore users.role.
 */
(function () {
  'use strict';

  var FUNCTIONS_REGION = 'us-central1';
  var PLATFORM_MACHINE_TENANT_ID = 'surucu_akademisi';
  var MACHINE_PROGRAM_TYPE = 'machine_operator';

  var MSG = {
    FIREBASE_NOT_READY: 'Giriş sistemi yüklenemedi. Sayfayı yenileyin.',
    FIRST_NAME_REQUIRED: 'İsim gereklidir.',
    LAST_NAME_REQUIRED: 'Soyisim gereklidir.',
    EMAIL_REQUIRED: 'Geçerli bir e-posta girin.',
    PASSWORD_SHORT: 'Şifre en az 6 karakter olmalıdır.',
    REGISTER_FAILED: 'Kayıt başarısız. Lütfen tekrar deneyin.',
    LOGIN_FAILED: 'Giriş başarısız. Lütfen tekrar deneyin.',
    AUTH_FAILED: 'E-posta veya şifre hatalı.',
    PROFILE_FAILED: 'Hesap oluşturuldu ancak profil kaydı tamamlanamadı. Lütfen tekrar deneyin.',
    NOT_PUBLIC_USER:
      'Bu giriş public portal üyeleri içindir. Kurum öğrencisiyseniz Sürücü Kursları Öğrenci Girişi bölümünü kullanın.',
    USER_NOT_FOUND: 'Public portal hesabı bulunamadı. Önce kayıt olun.',
    EMAIL_IN_USE: 'Bu e-posta adresi zaten kullanılıyor.',
    WEAK_PASSWORD: 'Şifre çok zayıf. En az 6 karakter kullanın.',
    TOO_MANY: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.',
    GOOGLE_FAIL: 'Google ile giriş yapılamadı. Lütfen tekrar deneyin.',
    GOOGLE_CANCEL: 'Google girişi iptal edildi veya engellendi.',
    GOOGLE_ACCOUNT_EXISTS:
      'Bu e-posta farklı bir giriş yöntemiyle kayıtlı. Lütfen e-posta ve şifre ile giriş yapın.',
    NETWORK: 'Bağlantı sorunu oluştu. İnternetinizi kontrol edip tekrar deneyin.'
  };

  var FORBIDDEN_MEMBERSHIP_ROLES = {
    super_admin: true,
    institution_admin: true,
    instructor: true,
    admin: true
  };

  function getFirebase() {
    return window.SA_WEB_FIREBASE || null;
  }

  function getSessionApi() {
    return window.SA_PUBLIC_SESSION || null;
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function normalizeRole(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeProgramType(value) {
    var v = String(value || '').trim().toLowerCase();
    if (v === MACHINE_PROGRAM_TYPE) return MACHINE_PROGRAM_TYPE;
    return 'driving_license';
  }

  /** Mirror server normalizeEnrollmentSource for read-only restore checks. */
  function normalizeEnrollmentSource(value, tenantId, programType) {
    var e = String(value || '').trim().toLowerCase();
    if (e === 'public') return 'public';
    if (e === 'institution') return 'institution';
    var tid = String(tenantId || '').trim();
    if (tid === PLATFORM_MACHINE_TENANT_ID && normalizeProgramType(programType) === MACHINE_PROGRAM_TYPE) {
      return 'public';
    }
    return 'institution';
  }

  function getUserRole(userDoc) {
    var data = userDoc && typeof userDoc === 'object' ? userDoc : {};
    return normalizeRole(data.role || data.globalRole);
  }

  function hasLegacyPublicUserRole(userDoc) {
    return getUserRole(userDoc) === 'public_user';
  }

  function getDrivingLicenseEnrollment(userDoc) {
    var data = userDoc && typeof userDoc === 'object' ? userDoc : {};
    var pe = data.programEnrollments && typeof data.programEnrollments === 'object'
      ? data.programEnrollments
      : null;
    if (pe && pe.driving_license && typeof pe.driving_license === 'object') {
      return pe.driving_license;
    }
    var literal = data['programEnrollments.driving_license'];
    if (literal && typeof literal === 'object') return literal;
    return null;
  }

  function hasPublicDrivingEnrollment(userDoc) {
    var enrollment = getDrivingLicenseEnrollment(userDoc);
    if (!enrollment) return false;
    var status = String(enrollment.status || '').trim().toLowerCase();
    var source = String(enrollment.source || '').trim().toLowerCase();
    return status === 'active' && source === 'public';
  }

  function extractCallableErrorCode(error) {
    if (!error) return '';
    try {
      var details = error.details;
      if (details && typeof details === 'object') {
        if (details.code != null && String(details.code).trim()) return String(details.code).trim();
        if (details.errorCode != null && String(details.errorCode).trim()) {
          return String(details.errorCode).trim();
        }
      }
      if (typeof details === 'string' && details.trim()) {
        try {
          var parsed = JSON.parse(details);
          if (parsed && parsed.code) return String(parsed.code).trim();
        } catch (_) {
          if (/^PUBLIC_EHLIYET_[A-Z0-9_]+$/.test(details.trim())) return details.trim();
        }
      }
      var c = error.code != null ? String(error.code).trim() : '';
      if (/^PUBLIC_EHLIYET_[A-Z0-9_]+$/.test(c)) return c;
    } catch (_) {}
    return '';
  }

  function mapAuthError(error, fallback) {
    var callableCode = extractCallableErrorCode(error);
    if (
      callableCode === 'PUBLIC_EHLIYET_NOT_ELIGIBLE' ||
      callableCode === 'PUBLIC_EHLIYET_PROFILE_REQUIRED'
    ) {
      return MSG.NOT_PUBLIC_USER;
    }

    var code = error && error.code ? String(error.code) : '';
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/popup-blocked'
    ) {
      return MSG.GOOGLE_CANCEL;
    }
    if (code === 'auth/account-exists-with-different-credential') return MSG.GOOGLE_ACCOUNT_EXISTS;
    if (code === 'auth/network-request-failed') return MSG.NETWORK;
    if (code === 'auth/email-already-in-use') return MSG.EMAIL_IN_USE;
    if (code === 'auth/weak-password') return MSG.WEAK_PASSWORD;
    if (code === 'auth/too-many-requests') return MSG.TOO_MANY;
    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-login-credentials' ||
      code === 'auth/invalid-email'
    ) {
      return MSG.AUTH_FAILED;
    }
    if (
      code === 'functions/failed-precondition' ||
      code === 'functions/permission-denied' ||
      code === 'functions/unauthenticated'
    ) {
      return MSG.NOT_PUBLIC_USER;
    }
    if (code.indexOf('functions/') === 0) {
      return fallback || MSG.LOGIN_FAILED;
    }
    return fallback || MSG.LOGIN_FAILED;
  }

  function splitGoogleDisplayName(displayName) {
    var raw = String(displayName || '').trim().replace(/\s+/g, ' ');
    if (!raw) return { firstName: '', lastName: '', displayName: '' };
    var parts = raw.split(' ');
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: '', displayName: parts[0] };
    }
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
      displayName: raw
    };
  }

  /** Legacy-only: role must be public_user (register / first-time bootstrap). */
  function assertPublicUserRole(userDoc) {
    if (!hasLegacyPublicUserRole(userDoc)) {
      return { ok: false, message: MSG.NOT_PUBLIC_USER };
    }
    return { ok: true, userDoc: userDoc && typeof userDoc === 'object' ? userDoc : {} };
  }

  async function loadPublicUserDoc(uid) {
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.db) {
      throw new Error(MSG.FIREBASE_NOT_READY);
    }
    var id = String(uid || '').trim();
    if (!id) return null;
    var snap = await fb.db.collection('users').doc(id).get();
    if (!snap.exists) return null;
    return snap.data() || null;
  }

  async function loadOwnMembershipDocs(uid) {
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.db) {
      throw new Error(MSG.FIREBASE_NOT_READY);
    }
    var id = String(uid || '').trim();
    if (!id) return [];
    var snap = await fb.db.collection('tenantMemberships').where('uid', '==', id).get();
    if (!snap || !snap.docs) return [];
    return snap.docs.map(function (d) {
      return d.data() || {};
    });
  }

  function assertNoInstitutionMemberships(membershipDocs) {
    var docs = Array.isArray(membershipDocs) ? membershipDocs : [];
    for (var i = 0; i < docs.length; i++) {
      var mem = docs[i] || {};
      var memRole = normalizeRole(mem.role);
      if (FORBIDDEN_MEMBERSHIP_ROLES[memRole]) {
        return { ok: false, message: MSG.NOT_PUBLIC_USER };
      }
      if (memRole && memRole !== 'student') {
        return { ok: false, message: MSG.NOT_PUBLIC_USER };
      }
      var tenantId = String(mem.tenantId || '').trim();
      var enrollment = normalizeEnrollmentSource(mem.enrollmentSource, tenantId, mem.programType);
      if (enrollment === 'institution') {
        return { ok: false, message: MSG.NOT_PUBLIC_USER };
      }
    }
    return { ok: true };
  }

  /**
   * Read-only restore eligibility (no callable mutation).
   * Legacy public_user OK. Student needs public driving entitlement + no institution memberships.
   */
  async function resolvePublicEhliyetRestore(userDoc, uid) {
    if (!userDoc) {
      return { ok: false, message: MSG.NOT_PUBLIC_USER };
    }
    var role = getUserRole(userDoc);
    if (role === 'public_user') {
      return { ok: true, userDoc: userDoc, authRole: 'public_user' };
    }
    if (role !== 'student') {
      return { ok: false, message: MSG.NOT_PUBLIC_USER };
    }
    if (!hasPublicDrivingEnrollment(userDoc)) {
      return { ok: false, message: MSG.NOT_PUBLIC_USER };
    }
    var memberships = await loadOwnMembershipDocs(uid);
    var memCheck = assertNoInstitutionMemberships(memberships);
    if (!memCheck.ok) return memCheck;
    return { ok: true, userDoc: userDoc, authRole: 'student' };
  }

  function getFunctions() {
    if (typeof firebase === 'undefined' || !firebase.app) return null;
    try {
      return firebase.app().functions(FUNCTIONS_REGION);
    } catch (e) {
      console.warn('[public-auth] functions unavailable', e);
      return null;
    }
  }

  async function callEnsurePublicEhliyetAccess() {
    var fns = getFunctions();
    if (!fns || typeof fns.httpsCallable !== 'function') {
      var err = new Error(MSG.FIREBASE_NOT_READY);
      err.code = 'functions/unavailable';
      throw err;
    }
    var callable = fns.httpsCallable('ensurePublicEhliyetAccess');
    var result = await callable({});
    return result && result.data && typeof result.data === 'object' ? result.data : {};
  }

  function buildSessionPayload(uid, email, userDoc) {
    var data = userDoc || {};
    var firstName = String(data.firstName || '').trim();
    var lastName = String(data.lastName || '').trim();
    var displayName = String(data.displayName || '').trim();
    if (!displayName) {
      displayName = (firstName + ' ' + lastName).trim() || normalizeEmail(email).split('@')[0] || 'Üye';
    }
    var authRole = getUserRole(data);
    if (authRole !== 'student') authRole = 'public_user';
    return {
      uid: uid,
      email: normalizeEmail(email || data.email),
      firstName: firstName,
      lastName: lastName,
      displayName: displayName,
      role: 'public_user',
      authRole: authRole,
      ehliyetEntitlement: 'public',
      savedAt: Date.now()
    };
  }

  function savePortalSession(uid, email, userDoc) {
    var sessionApi = getSessionApi();
    if (!sessionApi) return;
    sessionApi.savePublicSession(buildSessionPayload(uid, email, userDoc));
  }

  /**
   * After Auth success + users doc loaded: legacy public_user or student→callable attach.
   * Never overwrites Firestore users.role.
   */
  async function completePublicPortalLogin(user, userDoc) {
    var uid = user && user.uid ? String(user.uid) : '';
    var email = normalizeEmail(user && user.email);
    if (!uid) {
      await logoutPublicUser();
      return { ok: false, message: MSG.LOGIN_FAILED };
    }

    var role = getUserRole(userDoc);

    if (role === 'public_user') {
      savePortalSession(uid, email || (userDoc && userDoc.email), userDoc);
      return { ok: true, uid: uid };
    }

    if (role === 'student') {
      try {
        var data = await callEnsurePublicEhliyetAccess();
        if (!data || data.ok !== true || data.ehliyetEntitlement !== 'public') {
          await logoutPublicUser();
          return { ok: false, message: MSG.NOT_PUBLIC_USER };
        }
      } catch (e) {
        console.warn('[public-auth] ensurePublicEhliyetAccess failed', e);
        await logoutPublicUser();
        return { ok: false, message: mapAuthError(e, MSG.LOGIN_FAILED) };
      }

      var refreshed = await loadPublicUserDoc(uid);
      if (!refreshed || !hasPublicDrivingEnrollment(refreshed)) {
        await logoutPublicUser();
        return { ok: false, message: MSG.NOT_PUBLIC_USER };
      }

      try {
        var memberships = await loadOwnMembershipDocs(uid);
        var memCheck = assertNoInstitutionMemberships(memberships);
        if (!memCheck.ok) {
          await logoutPublicUser();
          return { ok: false, message: MSG.NOT_PUBLIC_USER };
        }
      } catch (memErr) {
        console.warn('[public-auth] membership safety check failed', memErr);
        await logoutPublicUser();
        return { ok: false, message: MSG.LOGIN_FAILED };
      }

      savePortalSession(uid, email || refreshed.email, refreshed);
      return { ok: true, uid: uid };
    }

    await logoutPublicUser();
    return { ok: false, message: MSG.NOT_PUBLIC_USER };
  }

  async function registerPublicUser(opts) {
    var firstName = String(opts && opts.firstName != null ? opts.firstName : '').trim();
    var lastName = String(opts && opts.lastName != null ? opts.lastName : '').trim();
    var email = normalizeEmail(opts && opts.email);
    var password = String(opts && opts.password != null ? opts.password : '');

    if (!firstName) return { ok: false, message: MSG.FIRST_NAME_REQUIRED };
    if (!lastName) return { ok: false, message: MSG.LAST_NAME_REQUIRED };
    if (!email || email.indexOf('@') < 1) return { ok: false, message: MSG.EMAIL_REQUIRED };
    if (password.length < 6) return { ok: false, message: MSG.PASSWORD_SHORT };

    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.auth || !fb.db) {
      return { ok: false, message: MSG.FIREBASE_NOT_READY };
    }

    var displayName = (firstName + ' ' + lastName).trim();
    var cred = null;

    try {
      cred = await fb.auth.createUserWithEmailAndPassword(email, password);
      var user = cred && cred.user ? cred.user : fb.auth.currentUser;
      if (!user || !user.uid) {
        return { ok: false, message: MSG.REGISTER_FAILED };
      }

      var uid = user.uid;
      try {
        await fb.db.collection('users').doc(uid).set({
          uid: uid,
          email: email,
          role: 'public_user',
          accountType: 'public',
          firstName: firstName,
          lastName: lastName,
          displayName: displayName,
          isActive: true,
          signupSource: 'public_web',
          createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (writeErr) {
        console.warn('[public-auth] register profile write failed', writeErr);
        try {
          await fb.auth.signOut();
        } catch (signErr) {
          console.warn('[public-auth] signOut after failed register', signErr);
        }
        return { ok: false, message: MSG.PROFILE_FAILED };
      }

      var userDoc = await loadPublicUserDoc(uid);
      var roleCheck = assertPublicUserRole(userDoc);
      if (!roleCheck.ok) {
        await logoutPublicUser();
        return { ok: false, message: roleCheck.message };
      }

      savePortalSession(uid, email, userDoc);
      return { ok: true, uid: uid };
    } catch (e) {
      console.warn('[public-auth] registerPublicUser failed', e);
      return { ok: false, message: mapAuthError(e, MSG.REGISTER_FAILED) };
    }
  }

  async function loginPublicUser(emailInput, password) {
    var email = normalizeEmail(emailInput);
    var pass = String(password || '');

    if (!email || email.indexOf('@') < 1) return { ok: false, message: MSG.EMAIL_REQUIRED };
    if (pass.length < 6) return { ok: false, message: MSG.PASSWORD_SHORT };

    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.auth || !fb.db) {
      return { ok: false, message: MSG.FIREBASE_NOT_READY };
    }

    try {
      var cred = await fb.auth.signInWithEmailAndPassword(email, pass);
      var user = cred && cred.user ? cred.user : fb.auth.currentUser;
      if (!user || !user.uid) {
        return { ok: false, message: MSG.LOGIN_FAILED };
      }

      var userDoc = await loadPublicUserDoc(user.uid);
      if (!userDoc) {
        await logoutPublicUser();
        return { ok: false, message: MSG.USER_NOT_FOUND };
      }

      return await completePublicPortalLogin(user, userDoc);
    } catch (e) {
      console.warn('[public-auth] loginPublicUser failed', e);
      try {
        await logoutPublicUser();
      } catch (_) {}
      return { ok: false, message: mapAuthError(e, MSG.LOGIN_FAILED) };
    }
  }

  async function bootstrapPublicUserFromGoogle(user) {
    var fb = getFirebase();
    var uid = user && user.uid ? String(user.uid) : '';
    if (!fb || !fb.db || !uid) {
      return { ok: false, message: MSG.FIREBASE_NOT_READY };
    }

    var names = splitGoogleDisplayName(user.displayName);
    var email = normalizeEmail(user.email);
    var displayName = names.displayName || (email && email.split('@')[0]) || 'Üye';

    try {
      await fb.db.collection('users').doc(uid).set({
        uid: uid,
        email: email,
        role: 'public_user',
        accountType: 'public',
        firstName: names.firstName,
        lastName: names.lastName,
        displayName: displayName,
        isActive: true,
        signupSource: 'public_web',
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (writeErr) {
      console.warn('[public-auth] google profile write failed', writeErr);
      await logoutPublicUser();
      return { ok: false, message: MSG.PROFILE_FAILED };
    }

    var userDoc = await loadPublicUserDoc(uid);
    var roleCheck = assertPublicUserRole(userDoc);
    if (!roleCheck.ok) {
      await logoutPublicUser();
      return { ok: false, message: roleCheck.message };
    }

    savePortalSession(uid, email, userDoc);
    return { ok: true, uid: uid };
  }

  async function loginWithGoogle() {
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.auth || !fb.db || typeof firebase === 'undefined') {
      return { ok: false, message: MSG.FIREBASE_NOT_READY };
    }
    if (typeof firebase.auth.GoogleAuthProvider !== 'function') {
      return { ok: false, message: MSG.GOOGLE_FAIL };
    }

    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      var cred = await fb.auth.signInWithPopup(provider);
      var user = (cred && cred.user) || fb.auth.currentUser;
      if (!user || !user.uid) {
        await logoutPublicUser();
        return { ok: false, message: MSG.GOOGLE_FAIL };
      }

      var userDoc = await loadPublicUserDoc(user.uid);
      if (!userDoc) {
        return await bootstrapPublicUserFromGoogle(user);
      }

      return await completePublicPortalLogin(user, userDoc);
    } catch (e) {
      console.warn('[public-auth] loginWithGoogle failed', e);
      try {
        await logoutPublicUser();
      } catch (_) {}
      return { ok: false, message: mapAuthError(e, MSG.GOOGLE_FAIL) };
    }
  }

  async function logoutPublicUser() {
    var fb = getFirebase();
    var sessionApi = getSessionApi();
    if (sessionApi) sessionApi.clearPublicSession();
    if (fb && fb.auth && typeof fb.auth.signOut === 'function') {
      try {
        await fb.auth.signOut();
      } catch (e) {
        console.warn('[public-auth] signOut failed', e);
      }
    }
    return { ok: true };
  }

  function setFormMessage(el, text, type) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'public-auth-msg' + (type === 'error' ? ' public-auth-msg--error' : type === 'success' ? ' public-auth-msg--success' : '');
  }

  function setButtonLoading(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.defaultLabel) {
        btn.dataset.defaultLabel = btn.textContent || '';
      }
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = loadingText || 'Lütfen bekleyin…';
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = btn.dataset.defaultLabel || btn.textContent;
    }
  }

  function initRegisterPage() {
    var form = document.getElementById('public-register-form');
    if (!form) return;

    var submitBtn = document.getElementById('public-register-submit');
    var msgEl = document.getElementById('public-register-message');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      setFormMessage(msgEl, '', '');
      setButtonLoading(submitBtn, true, 'Kayıt yapılıyor…');

      var result = await registerPublicUser({
        firstName: document.getElementById('public-register-firstName') && document.getElementById('public-register-firstName').value,
        lastName: document.getElementById('public-register-lastName') && document.getElementById('public-register-lastName').value,
        email: document.getElementById('public-register-email') && document.getElementById('public-register-email').value,
        password: document.getElementById('public-register-password') && document.getElementById('public-register-password').value
      });

      setButtonLoading(submitBtn, false);

      if (!result.ok) {
        setFormMessage(msgEl, result.message || MSG.REGISTER_FAILED, 'error');
        return;
      }

      setFormMessage(msgEl, 'Hesabınız oluşturuldu. Yönlendiriliyorsunuz…', 'success');
      window.setTimeout(function () {
        window.location.href = '../';
      }, 400);
    });
  }

  function initLoginPage() {
    var form = document.getElementById('public-login-form');
    if (!form) return;

    var submitBtn = document.getElementById('public-login-submit');
    var msgEl = document.getElementById('public-login-message');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      setFormMessage(msgEl, '', '');
      setButtonLoading(submitBtn, true, 'Giriş yapılıyor…');

      var result = await loginPublicUser(
        document.getElementById('public-login-email') && document.getElementById('public-login-email').value,
        document.getElementById('public-login-password') && document.getElementById('public-login-password').value
      );

      setButtonLoading(submitBtn, false);

      if (!result.ok) {
        setFormMessage(msgEl, result.message || MSG.LOGIN_FAILED, 'error');
        return;
      }

      setFormMessage(msgEl, 'Giriş başarılı. Yönlendiriliyorsunuz…', 'success');
      window.setTimeout(function () {
        window.location.href = '../';
      }, 400);
    });
  }

  function initGoogleAuthButton() {
    var btn = document.getElementById('public-google-login');
    if (!btn) return;

    var msgEl = document.getElementById('public-login-message')
      || document.getElementById('public-register-message');
    var googleBusy = false;

    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      if (googleBusy) return;
      googleBusy = true;
      setFormMessage(msgEl, '', '');
      setButtonLoading(btn, true, 'Google ile giriş…');

      var result = await loginWithGoogle();
      if (!result.ok) {
        googleBusy = false;
        setButtonLoading(btn, false);
        setFormMessage(msgEl, result.message || MSG.GOOGLE_FAIL, 'error');
        return;
      }

      setFormMessage(msgEl, 'Giriş başarılı. Yönlendiriliyorsunuz…', 'success');
      window.setTimeout(function () {
        window.location.href = '../';
      }, 400);
    });
  }

  function initAuthPages() {
    initRegisterPage();
    initLoginPage();
    initGoogleAuthButton();
  }

  window.SA_PUBLIC_AUTH = {
    registerPublicUser: registerPublicUser,
    loginPublicUser: loginPublicUser,
    loginWithGoogle: loginWithGoogle,
    logoutPublicUser: logoutPublicUser,
    loadPublicUserDoc: loadPublicUserDoc,
    assertPublicUserRole: assertPublicUserRole,
    resolvePublicEhliyetRestore: resolvePublicEhliyetRestore,
    buildSessionPayload: buildSessionPayload,
    hasPublicDrivingEnrollment: hasPublicDrivingEnrollment,
    hasLegacyPublicUserRole: hasLegacyPublicUserRole
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthPages);
  } else {
    initAuthPages();
  }
})();
