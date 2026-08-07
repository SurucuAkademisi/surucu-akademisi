/**
 * Practical Guide — unit reader (gallery layout, prev/next navigation).
 */
(function () {
  'use strict';

  var SESSION_CATEGORY_KEY = 'sa_web_practical_category_id';
  var SESSION_UNIT_KEY = 'sa_web_practical_unit_id';
  var initialized = false;

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

  function readUrlForUnit(categoryId, unitId) {
    return (
      'read.html?categoryId=' + encodeURIComponent(categoryId) + '&unitId=' + encodeURIComponent(unitId)
    );
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

  function findMainImageBlock(blocks) {
    var list = blocks || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === 'image_block' && list[i].type === 'image' && String(list[i].imageUrl || '').trim()) {
        return list[i];
      }
    }
    for (var j = 0; j < list.length; j++) {
      if (list[j].type === 'image' && String(list[j].imageUrl || '').trim()) return list[j];
    }
    return null;
  }

  function findMainTextBlock(blocks) {
    var list = blocks || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === 'short_text' && list[i].type === 'text' && String(list[i].text || '').trim()) {
        return list[i];
      }
    }
    for (var j = 0; j < list.length; j++) {
      if (list[j].type === 'text' && String(list[j].text || '').trim()) return list[j];
    }
    return null;
  }

  function isReservedBlock(block, mainImage, mainText) {
    if (!block) return true;
    if (mainImage && block.id === mainImage.id) return true;
    if (mainText && block.id === mainText.id) return true;
    return false;
  }

  function renderTextBlock(block, altText) {
    var attached = '';
    var attUrl = String(block.imageUrl || '').trim();
    if (attUrl) {
      attached =
        '<div class="lesson-block-attached-media">'
        + '<img class="lesson-image lesson-image--inline practical-block-image" src="' + escapeHtml(attUrl) + '" alt="' + escapeHtml(altText || '') + '" loading="lazy" />'
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
        '<article class="practical-block practical-block--text lesson-block lesson-block--text lesson-block--segments">'
        + '<div class="lesson-text-body lesson-text-body--segments">' + parts + '</div>'
        + attached
        + '</article>'
      );
    }

    var preset = String(block.textPreset || 'normal').trim().toLowerCase();
    if (['normal', 'info', 'warning', 'danger'].indexOf(preset) < 0) preset = 'normal';
    var safeText = escapeHtml(block.text).replace(/\n/g, '<br />');

    return (
      '<article class="practical-block practical-block--text lesson-block lesson-block--text lesson-block--preset-' + escapeHtml(preset) + '">'
      + '<div class="lesson-text-body">' + safeText + '</div>'
      + attached
      + '</article>'
    );
  }

  function renderImageBlock(block, altText, hero) {
    var url = String(block.imageUrl || '').trim();
    if (!url) return '';
    var imgClass = hero ? 'practical-reader-hero__img' : 'lesson-image practical-block-image';
    var wrapClass = hero ? 'practical-reader-hero' : 'practical-block practical-block--image lesson-block lesson-block--image';
    if (hero) {
      return (
        '<section class="' + wrapClass + '">'
        + '<img class="' + imgClass + '" src="' + escapeHtml(url) + '" alt="' + escapeHtml(altText || block.caption || '') + '" loading="lazy" />'
        + (block.caption ? '<p class="practical-reader-hero__caption">' + escapeHtml(block.caption) + '</p>' : '')
        + '</section>'
      );
    }
    return (
      '<article class="' + wrapClass + '">'
      + '<figure class="lesson-figure">'
      + '<img class="' + imgClass + '" src="' + escapeHtml(url) + '" alt="' + escapeHtml(altText || block.caption || '') + '" loading="lazy" />'
      + (block.caption ? '<figcaption class="lesson-image-caption">' + escapeHtml(block.caption) + '</figcaption>' : '')
      + '</figure>'
      + '</article>'
    );
  }

  function renderExplanationCard(block, altText) {
    var segs = normalizeSegments(block.textSegments);
    var inner = '';
    if (segs.length) {
      inner = segs
        .map(function (seg) {
          return '<span class="' + segmentClassList(seg.marks) + '">' + escapeHtml(seg.text) + '</span>';
        })
        .join('');
    } else {
      inner = escapeHtml(block.text).replace(/\n/g, '<br />');
    }
    return (
      '<section class="practical-reader-explanation">'
      + '<h2 class="practical-reader-explanation__label">Açıklama</h2>'
      + '<div class="practical-reader-explanation__body lesson-text-body">' + inner + '</div>'
      + '</section>'
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

  function renderPracticalGallery(unit, blocks) {
    var host = $('#practical-reader-blocks');
    if (!host) return;

    if (!blocks || !blocks.length) {
      host.innerHTML = '<p class="lesson-empty-state">Bu ünitede henüz içerik yok.</p>';
      return;
    }

    var alt = String((unit && unit.title) || '').trim();
    var mainImage = findMainImageBlock(blocks);
    var mainText = findMainTextBlock(blocks);
    var html = '';

    if (mainImage) {
      html += renderImageBlock(mainImage, alt, true);
    }
    if (mainText) {
      html += renderExplanationCard(mainText, alt);
    }

    blocks.forEach(function (block) {
      if (isReservedBlock(block, mainImage, mainText)) return;
      if (block.type === 'image') {
        var imgHtml = renderImageBlock(block, alt, false);
        if (imgHtml) html += imgHtml;
      } else {
        html += renderTextBlock(block, alt);
      }
    });

    if (!html.trim()) {
      host.innerHTML = '<p class="lesson-empty-state">Bu ünitede henüz içerik yok.</p>';
      return;
    }

    host.innerHTML = html;
  }

  function renderPrevNextNav(categoryId, units, currentUnitId) {
    var nav = $('#practical-reader-prev-next');
    if (!nav) return;

    var list = Array.isArray(units) ? units : [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === currentUnitId) {
        idx = i;
        break;
      }
    }

    if (idx < 0 || list.length < 2) {
      nav.hidden = true;
      nav.innerHTML = '';
      return;
    }

    var prevUnit = idx > 0 ? list[idx - 1] : null;
    var nextUnit = idx < list.length - 1 ? list[idx + 1] : null;

    nav.hidden = false;
    nav.innerHTML =
      '<div class="practical-reader-nav">'
      + '<button type="button" class="practical-reader-nav__btn practical-reader-nav__btn--prev" id="practical-reader-prev-btn"'
      + (prevUnit ? '' : ' disabled')
      + '>'
      + '<span class="practical-reader-nav__dir">Önceki</span>'
      + (prevUnit ? '<span class="practical-reader-nav__title">' + escapeHtml(prevUnit.title) + '</span>' : '')
      + '</button>'
      + '<span class="practical-reader-nav__pos">' + (idx + 1) + ' / ' + list.length + '</span>'
      + '<button type="button" class="practical-reader-nav__btn practical-reader-nav__btn--next" id="practical-reader-next-btn"'
      + (nextUnit ? '' : ' disabled')
      + '>'
      + '<span class="practical-reader-nav__dir">Sonraki</span>'
      + (nextUnit ? '<span class="practical-reader-nav__title">' + escapeHtml(nextUnit.title) + '</span>' : '')
      + '</button>'
      + '</div>';

    var prevBtn = $('#practical-reader-prev-btn');
    var nextBtn = $('#practical-reader-next-btn');
    if (prevBtn && prevUnit) {
      prevBtn.onclick = function () {
        saveNavigation(categoryId, prevUnit.id);
        window.location.href = readUrlForUnit(categoryId, prevUnit.id);
      };
    }
    if (nextBtn && nextUnit) {
      nextBtn.onclick = function () {
        saveNavigation(categoryId, nextUnit.id);
        window.location.href = readUrlForUnit(categoryId, nextUnit.id);
      };
    }
  }

  function renderInvalid() {
    var main = $('.practical-reader-main');
    if (main) main.hidden = true;
    var err = $('#practical-reader-invalid');
    if (err) err.hidden = false;
  }

  function renderGuestState(catalogMeta) {
    var loading = $('#practical-reader-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#practical-reader-guest-cta');
    if (guestCta) guestCta.hidden = false;

    var blocks = $('#practical-reader-blocks');
    if (blocks) {
      blocks.hidden = true;
      blocks.innerHTML = '';
    }

    var nav = $('#practical-reader-prev-next');
    if (nav) {
      nav.hidden = true;
      nav.innerHTML = '';
    }

    var title = $('#practical-reader-title');
    if (title && catalogMeta) title.textContent = catalogMeta.title;
  }

  function showAccessError(catalogMeta) {
    var loading = $('#practical-reader-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#practical-reader-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var blocks = $('#practical-reader-blocks');
    if (blocks) {
      blocks.hidden = true;
      blocks.innerHTML = '';
    }

    var nav = $('#practical-reader-prev-next');
    if (nav) {
      nav.hidden = true;
      nav.innerHTML = '';
    }

    var err = $('#practical-reader-error');
    if (err) {
      err.hidden = false;
      err.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }

    var title = $('#practical-reader-title');
    if (title && catalogMeta) title.textContent = catalogMeta.title;
  }

  async function refreshReader(categoryId, unitId, catalogMeta) {
    var repo = window.SA_WEB_PRACTICAL_REPO;
    if (!repo) return;

    var crumbLink = $('#practical-reader-breadcrumb-category-link');
    if (crumbLink) crumbLink.textContent = (catalogMeta && catalogMeta.title) || 'Rehber';

    if (!repo.isAuthenticated()) {
      showAccessError(catalogMeta);
      return;
    }

    var loading = $('#practical-reader-loading');
    if (loading) loading.hidden = false;

    var unitsPromise = repo.getUnits(categoryId);
    var unitResult = await repo.getUnit(categoryId, unitId);
    if (!unitResult.ok) {
      if (loading) loading.hidden = true;
      var err = $('#practical-reader-error');
      if (err) {
        err.hidden = false;
        err.textContent = unitResult.error || 'İçerik yüklenemedi.';
      }
      return;
    }

    var blocksResult = await repo.getBlocks(categoryId, unitId);
    var unitsResult = await unitsPromise;
    if (loading) loading.hidden = true;

    if (!blocksResult.ok) {
      var errBlocks = $('#practical-reader-error');
      if (errBlocks) {
        errBlocks.hidden = false;
        errBlocks.textContent = blocksResult.error || 'İçerik yüklenemedi.';
      }
      return;
    }

    var guestCta = $('#practical-reader-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var errEl = $('#practical-reader-error');
    if (errEl) errEl.hidden = true;

    var blocksHost = $('#practical-reader-blocks');
    if (blocksHost) blocksHost.hidden = false;

    var unit = unitResult.unit || {};
    var title = $('#practical-reader-title');
    if (title) {
      title.textContent = unit.title || 'Ünite';
      title.setAttribute('aria-current', 'page');
    }

    var ytHost = $('#practical-reader-youtube');
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

    renderPracticalGallery(unit, blocksResult.blocks || []);

    if (unitsResult.ok) {
      renderPrevNextNav(categoryId, unitsResult.units || [], unitId);
    }
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-pratik-rehber-read')) return;
    initialized = true;

    var catalog = window.SA_WEB_PRACTICAL_CATALOG;
    var ids = readIdsFromQuery();
    if (!catalog || !catalog.isPracticalCategoryId(ids.categoryId) || !ids.unitId) {
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
