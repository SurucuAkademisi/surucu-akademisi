/**
 * Public portal Firebase Auth + users/{uid} (P2.2b).
 * Separate from institution web-login.js / sa_web_session_v1.
 */
(function () {
  'use strict';

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
    TOO_MANY: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.'
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

  function mapAuthError(error, fallback) {
    var code = error && error.code ? String(error.code) : '';
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
    return fallback || MSG.LOGIN_FAILED;
  }

  function assertPublicUserRole(userDoc) {
    var data = userDoc && typeof userDoc === 'object' ? userDoc : {};
    var role = String(data.role || data.globalRole || '').trim().toLowerCase();
    if (role !== 'public_user') {
      return { ok: false, message: MSG.NOT_PUBLIC_USER };
    }
    return { ok: true, userDoc: data };
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

  function buildSessionPayload(uid, email, userDoc) {
    var data = userDoc || {};
    var firstName = String(data.firstName || '').trim();
    var lastName = String(data.lastName || '').trim();
    var displayName = String(data.displayName || '').trim();
    if (!displayName) {
      displayName = (firstName + ' ' + lastName).trim() || normalizeEmail(email).split('@')[0] || 'Üye';
    }
    return {
      uid: uid,
      email: normalizeEmail(email || data.email),
      firstName: firstName,
      lastName: lastName,
      displayName: displayName,
      role: 'public_user',
      savedAt: Date.now()
    };
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
    var sessionApi = getSessionApi();
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

      if (sessionApi) {
        sessionApi.savePublicSession(buildSessionPayload(uid, email, userDoc));
      }

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
    var sessionApi = getSessionApi();
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

      var roleCheck = assertPublicUserRole(userDoc);
      if (!roleCheck.ok) {
        await logoutPublicUser();
        return { ok: false, message: roleCheck.message };
      }

      if (sessionApi) {
        sessionApi.savePublicSession(buildSessionPayload(user.uid, email, userDoc));
      }

      return { ok: true, uid: user.uid };
    } catch (e) {
      console.warn('[public-auth] loginPublicUser failed', e);
      return { ok: false, message: mapAuthError(e, MSG.LOGIN_FAILED) };
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

  function initAuthPages() {
    initRegisterPage();
    initLoginPage();
  }

  window.SA_PUBLIC_AUTH = {
    registerPublicUser: registerPublicUser,
    loginPublicUser: loginPublicUser,
    logoutPublicUser: logoutPublicUser,
    loadPublicUserDoc: loadPublicUserDoc,
    assertPublicUserRole: assertPublicUserRole
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthPages);
  } else {
    initAuthPages();
  }
})();
