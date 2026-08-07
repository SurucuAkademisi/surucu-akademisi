/**
 * Genel Düello Ligi — read-only leaderboard page (public_user + institution student).
 */
(function () {
  'use strict';

  var LEADERBOARD_LIMIT = 20;
  var initialized = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    return fb && fb.ready && fb.auth ? fb.auth : null;
  }

  function getAuthUid() {
    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    return user && user.uid ? String(user.uid).trim() : '';
  }

  function applyPortalHomeLinks() {
    var nav = window.SA_WEB_MODULE_NAV;
    if (nav && typeof nav.applyPortalHomeLinks === 'function') {
      nav.applyPortalHomeLinks();
    }
  }

  function showGuestState() {
    var guest = $('ligler-guest-cta');
    var content = $('ligler-content');
    if (guest) guest.hidden = false;
    if (content) content.hidden = true;
    applyPortalHomeLinks();
  }

  function showLoggedInState() {
    var guest = $('ligler-guest-cta');
    var content = $('ligler-content');
    if (guest) guest.hidden = true;
    if (content) content.hidden = false;
    applyPortalHomeLinks();
  }

  function showAccessError() {
    showLoggedInState();
    setLoading(false);
    setBoardError('Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.');
  }

  function setLoading(loading) {
    var el = $('ligler-board-loading');
    if (el) el.hidden = !loading;
  }

  function setBoardError(message) {
    var err = $('ligler-board-error');
    var list = $('ligler-board-list');
    var empty = $('ligler-board-empty');
    if (err) {
      err.hidden = false;
      err.textContent = message || 'Lig verisi yüklenemedi.';
    }
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }
    if (empty) empty.hidden = true;
  }

  function hideBoardMessages() {
    var err = $('ligler-board-error');
    var empty = $('ligler-board-empty');
    if (err) err.hidden = true;
    if (empty) empty.hidden = true;
  }

  function buildCurrentUserContext(uid) {
    var ctx = { uid: uid, displayName: '', email: '', firstName: '', lastName: '' };

    var inst = window.SA_WEB_SESSION;
    if (inst && typeof inst.requireWebStudentSession === 'function') {
      try {
        var s = inst.requireWebStudentSession();
        if (s && String(s.uid).trim() === uid) {
          ctx.displayName = String(s.displayName || s.username || '').trim();
          return ctx;
        }
      } catch (_) {}
    }

    var pub = window.SA_PUBLIC_SESSION;
    if (pub && typeof pub.getPublicSession === 'function') {
      var ps = pub.getPublicSession();
      if (ps && String(ps.uid).trim() === uid) {
        ctx.displayName = String(ps.displayName || '').trim();
        ctx.firstName = String(ps.firstName || '').trim();
        ctx.lastName = String(ps.lastName || '').trim();
        ctx.email = String(ps.email || '').trim();
        return ctx;
      }
    }

    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    if (user) {
      ctx.displayName = String(user.displayName || '').trim();
      ctx.email = String(user.email || '').trim();
    }
    return ctx;
  }

  function findRankInRows(rows, uid) {
    if (!uid || !rows || !rows.length) return 0;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].uid) === uid) return i + 1;
    }
    return 0;
  }

  function renderMyStats(summary, rank, inTopList) {
    var s = summary || {};
    var pointsEl = $('ligler-my-points');
    var rankEl = $('ligler-my-rank');
    var winsEl = $('ligler-my-wins');
    var lossesEl = $('ligler-my-losses');
    var drawsEl = $('ligler-my-draws');
    var matchesEl = $('ligler-my-matches');

    if (pointsEl) pointsEl.textContent = String(s.totalPoints || 0) + ' puan';
    if (winsEl) winsEl.textContent = String(s.wins || 0);
    if (lossesEl) lossesEl.textContent = String(s.losses || 0);
    if (drawsEl) drawsEl.textContent = String(s.draws || 0);
    if (matchesEl) matchesEl.textContent = String(s.matchesPlayed || 0);

    if (rankEl) {
      if (rank > 0) {
        rankEl.textContent = '#' + rank;
      } else if (Number(s.matchesPlayed || 0) > 0) {
        rankEl.textContent = 'İlk ' + LEADERBOARD_LIMIT + ' dışında';
      } else {
        rankEl.textContent = '—';
      }
    }

    var emptyMy = $('ligler-my-empty');
    if (emptyMy) {
      emptyMy.hidden = Number(s.matchesPlayed || 0) > 0 || inTopList;
    }
  }

  function renderLeaderboard(rows, namesByUid, myUid) {
    var list = $('ligler-board-list');
    var empty = $('ligler-board-empty');
    hideBoardMessages();

    if (!rows.length) {
      if (list) {
        list.hidden = true;
        list.innerHTML = '';
      }
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    if (!list) return;

    list.innerHTML = rows
      .map(function (r, idx) {
        var rank = idx + 1;
        var uid = String(r.uid || '');
        var isMe = !!(myUid && uid === myUid);
        var name = (namesByUid && namesByUid[uid]) || ('Kullanıcı ' + uid.slice(0, 6));
        return (
          '<div class="league-row' +
          (isMe ? ' league-row--me' : '') +
          '" data-uid="' +
          escapeHtml(uid) +
          '">' +
          '<div class="league-row__rank">#' +
          rank +
          '</div>' +
          '<div class="league-row__main">' +
          '<div class="league-row__name">' +
          escapeHtml(name) +
          '</div>' +
          '<div class="league-row__sub">G: ' +
          r.wins +
          ' · M: ' +
          r.losses +
          ' · B: ' +
          r.draws +
          ' · Maç: ' +
          r.matchesPlayed +
          '</div>' +
          '</div>' +
          '<div class="league-row__points">' +
          r.totalPoints +
          '<small>Puan</small></div>' +
          '</div>'
        );
      })
      .join('');
    list.hidden = false;
  }

  async function loadAndRender() {
    var uid = getAuthUid();
    if (!uid) {
      showGuestState();
      return;
    }

    showLoggedInState();
    setLoading(true);
    hideBoardMessages();

    var api = window.SA_WEB_DUEL_LEAGUE;
    if (!api || typeof api.fetchLeaderboardTop !== 'function') {
      setLoading(false);
      setBoardError('Lig modülü yüklenemedi.');
      return;
    }

    try {
      var currentUser = buildCurrentUserContext(uid);
      var boardRes = await api.fetchLeaderboardTop(LEADERBOARD_LIMIT);
      var ownRes = await api.fetchOwnLeagueSummary(uid);

      if (!boardRes || !boardRes.ok) {
        setLoading(false);
        setBoardError('Lig tablosu yüklenemedi.');
        console.warn('[WebLigler] load failed', boardRes && boardRes.error ? boardRes.error : boardRes);
        return;
      }

      var rows = boardRes.rows || [];
      var summary =
        ownRes && ownRes.ok && ownRes.summary
          ? ownRes.summary
          : api.normalizeRow
            ? api.normalizeRow(uid, null)
            : { uid: uid, totalPoints: 0, wins: 0, losses: 0, draws: 0, matchesPlayed: 0 };

      var uids = rows.map(function (r) {
        return r.uid;
      });
      if (uids.indexOf(uid) === -1) uids.push(uid);

      var namesRes = await api.resolveDisplayNames(uids, currentUser);
      var namesByUid = (namesRes && namesRes.names) || {};

      var rank = findRankInRows(rows, uid);
      var inTopList = rank > 0;

      renderMyStats(summary, rank, inTopList);
      renderLeaderboard(rows, namesByUid, uid);
      setLoading(false);

      try {
        console.log('[WebLigler] loaded', { count: rows.length, uid: uid });
      } catch (_) {}
    } catch (err) {
      setLoading(false);
      setBoardError('Lig verisi yüklenemedi.');
      try {
        console.warn('[WebLigler] load failed', err);
      } catch (_) {}
    }
  }

  async function refreshPage(ctx) {
    if (!document.body || !document.body.classList.contains('page-ligler')) return;

    if (!ctx || ctx.kind === 'error') {
      showAccessError();
      return;
    }

    if (ctx.kind === 'guest') {
      showGuestState();
      return;
    }

    await loadAndRender();
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-ligler')) return;
    initialized = true;

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showAccessError();
      return;
    }
    viewer.whenReady().then(function (ctx) {
      refreshPage(ctx);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
