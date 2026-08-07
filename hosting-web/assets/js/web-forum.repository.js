/**
 * Forum repository — list, create, detail, comments (web).
 */
(function () {
  'use strict';

  var LIST_LIMIT = 20;
  var COMMENT_LIMIT = 50;
  var REPLY_LIMIT = 30;
  var FORUM_USER_PALETTE = [
    '#22d3ee',
    '#f59e0b',
    '#a78bfa',
    '#34d399',
    '#f472b6',
    '#38bdf8',
    '#fbbf24',
    '#67e8f9'
  ];

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth) return fb.auth;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.auth) {
      return window.firebase.auth();
    }
    return null;
  }

  function timestampToMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') {
      try {
        return value.toMillis();
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function getForumUserAccent(userId, userName) {
    var key = String(userId || '').trim() || String(userName || '').trim() || 'anon';
    var hash = 0;
    for (var i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash = hash & hash;
    }
    var index = Math.abs(hash) % FORUM_USER_PALETTE.length;
    var color = FORUM_USER_PALETTE[index];
    return {
      color: color,
      index: index,
      key: key
    };
  }

  function pickDisplayName(user, publicSession, webSession) {
    if (publicSession) {
      var pn = String(publicSession.displayName || publicSession.firstName || '').trim();
      if (pn) return pn;
    }
    if (webSession) {
      var wn = String(webSession.displayName || webSession.username || '').trim();
      if (wn) return wn;
    }
    if (user) {
      var dn = String(user.displayName || '').trim();
      if (dn) return dn;
      var email = String(user.email || '').trim();
      if (email && email.indexOf('@') > 0) return email.split('@')[0];
    }
    return 'Kullanıcı';
  }

  function getForumContext() {
    var auth = getAuth();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    var uid = user && user.uid ? String(user.uid).trim() : '';

    if (!uid) {
      return {
        user: null,
        uid: '',
        displayName: '',
        isGuest: true,
        isPublicUser: false,
        isInstitutionStudent: false,
        tenantId: null,
        canUseInstitutionForum: false
      };
    }

    var webSession = null;
    if (window.SA_WEB_SESSION && typeof window.SA_WEB_SESSION.requireWebStudentSession === 'function') {
      webSession = window.SA_WEB_SESSION.requireWebStudentSession();
    }

    if (webSession && webSession.tenantId) {
      return {
        user: user,
        uid: uid,
        displayName: pickDisplayName(user, null, webSession),
        isGuest: false,
        isPublicUser: false,
        isInstitutionStudent: true,
        tenantId: String(webSession.tenantId).trim(),
        canUseInstitutionForum: true
      };
    }

    var publicSession = null;
    if (window.SA_PUBLIC_SESSION && typeof window.SA_PUBLIC_SESSION.getPublicSession === 'function') {
      publicSession = window.SA_PUBLIC_SESSION.getPublicSession();
    }

    var isPublicUser = !!(publicSession && publicSession.uid === uid);

    return {
      user: user,
      uid: uid,
      displayName: pickDisplayName(user, publicSession, null),
      isGuest: false,
      isPublicUser: isPublicUser,
      isInstitutionStudent: false,
      tenantId: null,
      canUseInstitutionForum: false
    };
  }

  function normalizePost(doc) {
    var d = doc.data() || {};
    var tenantId = Object.prototype.hasOwnProperty.call(d, 'tenantId') ? d.tenantId : null;
    if (tenantId != null) tenantId = String(tenantId).trim() || null;
    return {
      id: doc.id,
      title: String(d.title || '').trim() || 'Başlıksız',
      content: String(d.content || '').trim(),
      imageUrl: String(d.imageUrl || '').trim(),
      userId: String(d.userId || '').trim(),
      userName: String(d.userName || '').trim() || 'Kullanıcı',
      tenantId: tenantId,
      status: String(d.status || '').trim() || 'active',
      likeCount: Number(d.likeCount != null ? d.likeCount : 0) || 0,
      commentCount: Number(d.commentCount != null ? d.commentCount : 0) || 0,
      createdAt: d.createdAt || null,
      createdAtMs: timestampToMillis(d.createdAt)
    };
  }

  function isGlobalTenantId(tenantId) {
    return tenantId == null || tenantId === '';
  }

  function isPostVisibleInMode(post, mode, ctx) {
    var p = post || {};
    if (String(p.status || 'active').trim() !== 'active') return false;
    var m = String(mode || '').trim();
    if (m === 'institution') {
      if (!ctx || !ctx.canUseInstitutionForum || !ctx.tenantId) return false;
      return String(p.tenantId || '') === String(ctx.tenantId).trim();
    }
    return isGlobalTenantId(p.tenantId);
  }

  function assertPostVisible(post, mode, ctx) {
    if (!post || !post.id) {
      return { ok: false, forbidden: false, error: 'Konu bulunamadı.' };
    }
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: false, forbidden: false, error: 'Bu konuyu görüntülemek için giriş yapın.' };
    }
    var m = String(mode || '').trim();
    if (m !== 'global' && m !== 'institution') {
      return { ok: false, forbidden: false, error: 'Geçersiz forum modu.' };
    }
    if (m === 'institution' && (!ctx.canUseInstitutionForum || !ctx.tenantId)) {
      return { ok: false, forbidden: true, error: 'Bu kurum konusuna erişim izniniz yok.' };
    }
    if (!isPostVisibleInMode(post, m, ctx)) {
      return { ok: false, forbidden: true, error: 'Bu konuya erişim izniniz yok.' };
    }
    return { ok: true, forbidden: false, error: null };
  }

  function inferPostMode(post, ctx) {
    if (!post) return null;
    if (isGlobalTenantId(post.tenantId)) return 'global';
    if (ctx && ctx.canUseInstitutionForum && ctx.tenantId) {
      if (String(post.tenantId || '') === String(ctx.tenantId).trim()) return 'institution';
    }
    return null;
  }

  function buildPostUrl(post, mode) {
    var id = post && post.id ? String(post.id).trim() : '';
    var m = String(mode || '').trim();
    if (!id || (m !== 'global' && m !== 'institution')) return '';
    return 'post.html?postId=' + encodeURIComponent(id) + '&mode=' + encodeURIComponent(m);
  }

  function getFieldValue() {
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) {
      return window.firebase.firestore.FieldValue;
    }
    return null;
  }

  function resolveCreateTenantId(mode, ctx) {
    var m = String(mode || '').trim();
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: false, error: 'Konu açmak için giriş yapın.' };
    }
    if (m === 'institution') {
      if (!ctx.canUseInstitutionForum || !ctx.tenantId) {
        return { ok: false, error: 'Kurum içi konu açma izniniz yok.' };
      }
      return { ok: true, tenantId: String(ctx.tenantId).trim() };
    }
    if (m === 'global') {
      if (!ctx.isInstitutionStudent && !ctx.isPublicUser && !ctx.uid) {
        return { ok: false, error: 'Konu açılamadı.' };
      }
      if (ctx.isPublicUser || ctx.isInstitutionStudent || ctx.uid) {
        return { ok: true, tenantId: null };
      }
    }
    return { ok: false, error: 'Geçersiz forum modu.' };
  }

  function truncatePreview(text, maxLen) {
    var s = String(text || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    var limit = maxLen || 160;
    if (s.length <= limit) return s;
    return s.slice(0, limit - 1) + '…';
  }

  function normalizeComment(doc) {
    var d = doc.data() || {};
    var tenantId = Object.prototype.hasOwnProperty.call(d, 'tenantId') ? d.tenantId : null;
    if (tenantId != null) tenantId = String(tenantId).trim() || null;
    var replyToCommentId = String(d.replyToCommentId || '').trim();
    var isReply = d.isReply === true || !!replyToCommentId;
    return {
      id: doc.id,
      content: String(d.content || '').trim(),
      userId: String(d.userId || '').trim(),
      userName: String(d.userName || '').trim() || 'Kullanıcı',
      tenantId: tenantId,
      likeCount: Number(d.likeCount != null ? d.likeCount : 0) || 0,
      dislikeCount: Number(d.dislikeCount != null ? d.dislikeCount : 0) || 0,
      replyCount: Number(d.replyCount != null ? d.replyCount : 0) || 0,
      isReply: isReply,
      replyToCommentId: replyToCommentId,
      replyToUserId: String(d.replyToUserId || '').trim(),
      replyToUserName: String(d.replyToUserName || '').trim(),
      replyToContentPreview: String(d.replyToContentPreview || '').trim(),
      createdAt: d.createdAt || null,
      createdAtMs: timestampToMillis(d.createdAt)
    };
  }

  function sortPostsByCreatedDesc(posts) {
    return (posts || []).slice().sort(function (a, b) {
      return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
    });
  }

  function mergeUniqueDocs(primaryDocs, extraDocs) {
    var seen = {};
    var out = [];
    (primaryDocs || []).forEach(function (doc) {
      if (!doc || !doc.id || seen[doc.id]) return;
      seen[doc.id] = true;
      out.push(doc);
    });
    (extraDocs || []).forEach(function (doc) {
      if (!doc || !doc.id || seen[doc.id]) return;
      seen[doc.id] = true;
      out.push(doc);
    });
    return out;
  }

  async function listPosts(mode, ctx) {
    var m = String(mode || '').trim();
    if (m !== 'global' && m !== 'institution') {
      return { ok: false, posts: [], error: 'Geçersiz forum modu.' };
    }
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: true, authenticated: false, posts: [], error: null };
    }

    if (m === 'institution') {
      if (!ctx.canUseInstitutionForum || !ctx.tenantId) {
        return { ok: false, posts: [], error: 'Kurum içi forum için oturum gerekli.' };
      }
    }

    var db = getDb();
    if (!db) {
      return { ok: false, posts: [], error: 'Veritabanı hazır değil.' };
    }

    try {
      var docs = [];

      if (m === 'institution') {
        var instSnap = await db
          .collection('forum_posts')
          .where('status', '==', 'active')
          .where('tenantId', '==', String(ctx.tenantId).trim())
          .orderBy('createdAt', 'desc')
          .limit(LIST_LIMIT)
          .get();
        docs = instSnap.docs;
      } else {
        var globalSnap = await db
          .collection('forum_posts')
          .where('status', '==', 'active')
          .where('tenantId', '==', null)
          .orderBy('createdAt', 'desc')
          .limit(LIST_LIMIT)
          .get();

        var mergedDocs = mergeUniqueDocs(globalSnap.docs, []);
        try {
          var legacySnap = await db
            .collection('forum_posts')
            .where('status', '==', 'active')
            .limit(50)
            .get();
          var legacyOnly = legacySnap.docs.filter(function (doc) {
            var data = doc.data() || {};
            return !Object.prototype.hasOwnProperty.call(data, 'tenantId');
          });
          mergedDocs = mergeUniqueDocs(globalSnap.docs, legacyOnly);
        } catch (legacyErr) {
          console.warn('[WebForum] legacy global merge skipped', legacyErr);
        }
        docs = mergedDocs;
      }

      var posts = sortPostsByCreatedDesc(
        docs
          .map(function (doc) {
            return normalizePost(doc);
          })
          .filter(function (p) {
            return isPostVisibleInMode(p, m, ctx);
          })
      ).slice(0, LIST_LIMIT);

      return { ok: true, authenticated: true, posts: posts, error: null };
    } catch (e) {
      console.warn('[WebForum] load failed', e);
      return {
        ok: false,
        authenticated: true,
        posts: [],
        error: (e && e.message) ? String(e.message) : 'Forum gönderileri yüklenemedi.'
      };
    }
  }

  async function createPost(payload, ctx) {
    var mode = payload && payload.mode ? String(payload.mode).trim() : '';
    var title = payload && payload.title ? String(payload.title).trim() : '';
    var content = payload && payload.content ? String(payload.content).trim() : '';

    if (!title) return { ok: false, postId: null, error: 'Başlık boş olamaz.' };
    if (!content) return { ok: false, postId: null, error: 'İçerik boş olamaz.' };
    if (mode !== 'global' && mode !== 'institution') {
      return { ok: false, postId: null, error: 'Geçersiz forum modu.' };
    }
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: false, postId: null, error: 'Konu açmak için giriş yapın.' };
    }
    if (ctx.isPublicUser && mode !== 'global') {
      return { ok: false, postId: null, error: 'Ücretsiz üyeler yalnızca Türkiye Geneli forumda konu açabilir.' };
    }
    if (mode === 'institution' && !ctx.canUseInstitutionForum) {
      return { ok: false, postId: null, error: 'Kurum içi konu açma izniniz yok.' };
    }

    var tenantResolved = resolveCreateTenantId(mode, ctx);
    if (!tenantResolved.ok) {
      return { ok: false, postId: null, error: tenantResolved.error };
    }

    var db = getDb();
    var fv = getFieldValue();
    if (!db || !fv) {
      return { ok: false, postId: null, error: 'Veritabanı hazır değil.' };
    }

    var now = fv.serverTimestamp();
    var postData = {
      title: title,
      content: content,
      imageUrl: null,
      userId: ctx.uid,
      userName: ctx.displayName || 'Kullanıcı',
      tenantId: tenantResolved.tenantId,
      likeCount: 0,
      commentCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now
    };

    try {
      var ref = await db.collection('forum_posts').add(postData);
      console.log('[WebForum] post created', {
        postId: ref.id,
        mode: mode,
        tenantId: tenantResolved.tenantId
      });
      return { ok: true, postId: ref.id, error: null };
    } catch (e) {
      console.warn('[WebForum] create/comment failed', e);
      return {
        ok: false,
        postId: null,
        error: (e && e.message) ? String(e.message) : 'Konu yayınlanamadı.'
      };
    }
  }

  async function getPost(postId) {
    var id = String(postId || '').trim();
    if (!id) return { ok: false, post: null, error: 'Geçersiz konu.' };

    var db = getDb();
    if (!db) return { ok: false, post: null, error: 'Veritabanı hazır değil.' };

    try {
      var snap = await db.collection('forum_posts').doc(id).get();
      if (!snap.exists) {
        return { ok: false, post: null, error: 'Konu bulunamadı.' };
      }
      return { ok: true, post: normalizePost(snap), error: null };
    } catch (e) {
      console.warn('[WebForum] create/comment failed', e);
      return {
        ok: false,
        post: null,
        error: (e && e.message) ? String(e.message) : 'Konu yüklenemedi.'
      };
    }
  }

  async function listComments(postId) {
    var id = String(postId || '').trim();
    if (!id) return { ok: false, comments: [], error: 'Geçersiz konu.' };

    var db = getDb();
    if (!db) return { ok: false, comments: [], error: 'Veritabanı hazır değil.' };

    try {
      var snap = await db
        .collection('forum_posts')
        .doc(id)
        .collection('comments')
        .orderBy('createdAt', 'asc')
        .limit(COMMENT_LIMIT)
        .get();

      var comments = snap.docs.map(function (doc) {
        return normalizeComment(doc);
      });

      console.log('[WebForum] comments loaded', { postId: id, count: comments.length });
      return { ok: true, comments: comments, error: null };
    } catch (e) {
      console.warn('[WebForum] create/comment failed', e);
      return {
        ok: false,
        comments: [],
        error: (e && e.message) ? String(e.message) : 'Yorumlar yüklenemedi.'
      };
    }
  }

  async function addComment(postId, content, post, ctx, mode) {
    var id = String(postId || '').trim();
    var text = String(content || '').trim();
    if (!text) return { ok: false, error: 'Yorum boş olamaz.' };
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: false, error: 'Yorum yazmak için giriş yapın.' };
    }

    var visible = assertPostVisible(post, mode, ctx);
    if (!visible.ok) {
      return { ok: false, error: visible.error || 'Bu konuya yorum yazılamaz.' };
    }

    var db = getDb();
    var fv = getFieldValue();
    if (!db || !fv) return { ok: false, error: 'Veritabanı hazır değil.' };

    var commentTenantId = null;
    if (post && !isGlobalTenantId(post.tenantId)) {
      commentTenantId = post.tenantId;
    }

    try {
      var postRef = db.collection('forum_posts').doc(id);
      var commentRef = postRef.collection('comments').doc();
      var batch = db.batch();
      batch.set(commentRef, {
        content: text,
        userId: ctx.uid,
        userName: ctx.displayName || 'Kullanıcı',
        tenantId: commentTenantId,
        createdAt: fv.serverTimestamp(),
        likeCount: 0,
        dislikeCount: 0,
        replyCount: 0
      });
      batch.update(postRef, {
        commentCount: fv.increment(1)
      });
      await batch.commit();
      return { ok: true, error: null };
    } catch (e) {
      console.warn('[WebForum] create/comment failed', e);
      return {
        ok: false,
        error: (e && e.message) ? String(e.message) : 'Yorum gönderilemedi.'
      };
    }
  }

  async function addQuotedCommentReply(postId, content, replyTarget, post, ctx, mode) {
    var id = String(postId || '').trim();
    var text = String(content || '').trim();
    var target = replyTarget || {};

    if (!text) return { ok: false, commentId: null, error: 'Yanıt boş olamaz.' };
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: false, commentId: null, error: 'Yanıt yazmak için giriş yapın.' };
    }
    if (!String(target.commentId || '').trim()) {
      return { ok: false, commentId: null, error: 'Yanıtlanan yorum bulunamadı.' };
    }

    var visible = assertPostVisible(post, mode, ctx);
    if (!visible.ok) {
      return { ok: false, commentId: null, error: visible.error || 'Bu konuya yanıt yazılamaz.' };
    }

    var db = getDb();
    var fv = getFieldValue();
    if (!db || !fv) return { ok: false, commentId: null, error: 'Veritabanı hazır değil.' };

    var commentTenantId = null;
    if (post && !isGlobalTenantId(post.tenantId)) {
      commentTenantId = post.tenantId;
    }

    var previewSource = String(target.contentPreview || target.content || '').trim();
    if (!previewSource && target.commentId) {
      previewSource = '';
    }

    try {
      var postRef = db.collection('forum_posts').doc(id);
      var commentRef = postRef.collection('comments').doc();
      var batch = db.batch();

      batch.set(commentRef, {
        content: text,
        userId: ctx.uid,
        userName: ctx.displayName || 'Kullanıcı',
        tenantId: commentTenantId,
        createdAt: fv.serverTimestamp(),
        likeCount: 0,
        dislikeCount: 0,
        replyCount: 0,
        isReply: true,
        replyToCommentId: String(target.commentId).trim(),
        replyToUserId: String(target.userId || '').trim(),
        replyToUserName: String(target.userName || '').trim() || 'Kullanıcı',
        replyToContentPreview: truncatePreview(previewSource, 160)
      });
      batch.update(postRef, {
        commentCount: fv.increment(1)
      });

      await batch.commit();

      console.log('[WebForum] quoted reply added', {
        postId: id,
        replyToCommentId: String(target.commentId).trim()
      });
      return { ok: true, commentId: commentRef.id, error: null };
    } catch (e) {
      console.warn('[WebForum] reply failed', e);
      return {
        ok: false,
        commentId: null,
        error: (e && e.message) ? String(e.message) : 'Yanıt gönderilemedi.'
      };
    }
  }

  async function hasUserLikedPost(postId, uid) {
    var id = String(postId || '').trim();
    var userId = String(uid || '').trim();
    if (!id || !userId) {
      return { ok: true, liked: false };
    }

    var db = getDb();
    if (!db) return { ok: false, liked: false, error: 'Veritabanı hazır değil.' };

    try {
      var snap = await db.collection('forum_posts').doc(id).collection('likes').doc(userId).get();
      return { ok: true, liked: snap.exists };
    } catch (e) {
      return { ok: false, liked: false, error: (e && e.message) ? String(e.message) : 'Beğeni durumu okunamadı.' };
    }
  }

  async function togglePostLike(postId, ctx) {
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: false, liked: false, likeCount: null, error: 'Beğenmek için giriş yapın.' };
    }

    var id = String(postId || '').trim();
    if (!id) {
      return { ok: false, liked: false, likeCount: null, error: 'Geçersiz konu.' };
    }

    var postResult = await getPost(id);
    if (!postResult.ok || !postResult.post) {
      return { ok: false, liked: false, likeCount: null, error: postResult.error || 'Konu bulunamadı.' };
    }

    var post = postResult.post;
    var mode = inferPostMode(post, ctx);
    if (!mode) {
      return { ok: false, liked: false, likeCount: null, error: 'Bu konuya erişim izniniz yok.' };
    }

    var visible = assertPostVisible(post, mode, ctx);
    if (!visible.ok) {
      return { ok: false, liked: false, likeCount: null, error: visible.error || 'Bu konuya erişim izniniz yok.' };
    }

    var db = getDb();
    var fv = getFieldValue();
    if (!db || !fv) {
      return { ok: false, liked: false, likeCount: null, error: 'Veritabanı hazır değil.' };
    }

    var likeRef = db.collection('forum_posts').doc(id).collection('likes').doc(ctx.uid);
    var postRef = db.collection('forum_posts').doc(id);

    try {
      var likeSnap = await likeRef.get();
      var batch = db.batch();
      var liked = false;
      var delta = 0;

      if (likeSnap.exists) {
        batch.delete(likeRef);
        batch.update(postRef, { likeCount: fv.increment(-1) });
        liked = false;
        delta = -1;
      } else {
        batch.set(likeRef, { createdAt: fv.serverTimestamp() });
        batch.update(postRef, { likeCount: fv.increment(1) });
        liked = true;
        delta = 1;
      }

      await batch.commit();

      var refreshed = await getPost(id);
      var likeCount = refreshed.ok && refreshed.post
        ? Number(refreshed.post.likeCount || 0)
        : Math.max(0, Number(post.likeCount || 0) + delta);

      console.log('[WebForum] post like toggled', { postId: id, liked: liked });
      return { ok: true, liked: liked, likeCount: likeCount, likeCountDelta: delta, error: null };
    } catch (e) {
      console.warn('[WebForum] post like failed', e);
      return {
        ok: false,
        liked: false,
        likeCount: null,
        error: (e && e.message) ? String(e.message) : 'Beğenme işlemi başarısız.'
      };
    }
  }

  function normalizeReply(doc) {
    var d = doc.data() || {};
    var tenantId = Object.prototype.hasOwnProperty.call(d, 'tenantId') ? d.tenantId : null;
    if (tenantId != null) tenantId = String(tenantId).trim() || null;
    return {
      id: doc.id,
      content: String(d.content || '').trim(),
      userId: String(d.userId || '').trim(),
      userName: String(d.userName || '').trim() || 'Kullanıcı',
      tenantId: tenantId,
      createdAt: d.createdAt || null,
      createdAtMs: timestampToMillis(d.createdAt)
    };
  }

  async function listReplies(postId, commentId) {
    var pid = String(postId || '').trim();
    var cid = String(commentId || '').trim();
    if (!pid || !cid) {
      return { ok: false, replies: [], error: 'Geçersiz yorum.' };
    }

    var db = getDb();
    if (!db) return { ok: false, replies: [], error: 'Veritabanı hazır değil.' };

    try {
      var snap = await db
        .collection('forum_posts')
        .doc(pid)
        .collection('comments')
        .doc(cid)
        .collection('replies')
        .orderBy('createdAt', 'asc')
        .limit(REPLY_LIMIT)
        .get();

      var replies = snap.docs.map(function (doc) {
        return normalizeReply(doc);
      });

      console.log('[WebForum] replies loaded', { commentId: cid, count: replies.length });
      return { ok: true, replies: replies, error: null };
    } catch (e) {
      console.warn('[WebForum] reply failed', e);
      return {
        ok: false,
        replies: [],
        error: (e && e.message) ? String(e.message) : 'Yanıtlar yüklenemedi.'
      };
    }
  }

  async function addReply(postId, commentId, content, post, ctx, mode) {
    var pid = String(postId || '').trim();
    var cid = String(commentId || '').trim();
    var text = String(content || '').trim();

    if (!text) return { ok: false, replyId: null, error: 'Yanıt boş olamaz.' };
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: false, replyId: null, error: 'Yanıt yazmak için giriş yapın.' };
    }
    if (!pid || !cid) {
      return { ok: false, replyId: null, error: 'Geçersiz yorum.' };
    }

    var visible = assertPostVisible(post, mode, ctx);
    if (!visible.ok) {
      return { ok: false, replyId: null, error: visible.error || 'Bu konuya yanıt yazılamaz.' };
    }

    var db = getDb();
    var fv = getFieldValue();
    if (!db || !fv) return { ok: false, replyId: null, error: 'Veritabanı hazır değil.' };

    var replyTenantId = null;
    if (post && !isGlobalTenantId(post.tenantId)) {
      replyTenantId = post.tenantId;
    }

    try {
      var postRef = db.collection('forum_posts').doc(pid);
      var commentRef = postRef.collection('comments').doc(cid);
      var replyRef = commentRef.collection('replies').doc();
      var batch = db.batch();

      batch.set(replyRef, {
        content: text,
        userId: ctx.uid,
        userName: ctx.displayName || 'Kullanıcı',
        tenantId: replyTenantId,
        createdAt: fv.serverTimestamp()
      });
      batch.update(commentRef, {
        replyCount: fv.increment(1)
      });

      await batch.commit();

      console.log('[WebForum] reply added', { postId: pid, commentId: cid });
      return { ok: true, replyId: replyRef.id, error: null };
    } catch (e) {
      console.warn('[WebForum] reply failed', e);
      return {
        ok: false,
        replyId: null,
        error: (e && e.message) ? String(e.message) : 'Yanıt gönderilemedi.'
      };
    }
  }

  async function getCommentReaction(postId, commentId, uid) {
    var pid = String(postId || '').trim();
    var cid = String(commentId || '').trim();
    var userId = String(uid || '').trim();
    if (!pid || !cid || !userId) {
      return { ok: true, reaction: null };
    }

    var db = getDb();
    if (!db) return { ok: false, reaction: null, error: 'Veritabanı hazır değil.' };

    try {
      var snap = await db
        .collection('forum_posts')
        .doc(pid)
        .collection('comments')
        .doc(cid)
        .collection('reactions')
        .doc(userId)
        .get();
      if (!snap.exists) {
        return { ok: true, reaction: null };
      }
      var type = String((snap.data() || {}).type || '').trim();
      if (type !== 'like' && type !== 'dislike') {
        return { ok: true, reaction: null };
      }
      return { ok: true, reaction: type };
    } catch (e) {
      return {
        ok: false,
        reaction: null,
        error: (e && e.message) ? String(e.message) : 'Tepki okunamadı.'
      };
    }
  }

  async function loadCommentReactionsForCurrentUser(postId, comments, uid) {
    var pid = String(postId || '').trim();
    var userId = String(uid || '').trim();
    var list = Array.isArray(comments) ? comments : [];
    var reactions = {};

    if (!pid || !userId || !list.length) {
      return { ok: true, reactions: reactions };
    }

    try {
      await Promise.all(
        list.map(function (c) {
          return getCommentReaction(pid, c.id, userId).then(function (res) {
            reactions[c.id] = res.ok ? res.reaction : null;
          });
        })
      );
      return { ok: true, reactions: reactions };
    } catch (e) {
      return {
        ok: false,
        reactions: reactions,
        error: (e && e.message) ? String(e.message) : 'Tepkiler yüklenemedi.'
      };
    }
  }

  async function toggleCommentReaction(postId, commentId, reactionType, post, ctx, mode) {
    var type = String(reactionType || '').trim();
    if (type !== 'like' && type !== 'dislike') {
      return { ok: false, reaction: null, likeDelta: 0, dislikeDelta: 0, error: 'Geçersiz tepki.' };
    }
    if (!ctx || ctx.isGuest || !ctx.uid) {
      return { ok: false, reaction: null, likeDelta: 0, dislikeDelta: 0, error: 'Tepki vermek için giriş yapın.' };
    }

    var pid = String(postId || '').trim();
    var cid = String(commentId || '').trim();
    if (!pid || !cid) {
      return { ok: false, reaction: null, likeDelta: 0, dislikeDelta: 0, error: 'Geçersiz yorum.' };
    }

    var visible = assertPostVisible(post, mode, ctx);
    if (!visible.ok) {
      return {
        ok: false,
        reaction: null,
        likeDelta: 0,
        dislikeDelta: 0,
        error: visible.error || 'Bu konuya tepki verilemez.'
      };
    }

    var db = getDb();
    var fv = getFieldValue();
    if (!db || !fv) {
      return { ok: false, reaction: null, likeDelta: 0, dislikeDelta: 0, error: 'Veritabanı hazır değil.' };
    }

    var postRef = db.collection('forum_posts').doc(pid);
    var commentRef = postRef.collection('comments').doc(cid);
    var reactionRef = commentRef.collection('reactions').doc(ctx.uid);

    try {
      var reactionSnap = await reactionRef.get();
      var batch = db.batch();
      var likeDelta = 0;
      var dislikeDelta = 0;
      var newReaction = null;
      var now = fv.serverTimestamp();

      if (!reactionSnap.exists) {
        batch.set(reactionRef, { type: type, createdAt: now });
        if (type === 'like') {
          batch.update(commentRef, { likeCount: fv.increment(1) });
          likeDelta = 1;
        } else {
          batch.update(commentRef, { dislikeCount: fv.increment(1) });
          dislikeDelta = 1;
        }
        newReaction = type;
      } else {
        var current = String((reactionSnap.data() || {}).type || '').trim();
        if (current === type) {
          batch.delete(reactionRef);
          if (type === 'like') {
            batch.update(commentRef, { likeCount: fv.increment(-1) });
            likeDelta = -1;
          } else {
            batch.update(commentRef, { dislikeCount: fv.increment(-1) });
            dislikeDelta = -1;
          }
          newReaction = null;
        } else {
          batch.update(reactionRef, { type: type, updatedAt: now });
          if (current === 'like') {
            batch.update(commentRef, {
              likeCount: fv.increment(-1),
              dislikeCount: fv.increment(1)
            });
            likeDelta = -1;
            dislikeDelta = 1;
          } else {
            batch.update(commentRef, {
              likeCount: fv.increment(1),
              dislikeCount: fv.increment(-1)
            });
            likeDelta = 1;
            dislikeDelta = -1;
          }
          newReaction = type;
        }
      }

      await batch.commit();

      console.log('[WebForum] comment reaction toggled', {
        postId: pid,
        commentId: cid,
        reaction: newReaction
      });

      return {
        ok: true,
        reaction: newReaction,
        likeDelta: likeDelta,
        dislikeDelta: dislikeDelta,
        error: null
      };
    } catch (e) {
      console.warn('[WebForum] comment reaction failed', e);
      return {
        ok: false,
        reaction: null,
        likeDelta: 0,
        dislikeDelta: 0,
        error: (e && e.message) ? String(e.message) : 'Tepki gönderilemedi.'
      };
    }
  }

  window.SA_WEB_FORUM = {
    getDb: getDb,
    getAuth: getAuth,
    getForumContext: getForumContext,
    getForumUserAccent: getForumUserAccent,
    listPosts: listPosts,
    normalizePost: normalizePost,
    normalizeComment: normalizeComment,
    isPostVisibleInMode: isPostVisibleInMode,
    assertPostVisible: assertPostVisible,
    inferPostMode: inferPostMode,
    buildPostUrl: buildPostUrl,
    createPost: createPost,
    getPost: getPost,
    listComments: listComments,
    addComment: addComment,
    addQuotedCommentReply: addQuotedCommentReply,
    hasUserLikedPost: hasUserLikedPost,
    togglePostLike: togglePostLike,
    getCommentReaction: getCommentReaction,
    loadCommentReactionsForCurrentUser: loadCommentReactionsForCurrentUser,
    toggleCommentReaction: toggleCommentReaction,
    normalizeReply: normalizeReply,
    listReplies: listReplies,
    addReply: addReply
  };
})();
