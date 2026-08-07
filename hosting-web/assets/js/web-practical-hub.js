/**
 * Practical Guide hub — category cards.
 */
(function () {
  'use strict';

  var SESSION_CATEGORY_KEY = 'sa_web_practical_category_id';
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

  function unitsUrlForCategory(categoryId) {
    var id = String(categoryId || '').trim();
    try {
      var target = new URL('./units.html', window.location.href);
      target.searchParams.set('categoryId', id);
      return target.href;
    } catch (_) {
      return 'units.html?categoryId=' + encodeURIComponent(id);
    }
  }

  function saveCategoryNavigation(categoryId) {
    try {
      sessionStorage.setItem(SESSION_CATEGORY_KEY, String(categoryId || '').trim());
    } catch (_) {}
  }

  function accentClass(accent) {
    var a = String(accent || 'orange').trim().toLowerCase();
    return 'practical-category-card--' + a;
  }

  function setBadge(card, text, modifier) {
    var badge = card && card.querySelector('.practical-category-card__badge');
    if (!badge) return;
    badge.textContent = text;
    badge.classList.remove(
      'practical-category-card__badge--active',
      'practical-category-card__badge--guest',
      'practical-category-card__badge--empty'
    );
    if (modifier) badge.classList.add(modifier);
  }

  function bindCategoryCard(card, categoryId) {
    card.classList.add('practical-category-card--clickable');
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    setBadge(card, 'Üniteleri Gör', 'practical-category-card__badge--active');

    function go() {
      saveCategoryNavigation(categoryId);
      window.location.href = unitsUrlForCategory(categoryId);
    }

    card.onclick = go;
    card.onkeydown = function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        go();
      }
    };
  }

  function renderStaticCards(catalog, guestMode) {
    var grid = $('#practical-hub-grid');
    if (!grid || !catalog || !catalog.categories) return;

    grid.innerHTML = catalog.categories
      .slice()
      .sort(function (a, b) {
        return Number(a.order || 0) - Number(b.order || 0);
      })
      .map(function (cat) {
        return (
          '<article class="practical-category-card ' + accentClass(cat.accent) + '" data-category-id="' + escapeHtml(cat.id) + '">'
          + '<h2 class="practical-category-card__title">' + escapeHtml(cat.title) + '</h2>'
          + '<p class="practical-category-card__desc">' + escapeHtml(cat.description) + '</p>'
          + '<span class="practical-category-card__badge">' + (guestMode ? 'Giriş Gerekli' : 'Yükleniyor…') + '</span>'
          + '</article>'
        );
      })
      .join('');

    if (guestMode) {
      $all('.practical-category-card[data-category-id]', grid).forEach(function (card) {
        setBadge(card, 'Giriş Gerekli', 'practical-category-card__badge--guest');
      });
    }
  }

  function renderGuestState(catalog) {
    var grid = $('#practical-hub-grid');
    if (grid) grid.classList.add('practical-hub-grid--guest');

    var guestCta = $('#practical-hub-guest-cta');
    if (guestCta) guestCta.hidden = false;

    renderStaticCards(catalog, true);
  }

  function renderAuthenticatedState(categories) {
    var grid = $('#practical-hub-grid');
    if (grid) grid.classList.remove('practical-hub-grid--guest');

    var guestCta = $('#practical-hub-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var catalog = window.SA_WEB_PRACTICAL_CATALOG;
    var activeById = {};
    (categories || []).forEach(function (c) {
      activeById[c.id] = c;
    });

    renderStaticCards(catalog, false);

    $all('.practical-category-card[data-category-id]', grid).forEach(function (card) {
      var id = card.getAttribute('data-category-id');
      var row = activeById[id];
      var fb = catalog && catalog.getCategoryById ? catalog.getCategoryById(id) : null;
      if (!row && fb) {
        row = { id: id, title: fb.title, description: fb.description };
      }
      if (!row) {
        card.classList.remove('practical-category-card--clickable');
        setBadge(card, 'Yakında', 'practical-category-card__badge--empty');
        return;
      }
      var titleEl = card.querySelector('.practical-category-card__title');
      if (titleEl && row.title) titleEl.textContent = row.title;
      bindCategoryCard(card, id);
    });
  }

  function showAccessError(catalog) {
    var guestCta = $('#practical-hub-guest-cta');
    if (guestCta) guestCta.hidden = true;
    if (catalog) renderStaticCards(catalog, false);
    var status = $('#practical-hub-status');
    if (status) {
      status.hidden = false;
      status.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }
  }

  async function refreshHub() {
    var repo = window.SA_WEB_PRACTICAL_REPO;
    var catalog = window.SA_WEB_PRACTICAL_CATALOG;
    if (!repo || !catalog) return;

    if (!repo.isAuthenticated()) {
      showAccessError(catalog);
      return;
    }

    renderStaticCards(catalog, false);
    $all('.practical-category-card[data-category-id]').forEach(function (card) {
      setBadge(card, 'Yükleniyor…', null);
    });

    var result = await repo.getCategories();
    if (!result.ok) {
      var status = $('#practical-hub-status');
      if (status) {
        status.hidden = false;
        status.textContent = result.error || 'Kategoriler yüklenemedi.';
      }
      renderAuthenticatedState(catalog.categories.map(function (c) {
        return { id: c.id, title: c.title, description: c.description, order: c.order, status: 'active' };
      }));
      return;
    }

    var status = $('#practical-hub-status');
    if (status) status.hidden = true;

    renderAuthenticatedState(result.categories || []);
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-pratik-rehber')) return;
    if (!$('#practical-hub-grid')) return;
    initialized = true;

    var catalog = window.SA_WEB_PRACTICAL_CATALOG;
    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showAccessError(catalog);
      return;
    }
    viewer.whenReady().then(function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showAccessError(catalog);
        return;
      }
      if (ctx.kind === 'guest') {
        renderGuestState(catalog);
        return;
      }
      refreshHub();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
