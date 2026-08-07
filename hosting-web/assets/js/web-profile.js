/**
 * Profilim — profile page (institution student / public_user / guest).
 */
(function () {
  'use strict';

  var initialized = false;
  var INSTITUTION_ROLE_LABEL = 'Kurum öğrencisi';
  var PUBLIC_ROLE_LABEL = 'Ücretsiz üye';
  var EMPTY_ATTEMPTS_MSG = 'Henüz deneme sınavı çözülmemiş.';
  var EMPTY_LESSONS_MSG = 'Henüz tamamlanmış ders yok.';

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value != null && String(value).trim() ? String(value).trim() : '—';
  }

  function setRowVisible(rowId, visible) {
    var row = $(rowId);
    if (!row) return;
    row.hidden = !visible;
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    return fb && fb.ready && fb.auth ? fb.auth : null;
  }

  function getAuthEmail() {
    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    return user && user.email ? String(user.email).trim() : '';
  }

  function applyPortalHomeLinks() {
    var nav = window.SA_WEB_MODULE_NAV;
    if (nav && typeof nav.applyPortalHomeLinks === 'function') {
      nav.applyPortalHomeLinks();
    }
  }

  function showGuestState() {
    var guestCta = $('profile-guest-cta');
    var content = $('profile-content');
    if (guestCta) guestCta.hidden = false;
    if (content) content.hidden = true;
    stopStudentMessagesRealtime();
    updateStudentMessagesUnreadBadge(0);
    applyPortalHomeLinks();
  }

  function showLoggedInState() {
    var guestCta = $('profile-guest-cta');
    var content = $('profile-content');
    if (guestCta) guestCta.hidden = true;
    if (content) content.hidden = false;
  }

  function showAccessError() {
    var guestCta = $('profile-guest-cta');
    var content = $('profile-content');
    if (guestCta) guestCta.hidden = true;
    if (content) content.hidden = false;
    applyPortalHomeLinks();
    setMessagesCardMode('institution');
    renderMessagesError('Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.');
  }

  function formatTryAmount(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return (
      n.toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }) + ' ₺'
    );
  }

  function setAccountStatusCardMode(mode) {
    var card = $('profile-account-status-card');
    var titleEl = $('profile-account-status-title');
    var membershipEl = $('profile-account-status-membership');
    var paymentEl = $('profile-account-status-payment');

    if (card) {
      if (mode === 'institution') {
        card.classList.remove('profile-stat-card--placeholder');
        card.classList.add('profile-stat-card--live');
      } else {
        card.classList.add('profile-stat-card--placeholder');
        card.classList.remove('profile-stat-card--live');
      }
    }

    if (titleEl) {
      titleEl.textContent =
        mode === 'institution' ? 'Ödeme / Bakiye' : 'Üyelik / Satın Alma Geçmişi';
    }

    if (membershipEl) membershipEl.hidden = mode === 'institution';
    if (paymentEl) paymentEl.hidden = mode !== 'institution';
  }

  function setPaymentLoading(loading) {
    var loadingEl = $('profile-payment-loading');
    var summaryEl = $('profile-payment-summary');
    var emptyEl = $('profile-payment-empty');

    if (loadingEl) loadingEl.hidden = !loading;
    if (loading) {
      if (summaryEl) summaryEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
    }
  }

  function renderPaymentSummary(summary) {
    var summaryEl = $('profile-payment-summary');
    var emptyEl = $('profile-payment-empty');
    var totalEl = $('profile-payment-total');
    var paidEl = $('profile-payment-paid');
    var remainingEl = $('profile-payment-remaining');
    var installmentEl = $('profile-payment-installment');
    var activeEl = $('profile-payment-installment-active');
    var inactiveEl = $('profile-payment-installment-inactive');
    var noteEl = $('profile-payment-note');

    var data = summary || {};
    var installmentEnabled = data.installmentEnabled === true;

    if (emptyEl) emptyEl.hidden = true;
    if (summaryEl) summaryEl.hidden = false;

    if (totalEl) totalEl.textContent = formatTryAmount(data.totalAmount);
    if (paidEl) paidEl.textContent = formatTryAmount(data.paidAmount);
    if (remainingEl) remainingEl.textContent = formatTryAmount(data.remainingAmount);
    if (installmentEl) {
      installmentEl.textContent = installmentEnabled
        ? formatTryAmount(data.monthlyInstallmentAmount)
        : '—';
    }

    if (activeEl) activeEl.hidden = !installmentEnabled;
    if (inactiveEl) inactiveEl.hidden = installmentEnabled;

    if (noteEl) {
      var note = String(data.note || '').trim();
      if (note) {
        noteEl.textContent = 'Durum / Not: ' + note;
        noteEl.hidden = false;
      } else {
        noteEl.textContent = '';
        noteEl.hidden = true;
      }
    }
  }

  function renderPaymentEmpty() {
    var summaryEl = $('profile-payment-summary');
    var emptyEl = $('profile-payment-empty');

    if (summaryEl) summaryEl.hidden = true;
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Henüz ödeme bilgisi eklenmemiş.';
    }
  }

  function renderPublicAccountStatusPlaceholder() {
    setAccountStatusCardMode('public');
  }

  async function loadAndRenderPaymentSummary(session) {
    setAccountStatusCardMode('institution');

    var tenantId = String((session && session.tenantId) || '').trim();
    var uid = String((session && session.uid) || '').trim();

    if (!tenantId || !uid || !authUidMatches(uid)) {
      setPaymentLoading(false);
      renderPaymentEmpty();
      return;
    }

    var api = window.SA_WEB_PROFILE_PAYMENT_REPOSITORY;
    if (!api || typeof api.getStudentPaymentSummary !== 'function') {
      setPaymentLoading(false);
      renderPaymentEmpty();
      return;
    }

    setPaymentLoading(true);

    try {
      var result = await api.getStudentPaymentSummary(tenantId, uid);
      if (result && result.ok && result.exists && result.summary) {
        renderPaymentSummary(result.summary);
      } else {
        renderPaymentEmpty();
      }
    } catch (e) {
      console.warn('[web-profile] payment summary load failed', e);
      renderPaymentEmpty();
    } finally {
      setPaymentLoading(false);
    }
  }

  var MESSAGES_EMPTY_TEXT = 'Henüz mesajınız yok.';
  var MESSAGES_EMPTY_PUBLIC_TEXT = 'Henüz sistem mesajınız bulunmuyor.';
  var MESSAGES_LOADING_TEXT = 'Mesajlar yükleniyor...';
  var MESSAGES_ERROR_TEXT = 'Mesajlar yüklenemedi.';
  var MESSAGES_ERROR_PUBLIC_TEXT = 'Mesajlar yüklenemedi. Lütfen daha sonra tekrar deneyin.';
  var SNIPPET_MAX_LEN = 140;
  var profileMessagesById = {};
  var profileMessagesThreadMap = {};
  var profileMessagesDocsById = {};
  var profileMessagesSession = { tenantId: '', uid: '', displayName: '', email: '', isPublicUser: false, readOnly: false, tenantDisplayName: '' };
  var profileMessageReplySending = false;
  var profileMessageModalOpen = false;
  var profileMessageEscapeHandler = null;
  var profileMessageReplyPanelOpen = false;
  var profileMessageModalReplyable = false;
  var profileMessageViewMode = 'single';
  var profileMessageActiveThreadId = null;
  var studentMailboxListenerStarted = false;
  var profileMailboxSoftHideConfirmState = {
    open: false,
    mode: '',
    pendingId: '',
    busy: false,
    ran: false,
    action: null,
    triggerElement: null
  };
  var profileMailboxSoftHideConfirmBound = false;
  var PROFILE_MAILBOX_SOFT_HIDE_LABELS = {
    conversation: {
      eyebrow: 'KONUŞMAYI SİL',
      title: 'Bu konuşma Mesajlarım’dan kaldırılsın mı?',
      description: 'Bu konuşma yalnızca sizin mesaj kutunuzdan kaldırılır. Karşı tarafın mesaj geçmişi etkilenmez. Yeni bir mesaj gelirse konuşma tekrar görünebilir.',
      confirm: 'Konuşmayı Sil'
    },
    message: {
      eyebrow: 'MESAJI SİL',
      title: 'Bu mesaj Mesajlarım’dan kaldırılsın mı?',
      description: 'Bu mesaj yalnızca sizin görünümünüzden kaldırılır. Karşı tarafın mesaj geçmişi etkilenmez.',
      confirm: 'Mesajı Sil'
    }
  };

  function isProfileMailboxSoftHideConfirmOpen() {
    return !!(profileMailboxSoftHideConfirmState && profileMailboxSoftHideConfirmState.open);
  }

  function resetProfileMailboxSoftHideConfirm() {
    profileMailboxSoftHideConfirmState.open = false;
    profileMailboxSoftHideConfirmState.mode = '';
    profileMailboxSoftHideConfirmState.pendingId = '';
    profileMailboxSoftHideConfirmState.busy = false;
    profileMailboxSoftHideConfirmState.ran = false;
    profileMailboxSoftHideConfirmState.action = null;
    profileMailboxSoftHideConfirmState.triggerElement = null;
  }

  function setProfileMailboxSoftHideConfirmBusy(isBusy) {
    profileMailboxSoftHideConfirmState.busy = !!isBusy;
    var cancelBtn = $('profile-mailbox-soft-hide-confirm-cancel');
    var confirmBtn = $('profile-mailbox-soft-hide-confirm-confirm');
    var labels = PROFILE_MAILBOX_SOFT_HIDE_LABELS[profileMailboxSoftHideConfirmState.mode === 'message' ? 'message' : 'conversation'];
    if (cancelBtn) cancelBtn.disabled = !!isBusy;
    if (confirmBtn) {
      confirmBtn.disabled = !!isBusy;
      confirmBtn.textContent = isBusy ? 'Siliniyor...' : (labels && labels.confirm ? labels.confirm : 'Onayla');
    }
  }

  function setProfileMailboxSoftHideConfirmError(text) {
    var errEl = $('profile-mailbox-soft-hide-confirm-error');
    if (!errEl) return;
    var msg = text != null ? String(text).trim() : '';
    errEl.textContent = msg;
    errEl.hidden = !msg;
  }

  function ensureProfileMailboxSoftHideConfirmBindings() {
    if (profileMailboxSoftHideConfirmBound) return;
    var root = $('profile-mailbox-soft-hide-confirm');
    if (!root) return;
    profileMailboxSoftHideConfirmBound = true;
    var cancelBtn = $('profile-mailbox-soft-hide-confirm-cancel');
    var confirmBtn = $('profile-mailbox-soft-hide-confirm-confirm');
    var backdrop = $('profile-mailbox-soft-hide-confirm-backdrop');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        closeProfileMailboxSoftHideConfirm({ cancelled: true });
      });
    }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        confirmProfileMailboxSoftHide();
      });
    }
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        if (profileMailboxSoftHideConfirmState.busy) return;
        closeProfileMailboxSoftHideConfirm({ cancelled: true });
      });
    }
    var card = root.querySelector('.profile-mailbox-soft-hide-confirm__card');
    if (card) {
      card.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
      });
    }
  }

  function closeProfileMailboxSoftHideConfirm(options) {
    options = options || {};
    if (profileMailboxSoftHideConfirmState.busy && !options.force) return;
    var root = $('profile-mailbox-soft-hide-confirm');
    var trigger = profileMailboxSoftHideConfirmState.triggerElement;
    resetProfileMailboxSoftHideConfirm();
    setProfileMailboxSoftHideConfirmError('');
    if (root) {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
    }
    var cancelBtn = $('profile-mailbox-soft-hide-confirm-cancel');
    var confirmBtn = $('profile-mailbox-soft-hide-confirm-confirm');
    if (cancelBtn) cancelBtn.disabled = false;
    if (confirmBtn) confirmBtn.disabled = false;
    if (trigger && typeof trigger.focus === 'function') {
      try { trigger.focus(); } catch (_) {}
    }
  }

  function openProfileMailboxSoftHideConfirm(options) {
    options = options || {};
    ensureProfileMailboxSoftHideConfirmBindings();
    if (profileMailboxSoftHideConfirmState.busy) return;
    if (profileMailboxSoftHideConfirmState.open) {
      closeProfileMailboxSoftHideConfirm({ force: true, superseded: true });
    }
    var mode = String(options.mode || '').toLowerCase() === 'message' ? 'message' : 'conversation';
    var labels = PROFILE_MAILBOX_SOFT_HIDE_LABELS[mode];
    profileMailboxSoftHideConfirmState.open = true;
    profileMailboxSoftHideConfirmState.mode = mode;
    profileMailboxSoftHideConfirmState.pendingId = String(options.pendingId || '').trim();
    profileMailboxSoftHideConfirmState.busy = false;
    profileMailboxSoftHideConfirmState.ran = false;
    profileMailboxSoftHideConfirmState.action = typeof options.action === 'function' ? options.action : null;
    profileMailboxSoftHideConfirmState.triggerElement = options.triggerElement || null;

    var eyebrowEl = $('profile-mailbox-soft-hide-confirm-eyebrow');
    var titleEl = $('profile-mailbox-soft-hide-confirm-title');
    var descEl = $('profile-mailbox-soft-hide-confirm-description');
    var confirmBtn = $('profile-mailbox-soft-hide-confirm-confirm');
    var cancelBtn = $('profile-mailbox-soft-hide-confirm-cancel');
    var root = $('profile-mailbox-soft-hide-confirm');
    if (eyebrowEl) eyebrowEl.textContent = labels.eyebrow;
    if (titleEl) titleEl.textContent = labels.title;
    if (descEl) descEl.textContent = labels.description;
    if (confirmBtn) confirmBtn.textContent = labels.confirm;
    setProfileMailboxSoftHideConfirmError('');
    setProfileMailboxSoftHideConfirmBusy(false);
    if (root) {
      root.hidden = false;
      root.setAttribute('aria-hidden', 'false');
    }
    try {
      if (cancelBtn) cancelBtn.focus();
    } catch (_) {}
  }

  async function confirmProfileMailboxSoftHide() {
    if (!profileMailboxSoftHideConfirmState.open) return;
    if (profileMailboxSoftHideConfirmState.busy || profileMailboxSoftHideConfirmState.ran) return;
    var action = profileMailboxSoftHideConfirmState.action;
    if (typeof action !== 'function') {
      setProfileMailboxSoftHideConfirmError('İşlem şu an kullanılamıyor.');
      return;
    }
    profileMailboxSoftHideConfirmState.ran = true;
    setProfileMailboxSoftHideConfirmBusy(true);
    setProfileMailboxSoftHideConfirmError('');
    try {
      var result = await action();
      if (result === false || (result && result.ok === false)) {
        profileMailboxSoftHideConfirmState.ran = false;
        setProfileMailboxSoftHideConfirmBusy(false);
        setProfileMailboxSoftHideConfirmError(
          (result && result.errorText) || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
        );
        return;
      }
      closeProfileMailboxSoftHideConfirm({ force: true, success: true });
    } catch (e) {
      try { console.warn('[WebSoftHideConfirm] failed', e && e.message ? e.message : e); } catch (_) {}
      profileMailboxSoftHideConfirmState.ran = false;
      setProfileMailboxSoftHideConfirmBusy(false);
      setProfileMailboxSoftHideConfirmError('İşlem tamamlanamadı. Lütfen tekrar deneyin.');
    }
  }

  function stopStudentMessagesRealtime() {
    studentMailboxListenerStarted = false;
    var api = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (api && typeof api.stopStudentMailboxListener === 'function') {
      try { api.stopStudentMailboxListener(); } catch (_) {}
    }
  }

  function updateStudentMessagesUnreadBadge(count) {
    var n = Math.max(0, Number(count) || 0);
    var badgeIds = ['profile-messages-unread-badge', 'profile-hero-messages-unread-badge'];
    badgeIds.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (n > 0) {
        el.textContent = String(n);
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
      } else {
        el.textContent = '';
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function countStudentUnreadFromUiState() {
    var n = 0;
    Object.keys(profileMessagesThreadMap || {}).forEach(function (tid) {
      var t = profileMessagesThreadMap[tid];
      n += Number(t && t.unreadCount) || 0;
    });
    Object.keys(profileMessagesById || {}).forEach(function (id) {
      var msg = profileMessagesById[id];
      if (!msg || !msg.isUnread) return;
      var raw = profileMessagesDocsById[id] || {};
      var ch = String((msg.messageChannel || raw.messageChannel) || '').trim();
      if (ch === 'tenant_to_student' || ch === 'student_to_tenant') return;
      n++;
    });
    return n;
  }

  function refreshOpenStudentThreadFromRealtime() {
    if (profileMessagesSession.isPublicUser) return;
    if (profileMessageViewMode !== 'thread') return;
    var tid = String(profileMessageActiveThreadId || '').trim();
    if (!tid || !profileMessageModalOpen) return;
    var thread = profileMessagesThreadMap[tid];
    if (!thread) {
      closeProfileMessageModal();
      return;
    }
    var replyEl = $('profile-message-modal-reply');
    var preservedReply = replyEl ? String(replyEl.value || '') : '';
    var hadFocus = !!(replyEl && document.activeElement === replyEl);
    var selStart = replyEl && typeof replyEl.selectionStart === 'number' ? replyEl.selectionStart : null;
    var selEnd = replyEl && typeof replyEl.selectionEnd === 'number' ? replyEl.selectionEnd : null;
    var metaEl = $('profile-message-modal-thread-meta');
    var titleEl = $('profile-message-modal-title');
    var timelineEl = $('profile-message-modal-thread-timeline');
    var nearBottom = true;
    if (timelineEl) {
      nearBottom = (timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight) < 96;
    }
    if (metaEl) {
      metaEl.textContent = (thread.participantLabel || 'Gönderen') + ' · ' + (thread.messageCount || 0) + ' mesaj';
    }
    if (titleEl) titleEl.textContent = thread.subject || 'Konuşma';
    renderThreadTimeline(thread);
    markThreadMessagesRead(thread).then(function () {
      updateStudentMessagesUnreadBadge(countStudentUnreadFromUiState());
    }).catch(function () {});
    if (replyEl) {
      replyEl.value = preservedReply;
      if (hadFocus) {
        try {
          replyEl.focus();
          if (selStart != null && selEnd != null) replyEl.setSelectionRange(selStart, selEnd);
        } catch (_) {}
      }
    }
    if (timelineEl && nearBottom) {
      try { timelineEl.scrollTop = timelineEl.scrollHeight; } catch (_) {}
    }
  }

  function applyStudentMessagesRealtimePayload(payload) {
    if (!payload || !payload.ok) return;
    if (profileMessagesSession.isPublicUser) return;
    var replyEl = $('profile-message-modal-reply');
    var preservedReply = replyEl ? String(replyEl.value || '') : '';
    var hadFocus = !!(replyEl && document.activeElement === replyEl);
    var selStart = replyEl && typeof replyEl.selectionStart === 'number' ? replyEl.selectionStart : null;
    var selEnd = replyEl && typeof replyEl.selectionEnd === 'number' ? replyEl.selectionEnd : null;

    var threads = payload.threads || [];
    var platformItems = payload.platformItems || [];
    if (!threads.length && !platformItems.length) {
      renderMessagesEmpty(MESSAGES_EMPTY_TEXT);
    } else {
      renderConversationList({
        threads: threads,
        platformItems: platformItems,
        docsById: payload.docsById || {},
        emptyMessage: MESSAGES_EMPTY_TEXT
      });
    }

    var api = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    var unread = 0;
    if (api && typeof api.countStudentUnreadFromPayload === 'function') {
      unread = api.countStudentUnreadFromPayload(payload);
    } else {
      unread = Number(payload.unreadCount) || countStudentUnreadFromUiState();
    }
    updateStudentMessagesUnreadBadge(unread);
    refreshOpenStudentThreadFromRealtime();

    if (replyEl) {
      replyEl.value = preservedReply;
      if (hadFocus) {
        try {
          replyEl.focus();
          if (selStart != null && selEnd != null) replyEl.setSelectionRange(selStart, selEnd);
        } catch (_) {}
      }
    }
  }

  function isProfileMessageReplyable(msg) {
    if (!msg) return false;
    if (msg.replyable === true) return true;
    if (msg.replyable === false) return false;

    var repo = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (repo && typeof repo.isMessageReplyable === 'function') {
      return repo.isMessageReplyable(msg);
    }

    var ch = String(msg.messageChannel || '').trim().toLowerCase();
    if (ch === 'platform_to_public_user' || ch === 'platform_to_student' || ch === 'tenant_to_student') {
      return true;
    }
    var senderType = String(msg.senderType || '').trim().toLowerCase();
    if (senderType === 'super_admin' || senderType === 'institution_admin') return true;
    return false;
  }

  function setElementHidden(el, hidden) {
    if (!el) return;
    if (hidden) {
      el.hidden = true;
      el.setAttribute('hidden', '');
    } else {
      el.hidden = false;
      el.removeAttribute('hidden');
    }
  }

  function collapseProfileMessageReplyPanel() {
    profileMessageReplyPanelOpen = false;
    var replyWrap = $('profile-message-modal-reply-wrap');
    var replyToggle = $('profile-message-modal-reply-toggle');
    var replyEl = $('profile-message-modal-reply');
    if (replyEl) replyEl.value = '';
    setElementHidden(replyWrap, true);
    setElementHidden(replyToggle, !profileMessageModalReplyable);
  }

  function openProfileMessageReplyPanel() {
    if (!profileMessageModalReplyable) return;
    var replyWrap = $('profile-message-modal-reply-wrap');
    var replyToggle = $('profile-message-modal-reply-toggle');
    var replyEl = $('profile-message-modal-reply');
    profileMessageReplyPanelOpen = true;
    setElementHidden(replyWrap, false);
    setElementHidden(replyToggle, true);
    try {
      if (replyEl) replyEl.focus();
    } catch (_) {}
  }

  function hidePublicMessagesPlaceholder() {
    var publicEl = $('profile-messages-public-placeholder');
    if (publicEl) {
      publicEl.hidden = true;
      publicEl.setAttribute('aria-hidden', 'true');
    }
  }

  function resolvePublicMessageUid(session) {
    var auth = getAuth();
    var authUid = auth && auth.currentUser && auth.currentUser.uid
      ? String(auth.currentUser.uid).trim()
      : '';
    if (authUid) return authUid;
    return String((session && session.uid) || '').trim();
  }

  function setMessagesCardMode(mode) {
    var card = $('profile-messages-card');
    var publicEl = $('profile-messages-public-placeholder');
    var instEl = $('profile-messages-institution');

    if (card) {
      if (mode === 'institution' || mode === 'public') {
        card.classList.remove('profile-stat-card--placeholder');
        card.classList.add('profile-stat-card--live');
      } else {
        card.classList.add('profile-stat-card--placeholder');
        card.classList.remove('profile-stat-card--live');
      }
    }

    if (publicEl) {
      publicEl.hidden = mode !== 'placeholder';
      if (mode !== 'placeholder') {
        publicEl.setAttribute('aria-hidden', 'true');
      } else {
        publicEl.removeAttribute('aria-hidden');
      }
    }
    if (instEl) instEl.hidden = mode === 'placeholder';
  }

  function setMessagesPanels(opts) {
    var options = opts || {};
    var loadingEl = $('profile-messages-loading');
    var listEl = $('profile-messages-list');
    var emptyEl = $('profile-messages-empty');
    var errorEl = $('profile-messages-error');

    if (loadingEl) loadingEl.hidden = !options.loading;
    if (listEl) listEl.hidden = !options.list;
    if (emptyEl) {
      emptyEl.hidden = !options.empty;
      if (options.emptyMessage) {
        emptyEl.textContent = options.emptyMessage;
      }
    }
    if (errorEl) {
      errorEl.hidden = !options.error;
      if (options.errorMessage) {
        errorEl.textContent = options.errorMessage;
      }
    }
  }

  function renderMessagesLoading(loadingText) {
    var loadingEl = $('profile-messages-loading');
    if (loadingEl) loadingEl.textContent = loadingText || MESSAGES_LOADING_TEXT;
    setMessagesPanels({
      loading: true,
      list: false,
      empty: false,
      error: false
    });
  }

  function formatMessageDate(value) {
    if (!value) return '—';
    var date = null;
    if (typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'number' && isFinite(value)) {
      date = new Date(value);
    } else if (typeof value === 'string') {
      var parsed = Date.parse(value);
      if (isFinite(parsed)) date = new Date(parsed);
    } else if (typeof value.seconds === 'number') {
      date = new Date(value.seconds * 1000);
    }
    if (!date || isNaN(date.getTime())) return '—';
    try {
      return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return '—';
    }
  }

  function buildMessageSnippet(body) {
    var text = String(body || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '—';
    if (text.length <= SNIPPET_MAX_LEN) return text;
    return text.slice(0, SNIPPET_MAX_LEN - 1) + '…';
  }

  function clearMessagesList() {
    var listEl = $('profile-messages-list');
    if (!listEl) return;
    while (listEl.firstChild) {
      listEl.removeChild(listEl.firstChild);
    }
  }

  function setPublicThreadHideActionsVisible(visible) {
    var actions = $('profile-message-modal-thread-actions');
    setElementHidden(actions, !visible);
  }

  function setProfileMessageModalMode(mode) {
    profileMessageViewMode = mode === 'thread' ? 'thread' : 'single';
    var singlePanel = $('profile-message-modal-single-panel');
    var threadPanel = $('profile-message-modal-thread-panel');
    var titleEl = $('profile-message-modal-title');
    var replyToggle = $('profile-message-modal-reply-toggle');
    var replyWrap = $('profile-message-modal-reply-wrap');
    var replyCancel = $('profile-message-modal-reply-cancel');
    var sendBtn = $('profile-message-modal-send');
    setElementHidden(singlePanel, profileMessageViewMode === 'thread');
    setElementHidden(threadPanel, profileMessageViewMode !== 'thread');
    if (titleEl) {
      titleEl.textContent = profileMessageViewMode === 'thread' ? 'Konuşma' : 'Mesaj Detayı';
    }
    if (profileMessageViewMode === 'thread') {
      setElementHidden(replyToggle, true);
      setElementHidden(replyWrap, false);
      if (replyCancel) replyCancel.hidden = true;
      if (sendBtn) sendBtn.textContent = 'Yanıtla';
      setPublicThreadHideActionsVisible(!!(profileMessagesSession.isPublicUser || (!profileMessagesSession.isPublicUser && profileMessagesSession.tenantId)));
    } else {
      if (replyCancel) replyCancel.hidden = false;
      if (sendBtn) sendBtn.textContent = 'Yanıtı Gönder';
      setPublicThreadHideActionsVisible(false);
    }
  }

  function renderMessagesList(items) {
    var listEl = $('profile-messages-list');
    if (!listEl) return;

    clearMessagesList();
    profileMessagesById = {};

    (items || []).forEach(function (msg) {
      if (msg && msg.id) profileMessagesById[msg.id] = msg;

      var item = document.createElement('li');
      item.className = 'profile-messages-item profile-messages-item--clickable';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', 'Mesaj detayını aç: ' + ((msg && msg.subject) || 'Mesaj'));
      if (msg && msg.id) item.setAttribute('data-msg-id', msg.id);
      if (msg && msg.isUnread) {
        item.classList.add('profile-messages-item--unread');
      }

      var subjectEl = document.createElement('p');
      subjectEl.className = 'profile-messages-item__subject';
      subjectEl.textContent = (msg && msg.subject) || '(Konu yok)';

      var metaEl = document.createElement('p');
      metaEl.className = 'profile-messages-item__meta';
      var sender = (msg && msg.senderName) || 'Gönderen';
      metaEl.textContent = sender + ' · ' + formatMessageDate(msg && msg.createdAt);

      var snippetEl = document.createElement('p');
      snippetEl.className = 'profile-messages-item__snippet';
      snippetEl.textContent = buildMessageSnippet(msg && msg.body);

      var actionEl = document.createElement('span');
      actionEl.className = 'profile-messages-item__action';
      actionEl.textContent = isProfileMessageReplyable(msg) ? 'Oku / Yanıtla' : 'Oku';

      item.appendChild(subjectEl);
      item.appendChild(metaEl);
      item.appendChild(snippetEl);
      item.appendChild(actionEl);
      listEl.appendChild(item);
    });

    setMessagesPanels({
      loading: false,
      list: true,
      empty: false,
      error: false
    });
  }

  function appendThreadListItem(listEl, thread) {
    if (!listEl || !thread) return;
    profileMessagesThreadMap[thread.threadId] = thread;
    (thread.messages || []).forEach(function (msg) {
      if (msg && msg.id) profileMessagesById[msg.id] = msg;
    });

    var item = document.createElement('li');
    item.className = 'profile-messages-item profile-messages-item--clickable profile-messages-item--thread';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', 'Konuşmayı aç: ' + (thread.subject || 'Konuşma'));
    item.setAttribute('data-thread-id', thread.threadId);
    if (thread.unread) item.classList.add('profile-messages-item--unread');

    var subjectEl = document.createElement('p');
    subjectEl.className = 'profile-messages-item__subject';
    subjectEl.textContent = thread.subject || '(Konu yok)';

    var metaEl = document.createElement('p');
    metaEl.className = 'profile-messages-item__meta';
    metaEl.textContent = (thread.participantLabel || 'Gönderen') + ' · ' + formatMessageDate(thread.latestCreatedAt || thread.latestMs);

    var snippetEl = document.createElement('p');
    snippetEl.className = 'profile-messages-item__snippet';
    snippetEl.textContent = buildMessageSnippet(thread.latestBody);

    var threadMeta = document.createElement('div');
    threadMeta.className = 'profile-messages-item__thread-meta';
    var countEl = document.createElement('span');
    countEl.className = 'profile-messages-item__thread-count';
    countEl.textContent = String(thread.messageCount || 0) + ' mesaj';
    threadMeta.appendChild(countEl);
    if (thread.unreadCount > 0) {
      var unreadEl = document.createElement('span');
      unreadEl.className = 'profile-messages-item__thread-count';
      unreadEl.textContent = String(thread.unreadCount) + ' yeni';
      threadMeta.appendChild(unreadEl);
    }

    var actionEl = document.createElement('span');
    actionEl.className = 'profile-messages-item__action';
    actionEl.textContent = 'Oku / Yanıtla';

    item.appendChild(subjectEl);
    item.appendChild(metaEl);
    item.appendChild(snippetEl);
    item.appendChild(threadMeta);
    item.appendChild(actionEl);
    listEl.appendChild(item);
  }

  function renderConversationList(opts) {
    opts = opts || {};
    var listEl = $('profile-messages-list');
    if (!listEl) return;

    clearMessagesList();
    profileMessagesById = {};
    profileMessagesThreadMap = {};
    profileMessagesDocsById = opts.docsById || {};

    var listItems = [];
    (opts.threads || []).forEach(function (thread) {
      listItems.push({ sortMs: thread.latestMs || 0, kind: 'thread', thread: thread });
    });
    (opts.platformItems || []).forEach(function (msg) {
      listItems.push({ sortMs: msg.createdAtMs || 0, kind: 'message', msg: msg });
    });
    listItems.sort(function (a, b) { return (b.sortMs || 0) - (a.sortMs || 0); });

    if (!listItems.length) {
      renderMessagesEmpty(opts.emptyMessage || MESSAGES_EMPTY_TEXT);
      return;
    }

    listItems.forEach(function (entry) {
      if (entry.kind === 'thread') {
        appendThreadListItem(listEl, entry.thread);
        return;
      }
      var msg = entry.msg;
      if (msg && msg.id) profileMessagesById[msg.id] = msg;
      var item = document.createElement('li');
      item.className = 'profile-messages-item profile-messages-item--clickable';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', 'Mesaj detayını aç: ' + ((msg && msg.subject) || 'Mesaj'));
      if (msg && msg.id) item.setAttribute('data-msg-id', msg.id);
      if (msg && msg.isUnread) item.classList.add('profile-messages-item--unread');

      var subjectEl = document.createElement('p');
      subjectEl.className = 'profile-messages-item__subject';
      subjectEl.textContent = (msg && msg.subject) || '(Konu yok)';

      var metaEl = document.createElement('p');
      metaEl.className = 'profile-messages-item__meta';
      metaEl.textContent = ((msg && msg.senderName) || 'Gönderen') + ' · ' + formatMessageDate(msg && msg.createdAt);

      var snippetEl = document.createElement('p');
      snippetEl.className = 'profile-messages-item__snippet';
      snippetEl.textContent = buildMessageSnippet(msg && msg.body);

      var actionEl = document.createElement('span');
      actionEl.className = 'profile-messages-item__action';
      actionEl.textContent = isProfileMessageReplyable(msg) ? 'Oku / Yanıtla' : 'Oku';

      item.appendChild(subjectEl);
      item.appendChild(metaEl);
      item.appendChild(snippetEl);
      item.appendChild(actionEl);
      listEl.appendChild(item);
    });

    setMessagesPanels({
      loading: false,
      list: true,
      empty: false,
      error: false
    });
  }

  function getSelectedMessageText() {
    try {
      if (!window.getSelection) return '';
      return String(window.getSelection().toString() || '').trim();
    } catch (_) {
      return '';
    }
  }

  function setProfileMessageModalStatus(type, text) {
    var statusEl = $('profile-message-modal-status');
    if (!statusEl) return;
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.className = 'profile-message-modal__status';
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.className = 'profile-message-modal__status profile-message-modal__status--' + (type || 'muted');
  }

  function closeProfileMessageModal() {
    var modal = $('profile-message-modal');
    if (!modal) return;
    if (isProfileMailboxSoftHideConfirmOpen()) {
      closeProfileMailboxSoftHideConfirm({ force: true, cleanup: true });
    }
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    profileMessageModalOpen = false;
    profileMessageReplySending = false;
    profileMessageReplyPanelOpen = false;
    profileMessageModalReplyable = false;
    profileMessageActiveThreadId = null;
    setProfileMessageModalMode('single');
    setPublicThreadHideActionsVisible(false);
    if (profileMessageEscapeHandler) {
      document.removeEventListener('keydown', profileMessageEscapeHandler, true);
      profileMessageEscapeHandler = null;
    }
    var sendBtn = $('profile-message-modal-send');
    if (sendBtn) sendBtn.disabled = false;
  }

  function isStudentSideMessage(msg, isPublic) {
    if (!msg) return false;
    var ch = String(msg.messageChannel || '').trim().toLowerCase();
    var st = String(msg.senderType || '').trim().toLowerCase();
    if (isPublic) return st === 'public_user' || ch === 'public_to_platform';
    return ch === 'student_to_tenant' || st === 'student';
  }

  function renderThreadTimeline(thread) {
    var timelineEl = $('profile-message-modal-thread-timeline');
    if (!timelineEl) return;
    while (timelineEl.firstChild) timelineEl.removeChild(timelineEl.firstChild);
    var isPublic = !!(thread && thread.mode === 'public') || profileMessagesSession.isPublicUser;
    var msgs = (thread && thread.messages) || [];
    if (!msgs.length) {
      var empty = document.createElement('p');
      empty.className = 'profile-message-modal__status profile-message-modal__status--muted';
      empty.textContent = 'Bu konuşmada yüklü mesaj yok.';
      timelineEl.appendChild(empty);
      return;
    }
    msgs.forEach(function (msg) {
      var isStudent = isStudentSideMessage(msg, isPublic);
      var bubble = document.createElement('div');
      bubble.className = 'profile-message-thread-bubble ' + (isStudent ? 'profile-message-thread-bubble--student' : 'profile-message-thread-bubble--tenant');
      if (msg.id) bubble.setAttribute('data-msg-id', msg.id);

      var head = document.createElement('div');
      head.className = 'profile-message-thread-bubble__head';
      var left = document.createElement('span');
      var role = document.createElement('span');
      role.className = 'profile-message-thread-bubble__role';
      role.textContent = isStudent ? 'Sen' : (isPublic ? 'Sürücü Akademisi' : 'Kurum');
      left.appendChild(role);
      left.appendChild(document.createTextNode(' · ' + (msg.senderName || (isStudent ? 'Öğrenci' : 'Gönderen'))));
      var right = document.createElement('span');
      right.textContent = formatMessageDate(msg.createdAt || msg.createdAtMs);
      head.appendChild(left);
      head.appendChild(right);
      if (isPublic && profileMessagesSession.isPublicUser && msg && msg.id) {
        var hideBtn = document.createElement('button');
        hideBtn.type = 'button';
        hideBtn.className = 'profile-message-thread-bubble__hide';
        hideBtn.setAttribute('aria-label', 'Mesajı Sil');
        hideBtn.textContent = 'Mesajı Sil';
        hideBtn.addEventListener('click', function (e) {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          hidePublicProfileMessage(msg.id);
        });
        head.appendChild(hideBtn);
      } else if (!isPublic && !profileMessagesSession.isPublicUser && profileMessagesSession.tenantId && msg && msg.id) {
        var hideStudentBtn = document.createElement('button');
        hideStudentBtn.type = 'button';
        hideStudentBtn.className = 'profile-message-thread-bubble__hide';
        hideStudentBtn.setAttribute('aria-label', 'Mesajı Sil');
        hideStudentBtn.textContent = 'Mesajı Sil';
        hideStudentBtn.addEventListener('click', function (e) {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          hideStudentProfileMessage(msg.id);
        });
        head.appendChild(hideStudentBtn);
      }

      var body = document.createElement('div');
      body.className = 'profile-message-thread-bubble__body';
      body.textContent = msg.body || '—';

      bubble.appendChild(head);
      bubble.appendChild(body);
      timelineEl.appendChild(bubble);
    });
    try { timelineEl.scrollTop = timelineEl.scrollHeight; } catch (_) {}
  }

  function removePublicThreadCardFromList(threadId) {
    var tid = String(threadId || '').trim();
    if (!tid) return;
    delete profileMessagesThreadMap[tid];
    var row = document.querySelector('.profile-messages-item[data-thread-id="' + tid.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
    if (row && row.parentNode) row.parentNode.removeChild(row);
    var listEl = $('profile-messages-list');
    if (listEl && !listEl.querySelector('.profile-messages-item')) {
      renderMessagesEmpty(profileMessagesSession.isPublicUser ? MESSAGES_EMPTY_PUBLIC_TEXT : MESSAGES_EMPTY_TEXT);
    }
  }

  function refreshOpenPublicThreadCard(thread) {
    if (!thread || !thread.threadId) return;
    profileMessagesThreadMap[thread.threadId] = thread;
    var row = document.querySelector('.profile-messages-item[data-thread-id="' + String(thread.threadId).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
    if (!row) return;
    var subjectEl = row.querySelector('.profile-messages-item__subject');
    var metaEl = row.querySelector('.profile-messages-item__meta');
    var snippetEl = row.querySelector('.profile-messages-item__snippet');
    var countEl = row.querySelector('.profile-messages-item__thread-count');
    if (subjectEl) subjectEl.textContent = thread.subject || '(Konu yok)';
    if (metaEl) {
      metaEl.textContent = (thread.participantLabel || 'Gönderen') + ' · ' + formatMessageDate(thread.latestCreatedAt || thread.latestMs);
    }
    if (snippetEl) snippetEl.textContent = buildMessageSnippet(thread.latestBody);
    if (countEl) countEl.textContent = String(thread.messageCount || 0) + ' mesaj';
    if (thread.unread) row.classList.add('profile-messages-item--unread');
    else row.classList.remove('profile-messages-item--unread');
  }

  async function hidePublicProfileMessage(messageId) {
    var mid = String(messageId || '').trim();
    var uid = String(profileMessagesSession.uid || '').trim();
    if (!mid || !uid || !profileMessagesSession.isPublicUser) return;
    if (!window.confirm('Bu mesaj sadece sizin mesaj kutunuzdan kaldırılacak. Karşı tarafın mesaj geçmişi etkilenmez. Devam edilsin mi?')) return;

    var api = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (!api || typeof api.hidePublicUserMessage !== 'function') {
      setProfileMessageModalStatus('error', 'Silme işlemi şu an kullanılamıyor.');
      return;
    }

    var result = await api.hidePublicUserMessage(uid, mid);
    if (!result || !result.ok) {
      setProfileMessageModalStatus('error', 'Mesaj kaldırılamadı.');
      return;
    }

    if (profileMessagesDocsById[mid]) {
      profileMessagesDocsById[mid].deletedForPublicUser = true;
    }
    if (profileMessagesById[mid]) {
      profileMessagesById[mid].deletedForPublicUser = true;
      profileMessagesById[mid].isUnread = false;
    }

    var tid = String(profileMessageActiveThreadId || '').trim();
    var thread = tid ? profileMessagesThreadMap[tid] : null;
    if (thread && Array.isArray(thread.messages)) {
      thread.messages = thread.messages.filter(function (m) { return !(m && m.id === mid); });
      thread.messageCount = thread.messages.length;
      var latest = thread.messages[thread.messages.length - 1] || {};
      thread.latestBody = latest.body || '';
      thread.latestMs = latest.createdAtMs || 0;
      thread.latestCreatedAt = latest.createdAt || null;
      thread.unreadCount = thread.messages.reduce(function (n, m) { return n + (m && m.isUnread ? 1 : 0); }, 0);
      thread.unread = thread.unreadCount > 0;
      profileMessagesThreadMap[tid] = thread;

      if (!thread.messages.length) {
        closeProfileMessageModal();
        removePublicThreadCardFromList(tid);
        return;
      }
      renderThreadTimeline(thread);
      if ($('profile-message-modal-thread-meta')) {
        $('profile-message-modal-thread-meta').textContent =
          (thread.participantLabel || 'Gönderen') + ' · ' + (thread.messageCount || 0) + ' mesaj';
      }
      refreshOpenPublicThreadCard(thread);
    }
  }

  async function hidePublicProfileThread() {
    var tid = String(profileMessageActiveThreadId || '').trim();
    var uid = String(profileMessagesSession.uid || '').trim();
    if (!tid || !uid || !profileMessagesSession.isPublicUser) return;
    if (!window.confirm('Bu konuşma sadece sizin mesaj kutunuzdan kaldırılacak. Yeni bir mesaj gelirse konuşma tekrar görünebilir. Devam edilsin mi?')) return;

    var api = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (!api || typeof api.hidePublicUserThread !== 'function') {
      setProfileMessageModalStatus('error', 'Silme işlemi şu an kullanılamıyor.');
      return;
    }

    var result = await api.hidePublicUserThread(uid, tid);
    if (!result || !result.ok) {
      setProfileMessageModalStatus('error', 'Konuşma kaldırılamadı.');
      return;
    }

    closeProfileMessageModal();
    removePublicThreadCardFromList(tid);
  }

  async function hideStudentProfileMessage(messageId) {
    var mid = String(messageId || '').trim();
    var uid = String(profileMessagesSession.uid || '').trim();
    var tenantId = String(profileMessagesSession.tenantId || '').trim();
    if (!mid || !uid || !tenantId || profileMessagesSession.isPublicUser) return;

    var api = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (!api || typeof api.hideStudentMessage !== 'function') {
      setProfileMessageModalStatus('error', 'Silme işlemi şu an kullanılamıyor.');
      return;
    }

    openProfileMailboxSoftHideConfirm({
      mode: 'message',
      pendingId: mid,
      triggerElement: null,
      action: async function () {
        var liveUid = String(profileMessagesSession.uid || '').trim();
        var liveTenantId = String(profileMessagesSession.tenantId || '').trim();
        if (!mid || !liveUid || !liveTenantId || profileMessagesSession.isPublicUser) {
          return { ok: false, errorText: 'Mesaj kaldırılamadı.' };
        }
        var result = await api.hideStudentMessage(liveTenantId, liveUid, mid);
        if (!result || !result.ok) {
          return { ok: false, errorText: 'Mesaj kaldırılamadı.' };
        }

        if (profileMessagesDocsById[mid]) {
          profileMessagesDocsById[mid].deletedForStudent = true;
        }
        if (profileMessagesById[mid]) {
          profileMessagesById[mid].deletedForStudent = true;
          profileMessagesById[mid].isUnread = false;
        }

        var tid = String(profileMessageActiveThreadId || '').trim();
        var thread = tid ? profileMessagesThreadMap[tid] : null;
        if (thread && Array.isArray(thread.messages)) {
          thread.messages = thread.messages.filter(function (m) { return !(m && m.id === mid); });
          thread.messageCount = thread.messages.length;
          var latest = thread.messages[thread.messages.length - 1] || {};
          thread.latestBody = latest.body || '';
          thread.latestMs = latest.createdAtMs || 0;
          thread.latestCreatedAt = latest.createdAt || null;
          thread.unreadCount = thread.messages.reduce(function (n, m) { return n + (m && m.isUnread ? 1 : 0); }, 0);
          thread.unread = thread.unreadCount > 0;
          profileMessagesThreadMap[tid] = thread;

          if (!thread.messages.length) {
            closeProfileMessageModal();
            removePublicThreadCardFromList(tid);
            return { ok: true };
          }
          renderThreadTimeline(thread);
          if ($('profile-message-modal-thread-meta')) {
            $('profile-message-modal-thread-meta').textContent =
              (thread.participantLabel || 'Gönderen') + ' · ' + (thread.messageCount || 0) + ' mesaj';
          }
          refreshOpenPublicThreadCard(thread);
        }
        return { ok: true };
      }
    });
  }

  async function hideStudentProfileThread() {
    var tid = String(profileMessageActiveThreadId || '').trim();
    var uid = String(profileMessagesSession.uid || '').trim();
    var tenantId = String(profileMessagesSession.tenantId || '').trim();
    if (!tid || !uid || profileMessagesSession.isPublicUser) return;

    var api = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (!api || typeof api.hideStudentThread !== 'function') {
      setProfileMessageModalStatus('error', 'Silme işlemi şu an kullanılamıyor.');
      return;
    }

    openProfileMailboxSoftHideConfirm({
      mode: 'conversation',
      pendingId: tid,
      triggerElement: $('profile-message-modal-hide-thread'),
      action: async function () {
        var liveTid = String(profileMessageActiveThreadId || '').trim();
        var liveUid = String(profileMessagesSession.uid || '').trim();
        var liveTenantId = String(profileMessagesSession.tenantId || '').trim();
        if (!liveTid || liveTid !== tid || !liveUid || profileMessagesSession.isPublicUser) {
          return { ok: false, errorText: 'Konuşma kaldırılamadı.' };
        }
        var result = await api.hideStudentThread(liveUid, liveTid, liveTenantId);
        if (!result || !result.ok) {
          return { ok: false, errorText: 'Konuşma kaldırılamadı.' };
        }

        closeProfileMessageModal();
        removePublicThreadCardFromList(liveTid);
        return { ok: true };
      }
    });
  }

  async function markThreadMessagesRead(thread) {
    if (!thread || !Array.isArray(thread.messages)) return;
    var uid = profileMessagesSession.uid;
    var tenantId = profileMessagesSession.tenantId;
    var markRepo = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (!markRepo || !uid) return;
    var tasks = [];
    thread.messages.forEach(function (msg) {
      if (!msg || !msg.id || !msg.isUnread) return;
      if (profileMessagesSession.isPublicUser) {
        if (typeof markRepo.markPublicUserMessageRead === 'function') {
          tasks.push(markRepo.markPublicUserMessageRead(uid, msg.id).then(function (result) {
            if (result && result.ok) msg.isUnread = false;
          }));
        }
      } else {
        var ch = String(msg.messageChannel || '').trim().toLowerCase();
        var st = String(msg.senderType || '').trim().toLowerCase();
        var isIncomingTenant = ch === 'tenant_to_student' || ch === 'platform_to_student' || st === 'institution_admin' || st === 'super_admin';
        if (!isIncomingTenant) return;
        if (msg.deletedForStudent === true) return;
        if (typeof markRepo.markMessageReadByStudent === 'function') {
          tasks.push(markRepo.markMessageReadByStudent(tenantId, msg.id, uid).then(function (result) {
            if (result && result.ok) msg.isUnread = false;
          }));
        }
      }
    });
    if (tasks.length) {
      try { await Promise.all(tasks); } catch (_) {}
    }
    thread.unread = false;
    thread.unreadCount = 0;
    profileMessagesThreadMap[thread.threadId] = thread;
    var row = document.querySelector('.profile-messages-item[data-thread-id="' + String(thread.threadId).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
    if (row) {
      row.classList.remove('profile-messages-item--unread');
      Array.prototype.forEach.call(row.querySelectorAll('.profile-messages-item__thread-count'), function (el) {
        if (/yeni/i.test(String(el.textContent || ''))) el.remove();
      });
    }
    if (!profileMessagesSession.isPublicUser) {
      updateStudentMessagesUnreadBadge(countStudentUnreadFromUiState());
    }
  }

  async function openProfileMessageThreadModal(threadId) {
    var tid = String(threadId || '').trim();
    var thread = tid ? profileMessagesThreadMap[tid] : null;
    if (!thread) return;

    var modal = $('profile-message-modal');
    var metaEl = $('profile-message-modal-thread-meta');
    var replyEl = $('profile-message-modal-reply');
    var sendBtn = $('profile-message-modal-send');
    if (!modal) return;

    profileMessageActiveThreadId = tid;
    profileMessageModalReplyable = true;
    setProfileMessageModalMode('thread');
    await markThreadMessagesRead(thread);
    thread = profileMessagesThreadMap[tid] || thread;

    if (metaEl) {
      metaEl.textContent = (thread.participantLabel || 'Gönderen') + ' · ' + (thread.messageCount || 0) + ' mesaj';
    }
    var titleEl = $('profile-message-modal-title');
    if (titleEl) titleEl.textContent = thread.subject || 'Konuşma';
    renderThreadTimeline(thread);
    if (replyEl) replyEl.value = '';
    setProfileMessageModalStatus('', '');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Yanıtla';
    }

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.setAttribute('data-active-msg-id', '');
    modal.setAttribute('data-active-thread-id', tid);
    profileMessageModalOpen = true;

    if (!profileMessageEscapeHandler) {
      profileMessageEscapeHandler = function (e) {
        if (!profileMessageModalOpen) return;
        if (e && e.key === 'Escape') {
          e.preventDefault();
          if (isProfileMailboxSoftHideConfirmOpen()) {
            closeProfileMailboxSoftHideConfirm({ cancelled: true, force: true });
            return;
          }
          closeProfileMessageModal();
        }
      };
      document.addEventListener('keydown', profileMessageEscapeHandler, true);
    }

    try {
      if (replyEl) replyEl.focus();
    } catch (_) {}
  }

  function openProfileMessageModal(msgId) {
    var msg = profileMessagesById[msgId];
    if (!msg) return;

    var modal = $('profile-message-modal');
    var metaEl = $('profile-message-modal-meta');
    var subjEl = $('profile-message-modal-subject');
    var bodyEl = $('profile-message-modal-body');
    var replyEl = $('profile-message-modal-reply');
    if (!modal || !metaEl || !subjEl || !bodyEl) return;

    profileMessageActiveThreadId = null;
    setProfileMessageModalMode('single');

    var sender = msg.senderName || 'Gönderen';
    metaEl.textContent = 'Gönderen: ' + sender + ' · ' + formatMessageDate(msg.createdAt);
    subjEl.textContent = msg.subject || '(Konu yok)';
    bodyEl.textContent = msg.body || '—';
    if (replyEl) replyEl.value = '';
    setProfileMessageModalStatus('', '');

    profileMessageModalReplyable = isProfileMessageReplyable(msg);
    collapseProfileMessageReplyPanel();

    var replyToggle = $('profile-message-modal-reply-toggle');
    var replyWrap = $('profile-message-modal-reply-wrap');
    var cancelBtn = $('profile-message-modal-cancel');

    if (!profileMessageModalReplyable) {
      setElementHidden(replyToggle, true);
      setElementHidden(replyWrap, true);
      if (cancelBtn) cancelBtn.textContent = 'Kapat';
    } else {
      setElementHidden(replyToggle, false);
      setElementHidden(replyWrap, true);
      if (cancelBtn) cancelBtn.textContent = 'Kapat';
    }

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    profileMessageModalOpen = true;
    modal.setAttribute('data-active-msg-id', msgId);
    modal.setAttribute('data-active-thread-id', '');

    profileMessageEscapeHandler = function (e) {
      if (!profileMessageModalOpen) return;
      if (e && e.key === 'Escape') {
        e.preventDefault();
        if (isProfileMailboxSoftHideConfirmOpen()) {
          closeProfileMailboxSoftHideConfirm({ cancelled: true, force: true });
          return;
        }
        closeProfileMessageModal();
      }
    };
    document.addEventListener('keydown', profileMessageEscapeHandler, true);

    var tenantId = profileMessagesSession.tenantId;
    var uid = profileMessagesSession.uid;
    var markRepo = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (profileMessagesSession.isPublicUser && uid && msg.id && markRepo && typeof markRepo.markPublicUserMessageRead === 'function') {
      markRepo.markPublicUserMessageRead(uid, msg.id).then(function (result) {
        if (result && result.ok && !result.skipped) {
          msg.isUnread = false;
          profileMessagesById[msg.id] = msg;
          var row = document.querySelector('.profile-messages-item[data-msg-id="' + msg.id + '"]');
          if (row) row.classList.remove('profile-messages-item--unread');
        }
      });
    } else if (tenantId && uid && msg.id && markRepo && typeof markRepo.markMessageReadByStudent === 'function') {
      markRepo.markMessageReadByStudent(tenantId, msg.id, uid).then(function (result) {
        if (result && result.ok && !result.skipped) {
          msg.isUnread = false;
          profileMessagesById[msg.id] = msg;
          var row = document.querySelector('.profile-messages-item[data-msg-id="' + msg.id + '"]');
          if (row) row.classList.remove('profile-messages-item--unread');
          updateStudentMessagesUnreadBadge(countStudentUnreadFromUiState());
        }
      });
    }

  }

  function onProfileMessageItemActivate(target) {
    var threadItem = target && target.closest ? target.closest('.profile-messages-item[data-thread-id]') : null;
    if (threadItem) {
      var threadId = threadItem.getAttribute('data-thread-id');
      if (threadId) openProfileMessageThreadModal(threadId);
      return;
    }
    var item = target && target.closest ? target.closest('.profile-messages-item[data-msg-id]') : null;
    if (!item) return;
    var msgId = item.getAttribute('data-msg-id');
    if (msgId) openProfileMessageModal(msgId);
  }

  async function sendProfileMessageReply() {
    if (profileMessageReplySending) return;

    var modal = $('profile-message-modal');
    var replyEl = $('profile-message-modal-reply');
    var sendBtn = $('profile-message-modal-send');
    var threadId = modal ? modal.getAttribute('data-active-thread-id') : '';
    var thread = threadId ? profileMessagesThreadMap[threadId] : null;
    var msgId = modal ? modal.getAttribute('data-active-msg-id') : '';
    var msg = msgId ? profileMessagesById[msgId] : null;
    var tenantId = profileMessagesSession.tenantId;
    var uid = profileMessagesSession.uid;
    var body = replyEl ? String(replyEl.value || '').trim() : '';
    var isThreadMode = profileMessageViewMode === 'thread' && !!thread;

    if (isThreadMode) {
      var latest = (thread.messages || []).length ? thread.messages[thread.messages.length - 1] : null;
      if (!latest || !latest.id) {
        setProfileMessageModalStatus('error', 'Yanıtlanacak mesaj bulunamadı.');
        return;
      }
      msg = latest;
    }

    if (!msg || !uid) {
      setProfileMessageModalStatus('error', 'Mesaj bağlamı bulunamadı.');
      return;
    }
    if (!body) {
      setProfileMessageModalStatus('error', 'Yanıt metni boş olamaz.');
      return;
    }

    var repo = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    var isPublic = profileMessagesSession.isPublicUser;

    profileMessageReplySending = true;
    if (sendBtn) sendBtn.disabled = true;
    setProfileMessageModalStatus('muted', 'Gönderiliyor…');

    try {
      var displayName = profileMessagesSession.displayName || profileMessagesSession.email || (isPublic ? 'Üye' : 'Öğrenci');
      var result;
      var replyOpts = {
        uid: uid,
        body: body,
        inReplyTo: msg.id,
        originalSubject: (thread && thread.subject) || msg.subject || msg.originalSubject,
        senderName: displayName,
        senderEmail: profileMessagesSession.email,
        threadId: thread ? thread.threadId : (msg.threadId || ''),
        rootMessageId: thread ? (thread.rootMessageId || thread.threadId) : (msg.rootMessageId || msg.threadId || ''),
        parentMessageId: msg.id,
        sentFromContext: isThreadMode
          ? (isPublic ? 'public_web_thread_timeline_reply' : 'student_web_thread_timeline_reply')
          : (isPublic ? 'public_web' : 'student_web')
      };
      if (isPublic) {
        if (!repo || typeof repo.sendPublicUserMailboxReply !== 'function') {
          setProfileMessageModalStatus('error', 'Yanıt gönderilemedi.');
          return;
        }
        result = await repo.sendPublicUserMailboxReply(replyOpts);
      } else {
        if (!tenantId || !repo || typeof repo.sendStudentMailboxReply !== 'function') {
          setProfileMessageModalStatus('error', 'Yanıt gönderilemedi.');
          return;
        }
        replyOpts.tenantId = tenantId;
        replyOpts.tenantDisplayName = profileMessagesSession.tenantDisplayName || '';
        result = await repo.sendStudentMailboxReply(replyOpts);
      }

      if (!result || !result.ok) {
        var errMsg = 'Yanıt gönderilemedi. Lütfen daha sonra tekrar deneyin.';
        var err = result && result.error;
        var errCode = err && err.code ? String(err.code) : '';
        var errText = err && err.message ? String(err.message) : '';
        if (errCode === 'permission-denied' || /permission/i.test(errCode + ' ' + errText)) {
          errMsg = 'Yanıt gönderme izni yok. Kurum yöneticinize başvurun.';
        }
        setProfileMessageModalStatus('error', errMsg);
        return;
      }

      if (replyEl) replyEl.value = '';
      setProfileMessageModalStatus('ok', 'Yanıtınız gönderildi.');
      if (isThreadMode) {
        try {
          if (isPublic) {
            await loadAndRenderPublicMessages(profileMessagesSession);
          } else {
            await loadAndRenderMessages({
              tenantId: tenantId,
              uid: uid,
              displayName: profileMessagesSession.displayName,
              email: profileMessagesSession.email,
              tenantName: profileMessagesSession.tenantDisplayName || ''
            });
          }
          await openProfileMessageThreadModal(thread.threadId);
        } catch (_) {}
      } else {
        collapseProfileMessageReplyPanel();
      }
    } catch (e) {
      console.warn('[web-profile] message reply failed', e);
      setProfileMessageModalStatus('error', 'Yanıt gönderilemedi.');
    } finally {
      profileMessageReplySending = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function bindProfileMessageModalEvents() {
    var listEl = $('profile-messages-list');
    if (listEl && !listEl.dataset.boundMessageClicks) {
      listEl.dataset.boundMessageClicks = '1';
      listEl.addEventListener('click', function (e) {
        onProfileMessageItemActivate(e.target);
      });
      listEl.addEventListener('keydown', function (e) {
        if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
        var item = e.target && e.target.closest
          ? (e.target.closest('.profile-messages-item[data-thread-id]') || e.target.closest('.profile-messages-item[data-msg-id]'))
          : null;
        if (!item) return;
        e.preventDefault();
        onProfileMessageItemActivate(item);
      });
    }

    var closeBtn = $('profile-message-modal-close');
    var cancelBtn = $('profile-message-modal-cancel');
    var replyCancelBtn = $('profile-message-modal-reply-cancel');
    var sendBtn = $('profile-message-modal-send');
    var replyToggle = $('profile-message-modal-reply-toggle');
    var backdrop = $('profile-message-modal-backdrop');
    var dialog = document.querySelector('.profile-message-modal__dialog');

    if (closeBtn) closeBtn.addEventListener('click', closeProfileMessageModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeProfileMessageModal);
    if (replyCancelBtn) replyCancelBtn.addEventListener('click', collapseProfileMessageReplyPanel);
    if (sendBtn) sendBtn.addEventListener('click', sendProfileMessageReply);
    if (replyToggle) replyToggle.addEventListener('click', openProfileMessageReplyPanel);
    var hideThreadBtn = $('profile-message-modal-hide-thread');
    if (hideThreadBtn && !hideThreadBtn.dataset.boundHideThread) {
      hideThreadBtn.dataset.boundHideThread = '1';
      hideThreadBtn.addEventListener('click', function () {
        if (profileMessagesSession.isPublicUser) hidePublicProfileThread();
        else hideStudentProfileThread();
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', function (e) {
        if (e && e.target !== backdrop) return;
        if (getSelectedMessageText()) return;
        closeProfileMessageModal();
      });
    }

    if (dialog) {
      dialog.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
      });
    }
  }

  function renderMessagesEmpty(message) {
    clearMessagesList();
    setMessagesPanels({
      loading: false,
      list: false,
      empty: true,
      error: false,
      emptyMessage: message || MESSAGES_EMPTY_TEXT
    });
  }

  function renderMessagesError(message) {
    clearMessagesList();
    setMessagesPanels({
      loading: false,
      list: false,
      empty: false,
      error: true,
      errorMessage: message || MESSAGES_ERROR_TEXT
    });
  }

  async function loadAndRenderPublicMessages(session) {
    hidePublicMessagesPlaceholder();
    setMessagesCardMode('public');
    stopStudentMessagesRealtime();
    updateStudentMessagesUnreadBadge(0);

    var uid = resolvePublicMessageUid(session);
    if (!uid) {
      renderMessagesError(MESSAGES_ERROR_PUBLIC_TEXT);
      return;
    }

    profileMessagesSession = {
      tenantId: '',
      uid: uid,
      displayName: String((session && (session.displayName || session.username)) || '').trim(),
      email: String((session && session.email) || getAuthEmail() || '').trim(),
      isPublicUser: true,
      readOnly: false,
      tenantDisplayName: ''
    };
    closeProfileMailboxSoftHideConfirm({ force: true, cleanup: true });

    var api = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (!api || typeof api.getPublicUserMessages !== 'function') {
      renderMessagesError(MESSAGES_ERROR_PUBLIC_TEXT);
      return;
    }

    renderMessagesLoading(MESSAGES_LOADING_TEXT);

    try {
      var result = await api.getPublicUserMessages(uid);
      if (!result || !result.ok) {
        renderMessagesError(MESSAGES_ERROR_PUBLIC_TEXT);
        return;
      }
      var threads = result.threads || [];
      if (!threads.length && !(result.items || []).length) {
        renderMessagesEmpty(MESSAGES_EMPTY_PUBLIC_TEXT);
        return;
      }
      renderConversationList({
        threads: threads,
        platformItems: [],
        docsById: result.docsById || {},
        emptyMessage: MESSAGES_EMPTY_PUBLIC_TEXT
      });
    } catch (e) {
      console.warn('[web-profile] public messages load failed', e);
      renderMessagesError(MESSAGES_ERROR_PUBLIC_TEXT);
    }
  }

  function renderPublicMessagesPlaceholder() {
    setMessagesCardMode('placeholder');
  }

  async function loadAndRenderMessages(session) {
    setMessagesCardMode('institution');

    var tenantId = String((session && session.tenantId) || '').trim();
    var uid = String((session && session.uid) || '').trim();
    var tenantDisplayName = String((session && session.tenantName) || '').trim();

    if (!tenantId || !uid || !authUidMatches(uid)) {
      stopStudentMessagesRealtime();
      updateStudentMessagesUnreadBadge(0);
      closeProfileMailboxSoftHideConfirm({ force: true, cleanup: true });
      renderMessagesEmpty(MESSAGES_EMPTY_TEXT);
      return;
    }

    profileMessagesSession = {
      tenantId: tenantId,
      uid: uid,
      displayName: String((session && (session.displayName || session.username)) || '').trim(),
      email: String((session && session.email) || getAuthEmail() || '').trim(),
      isPublicUser: false,
      readOnly: false,
      tenantDisplayName: tenantDisplayName
    };
    closeProfileMailboxSoftHideConfirm({ force: true, cleanup: true });

    var api = window.SA_WEB_PROFILE_MESSAGES_REPOSITORY;
    if (!api || typeof api.startStudentMailboxListener !== 'function') {
      renderMessagesError(MESSAGES_ERROR_TEXT);
      return;
    }

    if (!studentMailboxListenerStarted) {
      renderMessagesLoading();
    }

    try {
      var started = await api.startStudentMailboxListener(tenantId, uid, {
        tenantDisplayName: tenantDisplayName
      }, function (payload) {
        applyStudentMessagesRealtimePayload(payload);
      });
      if (!started || !started.ok) {
        renderMessagesError(MESSAGES_ERROR_TEXT);
        return;
      }
      studentMailboxListenerStarted = true;
    } catch (e) {
      console.warn('[web-profile] messages listener failed', e);
      renderMessagesError(MESSAGES_ERROR_TEXT);
    }
  }

  function renderInstitutionProfile(session) {
    showLoggedInState();
    applyPortalHomeLinks();

    var displayName =
      String(session.displayName || session.username || '').trim() || 'Öğrenci';
    setText('profile-display-name', displayName);
    setText('profile-role-label', INSTITUTION_ROLE_LABEL);

    var username = String(session.username || '').trim();
    if (username) {
      setText('profile-username', username);
      setRowVisible('profile-username-row', true);
    } else {
      setRowVisible('profile-username-row', false);
    }

    var email = getAuthEmail();
    if (email) {
      setText('profile-email', email);
      setRowVisible('profile-email-row', true);
    } else {
      setRowVisible('profile-email-row', false);
    }

    var pubBrand = $('profile-brand-public');
    var instBrand = $('profile-brand-institution');
    if (pubBrand) pubBrand.hidden = true;
    if (instBrand) instBrand.hidden = false;

    setText('profile-tenant-name', session.tenantName || session.tenantId || '—');

    var brand = window.SA_WEB_TENANT_BRAND;
    if (brand && typeof brand.applyHeaderBranding === 'function') {
      brand.applyHeaderBranding($('profile-tenant-logo'), $('profile-tenant-monogram'), session);
    }

    loadAndRenderPaymentSummary(session);
    loadAndRenderMessages(session);
  }

  function buildPublicDisplayName(session, userDoc) {
    var data = userDoc || session || {};
    var first = String(data.firstName || '').trim();
    var last = String(data.lastName || '').trim();
    if (first || last) return (first + ' ' + last).trim();
    var display = String(data.displayName || '').trim();
    if (display) return display;
    var email = String(data.email || session.email || '').trim();
    if (email && email.indexOf('@') > 0) return email.split('@')[0];
    return 'Üye';
  }

  function emailLocalPart(email) {
    var value = String(email || '').trim();
    if (!value || value.indexOf('@') <= 0) return '';
    return value.split('@')[0];
  }

  function buildPublicUsername(session, userDoc) {
    var doc = userDoc || {};
    var sess = session || {};
    var email =
      String(doc.email || sess.email || getAuthEmail() || '').trim();
    var candidates = [
      doc.username,
      sess.username,
      doc.displayName,
      doc.firstName,
      sess.displayName,
      emailLocalPart(email)
    ];

    for (var i = 0; i < candidates.length; i++) {
      var value = String(candidates[i] || '').trim();
      if (value) return value;
    }

    return 'Ücretsiz üye';
  }

  function formatCompletedAt(completedAt) {
    if (!completedAt) return '—';
    var date = null;
    if (typeof completedAt.toDate === 'function') {
      date = completedAt.toDate();
    } else if (completedAt instanceof Date) {
      date = completedAt;
    } else if (typeof completedAt === 'string' || typeof completedAt === 'number') {
      date = new Date(completedAt);
    } else if (typeof completedAt.seconds === 'number') {
      date = new Date(completedAt.seconds * 1000);
    }
    if (!date || isNaN(date.getTime())) return '—';
    try {
      return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return '—';
    }
  }

  function formatExamDateShort(completedAt) {
    if (!completedAt) return '—';
    var date = null;
    if (typeof completedAt.toDate === 'function') {
      date = completedAt.toDate();
    } else if (completedAt instanceof Date) {
      date = completedAt;
    } else if (typeof completedAt === 'string' || typeof completedAt === 'number') {
      date = new Date(completedAt);
    } else if (typeof completedAt.seconds === 'number') {
      date = new Date(completedAt.seconds * 1000);
    }
    if (!date || isNaN(date.getTime())) return '—';
    try {
      var day = String(date.getDate()).padStart(2, '0');
      var month = String(date.getMonth() + 1).padStart(2, '0');
      var year = date.getFullYear();
      return day + '.' + month + '.' + year;
    } catch (_) {
      return '—';
    }
  }

  function setExamAttemptsLoading(loading) {
    var summaryLoading = $('profile-exam-summary-loading');
    var summaryEl = $('profile-exam-summary');
    var summaryEmpty = $('profile-exam-summary-empty');

    if (summaryLoading) summaryLoading.hidden = !loading;
    if (loading) {
      if (summaryEl) summaryEl.hidden = true;
      if (summaryEmpty) summaryEmpty.hidden = true;
    }
  }

  function renderExamSummary(attempts, stats) {
    var summaryEl = $('profile-exam-summary');
    var emptyEl = $('profile-exam-summary-empty');
    var totalEl = $('profile-exam-total');
    var averageEl = $('profile-exam-average');
    var bestEl = $('profile-exam-best');
    var lastEl = $('profile-exam-last');
    if (!summaryEl || !emptyEl) return;

    var totalCount = stats && stats.totalCount ? stats.totalCount : 0;
    if (!totalCount) {
      summaryEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = EMPTY_ATTEMPTS_MSG;
      if (totalEl) totalEl.textContent = '0';
      if (averageEl) averageEl.textContent = '—';
      if (bestEl) bestEl.textContent = '—';
      if (lastEl) lastEl.textContent = '—';
      return;
    }

    emptyEl.hidden = true;
    summaryEl.hidden = false;
    if (totalEl) totalEl.textContent = String(totalCount);
    if (averageEl) {
      averageEl.textContent =
        stats.averageScore != null ? '%' + String(stats.averageScore) : '—';
    }
    if (bestEl) {
      bestEl.textContent = stats.bestScore != null ? '%' + String(stats.bestScore) : '—';
    }
    if (lastEl) {
      var latest = attempts && attempts.length ? attempts[0] : null;
      lastEl.textContent = formatExamDateShort(latest ? latest.completedAt : null);
    }
  }

  function buildInstitutionAttemptsContext(session) {
    if (!session) return null;
    var uid = String(session.uid || '').trim();
    var tenantId = String(session.tenantId || '').trim();
    if (!uid || !tenantId) return null;
    return {
      kind: 'institution_student',
      uid: uid,
      tenantId: tenantId
    };
  }

  function buildPublicAttemptsContext(session) {
    if (!session) return null;
    var uid = String(session.uid || '').trim();
    if (!uid || !authUidMatches(uid)) return null;
    return {
      kind: 'public_user',
      uid: uid
    };
  }

  function setLessonsLoading(loading) {
    var loadingEl = $('profile-lessons-loading');
    var countEl = $('profile-lesson-count');
    var summaryEl = $('profile-lesson-summary');
    var emptyEl = $('profile-lesson-empty');

    if (loadingEl) loadingEl.hidden = !loading;
    if (loading) {
      if (countEl) countEl.hidden = true;
      if (summaryEl) summaryEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
    }
  }

  function renderLessonCategorySummary(categoryStats) {
    var summaryEl = $('profile-lesson-summary');
    if (!summaryEl) return;

    var rows = Array.isArray(categoryStats) ? categoryStats : [];
    summaryEl.innerHTML = '';

    rows.forEach(function (row) {
      var item = document.createElement('div');
      item.className = 'profile-lesson-summary__row';

      var title = document.createElement('p');
      title.className = 'profile-lesson-summary__title';
      title.textContent = row.title || row.categoryId || 'Ders';

      var countWrap = document.createElement('div');
      countWrap.className = 'profile-lesson-summary__count-wrap';

      var countLabel = document.createElement('span');
      countLabel.className = 'profile-lesson-summary__count-label';
      countLabel.textContent = 'Tamamlanan Ünite Sayısı';

      var countValue = document.createElement('span');
      var hasCount = row.completedCount > 0;
      countValue.className =
        'profile-lesson-summary__count' +
        (hasCount ? ' profile-lesson-summary__count--filled' : ' profile-lesson-summary__count--empty');
      countValue.textContent = hasCount ? String(row.completedCount) : '-';

      countWrap.appendChild(countLabel);
      countWrap.appendChild(countValue);
      item.appendChild(title);
      item.appendChild(countWrap);
      summaryEl.appendChild(item);
    });

    summaryEl.hidden = !rows.length;
  }

  function renderLessonProgress(items, stats, categoryStats) {
    var countEl = $('profile-lesson-count');
    var summaryEl = $('profile-lesson-summary');
    var emptyEl = $('profile-lesson-empty');
    if (!summaryEl || !emptyEl) return;

    var totalCount = stats && stats.totalCount ? stats.totalCount : 0;
    var categories = Array.isArray(categoryStats) ? categoryStats : [];

    renderLessonCategorySummary(categories);

    if (!categories.length) {
      if (countEl) countEl.hidden = true;
      if (summaryEl) summaryEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = EMPTY_LESSONS_MSG;
      return;
    }

    emptyEl.hidden = true;
    if (countEl) {
      if (totalCount > 0) {
        countEl.hidden = false;
        countEl.textContent = 'Toplam tamamlanan ünite: ' + String(totalCount);
      } else {
        countEl.hidden = true;
      }
    }
  }

  async function loadAndRenderLessonProgress(context) {
    if (!context || context.kind === 'guest') return;

    var api = window.SA_WEB_PROFILE_LESSONS;
    if (!api || typeof api.fetchAllCompletedLessonProgress !== 'function') {
      setLessonsLoading(false);
      renderLessonProgress([], { totalCount: 0 }, []);
      return;
    }

    setLessonsLoading(true);

    try {
      var result = await api.fetchAllCompletedLessonProgress(context);
      var items = (result && result.items) || [];
      var stats =
        typeof api.computeLessonStats === 'function'
          ? api.computeLessonStats(items)
          : { totalCount: 0 };
      var categoryStats =
        typeof api.computeLessonStatsByCategory === 'function'
          ? api.computeLessonStatsByCategory(items)
          : [];
      renderLessonProgress(items, stats, categoryStats);
    } catch (e) {
      console.warn('[web-profile] lesson progress load failed', e);
      renderLessonProgress([], { totalCount: 0 }, []);
    } finally {
      setLessonsLoading(false);
    }
  }

  function setDuelLoading(loading) {
    var loadingEl = $('profile-duel-loading');
    var bodyEl = $('profile-duel-body');
    var emptyEl = $('profile-duel-empty');

    if (loadingEl) loadingEl.hidden = !loading;
    if (loading) {
      if (bodyEl) bodyEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
    }
  }

  function renderDuelSummary(summary) {
    var bodyEl = $('profile-duel-body');
    var emptyEl = $('profile-duel-empty');
    var pointsEl = $('profile-duel-points');
    var matchesEl = $('profile-duel-matches');
    var winsEl = $('profile-duel-wins');
    var lossesEl = $('profile-duel-losses');
    var drawsEl = $('profile-duel-draws');
    var updatedEl = $('profile-duel-updated');

    var data = summary || {};
    var matchesPlayed = Number(data.matchesPlayed) || 0;

    if (!matchesPlayed) {
      if (bodyEl) bodyEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (bodyEl) bodyEl.hidden = false;

    if (pointsEl) {
      pointsEl.textContent = String(Number(data.totalPoints) || 0) + ' puan';
    }
    if (matchesEl) matchesEl.textContent = String(matchesPlayed);
    if (winsEl) winsEl.textContent = String(Number(data.wins) || 0);
    if (lossesEl) lossesEl.textContent = String(Number(data.losses) || 0);
    if (drawsEl) drawsEl.textContent = String(Number(data.draws) || 0);

    if (updatedEl) {
      var updatedText = formatCompletedAt(data.updatedAt);
      if (updatedText && updatedText !== '—') {
        updatedEl.textContent = 'Son güncelleme: ' + updatedText;
        updatedEl.hidden = false;
      } else {
        updatedEl.textContent = '';
        updatedEl.hidden = true;
      }
    }
  }

  async function loadAndRenderDuelSummary(uid) {
    var id = String(uid || '').trim();
    if (!id) return;

    var api = window.SA_WEB_PROFILE_DUEL;
    if (!api || typeof api.fetchOwnDuelSummary !== 'function') {
      setDuelLoading(false);
      renderDuelSummary({ matchesPlayed: 0 });
      return;
    }

    setDuelLoading(true);

    try {
      var result = await api.fetchOwnDuelSummary(id);
      if (result && result.ok && result.summary) {
        renderDuelSummary(result.summary);
      } else {
        renderDuelSummary({ matchesPlayed: 0 });
      }
    } catch (e) {
      console.warn('[web-profile] duel summary load failed', e);
      renderDuelSummary({ matchesPlayed: 0 });
    } finally {
      setDuelLoading(false);
    }
  }

  async function loadAndRenderExamAttempts(context) {
    if (!context || context.kind === 'guest') return;

    var api = window.SA_WEB_PROFILE_ATTEMPTS;
    if (!api || typeof api.fetchRecentExamAttempts !== 'function') {
      setExamAttemptsLoading(false);
      renderExamSummary([], { totalCount: 0 });
      return;
    }

    setExamAttemptsLoading(true);

    try {
      var recentAttempts = [];
      var stats = { totalCount: 0 };

      if (typeof api.fetchExamAttemptSummary === 'function') {
        var summary = await api.fetchExamAttemptSummary(context, {
          recentLimit: 20,
          statsLimit: api.STATS_FETCH_LIMIT || 200
        });
        recentAttempts = (summary && summary.attempts) || [];
        stats =
          summary && summary.stats
            ? summary.stats
            : typeof api.computeAttemptStats === 'function'
              ? api.computeAttemptStats((summary && summary.allAttempts) || recentAttempts)
              : { totalCount: 0 };
      } else {
        var result = await api.fetchRecentExamAttempts(context, 20);
        recentAttempts = (result && result.attempts) || [];
        stats =
          typeof api.computeAttemptStats === 'function'
            ? api.computeAttemptStats(recentAttempts)
            : { totalCount: 0 };
      }

      renderExamSummary(recentAttempts, stats);
    } catch (e) {
      console.warn('[web-profile] exam attempts load failed', e);
      renderExamSummary([], { totalCount: 0 });
    } finally {
      setExamAttemptsLoading(false);
    }
  }

  function renderPublicProfile(session, userDoc) {
    hidePublicMessagesPlaceholder();
    setMessagesCardMode('public');
    showLoggedInState();
    applyPortalHomeLinks();

    var merged = {
      firstName: (userDoc && userDoc.firstName) || session.firstName,
      lastName: (userDoc && userDoc.lastName) || session.lastName,
      displayName: (userDoc && userDoc.displayName) || session.displayName,
      email: (userDoc && userDoc.email) || session.email
    };

    setText('profile-display-name', buildPublicDisplayName(session, merged));
    setText('profile-role-label', PUBLIC_ROLE_LABEL);
    setText('profile-username', buildPublicUsername(session, userDoc));
    setRowVisible('profile-username-row', true);

    var email = String(merged.email || getAuthEmail() || '').trim();
    if (email) {
      setText('profile-email', email);
      setRowVisible('profile-email-row', true);
    } else {
      setRowVisible('profile-email-row', false);
    }

    var pubBrand = $('profile-brand-public');
    var instBrand = $('profile-brand-institution');
    if (pubBrand) pubBrand.hidden = false;
    if (instBrand) instBrand.hidden = true;

    renderPublicAccountStatusPlaceholder();
    loadAndRenderPublicMessages(session);
  }

  function authUidMatches(uid) {
    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user || !user.uid) return false;
    return String(user.uid).trim() === String(uid || '').trim();
  }

  async function resolvePublicProfileFromViewer(session) {
    var userDoc = null;
    var publicAuth = window.SA_PUBLIC_AUTH;
    if (publicAuth && typeof publicAuth.loadPublicUserDoc === 'function') {
      try {
        userDoc = await publicAuth.loadPublicUserDoc(session.uid);
        if (publicAuth.assertPublicUserRole) {
          var check = publicAuth.assertPublicUserRole(userDoc);
          if (!check.ok) {
            showAccessError();
            return;
          }
        }
      } catch (e) {
        console.warn('[web-profile] loadPublicUserDoc failed', e);
      }
    }

    renderPublicProfile(session, userDoc);
    var attemptsContext = buildPublicAttemptsContext(session);
    if (attemptsContext) {
      loadAndRenderExamAttempts(attemptsContext);
      loadAndRenderLessonProgress(attemptsContext);
      loadAndRenderDuelSummary(attemptsContext.uid);
    }
  }

  async function refreshProfile(ctx) {
    if (!document.body || !document.body.classList.contains('page-profilim')) return;

    if (!ctx || ctx.kind === 'error') {
      showAccessError();
      return;
    }

    if (ctx.kind === 'guest') {
      showGuestState();
      return;
    }

    if (ctx.kind === 'institution' && ctx.institutionSession) {
      renderInstitutionProfile(ctx.institutionSession);
      var attemptsContext = buildInstitutionAttemptsContext(ctx.institutionSession);
      if (attemptsContext) {
        loadAndRenderExamAttempts(attemptsContext);
        loadAndRenderLessonProgress(attemptsContext);
        loadAndRenderDuelSummary(attemptsContext.uid);
      }
      return;
    }

    if (ctx.kind === 'public' && ctx.publicSession) {
      await resolvePublicProfileFromViewer(ctx.publicSession);
      return;
    }

    showAccessError();
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-profilim')) return;
    initialized = true;
    bindProfileMessageModalEvents();

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showAccessError();
      return;
    }
    viewer.whenReady().then(function (ctx) {
      refreshProfile(ctx);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
