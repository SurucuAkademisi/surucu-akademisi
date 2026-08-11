/**
 * Public Hosting — force canonical production host.
 * Redirects ONLY exact Firebase default hosts for site surucuakademisi-web.
 * Independent of Firebase Auth / authDomain.
 */
(function () {
  'use strict';

  try {
    var host = String((window.location && window.location.hostname) || '').toLowerCase();
    if (host !== 'surucuakademisi-web.web.app' && host !== 'surucuakademisi-web.firebaseapp.com') {
      return;
    }

    var path = String((window.location && window.location.pathname) || '/');
    if (path.indexOf('/__/') === 0) {
      return;
    }

    var search = String((window.location && window.location.search) || '');
    var hash = String((window.location && window.location.hash) || '');
    window.location.replace('https://surucuakademisi.com' + path + search + hash);
  } catch (e) {
    /* never block page render */
  }
})();
