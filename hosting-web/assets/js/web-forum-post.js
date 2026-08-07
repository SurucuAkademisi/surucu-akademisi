/**
 * Forum post detail — thread view, comments, post likes.
 */
(function () {
  'use strict';

  var pageInitialized = false;
  var forumCtx = null;
  var activePost = null;
  var activeMode = 'global';
  var postLiked = false;
  var likeBusy = false;
  var activeComments = [];
  var commentReactions = {};
  var commentReactionBusy = {};
  var replyTarget = null;

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

  function formatContentHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br />');
  }

  function contentPreview(text, maxLen) {
    var s = String(text || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    var limit = maxLen || 120;
    if (s.length <= limit) return s;
    return s.slice(0, limit - 1) + '…';
  }

  function renderAuthorLabel(userId, userName, className) {
    var repo = window.SA_WEB_FORUM;
    var cls = className || 'forum-post-meta__author';
    var accent = repo && repo.getForumUserAccent
      ? repo.getForumUserAccent(userId, userName)
      : { color: '#e2e8f0' };
    return (
      '<span class="' + cls + ' forum-user-accent" style="color:' + escapeHtml(accent.color) + '">'
      + '<span class="forum-user-dot" style="background:' + escapeHtml(accent.color) + '"></span>'
      + escapeHtml(userName)
      + '</span>'
    );
  }

  function readQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      return {
        postId: String(params.get('postId') || '').trim(),
        mode: String(params.get('mode') || '').trim()
      };
    } catch (_) {
      return { postId: '', mode: '' };
    }
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

  function modeBadgeLabel(mode) {
    return mode === 'institution' ? 'Kurum İçi' : 'Türkiye Geneli';
  }

  function forumListUrl(mode) {
    var m = mode === 'institution' ? 'institution' : 'global';
    return 'index.html?mode=' + encodeURIComponent(m);
  }

  function showForbidden(msg) {
    var shell = $('#forum-post-shell');
    var forbidden = $('#forum-post-forbidden');
    var loading = $('#forum-post-loading');
    if (loading) loading.hidden = true;
    if (shell) shell.hidden = true;
    if (forbidden) {
      forbidden.hidden = false;
      var p = forbidden.querySelector('p');
      if (p) p.textContent = msg || 'Bu konuya erişim izniniz yok.';
    }
  }

  function showGuestRedirect() {
    window.location.replace('index.html');
  }

  function showAccessError() {
    showForbidden('Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.');
  }

  function setLikeError(msg) {
    var el = $('#forum-like-error');
    if (!el) return;
    if (msg) {
      el.hidden = false;
      el.textContent = msg;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function updateLikeUi(liked, likeCount) {
    var btn = $('#forum-post-like-btn');
    var countEl = $('#forum-post-like-count');
    postLiked = !!liked;
    if (btn) {
      btn.classList.toggle('forum-like-btn--active', postLiked);
      btn.setAttribute('aria-pressed', postLiked ? 'true' : 'false');
    }
    if (countEl) countEl.textContent = String(Math.max(0, Number(likeCount || 0)));
    if (activePost) activePost.likeCount = Math.max(0, Number(likeCount || 0));
  }

  function renderPostDetail(post, mode) {
    var repo = window.SA_WEB_FORUM;
    var card = $('#forum-detail-card');
    if (!card) return;

    var accent = repo && repo.getForumUserAccent
      ? repo.getForumUserAccent(post.userId, post.userName)
      : { color: '#e2e8f0' };

    card.setAttribute('style', '--forum-user-accent:' + accent.color);
    card.innerHTML =
      '<div class="forum-detail-card__head">'
      + '<span class="forum-mode-badge">' + escapeHtml(modeBadgeLabel(mode)) + '</span>'
      + '<span class="forum-post-meta__date">' + escapeHtml(formatDateTr(post.createdAtMs)) + '</span>'
      + '</div>'
      + '<h1 class="forum-detail-card__title">' + escapeHtml(post.title) + '</h1>'
      + '<div class="forum-detail-card__content">' + formatContentHtml(post.content) + '</div>'
      + '<div class="forum-post-meta forum-detail-card__meta">'
      + renderAuthorLabel(post.userId, post.userName, 'forum-post-meta__author')
      + '</div>'
      + '<div class="forum-post-counts forum-detail-card__counts">'
      + '<button type="button" class="forum-like-btn" id="forum-post-like-btn" aria-pressed="false" title="Beğen">'
      + '<span class="forum-like-btn__icon" aria-hidden="true">❤️</span>'
      + '<span class="forum-like-btn__label">Beğen</span>'
      + '<span class="forum-like-btn__count" id="forum-post-like-count">' + escapeHtml(String(post.likeCount)) + '</span>'
      + '</button>'
      + '<span class="forum-post-counts__comments" id="forum-detail-comment-count">💬 ' + escapeHtml(String(post.commentCount)) + '</span>'
      + '</div>'
      + '<p id="forum-like-error" class="forum-form__error" hidden role="alert"></p>';
  }

  function getCommentCardEl(commentId) {
    var list = $('#forum-comment-list');
    if (!list) return null;
    return list.querySelector('[data-comment-id="' + commentId + '"]');
  }

  function applyCommentReactionUi(commentId) {
    var card = getCommentCardEl(commentId);
    if (!card) return;

    var c = null;
    for (var i = 0; i < activeComments.length; i++) {
      if (activeComments[i].id === commentId) {
        c = activeComments[i];
        break;
      }
    }
    if (!c) return;

    var reaction = commentReactions[commentId] || null;
    var likeBtn = card.querySelector('.forum-comment-reaction-btn--like');
    var dislikeBtn = card.querySelector('.forum-comment-reaction-btn--dislike');
    var likeCountEl = card.querySelector('.forum-comment-like-count');
    var dislikeCountEl = card.querySelector('.forum-comment-dislike-count');

    if (likeBtn) {
      likeBtn.classList.toggle('forum-comment-reaction-btn--like-active', reaction === 'like');
      likeBtn.setAttribute('aria-pressed', reaction === 'like' ? 'true' : 'false');
    }
    if (dislikeBtn) {
      dislikeBtn.classList.toggle('forum-comment-reaction-btn--dislike-active', reaction === 'dislike');
      dislikeBtn.setAttribute('aria-pressed', reaction === 'dislike' ? 'true' : 'false');
    }
    if (likeCountEl) likeCountEl.textContent = String(Math.max(0, Number(c.likeCount || 0)));
    if (dislikeCountEl) dislikeCountEl.textContent = String(Math.max(0, Number(c.dislikeCount || 0)));
  }

  function renderCommentQuoteBlock(c) {
    if (!c || (!c.isReply && !c.replyToCommentId)) return '';
    var authorLine = String(c.replyToUserName || 'Kullanıcı').trim() + ' kullanıcısına yanıt';
    var preview = String(c.replyToContentPreview || '').trim();
    return (
      '<div class="forum-comment-quote" aria-label="Yanıtlanan yorum">'
      + '<span class="forum-comment-quote__label">Yanıtlanan yorum</span>'
      + '<span class="forum-comment-quote__author">' + escapeHtml(authorLine) + '</span>'
      + (preview
        ? '<p class="forum-comment-quote__content">' + escapeHtml(preview) + '</p>'
        : '')
      + '</div>'
    );
  }

  function updateReplyTargetPreview() {
    var panel = $('#forum-reply-target-preview');
    var authorEl = $('#forum-reply-target-author');
    var contentEl = $('#forum-reply-target-content');
    var labelEl = $('#forum-comment-label');
    var submitBtn = $('#forum-comment-submit');
    var input = $('#forum-comment-input');

    if (!replyTarget || !replyTarget.commentId) {
      if (panel) panel.hidden = true;
      if (labelEl) labelEl.textContent = 'Yorumunuz';
      if (submitBtn) submitBtn.textContent = 'Yorum Gönder';
      if (input) input.placeholder = 'Düşüncenizi paylaşın…';
      return;
    }

    if (panel) panel.hidden = false;
    if (authorEl) {
      authorEl.textContent =
        String(replyTarget.userName || 'Kullanıcı') + ' kullanıcısına yanıt veriyorsun';
    }
    if (contentEl) contentEl.textContent = replyTarget.contentPreview || '';
    if (labelEl) labelEl.textContent = 'Yanıtınız';
    if (submitBtn) submitBtn.textContent = 'Yanıt Gönder';
    if (input) input.placeholder = 'Yanıtınızı yazın…';
  }

  function setReplyTarget(commentId) {
    var c = null;
    for (var i = 0; i < activeComments.length; i++) {
      if (activeComments[i].id === commentId) {
        c = activeComments[i];
        break;
      }
    }
    if (!c) return;

    replyTarget = {
      commentId: c.id,
      userId: c.userId,
      userName: c.userName,
      content: c.content,
      contentPreview: contentPreview(c.content, 140)
    };
    updateReplyTargetPreview();

    var input = $('#forum-comment-input');
    if (input && typeof input.focus === 'function') {
      input.focus();
      if (typeof input.scrollIntoView === 'function') {
        input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function clearReplyTarget() {
    replyTarget = null;
    updateReplyTargetPreview();
  }

  function bindReplyTargetClear() {
    var btn = $('#forum-reply-target-clear');
    if (!btn || btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      clearReplyTarget();
    });
  }

  function bindCommentReplyButtons() {
    var list = $('#forum-comment-list');
    if (!list) return;

    Array.prototype.slice
      .call(list.querySelectorAll('.forum-comment-reply-btn[data-comment-id]'))
      .forEach(function (btn) {
        if (btn.getAttribute('data-bound') === '1') return;
        btn.setAttribute('data-bound', '1');
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var commentId = btn.getAttribute('data-comment-id');
          if (commentId) setReplyTarget(commentId);
        });
      });
  }

  function setCommentReactionError(msg) {
    var el = $('#forum-comment-reaction-error');
    if (!el) return;
    if (msg) {
      el.hidden = false;
      el.textContent = msg;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function renderComments(comments) {
    var repo = window.SA_WEB_FORUM;
    var list = $('#forum-comment-list');
    var empty = $('#forum-comment-empty');
    var loading = $('#forum-comment-loading');
    if (loading) loading.hidden = true;

    if (!list) return;

    activeComments = comments || [];

    if (!activeComments.length) {
      list.hidden = true;
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    list.hidden = false;
    list.innerHTML = activeComments
      .map(function (c) {
        var accent = repo && repo.getForumUserAccent
          ? repo.getForumUserAccent(c.userId, c.userName)
          : { color: '#a5f3fc' };
        var userReaction = commentReactions[c.id] || null;
        var likeActive = userReaction === 'like' ? ' forum-comment-reaction-btn--like-active' : '';
        var dislikeActive = userReaction === 'dislike' ? ' forum-comment-reaction-btn--dislike-active' : '';
        return (
          '<article class="forum-comment-card forum-comment-card--accent" data-comment-id="' + escapeHtml(c.id) + '" style="--forum-user-accent:' + escapeHtml(accent.color) + '">'
          + '<div class="forum-comment-card__head">'
          + renderAuthorLabel(c.userId, c.userName, 'forum-comment-card__author')
          + '<span class="forum-comment-card__date">' + escapeHtml(formatDateTr(c.createdAtMs)) + '</span>'
          + '</div>'
          + renderCommentQuoteBlock(c)
          + '<div class="forum-comment-card__content">' + formatContentHtml(c.content) + '</div>'
          + '<div class="forum-comment-actions">'
          + '<button type="button" class="forum-comment-reaction-btn forum-comment-reaction-btn--like' + likeActive + '" data-comment-id="' + escapeHtml(c.id) + '" data-reaction-type="like" aria-pressed="' + (userReaction === 'like' ? 'true' : 'false') + '">'
          + '<span aria-hidden="true">👍</span> Beğen <span class="forum-comment-like-count">' + escapeHtml(String(c.likeCount)) + '</span>'
          + '</button>'
          + '<button type="button" class="forum-comment-reaction-btn forum-comment-reaction-btn--dislike' + dislikeActive + '" data-comment-id="' + escapeHtml(c.id) + '" data-reaction-type="dislike" aria-pressed="' + (userReaction === 'dislike' ? 'true' : 'false') + '">'
          + '<span aria-hidden="true">👎</span> Beğenme <span class="forum-comment-dislike-count">' + escapeHtml(String(c.dislikeCount)) + '</span>'
          + '</button>'
          + '<button type="button" class="forum-comment-reply-btn" data-comment-id="' + escapeHtml(c.id) + '">Yanıt ver</button>'
          + '</div>'
          + '</article>'
        );
      })
      .join('');

    bindCommentReactions();
    bindCommentReplyButtons();
  }

  function bindCommentReactions() {
    var list = $('#forum-comment-list');
    if (!list) return;

    Array.prototype.slice
      .call(list.querySelectorAll('.forum-comment-reaction-btn[data-comment-id]'))
      .forEach(function (btn) {
        if (btn.getAttribute('data-bound') === '1') return;
        btn.setAttribute('data-bound', '1');
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var commentId = btn.getAttribute('data-comment-id');
          var reactionType = btn.getAttribute('data-reaction-type');
          if (commentId && reactionType) {
            handleCommentReactionClick(commentId, reactionType);
          }
        });
      });
  }

  async function handleCommentReactionClick(commentId, reactionType) {
    var repo = window.SA_WEB_FORUM;
    if (!repo || !activePost || !forumCtx || forumCtx.isGuest) return;
    if (commentReactionBusy[commentId]) return;

    commentReactionBusy[commentId] = true;
    setCommentReactionError('');

    var result = await repo.toggleCommentReaction(
      activePost.id,
      commentId,
      reactionType,
      activePost,
      forumCtx,
      activeMode
    );

    commentReactionBusy[commentId] = false;

    if (!result.ok) {
      console.warn('[WebForum] comment reaction failed', result.error);
      setCommentReactionError(result.error || 'Tepki gönderilemedi.');
      return;
    }

    commentReactions[commentId] = result.reaction;

    for (var i = 0; i < activeComments.length; i++) {
      if (activeComments[i].id === commentId) {
        activeComments[i].likeCount = Math.max(
          0,
          Number(activeComments[i].likeCount || 0) + Number(result.likeDelta || 0)
        );
        activeComments[i].dislikeCount = Math.max(
          0,
          Number(activeComments[i].dislikeCount || 0) + Number(result.dislikeDelta || 0)
        );
        break;
      }
    }

    applyCommentReactionUi(commentId);
  }

  async function loadCommentReactionState(comments) {
    var repo = window.SA_WEB_FORUM;
    if (!repo || !activePost || !forumCtx || forumCtx.isGuest) return;

    var result = await repo.loadCommentReactionsForCurrentUser(
      activePost.id,
      comments,
      forumCtx.uid
    );
    if (result.ok && result.reactions) {
      commentReactions = result.reactions;
    }
  }

  function updateCommentCount(count) {
    var el = $('#forum-detail-comment-count');
    if (el) el.textContent = '💬 ' + String(count);
    if (activePost) activePost.commentCount = count;
  }

  async function initPostLike() {
    var repo = window.SA_WEB_FORUM;
    var btn = $('#forum-post-like-btn');
    if (!repo || !btn || !activePost || !forumCtx || forumCtx.isGuest) return;

    setLikeError('');
    var likedResult = await repo.hasUserLikedPost(activePost.id, forumCtx.uid);
    updateLikeUi(likedResult.ok && likedResult.liked, activePost.likeCount);

    if (btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');

    btn.addEventListener('click', async function (ev) {
      ev.preventDefault();
      if (likeBusy) return;
      likeBusy = true;
      setLikeError('');
      btn.disabled = true;

      var result = await repo.togglePostLike(activePost.id, forumCtx);

      btn.disabled = false;
      likeBusy = false;

      if (!result.ok) {
        console.warn('[WebForum] post like failed', result.error);
        setLikeError(result.error || 'Beğenme işlemi başarısız.');
        return;
      }

      if (result.likeCount != null) {
        updateLikeUi(result.liked, result.likeCount);
      } else {
        updateLikeUi(result.liked, activePost.likeCount);
      }
    });
  }

  async function refreshComments() {
    var repo = window.SA_WEB_FORUM;
    if (!repo || !activePost) return;

    var loading = $('#forum-comment-loading');
    var err = $('#forum-comment-error');
    if (loading) loading.hidden = false;
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }

    var result = await repo.listComments(activePost.id);

    if (loading) loading.hidden = true;

    if (!result.ok) {
      if (err) {
        err.hidden = false;
        err.textContent = result.error || 'Yorumlar yüklenemedi.';
      }
      return;
    }

    var comments = result.comments || [];
    await loadCommentReactionState(comments);
    renderComments(comments);
    updateCommentCount(activePost.commentCount);
  }

  function setCommentError(msg) {
    var el = $('#forum-comment-form-error');
    if (!el) return;
    if (msg) {
      el.hidden = false;
      el.textContent = msg;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  async function submitComment() {
    var repo = window.SA_WEB_FORUM;
    if (!repo || !forumCtx || forumCtx.isGuest || !activePost) return;

    var input = $('#forum-comment-input');
    var btn = $('#forum-comment-submit');
    var content = input ? input.value : '';

    setCommentError('');
    if (btn) btn.disabled = true;

    var isReply = !!(replyTarget && replyTarget.commentId);
    var result;

    if (isReply) {
      result = await repo.addQuotedCommentReply(
        activePost.id,
        content,
        replyTarget,
        activePost,
        forumCtx,
        activeMode
      );
    } else {
      result = await repo.addComment(activePost.id, content, activePost, forumCtx, activeMode);
    }

    if (btn) btn.disabled = false;

    if (!result.ok) {
      setCommentError(result.error || (isReply ? 'Yanıt gönderilemedi.' : 'Yorum gönderilemedi.'));
      return;
    }

    if (input) input.value = '';
    if (isReply) clearReplyTarget();

    activePost.commentCount = Number(activePost.commentCount || 0) + 1;

    var refreshed = await repo.getPost(activePost.id);
    if (refreshed.ok && refreshed.post) {
      activePost = refreshed.post;
    }

    updateCommentCount(activePost.commentCount);
    await refreshComments();
  }

  function bindCommentForm() {
    var form = $('#forum-comment-form');
    if (!form || form.getAttribute('data-bound') === '1') return;
    form.setAttribute('data-bound', '1');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitComment();
    });
    bindReplyTargetClear();
  }

  async function loadPostPage() {
    var repo = window.SA_WEB_FORUM;
    if (!repo) return;

    var q = readQuery();
    if (!q.postId) {
      showForbidden('Geçersiz konu bağlantısı.');
      return;
    }

    var loading = $('#forum-post-loading');
    var shell = $('#forum-post-shell');
    if (loading) loading.hidden = false;

    var postResult = await repo.getPost(q.postId);
    if (loading) loading.hidden = true;

    if (!postResult.ok || !postResult.post) {
      showForbidden(postResult.error || 'Konu bulunamadı.');
      return;
    }

    activePost = postResult.post;
    activeMode = q.mode;

    if (activeMode !== 'global' && activeMode !== 'institution') {
      activeMode = repo.inferPostMode(activePost, forumCtx);
    }

    if (!activeMode) {
      showForbidden('Bu konuya erişim izniniz yok.');
      return;
    }

    var visible = repo.assertPostVisible(activePost, activeMode, forumCtx);
    if (!visible.ok) {
      showForbidden(visible.error);
      return;
    }

    var back = $('#forum-back-link');
    if (back) back.setAttribute('href', forumListUrl(activeMode));

    if (shell) shell.hidden = false;
    renderPostDetail(activePost, activeMode);
    await initPostLike();
    bindCommentForm();
    updateReplyTargetPreview();
    await refreshComments();
  }

  function initPage() {
    if (pageInitialized) return;
    if (!document.body || !document.body.classList.contains('page-forum-post')) return;
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
        showGuestRedirect();
        return;
      }

      forumCtx = repo.getForumContext();
      if (forumCtx.isGuest) {
        showAccessError();
        return;
      }
      loadPostPage();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
  } else {
    initPage();
  }
})();
