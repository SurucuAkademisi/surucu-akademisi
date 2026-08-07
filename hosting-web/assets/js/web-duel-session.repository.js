/**
 * Web duel session — duel doc, exam assign, results, resolve, league (W3).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-duel-session]';
  var resolvingInFlight = {};

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth) return fb.auth;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.auth) {
      return window.firebase.auth();
    }
    return null;
  }

  function getFieldValue() {
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore.FieldValue;
    }
    return null;
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function getAuthUid() {
    var auth = getAuth();
    return auth && auth.currentUser && auth.currentUser.uid
      ? normalizeString(auth.currentUser.uid)
      : '';
  }

  function mapDuelDoc(id, data) {
    var raw = data || {};
    return {
      duelId: normalizeString(id),
      playerA: normalizeString(raw.playerA) || null,
      playerB: normalizeString(raw.playerB) || null,
      status: normalizeString(raw.status) || 'created',
      scope: normalizeString(raw.scope) || 'global',
      tenantId: raw.tenantId != null ? normalizeString(raw.tenantId) || null : null,
      examId: raw.examId != null ? normalizeString(raw.examId) || null : null,
      examTitle: normalizeString(raw.examTitle) || null,
      category: normalizeString(raw.category) || null,
      resultStatus: normalizeString(raw.resultStatus) || null,
      winnerUid: raw.winnerUid != null ? normalizeString(raw.winnerUid) || null : null
    };
  }

  async function getDuel(duelId) {
    var id = normalizeString(duelId);
    if (!id) return { ok: false, reason: 'invalid_duel_id' };

    var db = getDb();
    if (!db) return { ok: false, reason: 'db_unavailable' };

    try {
      var snap = await db.collection('duels').doc(id).get();
      if (!snap.exists) return { ok: false, reason: 'duel_missing' };
      return { ok: true, duel: mapDuelDoc(snap.id, snap.data()) };
    } catch (e) {
      console.warn(LOG_PREFIX + ' getDuel failed', e);
      return { ok: false, reason: 'read_failed', error: e };
    }
  }

  function subscribeDuel(duelId, callback) {
    var id = normalizeString(duelId);
    if (!id) {
      if (typeof callback === 'function') callback({ ok: false, reason: 'invalid_duel_id' });
      return function () {};
    }

    var db = getDb();
    if (!db) {
      if (typeof callback === 'function') callback({ ok: false, reason: 'db_unavailable' });
      return function () {};
    }

    return db.collection('duels').doc(id).onSnapshot(
      function (snap) {
        if (!snap.exists) {
          if (typeof callback === 'function') callback({ ok: false, reason: 'duel_missing' });
          return;
        }
        if (typeof callback === 'function') {
          callback({ ok: true, duel: mapDuelDoc(snap.id, snap.data()) });
        }
      },
      function (err) {
        console.warn(LOG_PREFIX + ' subscribeDuel failed', err);
        if (typeof callback === 'function') callback({ ok: false, error: err });
      }
    );
  }

  async function loadStandardPublishedExams() {
    var repo = window.SA_WEB_EXAM_REPO;
    if (!repo || typeof repo.loadPublishedExams !== 'function') return [];

    try {
      var res = await repo.loadPublishedExams();
      if (!res || !res.ok || !Array.isArray(res.exams)) return [];
      return res.exams.filter(function (x) {
        return x && x.examId && String(x.category || '').toLowerCase() === 'standard';
      });
    } catch (e) {
      console.warn(LOG_PREFIX + ' loadStandardPublishedExams failed', e);
      return [];
    }
  }

  async function ensureDuelExamAssigned(duelId) {
    var id = normalizeString(duelId);
    if (!id) return { ok: false, reason: 'invalid_duel_id' };

    var db = getDb();
    var FieldValue = getFieldValue();
    if (!db || !FieldValue) return { ok: false, reason: 'db_unavailable' };

    var duelRef = db.collection('duels').doc(id);

    try {
      var snap = await duelRef.get();
      if (!snap.exists) return { ok: false, reason: 'duel_missing' };
      var current = snap.data() || {};
      if (current.examId) {
        return {
          ok: true,
          examId: String(current.examId),
          examTitle: current.examTitle || null,
          category: current.category || null
        };
      }

      var exams = await loadStandardPublishedExams();
      if (!exams.length) return { ok: false, reason: 'no_standard_exams' };

      var picked = exams[Math.floor(Math.random() * exams.length)];
      var pickedId = normalizeString(picked.examId);
      if (!pickedId) return { ok: false, reason: 'invalid_exam_pick' };

      var pickedTitle = normalizeString(picked.title) || 'Düello Sınavı';
      var pickedCategory = normalizeString(picked.category) || 'standard';

      var txResult = await db.runTransaction(async function (trx) {
        var txSnap = await trx.get(duelRef);
        if (!txSnap.exists) return { ok: false, reason: 'duel_missing' };
        var txData = txSnap.data() || {};
        if (txData.examId) {
          return {
            ok: true,
            examId: String(txData.examId),
            examTitle: txData.examTitle || null,
            category: txData.category || null
          };
        }
        trx.set(
          duelRef,
          {
            examId: pickedId,
            examTitle: pickedTitle,
            category: pickedCategory,
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        return {
          ok: true,
          examId: pickedId,
          examTitle: pickedTitle,
          category: pickedCategory
        };
      });

      return txResult;
    } catch (e) {
      console.warn(LOG_PREFIX + ' ensureDuelExamAssigned failed', e);
      return { ok: false, reason: 'transaction_failed', error: e };
    }
  }

  async function submitDuelResult(duelId, uid, result) {
    var id = normalizeString(duelId);
    var userId = normalizeString(uid);
    if (!id || !userId) return { ok: false, reason: 'invalid_args' };

    var db = getDb();
    var FieldValue = getFieldValue();
    if (!db || !FieldValue) return { ok: false, reason: 'db_unavailable' };

    var res = result || {};
    var payload = {
      uid: userId,
      correct: Number(res.correct || 0),
      wrong: Number(res.wrong || 0),
      blank: Number(res.blank || 0),
      score: Number(res.percentage != null ? res.percentage : res.score || 0),
      elapsedSec: Number(res.elapsedSec || 0),
      submittedAt: FieldValue.serverTimestamp()
    };

    try {
      await db.collection('duels').doc(id).collection('results').doc(userId).set(payload, { merge: true });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' submitDuelResult failed', e);
      return { ok: false, reason: 'write_failed', error: e };
    }
  }

  function subscribeDuelResults(duelId, callback) {
    var id = normalizeString(duelId);
    if (!id) {
      if (typeof callback === 'function') callback({ ok: false, resultsByUid: {} });
      return function () {};
    }

    var db = getDb();
    if (!db) {
      if (typeof callback === 'function') callback({ ok: false, resultsByUid: {} });
      return function () {};
    }

    return db
      .collection('duels')
      .doc(id)
      .collection('results')
      .onSnapshot(
        function (snap) {
          var resultsByUid = {};
          var docs = snap && snap.docs ? snap.docs : [];
          for (var i = 0; i < docs.length; i++) {
            var doc = docs[i];
            if (doc && doc.id) resultsByUid[doc.id] = doc.data() || {};
          }
          if (typeof callback === 'function') {
            callback({ ok: true, resultsByUid: resultsByUid });
          }
        },
        function (err) {
          console.warn(LOG_PREFIX + ' subscribeDuelResults failed', err);
          if (typeof callback === 'function') callback({ ok: false, error: err, resultsByUid: {} });
        }
      );
  }

  async function resolveDuelResultFromDocs(duelId) {
    var id = normalizeString(duelId);
    if (!id) return { ok: false, reason: 'invalid_duel_id' };

    if (resolvingInFlight[id]) return resolvingInFlight[id];

    var db = getDb();
    var FieldValue = getFieldValue();
    if (!db || !FieldValue) return { ok: false, reason: 'db_unavailable' };

    var promise = db.runTransaction(async function (trx) {
      var duelRef = db.collection('duels').doc(id);
      var duelSnap = await trx.get(duelRef);
      if (!duelSnap.exists) return { ok: false, reason: 'duel_missing' };

      var d = duelSnap.data() || {};
      if (normalizeString(d.resultStatus).toLowerCase() === 'resolved') {
        return {
          ok: true,
          alreadyResolved: true,
          winnerUid: d.winnerUid != null ? normalizeString(d.winnerUid) || null : null
        };
      }

      var pA = normalizeString(d.playerA);
      var pB = normalizeString(d.playerB);
      if (!pA || !pB) return { ok: false, reason: 'invalid_players' };

      var resA = await trx.get(duelRef.collection('results').doc(pA));
      var resB = await trx.get(duelRef.collection('results').doc(pB));
      if (!resA.exists || !resB.exists) {
        return { ok: false, reason: 'results_incomplete' };
      }

      var a = resA.data() || {};
      var b = resB.data() || {};
      var scoreA = Number(a.score || 0);
      var scoreB = Number(b.score || 0);
      var winnerUid = null;

      if (scoreA > scoreB) winnerUid = pA;
      else if (scoreB > scoreA) winnerUid = pB;
      else {
        var elapsedA = Number(a.elapsedSec || 0);
        var elapsedB = Number(b.elapsedSec || 0);
        if (elapsedA > 0 && elapsedB > 0) {
          if (elapsedA < elapsedB) winnerUid = pA;
          else if (elapsedB < elapsedA) winnerUid = pB;
        }
      }

      trx.set(
        duelRef,
        {
          resultStatus: 'resolved',
          winnerUid: winnerUid,
          resolvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return { ok: true, winnerUid: winnerUid, resultStatus: 'resolved' };
    });

    resolvingInFlight[id] = promise;
    try {
      return await promise;
    } catch (e) {
      console.warn(LOG_PREFIX + ' resolveDuelResultFromDocs failed', e);
      return { ok: false, reason: 'transaction_failed', error: e };
    } finally {
      delete resolvingInFlight[id];
    }
  }

  async function updateOwnLeagueStats(duelId, uid, winnerUid) {
    var id = normalizeString(duelId);
    var myUid = normalizeString(uid);
    if (!id || !myUid) return { ok: false, reason: 'invalid_args' };

    var db = getDb();
    var FieldValue = getFieldValue();
    if (!db || !FieldValue) return { ok: false, reason: 'db_unavailable' };

    var leagueRef = db.collection('duelLeague').doc(myUid);
    var markerRef = leagueRef.collection('matches').doc(id);

    var points = 0;
    var wins = 0;
    var losses = 0;
    var draws = 0;
    var w = winnerUid != null ? normalizeString(winnerUid) : '';

    if (!w) {
      points = 1;
      draws = 1;
    } else if (w === myUid) {
      points = 3;
      wins = 1;
    } else {
      losses = 1;
    }

    try {
      await db.runTransaction(async function (trx) {
        var markerSnap = await trx.get(markerRef);
        if (markerSnap.exists) return;

        trx.set(
          leagueRef,
          {
            totalPoints: FieldValue.increment(points),
            wins: FieldValue.increment(wins),
            losses: FieldValue.increment(losses),
            draws: FieldValue.increment(draws),
            matchesPlayed: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        trx.set(
          markerRef,
          {
            duelId: id,
            processedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' updateOwnLeagueStats failed', e);
      return { ok: false, reason: 'transaction_failed', error: e };
    }
  }

  function getDuelOutcome(myUid, winnerUid) {
    var me = normalizeString(myUid);
    var w = winnerUid != null ? normalizeString(winnerUid) : '';
    if (!w) return 'draw';
    if (w === me) return 'win';
    return 'lose';
  }

  window.SA_WEB_DUEL_SESSION = {
    getAuthUid: getAuthUid,
    getDuel: getDuel,
    subscribeDuel: subscribeDuel,
    ensureDuelExamAssigned: ensureDuelExamAssigned,
    submitDuelResult: submitDuelResult,
    subscribeDuelResults: subscribeDuelResults,
    resolveDuelResultFromDocs: resolveDuelResultFromDocs,
    updateOwnLeagueStats: updateOwnLeagueStats,
    getDuelOutcome: getDuelOutcome
  };
})();
