/**
 * Student web login (W3) — read-only Firestore, Firebase Auth email/password.
 */
(function () {
  'use strict';

  var MSG = {
    TENANT_REQUIRED: 'Lütfen kurumunuzu seçin.',
    USER_PASS_REQUIRED: 'Kullanıcı adı ve şifre gereklidir.',
    FIREBASE_NOT_READY: 'Giriş sistemi yüklenemedi. Sayfayı yenileyin.',
    TENANTS_LOADING: 'Kurumlar yükleniyor…',
    TENANTS_EMPTY: 'Aktif kurum bulunamadı. Lütfen daha sonra tekrar deneyin.',
    TENANTS_ERROR: 'Kurum listesi yüklenemedi. İnternet bağlantınızı kontrol edin.',
    STUDENT_NOT_FOUND: 'Öğrenci kaydı bulunamadı. Lütfen kurumunuzla iletişime geçin.',
    STUDENTS_ONLY: 'Bu panel yalnızca öğrenciler içindir.',
    ROLE_INVALID: 'Hesap rolü doğrulanamadı. Lütfen kurumunuzla iletişime geçin.',
    MEMBERSHIP_INVALID: 'Bu kuruma kayıtlı aktif öğrenci üyeliğiniz bulunamadı.',
    TENANT_INACTIVE: 'Seçili kurum şu anda aktif değil.',
    AUTH_FAILED: 'Kullanıcı adı veya şifre hatalı.',
    LOGIN_FAILED: 'Giriş başarısız. Lütfen tekrar deneyin.'
  };

  var tenantSelect = null;
  var usernameInput = null;
  var passwordInput = null;
  var submitBtn = null;
  var msgEl = null;
  var tenantStatusEl = null;

  function getFirebase() {
    return window.SA_WEB_FIREBASE || null;
  }

  function getSessionApi() {
    return window.SA_WEB_SESSION || null;
  }

  function normalizeUsername(input) {
    return String(input || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  function usernameOrEmailToEmail(input) {
    var raw = String(input || '').trim();
    if (!raw) return '';
    if (raw.indexOf('@') >= 0) return raw.toLowerCase();
    var normalized = normalizeUsername(raw);
    return normalized ? normalized + '@surucu.app' : '';
  }

  function mapAuthError(error) {
    var code = error && error.code ? String(error.code) : '';
    if (code === 'auth/invalid-email') return MSG.AUTH_FAILED;
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-login-credentials') {
      return MSG.AUTH_FAILED;
    }
    if (code === 'auth/too-many-requests') return 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.';
    return MSG.LOGIN_FAILED;
  }

  function setMessage(text, type) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'auth-msg' + (type === 'error' ? ' auth-msg-error' : type === 'success' ? ' auth-msg-success' : '');
  }

  function setTenantStatus(text, isError) {
    if (!tenantStatusEl) return;
    tenantStatusEl.textContent = text || '';
    tenantStatusEl.className = 'tenant-load-status' + (isError ? ' tenant-load-status-error' : '');
  }

  function setSubmitDisabled(disabled) {
    if (submitBtn) submitBtn.disabled = !!disabled;
    if (tenantSelect && !tenantSelect.dataset.loading) {
      tenantSelect.disabled = !!disabled && !tenantSelect.options.length;
    }
  }

  function tenantLabel(data, id) {
    if (!data || typeof data !== 'object') return id;
    var name = data.displayName || data.name || data.title;
    if (name && String(name).trim()) return String(name).trim();
    return id;
  }

  function refreshTenantSelectUi() {
    if (window.SA_WEB_TENANT_SELECT && typeof window.SA_WEB_TENANT_SELECT.refresh === 'function') {
      window.SA_WEB_TENANT_SELECT.refresh();
    }
  }

  async function loadTenants() {
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.db) {
      setTenantStatus(MSG.FIREBASE_NOT_READY, true);
      refreshTenantSelectUi();
      return;
    }

    if (!tenantSelect) return;

    tenantSelect.dataset.loading = '1';
    tenantSelect.disabled = true;
    setTenantStatus(MSG.TENANTS_LOADING, false);
    refreshTenantSelectUi();

    try {
      var snap = await fb.db.collection('tenants')
        .where('status', 'in', ['active', 'trial'])
        .get();

      tenantSelect.innerHTML = '';
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Kurum seçin';
      tenantSelect.appendChild(placeholder);

      if (!snap || !snap.docs || !snap.docs.length) {
        delete tenantSelect.dataset.loading;
        setTenantStatus(MSG.TENANTS_EMPTY, true);
        refreshTenantSelectUi();
        return;
      }

      var docs = snap.docs.slice().sort(function (a, b) {
        var la = tenantLabel(a.data(), a.id);
        var lb = tenantLabel(b.data(), b.id);
        return la.localeCompare(lb, 'tr');
      });

      docs.forEach(function (doc) {
        var opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = tenantLabel(doc.data(), doc.id);
        tenantSelect.appendChild(opt);
      });

      tenantSelect.disabled = false;
      delete tenantSelect.dataset.loading;
      setTenantStatus('', false);
      refreshTenantSelectUi();
    } catch (e) {
      console.warn('[web-login] loadTenants failed', e);
      delete tenantSelect.dataset.loading;
      setTenantStatus(MSG.TENANTS_ERROR, true);
      refreshTenantSelectUi();
    }
  }

  async function signOutUser() {
    var fb = getFirebase();
    var sessionApi = getSessionApi();
    if (sessionApi) sessionApi.clearWebSession();
    if (fb && fb.auth && typeof fb.auth.signOut === 'function') {
      try {
        await fb.auth.signOut();
      } catch (e) {
        console.warn('[web-login] signOut failed', e);
      }
    }
  }

  async function validatePlatformUser(uid) {
    var fb = getFirebase();
    if (!fb || !fb.db) {
      return { ok: false, message: MSG.LOGIN_FAILED };
    }

    var snap = await fb.db.collection('users').doc(uid).get();
    if (!snap.exists) {
      return { ok: false, message: MSG.STUDENT_NOT_FOUND };
    }

    var data = snap.data() || {};
    var role = String(data.role || data.globalRole || '').trim().toLowerCase();

    if (role === 'super_admin' || role === 'institution_admin') {
      return { ok: false, message: MSG.STUDENTS_ONLY };
    }

    if (!role) {
      return { ok: false, message: MSG.ROLE_INVALID };
    }

    if (role !== 'student') {
      return { ok: false, message: MSG.STUDENTS_ONLY };
    }

    return {
      ok: true,
      userDoc: data,
      globalRole: role,
      username: String(data.username || '').trim(),
      displayName: String(data.displayName || data.fullName || data.username || '').trim()
    };
  }

  async function validateMembership(uid, tenantId) {
    var fb = getFirebase();
    if (!fb || !fb.db) {
      return { ok: false, message: MSG.MEMBERSHIP_INVALID };
    }

    var tid = String(tenantId || '').trim();
    var membership = null;
    var membershipId = null;

    try {
      var compositeId = uid + '_' + tid;
      var directSnap = await fb.db.collection('tenantMemberships').doc(compositeId).get();
      if (directSnap.exists) {
        membership = directSnap.data() || {};
        membershipId = directSnap.id;
      }
    } catch (e) {
      console.warn('[web-login] composite membership read failed', e);
    }

    if (!membership) {
      try {
        var querySnap = await fb.db.collection('tenantMemberships')
          .where('uid', '==', uid)
          .get();
        if (querySnap && querySnap.docs) {
          for (var i = 0; i < querySnap.docs.length; i++) {
            var d = querySnap.docs[i];
            var d2 = d.data() || {};
            var docTenantId = String(d2.tenantId || '').trim();
            if (docTenantId === tid) {
              membership = d2;
              membershipId = d.id;
              break;
            }
          }
        }
      } catch (e) {
        console.warn('[web-login] membership query failed', e);
      }
    }

    if (!membership) {
      return { ok: false, message: MSG.MEMBERSHIP_INVALID };
    }

    var status = String(membership.status || '').trim().toLowerCase();
    if (status !== 'active') {
      return { ok: false, message: MSG.MEMBERSHIP_INVALID };
    }

    var memTenantId = String(membership.tenantId || '').trim();
    if (memTenantId !== tid) {
      return { ok: false, message: MSG.MEMBERSHIP_INVALID };
    }

    if ('role' in membership && membership.role != null && String(membership.role).trim() !== '') {
      var memRole = String(membership.role).trim().toLowerCase();
      if (memRole !== 'student') {
        return { ok: false, message: MSG.MEMBERSHIP_INVALID };
      }
    }

    return {
      ok: true,
      membershipId: membershipId,
      tenantRole: String(membership.role || 'student').trim().toLowerCase()
    };
  }

  async function loadShowInstitutionLogo(tenantId) {
    var fb = getFirebase();
    if (!fb || !fb.db) return true;
    try {
      var settingsSnap = await fb.db.collection('tenantSettings').doc(tenantId).get();
      if (settingsSnap.exists && settingsSnap.data()) {
        return settingsSnap.data().showInstitutionLogo !== false;
      }
    } catch (e) {
      console.warn('[web-login] tenantSettings read failed', e);
    }
    return true;
  }

  async function validateTenant(tenantId) {
    var fb = getFirebase();
    if (!fb || !fb.db) {
      return { ok: false, message: MSG.TENANT_INACTIVE };
    }

    var tid = String(tenantId || '').trim();
    var snap = await fb.db.collection('tenants').doc(tid).get();
    if (!snap.exists) {
      return { ok: false, message: MSG.TENANT_INACTIVE };
    }

    var data = snap.data() || {};
    var status = String(data.status || '').trim().toLowerCase();
    if (status !== 'active' && status !== 'trial') {
      return { ok: false, message: MSG.TENANT_INACTIVE };
    }

    var brand = window.SA_WEB_TENANT_BRAND;
    var tenantLogoUrl = brand && brand.resolveWebTenantLogoUrl
      ? brand.resolveWebTenantLogoUrl(tid, data)
      : '../assets/tenant-logos/' + tid + '.png';
    var showInstitutionLogo = await loadShowInstitutionLogo(tid);

    return {
      ok: true,
      tenantName: tenantLabel(data, tid),
      tenantLogoUrl: tenantLogoUrl,
      showInstitutionLogo: showInstitutionLogo
    };
  }

  async function handleLoginSubmit(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();

    setMessage('');

    var tenantId = tenantSelect ? String(tenantSelect.value || '').trim() : '';
    var username = usernameInput ? String(usernameInput.value || '').trim() : '';
    var password = passwordInput ? String(passwordInput.value || '') : '';

    if (!tenantId) {
      setMessage(MSG.TENANT_REQUIRED, 'error');
      return;
    }
    if (!username || !password) {
      setMessage(MSG.USER_PASS_REQUIRED, 'error');
      return;
    }

    var fb = getFirebase();
    var sessionApi = getSessionApi();
    if (!fb || !fb.ready || !fb.auth || !fb.db) {
      setMessage(MSG.FIREBASE_NOT_READY, 'error');
      return;
    }

    var email = usernameOrEmailToEmail(username);
    if (!email) {
      setMessage(MSG.USER_PASS_REQUIRED, 'error');
      return;
    }

    setSubmitDisabled(true);
    var loginSucceeded = false;

    try {
      if (sessionApi) sessionApi.saveSelectedTenantId(tenantId);

      await fb.auth.signInWithEmailAndPassword(email, password);
      var user = fb.auth.currentUser;
      if (!user || !user.uid) {
        throw new Error(MSG.LOGIN_FAILED);
      }

      var userCheck = await validatePlatformUser(user.uid);
      if (!userCheck.ok) {
        await signOutUser();
        setMessage(userCheck.message, 'error');
        return;
      }

      var memCheck = await validateMembership(user.uid, tenantId);
      if (!memCheck.ok) {
        await signOutUser();
        setMessage(memCheck.message, 'error');
        return;
      }

      var tenantCheck = await validateTenant(tenantId);
      if (!tenantCheck.ok) {
        await signOutUser();
        setMessage(tenantCheck.message, 'error');
        return;
      }

      var displayName = userCheck.displayName || user.displayName || userCheck.username || username;
      var session = {
        uid: user.uid,
        tenantId: tenantId,
        tenantName: tenantCheck.tenantName,
        tenantRole: memCheck.tenantRole,
        membershipId: memCheck.membershipId || (user.uid + '_' + tenantId),
        username: userCheck.username || normalizeUsername(username),
        displayName: displayName,
        globalRole: userCheck.globalRole,
        tenantLogoUrl: tenantCheck.tenantLogoUrl || '',
        showInstitutionLogo: tenantCheck.showInstitutionLogo !== false,
        savedAt: Date.now()
      };

      if (!sessionApi || !sessionApi.saveWebSession(session)) {
        await signOutUser();
        setMessage(MSG.LOGIN_FAILED, 'error');
        return;
      }

      loginSucceeded = true;
      if (submitBtn) {
        submitBtn.textContent = 'Yönlendiriliyor…';
        submitBtn.disabled = true;
      }
      window.location.replace('home.html');
      return;
    } catch (e) {
      await signOutUser();
      setMessage(mapAuthError(e), 'error');
    } finally {
      if (!loginSucceeded) {
        setSubmitDisabled(false);
      }
    }
  }

  function redirectIfAlreadyLoggedIn() {
    var fb = getFirebase();
    var sessionApi = getSessionApi();
    if (!fb || !fb.auth || !sessionApi) return;

    fb.auth.onAuthStateChanged(function (user) {
      if (!user) return;
      var session = sessionApi.requireWebStudentSession();
      if (session) {
        window.location.href = 'home.html';
      }
    });
  }

  function init() {
    tenantSelect = document.getElementById('login-tenant');
    usernameInput = document.getElementById('login-username');
    passwordInput = document.getElementById('login-password');
    submitBtn = document.getElementById('login-submit');
    msgEl = document.getElementById('login-msg');
    tenantStatusEl = document.getElementById('tenant-load-status');

    var form = document.getElementById('login-form');
    if (form) {
      form.addEventListener('submit', handleLoginSubmit);
    } else if (submitBtn) {
      submitBtn.addEventListener('click', handleLoginSubmit);
    }

    loadTenants();
    redirectIfAlreadyLoggedIn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
