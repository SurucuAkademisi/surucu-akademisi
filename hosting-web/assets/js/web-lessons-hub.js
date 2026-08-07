/**
 * Dersler hub — lesson book category cards.
 */
(function () {
  'use strict';

  var SESSION_CATEGORY_KEY = 'sa_web_lesson_category_id';
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
    var a = String(accent || 'cyan').trim().toLowerCase();
    return 'lesson-book-card--' + a;
  }

  function setBadge(card, text, modifier) {
    var badge = card && card.querySelector('.lesson-book-card__badge');
    if (!badge) return;
    badge.textContent = text;
    badge.classList.remove('lesson-book-card__badge--active', 'lesson-book-card__badge--guest', 'lesson-book-card__badge--empty');
    if (modifier) badge.classList.add(modifier);
  }

  function bindBookCard(card, categoryId) {
    card.classList.add('lesson-book-card--clickable');
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    setBadge(card, 'Üniteleri Gör', 'lesson-book-card__badge--active');

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

  function renderGuestState(catalog) {
    var grid = $('#lesson-book-grid');
    if (grid) grid.classList.add('lesson-book-grid--guest');

    var guestCta = $('#lessons-hub-guest-cta');
    if (guestCta) guestCta.hidden = false;

    var heroNote = $('.lesson-hub-hero__note');
    if (heroNote) {
      heroNote.textContent = 'Ders kitaplarını görmek için üye girişi yapın veya kayıt olun.';
    }

    renderStaticCards(catalog, true);
  }

  function renderStaticCards(catalog, guestMode) {
    var grid = $('#lesson-book-grid');
    if (!grid || !catalog || !catalog.categories) return;

    grid.innerHTML = catalog.categories
      .slice()
      .sort(function (a, b) {
        return Number(a.order || 0) - Number(b.order || 0);
      })
      .map(function (cat) {
        var noteHtml = cat.id === 'is_makineleri'
          ? '<p class="lesson-book-card__note web-lesson-category-note">Sadece operatörlük sınavına girecek adaylar içindir.</p>'
          : '';
        return (
          '<article class="lesson-book-card ' + accentClass(cat.accent) + '" data-category-id="' + escapeHtml(cat.id) + '">'
          + '<h2 class="lesson-book-card__title">' + escapeHtml(cat.title) + '</h2>'
          + '<p class="lesson-book-card__desc">' + escapeHtml(cat.description) + '</p>'
          + noteHtml
          + '<span class="lesson-book-card__badge">' + (guestMode ? 'Giriş Gerekli' : 'Yükleniyor…') + '</span>'
          + '</article>'
        );
      })
      .join('');

    if (guestMode) {
      $all('.lesson-book-card[data-category-id]', grid).forEach(function (card) {
        setBadge(card, 'Giriş Gerekli', 'lesson-book-card__badge--guest');
      });
    }
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function renderAuthenticatedState(categories) {
    var grid = $('#lesson-book-grid');
    if (grid) grid.classList.remove('lesson-book-grid--guest');

    var guestCta = $('#lessons-hub-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var heroNote = $('.lesson-hub-hero__note');
    if (heroNote) {
      heroNote.textContent = 'Beş ders kitabından birini seçerek ünite listesine geçin.';
    }

    var catalog = window.SA_WEB_LESSONS_CATALOG;
    var activeById = {};
    (categories || []).forEach(function (c) {
      activeById[c.id] = c;
    });

    renderStaticCards(catalog, false);

    $all('.lesson-book-card[data-category-id]', grid).forEach(function (card) {
      var id = card.getAttribute('data-category-id');
      var row = activeById[id];
      if (!row) {
        card.classList.remove('lesson-book-card--clickable');
        setBadge(card, 'Yakında', 'lesson-book-card__badge--empty');
        return;
      }
      var titleEl = card.querySelector('.lesson-book-card__title');
      if (titleEl && row.title) titleEl.textContent = row.title;
      bindBookCard(card, id);
    });
  }

  async function refreshHub() {
    var repo = window.SA_WEB_LESSONS_REPO;
    var catalog = window.SA_WEB_LESSONS_CATALOG;
    if (!repo || !catalog) return;

    if (!repo.isAuthenticated()) {
      showAccessError(catalog);
      return;
    }

    renderStaticCards(catalog, false);
    $all('.lesson-book-card[data-category-id]').forEach(function (card) {
      setBadge(card, 'Yükleniyor…', null);
    });

    var result = await repo.loadLessonCategories();
    if (!result.ok) {
      var status = $('#lessons-hub-status');
      if (status) {
        status.hidden = false;
        status.textContent = result.error || 'Ders kitapları yüklenemedi.';
      }
      return;
    }

    var statusOk = $('#lessons-hub-status');
    if (statusOk) statusOk.hidden = true;

    renderAuthenticatedState(result.categories || []);
  }

  function showAccessError(catalog) {
    var guestCta = $('#lessons-hub-guest-cta');
    if (guestCta) guestCta.hidden = true;
    if (catalog) renderStaticCards(catalog, false);
    var status = $('#lessons-hub-status');
    if (status) {
      status.hidden = false;
      status.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-dersler')) return;
    if (!$('#lesson-book-grid')) return;
    initialized = true;

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showAccessError(window.SA_WEB_LESSONS_CATALOG);
      return;
    }
    viewer.whenReady().then(function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showAccessError(window.SA_WEB_LESSONS_CATALOG);
        return;
      }
      if (ctx.kind === 'guest') {
        renderGuestState(window.SA_WEB_LESSONS_CATALOG);
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
