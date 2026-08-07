// SOURCE OF TRUTH: Canonical Firebase init for the mobile_app/src student runtime bundle.
// Use this file for student runtime Firebase configuration changes.
// Do not edit mirror/legacy copies in root/docs for Android/Capacitor runtime fixes.
// Firebase v8 (global) init
const firebaseConfig = {
  apiKey: "AIzaSyCpOESMP9HOvjY_Z-fv0w5G0MC-UVI5D_0",
  authDomain: "surucuakademisi-f5e1f.firebaseapp.com",
  projectId: "surucuakademisi-f5e1f",
  storageBucket: "surucuakademisi-f5e1f.firebasestorage.app",
  messagingSenderId: "268662659371",
  appId: "1:268662659371:web:f7e2da8733af296ce74d6e"
};

// Firebase global'ı yoksa uygulamayı düşürmeden çık
if (typeof window.firebase === 'undefined') {
  console.warn('Firebase global bulunamadi, firebase_app.js init atlandi.');
} else {
  const firebase = window.firebase;

  // Çift yüklemeye karşı koruma
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  console.log('Firebase loaded:', typeof firebase);
}
