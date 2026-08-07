/**
 * Student login shell (W2) — static only, no Firebase.
 */
(function () {
  'use strict';

  var btn = document.getElementById('login-submit');
  var msg = document.getElementById('login-msg');

  if (!btn || !msg) return;

  btn.addEventListener('click', function () {
    msg.textContent = 'Web öğrenci girişi yakında aktif edilecek.';
  });
})();
