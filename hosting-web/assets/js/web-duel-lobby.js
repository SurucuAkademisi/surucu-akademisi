/**
 * Web duel lobby page — presence + online lists + mode selector UI.
 */
(function () {
  'use strict';

  var initialized = false;
  var lobbyContext = null;
  var lobbyActive = false;
  var selectedMode = null;
  var modeSelectorBound = false;
  var refreshBound = false;
  var ACCESS_PENDING_CLASS = 'page-duello--access-pending';
  var accessFailSafeTimer = null;

  var LOG_PREFIX = '[web-duel-lobby]';
  var outgoingInviteId = null;
  var outgoingReceiverUid = null;
  var outgoingInviteUnsub = null;

  var ONLINE_SECTIONS = {
    institution: {
      panelId: 'duel-online-panel-institution',
      listId: 'duel-online-list-institution',
      emptyId: 'duel-online-empty-institution',
      errorId: 'duel-online-error-institution',
      emptyText: 'Kurum içinde başka çevrimiçi aday yok.'
    },
    global: {
      panelId: 'duel-online-panel-global',
      listId: 'duel-online-list-global',
      emptyId: 'duel-online-empty-global',
      errorId: 'duel-online-error-global',
      emptyText: 'Türkiye genelinde başka çevrimiçi aday yok.'
    },
    publicGlobal: {
      panelId: 'duel-online-panel-public',
      listId: 'duel-online-list-public',
      emptyId: 'duel-online-empty-public',
      errorId: 'duel-online-error-public',
      emptyText: 'Türkiye genelinde başka çevrimiçi aday yok.'
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function clearAccessFailSafe() {
    if (accessFailSafeTimer) {
      window.clearTimeout(accessFailSafeTimer);
      accessFailSafeTimer = null;
    }
  }

  function isAccessPending() {
    return !!(document.body && document.body.classList.contains(ACCESS_PENDING_CLASS));
  }

  function hideAccessStatus() {
    var status = $('duel-access-status');
    if (!status) return;
    status.hidden = true;
    status.setAttribute('aria-hidden', 'true');
  }

  function showAccessStatus() {
    var status = $('duel-access-status');
    if (!status) return;
    status.hidden = false;
    status.setAttribute('aria-hidden', 'false');
  }

  function scheduleAccessFailSafe() {
    // Auth waiting / finalization is owned by SA_VIEWER_CONTEXT.whenReady().
    clearAccessFailSafe();
  }

  function buildLobbyContextFromViewer(ctx) {
    if (!ctx) return null;
    if (ctx.kind === 'institution' && ctx.institutionSession) {
      var s = ctx.institutionSession;
      return {
        kind: 'institution_student',
        uid: String(s.uid || '').trim(),
        tenantId: String(s.tenantId || '').trim(),
        tenantName: s.tenantName || null,
        displayName: s.displayName || null,
        username: s.username || null
      };
    }
    if (ctx.kind === 'public' && ctx.publicSession) {
      var p = ctx.publicSession;
      var display =
        String(p.displayName || '').trim() ||
        String(p.firstName || '').trim() ||
        'Üye';
      return {
        kind: 'public_user',
        uid: String(p.uid || '').trim(),
        tenantId: '__global__',
        tenantName: null,
        displayName: display,
        username: null
      };
    }
    return null;
  }

  function applyViewerAccessResult(ctx) {
    if (!ctx || !ctx.kind) {
      showTechnicalFailureState();
      return;
    }

    if (ctx.kind === 'pending') {
      showPendingAccessState();
      return;
    }

    if (ctx.kind === 'error') {
      if (lobbyActive) cleanupLobby();
      showTechnicalFailureState();
      return;
    }

    if (ctx.kind === 'guest') {
      if (lobbyActive) cleanupLobby();
      showGuestState();
      return;
    }

    var api = window.SA_WEB_DUEL_PRESENCE;
    var context = api && typeof api.resolveDuelContext === 'function' ? api.resolveDuelContext() : null;
    if (!context || context.kind === 'guest' || context.kind === 'unresolved') {
      context = buildLobbyContextFromViewer(ctx);
    }
    if (!context || !context.uid || context.kind === 'guest' || context.kind === 'unresolved') {
      showTechnicalFailureState();
      return;
    }

    initLobby(context);
  }

  function refreshLobby() {
    if (!document.body || !document.body.classList.contains('page-duello')) return;

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showTechnicalFailureState();
      return;
    }

    showPendingAccessState();
    viewer.whenReady().then(applyViewerAccessResult);
  }

  function cleanupLobby() {
    lobbyActive = false;
    lobbyContext = null;
    clearOutgoingInviteState();
    var api = window.SA_WEB_DUEL_PRESENCE;
    if (api && typeof api.cleanupPresenceListeners === 'function') {
      api.cleanupPresenceListeners();
    }
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-duello')) return;
    initialized = true;

    showPendingAccessState();

    var nav = window.SA_WEB_MODULE_NAV;
    if (nav && typeof nav.applyPortalHomeLinks === 'function') {
      nav.applyPortalHomeLinks();
    }

    refreshLobby();
    window.addEventListener('beforeunload', cleanupLobby);
    window.addEventListener('pagehide', cleanupLobby);
  }

  function clearAccessPending() {
    clearAccessFailSafe();
    if (document.body) {
      document.body.classList.remove(ACCESS_PENDING_CLASS);
    }
  }

  function showPendingAccessState() {
    var guestCta = $('duel-guest-cta');
    var lobby = $('duel-lobby-content');
    if (guestCta) {
      guestCta.hidden = true;
      guestCta.setAttribute('aria-hidden', 'true');
    }
    if (lobby) lobby.hidden = true;
    hideAccessStatus();
    if (document.body) {
      document.body.classList.add(ACCESS_PENDING_CLASS);
    }
    scheduleAccessFailSafe();
  }

  function showGuestState() {
    var guestCta = $('duel-guest-cta');
    var lobby = $('duel-lobby-content');
    if (guestCta) {
      guestCta.hidden = false;
      guestCta.setAttribute('aria-hidden', 'false');
    }
    if (lobby) lobby.hidden = true;
    hideAccessStatus();
    clearAccessPending();
  }

  function showLobbyState() {
    var guestCta = $('duel-guest-cta');
    var lobby = $('duel-lobby-content');
    if (guestCta) {
      guestCta.hidden = true;
      guestCta.setAttribute('aria-hidden', 'true');
    }
    if (lobby) lobby.hidden = false;
    hideAccessStatus();
    clearAccessPending();
  }

  function showTechnicalFailureState() {
    var guestCta = $('duel-guest-cta');
    var lobby = $('duel-lobby-content');
    if (guestCta) {
      guestCta.hidden = true;
      guestCta.setAttribute('aria-hidden', 'true');
    }
    if (lobby) lobby.hidden = true;
    showAccessStatus();
    clearAccessPending();
  }

  function hasActiveOutgoingInvite() {
    return !!outgoingInviteId;
  }

  function stopOutgoingInviteWatch() {
    if (outgoingInviteUnsub) {
      try {
        outgoingInviteUnsub();
      } catch (_) {}
      outgoingInviteUnsub = null;
    }
  }

  function clearOutgoingInviteState() {
    stopOutgoingInviteWatch();
    outgoingInviteId = null;
    outgoingReceiverUid = null;
  }

  function deriveInviteScope(sectionKey) {
    if (sectionKey === 'institution') {
      return {
        scope: 'institution',
        tenantId:
          lobbyContext && lobbyContext.tenantId
            ? normalizeUid(lobbyContext.tenantId) || null
            : null
      };
    }
    return {
      scope: 'global',
      tenantId:
        lobbyContext &&
        lobbyContext.kind === 'institution_student' &&
        lobbyContext.tenantId
          ? normalizeUid(lobbyContext.tenantId) || null
          : null
    };
  }

  function setInviteButtonState(btn, state) {
    if (!btn) return;
    var labels = {
      idle: 'Davet Gönder',
      sending: 'Gönderiliyor…',
      sent: 'Davet Gönderildi',
      waiting: 'Kabul Bekleniyor',
      failed: 'Davet Gönder'
    };
    btn.textContent = labels[state] || labels.idle;
    btn.dataset.state = state;
    btn.disabled = state === 'sending' || state === 'sent' || state === 'waiting';
  }

  function resetInviteButtons() {
    var buttons = document.querySelectorAll('.duel-online-invite-btn');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!btn) continue;
      btn.dataset.outgoingActive = '';
      setInviteButtonState(btn, 'idle');
    }
  }

  function syncInviteButtonsAfterRender() {
    var buttons = document.querySelectorAll('.duel-online-invite-btn');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!btn) continue;
      if (!hasActiveOutgoingInvite()) {
        setInviteButtonState(btn, 'idle');
        continue;
      }
      var row = btn.closest('.duel-online-item');
      var rowUid = row && row.getAttribute('data-opponent-uid');
      if (outgoingReceiverUid && rowUid === outgoingReceiverUid) {
        btn.dataset.outgoingActive = '1';
        setInviteButtonState(btn, 'waiting');
      } else {
        btn.disabled = true;
      }
    }
  }

  function handleOutgoingInviteSnapshot(snap) {
    if (!snap || !snap.ok) return;

    var invitesApi = window.SA_WEB_DUEL_INVITES;
    if (!snap.exists || !snap.invite) {
      clearOutgoingInviteState();
      resetInviteButtons();
      return;
    }

    var inv = snap.invite;
    var st = (inv.status || '').toLowerCase();

    if (st === 'accepted' && inv.duelId) {
      stopOutgoingInviteWatch();
      var url =
        invitesApi && typeof invitesApi.buildDuelGameUrl === 'function'
          ? invitesApi.buildDuelGameUrl(inv.duelId)
          : '';
      if (url) {
        window.location.href = url;
      }
      return;
    }

    if (
      st === 'rejected' ||
      st === 'cancelled' ||
      st === 'timeout' ||
      (st === 'pending' && !inv.active)
    ) {
      clearOutgoingInviteState();
      resetInviteButtons();
    }
  }

  async function handleSendInvite(user, sectionKey, btn) {
    if (!user || !user.uid || !lobbyContext || !btn) return;
    if (hasActiveOutgoingInvite()) return;

    var invitesApi = window.SA_WEB_DUEL_INVITES;
    if (!invitesApi || typeof invitesApi.sendOutgoingInvite !== 'function') {
      console.warn(LOG_PREFIX + ' outgoing invite failed: api_unavailable');
      return;
    }

    var scopeInfo = deriveInviteScope(sectionKey);
    setInviteButtonState(btn, 'sending');

    try {
      var result = await invitesApi.sendOutgoingInvite({
        receiverId: user.uid,
        receiverName: user.displayName || 'Kullanıcı',
        scope: scopeInfo.scope,
        tenantId: scopeInfo.tenantId,
        senderName: lobbyContext.displayName || lobbyContext.username || undefined
      });

      if (!result || !result.ok || !result.inviteId) {
        console.warn(LOG_PREFIX + ' outgoing invite failed', result);
        setInviteButtonState(btn, 'failed');
        btn.disabled = false;
        btn.dataset.state = 'idle';
        btn.textContent = 'Davet Gönder';
        return;
      }

      outgoingInviteId = result.inviteId;
      outgoingReceiverUid = normalizeUid(user.uid);
      btn.dataset.outgoingActive = '1';
      setInviteButtonState(btn, 'sent');

      window.setTimeout(function () {
        if (outgoingInviteId === result.inviteId && btn.dataset.state === 'sent') {
          setInviteButtonState(btn, 'waiting');
        }
      }, 600);

      syncInviteButtonsAfterRender();

      stopOutgoingInviteWatch();
      if (typeof invitesApi.subscribeOutgoingInvite === 'function') {
        outgoingInviteUnsub = invitesApi.subscribeOutgoingInvite(
          result.inviteId,
          handleOutgoingInviteSnapshot
        );
      }
    } catch (e) {
      console.warn(LOG_PREFIX + ' outgoing invite failed', e);
      setInviteButtonState(btn, 'failed');
      btn.disabled = false;
      btn.dataset.state = 'idle';
      btn.textContent = 'Davet Gönder';
    }
  }

  function createInviteButton(user, sectionKey) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'duel-online-invite-btn';
    btn.textContent = 'Davet Gönder';
    btn.dataset.state = 'idle';

    if (
      hasActiveOutgoingInvite() &&
      outgoingReceiverUid &&
      normalizeUid(user && user.uid) === outgoingReceiverUid
    ) {
      btn.dataset.outgoingActive = '1';
      setInviteButtonState(btn, 'waiting');
    } else if (hasActiveOutgoingInvite()) {
      btn.disabled = true;
    }

    btn.addEventListener('click', function () {
      handleSendInvite(user, sectionKey, btn);
    });
    return btn;
  }

  function normalizeUid(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function getUserMeta(user, sectionKey) {
    if (!user) return '';
    if (user.username && String(user.username).trim()) {
      return String(user.username).trim();
    }
    if (user.tenantName && String(user.tenantName).trim()) {
      return String(user.tenantName).trim();
    }
    if (sectionKey === 'global' || sectionKey === 'publicGlobal') {
      if (user.tenantId === '__global__') return 'Genel üye';
    }
    return '';
  }

  function buildSelfUser(context) {
    if (!context || context.kind === 'guest' || !context.uid) return null;
    var displayName =
      (context.displayName && String(context.displayName).trim()) ||
      (context.username && String(context.username).trim()) ||
      (context.kind === 'public_user' ? 'Üye' : 'Öğrenci');
    return {
      uid: context.uid,
      displayName: displayName,
      username: context.username || null,
      tenantId: context.tenantId || null,
      tenantName: context.tenantName || null,
      isSelf: true,
      online: true
    };
  }

  function shouldShowSelfInSection(sectionKey, context) {
    if (!context || context.kind === 'guest') return false;
    if (context.kind === 'institution_student') {
      return sectionKey === 'institution' || sectionKey === 'global';
    }
    if (context.kind === 'public_user') {
      return sectionKey === 'publicGlobal' || sectionKey === 'global';
    }
    return false;
  }

  function mergeSelfForDisplay(users, context, sectionKey) {
    var list = Array.isArray(users) ? users.slice() : [];
    if (!shouldShowSelfInSection(sectionKey, context)) return list;

    var selfUid = normalizeUid(context && context.uid);
    if (selfUid) {
      list = list.filter(function (user) {
        return normalizeUid(user && user.uid) !== selfUid;
      });
    }

    var self = buildSelfUser(context);
    if (self) list.unshift(self);
    return list;
  }

  function createOnlineUserRow(user, sectionKey) {
    var item = document.createElement('li');
    item.className = 'duel-online-item';
    if (user && user.uid) {
      item.setAttribute('data-opponent-uid', normalizeUid(user.uid));
    }
    if (user && user.isSelf) item.classList.add('duel-online-item--self');

    var info = document.createElement('div');
    info.className = 'duel-online-item__info';

    var nameRow = document.createElement('div');
    nameRow.className = 'duel-online-item__name-row';

    var name = document.createElement('span');
    name.className = 'duel-online-item__name';
    name.textContent = user.displayName || 'Kullanıcı';
    nameRow.appendChild(name);

    if (user && user.isSelf) {
      var badge = document.createElement('span');
      badge.className = 'duel-online-self-badge';
      badge.textContent = 'Sen';
      nameRow.appendChild(badge);
    }

    info.appendChild(nameRow);

    var metaText = getUserMeta(user, sectionKey);
    if (metaText) {
      var meta = document.createElement('span');
      meta.className = 'duel-online-item__meta';
      meta.textContent = metaText;
      info.appendChild(meta);
    }

    item.appendChild(info);

    if (user && user.isSelf) {
      var status = document.createElement('span');
      status.className = 'duel-online-self-status';
      status.textContent = 'Çevrimiçi';
      item.appendChild(status);
    } else {
      item.appendChild(createInviteButton(user, sectionKey));
    }

    return item;
  }

  function updateModeButtonStates() {
    var buttons = document.querySelectorAll('.duel-mode-btn[data-duel-mode]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!btn || btn.hidden) continue;
      var mode = btn.getAttribute('data-duel-mode');
      var active = mode === selectedMode;
      btn.classList.toggle('duel-mode-btn--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function highlightOnlinePanelForMode(mode) {
    var inst = $('duel-online-panel-institution');
    var glob = $('duel-online-panel-global');
    var pub = $('duel-online-panel-public');

    if (inst) inst.classList.toggle('duel-online-card--mode-active', mode === 'institution');
    if (glob) glob.classList.toggle('duel-online-card--mode-active', mode === 'global');
    if (pub) pub.classList.toggle('duel-online-card--mode-active', mode === 'publicGlobal');
  }

  function setSelectedMode(mode) {
    selectedMode = mode;
    updateModeButtonStates();
    highlightOnlinePanelForMode(mode);
  }

  function configureModeSelector(context) {
    var instBtn = $('duel-mode-institution');
    var globalBtn = $('duel-mode-global');
    var publicBtn = $('duel-mode-public');
    var isInstitution = context && context.kind === 'institution_student';

    if (instBtn) instBtn.hidden = !isInstitution;
    if (globalBtn) globalBtn.hidden = !isInstitution;
    if (publicBtn) publicBtn.hidden = isInstitution;

    if (isInstitution) {
      if (selectedMode !== 'institution' && selectedMode !== 'global') {
        selectedMode = 'institution';
      }
    } else {
      selectedMode = 'publicGlobal';
    }

    setSelectedMode(selectedMode);
  }

  function bindModeSelector() {
    if (modeSelectorBound) return;
    var selector = $('duel-mode-selector');
    if (!selector) return;

    modeSelectorBound = true;
    selector.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var btn = target.closest('.duel-mode-btn[data-duel-mode]');
      if (!btn || btn.hidden) return;
      var mode = btn.getAttribute('data-duel-mode');
      if (!mode) return;
      setSelectedMode(mode);
    });
  }

  function bindRefreshButton() {
    if (refreshBound) return;
    var btn = $('duel-online-refresh');
    if (!btn) return;

    refreshBound = true;
    btn.addEventListener('click', function () {
      refreshOnlineLists();
    });
  }

  function configureOnlinePanels(context) {
    var grid = $('duel-online-grid');
    var isInstitution = context && context.kind === 'institution_student';

    var instPanel = $('duel-online-panel-institution');
    var globalPanel = $('duel-online-panel-global');
    var publicPanel = $('duel-online-panel-public');

    if (instPanel) instPanel.hidden = !isInstitution;
    if (globalPanel) globalPanel.hidden = !isInstitution;
    if (publicPanel) publicPanel.hidden = isInstitution;

    if (grid) {
      grid.classList.toggle('duel-online-grid--institution', isInstitution);
      grid.classList.toggle('duel-online-grid--public', !isInstitution);
    }
  }

  function renderOnlineSection(sectionKey, users, hadError) {
    var section = ONLINE_SECTIONS[sectionKey];
    if (!section) return;

    var listEl = $(section.listId);
    var emptyEl = $(section.emptyId);
    var errorEl = $(section.errorId);
    if (!listEl || !emptyEl) return;

    listEl.innerHTML = '';

    if (errorEl) {
      errorEl.hidden = !hadError;
    }

    if (hadError) {
      emptyEl.hidden = true;
      listEl.hidden = true;
      return;
    }

    var display = mergeSelfForDisplay(users, lobbyContext, sectionKey);
    if (!display.length) {
      emptyEl.textContent = section.emptyText;
      emptyEl.hidden = false;
      listEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;

    display.forEach(function (user) {
      listEl.appendChild(createOnlineUserRow(user, sectionKey));
    });
    syncInviteButtonsAfterRender();
  }

  function subscribeOnlineLists(context, api) {
    if (context.kind === 'institution_student') {
      api.subscribeOnlineUsers(
        context,
        function (result) {
          renderOnlineSection(
            'institution',
            (result && result.users) || [],
            !!(result && result.error)
          );
        },
        { scope: 'tenant' }
      );

      api.subscribeOnlineUsers(
        context,
        function (result) {
          renderOnlineSection('global', (result && result.users) || [], !!(result && result.error));
        },
        { scope: 'global' }
      );
      return;
    }

    api.subscribeOnlineUsers(
      context,
      function (result) {
        renderOnlineSection(
          'publicGlobal',
          (result && result.users) || [],
          !!(result && result.error)
        );
      },
      { scope: 'global' }
    );
  }

  async function refreshOnlineLists() {
    if (!lobbyActive || !lobbyContext) return;

    var api = window.SA_WEB_DUEL_PRESENCE;
    if (!api) return;

    if (typeof api.cleanupPresenceListeners === 'function') {
      api.cleanupPresenceListeners();
    }

    try {
      await api.writeOwnPresence(lobbyContext);
    } catch (e) {
      console.warn('[web-duel-lobby] refresh presence write failed', e);
    }

    subscribeOnlineLists(lobbyContext, api);
  }

  async function initLobby(context) {
    if (lobbyActive && lobbyContext && lobbyContext.kind === context.kind && lobbyContext.uid === context.uid) {
      return;
    }

    if (lobbyActive) {
      var presenceApi = window.SA_WEB_DUEL_PRESENCE;
      if (presenceApi && typeof presenceApi.cleanupPresenceListeners === 'function') {
        presenceApi.cleanupPresenceListeners();
      }
    }

    lobbyContext = context;
    lobbyActive = true;
    configureModeSelector(context);
    configureOnlinePanels(context);
    bindModeSelector();
    bindRefreshButton();
    highlightOnlinePanelForMode(selectedMode);
    showLobbyState();

    var api = window.SA_WEB_DUEL_PRESENCE;
    if (!api) return;

    try {
      await api.writeOwnPresence(context);
    } catch (e) {
      console.warn('[web-duel-lobby] initial presence write failed', e);
    }

    subscribeOnlineLists(context, api);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
