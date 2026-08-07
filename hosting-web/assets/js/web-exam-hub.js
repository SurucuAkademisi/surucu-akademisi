/**
 * Çıkmış sorular hub — category counts and navigation (metadata only).
 */
(function () {
  'use strict';

  var authReady = false;
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

  function setBadge(card, text, modifier) {
    var badge = card && card.querySelector('.exam-category-badge');
    if (!badge) return;
    badge.textContent = text;
    badge.classList.remove('exam-category-badge--active', 'exam-category-badge--guest', 'exam-category-badge--empty');
    if (modifier) badge.classList.add(modifier);
  }

  function setCountLine(card, text) {
    var el = card && card.querySelector('.exam-category-card__count');
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  var SESSION_CATEGORY_KEY = 'sa_web_exam_list_category';

  function listUrlForCategory(key) {
    var categoryKey = String(key || '').trim().toLowerCase();
    try {
      var target = new URL('./list.html', window.location.href);
      target.searchParams.set('category', categoryKey);
      return target.href;
    } catch (_) {
      return 'list.html?category=' + encodeURIComponent(categoryKey);
    }
  }

  function saveCategoryForListNavigation(categoryKey) {
    try {
      sessionStorage.setItem(SESSION_CATEGORY_KEY, String(categoryKey || '').trim().toLowerCase());
    } catch (_) {}
  }

  function renderGuestState() {
    var grid = $('.exam-category-grid');
    if (grid) grid.classList.add('exam-category-grid--guest');

    var guestCta = $('#exam-hub-guest-cta');
    if (guestCta) guestCta.hidden = false;

    var accessStatus = $('#exam-hub-access-status');
    if (accessStatus) {
      accessStatus.hidden = true;
      accessStatus.setAttribute('aria-hidden', 'true');
    }

    var heroNote = $('.exam-hub-hero__note');
    if (heroNote) {
      heroNote.textContent = 'Sınav listelerini görmek için üye girişi yapın veya kayıt olun.';
    }

    $all('.exam-category-card[data-category-key]').forEach(function (card) {
      card.classList.remove('exam-category-card--clickable');
      card.removeAttribute('tabindex');
      card.removeAttribute('role');
      card.onclick = null;
      setBadge(card, 'Giriş Gerekli', 'exam-category-badge--guest');
      setCountLine(card, '');
    });
  }

  function showAccessError() {
    var guestCta = $('#exam-hub-guest-cta');
    if (guestCta) guestCta.hidden = true;
    var accessStatus = $('#exam-hub-access-status');
    if (accessStatus) {
      accessStatus.hidden = false;
      accessStatus.setAttribute('aria-hidden', 'false');
      accessStatus.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }
    $all('.exam-category-card[data-category-key]').forEach(function (card) {
      card.classList.remove('exam-category-card--clickable');
      setBadge(card, '—', null);
      setCountLine(card, '');
    });
  }

  function bindCategoryCard(card, key, count) {
    card.classList.add('exam-category-card--clickable');
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');

    if (count > 0) {
      setBadge(card, 'Sınavları Gör', 'exam-category-badge--active');
      setCountLine(card, count === 1 ? '1 sınav aktif' : count + ' sınav aktif');
    } else {
      setBadge(card, 'Yakında', 'exam-category-badge--empty');
      setCountLine(card, 'Henüz yayınlanmış sınav yok');
    }

    function go() {
      saveCategoryForListNavigation(key);
      window.location.href = listUrlForCategory(key);
    }

    card.onclick = go;
    card.onkeydown = function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        go();
      }
    };
  }

  function renderAuthenticatedState(grouped) {
    var grid = $('.exam-category-grid');
    if (grid) grid.classList.remove('exam-category-grid--guest');

    var guestCta = $('#exam-hub-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var accessStatus = $('#exam-hub-access-status');
    if (accessStatus) {
      accessStatus.hidden = true;
      accessStatus.setAttribute('aria-hidden', 'true');
    }

    var heroNote = $('.exam-hub-hero__note');
    if (heroNote) {
      heroNote.textContent = 'Yayınlanmış sınav listelerine kategorilerden ulaşabilirsiniz. Çözüm ekranı yakında aktif edilecektir.';
    }

    var catalog = window.SA_WEB_EXAM_CATALOG;
    var cats = catalog && catalog.categories ? catalog.categories : [];

    cats.forEach(function (cat) {
      var card = $('.exam-category-card[data-category-key="' + cat.key + '"]');
      if (!card) return;
      var list = (grouped && grouped[cat.key]) ? grouped[cat.key] : [];
      bindCategoryCard(card, cat.key, list.length);
    });
  }

  function renderLoadingState() {
    $all('.exam-category-card[data-category-key]').forEach(function (card) {
      card.classList.remove('exam-category-card--clickable');
      setBadge(card, 'Yükleniyor…', null);
      setCountLine(card, '');
    });
  }

  async function refreshHub() {
    var repo = window.SA_WEB_EXAM_REPO;
    if (!repo) return;

    if (!repo.isAuthenticated()) {
      showAccessError();
      return;
    }

    renderLoadingState();
    var result = await repo.loadPublishedExams();
    if (!result.ok) {
      $all('.exam-category-card[data-category-key]').forEach(function (card) {
        setBadge(card, 'Yüklenemedi', null);
        setCountLine(card, result.error || '');
      });
      return;
    }

    renderAuthenticatedState(result.grouped || {});
  }

  function init() {
    if (initialized) return;
    if (!document.body || !document.body.classList.contains('page-cikmis-sorular')) return;
    if (!$('.exam-category-grid')) return;
    initialized = true;

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showAccessError();
      return;
    }

    viewer.whenReady().then(function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showAccessError();
        return;
      }
      if (ctx.kind === 'guest') {
        renderGuestState();
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

  window.SA_WEB_EXAM_HUB = {
    refresh: refreshHub
  };
})();
