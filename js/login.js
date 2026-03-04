/* Username + Password login helper (Firebase v8 global) */
(function () {
  'use strict';

  function normalizeUsername(input) {
    return String(input || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9._-]/g, '');
  }

  function usernameToEmail(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';

    // If user typed a real email, use it as-is.
    if (raw.includes('@')) return raw;

    const normalized = normalizeUsername(raw);
    if (!normalized) return '';
    return normalized + '@surucu.local';
  }

  function mapAuthErrorToMessage(error) {
    const code = (error && error.code) ? String(error.code) : '';
    switch (code) {
      case 'auth/invalid-email':
        return 'Kullanıcı adı geçersiz.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Kullanıcı adı veya şifre hatalı.';
      case 'auth/too-many-requests':
        return 'Çok fazla deneme. Biraz sonra tekrar deneyin.';
      default:
        return 'Giriş başarısız.';
    }
  }

  async function signIn(username, password) {
    const email = usernameToEmail(username);
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
      await firebase.auth().signInWithEmailAndPassword(email, pass);
      return true;
    } catch (e) {
      const message = mapAuthErrorToMessage(e);
      const err = new Error(message);
      err.userMessage = message;
      throw err;
    }
  }

  window.SA_LOGIN = {
    signIn,
    usernameToEmail,
    normalizeUsername,
  };
})();
