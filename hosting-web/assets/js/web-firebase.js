/**
 * Student web Firebase init (W3).
 * Keep in sync with mobile_app/src/firebase_app.js
 */
(function () {
  'use strict';

  var firebaseConfig = {
    apiKey: 'AIzaSyCpOESMP9HOvjY_Z-fv0w5G0MC-UVI5D_0',
    authDomain: 'surucuakademisi.com',
    projectId: 'surucuakademisi-f5e1f',
    storageBucket: 'surucuakademisi-f5e1f.firebasestorage.app',
    messagingSenderId: '268662659371',
    appId: '1:268662659371:web:f7e2da8733af296ce74d6e'
  };

  if (typeof window.firebase === 'undefined') {
    console.warn('[SA_WEB_FIREBASE] Firebase global not loaded.');
    window.SA_WEB_FIREBASE = { ready: false, auth: null, db: null };
    return;
  }

  var firebase = window.firebase;
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  window.SA_WEB_FIREBASE = {
    ready: true,
    auth: firebase.auth(),
    db: firebase.firestore()
  };
})();
