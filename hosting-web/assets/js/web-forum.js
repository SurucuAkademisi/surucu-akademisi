/**
 * Forum hub — list, create post, navigate to detail.
 */
(function () {
  'use strict';

  var pageInitialized = false;
  var activeMode = 'global';
  var forumCtx = null;
  var composeOpen = false;
  var rulesModalOpen = false;
  var webForumRulesStorageKey = null;

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

  function readInitialMode() {
    try {
      var params = new URLSearchParams(window.location.search);
      var m = String(params.get('mode') || '').trim();
      if (m === 'global' || m === 'institution') return m;
    } catch (_) {}
    return null;
  }

  function formatDateTr(ms) {
    if (!ms) return '—';
    try {
      return new Date(ms).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return '—';
    }
  }

  function contentPreview(text, maxLen) {
    var s = String(text || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    var limit = maxLen || 140;
    if (s.length <= limit) return s;
    return s.slice(0, limit - 1) + '…';
  }

  function modeBadgeLabel(mode) {
    return mode === 'institution' ? 'Kurum İçi' : 'Türkiye Geneli';
  }

  function renderAuthorLabel(userId, userName) {
    var repo = window.SA_WEB_FORUM;
    var accent = repo && repo.getForumUserAccent
      ? repo.getForumUserAccent(userId, userName)
      : { color: '#e2e8f0' };
    return (
      '<span class="forum-post-meta__author forum-user-accent" style="color:' + escapeHtml(accent.color) + '">'
      + '<span class="forum-user-dot" style="background:' + escapeHtml(accent.color) + '"></span>'
      + escapeHtml(userName)
      + '</span>'
    );
  }

  function renderGuest() {
    var guestCta = $('#forum-guest-cta');
    var main = $('#forum-main');
    if (main) main.hidden = true;
    if (guestCta) guestCta.hidden = false;
  }

  function showAccessError() {
    var guestCta = $('#forum-guest-cta');
    if (guestCta) guestCta.hidden = true;

    var main = $('#forum-main');
    if (main) main.hidden = false;

    var tabs = $('#forum-tabs');
    if (tabs) tabs.hidden = true;

    var newBtn = $('#forum-new-post-btn');
    if (newBtn) newBtn.hidden = true;

    var loading = $('#forum-list-loading');
    if (loading) loading.hidden = true;

    var list = $('#forum-post-list');
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }

    var empty = $('#forum-list-empty');
    if (empty) empty.hidden = true;

    var err = $('#forum-list-error');
    if (err) {
      err.hidden = false;
      err.textContent = 'Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.';
    }
  }

  function renderTabs(ctx) {
    var tabs = $('#forum-tabs');
    if (!tabs) return;

    var showInstitution = !!(ctx && ctx.canUseInstitutionForum);
    tabs.hidden = false;

    var institutionTab = tabs.querySelector('[data-forum-mode="institution"]');
    var globalTab = tabs.querySelector('[data-forum-mode="global"]');

    if (institutionTab) {
      institutionTab.hidden = !showInstitution;
      institutionTab.setAttribute('aria-hidden', showInstitution ? 'false' : 'true');
    }
    if (globalTab) {
      globalTab.hidden = false;
      globalTab.setAttribute('aria-hidden', 'false');
    }

    Array.prototype.slice.call(tabs.querySelectorAll('.forum-tab')).forEach(function (btn) {
      var mode = btn.getAttribute('data-forum-mode');
      if (!mode) return;
      if (mode === 'institution' && !showInstitution) return;
      var isActive = mode === activeMode;
      btn.classList.toggle('forum-tab--active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function renderPostList(posts, mode) {
    var repo = window.SA_WEB_FORUM;
    var list = $('#forum-post-list');
    var loading = $('#forum-list-loading');
    var empty = $('#forum-list-empty');
    var err = $('#forum-list-error');

    if (loading) loading.hidden = true;
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }

    if (!list) return;

    if (!posts.length) {
      list.hidden = true;
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    list.hidden = false;

    list.innerHTML = posts
      .map(function (p) {
        var preview = contentPreview(p.content, 160);
        var previewHtml = preview
          ? '<p class="forum-post-card__preview">' + escapeHtml(preview) + '</p>'
          : '';
        var href = repo && repo.buildPostUrl ? repo.buildPostUrl(p, mode) : '';
        var accent = repo && repo.getForumUserAccent
          ? repo.getForumUserAccent(p.userId, p.userName)
          : { color: '#e2e8f0' };
        return (
          '<article class="forum-post-card forum-post-card--accent" data-post-id="' + escapeHtml(p.id) + '" data-post-href="' + escapeHtml(href) + '" tabindex="0" role="link" style="--forum-user-accent:' + escapeHtml(accent.color) + '">'
          + '<div class="forum-post-card__head">'
          + '<span class="forum-post-card__badge forum-mode-badge">' + escapeHtml(modeBadgeLabel(mode)) + '</span>'
          + '<span class="forum-post-meta__date">' + escapeHtml(formatDateTr(p.createdAtMs)) + '</span>'
          + '</div>'
          + '<h2 class="forum-post-card__title">' + escapeHtml(p.title) + '</h2>'
          + previewHtml
          + '<div class="forum-post-meta">'
          + renderAuthorLabel(p.userId, p.userName)
          + '</div>'
          + '<div class="forum-post-counts">'
          + '<span>❤️ ' + escapeHtml(String(p.likeCount)) + '</span>'
          + '<span>💬 ' + escapeHtml(String(p.commentCount)) + '</span>'
          + '</div>'
          + '</article>'
        );
      })
      .join('');

    Array.prototype.slice.call(list.querySelectorAll('.forum-post-card')).forEach(function (card) {
      function goDetail(ev) {
        if (ev) ev.preventDefault();
        var href = card.getAttribute('data-post-href');
        if (href) window.location.href = href;
      }
      card.onclick = goDetail;
      card.onkeydown = function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          goDetail(ev);
        }
      };
    });
  }

  async function refreshPosts() {
    var repo = window.SA_WEB_FORUM;
    if (!repo || !forumCtx || forumCtx.isGuest) return;

    var loading = $('#forum-list-loading');
    var list = $('#forum-post-list');
    var empty = $('#forum-list-empty');
    var err = $('#forum-list-error');

    if (loading) loading.hidden = false;
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }
    if (empty) empty.hidden = true;
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }

    var result = await repo.listPosts(activeMode, forumCtx);

    if (loading) loading.hidden = true;

    if (!result.ok) {
      if (err) {
        err.hidden = false;
        err.textContent = result.error || 'Forum gönderileri yüklenemedi.';
      }
      return;
    }

    console.log('[WebForum] loaded posts', {
      mode: activeMode,
      count: (result.posts || []).length,
      tenantId: forumCtx.tenantId || null
    });

    renderPostList(result.posts || [], activeMode);
  }

  function setMode(mode) {
    var m = String(mode || '').trim();
    if (m !== 'global' && m !== 'institution') return;
    if (m === 'institution' && (!forumCtx || !forumCtx.canUseInstitutionForum)) return;
    activeMode = m;
    renderTabs(forumCtx);
    refreshPosts();
  }

  function bindTabs() {
    var tabs = $('#forum-tabs');
    if (!tabs || tabs.getAttribute('data-bound') === '1') return;
    tabs.setAttribute('data-bound', '1');

    Array.prototype.slice.call(tabs.querySelectorAll('.forum-tab[data-forum-mode]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-forum-mode');
        if (mode) setMode(mode);
      });
    });
  }

  function setComposeError(msg) {
    var el = $('#forum-compose-error');
    if (!el) return;
    if (msg) {
      el.hidden = false;
      el.textContent = msg;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function openComposeModal() {
    var modal = $('#forum-compose-modal');
    if (!modal) return;
    composeOpen = true;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('forum-compose-open');
    setComposeError('');
    var title = $('#forum-compose-title');
    var content = $('#forum-compose-content');
    if (title) title.value = '';
    if (content) content.value = '';
    var scope = $('#forum-compose-scope');
    if (scope) scope.textContent = modeBadgeLabel(activeMode);
    if (title && typeof title.focus === 'function') title.focus();
  }

  function closeComposeModal() {
    var modal = $('#forum-compose-modal');
    if (!modal) return;
    composeOpen = false;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('forum-compose-open');
    setComposeError('');
  }

  async function submitCompose() {
    var repo = window.SA_WEB_FORUM;
    if (!repo || !forumCtx || forumCtx.isGuest) return;

    var titleEl = $('#forum-compose-title');
    var contentEl = $('#forum-compose-content');
    var submitBtn = $('#forum-compose-submit');

    var title = titleEl ? titleEl.value : '';
    var content = contentEl ? contentEl.value : '';

    setComposeError('');
    if (submitBtn) submitBtn.disabled = true;

    var result = await repo.createPost(
      { mode: activeMode, title: title, content: content },
      forumCtx
    );

    if (submitBtn) submitBtn.disabled = false;

    if (!result.ok) {
      setComposeError(result.error || 'Konu yayınlanamadı.');
      return;
    }

    closeComposeModal();

    if (result.postId) {
      var url = repo.buildPostUrl({ id: result.postId }, activeMode);
      if (url) {
        window.location.href = url;
        return;
      }
    }

    refreshPosts();
  }

  function sanitizeForumRulesStoragePart(value) {
    return String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 120) || 'unknown';
  }

  function buildWebForumRulesStorageKey(ctx) {
    if (!ctx || ctx.isGuest || !ctx.uid) return '';
    var uid = sanitizeForumRulesStoragePart(ctx.uid);
    var scope = 'public';
    if (ctx.tenantId && String(ctx.tenantId).trim()) {
      scope = sanitizeForumRulesStoragePart(ctx.tenantId);
    }
    return 'sa_web_forum_rules_ack_v1_' + uid + '_' + scope;
  }

  function showWebForumRulesModalIfNeeded(ctx) {
    if (!ctx || ctx.isGuest || !ctx.uid) return;
    var key = buildWebForumRulesStorageKey(ctx);
    if (!key) return;
    try {
      if (localStorage.getItem(key) === '1') return;
    } catch (e) {
      console.warn('[WebForum] rules modal failed', e);
      return;
    }

    var modal = $('#web-forum-rules-modal');
    if (!modal) return;

    webForumRulesStorageKey = key;
    rulesModalOpen = true;
    var never = $('#web-forum-rules-never');
    if (never) never.checked = false;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('web-forum-rules-open');
  }

  function closeWebForumRulesModal() {
    var modal = $('#web-forum-rules-modal');
    var never = $('#web-forum-rules-never');
    try {
      if (never && never.checked && webForumRulesStorageKey) {
        localStorage.setItem(webForumRulesStorageKey, '1');
      }
    } catch (e) {
      console.warn('[WebForum] rules modal failed', e);
    }
    webForumRulesStorageKey = null;
    rulesModalOpen = false;
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('web-forum-rules-open');
  }

  function bindWebForumRulesModal() {
    var modal = $('#web-forum-rules-modal');
    if (!modal || modal.getAttribute('data-bound') === '1') return;
    modal.setAttribute('data-bound', '1');

    var dismissBtn = $('#web-forum-rules-dismiss');
    var closeBtn = $('#web-forum-rules-close');
    var backdrop = modal.querySelector('[data-web-forum-rules-dismiss]');

    if (dismissBtn) dismissBtn.addEventListener('click', closeWebForumRulesModal);
    if (closeBtn) closeBtn.addEventListener('click', closeWebForumRulesModal);
    if (backdrop) backdrop.addEventListener('click', closeWebForumRulesModal);

    document.addEventListener('keydown', function (ev) {
      if (!rulesModalOpen) return;
      if (ev.key === 'Escape') closeWebForumRulesModal();
    });
  }

  function bindCompose() {
    var btn = $('#forum-new-post-btn');
    if (btn && btn.getAttribute('data-bound') !== '1') {
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', function () {
        openComposeModal();
      });
    }

    var modal = $('#forum-compose-modal');
    if (!modal || modal.getAttribute('data-bound') === '1') return;
    modal.setAttribute('data-bound', '1');

    var closeBtn = $('#forum-compose-close');
    var cancelBtn = $('#forum-compose-cancel');
    var submitBtn = $('#forum-compose-submit');
    var backdrop = modal.querySelector('[data-forum-compose-dismiss]');

    if (closeBtn) closeBtn.addEventListener('click', closeComposeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeComposeModal);
    if (backdrop) backdrop.addEventListener('click', closeComposeModal);
    if (submitBtn) submitBtn.addEventListener('click', submitCompose);

    document.addEventListener('keydown', function (ev) {
      if (!composeOpen) return;
      if (ev.key === 'Escape') closeComposeModal();
    });
  }

  function initPage() {
    if (pageInitialized) return;
    if (!document.body || !document.body.classList.contains('page-forum')) return;
    if (document.body.classList.contains('page-forum-post')) return;
    pageInitialized = true;

    var repo = window.SA_WEB_FORUM;
    if (!repo) return;

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
        renderGuest();
        return;
      }

      forumCtx = repo.getForumContext();

      if (forumCtx.isGuest) {
        showAccessError();
        return;
      }

      var guestCta = $('#forum-guest-cta');
      if (guestCta) guestCta.hidden = true;

      var main = $('#forum-main');
      if (main) main.hidden = false;

      var newBtn = $('#forum-new-post-btn');
      if (newBtn) newBtn.hidden = false;

      var urlMode = readInitialMode();
      if (urlMode === 'institution' && forumCtx.canUseInstitutionForum) {
        activeMode = 'institution';
      } else if (urlMode === 'global') {
        activeMode = 'global';
      } else {
        activeMode = forumCtx.canUseInstitutionForum ? 'institution' : 'global';
      }

      bindTabs();
      bindCompose();
      bindWebForumRulesModal();
      renderTabs(forumCtx);
      showWebForumRulesModalIfNeeded(forumCtx);
      refreshPosts();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
  } else {
    initPage();
  }
})();
