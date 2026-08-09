/**
 * Machine web auth — public + institution, callables, reset, Google.
 * Does not use public-auth.js / web-login.js / Driving sessions.
 */
(function () {
  'use strict';

  var REGION = 'us-central1';
  var HOME_HREF = '../';
  var LOGIN_HREF = './';
  var PLATFORM_TENANT_ID = 'surucu_akademisi';
  var busy = false;
  var selectedTenantId = '';
  var tenantsCache = [];

  var MSG = {
    FIREBASE: 'Giriş sistemi yüklenemedi. Sayfayı yenileyin.',
    EMAIL_REQUIRED: 'Geçerli bir e-posta girin.',
    PASS_REQUIRED: 'Şifre gereklidir.',
    PASS_SHORT: 'Şifre en az 6 karakter olmalıdır.',
    AUTH_FAILED: 'E-posta veya şifre hatalı.',
    USER_PASS_FAILED: 'Kullanıcı adı veya şifre hatalı.',
    TENANT_REQUIRED: 'Lütfen sürücü kursunuzu seçin.',
    USERNAME_REQUIRED: 'Kullanıcı adı / TC Kimlik No ve şifre gereklidir.',
    TOO_MANY: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.',
    NETWORK: 'Bağlantı sorunu oluştu. İnternetinizi kontrol edip tekrar deneyin.',
    GENERAL: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
    CONFLICT:
      'Bu hesap İş Makineleri aday girişi için uygun değil. Farklı bir hesap deneyin veya kurumunuzla iletişime geçin.',
    ENROLLMENT:
      'İş Makineleri kaydınız bulunamadı. Lütfen Hesap Oluştur ile kayıt olun veya kurum girişi kullanın.',
    PROGRAM_MISMATCH:
      'Bu üyelik İş Makineleri programına ait değil. Ehliyet girişi için ilgili portalı kullanın.',
    SOURCE_MISMATCH: 'Kayıt kaynağı seçilen giriş türü ile uyuşmuyor.',
    INACTIVE: 'Üyeliğiniz aktif değil. Lütfen kurumunuzla iletişime geçin.',
    EXPIRED: 'Kurum erişim süreniz dolmuş. Lütfen kurumunuzla iletişime geçin.',
    GOOGLE_CANCEL: 'Google girişi iptal edildi veya engellendi.',
    GOOGLE_FAIL: 'Google ile giriş yapılamadı. Lütfen tekrar deneyin.',
    NAME_REQUIRED: 'Lütfen adınızı ve soyadınızı girin.',
    NAME_SHORT: 'Ad Soyad en az 2 karakter olmalıdır.',
    NAME_LONG: 'Ad Soyad en fazla 200 karakter olabilir.',
    PASS_MISMATCH: 'Şifreler eşleşmiyor.',
    EMAIL_IN_USE: 'Bu e-posta adresi zaten kullanılıyor.',
    WEAK: 'Şifre çok zayıf. En az 6 karakter kullanın.',
    BOOTSTRAP_FAIL: 'Hesap oluşturuldu ancak İş Makineleri kaydı tamamlanamadı. Lütfen tekrar deneyin.',
    TENANTS_EMPTY: 'Aktif kurum bulunamadı. Lütfen daha sonra tekrar deneyin.',
    TENANTS_ERROR: 'Kurum listesi yüklenemedi. İnternet bağlantınızı kontrol edin.',
    RESET_EMAIL: 'Geçerli bir e-posta girin.',
    RESET_SEND_FAIL: 'Sıfırlama bağlantısı gönderilemedi. Lütfen tekrar deneyin.'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getFirebase() {
    return window.SA_WEB_FIREBASE || null;
  }

  function getSessionApi() {
    return window.SA_MACHINE_WEB_SESSION || null;
  }

  function getFunctions() {
    if (typeof firebase === 'undefined' || !firebase.app) return null;
    try {
      return firebase.app().functions(REGION);
    } catch (e) {
      console.warn('[machine-web-auth] functions unavailable', e);
      return null;
    }
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isValidEmail(email) {
    var e = normalizeEmail(email);
    return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  function normalizeUsername(input) {
    return String(input || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  function usernameOrEmailToEmail(input) {
    var raw = String(input || '').trim();
    if (!raw) return '';
    if (raw.indexOf('@') >= 0) return raw.toLowerCase();
    var normalized = normalizeUsername(raw);
    return normalized ? normalized + '@surucu.app' : '';
  }

  function normalizeFullName(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/\s+/g, ' ');
  }

  function extractMachineErrorCode(error) {
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
          if (/^MACHINE_[A-Z0-9_]+$/.test(details.trim())) return details.trim();
        }
      }
      if (error.machineCode != null && String(error.machineCode).trim()) {
        return String(error.machineCode).trim();
      }
      var c = error.code != null ? String(error.code).trim() : '';
      if (/^MACHINE_[A-Z0-9_]+$/.test(c)) return c;
    } catch (_) {}
    return '';
  }

  function mapAuthError(error, fallback) {
    var code = error && error.code ? String(error.code) : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return MSG.GOOGLE_CANCEL;
    }
    if (code === 'auth/popup-blocked') return MSG.GOOGLE_CANCEL;
    if (code === 'auth/email-already-in-use') return MSG.EMAIL_IN_USE;
    if (code === 'auth/weak-password') return MSG.WEAK;
    if (code === 'auth/too-many-requests') return MSG.TOO_MANY;
    if (code === 'auth/network-request-failed') return MSG.NETWORK;
    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-login-credentials' ||
      code === 'auth/invalid-email'
    ) {
      return fallback || MSG.AUTH_FAILED;
    }
    return fallback || MSG.GENERAL;
  }

  function mapMachineError(error, fallback) {
    var machineCode = extractMachineErrorCode(error);
    if (machineCode === 'MACHINE_ACCOUNT_CONFLICT') return MSG.CONFLICT;
    if (machineCode === 'MACHINE_ENROLLMENT_REQUIRED') return MSG.ENROLLMENT;
    if (machineCode === 'MACHINE_PROGRAM_MISMATCH') return MSG.PROGRAM_MISMATCH;
    if (machineCode === 'MACHINE_ENROLLMENT_SOURCE_MISMATCH') return MSG.SOURCE_MISMATCH;
    if (machineCode === 'MACHINE_MEMBERSHIP_INACTIVE') return MSG.INACTIVE;
    if (machineCode === 'MACHINE_ACCESS_EXPIRED') return MSG.EXPIRED;
    var code = error && error.code ? String(error.code) : '';
    if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') return MSG.NETWORK;
    if (code.indexOf('auth/') === 0) return mapAuthError(error, fallback);
    return fallback || MSG.GENERAL;
  }

  function setMessage(text, type) {
    var el = $('machine-web-message');
    if (!el) return;
    var t = String(text || '').trim();
    el.textContent = t;
    el.className = 'machine-web-message' + (t ? ' is-visible' : '');
    if (type === 'error') el.classList.add('machine-web-message--error');
    if (type === 'success') el.classList.add('machine-web-message--success');
  }

  function clearMessage() {
    setMessage('', '');
  }

  function showBusy(show) {
    var overlay = $('machine-web-auth-busy');
    if (!overlay) return;
    if (show) {
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('machine-web-busy-open');
    } else {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('machine-web-busy-open');
    }
  }

  function setControlsBusy(isBusy) {
    busy = !!isBusy;
    [
      'machine-web-login-submit',
      'machine-web-signup',
      'machine-web-google',
      'machine-web-institution-login-submit',
      'machine-web-forgot-password',
      'machine-web-mode-public',
      'machine-web-mode-institution',
      'machine-web-tenant'
    ].forEach(function (id) {
      var el = $(id);
      if (el && id !== 'machine-web-apple') el.disabled = !!isBusy;
    });
    showBusy(!!isBusy);
  }

  async function signOutQuiet() {
    var fb = getFirebase();
    var sessionApi = getSessionApi();
    if (sessionApi) sessionApi.clearMachineSession();
    if (fb && fb.auth && typeof fb.auth.signOut === 'function') {
      try {
        await fb.auth.signOut();
      } catch (_) {}
    }
  }

  async function callResolve(mode, tenantId) {
    var fns = getFunctions();
    if (!fns) throw Object.assign(new Error(MSG.FIREBASE), { code: 'functions/unavailable' });
    var callable = fns.httpsCallable('resolveMachineCandidateSession');
    var payload = { mode: mode };
    if (mode === 'institution') payload.tenantId = String(tenantId || '').trim();
    var result = await callable(payload);
    return (result && result.data && typeof result.data === 'object') ? result.data : {};
  }

  async function callBootstrap(fullName) {
    var fns = getFunctions();
    if (!fns) throw Object.assign(new Error(MSG.FIREBASE), { code: 'functions/unavailable' });
    var callable = fns.httpsCallable('bootstrapPublicMachineCandidate');
    var name = normalizeFullName(fullName);
    var payload = name ? { fullName: name } : {};
    var result = await callable(payload);
    return (result && result.data && typeof result.data === 'object') ? result.data : {};
  }

  function buildSessionFromResolve(data, mode, extras) {
    var fb = getFirebase();
    var user = fb && fb.auth && fb.auth.currentUser ? fb.auth.currentUser : null;
    var ex = extras || {};
    return {
      uid: data.uid != null ? String(data.uid) : (user && user.uid) || '',
      tenantId: data.tenantId != null ? String(data.tenantId) : '',
      programType: 'machine_operator',
      enrollmentSource: data.enrollmentSource != null ? String(data.enrollmentSource) : '',
      mode: mode,
      membershipId: data.membershipId != null ? String(data.membershipId) : '',
      accessStatus: data.accessStatus != null ? String(data.accessStatus) : '',
      accessExpiresAt: data.accessExpiresAt == null || data.accessExpiresAt === '' ? null : Number(data.accessExpiresAt),
      accessDaysRemaining:
        data.accessDaysRemaining == null || data.accessDaysRemaining === ''
          ? null
          : Number(data.accessDaysRemaining),
      displayName: ex.displayName || (user && (user.displayName || user.email)) || '',
      fullName: ex.fullName || '',
      tenantName: ex.tenantName || '',
      tenantLogoUrl: ex.tenantLogoUrl || '',
      showInstitutionLogo: ex.showInstitutionLogo !== false,
      savedAt: Date.now()
    };
  }

  async function finishPublicResolve(extras) {
    var data;
    try {
      data = await callResolve('public');
    } catch (e) {
      var code = extractMachineErrorCode(e);
      if (code === 'MACHINE_ENROLLMENT_REQUIRED') {
        try {
          await callBootstrap(extras && extras.fullName ? extras.fullName : '');
          data = await callResolve('public');
        } catch (e2) {
          var code2 = extractMachineErrorCode(e2);
          if (code2 === 'MACHINE_ACCOUNT_CONFLICT') {
            await signOutQuiet();
            throw Object.assign(new Error(MSG.CONFLICT), { machineCode: code2 });
          }
          await signOutQuiet();
          throw e2;
        }
      } else if (code === 'MACHINE_ACCOUNT_CONFLICT') {
        await signOutQuiet();
        throw Object.assign(new Error(MSG.CONFLICT), { machineCode: code });
      } else {
        await signOutQuiet();
        throw e;
      }
    }

    if (!data || data.ok !== true) {
      await signOutQuiet();
      throw Object.assign(new Error(MSG.GENERAL), { machineCode: 'MACHINE_RESOLVE_FAILED' });
    }

    var sessionApi = getSessionApi();
    var session = buildSessionFromResolve(data, 'public', extras || {});
    if (!sessionApi || !sessionApi.saveMachineSession(session)) {
      await signOutQuiet();
      throw Object.assign(new Error(MSG.GENERAL), { machineCode: 'MACHINE_SESSION_SAVE_FAILED' });
    }
    window.location.replace(HOME_HREF);
  }

  async function finishInstitutionResolve(tenantId, extras) {
    var data;
    try {
      data = await callResolve('institution', tenantId);
    } catch (e) {
      await signOutQuiet();
      throw e;
    }
    if (!data || data.ok !== true) {
      await signOutQuiet();
      throw Object.assign(new Error(MSG.GENERAL), { machineCode: 'MACHINE_RESOLVE_FAILED' });
    }
    var sessionApi = getSessionApi();
    var session = buildSessionFromResolve(data, 'institution', extras || {});
    if (!sessionApi || !sessionApi.saveMachineSession(session)) {
      await signOutQuiet();
      throw Object.assign(new Error(MSG.GENERAL), { machineCode: 'MACHINE_SESSION_SAVE_FAILED' });
    }
    window.location.replace(HOME_HREF);
  }

  async function handlePublicLogin() {
    if (busy) return;
    clearMessage();
    var email = normalizeEmail($('machine-web-email') && $('machine-web-email').value);
    var password = String(($('machine-web-public-password') && $('machine-web-public-password').value) || '');
    if (!isValidEmail(email)) {
      setMessage(MSG.EMAIL_REQUIRED, 'error');
      return;
    }
    if (password.length < 6) {
      setMessage(MSG.PASS_SHORT, 'error');
      return;
    }
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.auth) {
      setMessage(MSG.FIREBASE, 'error');
      return;
    }
    setControlsBusy(true);
    try {
      await fb.auth.signInWithEmailAndPassword(email, password);
      await finishPublicResolve({});
    } catch (e) {
      if (!(e && e.machineCode === 'MACHINE_ACCOUNT_CONFLICT')) {
        try {
          await signOutQuiet();
        } catch (_) {}
      }
      setMessage(mapMachineError(e, mapAuthError(e, MSG.AUTH_FAILED)), 'error');
      setControlsBusy(false);
    }
  }

  async function handleInstitutionLogin() {
    if (busy) return;
    clearMessage();
    var tenantId = String(selectedTenantId || '').trim();
    var username = String(($('machine-web-username') && $('machine-web-username').value) || '').trim();
    var password = String(
      ($('machine-web-institution-password') && $('machine-web-institution-password').value) || ''
    );
    if (!tenantId) {
      setMessage(MSG.TENANT_REQUIRED, 'error');
      return;
    }
    if (!username || !password) {
      setMessage(MSG.USERNAME_REQUIRED, 'error');
      return;
    }
    var email = usernameOrEmailToEmail(username);
    if (!email) {
      setMessage(MSG.USERNAME_REQUIRED, 'error');
      return;
    }
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.auth) {
      setMessage(MSG.FIREBASE, 'error');
      return;
    }
    var tenantMeta = null;
    for (var i = 0; i < tenantsCache.length; i++) {
      if (tenantsCache[i].id === tenantId) {
        tenantMeta = tenantsCache[i];
        break;
      }
    }
    setControlsBusy(true);
    try {
      await fb.auth.signInWithEmailAndPassword(email, password);
      await finishInstitutionResolve(tenantId, {
        displayName: username,
        tenantName: tenantMeta ? tenantMeta.label : '',
        showInstitutionLogo: true
      });
    } catch (e) {
      try {
        await signOutQuiet();
      } catch (_) {}
      setMessage(mapMachineError(e, mapAuthError(e, MSG.USER_PASS_FAILED)), 'error');
      setControlsBusy(false);
    }
  }

  async function handleGoogleLogin() {
    if (busy) return;
    clearMessage();
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.auth || typeof firebase === 'undefined') {
      setMessage(MSG.FIREBASE, 'error');
      return;
    }
    setControlsBusy(true);
    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      var cred = await fb.auth.signInWithPopup(provider);
      var user = (cred && cred.user) || fb.auth.currentUser;
      var fullName = user && user.displayName ? normalizeFullName(user.displayName) : '';
      await finishPublicResolve({
        fullName: fullName,
        displayName: fullName || (user && user.email) || ''
      });
    } catch (e) {
      try {
        await signOutQuiet();
      } catch (_) {}
      setMessage(mapMachineError(e, mapAuthError(e, MSG.GOOGLE_FAIL)), 'error');
      setControlsBusy(false);
    }
  }

  function openSignupModal() {
    clearMessage();
    var modal = $('machine-web-signup-modal');
    var err = $('machine-web-signup-error');
    if (err) {
      err.textContent = '';
      err.classList.remove('is-visible');
    }
    ['machine-web-signup-fullname', 'machine-web-signup-email', 'machine-web-signup-password', 'machine-web-signup-password-confirm'].forEach(
      function (id) {
        var el = $(id);
        if (el) el.value = '';
      }
    );
    var emailEl = $('machine-web-email');
    var signupEmail = $('machine-web-signup-email');
    if (emailEl && signupEmail && isValidEmail(emailEl.value)) {
      signupEmail.value = normalizeEmail(emailEl.value);
    }
    if (modal) {
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeSignupModal(ev) {
    if (busy) return;
    if (ev && ev.target && ev.currentTarget && ev.target !== ev.currentTarget && !ev.target.closest('[data-machine-signup-dismiss]')) {
      return;
    }
    var modal = $('machine-web-signup-modal');
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  async function submitSignup() {
    if (busy) return;
    var err = $('machine-web-signup-error');
    function setErr(msg) {
      if (!err) return;
      err.textContent = msg || '';
      err.classList.toggle('is-visible', !!msg);
    }
    setErr('');
    var fullName = normalizeFullName($('machine-web-signup-fullname') && $('machine-web-signup-fullname').value);
    var email = normalizeEmail($('machine-web-signup-email') && $('machine-web-signup-email').value);
    var password = String(($('machine-web-signup-password') && $('machine-web-signup-password').value) || '');
    var confirm = String(
      ($('machine-web-signup-password-confirm') && $('machine-web-signup-password-confirm').value) || ''
    );
    if (!fullName) {
      setErr(MSG.NAME_REQUIRED);
      return;
    }
    if (fullName.length < 2) {
      setErr(MSG.NAME_SHORT);
      return;
    }
    if (fullName.length > 200) {
      setErr(MSG.NAME_LONG);
      return;
    }
    if (!isValidEmail(email)) {
      setErr(MSG.EMAIL_REQUIRED);
      return;
    }
    if (password.length < 6) {
      setErr(MSG.PASS_SHORT);
      return;
    }
    if (password !== confirm) {
      setErr(MSG.PASS_MISMATCH);
      return;
    }
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.auth) {
      setErr(MSG.FIREBASE);
      return;
    }
    setControlsBusy(true);
    try {
      await fb.auth.createUserWithEmailAndPassword(email, password);
      try {
        await callBootstrap(fullName);
      } catch (bootErr) {
        await signOutQuiet();
        setControlsBusy(false);
        setErr(mapMachineError(bootErr, MSG.BOOTSTRAP_FAIL));
        return;
      }
      await finishPublicResolve({ fullName: fullName, displayName: fullName });
    } catch (e) {
      try {
        await signOutQuiet();
      } catch (_) {}
      setControlsBusy(false);
      setErr(mapMachineError(e, mapAuthError(e, MSG.GENERAL)));
    }
  }

  var resetBusy = false;

  function openResetModal() {
    if (busy) return;
    clearMessage();
    resetBusy = false;
    var emailEl = $('machine-web-reset-email');
    var loginEmail = $('machine-web-email');
    var raw = loginEmail ? String(loginEmail.value || '').trim() : '';
    if (emailEl) emailEl.value = isValidEmail(raw) ? normalizeEmail(raw) : '';
    var err = $('machine-web-reset-error');
    if (err) {
      err.innerHTML = '';
      err.classList.remove('is-visible');
    }
    var modal = $('machine-web-reset-modal');
    if (modal) {
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeResetModal(ev) {
    if (resetBusy) return;
    if (ev && ev.target && ev.currentTarget && ev.target !== ev.currentTarget && !ev.target.closest('[data-machine-reset-dismiss]')) {
      return;
    }
    var modal = $('machine-web-reset-modal');
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    var emailEl = $('machine-web-reset-email');
    if (emailEl) emailEl.value = '';
    var err = $('machine-web-reset-error');
    if (err) {
      err.innerHTML = '';
      err.classList.remove('is-visible');
    }
    var submit = $('machine-web-reset-submit');
    var cancel = $('machine-web-reset-cancel');
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Bağlantıyı Gönder';
    }
    if (cancel) cancel.disabled = false;
  }

  async function submitReset() {
    if (resetBusy) return;
    var err = $('machine-web-reset-error');
    function setErr(msg) {
      if (!err) return;
      err.innerHTML = '';
      err.textContent = msg || '';
      err.style.color = '#fecaca';
      err.classList.toggle('is-visible', !!msg);
    }
    function showSuccess() {
      if (!err) return;
      err.innerHTML = '';
      var main = document.createElement('p');
      main.className = 'machine-web-reset-success-main';
      main.textContent = 'Şifre sıfırlama bağlantınız gönderilmiştir. E-posta kutunuzu kontrol ediniz.';
      var note = document.createElement('p');
      note.className = 'machine-web-reset-success-note';
      note.textContent = 'Mesaj görünmüyorsa Gereksiz/Spam klasörünü de kontrol ediniz.';
      err.appendChild(main);
      err.appendChild(note);
      err.style.color = '';
      err.classList.add('is-visible');
    }
    var email = normalizeEmail($('machine-web-reset-email') && $('machine-web-reset-email').value);
    if (!isValidEmail(email)) {
      setErr(MSG.RESET_EMAIL);
      return;
    }
    var fb = getFirebase();
    if (!fb || !fb.ready || !fb.auth) {
      setErr(MSG.FIREBASE);
      return;
    }
    resetBusy = true;
    var submit = $('machine-web-reset-submit');
    var cancel = $('machine-web-reset-cancel');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Gönderiliyor…';
    }
    if (cancel) cancel.disabled = true;
    try {
      await fb.auth.sendPasswordResetEmail(email);
      showSuccess();
    } catch (e) {
      var code = e && e.code ? String(e.code) : '';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        showSuccess();
      } else if (code === 'auth/too-many-requests') {
        setErr(MSG.TOO_MANY);
      } else if (code === 'auth/network-request-failed') {
        setErr(MSG.NETWORK);
      } else {
        setErr(MSG.RESET_SEND_FAIL);
      }
    } finally {
      resetBusy = false;
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Bağlantıyı Gönder';
      }
      if (cancel) cancel.disabled = false;
    }
  }

  function tenantLabel(data, id) {
    if (!data || typeof data !== 'object') return id;
    var name = data.displayName || data.name || data.title;
    if (name && String(name).trim()) return String(name).trim();
    return id;
  }

  function updateTenantLabel() {
    var label = $('machine-web-tenant-label');
    if (!label) return;
    if (!selectedTenantId) {
      label.textContent = 'Sürücü Kursunuzu Seçin';
      return;
    }
    for (var i = 0; i < tenantsCache.length; i++) {
      if (tenantsCache[i].id === selectedTenantId) {
        label.textContent = tenantsCache[i].label;
        return;
      }
    }
    label.textContent = selectedTenantId;
  }

  function closeTenantPopover() {
    var pop = $('machine-web-tenant-popover');
    if (pop) pop.hidden = true;
    var btn = $('machine-web-tenant');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function openTenantPopover() {
    var pop = $('machine-web-tenant-popover');
    var list = $('machine-web-tenant-list');
    if (!pop || !list) return;
    list.innerHTML = '';
    if (!tenantsCache.length) {
      var empty = document.createElement('div');
      empty.className = 'machine-web-tenant-empty';
      empty.textContent = MSG.TENANTS_EMPTY;
      list.appendChild(empty);
    } else {
      tenantsCache.forEach(function (t) {
        var opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'machine-web-tenant-option' + (t.id === selectedTenantId ? ' is-selected' : '');
        opt.textContent = t.label;
        opt.addEventListener('click', function () {
          selectedTenantId = t.id;
          updateTenantLabel();
          closeTenantPopover();
          clearMessage();
        });
        list.appendChild(opt);
      });
    }
    pop.hidden = false;
    var btn = $('machine-web-tenant');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  async function loadTenants() {
    var fb = getFirebase();
    var status = $('machine-web-tenant-status');
    if (!fb || !fb.ready || !fb.db) {
      if (status) status.textContent = MSG.FIREBASE;
      return;
    }
    if (status) status.textContent = 'Kurumlar yükleniyor…';
    try {
      var snap = await fb.db.collection('tenants').where('status', 'in', ['active', 'trial']).get();
      var docs = (snap && snap.docs ? snap.docs : []).map(function (doc) {
        return { id: doc.id, label: tenantLabel(doc.data(), doc.id) };
      });
      docs.sort(function (a, b) {
        return a.label.localeCompare(b.label, 'tr');
      });
      tenantsCache = docs;
      if (status) status.textContent = docs.length ? '' : MSG.TENANTS_EMPTY;
      updateTenantLabel();
    } catch (e) {
      console.warn('[machine-web-auth] loadTenants failed', e);
      tenantsCache = [];
      if (status) status.textContent = MSG.TENANTS_ERROR;
    }
  }

  function setMode(mode) {
    var isPublic = mode !== 'institution';
    var modePublicBtn = $('machine-web-mode-public');
    var modeInstBtn = $('machine-web-mode-institution');
    var panelPublic = $('machine-web-panel-public');
    var panelInst = $('machine-web-panel-institution');
    if (modePublicBtn) {
      modePublicBtn.classList.toggle('is-active', isPublic);
      modePublicBtn.setAttribute('aria-selected', isPublic ? 'true' : 'false');
    }
    if (modeInstBtn) {
      modeInstBtn.classList.toggle('is-active', !isPublic);
      modeInstBtn.setAttribute('aria-selected', !isPublic ? 'true' : 'false');
    }
    if (panelPublic) panelPublic.hidden = !isPublic;
    if (panelInst) panelInst.hidden = isPublic;
    clearMessage();
    closeTenantPopover();
  }

  function redirectIfSession() {
    var fb = getFirebase();
    var sessionApi = getSessionApi();
    if (!fb || !fb.ready || !fb.auth || !sessionApi) return;
    fb.auth.onAuthStateChanged(function (user) {
      if (!user) return;
      var session = sessionApi.requireMachineSession();
      if (session) {
        window.location.replace(HOME_HREF);
      }
    });
  }

  function bind() {
    var modePublicBtn = $('machine-web-mode-public');
    var modeInstBtn = $('machine-web-mode-institution');
    if (modePublicBtn) {
      modePublicBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (busy) return;
        setMode('public');
      });
    }
    if (modeInstBtn) {
      modeInstBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (busy) return;
        setMode('institution');
      });
    }

    var loginBtn = $('machine-web-login-submit');
    if (loginBtn) loginBtn.addEventListener('click', function (e) { e.preventDefault(); handlePublicLogin(); });

    var instLogin = $('machine-web-institution-login-submit');
    if (instLogin) instLogin.addEventListener('click', function (e) { e.preventDefault(); handleInstitutionLogin(); });

    var signupBtn = $('machine-web-signup');
    if (signupBtn) signupBtn.addEventListener('click', function (e) { e.preventDefault(); openSignupModal(); });

    var googleBtn = $('machine-web-google');
    if (googleBtn) googleBtn.addEventListener('click', function (e) { e.preventDefault(); handleGoogleLogin(); });

    var appleBtn = $('machine-web-apple');
    if (appleBtn) {
      appleBtn.disabled = true;
      appleBtn.addEventListener('click', function (e) {
        e.preventDefault();
      });
    }

    var forgot = $('machine-web-forgot-password');
    if (forgot) forgot.addEventListener('click', function (e) { e.preventDefault(); openResetModal(); });

    var tenantBtn = $('machine-web-tenant');
    if (tenantBtn) {
      tenantBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (busy) return;
        var pop = $('machine-web-tenant-popover');
        if (pop && !pop.hidden) closeTenantPopover();
        else openTenantPopover();
      });
    }

    document.addEventListener('click', function (e) {
      var pop = $('machine-web-tenant-popover');
      var btn = $('machine-web-tenant');
      if (!pop || pop.hidden) return;
      if (pop.contains(e.target) || (btn && btn.contains(e.target))) return;
      closeTenantPopover();
    });

    var signupSubmit = $('machine-web-signup-submit');
    if (signupSubmit) signupSubmit.addEventListener('click', function (e) { e.preventDefault(); submitSignup(); });
    document.querySelectorAll('[data-machine-signup-dismiss]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        closeSignupModal({ target: el, currentTarget: el });
      });
    });
    var signupModal = $('machine-web-signup-modal');
    if (signupModal) {
      signupModal.addEventListener('click', function (e) {
        if (e.target === signupModal) closeSignupModal(e);
      });
    }

    var resetSubmit = $('machine-web-reset-submit');
    if (resetSubmit) resetSubmit.addEventListener('click', function (e) { e.preventDefault(); submitReset(); });
    document.querySelectorAll('[data-machine-reset-dismiss]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        closeResetModal({ target: el, currentTarget: el });
      });
    });
    var resetModal = $('machine-web-reset-modal');
    if (resetModal) {
      resetModal.addEventListener('click', function (e) {
        if (e.target === resetModal) closeResetModal(e);
      });
    }

    ['machine-web-email', 'machine-web-public-password'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handlePublicLogin();
        }
      });
    });
    ['machine-web-username', 'machine-web-institution-password'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleInstitutionLogin();
        }
      });
    });

    setMode('public');
    loadTenants();
    redirectIfSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.SA_MACHINE_WEB_AUTH = {
    usernameOrEmailToEmail: usernameOrEmailToEmail,
    loadTenants: loadTenants
  };
})();
