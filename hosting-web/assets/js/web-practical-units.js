/**
 * Practical Guide — unit list per category.
 */
(function () {
  'use strict';

  var SESSION_CATEGORY_KEY = 'sa_web_practical_category_id';
  var SESSION_UNIT_KEY = 'sa_web_practical_unit_id';
  var TRAFFIC_SIGNS_CATEGORY_ID = 'traffic_signs_practical';
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

  function readQueryParam(name) {
    try {
      var params = new URLSearchParams(window.location.search);
      return String(params.get(name) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function readCategoryIdFromQuery() {
    var q = readQueryParam('categoryId');
    if (q) return q;
    try {
      return String(sessionStorage.getItem(SESSION_CATEGORY_KEY) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function readGroupIdFromQuery() {
    return readQueryParam('groupId');
  }

  function saveCategoryNavigation(categoryId) {
    try {
      sessionStorage.setItem(SESSION_CATEGORY_KEY, String(categoryId || '').trim());
    } catch (_) {}
  }

  function unitsUrl(categoryId, groupId) {
    try {
      var target = new URL('./units.html', window.location.href);
      target.searchParams.set('categoryId', categoryId);
      if (groupId) target.searchParams.set('groupId', groupId);
      else target.searchParams.delete('groupId');
      return target.href;
    } catch (_) {
      var base = 'units.html?categoryId=' + encodeURIComponent(categoryId);
      if (groupId) base += '&groupId=' + encodeURIComponent(groupId);
      return base;
    }
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

  function getTrafficSignsGroups() {
    var catalog = window.SA_WEB_PRACTICAL_CATALOG;
    if (catalog && Array.isArray(catalog.TRAFFIC_SIGNS_PRACTICAL_GROUPS)) {
      return catalog.TRAFFIC_SIGNS_PRACTICAL_GROUPS.slice();
    }
    return [
      {
        id: 'danger_warning',
        title: 'Tehlike Uyarı ve İşaretleri',
        icon: '⚠️',
        accent: 'amber',
        desc: 'Bu kategorideki trafik levhalarını inceleyin.'
      },
      {
        id: 'traffic_regulation',
        title: 'Trafik Tanzim İşaretleri',
        icon: '🚦',
        accent: 'violet',
        desc: 'Bu kategorideki trafik levhalarını inceleyin.'
      },
      {
        id: 'information_signs',
        title: 'Bilgi İşaretleri',
        icon: 'ℹ️',
        accent: 'cyan',
        desc: 'Bu kategorideki trafik levhalarını inceleyin.'
      },
      {
        id: 'parking_stopping',
        title: 'Duraklama ve Park Etme İşaretleri',
        icon: '🅿️',
        accent: 'orange',
        desc: 'Bu kategorideki trafik levhalarını inceleyin.'
      },
      {
        id: 'highway_signs',
        title: 'Otoyol İşaretleri',
        icon: '🛣️',
        accent: 'blue',
        desc: 'Bu kategorideki trafik levhalarını inceleyin.'
      }
    ];
  }

  function resolveGroupUi(group) {
    var g = group || {};
    var accent = String(g.accent || '').trim().toLowerCase();
    if (
      accent !== 'amber' &&
      accent !== 'violet' &&
      accent !== 'cyan' &&
      accent !== 'orange' &&
      accent !== 'blue'
    ) {
      accent = 'cyan';
    }
    return {
      id: String(g.id || '').trim(),
      title: String(g.title || g.id || '').trim(),
      icon: String(g.icon || '◆').trim() || '◆',
      accent: accent,
      desc: String(g.desc || 'Bu kategorideki trafik levhalarını inceleyin.').trim()
    };
  }

  function getTrafficSignsGroupById(groupId) {
    var catalog = window.SA_WEB_PRACTICAL_CATALOG;
    if (catalog && typeof catalog.getTrafficSignsGroupById === 'function') {
      return catalog.getTrafficSignsGroupById(groupId);
    }
    var gid = String(groupId || '').trim();
    var groups = getTrafficSignsGroups();
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === gid) return groups[i];
    }
    return null;
  }

  function isTrafficSignsCategory(categoryId) {
    var catalog = window.SA_WEB_PRACTICAL_CATALOG;
    if (catalog && typeof catalog.isTrafficSignsPracticalCategoryId === 'function') {
      return catalog.isTrafficSignsPracticalCategoryId(categoryId);
    }
    return String(categoryId || '').trim() === TRAFFIC_SIGNS_CATEGORY_ID;
  }

  function knownGroupIdSet() {
    var set = {};
    getTrafficSignsGroups().forEach(function (g) {
      set[g.id] = true;
    });
    return set;
  }

  function countOrphanTrafficUnits(units) {
    var known = knownGroupIdSet();
    var n = 0;
    (units || []).forEach(function (u) {
      var gid = String((u && u.groupId) || '').trim();
      if (!gid || !known[gid]) n++;
    });
    return n;
  }

  function filterUnitsByGroup(units, groupId) {
    var gid = String(groupId || '').trim();
    return (units || []).filter(function (u) {
      return String((u && u.groupId) || '').trim() === gid;
    });
  }

  function setHeroCopy(titleText, introText) {
    var title = $('#practical-units-category-title');
    if (title) {
      title.textContent = titleText || 'Pratik Rehber Üniteleri';
      title.setAttribute('aria-current', 'page');
    }
    var intro = $('#practical-units-intro');
    if (intro && introText != null) intro.textContent = introText;
  }

  function hidePanel(el) {
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
  }

  function clearStatusPanels() {
    var empty = $('#practical-units-empty');
    if (empty) {
      empty.hidden = true;
      empty.textContent = '';
    }
    var err = $('#practical-units-error');
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
  }

  function renderInvalidCategory() {
    var main = $('.practical-units-main');
    if (main) main.hidden = true;
    var err = $('#practical-units-invalid');
    if (err) err.hidden = false;
  }

  function renderGuestState(catalogMeta) {
    var loading = $('#practical-units-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#practical-units-guest-cta');
    if (guestCta) guestCta.hidden = false;

    hidePanel($('#practical-unit-list'));
    hidePanel($('#practical-sign-groups'));
    hidePanel($('#practical-sign-group-toolbar'));

    if (catalogMeta) setHeroCopy(catalogMeta.title, null);
  }

  function renderBackToGroupsControl(categoryId) {
    var toolbar = $('#practical-sign-group-toolbar');
    if (!toolbar) return;
    toolbar.hidden = false;
    toolbar.innerHTML =
      '<button type="button" class="practical-sign-group-back" id="practical-sign-group-back-btn">'
      + '← Kategorilere Dön'
      + '</button>';
    var btn = $('#practical-sign-group-back-btn');
    if (btn) {
      btn.onclick = function () {
        window.location.href = unitsUrl(categoryId, '');
      };
    }
  }

  function hideBackToGroupsControl() {
    hidePanel($('#practical-sign-group-toolbar'));
  }

  function renderTrafficSignGroups(categoryId, units) {
    var loading = $('#practical-units-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#practical-units-guest-cta');
    if (guestCta) guestCta.hidden = true;

    clearStatusPanels();
    hidePanel($('#practical-unit-list'));
    hideBackToGroupsControl();

    var orphanCount = countOrphanTrafficUnits(units);
    if (orphanCount > 0) {
      try {
        console.warn(
          '[Pratik Rehber] Trafik işareti groupId eşleşmeyen levha sayısı: ' + orphanCount
        );
      } catch (_) {}
    }

    setHeroCopy(
      'KARAYOLLARI STANDART TRAFİK İŞARET LEVHALARI',
      'Bir kategori seçerek o gruptaki trafik levhalarını inceleyin.'
    );

    var host = $('#practical-sign-groups');
    if (!host) return;

    var groups = getTrafficSignsGroups();
    host.hidden = false;
    host.innerHTML = groups
      .map(function (raw) {
        var g = resolveGroupUi(raw);
        var count = filterUnitsByGroup(units, g.id).length;
        var countLabel = count > 0 ? String(count) + ' işaret' : 'Henüz işaret yok';
        return (
          '<button type="button"'
          + ' class="practical-sign-group-card practical-sign-group-card--' + escapeHtml(g.accent) + '"'
          + ' data-group-id="' + escapeHtml(g.id) + '">'
          + '<span class="practical-sign-group-icon" aria-hidden="true">' + escapeHtml(g.icon) + '</span>'
          + '<span class="practical-sign-group-copy">'
          + '<span class="practical-sign-group-title">' + escapeHtml(g.title) + '</span>'
          + '<span class="practical-sign-group-desc">' + escapeHtml(g.desc) + '</span>'
          + '<span class="practical-sign-group-count">' + escapeHtml(countLabel) + '</span>'
          + '</span>'
          + '<span class="practical-sign-group-cta">İncele</span>'
          + '</button>'
        );
      })
      .join('');

    $all('.practical-sign-group-card[data-group-id]', host).forEach(function (card) {
      var gid = card.getAttribute('data-group-id');
      card.onclick = function () {
        window.location.href = unitsUrl(categoryId, gid);
      };
    });
  }

  function renderUnknownGroupState(categoryId) {
    var loading = $('#practical-units-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#practical-units-guest-cta');
    if (guestCta) guestCta.hidden = true;

    hidePanel($('#practical-unit-list'));
    hidePanel($('#practical-sign-groups'));
    clearStatusPanels();

    setHeroCopy('Kategori bulunamadı', 'Geçersiz veya desteklenmeyen trafik işareti kategorisi.');
    renderBackToGroupsControl(categoryId);

    var empty = $('#practical-units-empty');
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'Bu kategori bulunamadı. Lütfen kategorilere dönüp tekrar seçin.';
    }
  }

  function renderUnits(categoryId, units, opts) {
    opts = opts || {};
    var loading = $('#practical-units-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#practical-units-guest-cta');
    if (guestCta) guestCta.hidden = true;

    hidePanel($('#practical-sign-groups'));
    clearStatusPanels();

    if (opts.showBackToGroups) {
      renderBackToGroupsControl(categoryId);
    } else {
      hideBackToGroupsControl();
    }

    if (opts.heroTitle) {
      setHeroCopy(opts.heroTitle, opts.heroIntro || 'Bu kategorideki yayınlanmış üniteler aşağıda listelenir. Okumak için bir ünite seçin.');
    }

    var list = $('#practical-unit-list');
    if (!list) return;

    if (!units.length) {
      list.hidden = true;
      list.innerHTML = '';
      var empty = $('#practical-units-empty');
      if (empty) {
        empty.hidden = false;
        empty.textContent = opts.emptyMessage || 'Bu kategoride henüz yayında ünite yok.';
      }
      return;
    }

    var emptyEl = $('#practical-units-empty');
    if (emptyEl) emptyEl.hidden = true;

    list.hidden = false;
    list.innerHTML = units
      .map(function (unit, index) {
        var previewUrl = String(unit.previewImageUrl || '').trim();
        var previewText = String(unit.previewText || '').trim();
        var mediaHtml = previewUrl
          ? '<div class="practical-unit-card__thumb"><img src="' + escapeHtml(previewUrl) + '" alt="" loading="lazy" /></div>'
          : '<div class="practical-unit-card__thumb practical-unit-card__thumb--placeholder" aria-hidden="true"><span class="practical-unit-card__thumb-icon">🖼</span></div>';
        var descHtml = previewText
          ? '<p class="practical-unit-card__preview">' + escapeHtml(previewText) + '</p>'
          : '';
        return (
          '<article class="practical-unit-card" data-unit-id="' + escapeHtml(unit.id) + '" role="link" tabindex="0">'
          + '<span class="practical-unit-card__index">' + (index + 1) + '</span>'
          + mediaHtml
          + '<div class="practical-unit-card__body">'
          + '<h2 class="practical-unit-card__title">' + escapeHtml(unit.title) + '</h2>'
          + descHtml
          + '</div>'
          + '<span class="practical-unit-card__cta">Oku</span>'
          + '</article>'
        );
      })
      .join('');

    $all('.practical-unit-card[data-unit-id]', list).forEach(function (card) {
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
    var loading = $('#practical-units-loading');
    if (loading) loading.hidden = true;

    var guestCta = $('#practical-units-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var err = $('#practical-units-error');
    if (err) {
      err.hidden = false;
      err.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }

    if (catalogMeta) setHeroCopy(catalogMeta.title, null);
  }

  async function refreshUnits(categoryId, catalogMeta) {
    var repo = window.SA_WEB_PRACTICAL_REPO;
    if (!repo) return;

    var groupId = readGroupIdFromQuery();
    var isTraffic = isTrafficSignsCategory(categoryId);

    if (catalogMeta && !isTraffic) {
      setHeroCopy(
        catalogMeta.title,
        'Bu kategorideki yayınlanmış üniteler aşağıda listelenir. Okumak için bir ünite seçin.'
      );
    }

    if (!repo.isAuthenticated()) {
      showAccessError(catalogMeta);
      return;
    }

    var loading = $('#practical-units-loading');
    if (loading) loading.hidden = false;

    var result = await repo.getUnits(categoryId);
    if (!result.ok) {
      if (loading) loading.hidden = true;
      var err = $('#practical-units-error');
      if (err) {
        err.hidden = false;
        err.textContent = result.error || 'Üniteler yüklenemedi.';
      }
      return;
    }

    var units = result.units || [];

    if (isTraffic && groupId && !getTrafficSignsGroupById(groupId)) {
      renderUnknownGroupState(categoryId);
      return;
    }

    if (isTraffic && !groupId) {
      renderTrafficSignGroups(categoryId, units);
      return;
    }

    var displayUnits = units;
    if (isTraffic && groupId) {
      displayUnits = filterUnitsByGroup(units, groupId);
    }

    if (typeof repo.enrichUnitsWithPreviews === 'function' && displayUnits.length) {
      try {
        displayUnits = await repo.enrichUnitsWithPreviews(categoryId, displayUnits);
      } catch (e) {
        console.warn('[web-practical-units] preview enrich failed', e);
      }
    }

    if (isTraffic && groupId) {
      var groupMeta = getTrafficSignsGroupById(groupId);
      renderUnits(categoryId, displayUnits, {
        showBackToGroups: true,
        heroTitle: groupMeta ? groupMeta.title : groupId,
        heroIntro: 'Bu kategorideki trafik levhaları aşağıda listelenir. Okumak için bir levha seçin.',
        emptyMessage: 'Bu kategoride henüz yayında levha yok.'
      });
      return;
    }

    renderUnits(categoryId, displayUnits, {
      showBackToGroups: false,
      heroTitle: (catalogMeta && catalogMeta.title) || categoryId
    });
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-pratik-rehber-units')) return;
    initialized = true;

    var catalog = window.SA_WEB_PRACTICAL_CATALOG;
    var categoryId = readCategoryIdFromQuery();
    if (!catalog || !catalog.isPracticalCategoryId(categoryId)) {
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
