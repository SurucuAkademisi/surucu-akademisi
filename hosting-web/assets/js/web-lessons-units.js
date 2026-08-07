/**
 * Dersler — unit list per category.
 */
(function () {
  'use strict';

  var SESSION_CATEGORY_KEY = 'sa_web_lesson_category_id';
  var SESSION_UNIT_KEY = 'sa_web_lesson_unit_id';
  var initialized = false;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readCategoryIdFromQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      var q = String(params.get('categoryId') || '').trim();
      if (q) return q;
    } catch (_) {}
    try {
      return String(sessionStorage.getItem(SESSION_CATEGORY_KEY) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function saveCategoryNavigation(categoryId) {
    try {
      sessionStorage.setItem(SESSION_CATEGORY_KEY, String(categoryId || '').trim());
    } catch (_) {}
  }

  function readUrlForUnit(categoryId, unitId) {
    try {
      var target = new URL('./read.html', window.location.href);
      target.searchParams.set('categoryId', categoryId);
      target.searchParams.set('unitId', unitId);
      return target.href;
    } catch (_) {
      return (
        'read.html?categoryId=' + encodeURIComponent(categoryId) + '&unitId=' + encodeURIComponent(unitId)
      );
    }
  }

  function saveUnitNavigation(categoryId, unitId) {
    saveCategoryNavigation(categoryId);
    try {
      sessionStorage.setItem(SESSION_UNIT_KEY, String(unitId || '').trim());
    } catch (_) {}
  }

  function renderInvalidCategory() {
    var main = $('.lesson-units-main');
    if (main) main.hidden = true;
    var err = $('#lesson-units-invalid');
    if (err) err.hidden = false;
  }

  function renderGuestState(catalogMeta) {
    var loading = $('#lesson-units-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#lesson-units-guest-cta');
    if (guestCta) guestCta.hidden = false;

    var grid = $('#lesson-unit-grid');
    if (grid) {
      grid.hidden = true;
      grid.innerHTML = '';
    }

    var title = $('#lesson-units-category-title');
    if (title && catalogMeta) title.textContent = catalogMeta.title;
  }

  function resolveUnitId(unit) {
    if (!unit || typeof unit !== 'object') return '';
    return String(unit.id || unit.unitId || unit.slug || '').trim();
  }

  function renderUnits(categoryId, units, progressMap) {
    var loading = $('#lesson-units-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#lesson-units-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var grid = $('#lesson-unit-grid');
    if (!grid) return;

    if (!units.length) {
      grid.hidden = true;
      var empty = $('#lesson-units-empty');
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'Bu kitapta henüz yayında ünite yok.';
      }
      return;
    }

    var empty = $('#lesson-units-empty');
    if (empty) empty.hidden = true;

    var progressApi = window.SA_WEB_LESSON_PROGRESS;
    var map = progressMap && typeof progressMap === 'object' ? progressMap : {};

    grid.hidden = false;
    grid.innerHTML = units
      .map(function (unit, index) {
        var unitId = resolveUnitId(unit);
        var completed =
          progressApi && typeof progressApi.isUnitCompletedInMap === 'function'
            ? progressApi.isUnitCompletedInMap(map, categoryId, unitId)
            : false;
        var cardClass = 'lesson-unit-card' + (completed ? ' lesson-unit-card--completed' : '');
        var statusHtml = completed
          ? '<span class="lesson-unit-status lesson-unit-status--completed">✓ Tamamlandı</span>'
          : '';
        return (
          '<article class="' + cardClass + '" data-unit-id="' + escapeHtml(unitId) + '" role="link" tabindex="0">'
          + '<span class="lesson-unit-card__index">' + (index + 1) + '</span>'
          + '<h2 class="lesson-unit-card__title">' + escapeHtml(unit.title) + '</h2>'
          + '<div class="lesson-unit-card__actions">'
          + statusHtml
          + '<span class="lesson-unit-card__cta">Oku</span>'
          + '</div>'
          + '</article>'
        );
      })
      .join('');

    $all('.lesson-unit-card[data-unit-id]', grid).forEach(function (card) {
      var unitId = card.getAttribute('data-unit-id');
      function go() {
        saveUnitNavigation(categoryId, unitId);
        window.location.href = readUrlForUnit(categoryId, unitId);
      }
      card.onclick = go;
      card.onkeydown = function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          go();
        }
      };
    });
  }

  function showAccessError(catalogMeta) {
    var loading = $('#lesson-units-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#lesson-units-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var grid = $('#lesson-unit-grid');
    if (grid) {
      grid.hidden = true;
      grid.innerHTML = '';
    }

    var err = $('#lesson-units-error');
    if (err) {
      err.hidden = false;
      err.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }

    var title = $('#lesson-units-category-title');
    if (title && catalogMeta) title.textContent = catalogMeta.title;
  }

  async function refreshUnits(categoryId, catalogMeta) {
    var repo = window.SA_WEB_LESSONS_REPO;
    if (!repo) return;

    var title = $('#lesson-units-category-title');
    if (title) {
      title.textContent = (catalogMeta && catalogMeta.title) || categoryId;
      title.setAttribute('aria-current', 'page');
    }

    if (!repo.isAuthenticated()) {
      showAccessError(catalogMeta);
      return;
    }

    var loading = $('#lesson-units-loading');
    if (loading) loading.hidden = false;

    var result = await repo.loadUnits(categoryId);
    if (!result.ok) {
      if (loading) loading.hidden = true;
      var err = $('#lesson-units-error');
      if (err) {
        err.hidden = false;
        err.textContent = result.error || 'Üniteler yüklenemedi.';
      }
      return;
    }

    var units = result.units || [];
    var progressMap = {};
    var progressApi = window.SA_WEB_LESSON_PROGRESS;

    if (progressApi && typeof progressApi.resolveProgressContext === 'function') {
      var ctx = progressApi.resolveProgressContext();
      if (ctx && ctx.kind !== 'guest' && typeof progressApi.fetchLessonProgressMapForUnits === 'function') {
        var unitIds = units.map(resolveUnitId).filter(Boolean);
        try {
          progressMap = await progressApi.fetchLessonProgressMapForUnits(ctx, categoryId, unitIds);
        } catch (progressErr) {
          console.warn('[web-lessons-units] progress fetch failed', progressErr);
          progressMap = {};
        }
      }
    }

    renderUnits(categoryId, units, progressMap);
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-dersler-units')) return;
    initialized = true;

    var catalog = window.SA_WEB_LESSONS_CATALOG;
    var categoryId = readCategoryIdFromQuery();
    if (!catalog || !catalog.isValidLessonCategoryId(categoryId)) {
      renderInvalidCategory();
      return;
    }

    saveCategoryNavigation(categoryId);
    var catalogMeta = catalog.getCategoryById(categoryId);

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showAccessError(catalogMeta);
      return;
    }
    viewer.whenReady().then(function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showAccessError(catalogMeta);
        return;
      }
      if (ctx.kind === 'guest') {
        renderGuestState(catalogMeta);
        return;
      }
      refreshUnits(categoryId, catalogMeta);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
