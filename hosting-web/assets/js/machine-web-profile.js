/**
 * Machine web Profilim — read-only progress aggregator.
 * Mirrors active mobile Machine Profilim eligibility / dedupe / metrics.
 * NO progress writes.
 */
(function () {
  'use strict';

  var LOGIN_HREF = '../giris/';
  var HOME_HREF = '../';
  var REGION = 'us-central1';
  var PROGRAM_TYPE = 'machine_operator';
  var LESSON_CATEGORY_IDS = ['is_makineleri', 'ilk_yardim'];
  var EXAM_CATEGORY_IDS = ['work_machines', 'first_aid'];
  var LESSON_TITLES = {
    is_makineleri: 'İş Makineleri',
    ilk_yardim: 'İlk Yardım'
  };
  var EXAM_TITLES = {
    work_machines: 'İş Makineleri',
    first_aid: 'İlk Yardım'
  };
  var EXAM_FETCH_LIMIT = 50;
  var LESSON_FETCH_LIMIT = 200;

  var settled = false;
  var loadToken = 0;
  var currentSession = null;

  function $(id) {
    return document.getElementById(id);
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    return fb && fb.ready && fb.auth ? fb.auth : null;
  }

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      return firebase.firestore();
    }
    return null;
  }

  function getFunctions() {
    if (typeof firebase === 'undefined' || !firebase.app) return null;
    try {
      return firebase.app().functions(REGION);
    } catch (_) {
      return null;
    }
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function redirectLogin() {
    var api = window.SA_MACHINE_WEB_SESSION;
    if (api) api.clearMachineSession();
    window.location.replace(LOGIN_HREF);
  }

  function showShell() {
    var shell = $('machine-web-profile');
    var gate = $('machine-web-profile-gate');
    if (shell) shell.hidden = false;
    if (gate) gate.hidden = true;
  }

  function setStatus(text, isError) {
    var el = $('machine-web-profile-status');
    if (!el) return;
    var msg = text != null ? String(text).trim() : '';
    if (!msg) {
      el.textContent = '';
      el.hidden = true;
      el.classList.remove('is-error');
      return;
    }
    el.textContent = msg;
    el.hidden = false;
    if (isError) el.classList.add('is-error');
    else el.classList.remove('is-error');
  }

  function setRefreshBusy(busy) {
    var btn = $('machine-web-profile-refresh');
    if (!btn) return;
    btn.disabled = !!busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function isPublicSession(session) {
    return !!(
      session &&
      (normalizeString(session.mode) === 'public' ||
        normalizeString(session.enrollmentSource) === 'public')
    );
  }

  function isMachineOperatorProgramType(value) {
    return normalizeString(value) === PROGRAM_TYPE;
  }

  function isMachineLessonCategoryId(categoryId) {
    var id = normalizeString(categoryId);
    return LESSON_CATEGORY_IDS.indexOf(id) >= 0;
  }

  function isMachineExamCategoryId(categoryId) {
    var id = normalizeString(categoryId);
    return EXAM_CATEGORY_IDS.indexOf(id) >= 0;
  }

  function isProgressCompleted(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.completed === true) return true;
    if (normalizeString(data.status) === 'completed') return true;
    var pct = Number(data.progressPercent);
    return isFinite(pct) && pct >= 100;
  }

  function timestampToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.toDate === 'function') {
      try {
        return ts.toDate().getTime();
      } catch (_) {
        return 0;
      }
    }
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'number' && isFinite(ts)) return ts;
    if (typeof ts === 'string') {
      var parsed = Date.parse(ts);
      return isFinite(parsed) ? parsed : 0;
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return 0;
  }

  function formatExamDateShort(ts) {
    var ms = timestampToMillis(ts);
    if (!ms) return '—';
    try {
      var date = new Date(ms);
      if (!date || isNaN(date.getTime())) return '—';
      var day = String(date.getDate()).padStart(2, '0');
      var month = String(date.getMonth() + 1).padStart(2, '0');
      var year = date.getFullYear();
      return day + '.' + month + '.' + year;
    } catch (_) {
      return '—';
    }
  }

  function getAttemptPercentageFromData(data) {
    if (!data || typeof data !== 'object') return null;
    if (typeof data.percentage === 'number' && isFinite(data.percentage)) return data.percentage;
    if (typeof data.scorePercent === 'number' && isFinite(data.scorePercent)) return data.scorePercent;
    return null;
  }

  function profileExamCompletedAtMs(data) {
    if (!data || typeof data !== 'object') return 0;
    return timestampToMillis(data.completedAt || data.createdAt);
  }

  function buildProfileExamDedupeKey(id, data) {
    var d = data || {};
    var examId = normalizeString(d.examId) || '_';
    var completedAtMs = profileExamCompletedAtMs(d);
    var score = getAttemptPercentageFromData(d);
    var scorePercent = score != null ? Math.round(score) : 0;
    if (completedAtMs > 0) {
      return examId + '|' + String(completedAtMs) + '|' + String(scorePercent);
    }
    return normalizeString(id) || examId + '|' + String(scorePercent);
  }

  function mergeProfileExamAttemptDocs(lists) {
    var seen = {};
    var merged = [];
    var sources = lists || [];
    for (var s = 0; s < sources.length; s++) {
      var batch = sources[s] || [];
      for (var i = 0; i < batch.length; i++) {
        var item = batch[i];
        if (!item) continue;
        var key = buildProfileExamDedupeKey(item.id, item.data);
        if (seen[key]) continue;
        seen[key] = true;
        merged.push(item);
      }
    }
    merged.sort(function (a, b) {
      return profileExamCompletedAtMs(b.data) - profileExamCompletedAtMs(a.data);
    });
    return merged;
  }

  async function fetchTenantExamAttemptDocs(db, tenantId, uid, limit) {
    var tid = normalizeString(tenantId);
    var originPath = 'tenants/' + tid + '/exam_attempts';
    var query = db.collection('tenants').doc(tid).collection('exam_attempts').where('uid', '==', uid);
    var snap;
    try {
      snap = await query.orderBy('completedAt', 'desc').limit(limit).get();
    } catch (orderErr) {
      console.warn('[machine-web-profile] tenant exam orderBy failed', orderErr);
      snap = await query.limit(limit).get();
    }
    return (snap.docs || []).map(function (d) {
      var data = d.data() || {};
      data.__originPath = originPath;
      return { id: d.id, data: data };
    });
  }

  async function fetchWebExamAttemptDocs(db, uid, limit) {
    var originPath = 'users/' + uid + '/web_exam_attempts';
    var collectionRef = db.collection('users').doc(uid).collection('web_exam_attempts');
    var snap;
    try {
      snap = await collectionRef.orderBy('completedAt', 'desc').limit(limit).get();
    } catch (orderErr) {
      console.warn('[machine-web-profile] web_exam_attempts orderBy failed', orderErr);
      snap = await collectionRef.limit(limit).get();
    }
    return (snap.docs || []).map(function (d) {
      var data = d.data() || {};
      data.__originPath = originPath;
      return { id: d.id, data: data };
    });
  }

  function isMachineProfileExamAttemptEligible(item, uid, tenantId) {
    var d = item && item.data ? item.data : null;
    if (!d || typeof d !== 'object') return false;
    if (!isMachineOperatorProgramType(d.programType)) return false;
    var category = normalizeString(d.category || d.categoryId);
    if (!isMachineExamCategoryId(category)) return false;
    var docUid = normalizeString(d.uid);
    if (docUid && docUid !== normalizeString(uid)) return false;
    var origin = normalizeString(d.__originPath);
    if (origin.indexOf('tenants/') === 0) {
      var docTenant = normalizeString(d.tenantId);
      var expectedTenant = normalizeString(tenantId);
      if (docTenant && expectedTenant && docTenant !== expectedTenant) return false;
    }
    return true;
  }

  function aggregateMachineExamStatsFromDocs(docs) {
    var list = Array.isArray(docs) ? docs : [];
    var correct = 0;
    var wrong = 0;
    var blank = 0;
    var sum = 0;
    var countWithScore = 0;
    var best = 0;
    var lastAttemptAt = null;
    var lastMs = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i] && list[i].data ? list[i].data : {};
      correct += Math.max(0, Number(d.correctCount) || 0);
      wrong += Math.max(0, Number(d.wrongCount) || 0);
      blank += Math.max(0, Number(d.blankCount) || 0);
      var p = getAttemptPercentageFromData(d);
      if (p != null && isFinite(p)) {
        sum += p;
        countWithScore += 1;
        if (p > best) best = p;
      }
      var ms = profileExamCompletedAtMs(d);
      if (ms > lastMs) {
        lastMs = ms;
        lastAttemptAt = d.completedAt || d.createdAt || null;
      }
    }
    return {
      completed: list.length,
      correct: correct,
      wrong: wrong,
      blank: blank,
      average: countWithScore ? Math.round(sum / countWithScore) : 0,
      best: countWithScore ? Math.round(best) : 0,
      lastAttemptAt: lastAttemptAt,
      hasScore: countWithScore > 0
    };
  }

  function emptyExamStats() {
    return {
      completed: 0,
      correct: 0,
      wrong: 0,
      blank: 0,
      average: 0,
      best: 0,
      lastAttemptAt: null,
      hasScore: false
    };
  }

  async function fetchMachineProfileExamStats(uid, tenantId) {
    var db = getDb();
    if (!db) throw new Error('firestore_unavailable');
    var lists = [];
    var anySuccess = false;
    var lastErr = null;
    var tid = normalizeString(tenantId);

    if (tid) {
      try {
        lists.push(await fetchTenantExamAttemptDocs(db, tid, uid, EXAM_FETCH_LIMIT));
        anySuccess = true;
      } catch (e) {
        lastErr = e;
        lists.push([]);
        console.warn('[machine-web-profile] tenant exam_attempts read failed', e);
      }
    }

    try {
      lists.push(await fetchWebExamAttemptDocs(db, uid, EXAM_FETCH_LIMIT));
      anySuccess = true;
    } catch (e) {
      lastErr = e;
      lists.push([]);
      console.warn('[machine-web-profile] web_exam_attempts read failed', e);
    }

    if (!anySuccess) throw lastErr || new Error('exam_progress_unavailable');

    var filteredLists = lists.map(function (batch) {
      return (batch || []).filter(function (item) {
        return isMachineProfileExamAttemptEligible(item, uid, tid);
      });
    });
    var merged = mergeProfileExamAttemptDocs(filteredLists);
    var workMachines = [];
    var firstAid = [];
    for (var i = 0; i < merged.length; i++) {
      var cat = normalizeString(
        (merged[i].data && (merged[i].data.category || merged[i].data.categoryId)) || ''
      );
      if (cat === 'work_machines') workMachines.push(merged[i]);
      else if (cat === 'first_aid') firstAid.push(merged[i]);
    }
    var wm = aggregateMachineExamStatsFromDocs(workMachines);
    var fa = aggregateMachineExamStatsFromDocs(firstAid);
    return {
      work_machines: wm,
      first_aid: fa,
      completed: (wm.completed || 0) + (fa.completed || 0)
    };
  }

  function normalizeMachineLessonProgressItem(docId, data, originPath) {
    var raw = data || {};
    var id = normalizeString(docId);
    var categoryId = normalizeString(raw.categoryId || raw.lessonCategoryId || raw.category);
    var unitId = normalizeString(raw.unitId || raw.lessonId);
    if (id.indexOf('__') >= 0) {
      var parts = id.split('__');
      // Prefer field values; only fall back to docId parts when fields missing.
      // machine_operator__{category}__{unit} → skip program prefix when parsing.
      if (!categoryId || !unitId) {
        if (parts[0] === PROGRAM_TYPE && parts.length >= 3) {
          if (!categoryId) categoryId = normalizeString(parts[1]);
          if (!unitId) unitId = normalizeString(parts.slice(2).join('__'));
        } else {
          if (!categoryId) categoryId = normalizeString(parts[0]);
          if (!unitId) unitId = normalizeString(parts.slice(1).join('__'));
        }
      }
    } else if (!unitId && id) {
      unitId = id;
    }
    var completedAt = raw.completedAt || null;
    var updatedAt = raw.updatedAt || null;
    var lastSeenAt = raw.lastSeenAt || null;
    return {
      id: id || unitId,
      uid: normalizeString(raw.uid) || null,
      categoryId: categoryId || null,
      unitId: unitId || null,
      completed: isProgressCompleted(raw),
      status: normalizeString(raw.status) || null,
      progressPercent: isFinite(Number(raw.progressPercent)) ? Number(raw.progressPercent) : null,
      completedAt: completedAt,
      updatedAt: updatedAt,
      lastSeenAt: lastSeenAt,
      source: normalizeString(raw.source) || null,
      platform: normalizeString(raw.platform) || null,
      tenantId: normalizeString(raw.tenantId) || null,
      originPath: originPath || null,
      programType: normalizeString(raw.programType) || null,
      completedAtMs: timestampToMillis(completedAt || updatedAt || lastSeenAt)
    };
  }

  function isMachineProfileLessonItemEligible(item, uid, tenantId) {
    if (!item) return false;
    if (!isMachineOperatorProgramType(item.programType)) return false;
    if (!isMachineLessonCategoryId(item.categoryId)) return false;
    if (item.completed !== true) return false;
    var docUid = normalizeString(item.uid);
    if (docUid && docUid !== normalizeString(uid)) return false;
    var origin = normalizeString(item.originPath);
    if (origin.indexOf('tenants/') === 0) {
      var docTenant = normalizeString(item.tenantId);
      var expectedTenant = normalizeString(tenantId);
      if (docTenant && expectedTenant && docTenant !== expectedTenant) return false;
    }
    return true;
  }

  function buildMachineLessonProgressDedupeKey(item) {
    if (!item) return '';
    var programType = normalizeString(item.programType) || PROGRAM_TYPE;
    var categoryId = normalizeString(item.categoryId);
    var unitId = normalizeString(item.unitId);
    if (categoryId && unitId) return programType + '__' + categoryId + '__' + unitId;
    var id = normalizeString(item.id);
    if (id) return programType + '__' + id;
    return '';
  }

  function lessonItemRank(item) {
    if (!item) return 0;
    var completed = item.completed === true ? 1 : 0;
    var activityMs = item.completedAtMs || 0;
    return completed * 1000000000000 + activityMs;
  }

  function dedupeMachineLessonProgressItems(items) {
    var map = {};
    (items || []).forEach(function (item) {
      if (!item) return;
      var key = buildMachineLessonProgressDedupeKey(item);
      if (!key) return;
      var existing = map[key];
      if (!existing || lessonItemRank(item) > lessonItemRank(existing)) {
        map[key] = item;
      }
    });
    var out = [];
    Object.keys(map).forEach(function (k) {
      if (map[k]) out.push(map[k]);
    });
    return out;
  }

  async function fetchActiveUnitTotal(categoryId) {
    var db = getDb();
    var cid = normalizeString(categoryId);
    if (!db || !cid) return null;
    try {
      var snap = await db
        .collection('content')
        .doc('lesson_categories')
        .collection('items')
        .doc(cid)
        .collection('units')
        .where('status', '==', 'active')
        .get();
      return (snap && snap.docs) ? snap.docs.length : 0;
    } catch (e) {
      console.warn('[machine-web-profile] unit total failed', cid, e);
      return null;
    }
  }

  async function fetchMachineProfileLessonStats(uid, tenantId) {
    var db = getDb();
    if (!db) throw new Error('firestore_unavailable');
    var rawItems = [];
    var anySuccess = false;
    var lastErr = null;
    var tid = normalizeString(tenantId);

    try {
      var userSnap = await db
        .collection('users')
        .doc(uid)
        .collection('lessonProgress')
        .limit(LESSON_FETCH_LIMIT)
        .get();
      (userSnap.docs || []).forEach(function (d) {
        rawItems.push(
          normalizeMachineLessonProgressItem(d.id, d.data ? d.data() : {}, 'users/' + uid + '/lessonProgress')
        );
      });
      anySuccess = true;
    } catch (e) {
      lastErr = e;
      console.warn('[machine-web-profile] users lessonProgress read failed', e);
    }

    try {
      var webSnap;
      try {
        webSnap = await db
          .collection('users')
          .doc(uid)
          .collection('web_lesson_progress')
          .orderBy('completedAt', 'desc')
          .limit(LESSON_FETCH_LIMIT)
          .get();
      } catch (orderErr) {
        webSnap = await db
          .collection('users')
          .doc(uid)
          .collection('web_lesson_progress')
          .limit(LESSON_FETCH_LIMIT)
          .get();
      }
      (webSnap.docs || []).forEach(function (d) {
        rawItems.push(
          normalizeMachineLessonProgressItem(
            d.id,
            d.data ? d.data() : {},
            'users/' + uid + '/web_lesson_progress'
          )
        );
      });
      anySuccess = true;
    } catch (e) {
      lastErr = e;
      console.warn('[machine-web-profile] web_lesson_progress read failed', e);
    }

    if (tid) {
      try {
        var tenantSnap = await db
          .collection('tenants')
          .doc(tid)
          .collection('lesson_progress')
          .where('uid', '==', uid)
          .limit(LESSON_FETCH_LIMIT)
          .get();
        (tenantSnap.docs || []).forEach(function (d) {
          rawItems.push(
            normalizeMachineLessonProgressItem(
              d.id,
              d.data ? d.data() : {},
              'tenants/' + tid + '/lesson_progress'
            )
          );
        });
        anySuccess = true;
      } catch (e) {
        lastErr = e;
        console.warn('[machine-web-profile] tenant lesson_progress read failed', e);
      }
    }

    if (!anySuccess) throw lastErr || new Error('lesson_progress_unavailable');

    var filtered = rawItems.filter(function (item) {
      return isMachineProfileLessonItemEligible(item, uid, tid);
    });
    var list = dedupeMachineLessonProgressItems(filtered);
    var counts = { is_makineleri: 0, ilk_yardim: 0 };
    list.forEach(function (item) {
      var cid = normalizeString(item.categoryId);
      if (cid === 'is_makineleri' || cid === 'ilk_yardim') {
        counts[cid] = (counts[cid] || 0) + 1;
      }
    });

    var totals = await Promise.all(
      LESSON_CATEGORY_IDS.map(function (cid) {
        return fetchActiveUnitTotal(cid);
      })
    );

    return {
      rows: [
        {
          categoryId: 'is_makineleri',
          title: LESSON_TITLES.is_makineleri,
          completedCount: counts.is_makineleri || 0,
          totalCount: totals[0]
        },
        {
          categoryId: 'ilk_yardim',
          title: LESSON_TITLES.ilk_yardim,
          completedCount: counts.ilk_yardim || 0,
          totalCount: totals[1]
        }
      ]
    };
  }

  async function revalidateSession(session) {
    var fns = getFunctions();
    if (!fns || !session) return session;
    try {
      var callable = fns.httpsCallable('resolveMachineCandidateSession');
      var payload =
        session.mode === 'institution'
          ? { mode: 'institution', tenantId: session.tenantId }
          : { mode: 'public' };
      var result = await callable(payload);
      var data = result && result.data && typeof result.data === 'object' ? result.data : null;
      if (!data || data.ok !== true) {
        redirectLogin();
        return null;
      }
      var api = window.SA_MACHINE_WEB_SESSION;
      var next = Object.assign({}, session, {
        uid: data.uid != null ? String(data.uid) : session.uid,
        tenantId: data.tenantId != null ? String(data.tenantId) : session.tenantId,
        membershipId: data.membershipId != null ? String(data.membershipId) : session.membershipId,
        programType: PROGRAM_TYPE,
        enrollmentSource:
          data.enrollmentSource != null ? String(data.enrollmentSource) : session.enrollmentSource,
        accessStatus: data.accessStatus != null ? String(data.accessStatus) : session.accessStatus,
        accessExpiresAt:
          data.accessExpiresAt == null || data.accessExpiresAt === ''
            ? null
            : Number(data.accessExpiresAt),
        accessDaysRemaining:
          data.accessDaysRemaining == null || data.accessDaysRemaining === ''
            ? null
            : Number(data.accessDaysRemaining),
        savedAt: Date.now()
      });
      if (api) api.saveMachineSession(next);
      return next;
    } catch (e) {
      console.warn('[machine-web-profile] revalidate failed', e);
      redirectLogin();
      return null;
    }
  }

  async function paintBranding(session) {
    var api = window.SA_MACHINE_WEB_SESSION;
    if (!api || !session) return;

    var heroEl = document.querySelector('.machine-web-profile-hero');
    var instNameEl = $('machine-web-profile-institution-name');
    var brandEl = $('machine-web-profile-brand-name');
    var programEl = $('machine-web-profile-program-title');
    var logoEl = $('machine-web-profile-logo');
    var monoEl = $('machine-web-profile-monogram');

    if (programEl) {
      programEl.textContent = 'İş Makineleri Operatörlük Sınavlarına Hazırlık';
    }
    if (brandEl) brandEl.textContent = 'Sürücü Akademisi';

    var isPublic = isPublicSession(session);
    if (heroEl) {
      heroEl.setAttribute('data-brand-mode', isPublic ? 'public' : 'institution');
    }

    var branding = await api.loadTenantBranding(session.tenantId);

    if (isPublic) {
      if (instNameEl) {
        instNameEl.hidden = true;
        instNameEl.textContent = '';
      }
      if (branding.showInstitutionLogo === false) {
        if (logoEl) {
          logoEl.hidden = true;
          logoEl.removeAttribute('src');
        }
        if (monoEl) {
          monoEl.hidden = false;
          monoEl.textContent = 'S';
        }
      } else {
        api.applyLogoWithFallback(
          logoEl,
          monoEl,
          api.DEFAULT_SA_LOGO,
          ['/assets/tenant-logos/surucu_akademisi.png'],
          'Sürücü Akademisi logosu',
          'S'
        );
      }
      return branding;
    }

    if (instNameEl) {
      instNameEl.hidden = false;
      instNameEl.textContent = branding.tenantName || session.tenantId || 'Kurum';
    }

    if (branding.showInstitutionLogo === false) {
      if (logoEl) {
        logoEl.hidden = true;
        logoEl.removeAttribute('src');
      }
      if (monoEl) {
        monoEl.hidden = false;
        monoEl.textContent = api.getMonogram(branding.tenantName, session.tenantId);
      }
      return branding;
    }

    api.applyLogoWithFallback(
      logoEl,
      monoEl,
      branding.logoUrl,
      [
        '/assets/tenant-logos/' + String(session.tenantId || '').trim() + '.png',
        api.DEFAULT_SA_LOGO
      ],
      (branding.tenantName || 'Kurum') + ' logosu',
      branding.monogram || 'K'
    );
    return branding;
  }

  async function resolveIdentity(session, authUser) {
    var email = '';
    if (authUser && authUser.email) email = normalizeString(authUser.email);
    var name = '';
    if (authUser && authUser.displayName) name = normalizeString(authUser.displayName);
    if (!name) name = normalizeString(session.fullName || session.displayName);
    if (!name && email && email.indexOf('@') > 0) name = email.split('@')[0];
    if (!name) name = 'Aday';

    var isPublic = isPublicSession(session);
    var institutionName = '';
    if (!isPublic) {
      institutionName = normalizeString(session.tenantName);
      if (!institutionName) {
        try {
          var api = window.SA_MACHINE_WEB_SESSION;
          if (api) {
            var branding = await api.loadTenantBranding(session.tenantId);
            institutionName = normalizeString(branding && branding.tenantName) || normalizeString(session.tenantId);
          }
        } catch (_) {
          institutionName = normalizeString(session.tenantId);
        }
      }
    }

    return {
      name: name,
      email: email,
      accountType: isPublic ? 'Bireysel' : 'Kurum Öğrencisi',
      institutionName: institutionName,
      isPublic: isPublic
    };
  }

  function renderIdentity(identity) {
    var idn = identity || {};
    var nameEl = $('machine-web-profile-identity-name');
    var emailEl = $('machine-web-profile-identity-email');
    var typeEl = $('machine-web-profile-identity-type');
    var instRow = $('machine-web-profile-identity-institution-row');
    var instEl = $('machine-web-profile-identity-institution');
    if (nameEl) nameEl.textContent = idn.name || 'Aday';
    if (emailEl) emailEl.textContent = idn.email || '—';
    if (typeEl) typeEl.textContent = idn.accountType || '—';
    if (instRow && instEl) {
      if (!idn.isPublic && idn.institutionName) {
        instRow.hidden = false;
        instEl.textContent = idn.institutionName;
      } else {
        instRow.hidden = true;
        instEl.textContent = '';
      }
    }
  }

  function renderLessonRows(rows, mode) {
    var loading = $('machine-web-profile-lessons-loading');
    var errorEl = $('machine-web-profile-lessons-error');
    var grid = $('machine-web-profile-lessons-grid');
    if (loading) loading.hidden = mode !== 'loading';
    if (errorEl) errorEl.hidden = mode !== 'error';
    if (!grid) return;
    if (mode === 'loading' || mode === 'error') {
      grid.hidden = true;
      grid.innerHTML = '';
      return;
    }
    grid.hidden = false;
    var list = Array.isArray(rows) ? rows : [];
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      var cid = normalizeString(row.categoryId);
      var accent = cid === 'ilk_yardim' ? 'green' : 'gold';
      var completed = Math.max(0, Number(row.completedCount) || 0);
      var total = row.totalCount != null && isFinite(Number(row.totalCount)) ? Number(row.totalCount) : null;
      var countText = total != null ? String(completed) + ' / ' + String(total) : String(completed) + ' / —';
      var pctText = '';
      if (total != null && total > 0) {
        var pct = Math.round((completed / total) * 100);
        if (isFinite(pct)) {
          pctText = '<span class="machine-web-profile-lesson-pct">· %' + String(pct) + '</span>';
        }
      }
      html +=
        '<article class="machine-web-profile-lesson-card machine-web-profile-lesson-card--' +
        accent +
        '">' +
        '<h3 class="machine-web-profile-lesson-title">' +
        escapeHtml(row.title || LESSON_TITLES[cid] || cid) +
        '</h3>' +
        '<p class="machine-web-profile-lesson-count">' +
        escapeHtml(countText) +
        pctText +
        '</p>' +
        '</article>';
    }
    grid.innerHTML = html;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderExamCategory(prefix, stats, mode) {
    var loading = $(prefix + '-loading');
    var errorEl = $(prefix + '-error');
    var body = $(prefix + '-body');
    if (loading) loading.hidden = mode !== 'loading';
    if (errorEl) errorEl.hidden = mode !== 'error';
    if (body) body.hidden = mode !== 'stats';
    if (mode !== 'stats') return;
    var s = stats || emptyExamStats();
    setText(prefix + '-completed', String(s.completed || 0));
    setText(prefix + '-average', '%' + String(s.average || 0));
    setText(prefix + '-best', '%' + String(s.best || 0));
    setText(prefix + '-last', formatExamDateShort(s.lastAttemptAt));
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  async function loadProgress(session) {
    var token = ++loadToken;
    setRefreshBusy(true);
    setStatus('İlerlemeniz hazırlanıyor', false);
    renderLessonRows([], 'loading');
    renderExamCategory('machine-web-profile-exam-wm', null, 'loading');
    renderExamCategory('machine-web-profile-exam-fa', null, 'loading');

    var uid = normalizeString(session.uid);
    var tenantId = normalizeString(session.tenantId);

    var lessonResult = null;
    var lessonError = null;
    try {
      lessonResult = await fetchMachineProfileLessonStats(uid, tenantId);
    } catch (e) {
      lessonError = e;
      console.warn('[machine-web-profile] lesson load failed', e);
    }

    if (token !== loadToken) return;

    if (lessonError) {
      renderLessonRows([], 'error');
    } else {
      renderLessonRows((lessonResult && lessonResult.rows) || [], 'stats');
    }

    var examResult = null;
    var examError = null;
    try {
      examResult = await fetchMachineProfileExamStats(uid, tenantId);
    } catch (e) {
      examError = e;
      console.warn('[machine-web-profile] exam load failed', e);
    }

    if (token !== loadToken) return;

    if (examError) {
      renderExamCategory('machine-web-profile-exam-wm', null, 'error');
      renderExamCategory('machine-web-profile-exam-fa', null, 'error');
    } else {
      renderExamCategory(
        'machine-web-profile-exam-wm',
        (examResult && examResult.work_machines) || emptyExamStats(),
        'stats'
      );
      renderExamCategory(
        'machine-web-profile-exam-fa',
        (examResult && examResult.first_aid) || emptyExamStats(),
        'stats'
      );
    }

    if (lessonError && examError) {
      setStatus('İlerlemeniz şu anda yüklenemedi. Lütfen Yenile ile tekrar deneyin.', true);
    } else if (lessonError) {
      setStatus('Ders ilerlemesi şu anda yüklenemedi.', true);
    } else if (examError) {
      setStatus('Sınav ilerlemesi şu anda yüklenemedi.', true);
    } else {
      setStatus('', false);
    }

    setRefreshBusy(false);
  }

  async function boot(user) {
    if (settled) return;
    var api = window.SA_MACHINE_WEB_SESSION;
    if (!user || !api) {
      settled = true;
      redirectLogin();
      return;
    }

    var session = api.requireMachineSession();
    if (!session) {
      settled = true;
      redirectLogin();
      return;
    }

    if (normalizeString(session.uid) !== normalizeString(user.uid)) {
      settled = true;
      redirectLogin();
      return;
    }

    if (!isMachineOperatorProgramType(session.programType)) {
      settled = true;
      redirectLogin();
      return;
    }

    session = await revalidateSession(session);
    if (!session) {
      settled = true;
      return;
    }

    currentSession = session;
    await paintBranding(session);
    var identity = await resolveIdentity(session, user);
    renderIdentity(identity);
    showShell();
    settled = true;
    await loadProgress(session);
  }

  function bindChrome() {
    var homeLink = $('machine-web-profile-home');
    if (homeLink) {
      homeLink.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.href = HOME_HREF;
      });
    }

    var logoutBtn = $('machine-web-profile-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        logoutBtn.disabled = true;
        var api = window.SA_MACHINE_WEB_SESSION;
        var p = api && api.logoutMachine ? api.logoutMachine() : Promise.resolve();
        p.then(function () {
          window.location.replace(LOGIN_HREF);
        }).catch(function () {
          window.location.replace(LOGIN_HREF);
        });
      });
    }

    var refreshBtn = $('machine-web-profile-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        if (!currentSession) return;
        loadProgress(currentSession);
      });
    }
  }

  function waitAuth() {
    var auth = getAuth();
    if (!auth) {
      setTimeout(function () {
        if (!getAuth()) redirectLogin();
        else waitAuth();
      }, 120);
      return;
    }
    auth.onAuthStateChanged(function (user) {
      boot(user);
    });
  }

  function init() {
    bindChrome();
    waitAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
