/**
 * Teacher Video Lessons — hub and category list (read-only).
 */
(function () {
  'use strict';

  var hubInitialized = false;
  var listInitialized = false;

  var CARD_VIDEO_LINK_MESSAGE =
    'Bu videonun YouTube bağlantısı okunamadı. Admin panelden video linkini kontrol edin.';

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

  function listUrlForCategory(categoryId) {
    try {
      var target = new URL('./liste.html', window.location.href);
      target.searchParams.set('categoryId', String(categoryId || '').trim());
      return target.href;
    } catch (_) {
      return 'liste.html?categoryId=' + encodeURIComponent(categoryId);
    }
  }

  function readCategoryIdFromQuery() {
    try {
      return String(new URLSearchParams(window.location.search).get('categoryId') || '').trim();
    } catch (_) {
      return '';
    }
  }

  function accentClass(accent) {
    return 'teacher-video-category-card--' + String(accent || 'gold').trim().toLowerCase();
  }

  function showHubAccessError() {
    var grid = $('#teacher-video-category-grid');
    if (grid) {
      grid.hidden = true;
      grid.innerHTML = '';
    }
    var guestCta = $('#teacher-video-hub-guest-cta');
    if (guestCta) guestCta.hidden = true;
    var status = document.querySelector('[id$="-access-status"]');
    if (status) {
      status.hidden = false;
      status.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }
  }

  function renderHubGuest() {
    var grid = $('#teacher-video-category-grid');
    if (grid) {
      grid.hidden = true;
      grid.innerHTML = '';
    }
    var guestCta = $('#teacher-video-hub-guest-cta');
    if (guestCta) guestCta.hidden = false;
  }

  function renderHubCategories(categories) {
    var guestCta = $('#teacher-video-hub-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var grid = $('#teacher-video-category-grid');
    if (!grid) return;

    grid.hidden = false;
    grid.innerHTML = (categories || [])
      .map(function (cat) {
        return (
          '<article class="teacher-video-category-card ' + accentClass(cat.accent) + '" data-category-id="' + escapeHtml(cat.id) + '" role="link" tabindex="0">'
          + '<h2 class="teacher-video-category-card__title">' + escapeHtml(cat.title) + '</h2>'
          + '<p class="teacher-video-category-card__desc">' + escapeHtml(cat.description) + '</p>'
          + '<span class="teacher-video-category-card__badge">Videoları Gör</span>'
          + '</article>'
        );
      })
      .join('');

    Array.prototype.slice.call(grid.querySelectorAll('.teacher-video-category-card')).forEach(function (card) {
      var id = card.getAttribute('data-category-id');
      function go() {
        window.location.href = listUrlForCategory(id);
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

  function initHub() {
    if (hubInitialized) return;
    if (!document.body || !document.body.classList.contains('page-video-dersler')) return;
    if (document.body.classList.contains('page-video-dersler-liste')) return;
    if (!$('#teacher-video-category-grid')) return;
    hubInitialized = true;

    var repo = window.SA_WEB_TEACHER_VIDEO;
    if (!repo) return;

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showHubAccessError();
      return;
    }
    viewer.whenReady().then(function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showHubAccessError();
        return;
      }
      if (ctx.kind === 'guest') {
        renderHubGuest();
        return;
      }
      var result = repo.getCategories();
      if (result.ok) renderHubCategories(result.categories || []);
    });
  }

  function renderListGuest(meta) {
    var loading = $('#teacher-video-list-loading');
    if (loading) loading.hidden = true;
    var guestCta = $('#teacher-video-list-guest-cta');
    if (guestCta) guestCta.hidden = false;
    var title = $('#teacher-video-list-category-title');
    if (title && meta) title.textContent = meta.title;
  }

  function showListAccessError(meta) {
    var loading = $('#teacher-video-list-loading');
    if (loading) loading.hidden = true;
    var guestCta = $('#teacher-video-list-guest-cta');
    if (guestCta) guestCta.hidden = true;
    var title = $('#teacher-video-list-category-title');
    if (title && meta) title.textContent = meta.title;
    var err = $('#teacher-video-list-error');
    if (err) {
      err.hidden = false;
      err.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }
  }

  function hideGlobalPremiumLockPanel() {
    var lock = $('#teacher-video-lock');
    if (lock) lock.hidden = true;
  }

  function renderAccessNote(effectiveMode) {
    var note = $('#teacher-video-access-note');
    if (!note) return;
    if (effectiveMode === 'open_with_rewarded') {
      note.hidden = false;
      note.textContent = 'Web ön izleme erişimi aktif.';
    } else {
      note.hidden = true;
      note.textContent = '';
    }
  }

  function setPlayerModalPlaybackVisible(visible) {
    var frameWrap = $('#teacher-video-player-frame-wrap');
    if (frameWrap) frameWrap.hidden = !visible;
  }

  function setPlayerModalError(message) {
    var errEl = $('#teacher-video-player-error');
    if (!errEl) return;
    if (message) {
      errEl.hidden = false;
      errEl.textContent = message;
    } else {
      errEl.hidden = true;
      errEl.textContent = '';
    }
  }

  function closePlayerModal() {
    var modal = $('#teacher-video-player-modal');
    var iframe = $('#teacher-video-player-iframe');
    if (iframe) iframe.src = '';
    var title = $('#teacher-video-player-title');
    if (title) title.textContent = '';
    setPlayerModalError('');
    setPlayerModalPlaybackVisible(true);
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('teacher-video-modal-open');
  }

  function openPlayerModalWithMessage(video, repo, errorMessage) {
    if (!repo) return;
    bindPlayerModal();
    var modal = $('#teacher-video-player-modal');
    var iframe = $('#teacher-video-player-iframe');
    var title = $('#teacher-video-player-title');
    if (!modal) return;

    if (title) title.textContent = (video && video.title) || 'Video ders';
    if (iframe) iframe.src = '';
    setPlayerModalPlaybackVisible(false);
    setPlayerModalError(errorMessage || CARD_VIDEO_LINK_MESSAGE);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('teacher-video-modal-open');
  }

  function openPlayerModal(video, repo) {
    if (!repo) return;
    var modal = $('#teacher-video-player-modal');
    var iframe = $('#teacher-video-player-iframe');
    var title = $('#teacher-video-player-title');
    if (!modal || !iframe) return;

    var videoId = repo.parseYoutubeId(video.youtubeVideoId || video.youtubeUrl);
    if (!videoId) {
      openPlayerModalWithMessage(
        video,
        repo,
        CARD_VIDEO_LINK_MESSAGE
      );
      return;
    }

    var embedUrl = repo.buildEmbedUrl(videoId);
    if (!embedUrl) {
      openPlayerModalWithMessage(
        video,
        repo,
        'Video oynatıcı hazırlanamadı. Lütfen daha sonra tekrar deneyin.'
      );
      return;
    }

    if (title) title.textContent = video.title || 'Video ders';
    setPlayerModalError('');
    setPlayerModalPlaybackVisible(true);
    iframe.src = embedUrl;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('teacher-video-modal-open');
  }

  var upsellModalEscapeBound = false;
  var UPSELL_PLACEHOLDER_MSG =
    'Satın alma talebi özelliği yakında aktif olacak. Şimdilik premium erişim için yöneticiyle iletişime geçebilirsiniz.';

  function hideUpsellNotice() {
    var notice = $('#teacher-video-upsell-notice');
    if (!notice) return;
    notice.hidden = true;
    notice.textContent = '';
  }

  function showUpsellNotice(message) {
    var notice = $('#teacher-video-upsell-notice');
    if (!notice) return;
    notice.textContent = message || UPSELL_PLACEHOLDER_MSG;
    notice.hidden = false;
  }

  function closeUpsellModal() {
    var modal = $('#teacher-video-upsell-modal');
    var videoTitle = $('#teacher-video-upsell-video-title');
    if (videoTitle) {
      videoTitle.hidden = true;
      videoTitle.textContent = '';
    }
    hideUpsellNotice();
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('teacher-video-upsell-open');
  }

  function openUpsellModal(video) {
    bindUpsellModal();
    closePlayerModal();
    var modal = $('#teacher-video-upsell-modal');
    if (!modal) return;
    hideUpsellNotice();
    var videoTitle = $('#teacher-video-upsell-video-title');
    if (videoTitle && video && video.title) {
      videoTitle.hidden = false;
      videoTitle.textContent = video.title;
    } else if (videoTitle) {
      videoTitle.hidden = true;
      videoTitle.textContent = '';
    }
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('teacher-video-upsell-open');
  }

  function bindUpsellModal() {
    var modal = $('#teacher-video-upsell-modal');
    if (!modal) return;
    if (modal.getAttribute('data-bound') === '1') return;
    modal.setAttribute('data-bound', '1');

    var closeBtn = $('#teacher-video-upsell-close');
    var dismissBtn = $('#teacher-video-upsell-dismiss');
    var ctaBtn = $('#teacher-video-upsell-cta');
    if (closeBtn) closeBtn.onclick = closeUpsellModal;
    if (dismissBtn) dismissBtn.onclick = closeUpsellModal;
    if (ctaBtn) {
      ctaBtn.onclick = function () {
        showUpsellNotice(UPSELL_PLACEHOLDER_MSG);
      };
    }

    var backdrop = modal.querySelector('.teacher-video-upsell-modal__backdrop');
    if (backdrop) backdrop.onclick = closeUpsellModal;

    if (!upsellModalEscapeBound) {
      upsellModalEscapeBound = true;
      document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') return;
        var upsell = $('#teacher-video-upsell-modal');
        if (upsell && !upsell.hidden) {
          closeUpsellModal();
          return;
        }
        var player = $('#teacher-video-player-modal');
        if (player && !player.hidden) closePlayerModal();
      });
    }
  }

  function bindPlayerModal() {
    var modal = $('#teacher-video-player-modal');
    if (!modal) return;
    if (modal.getAttribute('data-bound') === '1') return;
    modal.setAttribute('data-bound', '1');

    var closeBtn = $('#teacher-video-player-close');
    if (closeBtn) closeBtn.onclick = closePlayerModal;

    var backdrop = modal.querySelector('.teacher-video-player-modal__backdrop');
    if (backdrop) backdrop.onclick = closePlayerModal;
  }

  function buildAccessContext(repo, settings, userEntitlement, tenantAccess) {
    if (repo && typeof repo.buildWebTeacherVideoAccessContext === 'function') {
      return repo.buildWebTeacherVideoAccessContext(settings, userEntitlement, tenantAccess);
    }
    var effectiveMode = repo.getEffectiveAccessMode(settings);
    var isPremiumLocked = effectiveMode === 'premium_locked';
    var hasUserPremium = repo && typeof repo.hasWebTeacherVideoPremiumAccess === 'function'
      ? repo.hasWebTeacherVideoPremiumAccess(userEntitlement)
      : false;
    var canPlayAll = !isPremiumLocked || hasUserPremium;
    return {
      effectiveMode: effectiveMode,
      canPlayAll: canPlayAll,
      isPremiumLocked: isPremiumLocked && !hasUserPremium,
      accessBranch: 'PUBLIC'
    };
  }

  function renderVideoList(videos, repo, accessCtx) {
    var grid = $('#teacher-video-list');
    if (!grid) return;

    hideGlobalPremiumLockPanel();

    if (!videos.length) {
      grid.hidden = true;
      var empty = $('#teacher-video-list-empty');
      if (empty) empty.hidden = false;
      return;
    }

    var empty = $('#teacher-video-list-empty');
    if (empty) empty.hidden = true;

    var ctx = accessCtx || { canPlayAll: true, isPremiumLocked: false };
    var isPremiumLocked = !!ctx.isPremiumLocked;

    grid.hidden = false;
    grid.innerHTML = videos
      .map(function (v) {
        var invalid = !v.hasPlayableVideo;
        var canPlay = !!ctx.canPlayAll && v.hasPlayableVideo;
        var locked = isPremiumLocked && v.hasPlayableVideo;
        var cardClass = 'teacher-video-card';
        if (locked) cardClass += ' teacher-video-card--locked';

        var thumbInner = v.thumbnailUrl
          ? '<img class="teacher-video-thumb__img" src="' + escapeHtml(v.thumbnailUrl) + '" alt="" loading="lazy" />'
          : '<span class="teacher-video-thumb__placeholder" aria-hidden="true">▶</span>';
        var lockOverlay = locked
          ? '<span class="teacher-video-thumb__lock-overlay" aria-hidden="true">'
            + '<span class="teacher-video-card__badge-premium">Premium</span>'
            + '</span>'
          : '';
        var thumb =
          '<div class="teacher-video-thumb">'
          + thumbInner
          + lockOverlay
          + '</div>';

        var lessonNoLabel = v.lessonNo > 0 ? String(v.lessonNo) : '';
        var lessonDesktop = lessonNoLabel ? 'Ders ' + lessonNoLabel : 'Video';
        var lessonMobile = lessonNoLabel ? 'Ders No: ' + lessonNoLabel : 'Video';
        var lesson =
          '<span class="teacher-video-card__lesson">'
          + '<span class="teacher-video-card__lesson-label teacher-video-card__lesson-label--desktop">'
          + escapeHtml(lessonDesktop)
          + '</span>'
          + '<span class="teacher-video-card__lesson-label teacher-video-card__lesson-label--mobile">'
          + escapeHtml(lessonMobile)
          + '</span>'
          + '</span>';

        var desc = v.description
          ? '<p class="teacher-video-card__desc">' + escapeHtml(v.description) + '</p>'
          : '';
        var warn = invalid
          ? '<p class="teacher-video-card__warn">' + escapeHtml(v.videoError || CARD_VIDEO_LINK_MESSAGE) + '</p>'
          : '';
        var premiumHint = locked
          ? '<p class="teacher-video-card__premium-hint">Premium erişimle açılır</p>'
          : '';

        var actionBtn;
        if (invalid) {
          actionBtn =
            '<button type="button" class="teacher-video-card__play teacher-video-card__play--unplayable" data-video-id="'
            + escapeHtml(v.id) + '" data-action="invalid" aria-label="Video bağlantısı geçersiz">İzle</button>';
        } else if (canPlay) {
          actionBtn =
            '<button type="button" class="teacher-video-card__play" data-video-id="' + escapeHtml(v.id)
            + '" data-action="play" aria-label="Videoyu aç">'
            + '<span class="teacher-video-card__play-label teacher-video-card__play-label--desktop">İzle</span>'
            + '<span class="teacher-video-card__play-label teacher-video-card__play-label--mobile">Videoyu Aç</span>'
            + '</button>';
        } else if (locked) {
          actionBtn =
            '<button type="button" class="teacher-video-card__play teacher-video-card__play--premium" data-video-id="'
            + escapeHtml(v.id) + '" data-action="upsell">Premium</button>';
        } else {
          actionBtn = '<span class="teacher-video-card__play teacher-video-card__play--disabled">Kilitli</span>';
        }

        return (
          '<article class="' + cardClass + '" data-video-id="' + escapeHtml(v.id) + '">'
          + thumb
          + '<div class="teacher-video-card__body">'
          + '<h2 class="teacher-video-card__title">' + escapeHtml(v.title) + '</h2>'
          + desc
          + premiumHint
          + warn
          + '</div>'
          + '<div class="teacher-video-card__footer">'
          + lesson
          + actionBtn
          + '</div>'
          + '</article>'
        );
      })
      .join('');

    bindPlayerModal();
    bindUpsellModal();

    var videoById = {};
    videos.forEach(function (v) {
      videoById[v.id] = v;
    });

    function handleCardAction(ev, btn) {
      ev.stopPropagation();
      var id = btn.getAttribute('data-video-id');
      var item = videoById[id];
      if (!item) return;
      var action = btn.getAttribute('data-action');
      if (action === 'invalid' || !item.hasPlayableVideo) {
        openPlayerModalWithMessage(item, repo, CARD_VIDEO_LINK_MESSAGE);
        return;
      }
      if (action === 'upsell') {
        openUpsellModal(item);
        return;
      }
      if (action === 'play') {
        openPlayerModal(item, repo);
      }
    }

    Array.prototype.slice.call(grid.querySelectorAll('.teacher-video-card__play[data-video-id]')).forEach(function (btn) {
      btn.onclick = function (ev) {
        handleCardAction(ev, btn);
      };
    });

    Array.prototype.slice.call(grid.querySelectorAll('.teacher-video-card--locked[data-video-id]')).forEach(function (card) {
      card.onclick = function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('.teacher-video-card__play')) return;
        var id = card.getAttribute('data-video-id');
        var item = videoById[id];
        if (item && item.hasPlayableVideo && isPremiumLocked) {
          openUpsellModal(item);
        }
      };
    });
  }

  function renderListInvalid() {
    var main = $('.teacher-video-list-main');
    if (main) main.hidden = true;
    var err = $('#teacher-video-list-invalid');
    if (err) err.hidden = false;
  }

  async function refreshList(categoryId, meta) {
    var repo = window.SA_WEB_TEACHER_VIDEO;
    if (!repo) return;

    closePlayerModal();
    closeUpsellModal();

    var title = $('#teacher-video-list-category-title');
    if (title) {
      title.textContent = (meta && meta.title) || categoryId;
      title.setAttribute('aria-current', 'page');
    }

    if (!repo.isAuthenticated()) {
      showListAccessError(meta);
      return;
    }

    var guestCta = $('#teacher-video-list-guest-cta');
    if (guestCta) guestCta.hidden = true;
    var listErr = $('#teacher-video-list-error');
    if (listErr) {
      listErr.hidden = true;
      listErr.textContent = '';
    }

    var loading = $('#teacher-video-list-loading');
    if (loading) loading.hidden = false;

    var accessResult = await repo.getAccessSettings();
    var videosResult = await repo.getVideos(categoryId);
    var entResult = { ok: true, entitlement: null };
    if (typeof repo.loadWebTeacherVideoUserEntitlement === 'function') {
      entResult = await repo.loadWebTeacherVideoUserEntitlement();
    }

    var resolvedTenantId = '';
    if (typeof repo.resolveWebTeacherVideoTenantId === 'function') {
      resolvedTenantId = String(repo.resolveWebTeacherVideoTenantId() || '').trim();
    }
    var tenantAccess = {
      isInstitutionStudent: !!resolvedTenantId,
      tenantId: resolvedTenantId || null,
      premiumVideoLessonsActive: false,
      tenantSettingsOk: false
    };
    if (resolvedTenantId && typeof repo.loadWebTeacherVideoTenantSettings === 'function') {
      var tenantSettingsResult = await repo.loadWebTeacherVideoTenantSettings(resolvedTenantId);
      tenantAccess.tenantSettingsOk = !!(tenantSettingsResult && tenantSettingsResult.ok);
      tenantAccess.premiumVideoLessonsActive = !!(
        tenantSettingsResult
        && tenantSettingsResult.ok
        && tenantSettingsResult.premiumVideoLessonsActive === true
      );
      if (!tenantSettingsResult || !tenantSettingsResult.ok) {
        console.warn(
          '[SA_WEB_TEACHER_VIDEO] tenantSettings read failed for institution student',
          tenantSettingsResult && tenantSettingsResult.error
            ? tenantSettingsResult.error
            : 'unknown'
        );
      }
    }

    if (loading) loading.hidden = true;

    if (!videosResult.ok) {
      var err = $('#teacher-video-list-error');
      if (err) {
        err.hidden = false;
        err.textContent = videosResult.error || 'Videolar yüklenemedi.';
      }
      return;
    }

    var settings =
      accessResult.ok && accessResult.settings
        ? accessResult.settings
        : { accessMode: 'open_with_rewarded', launchOpenUntil: null };
    var userEntitlement = entResult.ok ? entResult.entitlement : null;
    var accessCtx = buildAccessContext(repo, settings, userEntitlement, tenantAccess);

    hideGlobalPremiumLockPanel();
    // Institution branch never shows the public open_with_rewarded preview note.
    if (accessCtx.accessBranch === 'TENANT' || accessCtx.accessBranch === 'USER_ENTITLEMENT') {
      renderAccessNote('');
    } else {
      renderAccessNote(accessCtx.effectiveMode);
    }
    renderVideoList(videosResult.videos || [], repo, accessCtx);
  }

  function initList() {
    if (listInitialized) return;
    if (!document.body || !document.body.classList.contains('page-video-dersler-liste')) return;
    listInitialized = true;

    var repo = window.SA_WEB_TEACHER_VIDEO;
    if (!repo) return;

    var categoryId = readCategoryIdFromQuery();
    if (!repo.isValidCategoryId(categoryId)) {
      renderListInvalid();
      return;
    }

    var meta = repo.getCategoryById(categoryId);

    bindPlayerModal();
    bindUpsellModal();
    closePlayerModal();
    closeUpsellModal();

    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showListAccessError(meta);
      return;
    }
    viewer.whenReady().then(function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showListAccessError(meta);
        return;
      }
      if (ctx.kind === 'guest') {
        renderListGuest(meta);
        return;
      }
      refreshList(categoryId, meta);
    });
  }

  function init() {
    initHub();
    initList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
