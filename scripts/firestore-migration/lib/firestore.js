/**
 * Firebase Admin SDK başlatma
 * GOOGLE_APPLICATION_CREDENTIALS ortam değişkeni ile service account kullanır
 */

const admin = require('firebase-admin');
const { PROJECT_ID } = require('../config.js');

let db = null;

/**
 * Firestore instance döndürür. İlk çağrıda initialize eder.
 * @returns {FirebaseFirestore.Firestore | null}
 */
function getFirestore() {
  if (db) return db;

  try {
    // Zaten initialize edilmişse mevcut app'i kullan
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: PROJECT_ID });
    }
    db = admin.firestore();
    return db;
  } catch (err) {
    console.error('[firestore] Init hatası:', err.message);
    return null;
  }
}

module.exports = {
  getFirestore,
  admin,
};
