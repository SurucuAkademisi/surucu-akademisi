// Firebase v8 (global) init
const firebaseConfig = {
  apiKey: "AIzaSyCpOESMP9HOvjY_Z-fv0w5G0MC-UVI5D_0",
  authDomain: "surucuakademisi-f5e1f.firebaseapp.com",
  projectId: "surucuakademisi-f5e1f",
  storageBucket: "surucuakademisi-f5e1f.firebasestorage.app",
  messagingSenderId: "268662659371",
  appId: "1:268662659371:web:f7e2da8733af296ce74d6e"
};

// CDN scriptleri gelmediyse net hata ver
if (typeof firebase === 'undefined') {
  console.error('Firebase loaded:', typeof firebase);
  throw new Error('firebase is not defined');
}

// Çift yüklemeye karşı koruma
if (!firebase.apps || !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

window.SAFirebase = {
  auth: firebase.auth(),
  db: firebase.firestore()
};

window.SAFBReady = true;
console.log('Firebase loaded:', typeof firebase);
