/* Offline-first auth & user management (IndexedDB) */
(function () {
  'use strict';

  const DB_NAME = 'sa_db';
  const DB_VERSION = 1;
  const STORE_USERS = 'users';

  const STUDENT_SESSION = {
    authed: 'sa_authed',
    user: 'sa_user',
    expiresAt: 'sa_expiresAt',
  };

  const ADMIN_SESSION = {
    authed: 'sa_admin_authed',
    user: 'sa_admin_user',
    expiresAt: 'sa_admin_expiresAt',
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_USERS)) {
          const store = db.createObjectStore(STORE_USERS, { keyPath: 'username' });
          store.createIndex('role', 'role', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function withStore(mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_USERS, mode);
      const store = tx.objectStore(STORE_USERS);

      let result;
      try {
        result = fn(store, tx);
      } catch (err) {
        reject(err);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function toHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return toHex(new Uint8Array(digest));
  }

  function normalizeUsername(username) {
    return String(username || '').trim();
  }

  async function makePasswordRecord(password) {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = toHex(saltBytes);
    const passHash = await sha256Hex(`${salt}:${password}`);
    return { salt, passHash };
  }

  async function verifyPassword(userRecord, password) {
    const computed = await sha256Hex(`${userRecord.salt}:${password}`);
    return computed === userRecord.passHash;
  }

  function nowMs() {
    return Date.now();
  }

  function getSession(keys) {
    const authed = localStorage.getItem(keys.authed) === 'true';
    const user = localStorage.getItem(keys.user) || '';
    const expiresAt = Number(localStorage.getItem(keys.expiresAt) || '0');

    if (!authed || !user || !expiresAt) return null;
    if (nowMs() > expiresAt) {
      clearSession(keys);
      return null;
    }
    return { user, expiresAt };
  }

  function setSession(keys, username, days) {
    const expiresAt = nowMs() + (days * 24 * 60 * 60 * 1000);
    localStorage.setItem(keys.authed, 'true');
    localStorage.setItem(keys.user, username);
    localStorage.setItem(keys.expiresAt, String(expiresAt));
    return expiresAt;
  }

  function clearSession(keys) {
    localStorage.removeItem(keys.authed);
    localStorage.removeItem(keys.user);
    localStorage.removeItem(keys.expiresAt);
  }

  async function getUser(username) {
    const u = normalizeUsername(username);
    if (!u) return null;

    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_USERS, 'readonly');
      const store = tx.objectStore(STORE_USERS);
      const req = store.get(u);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function listUsers() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_USERS, 'readonly');
      const store = tx.objectStore(STORE_USERS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function createUser({ username, password, role }) {
    const u = normalizeUsername(username);
    const p = String(password || '');
    const r = role === 'admin' ? 'admin' : 'student';

    if (!u) throw new Error('Kullanıcı adı boş olamaz.');
    if (p.length < 4) throw new Error('Şifre en az 4 karakter olmalı.');

    const existing = await getUser(u);
    if (existing) throw new Error('Bu kullanıcı adı zaten var.');

    const { salt, passHash } = await makePasswordRecord(p);
    const record = {
      username: u,
      role: r,
      salt,
      passHash,
      createdAt: nowMs(),
    };

    await withStore('readwrite', (store) => store.add(record));
    return record;
  }

  async function deleteUser(username) {
    const u = normalizeUsername(username);
    if (!u) return;
    await withStore('readwrite', (store) => store.delete(u));
  }

  async function authenticate(username, password, expectedRole) {
    const u = normalizeUsername(username);
    const p = String(password || '');
    if (!u || !p) return false;

    const user = await getUser(u);
    if (!user) return false;
    if (expectedRole && user.role !== expectedRole) return false;

    return verifyPassword(user, p);
  }

  async function ensureDefaultAdmin() {
    const users = await listUsers();
    const hasAdmin = users.some((u) => u.role === 'admin');
    return hasAdmin;
  }

  window.SAAuth = {
    // DB
    getUser,
    listUsers,
    createUser,
    deleteUser,
    authenticateStudent: (u, p) => authenticate(u, p, 'student'),
    authenticateAdmin: (u, p) => authenticate(u, p, 'admin'),
    hasAdmin: ensureDefaultAdmin,

    // Student session
    getStudentSession: () => getSession(STUDENT_SESSION),
    setStudentSession: (username, days = 30) => setSession(STUDENT_SESSION, normalizeUsername(username), days),
    clearStudentSession: () => clearSession(STUDENT_SESSION),

    // Admin session
    getAdminSession: () => getSession(ADMIN_SESSION),
    setAdminSession: (username, days = 30) => setSession(ADMIN_SESSION, normalizeUsername(username), days),
    clearAdminSession: () => clearSession(ADMIN_SESSION),
  };
})();
