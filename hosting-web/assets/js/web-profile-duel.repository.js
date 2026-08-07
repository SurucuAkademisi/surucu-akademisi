/**
 * Profilim — read own duel league summary from duelLeague/{uid} (no writes, no collection queries).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-profile-duel]';

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function normalizeDuelLeagueDoc(data) {
    var raw = data || {};
    return {
      totalPoints: toNumber(raw.totalPoints, 0),
      wins: toNumber(raw.wins, 0),
      losses: toNumber(raw.losses, 0),
      draws: toNumber(raw.draws, 0),
      matchesPlayed: toNumber(raw.matchesPlayed, 0),
      updatedAt: raw.updatedAt || null
    };
  }

  async function fetchOwnDuelSummary(uid) {
    var id = normalizeString(uid);
    if (!id) {
      return { ok: false, summary: null, exists: false, error: 'invalid_uid' };
    }

    var db = getDb();
    if (!db) {
      return { ok: false, summary: null, exists: false, error: 'db_unavailable' };
    }

    try {
      var snap = await db.collection('duelLeague').doc(id).get();
      if (!snap.exists) {
        return {
          ok: true,
          summary: normalizeDuelLeagueDoc(null),
          exists: false
        };
      }
      return {
        ok: true,
        summary: normalizeDuelLeagueDoc(snap.data()),
        exists: true
      };
    } catch (e) {
      console.warn(LOG_PREFIX + ' fetch failed', e);
      return { ok: false, summary: null, exists: false, error: e };
    }
  }

  window.SA_WEB_PROFILE_DUEL = {
    normalizeDuelLeagueDoc: normalizeDuelLeagueDoc,
    fetchOwnDuelSummary: fetchOwnDuelSummary
  };
})();
