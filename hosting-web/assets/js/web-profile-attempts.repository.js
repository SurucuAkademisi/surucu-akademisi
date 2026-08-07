/**
 * Profilim — read exam attempt summaries from Firestore (no writes).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-profile-attempts]';
  var DEFAULT_FETCH_LIMIT = 20;
  var STATS_FETCH_LIMIT = 200;
  var MAX_PER_SOURCE_FETCH = 250;
  var DEFAULT_BRAND_TENANT_ID = 'surucu_akademisi';

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function resolveDefaultBrandTenantId() {
    var catalog = window.SA_WEB_EXAM_CATALOG;
    if (catalog && catalog.SHARED_EXAM_TENANT_ID) {
      var id = String(catalog.SHARED_EXAM_TENANT_ID).trim();
      if (id) return id;
    }
    var brand = window.SA_WEB_TENANT_BRAND;
    if (brand && brand.DEFAULT_BRAND_TENANT_ID) {
      var bid = String(brand.DEFAULT_BRAND_TENANT_ID).trim();
      if (bid) return bid;
    }
    return DEFAULT_BRAND_TENANT_ID;
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function toNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback != null ? fallback : 0;
  }

  function completedAtMillis(completedAt, createdAt) {
    var ms = timestampToMillis(completedAt);
    if (ms) return ms;
    return timestampToMillis(createdAt);
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

  function normalizeAttemptDoc(id, data, originPath) {
    var raw = data || {};
    var scorePercent = toNumber(raw.scorePercent, NaN);
    if (!isFinite(scorePercent)) {
      scorePercent = toNumber(raw.percentage, 0);
    }
    scorePercent = Math.max(0, Math.min(100, Math.round(scorePercent)));

    var durationSeconds = toNumber(raw.durationSeconds, NaN);
    if (!isFinite(durationSeconds)) {
      durationSeconds = toNumber(raw.elapsedSeconds, 0);
    }

    var completedAt = raw.completedAt || null;
    var createdAt = raw.createdAt || null;

    return {
      id: normalizeString(id),
      uid: normalizeString(raw.uid) || null,
      examId: normalizeString(raw.examId) || null,
      examTitle: normalizeString(raw.examTitle) || 'Sınav',
      category: normalizeString(raw.category) || null,
      categoryLabel: normalizeString(raw.categoryLabel) || null,
      scorePercent: scorePercent,
      correctCount: toNumber(raw.correctCount, 0),
      wrongCount: toNumber(raw.wrongCount, 0),
      blankCount: toNumber(raw.blankCount, 0),
      totalQuestions: toNumber(raw.totalQuestions, 0),
      durationSeconds: durationSeconds,
      completedAt: completedAt,
      createdAt: createdAt,
      completedAtMs: completedAtMillis(completedAt, createdAt),
      source: normalizeString(raw.source) || null,
      platform: normalizeString(raw.platform) || null,
      tenantId: normalizeString(raw.tenantId) || null,
      originPath: originPath || null
    };
  }

  function buildAttemptDedupeKey(attempt) {
    var item = attempt || {};
    var examId = normalizeString(item.examId) || '_';
    var completedAtMs = item.completedAtMs || 0;
    var scorePercent = toNumber(item.scorePercent, 0);
    if (completedAtMs > 0) {
      return examId + '|' + String(completedAtMs) + '|' + String(scorePercent);
    }
    return normalizeString(item.id) || examId + '|' + String(scorePercent);
  }

  function mergeDedupeAttempts(lists, limit) {
    var seen = {};
    var merged = [];
    var sources = lists || [];
    for (var s = 0; s < sources.length; s++) {
      var batch = sources[s] || [];
      for (var i = 0; i < batch.length; i++) {
        var item = batch[i];
        if (!item) continue;
        var key = buildAttemptDedupeKey(item);
        if (seen[key]) continue;
        seen[key] = true;
        merged.push(item);
      }
    }
    merged.sort(function (a, b) {
      return (b.completedAtMs || 0) - (a.completedAtMs || 0);
    });
    if (typeof limit === 'number' && limit > 0) {
      return merged.slice(0, limit);
    }
    return merged;
  }

  function sortAttemptsDesc(attempts) {
    return (attempts || []).slice().sort(function (a, b) {
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
      out.push(normalizeAttemptDoc(doc.id, data, originPath));
    }
    return sortAttemptsDesc(out);
  }

  async function queryTenantExamAttempts(db, tenantId, uid, limit, originPath) {
    var collectionRef = db.collection('tenants').doc(tenantId).collection('exam_attempts');
    var snap;
    try {
      snap = await collectionRef
        .where('uid', '==', uid)
        .orderBy('completedAt', 'desc')
        .limit(limit)
        .get();
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' tenant exam orderBy failed (' + originPath + ')', orderErr);
      snap = await collectionRef.where('uid', '==', uid).limit(limit).get();
    }
    return mapSnapshotDocs(snap, uid, originPath);
  }

  async function queryWebExamAttempts(db, uid, limit) {
    var originPath = 'users/' + uid + '/web_exam_attempts';
    var collectionRef = db.collection('users').doc(uid).collection('web_exam_attempts');
    var snap;
    try {
      snap = await collectionRef.orderBy('completedAt', 'desc').limit(limit).get();
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' web_exam_attempts orderBy failed', orderErr);
      snap = await collectionRef.limit(limit).get();
    }
    return mapSnapshotDocs(snap, uid, originPath);
  }

  async function fetchTenantExamAttemptsRaw(db, tenantId, uid, limit) {
    if (!tenantId || !uid) return [];
    try {
      return await queryTenantExamAttempts(
        db,
        tenantId,
        uid,
        limit,
        'tenants/' + tenantId + '/exam_attempts'
      );
    } catch (e) {
      console.warn(LOG_PREFIX + ' tenant exam fetch failed', tenantId, e);
      return [];
    }
  }

  async function fetchWebExamAttemptsRaw(db, uid, limit) {
    if (!uid) return [];
    try {
      return await queryWebExamAttempts(db, uid, limit);
    } catch (e) {
      console.warn(LOG_PREFIX + ' web_exam_attempts fetch failed', e);
      return [];
    }
  }

  async function collectExamAttemptSourceLists(db, userId, kind, tenantId, perSourceLimit) {
    var brandTenantId = resolveDefaultBrandTenantId();
    var lists = [];

    if (kind === 'public_user') {
      lists.push(await fetchWebExamAttemptsRaw(db, userId, perSourceLimit));
      if (brandTenantId) {
        lists.push(await fetchTenantExamAttemptsRaw(db, brandTenantId, userId, perSourceLimit));
      }
    } else if (kind === 'institution_student') {
      if (tenantId) {
        lists.push(await fetchTenantExamAttemptsRaw(db, tenantId, userId, perSourceLimit));
      }
      lists.push(await fetchWebExamAttemptsRaw(db, userId, perSourceLimit));
    } else {
      lists.push(await fetchWebExamAttemptsRaw(db, userId, perSourceLimit));
      if (tenantId) {
        lists.push(await fetchTenantExamAttemptsRaw(db, tenantId, userId, perSourceLimit));
      } else if (brandTenantId) {
        lists.push(await fetchTenantExamAttemptsRaw(db, brandTenantId, userId, perSourceLimit));
      }
    }

    return lists;
  }

  async function fetchMergedExamAttempts(uid, options) {
    var opts = options || {};
    var db = getDb();
    if (!db) {
      return { attempts: [], error: 'db_unavailable' };
    }

    var userId = normalizeString(uid);
    if (!userId) {
      return { attempts: [], error: 'invalid_context' };
    }

    var fetchLimit =
      typeof opts.limit === 'number' && opts.limit > 0 ? Math.min(opts.limit, 50) : DEFAULT_FETCH_LIMIT;
    var perSourceLimit = Math.min(fetchLimit * 2, 50);
    var kind = normalizeString(opts.kind);
    var tenantId = normalizeString(opts.tenantId);
    var lists = await collectExamAttemptSourceLists(db, userId, kind, tenantId, perSourceLimit);

    return { attempts: mergeDedupeAttempts(lists, fetchLimit) };
  }

  async function fetchExamAttemptSummary(context, options) {
    var ctx = context || {};
    var opts = options || {};
    var kind = normalizeString(ctx.kind);

    if (!kind || kind === 'guest') {
      return {
        attempts: [],
        allAttempts: [],
        stats: computeAttemptStats([]),
        skipped: true
      };
    }

    var recentLimit =
      typeof opts.recentLimit === 'number' && opts.recentLimit > 0
        ? Math.min(opts.recentLimit, 50)
        : DEFAULT_FETCH_LIMIT;
    var statsLimit =
      typeof opts.statsLimit === 'number' && opts.statsLimit > 0
        ? Math.min(opts.statsLimit, 500)
        : STATS_FETCH_LIMIT;
    var perSourceLimit = Math.min(statsLimit * 2, MAX_PER_SOURCE_FETCH);

    var uid = normalizeString(ctx.uid);
    var tenantId = normalizeString(ctx.tenantId);
    var db = getDb();
    if (!db) {
      return {
        attempts: [],
        allAttempts: [],
        stats: computeAttemptStats([]),
        error: 'db_unavailable'
      };
    }
    if (!uid) {
      return {
        attempts: [],
        allAttempts: [],
        stats: computeAttemptStats([]),
        error: 'invalid_context'
      };
    }

    var lists = await collectExamAttemptSourceLists(db, uid, kind, tenantId, perSourceLimit);
    var allMergedAttempts = mergeDedupeAttempts(lists, statsLimit);
    var recentAttempts = allMergedAttempts.slice(0, recentLimit);

    return {
      attempts: recentAttempts,
      allAttempts: allMergedAttempts,
      stats: computeAttemptStats(allMergedAttempts)
    };
  }

  async function fetchInstitutionAttempts(context, limit) {
    var tenantId = normalizeString(context && context.tenantId);
    var uid = normalizeString(context && context.uid);
    if (!tenantId || !uid) {
      return { attempts: [], error: 'invalid_context' };
    }
    return fetchMergedExamAttempts(uid, {
      kind: 'institution_student',
      tenantId: tenantId,
      limit: limit
    });
  }

  async function fetchPublicAttempts(context, limit) {
    var uid = normalizeString(context && context.uid);
    if (!uid) {
      return { attempts: [], error: 'invalid_context' };
    }
    return fetchMergedExamAttempts(uid, {
      kind: 'public_user',
      limit: limit
    });
  }

  async function fetchRecentExamAttempts(context, limit) {
    var ctx = context || {};
    var kind = normalizeString(ctx.kind);
    var fetchLimit =
      typeof limit === 'number' && limit > 0 ? Math.min(limit, 50) : DEFAULT_FETCH_LIMIT;

    if (!kind || kind === 'guest') {
      return { attempts: [], skipped: true };
    }

    var summary = await fetchExamAttemptSummary(ctx, {
      recentLimit: fetchLimit,
      statsLimit: fetchLimit
    });

    return {
      attempts: (summary && summary.attempts) || [],
      error: summary && summary.error,
      skipped: summary && summary.skipped
    };
  }

  function computeAttemptStats(attempts) {
    var list = Array.isArray(attempts) ? attempts : [];
    var totalCount = list.length;
    if (!totalCount) {
      return {
        averageScore: null,
        totalCount: 0,
        bestScore: null
      };
    }

    var sum = 0;
    var best = 0;
    for (var i = 0; i < list.length; i++) {
      var score = toNumber(list[i].scorePercent, 0);
      sum += score;
      if (score > best) best = score;
    }

    return {
      averageScore: Math.round(sum / totalCount),
      totalCount: totalCount,
      bestScore: best
    };
  }

  window.SA_WEB_PROFILE_ATTEMPTS = {
    DEFAULT_BRAND_TENANT_ID: DEFAULT_BRAND_TENANT_ID,
    DEFAULT_FETCH_LIMIT: DEFAULT_FETCH_LIMIT,
    STATS_FETCH_LIMIT: STATS_FETCH_LIMIT,
    normalizeAttemptDoc: normalizeAttemptDoc,
    mergeDedupeAttempts: mergeDedupeAttempts,
    fetchRecentExamAttempts: fetchRecentExamAttempts,
    fetchExamAttemptSummary: fetchExamAttemptSummary,
    computeAttemptStats: computeAttemptStats
  };
})();
