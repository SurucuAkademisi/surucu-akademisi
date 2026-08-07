/**
 * Per-category published exam list (metadata only, no quiz).
 */
(function () {
  'use strict';

  function $(sel) {
    return document.querySelector(sel);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var SESSION_CATEGORY_KEY = 'sa_web_exam_list_category';

  function getCategoryKeyFromQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      return String(params.get('category') || '').trim().toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function getCategoryKeyFromSession() {
    try {
      return String(sessionStorage.getItem(SESSION_CATEGORY_KEY) || '').trim().toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function resolveCategoryKey(catalog) {
    var fromQuery = getCategoryKeyFromQuery();
    if (fromQuery && catalog && catalog.isValidCategoryKey && catalog.isValidCategoryKey(fromQuery)) {
      return fromQuery;
    }
    var fromSession = getCategoryKeyFromSession();
    if (fromSession && catalog && catalog.isValidCategoryKey && catalog.isValidCategoryKey(fromSession)) {
      return fromSession;
    }
    return fromQuery || fromSession || '';
  }

  function setLoading(on) {
    var el = $('#exam-list-loading');
    if (el) el.hidden = !on;
  }

  function showGuestCta() {
    var guest = $('#exam-list-guest-cta');
    var root = $('#exam-list-root');
    var empty = $('#exam-list-empty');
    var err = $('#exam-list-error');
    if (guest) guest.hidden = false;
    if (root) root.innerHTML = '';
    if (empty) empty.hidden = true;
    if (err) err.hidden = true;
    setLoading(false);
  }

  function showError(msg) {
    var err = $('#exam-list-error');
    if (err) {
      err.textContent = msg || 'Sınav listesi yüklenemedi.';
      err.hidden = false;
    }
    var empty = $('#exam-list-empty');
    if (empty) empty.hidden = true;
    setLoading(false);
  }

  function showEmpty() {
    var empty = $('#exam-list-empty');
    if (empty) empty.hidden = false;
    var root = $('#exam-list-root');
    if (root) root.innerHTML = '';
    setLoading(false);
  }

  function showAccessError() {
    var guest = $('#exam-list-guest-cta');
    if (guest) guest.hidden = true;
    showError('Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.');
  }

  var SESSION_EXAM_ID_KEY = 'sa_web_exam_id';

  function examUrlForId(examId, categoryKey) {
    var id = String(examId || '').trim();
    var cat = String(categoryKey || '').trim().toLowerCase();
    try {
      var target = new URL('./exam.html', window.location.href);
      target.searchParams.set('examId', id);
      if (cat === 'video_animation') {
        target.searchParams.set('category', 'video_animation');
      }
      return target.href;
    } catch (_) {
      var url = 'exam.html?examId=' + encodeURIComponent(id);
      if (cat === 'video_animation') {
        url += '&category=video_animation';
      }
      return url;
    }
  }

  function saveExamForNavigation(examId) {
    try {
      sessionStorage.setItem(SESSION_EXAM_ID_KEY, String(examId || '').trim());
    } catch (_) {}
  }

  /** Page-load Turkey calendar date for list-card “Son güncelleme” (presentation only). */
  var sonKontrolDateLabel = null;

  function getSonKontrolDateLabel() {
    if (sonKontrolDateLabel != null) return sonKontrolDateLabel;
    var now = new Date();
    try {
      sonKontrolDateLabel = new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(now);
    } catch (_) {
      try {
        sonKontrolDateLabel = now.toLocaleDateString('tr-TR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      } catch (__) {
        var months = [
          'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
          'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
        ];
        sonKontrolDateLabel =
          now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
      }
    }
    return sonKontrolDateLabel;
  }

  function formatMeta(exam) {
    var parts = [];
    if (exam.totalQuestions != null && Number.isFinite(Number(exam.totalQuestions))) {
      parts.push(Number(exam.totalQuestions) + ' soru');
    }
    if (exam.timeLimit != null && Number.isFinite(Number(exam.timeLimit))) {
      parts.push(Number(exam.timeLimit) + ' dk');
    }
    parts.push('Son güncelleme: ' + getSonKontrolDateLabel());
    return parts.join(' · ');
  }

  function renderExams(exams, repo, categoryKey) {
    var root = $('#exam-list-root');
    if (!root) return;
    var list = Array.isArray(exams) ? exams : [];
    if (!list.length) {
      showEmpty();
      return;
    }

    var html = '<div class="exam-published-grid" role="list">';
    list.forEach(function (exam) {
      var title = escapeHtml(exam.title || exam.examId);
      var desc = escapeHtml(exam.description || '');
      var meta = escapeHtml(formatMeta(exam));
      html += '<article class="exam-published-card" role="listitem">';
      html += '<div class="exam-published-card__head">';
      html += '<h2 class="exam-published-card__title">' + title + '</h2>';
      html += '<span class="exam-published-card__status">Yayınlandı</span>';
      html += '</div>';
      if (desc) {
        html += '<p class="exam-published-card__desc">' + desc + '</p>';
      }
      if (meta) {
        html += '<p class="exam-published-card__meta">' + meta + '</p>';
      }
      html += '<div class="exam-published-card__actions">';
      html += '<button type="button" class="btn btn-exam-solve" data-exam-id="' + escapeHtml(exam.examId) + '">Sınavı Çöz</button>';
      html += '</div>';
      html += '</article>';
    });
    html += '</div>';
    root.innerHTML = html;

    root.querySelectorAll('.btn-exam-solve[data-exam-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var examId = btn.getAttribute('data-exam-id');
        if (!examId) return;
        saveExamForNavigation(examId);
        window.location.href = examUrlForId(examId, categoryKey);
      });
    });

    var empty = $('#exam-list-empty');
    if (empty) empty.hidden = true;
    var err = $('#exam-list-error');
    if (err) err.hidden = true;
    setLoading(false);
  }

  async function init() {
    if (!document.body || !document.body.classList.contains('page-cikmis-sorular')) return;
    if (!document.body.classList.contains('page-exam-list')) return;

    var catalog = window.SA_WEB_EXAM_CATALOG;
    var repo = window.SA_WEB_EXAM_REPO;
    if (!catalog || !repo) return;

    var categoryKey = resolveCategoryKey(catalog);
    var cat = catalog.getCategoryByKey(categoryKey);

    var titleEl = $('#exam-list-category-title');

    if (!cat) {
      if (titleEl) titleEl.textContent = 'Geçersiz kategori';
      setLoading(false);
      showError('Geçersiz veya eksik kategori parametresi.');
      return;
    }

    setLoading(false);

    if (titleEl) {
      titleEl.textContent = cat.title;
      titleEl.setAttribute('aria-current', 'page');
    }

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showAccessError();
      return;
    }

    viewer.whenReady().then(async function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showAccessError();
        return;
      }
      if (ctx.kind === 'guest') {
        showGuestCta();
        return;
      }

      var guest = $('#exam-list-guest-cta');
      if (guest) guest.hidden = true;

      setLoading(true);
      var result = await repo.loadPublishedExams();
      if (!result.ok) {
        showError(result.error);
        return;
      }

      var grouped = result.grouped || {};
      var exams = grouped[categoryKey] || [];
      renderExams(exams, repo, categoryKey);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
