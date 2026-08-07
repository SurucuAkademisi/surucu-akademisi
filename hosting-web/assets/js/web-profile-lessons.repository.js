/**
 * Profilim — read lesson completion progress from Firestore (no writes).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-profile-lessons]';
  var DEFAULT_FETCH_LIMIT = 20;
  var STATS_FETCH_LIMIT = 200;

  var FALLBACK_CATEGORIES = [
    { id: 'motor_ve_arac_teknigi', title: 'Motor ve Araç Tekniği' },
    { id: 'trafik_ve_cevre_bilgisi', title: 'Trafik ve Çevre Bilgisi' },
    { id: 'ilk_yardim', title: 'İlk Yardım Bilgisi' },
    { id: 'trafik_adabi', title: 'Trafik Adabı' },
    { id: 'is_makineleri', title: 'İş Makineleri Operatörlük Dersi' }
  ];

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function timestampToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') {
      return ts.toMillis();
    }
    if (ts instanceof Date) {
      return ts.getTime();
    }
    if (typeof ts === 'number' && isFinite(ts)) {
      return ts;
    }
    if (typeof ts === 'string') {
      var parsed = Date.parse(ts);
      return isFinite(parsed) ? parsed : 0;
    }
    if (typeof ts.seconds === 'number') {
      return ts.seconds * 1000;
    }
    return 0;
  }

  function completedAtMillis(completedAt, updatedAt, lastSeenAt) {
    var ms = timestampToMillis(completedAt);
    if (ms) return ms;
    ms = timestampToMillis(updatedAt);
    if (ms) return ms;
    return timestampToMillis(lastSeenAt);
  }

  function isLessonCompleted(data) {
    if (!data || typeof data !== 'object') return false;
    if (normalizeString(data.status) === 'completed') return true;
    if (data.completed === true) return true;
    var pct = Number(data.progressPercent);
    return isFinite(pct) && pct >= 100;
  }

  function resolveCategoryId(raw) {
    var data = raw || {};
    return (
      normalizeString(data.categoryId) ||
      normalizeString(data.lessonCategoryId) ||
      normalizeString(data.category) ||
      null
    );
  }

  function resolveUnitId(raw, docId) {
    var data = raw || {};
    return (
      normalizeString(data.unitId) ||
      normalizeString(data.lessonId) ||
      (docId && docId.indexOf('__') < 0 ? normalizeString(docId) : null) ||
      null
    );
  }

  function parseProgressDocIds(id, data) {
    var docId = normalizeString(id);
    var raw = data || {};
    var categoryId = resolveCategoryId(raw);
    var unitId = resolveUnitId(raw, docId);

    if (docId.indexOf('__') >= 0) {
      var parts = docId.split('__');
      if (!categoryId) categoryId = normalizeString(parts[0]) || null;
      if (!unitId) unitId = normalizeString(parts.slice(1).join('__')) || null;
    } else if (!unitId && docId) {
      unitId = docId;
    }

    return { categoryId: categoryId, unitId: unitId };
  }

  function normalizeLessonProgressDoc(id, data, originPath) {
    var raw = data || {};
    var parsed = parseProgressDocIds(id, raw);
    var completedAt = raw.completedAt || null;
    var updatedAt = raw.updatedAt || null;
    var lastSeenAt = raw.lastSeenAt || null;
    var completed = isLessonCompleted(raw);

    return {
      id: normalizeString(id),
      uid: normalizeString(raw.uid) || null,
      categoryId: parsed.categoryId,
      categoryTitle:
        normalizeString(raw.categoryTitle) ||
        normalizeString(raw.lessonTitle) ||
        normalizeString(raw.categoryName) ||
        null,
      unitId: parsed.unitId,
      unitTitle: normalizeString(raw.unitTitle) || normalizeString(raw.title) || 'Ünite',
      status: normalizeString(raw.status) || null,
      completed: completed,
      progressPercent: isFinite(Number(raw.progressPercent)) ? Number(raw.progressPercent) : null,
      completedAt: completedAt,
      updatedAt: updatedAt,
      lastSeenAt: lastSeenAt,
      source: normalizeString(raw.source) || null,
      platform: normalizeString(raw.platform) || null,
      tenantId: normalizeString(raw.tenantId) || null,
      originPath: originPath || null,
      completedAtMs: completedAtMillis(completedAt, updatedAt, lastSeenAt)
    };
  }

  function buildDedupeKey(item) {
    if (!item) return '';
    var categoryId = normalizeString(item.categoryId);
    var unitId = normalizeString(item.unitId);
    if (categoryId && unitId) return categoryId + '__' + unitId;
    var id = normalizeString(item.id);
    if (id) return id;
    if (unitId) return '__unit__' + unitId;
    return '';
  }

  function lessonItemRank(item) {
    var it = item || {};
    var completed = it.completed === true ? 1 : 0;
    var activityMs = it.completedAtMs || 0;
    return completed * 1000000000000 + activityMs;
  }

  function mergeLessonProgressLists(lists) {
    var map = {};
    var sources = lists || [];

    function upsert(item) {
      if (!item) return;
      var key = buildDedupeKey(item);
      if (!key) return;
      var existing = map[key];
      if (!existing) {
        map[key] = item;
        return;
      }
      if (lessonItemRank(item) > lessonItemRank(existing)) {
        map[key] = item;
        return;
      }
      if (lessonItemRank(item) === lessonItemRank(existing)) {
        if (!existing.categoryTitle && item.categoryTitle) existing.categoryTitle = item.categoryTitle;
        if (!existing.unitTitle && item.unitTitle) existing.unitTitle = item.unitTitle;
        if (!existing.source && item.source) existing.source = item.source;
        if (!existing.platform && item.platform) existing.platform = item.platform;
      }
    }

    for (var s = 0; s < sources.length; s++) {
      var batch = sources[s] || [];
      for (var i = 0; i < batch.length; i++) {
        upsert(batch[i]);
      }
    }

    var merged = [];
    Object.keys(map).forEach(function (key) {
      var entry = map[key];
      if (entry && entry.completed === true) merged.push(entry);
    });

    return merged.slice().sort(function (a, b) {
      return (b.completedAtMs || 0) - (a.completedAtMs || 0);
    });
  }

  function mapSnapshotDocs(snap, uid, originPath) {
    var out = [];
    var docs = snap && snap.docs ? snap.docs : [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var data = doc.data ? doc.data() : {};
      if (uid && data.uid && normalizeString(data.uid) !== normalizeString(uid)) {
        continue;
      }
      if (!isLessonCompleted(data)) {
        continue;
      }
      out.push(normalizeLessonProgressDoc(doc.id, data, originPath));
    }
    return out;
  }

  async function fetchUserLessonProgressMirror(context, limit) {
    var db = getDb();
    var uid = normalizeString(context && context.uid);
    if (!db || !uid) {
      return { items: [], error: 'invalid_context' };
    }

    var fetchLimit =
      typeof limit === 'number' && limit > 0 ? Math.min(limit, STATS_FETCH_LIMIT) : STATS_FETCH_LIMIT;
    var originPath = 'users/' + uid + '/lessonProgress';

    try {
      var snap = await db.collection('users').doc(uid).collection('lessonProgress').limit(fetchLimit).get();
      return { items: mapSnapshotDocs(snap, uid, originPath) };
    } catch (e) {
      console.warn(LOG_PREFIX + ' lessonProgress mirror fetch failed', originPath, e);
      return { items: [], error: e };
    }
  }

  async function fetchWebLessonProgress(context, limit) {
    var db = getDb();
    var uid = normalizeString(context && context.uid);
    if (!db || !uid) {
      return { items: [], error: 'invalid_context' };
    }

    var fetchLimit =
      typeof limit === 'number' && limit > 0 ? Math.min(limit, STATS_FETCH_LIMIT) : STATS_FETCH_LIMIT;
    var originPath = 'users/' + uid + '/web_lesson_progress';

    try {
      var snap = await db
        .collection('users')
        .doc(uid)
        .collection('web_lesson_progress')
        .orderBy('completedAt', 'desc')
        .limit(fetchLimit)
        .get();
      return { items: mapSnapshotDocs(snap, uid, originPath) };
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' web_lesson_progress orderBy failed, fallback', orderErr);
      try {
        var fallbackSnap = await db
          .collection('users')
          .doc(uid)
          .collection('web_lesson_progress')
          .limit(fetchLimit)
          .get();
        return { items: mapSnapshotDocs(fallbackSnap, uid, originPath) };
      } catch (e) {
        console.warn(LOG_PREFIX + ' web_lesson_progress fetch failed', originPath, e);
        return { items: [], error: e };
      }
    }
  }

  async function fetchInstitutionLessonProgress(context, limit) {
    var db = getDb();
    if (!db) {
      return { items: [], error: 'db_unavailable' };
    }

    var tenantId = normalizeString(context.tenantId);
    var uid = normalizeString(context.uid);
    if (!tenantId || !uid) {
      return { items: [], error: 'invalid_context' };
    }

    var fetchLimit =
      typeof limit === 'number' && limit > 0 ? Math.min(limit, STATS_FETCH_LIMIT) : STATS_FETCH_LIMIT;
    var originPath = 'tenants/' + tenantId + '/lesson_progress';
    var collectionRef = db.collection('tenants').doc(tenantId).collection('lesson_progress');
    var snap;

    try {
      snap = await collectionRef
        .where('uid', '==', uid)
        .orderBy('completedAt', 'desc')
        .limit(fetchLimit)
        .get();
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' institution orderBy failed, using fallback', orderErr);
      try {
        snap = await collectionRef.where('uid', '==', uid).limit(fetchLimit).get();
      } catch (fallbackErr) {
        console.warn(LOG_PREFIX + ' institution fetch failed', originPath, fallbackErr);
        return { items: [], error: fallbackErr };
      }
    }

    return { items: mapSnapshotDocs(snap, uid, originPath) };
  }

  async function fetchPublicLessonProgress(context, limit) {
    return fetchWebLessonProgress(context, limit);
  }

  async function fetchAllCompletedLessonProgress(context) {
    var ctx = context || {};
    var kind = normalizeString(ctx.kind);
    if (!kind || kind === 'guest') {
      return { items: [], skipped: true };
    }

    var fetchLimit = STATS_FETCH_LIMIT;
    var lists = [];
    var errors = [];

    if (kind === 'institution_student') {
      var tenantResult = await fetchInstitutionLessonProgress(ctx, fetchLimit);
      lists.push((tenantResult && tenantResult.items) || []);
      if (tenantResult && tenantResult.error) errors.push(tenantResult.error);

      var mirrorResult = await fetchUserLessonProgressMirror(ctx, fetchLimit);
      lists.push((mirrorResult && mirrorResult.items) || []);
      if (mirrorResult && mirrorResult.error) errors.push(mirrorResult.error);

      var webFallbackResult = await fetchWebLessonProgress(ctx, fetchLimit);
      lists.push((webFallbackResult && webFallbackResult.items) || []);
      if (webFallbackResult && webFallbackResult.error) errors.push(webFallbackResult.error);
    } else if (kind === 'public_user') {
      var publicWebResult = await fetchWebLessonProgress(ctx, fetchLimit);
      lists.push((publicWebResult && publicWebResult.items) || []);
      if (publicWebResult && publicWebResult.error) errors.push(publicWebResult.error);

      var publicMirrorResult = await fetchUserLessonProgressMirror(ctx, fetchLimit);
      lists.push((publicMirrorResult && publicMirrorResult.items) || []);
      if (publicMirrorResult && publicMirrorResult.error) errors.push(publicMirrorResult.error);
    }

    return {
      items: mergeLessonProgressLists(lists),
      error: errors.length ? errors[0] : null
    };
  }

  async function fetchRecentLessonProgress(context, limit) {
    var ctx = context || {};
    var kind = normalizeString(ctx.kind);
    var fetchLimit =
      typeof limit === 'number' && limit > 0 ? Math.min(limit, 50) : DEFAULT_FETCH_LIMIT;

    if (!kind || kind === 'guest') {
      return { items: [], skipped: true };
    }

    var allResult = await fetchAllCompletedLessonProgress(ctx);
    var merged = (allResult && allResult.items) || [];

    return {
      items: merged.slice(0, fetchLimit),
      error: allResult.error || null
    };
  }

  function getLessonCatalogCategories() {
    var catalog = window.SA_WEB_LESSONS_CATALOG;
    if (catalog && Array.isArray(catalog.categories) && catalog.categories.length) {
      return catalog.categories.map(function (c) {
        return {
          categoryId: normalizeString(c.id),
          title: displayCategoryTitle(c.id, c.title)
        };
      });
    }
    return FALLBACK_CATEGORIES.map(function (c) {
      return {
        categoryId: c.id,
        title: c.title
      };
    });
  }

  function displayCategoryTitle(categoryId, title) {
    var id = normalizeString(categoryId);
    var label = normalizeString(title);
    if (id === 'is_makineleri') {
      return 'İş Makineleri Operatörlük Dersi';
    }
    return label || id || 'Ders';
  }

  function computeLessonStats(progressItems) {
    var list = Array.isArray(progressItems) ? progressItems : [];
    return {
      totalCount: list.length
    };
  }

  function computeLessonStatsByCategory(items, categories) {
    var list = Array.isArray(items) ? items : [];
    var catalog = Array.isArray(categories) && categories.length ? categories : getLessonCatalogCategories();
    var counts = {};

    list.forEach(function (item) {
      if (!item || !item.completed) return;
      var key = normalizeString(item.categoryId);
      if (!key) return;
      if (!counts[key]) {
        counts[key] = { count: 0, recentCompletedAtMs: 0 };
      }
      counts[key].count += 1;
      if ((item.completedAtMs || 0) > counts[key].recentCompletedAtMs) {
        counts[key].recentCompletedAtMs = item.completedAtMs || 0;
      }
    });

    return catalog.map(function (cat) {
      var categoryId = normalizeString(cat.categoryId || cat.id);
      var bucket = counts[categoryId] || { count: 0, recentCompletedAtMs: 0 };
      return {
        categoryId: categoryId,
        title: displayCategoryTitle(categoryId, cat.title),
        completedCount: bucket.count,
        recentCompletedAt: bucket.recentCompletedAtMs > 0 ? bucket.recentCompletedAtMs : null
      };
    });
  }

  window.SA_WEB_PROFILE_LESSONS = {
    normalizeLessonProgressDoc: normalizeLessonProgressDoc,
    mergeLessonProgressLists: mergeLessonProgressLists,
    fetchRecentLessonProgress: fetchRecentLessonProgress,
    fetchAllCompletedLessonProgress: fetchAllCompletedLessonProgress,
    computeLessonStats: computeLessonStats,
    computeLessonStatsByCategory: computeLessonStatsByCategory,
    getLessonCatalogCategories: getLessonCatalogCategories
  };
})();
