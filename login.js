/* Login + backend helpers (Firebase v8 global) */
(function () {
  'use strict';

  // Firebase global kontrolü
  if (!window.firebase || typeof firebase === 'undefined') {
    console.error('Firebase not loaded');
    return;
  }

  // DOM + Auth hazır kontrolü (log)
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof firebase !== 'undefined') {
      const error = document.querySelector('.login-error');
      if (error) error.style.display = 'none';
    }

    if (typeof firebase === 'undefined') {
      console.error('Firebase not loaded');
      return;
    }
    firebase.auth();
    console.log('Firebase Auth ready');
  });

  const auth = firebase.auth();
  const db = firebase.firestore();

  function normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
  }

  function getOrCreateDeviceId() {
    const key = 'sa_device_id';
    let id = localStorage.getItem(key);
    if (id) return id;

    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      id = String(Date.now()) + '-' + String(Math.random()).slice(2);
    }

    localStorage.setItem(key, id);
    return id;
  }

  function setStudentSession(code, expiresAtMillis) {
    localStorage.setItem('sa_access_code', String(code || ''));
    localStorage.setItem('sa_access_expiresAt', String(expiresAtMillis || '0'));
  }

  function clearStudentSession() {
    localStorage.removeItem('sa_access_code');
    localStorage.removeItem('sa_access_expiresAt');
  }

  function getStudentSession() {
    const code = localStorage.getItem('sa_access_code') || '';
    const expiresAt = Number(localStorage.getItem('sa_access_expiresAt') || '0');
    if (!code || !expiresAt) return null;
    if (Date.now() > expiresAt) {
      clearStudentSession();
      return null;
    }
    return { code, expiresAt };
  }

  async function ensureSignedInAnonymously() {
    try {
      if (auth.currentUser) return;
      await auth.signInAnonymously();
    } catch {
      // kurallar anonymous login'i kapatmış olabilir; sessiz geç
    }
  }

  function accessCodesCol() {
    return db.collection('accessCodes');
  }

  function contentDoc() {
    return db.collection('content').doc('links');
  }

  async function studentLoginWithCode(codeInput) {
    const code = normalizeCode(codeInput);
    if (!code) throw new Error('Erişim kodu boş olamaz.');

    await ensureSignedInAnonymously();

    const ref = accessCodesCol().doc(code);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Erişim kodu bulunamadı.');

    const data = snap.data() || {};
    if (data.active !== true) throw new Error('Erişim kodu pasif.');

    const expiresAt = data.expiresAt;
    const expiresAtMs = expiresAt && typeof expiresAt.toMillis === 'function' ? expiresAt.toMillis() : 0;
    if (expiresAtMs && Date.now() > expiresAtMs) throw new Error('Erişim kodunun süresi dolmuş.');

    const maxDevices = Number(data.maxDevices || 3);
    const devices = (data.devices && typeof data.devices === 'object') ? data.devices : {};

    const deviceId = getOrCreateDeviceId();
    const hasDevice = Object.prototype.hasOwnProperty.call(devices, deviceId);

    if (!hasDevice) {
      const used = Object.keys(devices).length;
      if (used >= maxDevices) throw new Error('Cihaz limiti dolu.');

      const update = {};
      update['devices.' + deviceId] = firebase.firestore.FieldValue.serverTimestamp();
      await ref.set(update, { merge: true });
    }

    setStudentSession(code, expiresAtMs || (Date.now() + 30 * 24 * 60 * 60 * 1000));
    return true;
  }

  async function studentLogout() {
    clearStudentSession();
    try { await auth.signOut(); } catch {}
  }

  async function getContentLinks(options) {
    const preferServer = !!(options && options.preferServer);
    const ref = contentDoc();

    try {
      const snap = preferServer ? await ref.get({ source: 'server' }) : await ref.get();
      return snap.exists ? (snap.data() || {}) : {};
    } catch {
      const snap = await ref.get();
      return snap.exists ? (snap.data() || {}) : {};
    }
  }

  async function saveContentLinks(payload) {
    const pdfLinks = (payload && payload.pdfLinks) ? payload.pdfLinks : {};
    const videoLinks = (payload && payload.videoLinks) ? payload.videoLinks : [];
    await contentDoc().set(
      {
        pdfLinks,
        videoLinks,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  function onAdminAuth(cb) {
    auth.onAuthStateChanged((user) => {
      try { cb(user); } catch {}
    });
  }

  function toAuthEmail(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';

    if (raw.includes('@')) return raw.toLowerCase();

    let u = raw.toLowerCase();
    u = u
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ş/g, 's')
      .replace(/ü/g, 'u');

    u = u.replace(/\s+/g, '.');
    u = u.replace(/[^a-z0-9._-]/g, '');
    u = u.replace(/\.+/g, '.').replace(/^\.+|\.+$/g, '');

    if (!u) return '';
    return u + '@surucu.local';
  }

  async function adminSignIn(email, password) {
    const e = toAuthEmail(email);
    const p = String(password || '');
    if (!e || !p) throw new Error('Kullanıcı adı/şifre boş olamaz.');
    await auth.signInWithEmailAndPassword(e, p);
  }

  async function adminSignOut() {
    await auth.signOut();
  }

  function makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const part = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return 'SA-' + part(4) + '-' + part(4);
  }

  async function createAccessCode({ note, days, maxDevices } = {}) {
    const d = Math.max(1, Number(days || 30));
    const m = Math.max(1, Number(maxDevices || 3));

    const expires = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
    const expiresAt = firebase.firestore.Timestamp.fromDate(expires);

    let code = makeCode();
    let tries = 0;
    while (tries < 5) {
      const exists = await accessCodesCol().doc(code).get();
      if (!exists.exists) break;
      code = makeCode();
      tries++;
    }

    await accessCodesCol().doc(code).set({
      note: String(note || '').trim(),
      active: true,
      maxDevices: m,
      devices: {},
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      expiresAt
    });

    return code;
  }

  async function listAccessCodes() {
    const snap = await accessCodesCol().orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  }

  async function setAccessCodeActive(codeInput, isActive) {
    const code = normalizeCode(codeInput);
    if (!code) return;
    await accessCodesCol().doc(code).set({ active: !!isActive }, { merge: true });
  }

  async function deleteAccessCode(codeInput) {
    const code = normalizeCode(codeInput);
    if (!code) return;
    await accessCodesCol().doc(code).delete();
  }

  // Uygulamanın beklediği global API
  window.SAFB = {
    // Student
    studentLoginWithCode,
    studentLogout,
    getStudentSession,

    // Content
    getContentLinks,
    saveContentLinks,

    // Admin
    onAdminAuth,
    adminSignIn,
    adminSignOut,

    // Access codes
    createAccessCode,
    listAccessCodes,
    setAccessCodeActive,
    deleteAccessCode
  };
})();
