/**
 * Dersler — unit reader (text / image blocks).
 */
(function () {
  'use strict';

  var SESSION_CATEGORY_KEY = 'sa_web_lesson_category_id';
  var SESSION_UNIT_KEY = 'sa_web_lesson_unit_id';
  var initialized = false;
  var progressSaveInFlight = false;
  var progressBound = false;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readIdsFromQuery() {
    var categoryId = '';
    var unitId = '';
    try {
      var params = new URLSearchParams(window.location.search);
      categoryId = String(params.get('categoryId') || '').trim();
      unitId = String(params.get('unitId') || '').trim();
    } catch (_) {}
    if (!categoryId) {
      try {
        categoryId = String(sessionStorage.getItem(SESSION_CATEGORY_KEY) || '').trim();
      } catch (_) {}
    }
    if (!unitId) {
      try {
        unitId = String(sessionStorage.getItem(SESSION_UNIT_KEY) || '').trim();
      } catch (_) {}
    }
    return { categoryId: categoryId, unitId: unitId };
  }

  function saveNavigation(categoryId, unitId) {
    try {
      sessionStorage.setItem(SESSION_CATEGORY_KEY, String(categoryId || '').trim());
      sessionStorage.setItem(SESSION_UNIT_KEY, String(unitId || '').trim());
    } catch (_) {}
  }

  function normalizeSegments(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (seg) {
        return {
          text: String(seg && seg.text || ''),
          marks: Array.isArray(seg && seg.marks) ? seg.marks : []
        };
      })
      .filter(function (seg) {
        return seg.text.length > 0;
      });
  }

  function segmentClassList(marks) {
    var cls = ['lesson-text-seg'];
    var m = marks || [];
    if (m.indexOf('bold') >= 0) cls.push('lesson-text-seg--bold');
    if (m.indexOf('danger') >= 0) cls.push('lesson-text-seg--danger');
    if (m.indexOf('italic') >= 0) cls.push('lesson-text-seg--italic');
    return cls.join(' ');
  }

  function renderTextBlock(block) {
    var attached = '';
    var attUrl = String(block.imageUrl || '').trim();
    if (attUrl) {
      attached =
        '<div class="lesson-block-attached-media">'
        + '<img class="lesson-image lesson-image--inline" src="' + escapeHtml(attUrl) + '" alt="" loading="lazy" />'
        + (block.caption
          ? '<p class="lesson-image-caption">' + escapeHtml(block.caption) + '</p>'
          : '')
        + '</div>';
    }

    var segs = normalizeSegments(block.textSegments);
    if (segs.length) {
      var parts = segs
        .map(function (seg) {
          return (
            '<span class="' + segmentClassList(seg.marks) + '">' + escapeHtml(seg.text) + '</span>'
          );
        })
        .join('');
      return (
        '<article class="lesson-block lesson-block--text lesson-block--segments">'
        + '<div class="lesson-text-body lesson-text-body--segments">' + parts + '</div>'
        + attached
        + '</article>'
      );
    }

    var preset = String(block.textPreset || 'normal').trim().toLowerCase();
    if (['normal', 'info', 'warning', 'danger'].indexOf(preset) < 0) preset = 'normal';
    var safeText = escapeHtml(block.text).replace(/\n/g, '<br />');

    return (
      '<article class="lesson-block lesson-block--text lesson-block--preset-' + escapeHtml(preset) + '">'
      + '<div class="lesson-text-body">' + safeText + '</div>'
      + attached
      + '</article>'
    );
  }

  function renderImageBlock(block) {
    var url = String(block.imageUrl || '').trim();
    if (!url) return '';
    return (
      '<article class="lesson-block lesson-block--image">'
      + '<figure class="lesson-figure">'
      + '<img class="lesson-image" src="' + escapeHtml(url) + '" alt="" loading="lazy" />'
      + (block.caption ? '<figcaption class="lesson-image-caption">' + escapeHtml(block.caption) + '</figcaption>' : '')
      + '</figure>'
      + '</article>'
    );
  }

  function isSafeYoutubeUrl(url) {
    var u = String(url || '').trim();
    if (!/^https:\/\//i.test(u)) return false;
    return /^(https:\/\/(www\.)?youtube\.com\/|https:\/\/youtu\.be\/)/i.test(u);
  }

  function renderYoutubeArea(youtubeUrl) {
    if (!isSafeYoutubeUrl(youtubeUrl)) return '';
    return (
      '<aside class="lesson-youtube">'
      + '<p class="lesson-youtube__label">Video içeriği</p>'
      + '<a class="lesson-youtube__link" href="' + escapeHtml(youtubeUrl) + '" target="_blank" rel="noopener noreferrer">YouTube\'da izle</a>'
      + '</aside>'
    );
  }

  function renderBlocks(blocks) {
    var host = $('#lesson-reader-blocks');
    if (!host) return;

    if (!blocks || !blocks.length) {
      host.innerHTML = '<p class="lesson-empty-state">Bu ünitede henüz içerik yok.</p>';
      return;
    }

    host.innerHTML = blocks
      .map(function (block) {
        if (block.type === 'image') return renderImageBlock(block);
        return renderTextBlock(block);
      })
      .join('');
  }

  function renderInvalid() {
    var main = $('.lesson-reader-main');
    if (main) main.hidden = true;
    var err = $('#lesson-reader-invalid');
    if (err) err.hidden = false;
  }

  function hideProgressMessage() {
    var msg = $('#lesson-progress-message');
    if (msg) {
      msg.hidden = true;
      msg.textContent = '';
      msg.classList.remove('lesson-progress-panel__message--error');
    }
  }

  function showProgressMessage(text, isError) {
    var msg = $('#lesson-progress-message');
    if (!msg) return;
    msg.textContent = text || '';
    msg.hidden = !text;
    if (isError) msg.classList.add('lesson-progress-panel__message--error');
    else msg.classList.remove('lesson-progress-panel__message--error');
  }

  function renderProgressGuestNote() {
    var panel = $('#lesson-reader-progress');
    var status = $('#lesson-progress-status');
    var action = $('#lesson-progress-action');
    if (!panel) return;

    panel.hidden = false;
    if (status) {
      status.textContent = 'İlerlemeni kaydetmek için giriş yap';
      status.classList.remove('lesson-progress-panel__status--done');
    }
    if (action) action.hidden = true;
    hideProgressMessage();
  }

  function renderProgressUiState(completed, saving) {
    var panel = $('#lesson-reader-progress');
    var status = $('#lesson-progress-status');
    var action = $('#lesson-progress-action');
    if (!panel) return;

    panel.hidden = false;
    panel.classList.toggle('lesson-progress-panel--completed', !!completed);

    if (status) {
      status.textContent = completed
        ? 'Bu ünite tamamlandı olarak işaretlendi.'
        : 'Üniteyi bitirdiyseniz tamamlandı olarak işaretleyebilirsiniz.';
      status.classList.toggle('lesson-progress-panel__status--done', !!completed);
    }

    if (action) {
      action.hidden = false;
      action.disabled = !!completed || !!saving;
      action.textContent = completed ? 'Tamamlandı' : 'Tamamlandı olarak işaretle';
      action.classList.toggle('lesson-progress-panel__btn--completed', !!completed);
      action.classList.toggle('lesson-progress-panel__btn--saving', !!saving);
      action.setAttribute('aria-pressed', completed ? 'true' : 'false');
    }
  }

  function bindProgressAction(categoryId, unitId, unit, catalogMeta, context) {
    var action = $('#lesson-progress-action');
    if (!action || progressBound) return;
    progressBound = true;

    action.addEventListener('click', async function () {
      if (progressSaveInFlight || action.disabled) return;

      var progressApi = window.SA_WEB_LESSON_PROGRESS;
      if (!progressApi || typeof progressApi.markLessonCompleted !== 'function') {
        showProgressMessage('İlerleme kaydedilemedi. Lütfen sayfayı yenileyin.', true);
        return;
      }

      progressSaveInFlight = true;
      renderProgressUiState(false, true);
      hideProgressMessage();

      try {
        var result = await progressApi.markLessonCompleted(context, {
          categoryId: categoryId,
          categoryTitle: (catalogMeta && catalogMeta.title) || '',
          unitId: unitId,
          unitTitle: (unit && unit.title) || ''
        });

        if (result && result.ok) {
          renderProgressUiState(true, false);
          showProgressMessage('İlerlemeniz kaydedildi.', false);
        } else {
          renderProgressUiState(false, false);
          showProgressMessage('İlerleme kaydedilemedi. Lütfen tekrar deneyin.', true);
        }
      } catch (e) {
        console.warn('[web-lessons-reader] mark completed failed', e);
        renderProgressUiState(false, false);
        showProgressMessage('İlerleme kaydedilemedi. Lütfen tekrar deneyin.', true);
      } finally {
        progressSaveInFlight = false;
      }
    });
  }

  async function setupLessonProgress(categoryId, unitId, unit, catalogMeta) {
    var progressApi = window.SA_WEB_LESSON_PROGRESS;
    if (!progressApi || typeof progressApi.resolveProgressContext !== 'function') {
      return;
    }

    var context = progressApi.resolveProgressContext();
    if (!context || context.kind === 'guest') {
      renderProgressGuestNote();
      return;
    }

    renderProgressUiState(false, false);
    bindProgressAction(categoryId, unitId, unit, catalogMeta, context);

    try {
      var statusResult =
        typeof progressApi.getLessonProgressStatus === 'function'
          ? await progressApi.getLessonProgressStatus(context, categoryId, unitId)
          : { completed: false };
      renderProgressUiState(!!(statusResult && statusResult.completed), false);
    } catch (e) {
      console.warn('[web-lessons-reader] progress status failed', e);
      renderProgressUiState(false, false);
    }
  }

  function renderGuestState(catalogMeta) {
    var loading = $('#lesson-reader-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#lesson-reader-guest-cta');
    if (guestCta) guestCta.hidden = false;

    var blocks = $('#lesson-reader-blocks');
    if (blocks) {
      blocks.hidden = true;
      blocks.innerHTML = '';
    }

    var title = $('#lesson-reader-title');
    if (title && catalogMeta) title.textContent = catalogMeta.title;

    renderProgressGuestNote();
  }

  function showAccessError(catalogMeta) {
    var loading = $('#lesson-reader-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#lesson-reader-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var blocks = $('#lesson-reader-blocks');
    if (blocks) {
      blocks.hidden = true;
      blocks.innerHTML = '';
    }

    var err = $('#lesson-reader-error');
    if (err) {
      err.hidden = false;
      err.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }

    var title = $('#lesson-reader-title');
    if (title && catalogMeta) title.textContent = catalogMeta.title;
  }

  async function refreshReader(categoryId, unitId, catalogMeta) {
    var repo = window.SA_WEB_LESSONS_REPO;
    if (!repo) return;

    var crumbLink = $('#lesson-reader-breadcrumb-category-link');
    if (crumbLink) crumbLink.textContent = (catalogMeta && catalogMeta.title) || 'Ders';

    if (!repo.isAuthenticated()) {
      showAccessError(catalogMeta);
      return;
    }

    var loading = $('#lesson-reader-loading');
    if (loading) loading.hidden = false;

    var result = await repo.loadUnitWithBlocks(categoryId, unitId);
    if (loading) loading.hidden = true;

    if (!result.ok) {
      var err = $('#lesson-reader-error');
      if (err) {
        err.hidden = false;
        err.textContent = result.error || 'Ders içeriği yüklenemedi.';
      }
      return;
    }

    var guestCta = $('#lesson-reader-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var blocksHost = $('#lesson-reader-blocks');
    if (blocksHost) blocksHost.hidden = false;

    var unit = result.unit || {};
    var title = $('#lesson-reader-title');
    if (title) {
      title.textContent = unit.title || 'Ünite';
      title.setAttribute('aria-current', 'page');
    }

    var ytHost = $('#lesson-reader-youtube');
    if (ytHost) {
      var ytHtml = renderYoutubeArea(unit.youtubeUrl);
      if (ytHtml) {
        ytHost.innerHTML = ytHtml;
        ytHost.hidden = false;
      } else {
        ytHost.innerHTML = '';
        ytHost.hidden = true;
      }
    }

    renderBlocks(result.blocks || []);
    setupLessonProgress(categoryId, unitId, unit, catalogMeta);
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-dersler-read')) return;
    initialized = true;

    var catalog = window.SA_WEB_LESSONS_CATALOG;
    var ids = readIdsFromQuery();
    if (!catalog || !catalog.isValidLessonCategoryId(ids.categoryId) || !ids.unitId) {
      renderInvalid();
      return;
    }

    saveNavigation(ids.categoryId, ids.unitId);
    var catalogMeta = catalog.getCategoryById(ids.categoryId);

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
      refreshReader(ids.categoryId, ids.unitId, catalogMeta);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
