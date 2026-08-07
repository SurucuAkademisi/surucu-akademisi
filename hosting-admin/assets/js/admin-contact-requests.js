/**
 * Super Admin — İletişim Talepleri (contactRequests)
 * Reads via Firestore listeners; writes only via updateContactRequest callable.
 * No Auth observer / Firebase init / direct Firestore writes.
 */
(function () {
  'use strict';

  var COLLECTION = 'contactRequests';
  var LIST_LIMIT = 200;
  var NOTE_MAX = 2000;
  var FILTERS = ['all', 'new', 'read', 'in_progress', 'answered', 'closed'];

  var REQUEST_TYPE_LABELS = {
    premium_access: 'Bireysel Premium Erişim Talebi',
    institution_membership: 'Sürücü Kursu Kurumsal Üyelik Talebi',
    institution_student_support: 'Mevcut Kurum Öğrencisi Desteği',
    technical_support: 'Teknik Destek',
    education_content: 'Eğitim İçerikleri Hakkında Bilgi',
    partnership: 'İş Birliği Talebi',
    other: 'Diğer'
  };

  var USER_TYPE_LABELS = {
    individual: 'Bireysel Kullanıcı',
    institution_student: 'Kurum Öğrencisi',
    institution_representative: 'Sürücü Kursu Yetkilisi',
    other: 'Diğer'
  };

  var STATUS_LABELS = {
    new: 'Yeni',
    read: 'Okundu',
    in_progress: 'İşleme Alındı',
    answered: 'Yanıtlandı',
    closed: 'Kapatıldı'
  };

  var state = {
    isInitialized: false,
    isAuthorized: false,
    badgeUnsubscribe: null,
    listUnsubscribe: null,
    requestsById: {},
    requestOrder: [],
    selectedRequestId: null,
    activeFilter: 'all',
    listLoaded: false,
    listError: false,
    updateInProgress: false,
    noteSaveInProgress: false,
    markReadInFlight: {},
    uiBound: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getDb() {
    if (typeof firebase === 'undefined' || !firebase.firestore) return null;
    return firebase.firestore();
  }

  function getCallable() {
    if (typeof firebase === 'undefined' || !firebase.functions) return null;
    try {
      return firebase.functions().httpsCallable('updateContactRequest');
    } catch (e) {
      return null;
    }
  }

  function text(el, value) {
    if (!el) return;
    el.textContent = value == null ? '' : String(value);
  }

  function setFeedback(el, message, kind) {
    if (!el) return;
    text(el, message || '');
    if (message && kind) el.setAttribute('data-state', kind);
    else el.removeAttribute('data-state');
  }

  function safeStr(v) {
    return v == null ? '' : String(v);
  }

  function requestTypeLabel(v) {
    var key = safeStr(v).trim();
    return REQUEST_TYPE_LABELS[key] || 'Bilinmeyen Talep';
  }

  function userTypeLabel(v) {
    var key = safeStr(v).trim();
    return USER_TYPE_LABELS[key] || 'Belirtilmemiş';
  }

  function statusLabel(v) {
    var key = safeStr(v).trim();
    return STATUS_LABELS[key] || 'Bilinmeyen';
  }

  function statusClass(v) {
    var key = safeStr(v).trim();
    if (STATUS_LABELS[key]) return 'is-' + key;
    return 'is-closed';
  }

  function formatDateTime(value) {
    if (value == null || value === '') return '—';
    var date = null;
    try {
      if (typeof value.toDate === 'function') date = value.toDate();
      else if (value instanceof Date) date = value;
      else if (typeof value === 'object' && typeof value.seconds === 'number') {
        date = new Date(value.seconds * 1000);
      } else if (typeof value === 'number') date = new Date(value);
      else if (typeof value === 'string' && value.trim()) date = new Date(value);
    } catch (e) {
      date = null;
    }
    if (!date || isNaN(date.getTime())) return '—';
    try {
      return date.toLocaleString('tr-TR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e2) {
      return '—';
    }
  }

  function createdAtMs(req) {
    var v = req && req.createdAt;
    if (!v) return 0;
    try {
      if (typeof v.toDate === 'function') return v.toDate().getTime();
      if (v instanceof Date) return v.getTime();
      if (typeof v.seconds === 'number') return v.seconds * 1000;
    } catch (e) {}
    return 0;
  }

  function previewMessage(msg) {
    var s = safeStr(msg).replace(/\s+/g, ' ').trim();
    if (s.length <= 140) return s;
    return s.slice(0, 140) + '…';
  }

  function displayOrDash(v) {
    var s = safeStr(v).trim();
    return s ? s : '—';
  }

  function callableErrorMessage(err) {
    var code = err && err.code ? String(err.code) : '';
    if (code.indexOf('unauthenticated') !== -1) return 'Oturum gerekli. Lütfen yeniden giriş yapın.';
    if (code.indexOf('permission-denied') !== -1) return 'Bu işlem için yetkiniz yok.';
    if (code.indexOf('invalid-argument') !== -1) return 'Geçersiz istek. Lütfen alanları kontrol edin.';
    if (code.indexOf('not-found') !== -1) return 'Talep bulunamadı.';
    if (code.indexOf('resource-exhausted') !== -1) return 'İşlem limiti aşıldı. Lütfen biraz sonra tekrar deneyin.';
    return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
  }

  function hideBadge() {
    var badge = $('admin-contact-requests-badge');
    if (!badge) return;
    text(badge, '0');
    badge.classList.add('hidden');
  }

  function updateBadge(count) {
    var badge = $('admin-contact-requests-badge');
    if (!badge) return;
    var n = Number(count) || 0;
    if (n <= 0) {
      text(badge, '0');
      badge.classList.add('hidden');
      return;
    }
    text(badge, String(n));
    badge.classList.remove('hidden');
  }

  function stopBadgeListener() {
    if (typeof state.badgeUnsubscribe === 'function') {
      try {
        state.badgeUnsubscribe();
      } catch (e) {}
    }
    state.badgeUnsubscribe = null;
    hideBadge();
  }

  function stopListListener() {
    if (typeof state.listUnsubscribe === 'function') {
      try {
        state.listUnsubscribe();
      } catch (e) {}
    }
    state.listUnsubscribe = null;
  }

  function clearStateData() {
    state.requestsById = {};
    state.requestOrder = [];
    state.selectedRequestId = null;
    state.activeFilter = 'all';
    state.listLoaded = false;
    state.listError = false;
    state.updateInProgress = false;
    state.noteSaveInProgress = false;
    state.markReadInFlight = {};
  }

  function destroy() {
    stopBadgeListener();
    stopListListener();
    clearStateData();
    state.isAuthorized = false;
    var layout = $('contact-requests-layout');
    if (layout) layout.classList.remove('is-detail-open');
    renderList();
    renderDetail();
  }

  function normalizeDoc(id, data) {
    var d = data || {};
    return {
      id: id,
      schemaVersion: d.schemaVersion,
      status: safeStr(d.status || 'new').trim() || 'new',
      requestType: safeStr(d.requestType).trim(),
      userType: safeStr(d.userType).trim(),
      fullName: safeStr(d.fullName).trim(),
      email: safeStr(d.email).trim(),
      phone: d.phone == null || d.phone === '' ? '' : safeStr(d.phone).trim(),
      institutionName:
        d.institutionName == null || d.institutionName === ''
          ? ''
          : safeStr(d.institutionName).trim(),
      city: d.city == null || d.city === '' ? '' : safeStr(d.city).trim(),
      message: safeStr(d.message),
      noticeAcknowledged: d.noticeAcknowledged === true,
      noticeVersion: safeStr(d.noticeVersion).trim(),
      sourcePage: safeStr(d.sourcePage).trim(),
      submitterUid: d.submitterUid == null || d.submitterUid === '' ? '' : safeStr(d.submitterUid),
      tenantId: d.tenantId == null || d.tenantId === '' ? '' : safeStr(d.tenantId),
      createdAt: d.createdAt || null,
      updatedAt: d.updatedAt || null,
      readAt: d.readAt || null,
      answeredAt: d.answeredAt || null,
      closedAt: d.closedAt || null,
      adminNote: d.adminNote == null ? '' : safeStr(d.adminNote),
      statusHistory: Array.isArray(d.statusHistory) ? d.statusHistory : []
    };
  }

  function applyListSnapshot(snap) {
    var nextMap = {};
    var nextOrder = [];
    (snap.docs || []).forEach(function (doc) {
      var row = normalizeDoc(doc.id, doc.data());
      nextMap[doc.id] = row;
      nextOrder.push(doc.id);
    });
    state.requestsById = nextMap;
    state.requestOrder = nextOrder;
    state.listLoaded = true;
    state.listError = false;
    if (state.selectedRequestId && !nextMap[state.selectedRequestId]) {
      state.selectedRequestId = null;
      var layout = $('contact-requests-layout');
      if (layout) layout.classList.remove('is-detail-open');
    }
    renderFilterCounts();
    renderList();
    renderDetail();
  }

  function startBadgeListener() {
    if (!state.isAuthorized) return;
    if (state.badgeUnsubscribe) return;
    var db = getDb();
    if (!db) {
      hideBadge();
      return;
    }
    try {
      state.badgeUnsubscribe = db
        .collection(COLLECTION)
        .where('status', '==', 'new')
        .onSnapshot(
          function (snap) {
            if (!state.isAuthorized) {
              hideBadge();
              return;
            }
            updateBadge(snap.size || 0);
          },
          function (err) {
            try {
              console.warn('[AdminContactRequests] badge listener error', err && (err.code || err.message || err));
            } catch (e) {}
            hideBadge();
          }
        );
    } catch (e) {
      try {
        console.warn('[AdminContactRequests] badge attach failed', e && (e.message || e));
      } catch (e2) {}
      hideBadge();
      state.badgeUnsubscribe = null;
    }
  }

  function startListListener() {
    if (!state.isAuthorized) return;
    if (state.listUnsubscribe) return;
    var db = getDb();
    var statusEl = $('contact-requests-list-status');
    if (!db) {
      state.listError = true;
      setFeedback(statusEl, 'İletişim talepleri yüklenemedi. Lütfen tekrar deneyin.', 'error');
      return;
    }
    setFeedback(statusEl, 'İletişim talepleri yükleniyor…', '');
    try {
      state.listUnsubscribe = db
        .collection(COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(LIST_LIMIT)
        .onSnapshot(
          function (snap) {
            if (!state.isAuthorized) return;
            applyListSnapshot(snap);
            var filtered = getFilteredIds();
            if (!filtered.length) {
              if (!state.requestOrder.length) {
                setFeedback(statusEl, 'Henüz iletişim talebi bulunmuyor.', '');
              } else {
                setFeedback(statusEl, 'Bu durumda iletişim talebi bulunmuyor.', '');
              }
            } else {
              setFeedback(statusEl, '', '');
            }
          },
          function (err) {
            state.listError = true;
            try {
              console.warn('[AdminContactRequests] list listener error', err && (err.code || err.message || err));
            } catch (e) {}
            setFeedback(statusEl, 'İletişim talepleri yüklenemedi. Lütfen tekrar deneyin.', 'error');
          }
        );
    } catch (e) {
      state.listError = true;
      state.listUnsubscribe = null;
      try {
        console.warn('[AdminContactRequests] list attach failed', e && (e.message || e));
      } catch (e2) {}
      setFeedback(statusEl, 'İletişim talepleri yüklenemedi. Lütfen tekrar deneyin.', 'error');
    }
  }

  function startForSuperAdmin() {
    state.isAuthorized = true;
    startBadgeListener();
    startListListener();
  }

  function getFilteredIds() {
    var filter = state.activeFilter || 'all';
    var ids = state.requestOrder.slice();
    if (filter === 'all') return ids;
    return ids.filter(function (id) {
      var req = state.requestsById[id];
      return req && req.status === filter;
    });
  }

  function countByStatus(status) {
    if (status === 'all') return state.requestOrder.length;
    var n = 0;
    state.requestOrder.forEach(function (id) {
      var req = state.requestsById[id];
      if (req && req.status === status) n += 1;
    });
    return n;
  }

  function renderFilterCounts() {
    FILTERS.forEach(function (key) {
      var btn = document.querySelector(
        '#admin-page-contact-requests .contact-requests-filter[data-filter="' + key + '"]'
      );
      if (!btn) return;
      var countEl = btn.querySelector('.contact-requests-filter-count');
      if (!countEl) return;
      text(countEl, String(countByStatus(key)));
      btn.classList.toggle('is-active', state.activeFilter === key);
    });
  }

  function createStatusBadge(status) {
    var span = document.createElement('span');
    span.className = 'contact-requests-status ' + statusClass(status);
    text(span, statusLabel(status));
    return span;
  }

  function renderList() {
    var host = $('contact-requests-list');
    var statusEl = $('contact-requests-list-status');
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    if (!state.isAuthorized) {
      setFeedback(statusEl, '', '');
      return;
    }

    if (!state.listLoaded && !state.listError) {
      setFeedback(statusEl, 'İletişim talepleri yükleniyor…', '');
      return;
    }

    var ids = getFilteredIds();
    if (!ids.length) {
      if (state.listError) {
        setFeedback(statusEl, 'İletişim talepleri yüklenemedi. Lütfen tekrar deneyin.', 'error');
      } else if (!state.requestOrder.length) {
        setFeedback(statusEl, 'Henüz iletişim talebi bulunmuyor.', '');
      } else {
        setFeedback(statusEl, 'Bu durumda iletişim talebi bulunmuyor.', '');
      }
      renderFilterCounts();
      return;
    }

    setFeedback(statusEl, '', '');
    renderFilterCounts();

    ids.forEach(function (id) {
      var req = state.requestsById[id];
      if (!req) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'contact-requests-item';
      if (req.status === 'new') btn.className += ' is-new';
      if (state.selectedRequestId === id) btn.className += ' is-selected';
      btn.setAttribute('data-request-id', id);

      var top = document.createElement('div');
      top.className = 'contact-requests-item-top';
      top.appendChild(createStatusBadge(req.status));
      var typeEl = document.createElement('span');
      typeEl.className = 'contact-requests-item-type';
      text(typeEl, requestTypeLabel(req.requestType));
      top.appendChild(typeEl);
      btn.appendChild(top);

      var nameEl = document.createElement('div');
      nameEl.className = 'contact-requests-item-name';
      text(nameEl, displayOrDash(req.fullName));
      btn.appendChild(nameEl);

      var meta = document.createElement('div');
      meta.className = 'contact-requests-item-meta';
      var metaParts = [displayOrDash(req.email)];
      if (req.institutionName) metaParts.push(req.institutionName);
      if (req.city) metaParts.push(req.city);
      metaParts.push(formatDateTime(req.createdAt));
      text(meta, metaParts.join(' · '));
      btn.appendChild(meta);

      var preview = document.createElement('div');
      preview.className = 'contact-requests-item-preview';
      text(preview, previewMessage(req.message) || '—');
      btn.appendChild(preview);

      btn.addEventListener('click', function () {
        openRequest(id);
      });
      host.appendChild(btn);
    });
  }

  function appendField(grid, label, value, wide) {
    var field = document.createElement('div');
    field.className = 'contact-requests-field' + (wide ? ' is-wide' : '');
    var lab = document.createElement('span');
    lab.className = 'contact-requests-field-label';
    text(lab, label);
    var val = document.createElement('div');
    val.className = 'contact-requests-field-value';
    text(val, value);
    field.appendChild(lab);
    field.appendChild(val);
    grid.appendChild(field);
  }

  function sortedHistory(history) {
    var list = Array.isArray(history) ? history.slice() : [];
    list.sort(function (a, b) {
      var am = 0;
      var bm = 0;
      try {
        if (a && a.at && typeof a.at.toDate === 'function') am = a.at.toDate().getTime();
        else if (a && a.at && typeof a.at.seconds === 'number') am = a.at.seconds * 1000;
      } catch (e) {}
      try {
        if (b && b.at && typeof b.at.toDate === 'function') bm = b.at.toDate().getTime();
        else if (b && b.at && typeof b.at.seconds === 'number') bm = b.at.seconds * 1000;
      } catch (e2) {}
      return am - bm;
    });
    return list;
  }

  function renderDetail() {
    var body = $('contact-requests-detail-body');
    var empty = $('contact-requests-detail-empty');
    var title = $('contact-requests-detail-title');
    if (!body) return;

    while (body.firstChild) body.removeChild(body.firstChild);

    var req = state.selectedRequestId ? state.requestsById[state.selectedRequestId] : null;
    if (!req) {
      if (empty) empty.hidden = false;
      text(title, 'Talep detayı');
      return;
    }
    if (empty) empty.hidden = true;
    text(title, displayOrDash(req.fullName));

    var feedback = document.createElement('div');
    feedback.id = 'contact-requests-detail-feedback';
    feedback.className = 'contact-requests-feedback';
    body.appendChild(feedback);

    var grid = document.createElement('div');
    grid.className = 'contact-requests-field-grid';
    appendField(grid, 'Durum', statusLabel(req.status));
    appendField(grid, 'Talep türü', requestTypeLabel(req.requestType));
    appendField(grid, 'Kullanıcı türü', userTypeLabel(req.userType));
    appendField(grid, 'Ad Soyad', displayOrDash(req.fullName));
    appendField(grid, 'E-posta', displayOrDash(req.email));
    appendField(grid, 'Telefon', displayOrDash(req.phone));
    appendField(grid, 'Kurum adı', displayOrDash(req.institutionName));
    appendField(grid, 'Şehir', displayOrDash(req.city));
    appendField(grid, 'Talep ID', displayOrDash(req.id), true);
    appendField(grid, 'Gönderim', formatDateTime(req.createdAt));
    appendField(grid, 'Son güncelleme', formatDateTime(req.updatedAt));
    appendField(grid, 'Okunma', formatDateTime(req.readAt));
    appendField(grid, 'Yanıtlanma', formatDateTime(req.answeredAt));
    appendField(grid, 'Kapatılma', formatDateTime(req.closedAt));
    appendField(grid, 'Gönderen UID', displayOrDash(req.submitterUid));
    appendField(grid, 'Tenant ID', displayOrDash(req.tenantId));
    appendField(grid, 'Kaynak sayfa', displayOrDash(req.sourcePage));
    appendField(grid, 'Aydınlatma sürümü', displayOrDash(req.noticeVersion));
    appendField(grid, 'Aydınlatma bildirimi', req.noticeAcknowledged ? 'Okundu / bilgi edinildi' : '—');
    body.appendChild(grid);

    var msgField = document.createElement('div');
    msgField.className = 'contact-requests-field is-wide';
    var msgLab = document.createElement('span');
    msgLab.className = 'contact-requests-field-label';
    text(msgLab, 'Mesaj');
    var msgVal = document.createElement('div');
    msgVal.className = 'contact-requests-field-value contact-requests-message';
    text(msgVal, displayOrDash(req.message));
    msgField.appendChild(msgLab);
    msgField.appendChild(msgVal);
    body.appendChild(msgField);

    var actions = document.createElement('div');
    actions.className = 'contact-requests-actions';

    var statusWrap = document.createElement('label');
    statusWrap.className = 'contact-requests-field-label';
    text(statusWrap, 'Durum güncelle');
    var statusSelect = document.createElement('select');
    statusSelect.id = 'contact-requests-status-select';
    statusSelect.className = 'contact-requests-select';
    statusSelect.disabled = state.updateInProgress;
    ['new', 'read', 'in_progress', 'answered', 'closed'].forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      text(opt, statusLabel(key));
      if (key === req.status) opt.selected = true;
      statusSelect.appendChild(opt);
    });
    statusSelect.addEventListener('change', function () {
      changeStatus(req.id, statusSelect.value);
    });
    actions.appendChild(statusWrap);
    actions.appendChild(statusSelect);

    var mailBtn = document.createElement('a');
    mailBtn.className = 'contact-requests-btn contact-requests-btn--primary';
    mailBtn.href = req.email ? 'mailto:' + encodeURIComponent(req.email) : '#';
    if (!req.email) mailBtn.setAttribute('aria-disabled', 'true');
    text(mailBtn, 'E-posta Gönder');
    actions.appendChild(mailBtn);

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'contact-requests-btn';
    text(copyBtn, 'E-postayı Kopyala');
    copyBtn.addEventListener('click', function () {
      copyEmail(req.email, feedback);
    });
    actions.appendChild(copyBtn);
    body.appendChild(actions);

    var noteBox = document.createElement('div');
    noteBox.className = 'contact-requests-field is-wide';
    var noteLabel = document.createElement('label');
    noteLabel.className = 'contact-requests-note-label';
    noteLabel.setAttribute('for', 'contact-requests-admin-note');
    text(noteLabel, 'İç not');
    var noteHint = document.createElement('p');
    noteHint.className = 'contact-requests-note-hint';
    text(noteHint, 'Yalnızca Super Admin tarafından görülebilir.');
    var noteArea = document.createElement('textarea');
    noteArea.id = 'contact-requests-admin-note';
    noteArea.className = 'contact-requests-note';
    noteArea.maxLength = NOTE_MAX;
    noteArea.value = req.adminNote || '';
    noteArea.disabled = state.noteSaveInProgress;
    var noteMeta = document.createElement('div');
    noteMeta.className = 'contact-requests-note-meta';
    var noteCount = document.createElement('span');
    noteCount.className = 'contact-requests-note-count';
    text(noteCount, String((noteArea.value || '').length) + ' / ' + NOTE_MAX);
    noteArea.addEventListener('input', function () {
      text(noteCount, String((noteArea.value || '').length) + ' / ' + NOTE_MAX);
    });
    var saveNoteBtn = document.createElement('button');
    saveNoteBtn.type = 'button';
    saveNoteBtn.className = 'contact-requests-btn contact-requests-btn--primary';
    text(saveNoteBtn, 'Notu Kaydet');
    saveNoteBtn.disabled = state.noteSaveInProgress;
    saveNoteBtn.addEventListener('click', function () {
      saveAdminNote(req.id, noteArea.value || '', feedback, saveNoteBtn, noteArea);
    });
    noteMeta.appendChild(noteCount);
    noteMeta.appendChild(saveNoteBtn);
    noteBox.appendChild(noteLabel);
    noteBox.appendChild(noteHint);
    noteBox.appendChild(noteArea);
    noteBox.appendChild(noteMeta);
    body.appendChild(noteBox);

    var histWrap = document.createElement('div');
    histWrap.className = 'contact-requests-field is-wide';
    var histLab = document.createElement('span');
    histLab.className = 'contact-requests-field-label';
    text(histLab, 'Durum geçmişi');
    histWrap.appendChild(histLab);
    var histList = document.createElement('ul');
    histList.className = 'contact-requests-history';
    var history = sortedHistory(req.statusHistory);
    if (!history.length) {
      var emptyHist = document.createElement('li');
      emptyHist.className = 'contact-requests-history-item';
      text(emptyHist, 'Kayıt yok');
      histList.appendChild(emptyHist);
    } else {
      history.forEach(function (entry) {
        var li = document.createElement('li');
        li.className = 'contact-requests-history-item';
        var st = entry && entry.status ? statusLabel(entry.status) : '—';
        var at = formatDateTime(entry && entry.at);
        var by = entry && entry.byUid ? safeStr(entry.byUid) : '—';
        text(li, st + ' · ' + at + ' · ' + by);
        histList.appendChild(li);
      });
    }
    histWrap.appendChild(histList);
    body.appendChild(histWrap);
  }

  function copyEmail(email, feedbackEl) {
    var value = safeStr(email).trim();
    if (!value) {
      setFeedback(feedbackEl, 'Kopyalanacak e-posta yok.', 'error');
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(value).then(
        function () {
          setFeedback(feedbackEl, 'E-posta kopyalandı.', 'ok');
        },
        function () {
          setFeedback(feedbackEl, 'E-posta kopyalanamadı.', 'error');
        }
      );
      return;
    }
    setFeedback(feedbackEl, 'Panoya kopyalama bu tarayıcıda kullanılamıyor.', 'error');
  }

  function openRequest(requestId) {
    var req = state.requestsById[requestId];
    if (!req) return;
    state.selectedRequestId = requestId;
    var layout = $('contact-requests-layout');
    if (layout) layout.classList.add('is-detail-open');
    renderList();
    renderDetail();

    if (req.status === 'new' && !state.markReadInFlight[requestId]) {
      markRead(requestId);
    }
  }

  function closeDetail() {
    state.selectedRequestId = null;
    var layout = $('contact-requests-layout');
    if (layout) layout.classList.remove('is-detail-open');
    renderList();
    renderDetail();
  }

  function markRead(requestId) {
    var callable = getCallable();
    var feedback = $('contact-requests-detail-feedback');
    if (!callable) {
      setFeedback(feedback, 'Cloud Function istemcisi yüklenemedi.', 'error');
      return;
    }
    state.markReadInFlight[requestId] = true;
    setFeedback(feedback, 'Okundu olarak işaretleniyor…', '');
    callable({ requestId: requestId, status: 'read' })
      .then(function () {
        setFeedback(feedback, '', '');
      })
      .catch(function (err) {
        setFeedback(feedback, callableErrorMessage(err), 'error');
        try {
          console.warn('[AdminContactRequests] mark-read failed', err && (err.code || err.message || err));
        } catch (e) {}
      })
      .then(function () {
        delete state.markReadInFlight[requestId];
      });
  }

  function changeStatus(requestId, nextStatus) {
    if (state.updateInProgress) return;
    var req = state.requestsById[requestId];
    if (!req) return;
    if (safeStr(nextStatus) === req.status) return;
    var callable = getCallable();
    var feedback = $('contact-requests-detail-feedback');
    var select = $('contact-requests-status-select');
    if (!callable) {
      setFeedback(feedback, 'Cloud Function istemcisi yüklenemedi.', 'error');
      if (select) select.value = req.status;
      return;
    }
    state.updateInProgress = true;
    if (select) select.disabled = true;
    setFeedback(feedback, 'Durum güncelleniyor…', '');
    callable({ requestId: requestId, status: nextStatus })
      .then(function () {
        setFeedback(feedback, 'Durum güncellendi.', 'ok');
      })
      .catch(function (err) {
        setFeedback(feedback, callableErrorMessage(err), 'error');
        if (select) select.value = req.status;
        try {
          console.warn('[AdminContactRequests] status update failed', err && (err.code || err.message || err));
        } catch (e) {}
      })
      .then(function () {
        state.updateInProgress = false;
        renderDetail();
      });
  }

  function saveAdminNote(requestId, noteValue, feedbackEl, saveBtn, noteArea) {
    if (state.noteSaveInProgress) return;
    var callable = getCallable();
    if (!callable) {
      setFeedback(feedbackEl, 'Cloud Function istemcisi yüklenemedi.', 'error');
      return;
    }
    var note = safeStr(noteValue);
    if (note.length > NOTE_MAX) note = note.slice(0, NOTE_MAX);
    state.noteSaveInProgress = true;
    if (saveBtn) saveBtn.disabled = true;
    if (noteArea) noteArea.disabled = true;
    setFeedback(feedbackEl, 'Not kaydediliyor…', '');
    callable({ requestId: requestId, adminNote: note })
      .then(function () {
        setFeedback(feedbackEl, 'Not kaydedildi.', 'ok');
      })
      .catch(function (err) {
        setFeedback(feedbackEl, callableErrorMessage(err), 'error');
        try {
          console.warn('[AdminContactRequests] note save failed', err && (err.code || err.message || err));
        } catch (e) {}
      })
      .then(function () {
        state.noteSaveInProgress = false;
        renderDetail();
      });
  }

  function setFilter(filter) {
    if (FILTERS.indexOf(filter) === -1) filter = 'all';
    state.activeFilter = filter;
    renderFilterCounts();
    renderList();
  }

  function bindUi() {
    if (state.uiBound) return;
    state.uiBound = true;
    var toolbar = $('contact-requests-toolbar');
    if (toolbar) {
      toolbar.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
        if (!btn || !toolbar.contains(btn)) return;
        setFilter(btn.getAttribute('data-filter') || 'all');
      });
    }
    var back = $('contact-requests-back-btn');
    if (back) {
      back.addEventListener('click', function () {
        closeDetail();
      });
    }
  }

  function onShow() {
    if (!state.isAuthorized) return;
    startListListener();
    renderFilterCounts();
    renderList();
    renderDetail();
  }

  function init() {
    if (state.isInitialized) return;
    state.isInitialized = true;
    bindUi();
    hideBadge();
    renderDetail();
  }

  window.AdminContactRequests = {
    init: init,
    startForSuperAdmin: startForSuperAdmin,
    destroy: destroy,
    onShow: onShow,
    initializeContactRequestsAdmin: startForSuperAdmin,
    openContactRequestsPage: onShow,
    destroyContactRequestsAdmin: destroy
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
