/**
 * Web Ligler — read-only duel league leaderboard and name resolution (global MVP).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-duel-league]';

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

  function normalizeRow(uid, data) {
    var raw = data || {};
    return {
      uid: normalizeString(uid),
      totalPoints: toNumber(raw.totalPoints),
      wins: toNumber(raw.wins),
      losses: toNumber(raw.losses),
      draws: toNumber(raw.draws),
      matchesPlayed: toNumber(raw.matchesPlayed),
      updatedAt: raw.updatedAt || null
    };
  }

  function emptySummary(uid) {
    return normalizeRow(uid, null);
  }

  function isIndexError(err) {
    if (!err) return false;
    var code = String(err.code || '').toLowerCase();
    var msg = String(err.message || '').toLowerCase();
    return (
      code.indexOf('failed-precondition') !== -1 ||
      msg.indexOf('index') !== -1 ||
      msg.indexOf('requires an index') !== -1
    );
  }

  function sortLeaderboardRows(rows) {
    rows.sort(function (a, b) {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
      return String(a.uid).localeCompare(String(b.uid));
    });
    return rows;
  }

  function mapSnapshotToRows(snap) {
    var docs = snap && snap.docs ? snap.docs : [];
    return docs.map(function (d) {
      return normalizeRow(d.id, d.data() || {});
    });
  }

  async function fetchLeaderboardTop(limit) {
    var lim = Math.max(1, Math.min(50, Number(limit) || 20));
    var db = getDb();
    if (!db) {
      return { ok: false, rows: [], error: 'db_unavailable' };
    }

    try {
      var snap = await db
        .collection('duelLeague')
        .orderBy('totalPoints', 'desc')
        .orderBy('wins', 'desc')
        .limit(lim)
        .get();
      return { ok: true, rows: sortLeaderboardRows(mapSnapshotToRows(snap)), usedFallback: false };
    } catch (errPrimary) {
      if (!isIndexError(errPrimary)) {
        console.warn(LOG_PREFIX + ' leaderboard query failed', errPrimary);
        return { ok: false, rows: [], error: errPrimary };
      }
      try {
        console.warn('[WebLigler] composite leaderboard query failed, using fallback', errPrimary);
      } catch (_) {}
      try {
        var snapFallback = await db
          .collection('duelLeague')
          .orderBy('totalPoints', 'desc')
          .limit(lim)
          .get();
        return {
          ok: true,
          rows: sortLeaderboardRows(mapSnapshotToRows(snapFallback)),
          usedFallback: true
        };
      } catch (errFallback) {
        console.warn(LOG_PREFIX + ' fallback leaderboard query failed', errFallback);
        return { ok: false, rows: [], error: errFallback };
      }
    }
  }

  async function fetchOwnLeagueSummary(uid) {
    var id = normalizeString(uid);
    if (!id) {
      return { ok: false, summary: emptySummary(''), exists: false, error: 'invalid_uid' };
    }

    var db = getDb();
    if (!db) {
      return { ok: false, summary: emptySummary(id), exists: false, error: 'db_unavailable' };
    }

    try {
      var snap = await db.collection('duelLeague').doc(id).get();
      if (!snap.exists) {
        return { ok: true, summary: emptySummary(id), exists: false };
      }
      return {
        ok: true,
        summary: normalizeRow(id, snap.data()),
        exists: true
      };
    } catch (e) {
      console.warn(LOG_PREFIX + ' own summary failed', e);
      return { ok: false, summary: emptySummary(id), exists: false, error: e };
    }
  }

  function pickProfileName(data) {
    if (!data || typeof data !== 'object') return '';
    var display = normalizeString(data.displayName);
    if (display) return display;
    var full = normalizeString(data.fullName);
    if (full) return full;
    var username = normalizeString(data.username);
    if (username) return username;
    return '';
  }

  function buildSelfFallback(currentUser) {
    var cu = currentUser && typeof currentUser === 'object' ? currentUser : {};
    var display = normalizeString(cu.displayName);
    if (display) return display;
    var first = normalizeString(cu.firstName);
    var last = normalizeString(cu.lastName);
    if (first || last) return (first + ' ' + last).trim();
    var email = normalizeString(cu.email);
    if (email && email.indexOf('@') > 0) return email.split('@')[0];
    return '';
  }

  function fallbackUidLabel(uid) {
    var s = normalizeString(uid);
    if (!s) return 'Kullanıcı';
    return 'Kullanıcı ' + s.slice(0, 6);
  }

  async function resolveDisplayNames(uids, currentUser) {
    var list = Array.isArray(uids) ? uids : [];
    var unique = [];
    var seen = {};
    list.forEach(function (id) {
      var s = normalizeString(id);
      if (!s || seen[s]) return;
      seen[s] = true;
      unique.push(s);
    });

    var names = {};
    var myUid = currentUser && currentUser.uid ? normalizeString(currentUser.uid) : '';
    var selfFallback = buildSelfFallback(currentUser);

    var db = getDb();
    if (!db) {
      unique.forEach(function (uid) {
        names[uid] = uid === myUid && selfFallback ? selfFallback : fallbackUidLabel(uid);
      });
      return { ok: false, names: names, error: 'db_unavailable' };
    }

    await Promise.all(
      unique.map(async function (uid) {
        try {
          var pSnap = await db.collection('publicProfiles').doc(uid).get();
          var fromPublic = pSnap.exists ? pickProfileName(pSnap.data() || {}) : '';
          if (fromPublic) {
            names[uid] = fromPublic;
            return;
          }
          if (myUid && uid === myUid && selfFallback) {
            names[uid] = selfFallback;
            return;
          }
          names[uid] = fallbackUidLabel(uid);
        } catch (_) {
          if (myUid && uid === myUid && selfFallback) {
            names[uid] = selfFallback;
          } else {
            names[uid] = fallbackUidLabel(uid);
          }
        }
      })
    );

    return { ok: true, names: names };
  }

  window.SA_WEB_DUEL_LEAGUE = {
    normalizeRow: normalizeRow,
    fetchLeaderboardTop: fetchLeaderboardTop,
    fetchOwnLeagueSummary: fetchOwnLeagueSummary,
    resolveDisplayNames: resolveDisplayNames
  };
})();
