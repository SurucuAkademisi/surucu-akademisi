/* Username/Email + Password student login helper (Firebase v8 global) */
(function () {
  'use strict';

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
    const host = document.querySelector('.header-actions');
    if (!host) return;

    let badge = document.getElementById('student-remaining-days');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'student-remaining-days';
      badge.style.fontSize = '0.85rem';
      badge.style.color = '#fff';
      badge.style.background = 'rgba(0,0,0,0.35)';
      badge.style.border = '1px solid rgba(255,255,255,0.2)';
      badge.style.borderRadius = '999px';
      badge.style.padding = '6px 10px';
      host.appendChild(badge);
    }
    badge.textContent = 'Kalan gün: ' + Math.max(0, Number(days || 0));
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

  async function validateStudentAccess(user) {
    if (!user || !user.uid) {
      return { ok: false, userMessage: 'Giriş başarısız.' };
    }

    try {
      const snap = await firebase.firestore().collection('users').doc(user.uid).get();
      if (!snap.exists) {
        await firebase.auth().signOut();
        clearRemainingDaysBadge();
        return { ok: false, userMessage: 'Hesabınız pasif. Kurumunuzla iletişime geçin.' };
      }

      const data = snap.data() || {};
      if (data.isActive === false) {
        await firebase.auth().signOut();
        clearRemainingDaysBadge();
        return { ok: false, userMessage: 'Hesabınız pasif. Kurumunuzla iletişime geçin.' };
      }

      const expiresAtMs = data.expiresAt && typeof data.expiresAt.toMillis === 'function' ? data.expiresAt.toMillis() : 0;
      if (!expiresAtMs || expiresAtMs <= Date.now()) {
        await firebase.auth().signOut();
        clearRemainingDaysBadge();
        return { ok: false, userMessage: 'Süreniz dolmuş. Kurumunuzla iletişime geçin.' };
      }

      setRemainingDaysBadge(remainingDaysFromMillis(expiresAtMs));
      return { ok: true, remainingDays: remainingDaysFromMillis(expiresAtMs) };
    } catch {
      await firebase.auth().signOut();
      clearRemainingDaysBadge();
      return { ok: false, userMessage: 'Giriş başarısız.' };
    }
  }

  async function signIn(usernameOrEmail, password) {
    const email = usernameOrEmailToEmail(usernameOrEmail);
    const pass = String(password || '');

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
      const access = await validateStudentAccess(firebase.auth().currentUser);
      if (!access.ok) {
        const err = new Error(access.userMessage || 'Giriş başarısız.');
        err.userMessage = access.userMessage || 'Giriş başarısız.';
        throw err;
      }
      return true;
    } catch (e) {
      const message = e && e.userMessage ? String(e.userMessage) : mapAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      throw err;
    }
  }

  async function validateCurrentUser() {
    const user = firebase && firebase.auth ? firebase.auth().currentUser : null;
    if (!user) {
      clearRemainingDaysBadge();
      return { ok: false, userMessage: 'Giriş başarısız.' };
    }
    return validateStudentAccess(user);
  }

  window.SA_LOGIN = {
    signIn,
    validateCurrentUser,
    normalizeUsername,
  };
})();
