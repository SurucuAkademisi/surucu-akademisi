/**
 * Web duel incoming invites — subscribe pending + reject only (W2).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-duel-invites]';
  var DEFAULT_INVITE_TTL_MS = 60 * 1000;
  var SHARED_EXAM_TENANT_ID = 'surucu_akademisi';

  var inviteUnsubs = [];
  var acceptInFlight = {};

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
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

  function getInviteExpiryMs(expireAt, createdAtMs) {
    if (expireAt) {
      if (typeof expireAt.toMillis === 'function') return expireAt.toMillis();
      if (expireAt instanceof Date) return expireAt.getTime();
      if (typeof expireAt.seconds === 'number') return expireAt.seconds * 1000;
    }
    var created =
      typeof createdAtMs === 'number' && !isNaN(createdAtMs) ? createdAtMs : Number(createdAtMs);
    if (created > 0) return created + DEFAULT_INVITE_TTL_MS;
    return 0;
  }

  function isInviteActive(data, nowMs) {
    var raw = data || {};
    if (normalizeString(raw.status).toLowerCase() !== 'pending') return false;
    var expMs = getInviteExpiryMs(raw.expireAt, raw.createdAtMs);
    if (!expMs) return true;
    return expMs > nowMs;
  }

  function mapInviteDoc(id, data, nowMs) {
    var raw = data || {};
    var expMs = getInviteExpiryMs(raw.expireAt, raw.createdAtMs);
    var remainingMs = expMs > nowMs ? expMs - nowMs : 0;
    return {
      id: normalizeString(id),
      senderId: normalizeString(raw.senderId) || null,
      senderName: normalizeString(raw.senderName) || 'Kullanıcı',
      receiverId: normalizeString(raw.receiverId) || null,
      receiverName: normalizeString(raw.receiverName) || null,
      scope: normalizeString(raw.scope).toLowerCase() === 'institution' ? 'institution' : 'global',
      tenantId: raw.tenantId != null ? normalizeString(raw.tenantId) || null : null,
      status: normalizeString(raw.status).toLowerCase() || 'pending',
      createdAtMs:
        typeof raw.createdAtMs === 'number' && !isNaN(raw.createdAtMs)
          ? raw.createdAtMs
          : Number(raw.createdAtMs) || 0,
      expireAtMs: expMs,
      remainingMs: remainingMs,
      active: isInviteActive(raw, nowMs)
    };
  }

  function addInviteUnsub(unsub) {
    if (typeof unsub === 'function') inviteUnsubs.push(unsub);
  }

  function subscribeIncomingInvites(uid, callback) {
    var receiverId = normalizeString(uid);
    if (!receiverId) {
      if (typeof callback === 'function') {
        callback({ ok: true, invites: [], skipped: true });
      }
      return function () {};
    }

    var db = getDb();
    if (!db) {
      if (typeof callback === 'function') {
        callback({ ok: false, invites: [], error: 'db_unavailable' });
      }
      return function () {};
    }

    try {
      var unsub = db
        .collection('duelInvites')
        .where('receiverId', '==', receiverId)
        .where('status', '==', 'pending')
        .onSnapshot(
          function (snap) {
            var nowMs = Date.now();
            var invites = [];
            var docs = snap && snap.docs ? snap.docs : [];
            for (var i = 0; i < docs.length; i++) {
              var doc = docs[i];
              if (!doc || !doc.id) continue;
              var mapped = mapInviteDoc(doc.id, doc.data(), nowMs);
              if (mapped.active) invites.push(mapped);
            }
            invites.sort(function (a, b) {
              var aExp = a.expireAtMs || 0;
              var bExp = b.expireAtMs || 0;
              if (aExp && bExp && aExp !== bExp) return aExp - bExp;
              return (b.createdAtMs || 0) - (a.createdAtMs || 0);
            });
            if (typeof callback === 'function') {
              callback({ ok: true, invites: invites });
            }
          },
          function (err) {
            console.warn(LOG_PREFIX + ' incoming snapshot failed', err);
            if (typeof callback === 'function') {
              callback({ ok: false, invites: [], error: err });
            }
          }
        );
      addInviteUnsub(unsub);
      return unsub;
    } catch (e) {
      console.warn(LOG_PREFIX + ' subscribe failed', e);
      if (typeof callback === 'function') {
        callback({ ok: false, invites: [], error: e });
      }
      return function () {};
    }
  }

  async function rejectIncomingInvite(inviteId) {
    var id = normalizeString(inviteId);
    if (!id) {
      return { ok: false, reason: 'invalid_invite_id' };
    }

    var db = getDb();
    var FieldValue = getFieldValue();
    if (!db || !FieldValue) {
      return { ok: false, reason: 'db_unavailable' };
    }

    try {
      var result = await db.runTransaction(async function (trx) {
        var inviteRef = db.collection('duelInvites').doc(id);
        var inviteSnap = await trx.get(inviteRef);
        if (!inviteSnap.exists) {
          return { ok: false, reason: 'invite_missing' };
        }
        var data = inviteSnap.data() || {};
        var status = normalizeString(data.status).toLowerCase();
        if (status !== 'pending') {
          return { ok: false, reason: 'invite_not_pending', status: status };
        }
        var expMs = getInviteExpiryMs(data.expireAt, data.createdAtMs);
        if (expMs && Date.now() > expMs) {
          trx.set(
            inviteRef,
            {
              status: 'timeout',
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
          return { ok: false, reason: 'invite_expired' };
        }
        trx.set(
          inviteRef,
          {
            status: 'rejected',
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        return { ok: true, reason: 'rejected' };
      });
      return result;
    } catch (e) {
      console.warn(LOG_PREFIX + ' reject failed', e);
      return { ok: false, reason: 'transaction_failed', error: e };
    }
  }

  function getAuthUid() {
    var fb = window.SA_WEB_FIREBASE;
    var auth = fb && fb.auth ? fb.auth : null;
    if (!auth || !auth.currentUser || !auth.currentUser.uid) return '';
    return normalizeString(auth.currentUser.uid);
  }

  function getAuthUser() {
    var fb = window.SA_WEB_FIREBASE;
    var auth = fb && fb.auth ? fb.auth : null;
    return auth && auth.currentUser ? auth.currentUser : null;
  }

  function getFirestoreTimestamp() {
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore.Timestamp;
    }
    return null;
  }

  async function sendOutgoingInvite(opts) {
    var options = opts || {};
    var receiverId = normalizeString(options.receiverId);
    var receiverName = normalizeString(options.receiverName) || 'Kullanıcı';
    var scope =
      normalizeString(options.scope).toLowerCase() === 'institution' ? 'institution' : 'global';
    var tenantId = options.tenantId != null ? normalizeString(options.tenantId) || null : null;

    var uid = getAuthUid();
    if (!uid) return { ok: false, reason: 'not_authenticated' };
    if (!receiverId || receiverId === uid) return { ok: false, reason: 'invalid_receiver' };

    var db = getDb();
    var FieldValue = getFieldValue();
    var Timestamp = getFirestoreTimestamp();
    if (!db || !FieldValue || !Timestamp) return { ok: false, reason: 'db_unavailable' };

    var senderName = normalizeString(options.senderName);
    if (!senderName) {
      var user = getAuthUser();
      senderName =
        (user && normalizeString(user.displayName)) ||
        (user && user.email ? String(user.email).split('@')[0] : '') ||
        'Kullanıcı';
    }

    var nowMs = Date.now();
    try {
      var ref = await db.collection('duelInvites').add({
        senderId: uid,
        senderName: senderName,
        receiverId: receiverId,
        receiverName: receiverName,
        scope: scope,
        tenantId: tenantId,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
        expireAt: Timestamp.fromMillis(nowMs + DEFAULT_INVITE_TTL_MS)
      });
      return { ok: true, inviteId: ref.id };
    } catch (e) {
      console.warn(LOG_PREFIX + ' sendOutgoingInvite failed', e);
      return { ok: false, reason: 'write_failed', error: e };
    }
  }

  function subscribeOutgoingInvite(inviteId, callback) {
    var id = normalizeString(inviteId);
    if (!id) {
      if (typeof callback === 'function') {
        callback({ ok: false, reason: 'invalid_invite_id' });
      }
      return function () {};
    }

    var db = getDb();
    if (!db) {
      if (typeof callback === 'function') {
        callback({ ok: false, reason: 'db_unavailable' });
      }
      return function () {};
    }

    try {
      var unsub = db
        .collection('duelInvites')
        .doc(id)
        .onSnapshot(
          function (snap) {
            if (!snap.exists) {
              if (typeof callback === 'function') {
                callback({ ok: true, exists: false, invite: null });
              }
              return;
            }
            var raw = snap.data() || {};
            var mapped = mapInviteDoc(snap.id, raw, Date.now());
            mapped.duelId = normalizeString(raw.duelId) || null;
            if (typeof callback === 'function') {
              callback({ ok: true, exists: true, invite: mapped });
            }
          },
          function (err) {
            console.warn(LOG_PREFIX + ' outgoing snapshot failed', err);
            if (typeof callback === 'function') {
              callback({ ok: false, error: err });
            }
          }
        );
      addInviteUnsub(unsub);
      return unsub;
    } catch (e) {
      console.warn(LOG_PREFIX + ' subscribeOutgoingInvite failed', e);
      if (typeof callback === 'function') {
        callback({ ok: false, error: e });
      }
      return function () {};
    }
  }

  function buildDuelGameUrl(duelId) {
    var id = normalizeString(duelId);
    if (!id) return '';
    try {
      return new URL('../duello/oyun.html?duelId=' + encodeURIComponent(id), window.location.href).href;
    } catch (_) {
      return '../duello/oyun.html?duelId=' + encodeURIComponent(id);
    }
  }

  async function loadStandardPublishedExamsForAccept() {
    var repo = window.SA_WEB_EXAM_REPO;
    if (repo && typeof repo.loadPublishedExams === 'function') {
      try {
        var res = await repo.loadPublishedExams();
        if (res && res.ok && Array.isArray(res.exams)) {
          return res.exams.filter(function (x) {
            return x && x.examId && String(x.category || '').toLowerCase() === 'standard';
          });
        }
      } catch (e) {
        console.warn(LOG_PREFIX + ' loadPublishedExams via repo failed', e);
      }
    }

    var db = getDb();
    if (!db) return [];

    try {
      var snap = await db
        .collection('tenantExams')
        .doc(SHARED_EXAM_TENANT_ID)
        .collection('exams')
        .where('status', '==', 'published')
        .get();

      var exams = [];
      var docs = snap && snap.docs ? snap.docs : [];
      for (var i = 0; i < docs.length; i++) {
        var doc = docs[i];
        if (!doc || !doc.id) continue;
        var d = doc.data() || {};
        var category = normalizeString(d.category).toLowerCase();
        if (category !== 'standard') continue;
        exams.push({
          examId: doc.id,
          title: normalizeString(d.title) || doc.id,
          category: category || 'standard'
        });
      }
      return exams;
    } catch (e) {
      console.warn(LOG_PREFIX + ' loadStandardPublishedExamsForAccept failed', e);
      return [];
    }
  }

  async function pickStandardExamForDuel() {
    var exams = await loadStandardPublishedExamsForAccept();
    if (!exams.length) return null;

    var picked = exams[Math.floor(Math.random() * exams.length)];
    var examId = normalizeString(picked.examId);
    if (!examId) return null;

    return {
      examId: examId,
      examTitle: normalizeString(picked.title) || 'Düello Sınavı',
      category: normalizeString(picked.category) || 'standard'
    };
  }

  async function acceptIncomingInvite(inviteId) {
    var id = normalizeString(inviteId);
    if (!id) return { ok: false, reason: 'invalid_invite_id' };

    if (acceptInFlight[id]) {
      return { ok: false, reason: 'accept_in_flight' };
    }

    var uid = getAuthUid();
    if (!uid) return { ok: false, reason: 'not_authenticated' };

    var db = getDb();
    var FieldValue = getFieldValue();
    if (!db || !FieldValue) {
      return { ok: false, reason: 'db_unavailable' };
    }

    acceptInFlight[id] = true;

    try {
      var preRef = db.collection('duelInvites').doc(id);
      var preSnap = await preRef.get();
      if (!preSnap.exists) {
        return { ok: false, reason: 'invite_missing' };
      }
      var preData = preSnap.data() || {};
      if (normalizeString(preData.receiverId) !== uid) {
        return { ok: false, reason: 'not_receiver' };
      }
      if (normalizeString(preData.status).toLowerCase() !== 'pending') {
        return { ok: false, reason: 'invite_not_pending', status: preData.status };
      }
      var preExp = getInviteExpiryMs(preData.expireAt, preData.createdAtMs);
      if (preExp && Date.now() > preExp) {
        return { ok: false, reason: 'invite_expired' };
      }

      var pickedExam = await pickStandardExamForDuel();
      if (!pickedExam || !pickedExam.examId) {
        return { ok: false, reason: 'duel_exam_unavailable' };
      }

      var createdDuelId = null;

      await db.runTransaction(async function (trx) {
        var inviteRef = db.collection('duelInvites').doc(id);
        var inviteSnap = await trx.get(inviteRef);
        if (!inviteSnap.exists) throw new Error('invite_missing');

        var data = inviteSnap.data() || {};
        if (normalizeString(data.receiverId) !== uid) throw new Error('not_receiver');
        if (normalizeString(data.status).toLowerCase() !== 'pending') {
          throw new Error('invite_not_pending');
        }

        var expMs = getInviteExpiryMs(data.expireAt, data.createdAtMs);
        if (!expMs || Date.now() > expMs) {
          trx.set(
            inviteRef,
            { status: 'timeout', updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          throw new Error('invite_expired');
        }

        var duelRef = db.collection('duels').doc();
        trx.set(duelRef, {
          playerA: normalizeString(data.senderId) || null,
          playerB: uid,
          status: 'created',
          createdAt: FieldValue.serverTimestamp(),
          scope: data.scope || 'global',
          tenantId: data.tenantId != null ? data.tenantId : null,
          examId: pickedExam.examId,
          examTitle: pickedExam.examTitle,
          category: pickedExam.category || 'standard'
        });
        trx.set(
          inviteRef,
          {
            status: 'accepted',
            duelId: duelRef.id,
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        createdDuelId = duelRef.id;
      });

      return { ok: true, duelId: createdDuelId };
    } catch (e) {
      var msg = e && e.message ? String(e.message) : '';
      if (msg.indexOf('invite_not_pending') >= 0) {
        return { ok: false, reason: 'invite_not_pending' };
      }
      if (msg.indexOf('invite_missing') >= 0) {
        return { ok: false, reason: 'invite_missing' };
      }
      if (msg.indexOf('invite_expired') >= 0) {
        return { ok: false, reason: 'invite_expired' };
      }
      if (msg.indexOf('not_receiver') >= 0) {
        return { ok: false, reason: 'not_receiver' };
      }
      console.warn(LOG_PREFIX + ' accept failed', e);
      return { ok: false, reason: 'transaction_failed', error: e };
    } finally {
      delete acceptInFlight[id];
    }
  }

  function cleanupInviteListeners() {
    inviteUnsubs.forEach(function (unsub) {
      if (typeof unsub === 'function') {
        try {
          unsub();
        } catch (_) {}
      }
    });
    inviteUnsubs = [];
  }

  function getAcceptSoftMessage(reason) {
    var r = normalizeString(reason);
    if (r === 'invite_expired') return 'Davet süresi doldu veya artık geçerli değil.';
    if (r === 'invite_not_pending' || r === 'invite_missing') {
      return 'Davet geri çekildi veya artık geçerli değil.';
    }
    if (r === 'accept_in_flight') return 'Davet işleniyor, lütfen bekleyin.';
    if (r === 'not_authenticated') return 'Düello için giriş yapmalısınız.';
    if (r === 'duel_exam_unavailable') {
      return 'Düello sınavı hazırlanamadı. Lütfen tekrar deneyin.';
    }
    return 'Davet kabul edilemedi. Lütfen tekrar deneyin.';
  }

  window.SA_WEB_DUEL_INVITES = {
    DEFAULT_INVITE_TTL_MS: DEFAULT_INVITE_TTL_MS,
    getInviteExpiryMs: getInviteExpiryMs,
    subscribeIncomingInvites: subscribeIncomingInvites,
    sendOutgoingInvite: sendOutgoingInvite,
    subscribeOutgoingInvite: subscribeOutgoingInvite,
    rejectIncomingInvite: rejectIncomingInvite,
    acceptIncomingInvite: acceptIncomingInvite,
    buildDuelGameUrl: buildDuelGameUrl,
    getAcceptSoftMessage: getAcceptSoftMessage,
    cleanupInviteListeners: cleanupInviteListeners
  };
})();
