/**
 * Site-wide duel incoming invite toast (W2.5) — single subscription, reject only.
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-duel-notifications]';
  var INCOMING_INVITES_EVENT = 'sa:duel-incoming-invites';
  var listenerUid = null;
  var inviteListenerActive = false;
  var subscribePendingUid = null;
  var subscribeGeneration = 0;
  var firestoreListenerLive = false;
  var lastListenerError = null;
  var activeInviteId = null;
  var displayedInviteId = null;
  var lastSnapshot = { ok: true, invites: [] };
  var rejectInFlight = false;
  var acceptInFlight = false;
  var countdownTimerId = null;
  var toastElements = null;

  function getPresenceApi() {
    return window.SA_WEB_DUEL_PRESENCE || null;
  }

  function getInvitesApi() {
    return window.SA_WEB_DUEL_INVITES || null;
  }

  function resolveContext() {
    var presence = getPresenceApi();
    if (!presence || typeof presence.resolveDuelContext !== 'function') return { kind: 'guest' };
    try {
      return presence.resolveDuelContext() || { kind: 'guest' };
    } catch (e) {
      console.warn(LOG_PREFIX + ' resolve context failed', e);
      return { kind: 'guest' };
    }
  }

  function getScopeLabel(scope) {
    return scope === 'institution' ? 'Kurum düellosu' : 'Genel düello';
  }

  function formatRemainingTime(remainingMs) {
    var ms = typeof remainingMs === 'number' ? remainingMs : 0;
    if (ms <= 0) return '';
    var sec = Math.max(0, Math.ceil(ms / 1000));
    return sec + ' sn kaldı';
  }

  function dispatchInvitesEvent(result) {
    lastSnapshot = result || { ok: true, invites: [] };
    try {
      window.dispatchEvent(
        new CustomEvent(INCOMING_INVITES_EVENT, {
          detail: lastSnapshot
        })
      );
    } catch (e) {
      console.warn(LOG_PREFIX + ' dispatch failed', e);
    }
  }

  function ensureToastRoot() {
    var root = document.getElementById('sa-duel-toast-root');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'sa-duel-toast-root';
    root.className = 'sa-duel-toast-root';
    root.setAttribute('aria-live', 'polite');
    root.hidden = true;
    document.body.appendChild(root);
    return root;
  }

  function hideToast() {
    var root = document.getElementById('sa-duel-toast-root');
    if (root) root.hidden = true;
    activeInviteId = null;
    displayedInviteId = null;
    toastElements = null;
    if (countdownTimerId) {
      window.clearInterval(countdownTimerId);
      countdownTimerId = null;
    }
  }

  function getPrimaryInvite(invites) {
    if (!Array.isArray(invites) || !invites.length) return null;
    return invites[0];
  }

  function updateToastCountdown(invite) {
    if (!toastElements || !invite || !invite.id) return;
    if (toastElements.meta) {
      var parts = [getScopeLabel(invite.scope)];
      var remaining = formatRemainingTime(invite.remainingMs);
      if (remaining) parts.push(remaining);
      toastElements.meta.textContent = parts.join(' · ');
    }
  }

  function startCountdownTicker(invite) {
    if (countdownTimerId) {
      window.clearInterval(countdownTimerId);
      countdownTimerId = null;
    }
    if (!invite || !invite.expireAtMs) return;

    countdownTimerId = window.setInterval(function () {
      var nowMs = Date.now();
      var remainingMs = invite.expireAtMs > nowMs ? invite.expireAtMs - nowMs : 0;
      invite.remainingMs = remainingMs;
      updateToastCountdown(invite);
      if (remainingMs <= 0) {
        window.clearInterval(countdownTimerId);
        countdownTimerId = null;
      }
    }, 1000);
  }

  function renderToast(invite, isNewDisplay) {
    if (!invite || !invite.id) {
      hideToast();
      return;
    }

    var root = ensureToastRoot();
    root.hidden = false;
    root.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'sa-duel-toast';
    if (isNewDisplay) card.classList.add('sa-duel-toast--enter');

    var title = document.createElement('p');
    title.className = 'sa-duel-toast-title';
    title.textContent =
      (invite.senderName || 'Bir kullanıcı') + ' sana düello daveti gönderdi.';

    var meta = document.createElement('p');
    meta.className = 'sa-duel-toast-meta';
    var metaParts = [getScopeLabel(invite.scope)];
    var remaining = formatRemainingTime(invite.remainingMs);
    if (remaining) metaParts.push(remaining);
    meta.textContent = metaParts.join(' · ');

    var actions = document.createElement('div');
    actions.className = 'sa-duel-toast-actions';

    var rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'sa-duel-toast-reject';
    rejectBtn.textContent = 'Reddet';
    rejectBtn.addEventListener('click', function () {
      handleReject(invite.id, rejectBtn);
    });

    var acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'sa-duel-toast-accept';
    acceptBtn.textContent = 'Kabul Et';
    acceptBtn.addEventListener('click', function () {
      handleAccept(invite.id, acceptBtn);
    });

    actions.appendChild(rejectBtn);
    actions.appendChild(acceptBtn);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(actions);
    root.appendChild(card);

    toastElements = { meta: meta };
    activeInviteId = invite.id;
    displayedInviteId = invite.id;
    startCountdownTicker(invite);
  }

  function shouldConfirmExamInterrupt() {
    try {
      var path = String(window.location.pathname || '').toLowerCase();
      if (path.indexOf('exam.html') === -1) return false;
      var runner = window.SA_WEB_EXAM_RUNNER;
      if (!runner || typeof runner.getPhase !== 'function') return false;
      return runner.getPhase() === 'solving';
    } catch (_) {
      return false;
    }
  }

  function showAcceptSoftMessage(message) {
    console.warn(LOG_PREFIX + ' accept:', message);
    try {
      window.alert(message);
    } catch (_) {}
  }

  async function handleAccept(inviteId, buttonEl) {
    var id = inviteId ? String(inviteId).trim() : '';
    if (!id || acceptInFlight) return;

    if (shouldConfirmExamInterrupt()) {
      var confirmed = false;
      try {
        confirmed = window.confirm('Devam eden sınavınız kesilecek, düelloya geçilsin mi?');
      } catch (_) {
        confirmed = false;
      }
      if (!confirmed) return;
    }

    var api = getInvitesApi();
    if (!api || typeof api.acceptIncomingInvite !== 'function') return;

    acceptInFlight = true;
    if (buttonEl) buttonEl.disabled = true;

    try {
      var result = await api.acceptIncomingInvite(id);
      if (!result || !result.ok || !result.duelId) {
        var msg =
          api.getAcceptSoftMessage && result && result.reason
            ? api.getAcceptSoftMessage(result.reason)
            : 'Davet kabul edilemedi.';
        showAcceptSoftMessage(msg);
        if (buttonEl) buttonEl.disabled = false;
        return;
      }
      hideToast();
      var url =
        api.buildDuelGameUrl && typeof api.buildDuelGameUrl === 'function'
          ? api.buildDuelGameUrl(result.duelId)
          : '../duello/oyun.html?duelId=' + encodeURIComponent(result.duelId);
      window.location.href = url;
    } catch (e) {
      console.warn(LOG_PREFIX + ' accept failed', e);
      showAcceptSoftMessage('Davet kabul edilemedi. Lütfen tekrar deneyin.');
      if (buttonEl) buttonEl.disabled = false;
    } finally {
      acceptInFlight = false;
    }
  }

  async function handleReject(inviteId, buttonEl) {
    var id = inviteId ? String(inviteId).trim() : '';
    if (!id || rejectInFlight) return;

    var api = getInvitesApi();
    if (!api || typeof api.rejectIncomingInvite !== 'function') return;

    rejectInFlight = true;
    if (buttonEl) buttonEl.disabled = true;

    try {
      var result = await api.rejectIncomingInvite(id);
      if (!result || !result.ok) {
        console.warn(LOG_PREFIX + ' reject soft fail', result);
      }
      hideToast();
    } catch (e) {
      console.warn(LOG_PREFIX + ' reject failed', e);
    } finally {
      rejectInFlight = false;
      if (buttonEl) buttonEl.disabled = false;
    }
  }

  function onInvitesSnapshot(result) {
    dispatchInvitesEvent(result);

    if (result && result.error) {
      hideToast();
      return;
    }

    var invites = (result && result.invites) || [];
    var primary = getPrimaryInvite(invites);

    if (!primary) {
      hideToast();
      return;
    }

    activeInviteId = primary.id;

    if (displayedInviteId === primary.id) {
      updateToastCountdown(primary);
      return;
    }

    renderToast(primary, true);
  }

  function clearInviteListenerState() {
    listenerUid = null;
    inviteListenerActive = false;
    subscribePendingUid = null;
    firestoreListenerLive = false;
    lastListenerError = null;
  }

  function cleanupInviteListenersOnly() {
    var api = getInvitesApi();
    if (api && typeof api.cleanupInviteListeners === 'function') {
      api.cleanupInviteListeners();
    }
    firestoreListenerLive = false;
  }

  function hasActiveInviteListener(uid) {
    if (subscribePendingUid && subscribePendingUid === uid) return true;
    return inviteListenerActive && listenerUid === uid && firestoreListenerLive;
  }

  function shouldForceResubscribe(ctx) {
    if (!ctx || ctx.kind === 'guest' || !ctx.uid) return false;
    if (!hasActiveInviteListener(ctx.uid)) return true;
    if (lastListenerError) return true;
    return false;
  }

  function startInviteSubscription(uid) {
    var receiverId = uid ? String(uid).trim() : '';
    if (!receiverId) return false;

    var api = getInvitesApi();
    if (!api || typeof api.subscribeIncomingInvites !== 'function') {
      clearInviteListenerState();
      lastListenerError = 'api_unavailable';
      return false;
    }

    subscribeGeneration += 1;
    var callbackGeneration = subscribeGeneration;
    subscribePendingUid = receiverId;
    firestoreListenerLive = false;

    api.subscribeIncomingInvites(receiverId, function (result) {
      if (callbackGeneration !== subscribeGeneration) return;

      if (subscribePendingUid === receiverId) {
        subscribePendingUid = null;
      }

      if (result && result.ok && !result.skipped) {
        listenerUid = receiverId;
        inviteListenerActive = true;
        firestoreListenerLive = true;
        lastListenerError = null;
      } else {
        listenerUid = null;
        inviteListenerActive = false;
        firestoreListenerLive = false;
        if (result && result.error) {
          lastListenerError = result.error;
        } else if (result && result.skipped) {
          lastListenerError = 'skipped';
        } else {
          lastListenerError = 'subscribe_failed';
        }
      }

      onInvitesSnapshot(result);
    });

    return true;
  }

  function stopInviteSubscription() {
    cleanupInviteListenersOnly();
    subscribeGeneration += 1;
    clearInviteListenerState();
    hideToast();
    lastSnapshot = { ok: true, invites: [] };
    dispatchInvitesEvent(lastSnapshot);
  }

  function refreshPresence(context) {
    var presence = getPresenceApi();
    if (!presence) return;

    if (!context || context.kind === 'guest' || !context.uid) {
      if (typeof presence.stopPresenceHeartbeat === 'function') {
        presence.stopPresenceHeartbeat();
      }
      return;
    }

    if (typeof presence.startPresenceHeartbeat === 'function') {
      presence.startPresenceHeartbeat(context);
    }
  }

  function stopPageSubscriptions() {
    stopInviteSubscription();
    var presence = getPresenceApi();
    if (presence && typeof presence.stopPresenceHeartbeat === 'function') {
      presence.stopPresenceHeartbeat();
    }
  }

  function refreshSubscription(forceResubscribe) {
    var ctx = resolveContext();
    refreshPresence(ctx);

    if (!ctx || ctx.kind === 'guest' || !ctx.uid) {
      if (listenerUid || inviteListenerActive || subscribePendingUid) {
        stopInviteSubscription();
      }
      return;
    }

    if (!forceResubscribe && hasActiveInviteListener(ctx.uid)) {
      return;
    }

    if (listenerUid || inviteListenerActive || subscribePendingUid) {
      cleanupInviteListenersOnly();
      clearInviteListenerState();
    }

    startInviteSubscription(ctx.uid);
  }

  function onPageShow(e) {
    if (e && e.persisted) {
      cleanupInviteListenersOnly();
      clearInviteListenerState();
    }
    var ctx = resolveContext();
    var force = !!(e && e.persisted);
    if (!force && ctx && ctx.kind !== 'guest' && ctx.uid) {
      force = shouldForceResubscribe(ctx);
    }
    refreshSubscription(force);
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    var ctx = resolveContext();
    if (!ctx || ctx.kind === 'guest' || !ctx.uid) return;
    refreshSubscription(shouldForceResubscribe(ctx));
  }

  function waitForAuthThenRefresh() {
    var fb = window.SA_WEB_FIREBASE;
    var auth = fb && fb.auth ? fb.auth : null;
    if (!auth || typeof auth.onAuthStateChanged !== 'function') {
      refreshSubscription();
      return;
    }

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      refreshSubscription();
    }

    var unsub = auth.onAuthStateChanged(function () {
      if (typeof unsub === 'function') unsub();
      finish();
    });
    window.setTimeout(finish, 4000);
  }

  function init() {
    if (window.__saDuelNotificationsStarted) return;
    if (!document.body) return;

    window.__saDuelNotificationsStarted = true;

    waitForAuthThenRefresh();

    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.auth && typeof fb.auth.onAuthStateChanged === 'function') {
      fb.auth.onAuthStateChanged(function () {
        refreshSubscription();
      });
    }

    window.addEventListener('beforeunload', stopPageSubscriptions);
    window.addEventListener('pagehide', stopPageSubscriptions);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  window.SA_WEB_DUEL_NOTIFICATIONS = {
    INCOMING_INVITES_EVENT: INCOMING_INVITES_EVENT,
    getLastSnapshot: function () {
      return lastSnapshot;
    },
    getListenerState: function () {
      return {
        uid: listenerUid,
        active: inviteListenerActive,
        live: firestoreListenerLive,
        pendingUid: subscribePendingUid,
        generation: subscribeGeneration,
        error: lastListenerError
      };
    },
    refreshSubscription: refreshSubscription,
    stopInviteSubscription: stopInviteSubscription
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
