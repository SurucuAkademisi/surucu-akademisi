import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

// firebaseConfig'i global scope'ta tanımlı olmalı.
// Örnek:
//   const firebaseConfig = { ... };
// veya
//   window.firebaseConfig = { ... };
// veya
//   window.FIREBASE_CONFIG = { ... };
const existingFirebaseConfig =
  (typeof window !== 'undefined' && (window.firebaseConfig || window.FIREBASE_CONFIG)) ||
  (typeof globalThis !== 'undefined' &&
    (globalThis.firebaseConfig || globalThis.FIREBASE_CONFIG)) ||
  null;

if (!existingFirebaseConfig) {
  throw new Error('firebaseConfig bulunamadı. Önce firebaseConfig değişkenini sayfada tanımlayın.');
}

const app = initializeApp(existingFirebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
