/* Firebase init (v8 compat - global firebase) */
(function () {
  'use strict';

  const cfg =
    (typeof window !== 'undefined' && (window.firebaseConfig || window.FIREBASE_CONFIG)) ||
    (typeof globalThis !== 'undefined' && (globalThis.firebaseConfig || globalThis.FIREBASE_CONFIG)) ||
    null;

  function fail(err) {
    try {
      // Kullanıcı kodu bazı yerlerde SAFBReady bekliyor olabilir.
      window.SAFBReady = Promise.reject(err);
    } catch {}
    throw err;
  }

  if (!cfg) {
    fail(new Error('firebaseConfig bulunamadı. Önce FIREBASE_CONFIG değişkenini sayfada tanımlayın.'));
  }

  if (typeof firebase === 'undefined' || !firebase || typeof firebase.initializeApp !== 'function') {
    fail(new Error('Firebase yüklenemedi. Firebase v8 scriptlerini (firebase-app.js) önce yükleyin.'));
  }

  // Aynı sayfada iki kez yüklenirse tekrar initialize etme.
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(cfg);
  }

  const app = firebase.app();
  const auth = (typeof firebase.auth === 'function') ? firebase.auth() : null;
  const db = (typeof firebase.firestore === 'function') ? firebase.firestore() : null;

  // Diğer scriptler için global erişim
  window.SAFirebase = { app, auth, db };

  // Uyum amaçlı (varsa bekleyen kodlar)
  window.SAFBReady = Promise.resolve();
})();
