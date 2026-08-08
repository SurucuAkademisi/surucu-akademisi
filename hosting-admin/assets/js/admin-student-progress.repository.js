/**
 * Admin — read-only student progress summary from Firestore (no writes).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[admin-student-progress]';
  var DEFAULT_FETCH_LIMIT = 50;
  var DEFAULT_BRAND_TENANT_ID = 'surucu_akademisi';

  function getDb() {
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function toNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback != null ? fallback : 0;
  }

  function timestampMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'number' && isFinite(ts)) return ts;
    if (typeof ts === 'string') {
      var parsed = Date.parse(ts);
      return isFinite(parsed) ? parsed : 0;
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return 0;
  }

  function normalizeAttemptDoc(id, data, originPath) {
    var raw = data || {};
    var scorePercent = toNumber(raw.scorePercent, NaN);
    if (!isFinite(scorePercent)) scorePercent = toNumber(raw.percentage, NaN);
    if (!isFinite(scorePercent)) scorePercent = toNumber(raw.score, 0);
    scorePercent = Math.max(0, Math.min(100, Math.round(scorePercent)));

    var durationSeconds = toNumber(raw.durationSeconds, NaN);
    if (!isFinite(durationSeconds)) durationSeconds = toNumber(raw.elapsedSeconds, 0);

    var completedAt = raw.completedAt || raw.createdAt || null;
    var createdAt = raw.createdAt || null;
    var completedAtMs = timestampMillis(raw.completedAt) || timestampMillis(raw.createdAt);

    return {
      id: normalizeString(id),
      uid: normalizeString(raw.uid) || null,
      examId: normalizeString(raw.examId) || null,
      examTitle: normalizeString(raw.examTitle) || normalizeString(raw.title) || 'Sınav',
      category: normalizeString(raw.category) || null,
      programType: normalizeString(raw.programType) || null,
      scorePercent: scorePercent,
      correctCount: toNumber(raw.correctCount, 0),
      wrongCount: toNumber(raw.wrongCount, 0),
      blankCount: toNumber(raw.blankCount, toNumber(raw.emptyCount, 0)),
      totalQuestions: toNumber(raw.totalQuestions, 0),
      durationSeconds: durationSeconds,
      completedAt: completedAt,
      createdAt: createdAt,
      completedAtMs: completedAtMs,
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

  function isLessonCompleted(data) {
    if (!data || typeof data !== 'object') return false;
    if (normalizeString(data.status) === 'completed') return true;
    if (data.completed === true) return true;
    return toNumber(data.progressPercent, 0) >= 100;
  }

  function parseProgressDocIds(id, data) {
    var docId = normalizeString(id);
    var raw = data || {};
    var categoryId = normalizeString(raw.categoryId) || null;
    var unitId = normalizeString(raw.unitId) || null;

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
    var activityAt = completedAt || updatedAt || lastSeenAt || null;
    var categoryId =
      parsed.categoryId ||
      normalizeString(raw.lessonCategoryId) ||
      normalizeString(raw.category) ||
      null;

    return {
      id: normalizeString(id),
      uid: normalizeString(raw.uid) || null,
      categoryId: categoryId,
      categoryTitle:
        normalizeString(raw.categoryTitle) ||
        normalizeString(raw.lessonTitle) ||
        normalizeString(raw.categoryName) ||
        null,
      unitId: parsed.unitId || normalizeString(raw.lessonId) || null,
      unitTitle: normalizeString(raw.unitTitle) || normalizeString(raw.title) || 'Ünite',
      completed: isLessonCompleted(raw),
      status: normalizeString(raw.status) || null,
      progressPercent: toNumber(raw.progressPercent, NaN),
      programType: normalizeString(raw.programType) || null,
      completedAt: completedAt,
      updatedAt: updatedAt,
      lastSeenAt: lastSeenAt,
      source: normalizeString(raw.source) || null,
      platform: normalizeString(raw.platform) || null,
      tenantId: normalizeString(raw.tenantId) || null,
      originPath: originPath || null,
      completedAtMs: timestampMillis(completedAt) || timestampMillis(updatedAt) || timestampMillis(lastSeenAt),
      activityAtMs:
        timestampMillis(activityAt) ||
        timestampMillis(raw.updatedAt) ||
        timestampMillis(raw.lastSeenAt)
    };
  }

  function normalizeMobileLessonProgressDoc(id, data, originPath) {
    return normalizeLessonProgressDoc(id, data, originPath || 'users/*/lessonProgress');
  }

  function normalizeDuelLeagueDoc(data) {
    var raw = data || {};
    return {
      totalPoints: toNumber(raw.totalPoints, 0),
      wins: toNumber(raw.wins, 0),
      losses: toNumber(raw.losses, 0),
      draws: toNumber(raw.draws, 0),
      matchesPlayed: toNumber(raw.matchesPlayed, 0),
      updatedAt: raw.updatedAt || null,
      exists: true
    };
  }

  function sortByMsDesc(items, field) {
    var key = field || 'completedAtMs';
    return (items || []).slice().sort(function (a, b) {
      return (b[key] || 0) - (a[key] || 0);
    });
  }

  function computeAttemptStats(attempts) {
    var list = Array.isArray(attempts) ? attempts : [];
    if (!list.length) {
      return {
        totalAttempts: 0,
        averageScore: null,
        bestScore: null,
        totalCorrect: 0,
        totalWrong: 0,
        totalBlank: 0,
        lastAttemptAt: null
      };
    }

    var sum = 0;
    var best = 0;
    var totalCorrect = 0;
    var totalWrong = 0;
    var totalBlank = 0;
    var lastAttemptAt = null;
    var lastMs = 0;

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var score = toNumber(item.scorePercent, 0);
      sum += score;
      if (score > best) best = score;
      totalCorrect += toNumber(item.correctCount, 0);
      totalWrong += toNumber(item.wrongCount, 0);
      totalBlank += toNumber(item.blankCount, 0);
      if ((item.completedAtMs || 0) > lastMs) {
        lastMs = item.completedAtMs;
        lastAttemptAt = item.completedAt || null;
      }
    }

    return {
      totalAttempts: list.length,
      averageScore: Math.round(sum / list.length),
      bestScore: best,
      totalCorrect: totalCorrect,
      totalWrong: totalWrong,
      totalBlank: totalBlank,
      lastAttemptAt: lastAttemptAt
    };
  }

  function groupAttemptsByExam(attempts) {
    var list = Array.isArray(attempts) ? attempts : [];
    var map = {};

    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var key = normalizeString(a.examId) || normalizeString(a.examTitle) || 'unknown_' + i;
      if (!map[key]) {
        map[key] = {
          examId: a.examId,
          examTitle: a.examTitle || a.examId || 'Sınav',
          items: []
        };
      }
      map[key].items.push(a);
    }

    var groups = [];
    Object.keys(map).forEach(function (key) {
      var group = map[key];
      var items = group.items;
      var sum = 0;
      var best = 0;
      var lastMs = 0;
      var lastAttemptAt = null;

      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var score = toNumber(it.scorePercent, 0);
        sum += score;
        if (score > best) best = score;
        if ((it.completedAtMs || 0) > lastMs) {
          lastMs = it.completedAtMs;
          lastAttemptAt = it.completedAt || null;
        }
      }

      groups.push({
        examId: group.examId,
        examTitle: group.examTitle,
        attemptCount: items.length,
        averageScore: Math.round(sum / items.length),
        bestScore: best,
        lastAttemptAt: lastAttemptAt,
        lastAttemptAtMs: lastMs
      });
    });

    return groups.sort(function (a, b) {
      return (b.lastAttemptAtMs || 0) - (a.lastAttemptAtMs || 0);
    });
  }

  function computeLessonStats(items, options) {
    var list = Array.isArray(items) ? items : [];
    var completedOnly = options && options.completedOnly === true;
    var completed = list.filter(function (item) {
      return completedOnly ? item.completed === true : true;
    });
    var completedItems = list.filter(function (item) {
      return item.completed === true;
    });
    var sortedCompleted = sortByMsDesc(completedItems, 'completedAtMs');
    var lastCompletedAt =
      sortedCompleted.length && sortedCompleted[0].completedAt
        ? sortedCompleted[0].completedAt
        : null;

    return {
      completedCount: completedItems.length,
      lastCompletedAt: lastCompletedAt,
      recentCompleted: sortedCompleted.slice(0, 5)
    };
  }

  function computeMobileLessonStats(items) {
    var list = Array.isArray(items) ? items : [];
    var completedItems = list.filter(function (item) {
      return item.completed === true;
    });
    var sortedActivity = sortByMsDesc(list, 'activityAtMs');
    var lastActivityAt = null;
    if (sortedActivity.length) {
      var top = sortedActivity[0];
      lastActivityAt = top.completedAt || top.lastSeenAt || null;
    }
    return {
      completedCount: completedItems.length,
      lastActivityAt: lastActivityAt,
      recentCompleted: sortByMsDesc(completedItems, 'completedAtMs').slice(0, 5)
    };
  }

  var ADMIN_LESSON_CATEGORIES = [
    { categoryId: 'motor_ve_arac_teknigi', title: 'Motor ve Araç Tekniği' },
    { categoryId: 'trafik_ve_cevre_bilgisi', title: 'Trafik ve Çevre Bilgisi' },
    { categoryId: 'ilk_yardim', title: 'İlk Yardım Bilgisi' },
    { categoryId: 'trafik_adabi', title: 'Trafik Adabı' },
    { categoryId: 'is_makineleri', title: 'İş Makineleri Operatörlük Dersi' }
  ];

  // Explicit machine_operator only. Omitted/driving_license keep full catalog behavior.
  var MACHINE_OPERATOR_LESSON_CATEGORY_IDS = ['is_makineleri', 'ilk_yardim'];
  var MACHINE_OPERATOR_EXAM_CATEGORY_IDS = ['work_machines', 'first_aid'];
  var MACHINE_OPERATOR_EXAM_CATEGORY_TITLES = {
    work_machines: 'İş Makineleri',
    first_aid: 'İlk Yardım'
  };
  var MACHINE_OPERATOR_LESSON_CATEGORY_TITLES = {
    is_makineleri: 'İş Makineleri',
    ilk_yardim: 'İlk Yardım'
  };
  /** Runtime session cache: categoryId → active unit count. */
  var __adminLessonUnitTotalByCategory = Object.create(null);

  function isMachineOperatorProgressProgram(value) {
    return normalizeString(value) === 'machine_operator';
  }

  function getAdminLessonCatalogCategories(programType) {
    if (isMachineOperatorProgressProgram(programType)) {
      var out = [];
      for (var i = 0; i < MACHINE_OPERATOR_LESSON_CATEGORY_IDS.length; i++) {
        var wantId = MACHINE_OPERATOR_LESSON_CATEGORY_IDS[i];
        var titleOverride = MACHINE_OPERATOR_LESSON_CATEGORY_TITLES[wantId];
        for (var j = 0; j < ADMIN_LESSON_CATEGORIES.length; j++) {
          if (ADMIN_LESSON_CATEGORIES[j].categoryId === wantId) {
            out.push({
              categoryId: ADMIN_LESSON_CATEGORIES[j].categoryId,
              title: titleOverride || ADMIN_LESSON_CATEGORIES[j].title
            });
            break;
          }
        }
      }
      return out;
    }
    return ADMIN_LESSON_CATEGORIES.map(function (c) {
      return {
        categoryId: c.categoryId,
        title: c.title
      };
    });
  }

  function filterAttemptsForProgressProgram(attempts, programType) {
    var list = Array.isArray(attempts) ? attempts : [];
    if (!isMachineOperatorProgressProgram(programType)) {
      // Driving/legacy mode: keep existing docs; exclude only explicit machine_operator.
      var drivingOut = [];
      for (var d = 0; d < list.length; d++) {
        var driveItem = list[d];
        if (!driveItem) continue;
        if (isMachineOperatorProgressProgram(driveItem.programType)) continue;
        drivingOut.push(driveItem);
      }
      return drivingOut;
    }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      if (!isMachineOperatorProgressProgram(item.programType)) continue;
      var cat = normalizeString(item.category).toLowerCase();
      if (MACHINE_OPERATOR_EXAM_CATEGORY_IDS.indexOf(cat) === -1) continue;
      out.push(item);
    }
    return out;
  }

  function filterLessonItemsForProgressProgram(items, programType) {
    var list = Array.isArray(items) ? items : [];
    if (!isMachineOperatorProgressProgram(programType)) {
      var drivingOut = [];
      for (var d = 0; d < list.length; d++) {
        var driveItem = list[d];
        if (!driveItem) continue;
        if (isMachineOperatorProgressProgram(driveItem.programType)) continue;
        drivingOut.push(driveItem);
      }
      return drivingOut;
    }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      if (!isMachineOperatorProgressProgram(item.programType)) continue;
      var key = resolveLessonCategoryKey(item);
      if (MACHINE_OPERATOR_LESSON_CATEGORY_IDS.indexOf(key) === -1) continue;
      out.push(item);
    }
    return out;
  }

  function buildLessonDedupeKey(item) {
    if (!item) return '';
    var categoryId = normalizeString(item.categoryId);
    var unitId = normalizeString(item.unitId);
    var programType = normalizeString(item.programType);
    if (categoryId && unitId) {
      if (isMachineOperatorProgressProgram(programType)) {
        return 'machine_operator__' + categoryId + '__' + unitId;
      }
      return categoryId + '__' + unitId;
    }
    var id = normalizeString(item.id);
    if (id) {
      if (isMachineOperatorProgressProgram(programType)) {
        return 'machine_operator__' + id;
      }
      return id;
    }
    if (unitId) {
      if (isMachineOperatorProgressProgram(programType)) {
        return 'machine_operator____unit__' + unitId;
      }
      return '__unit__' + unitId;
    }
    return '';
  }

  function partitionMachineExamAttemptsByCategory(attempts) {
    var list = Array.isArray(attempts) ? attempts : [];
    var workMachines = [];
    var firstAid = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      var cat = normalizeString(item.category).toLowerCase();
      if (cat === 'work_machines') workMachines.push(item);
      else if (cat === 'first_aid') firstAid.push(item);
    }
    return {
      work_machines: workMachines,
      first_aid: firstAid
    };
  }

  function computeMachineExamCategoryStats(attempts) {
    var parts = partitionMachineExamAttemptsByCategory(attempts);
    return {
      work_machines: {
        categoryId: 'work_machines',
        title: MACHINE_OPERATOR_EXAM_CATEGORY_TITLES.work_machines,
        stats: computeAttemptStats(parts.work_machines),
        items: parts.work_machines
      },
      first_aid: {
        categoryId: 'first_aid',
        title: MACHINE_OPERATOR_EXAM_CATEGORY_TITLES.first_aid,
        stats: computeAttemptStats(parts.first_aid),
        items: parts.first_aid
      }
    };
  }

  function getCachedAdminLessonUnitTotal(categoryId) {
    var cid = normalizeString(categoryId);
    if (!cid) return null;
    if (!Object.prototype.hasOwnProperty.call(__adminLessonUnitTotalByCategory, cid)) return null;
    var n = Number(__adminLessonUnitTotalByCategory[cid]);
    if (!isFinite(n) || n < 0) return null;
    return n;
  }

  function setCachedAdminLessonUnitTotal(categoryId, total) {
    var cid = normalizeString(categoryId);
    var n = Number(total);
    if (!cid || !isFinite(n) || n < 0) return;
    __adminLessonUnitTotalByCategory[cid] = n;
  }

  async function resolveAdminLessonCategoryUnitTotal(categoryId) {
    var cid = normalizeString(categoryId);
    if (!cid) return null;
    var cached = getCachedAdminLessonUnitTotal(cid);
    if (cached != null) return cached;
    var db = getDb();
    if (!db) return null;
    try {
      var snap = await db
        .collection('content')
        .doc('lesson_categories')
        .collection('items')
        .doc(cid)
        .collection('units')
        .where('status', '==', 'active')
        .get();
      var count = (snap && snap.docs) ? snap.docs.length : 0;
      setCachedAdminLessonUnitTotal(cid, count);
      return count;
    } catch (e) {
      try {
        console.warn(LOG_PREFIX + ' unit total resolve failed', cid, e && e.message ? e.message : e);
      } catch (_) {}
      return null;
    }
  }

  async function enrichLessonCategoryStatsWithUnitTotals(rows) {
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) return list;
    await Promise.all(list.map(function (row) {
      var cid = normalizeString(row && row.categoryId);
      if (!cid) return Promise.resolve();
      return Promise.resolve(resolveAdminLessonCategoryUnitTotal(cid)).then(function (total) {
        if (total == null || !isFinite(Number(total)) || Number(total) < 0) return;
        row.totalCount = Number(total);
      });
    }));
    return list;
  }

  function dedupeCompletedLessonItems(items) {
    return mergeDedupeLessonItems([items]);
  }

  function lessonItemRank(item) {
    var it = item || {};
    var completed = it.completed === true ? 1 : 0;
    var activityMs = it.completedAtMs || it.activityAtMs || 0;
    return completed * 1000000000000 + activityMs;
  }

  function mergeDedupeLessonItems(lists) {
    var map = {};
    var sources = lists || [];

    function upsert(item) {
      if (!item) return;
      var key = buildLessonDedupeKey(item);
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
        var entry = batch[i];
        if (!entry || entry.completed !== true) continue;
        upsert(entry);
      }
    }

    var merged = [];
    Object.keys(map).forEach(function (key) {
      if (map[key]) merged.push(map[key]);
    });
    return sortByMsDesc(merged, 'completedAtMs');
  }

  function normalizeCategoryLookupText(value) {
    return normalizeString(value)
      .toLowerCase()
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
  }

  function resolveLessonCategoryKey(item) {
    var categoryId = normalizeString(item && item.categoryId);
    if (categoryId) {
      for (var i = 0; i < ADMIN_LESSON_CATEGORIES.length; i++) {
        if (ADMIN_LESSON_CATEGORIES[i].categoryId === categoryId) {
          return ADMIN_LESSON_CATEGORIES[i].categoryId;
        }
      }
    }

    var titleKey = normalizeCategoryLookupText(item && item.categoryTitle);
    if (!titleKey) return null;

    if (titleKey.indexOf('motor') >= 0 && titleKey.indexOf('arac') >= 0) {
      return 'motor_ve_arac_teknigi';
    }
    if (titleKey.indexOf('ilk yardim') >= 0) return 'ilk_yardim';
    if (titleKey.indexOf('trafik') >= 0 && titleKey.indexOf('cevre') >= 0) {
      return 'trafik_ve_cevre_bilgisi';
    }
    if (titleKey.indexOf('trafik adab') >= 0) return 'trafik_adabi';
    if (titleKey.indexOf('is makin') >= 0) return 'is_makineleri';

    return null;
  }

  function computeLessonStatsByCategory(items, programType) {
    var list = dedupeCompletedLessonItems(items);
    var catalog = getAdminLessonCatalogCategories(programType);
    var counts = {};

    list.forEach(function (item) {
      var key = resolveLessonCategoryKey(item);
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
      var bucket = counts[cat.categoryId] || { count: 0, recentCompletedAtMs: 0 };
      return {
        categoryId: cat.categoryId,
        title: cat.title,
        completedCount: bucket.count,
        recentCompletedAt: bucket.recentCompletedAtMs > 0 ? bucket.recentCompletedAtMs : null
      };
    });
  }

  function mapAttemptSnapshot(snap, uid, originPath) {
    var out = [];
    var docs = snap && snap.docs ? snap.docs : [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var data = doc.data ? doc.data() : {};
      if (uid && data.uid && normalizeString(data.uid) !== normalizeString(uid)) continue;
      out.push(normalizeAttemptDoc(doc.id, data, originPath));
    }
    return sortByMsDesc(out, 'completedAtMs');
  }

  function mapLessonSnapshot(snap, uid, originPath) {
    var out = [];
    var docs = snap && snap.docs ? snap.docs : [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var data = doc.data ? doc.data() : {};
      if (uid && data.uid && normalizeString(data.uid) !== normalizeString(uid)) continue;
      if (!isLessonCompleted(data)) continue;
      out.push(normalizeLessonProgressDoc(doc.id, data, originPath));
    }
    return sortByMsDesc(out, 'completedAtMs');
  }

  async function fetchTenantExamAttempts(db, tenantId, uid, limit) {
    var collectionRef = db.collection('tenants').doc(tenantId).collection('exam_attempts');
    var originPath = 'tenants/' + tenantId + '/exam_attempts';
    var snap;
    try {
      snap = await collectionRef
        .where('uid', '==', uid)
        .orderBy('completedAt', 'desc')
        .limit(limit)
        .get();
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' exam orderBy failed, fallback', orderErr);
      snap = await collectionRef.where('uid', '==', uid).limit(limit).get();
    }
    return mapAttemptSnapshot(snap, uid, originPath);
  }

  async function fetchWebExamAttempts(db, uid, limit) {
    var originPath = 'users/' + uid + '/web_exam_attempts';
    var collectionRef = db.collection('users').doc(uid).collection('web_exam_attempts');
    var snap;
    try {
      snap = await collectionRef.orderBy('completedAt', 'desc').limit(limit).get();
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' web_exam_attempts orderBy failed, fallback', orderErr);
      snap = await collectionRef.limit(limit).get();
    }
    return mapAttemptSnapshot(snap, uid, originPath);
  }

  async function fetchDefaultTenantPublicExamAttempts(db, uid, limit) {
    return fetchTenantExamAttempts(db, DEFAULT_BRAND_TENANT_ID, uid, limit);
  }

  async function fetchMergedExamAttemptsForStudent(db, uid, tenantId, limit) {
    var perSourceLimit = Math.min(limit * 2, DEFAULT_FETCH_LIMIT);
    var lists = [];
    var fetchErrors = [];

    var tenantPromise = tenantId
      ? fetchTenantExamAttempts(db, tenantId, uid, perSourceLimit)
      : fetchDefaultTenantPublicExamAttempts(db, uid, perSourceLimit);
    var tenantErrorKey = tenantId ? ('tenant:' + tenantId) : ('tenant:' + DEFAULT_BRAND_TENANT_ID);
    var webPromise = fetchWebExamAttempts(db, uid, perSourceLimit);

    var settled = await Promise.allSettled([tenantPromise, webPromise]);

    if (settled[0].status === 'fulfilled') {
      lists.push(settled[0].value);
    } else {
      console.warn(LOG_PREFIX + ' tenant exam fetch failed', tenantId || DEFAULT_BRAND_TENANT_ID, settled[0].reason);
      fetchErrors.push(tenantErrorKey);
    }

    if (settled[1].status === 'fulfilled') {
      lists.push(settled[1].value);
    } else {
      console.warn(LOG_PREFIX + ' web_exam_attempts fetch failed', settled[1].reason);
      fetchErrors.push('users/' + uid + '/web_exam_attempts');
    }

    return {
      items: mergeDedupeAttempts(lists, limit),
      fetchErrors: fetchErrors
    };
  }

  async function fetchTenantLessonProgress(db, tenantId, uid, limit) {
    var collectionRef = db.collection('tenants').doc(tenantId).collection('lesson_progress');
    var originPath = 'tenants/' + tenantId + '/lesson_progress';
    var snap;
    try {
      snap = await collectionRef
        .where('uid', '==', uid)
        .orderBy('completedAt', 'desc')
        .limit(limit)
        .get();
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' lesson orderBy failed, fallback', orderErr);
      snap = await collectionRef.where('uid', '==', uid).limit(limit).get();
    }
    return mapLessonSnapshot(snap, uid, originPath);
  }

  async function fetchUserLessonProgress(db, uid, limit) {
    var originPath = 'users/' + uid + '/lessonProgress';
    var snap = await db.collection('users').doc(uid).collection('lessonProgress').limit(limit).get();
    var out = [];
    var docs = snap && snap.docs ? snap.docs : [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var data = doc.data ? doc.data() : {};
      if (!isLessonCompleted(data)) continue;
      out.push(normalizeLessonProgressDoc(doc.id, data, originPath));
    }
    return sortByMsDesc(out, 'completedAtMs');
  }

  async function fetchWebLessonProgress(db, uid, limit) {
    var originPath = 'users/' + uid + '/web_lesson_progress';
    var collectionRef = db.collection('users').doc(uid).collection('web_lesson_progress');
    var snap;
    try {
      snap = await collectionRef.orderBy('completedAt', 'desc').limit(limit).get();
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' web_lesson_progress orderBy failed, fallback', orderErr);
      snap = await collectionRef.limit(limit).get();
    }
    return mapLessonSnapshot(snap, uid, originPath);
  }

  async function fetchMergedLessonProgressForStudent(db, uid, tenantId, limit, options) {
    var opts = options || {};
    var includeUserMirror = opts.includeUserMirror === true;
    var includeWebLessonProgress = opts.includeWebLessonProgress === true;
    var perSourceLimit = Math.min(limit * 2, DEFAULT_FETCH_LIMIT);
    var lists = [];
    var fetchErrors = [];

    if (tenantId) {
      try {
        lists.push(await fetchTenantLessonProgress(db, tenantId, uid, perSourceLimit));
      } catch (e) {
        console.warn(LOG_PREFIX + ' tenant lesson fetch failed', tenantId, e);
        fetchErrors.push('tenants/' + tenantId + '/lesson_progress');
      }
    }

    if (includeUserMirror) {
      try {
        lists.push(await fetchUserLessonProgress(db, uid, perSourceLimit));
      } catch (e) {
        console.warn(LOG_PREFIX + ' user lessonProgress fetch failed', e);
        fetchErrors.push('users/' + uid + '/lessonProgress');
      }
    }

    if (includeWebLessonProgress) {
      try {
        lists.push(await fetchWebLessonProgress(db, uid, perSourceLimit));
      } catch (e) {
        console.warn(LOG_PREFIX + ' web_lesson_progress fetch failed', e);
        fetchErrors.push('users/' + uid + '/web_lesson_progress');
      }
    }

    return {
      items: mergeDedupeLessonItems(lists).slice(0, limit),
      fetchErrors: fetchErrors
    };
  }

  async function fetchDuelLeague(db, uid) {
    var snap = await db.collection('duelLeague').doc(uid).get();
    if (!snap || !snap.exists) {
      return {
        totalPoints: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        matchesPlayed: 0,
        updatedAt: null,
        exists: false
      };
    }
    return normalizeDuelLeagueDoc(snap.data ? snap.data() : {});
  }

  async function fetchMobileLessonProgress(db, uid, limit) {
    var snap = await db.collection('users').doc(uid).collection('lessonProgress').limit(limit).get();
    var out = [];
    var docs = snap && snap.docs ? snap.docs : [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      out.push(normalizeMobileLessonProgressDoc(doc.id, doc.data ? doc.data() : {}));
    }
    return sortByMsDesc(out, 'activityAtMs');
  }

  async function fetchStudentProgressSummary(options) {
    var opts = options || {};
    var uid = normalizeString(opts.uid);
    var tenantId = normalizeString(opts.tenantId);
    var includeMobileLessonProgress = opts.includeMobileLessonProgress === true;
    var progressProgramType = isMachineOperatorProgressProgram(opts.programType)
      ? 'machine_operator'
      : null;
    var limit =
      typeof opts.limit === 'number' && opts.limit > 0
        ? Math.min(opts.limit, DEFAULT_FETCH_LIMIT)
        : DEFAULT_FETCH_LIMIT;

    var warnings = [];
    var emptyAttempts = {
      items: [],
      stats: computeAttemptStats([]),
      byExam: []
    };
    var emptyLessons = {
      items: [],
      stats: computeLessonStats([]),
      recentCompleted: []
    };
    var emptyMobileLessons = {
      items: [],
      stats: computeMobileLessonStats([]),
      recentCompleted: []
    };
    var emptyDuel = {
      totalPoints: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      matchesPlayed: 0,
      updatedAt: null,
      exists: false
    };

    if (!uid) {
      warnings.push('Geçersiz öğrenci kimliği.');
      return {
        programType: progressProgramType || undefined,
        attempts: emptyAttempts,
        lessons: emptyLessons,
        mobileLessons: emptyMobileLessons,
        duel: emptyDuel,
        warnings: warnings
      };
    }

    var db = getDb();
    if (!db) {
      warnings.push('Firestore bağlantısı kullanılamıyor.');
      return {
        programType: progressProgramType || undefined,
        attempts: emptyAttempts,
        lessons: emptyLessons,
        mobileLessons: emptyMobileLessons,
        duel: emptyDuel,
        warnings: warnings
      };
    }

    var attemptItems = [];
    var lessonItems = [];
    var mobileLessonItems = [];
    var duel = emptyDuel;

    var lessonPromise = tenantId
      ? fetchMergedLessonProgressForStudent(db, uid, tenantId, limit, {
          includeUserMirror: includeMobileLessonProgress,
          includeWebLessonProgress: includeMobileLessonProgress
        })
      : fetchMergedLessonProgressForStudent(db, uid, '', limit, {
          includeUserMirror: true,
          includeWebLessonProgress: true
        });

    var summarySettled = await Promise.allSettled([
      fetchMergedExamAttemptsForStudent(db, uid, tenantId, limit),
      lessonPromise,
      fetchDuelLeague(db, uid)
    ]);

    if (summarySettled[0].status === 'fulfilled') {
      var mergedExams = summarySettled[0].value;
      attemptItems = (mergedExams && mergedExams.items) || [];
      if (mergedExams && mergedExams.fetchErrors && mergedExams.fetchErrors.length) {
        console.warn(LOG_PREFIX + ' partial exam source failures', mergedExams.fetchErrors);
      }
    } else {
      console.warn(LOG_PREFIX + ' merged exam fetch failed', summarySettled[0].reason);
      warnings.push('Sınav denemeleri yüklenemedi.');
    }

    // Program filter after merge/dedupe, before attempt statistics/grouping.
    attemptItems = filterAttemptsForProgressProgram(attemptItems, progressProgramType);

    if (summarySettled[1].status === 'fulfilled') {
      var mergedLessons = summarySettled[1].value;
      lessonItems = (mergedLessons && mergedLessons.items) || [];
      if (mergedLessons && mergedLessons.fetchErrors && mergedLessons.fetchErrors.length) {
        console.warn(LOG_PREFIX + ' partial lesson source failures', mergedLessons.fetchErrors);
      }
      if (!tenantId) {
        warnings.push('Kurum seçilmediği için yalnızca kullanıcıya ait ders ilerlemesi gösteriliyor.');
      }
    } else {
      console.warn(LOG_PREFIX + ' merged lesson fetch failed', summarySettled[1].reason);
      warnings.push('Ders ilerlemesi yüklenemedi.');
      if (!tenantId) {
        warnings.push('Kurum seçilmediği için yalnızca kullanıcıya ait ders ilerlemesi gösteriliyor.');
      }
    }

    // Machine lesson/unit totals use only is_makineleri + ilk_yardim after merge.
    lessonItems = filterLessonItemsForProgressProgram(lessonItems, progressProgramType);

    if (summarySettled[2].status === 'fulfilled') {
      duel = summarySettled[2].value;
    } else {
      console.warn(LOG_PREFIX + ' duel fetch failed', summarySettled[2].reason);
      warnings.push('Düello istatistikleri yüklenemedi.');
    }

    if (includeMobileLessonProgress) {
      mobileLessonItems = lessonItems.slice();
    }

    var lessonStats = computeLessonStats(lessonItems);
    lessonStats.recentCompleted = lessonStats.recentCompleted || [];

    var mobileStats = computeMobileLessonStats(mobileLessonItems);
    mobileStats.recentCompleted = mobileStats.recentCompleted || [];

    var lessonByCategory = computeLessonStatsByCategory(lessonItems, progressProgramType);
    // Driving + machine: attach canonical active unit totals (session-cached).
    await enrichLessonCategoryStatsWithUnitTotals(lessonByCategory);

    var attemptsPayload = {
      items: attemptItems,
      stats: computeAttemptStats(attemptItems),
      byExam: groupAttemptsByExam(attemptItems)
    };
    if (isMachineOperatorProgressProgram(progressProgramType)) {
      attemptsPayload.byMachineCategory = computeMachineExamCategoryStats(attemptItems);
    }

    return {
      programType: progressProgramType || undefined,
      attempts: attemptsPayload,
      lessons: {
        items: lessonItems,
        stats: lessonStats,
        recentCompleted: lessonStats.recentCompleted,
        byCategory: lessonByCategory
      },
      mobileLessons: {
        items: mobileLessonItems,
        stats: mobileStats,
        recentCompleted: mobileStats.recentCompleted
      },
      duel: duel,
      warnings: warnings
    };
  }

  window.SA_ADMIN_STUDENT_PROGRESS = {
    DEFAULT_BRAND_TENANT_ID: DEFAULT_BRAND_TENANT_ID,
    normalizeAttemptDoc: normalizeAttemptDoc,
    mergeDedupeAttempts: mergeDedupeAttempts,
    mergeDedupeLessonItems: mergeDedupeLessonItems,
    normalizeLessonProgressDoc: normalizeLessonProgressDoc,
    normalizeMobileLessonProgressDoc: normalizeMobileLessonProgressDoc,
    normalizeDuelLeagueDoc: normalizeDuelLeagueDoc,
    computeAttemptStats: computeAttemptStats,
    computeLessonStats: computeLessonStats,
    computeLessonStatsByCategory: computeLessonStatsByCategory,
    computeMachineExamCategoryStats: computeMachineExamCategoryStats,
    getAdminLessonCatalogCategories: getAdminLessonCatalogCategories,
    resolveAdminLessonCategoryUnitTotal: resolveAdminLessonCategoryUnitTotal,
    getCachedAdminLessonUnitTotal: getCachedAdminLessonUnitTotal,
    groupAttemptsByExam: groupAttemptsByExam,
    fetchStudentProgressSummary: fetchStudentProgressSummary
  };
})();
