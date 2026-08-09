/**
 * Machine web Dersler — hub / units / reader + canonical Machine progress.
 * Scope: is_makineleri + ilk_yardim only. Writes machine_operator__* progress.
 */
(function () {
  'use strict';

  var PROGRAM_TYPE = 'machine_operator';
  var REGION = 'us-central1';
  var HOME_HREF = '../';
  var LOGIN_HREF = '../giris/';
  var HUB_HREF = './';

  var CATEGORY_ALLOWLIST = ['is_makineleri', 'ilk_yardim'];

  var CATEGORY_FALLBACK = {
    is_makineleri: {
      title: 'İş Makineleri',
      description: 'İş makineleri operatörlük sınavlarına yönelik ders içerikleri.',
      accent: 'gold',
      order: 1
    },
    ilk_yardim: {
      title: 'İlk Yardım',
      description: 'Temel ilk yardım, kaza anı müdahale ve güvenli yardım bilgileri.',
      accent: 'green',
      order: 2
    }
  };

  var settled = false;
  var currentSession = null;
  var completionWriteInFlight = false;
  var completionCache = Object.create(null);

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getPage() {
    return normalizeString(document.body && document.body.getAttribute('data-ml-page'));
  }

  function getAuth() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.auth) return fb.auth;
    if (typeof firebase !== 'undefined' && firebase.auth) return firebase.auth();
    return null;
  }

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof firebase !== 'undefined' && firebase.firestore) return firebase.firestore();
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

  function isCategoryAllowed(categoryId) {
    return CATEGORY_ALLOWLIST.indexOf(normalizeString(categoryId)) >= 0;
  }

  function buildProgressDocId(categoryId, unitId) {
    var cid = normalizeString(categoryId);
    var uid = normalizeString(unitId);
    if (!cid || !uid || !isCategoryAllowed(cid)) return '';
    return PROGRAM_TYPE + '__' + cid + '__' + uid;
  }

  function buildTenantProgressDocId(userUid, categoryId, unitId) {
    var u = normalizeString(userUid);
    var cid = normalizeString(categoryId);
    var unit = normalizeString(unitId);
    if (!u || !cid || !unit || !isCategoryAllowed(cid)) return '';
    return u + '__' + PROGRAM_TYPE + '__' + cid + '__' + unit;
  }

  function isPublicSession(session) {
    return !!(session && (normalizeString(session.mode) === 'public' || normalizeString(session.enrollmentSource) === 'public'));
  }

  function isProgressPayloadValid(data, categoryId, unitId) {
    if (!data || typeof data !== 'object') return false;
    if (normalizeString(data.programType) !== PROGRAM_TYPE) return false;
    if (normalizeString(data.categoryId) !== normalizeString(categoryId)) return false;
    if (normalizeString(data.unitId) !== normalizeString(unitId)) return false;
    if (!isCategoryAllowed(data.categoryId)) return false;
    return data.completed === true || normalizeString(data.status) === 'completed';
  }

  function redirectLogin() {
    var api = window.SA_MACHINE_WEB_SESSION;
    if (api) api.clearMachineSession();
    window.location.replace(LOGIN_HREF);
  }

  function redirectHub() {
    window.location.replace(HUB_HREF);
  }

  function showShell() {
    var shell = $('machine-web-lessons');
    var gate = $('machine-web-lessons-gate');
    if (shell) shell.hidden = false;
    if (gate) gate.hidden = true;
  }

  function lessonCategoriesRef() {
    var db = getDb();
    if (!db) return null;
    return db.collection('content').doc('lesson_categories').collection('items');
  }

  function lessonUnitsRef(categoryId) {
    var ref = lessonCategoriesRef();
    if (!ref) return null;
    return ref.doc(normalizeString(categoryId)).collection('units');
  }

  function lessonBlocksRef(categoryId, unitId) {
    var units = lessonUnitsRef(categoryId);
    if (!units) return null;
    return units.doc(normalizeString(unitId)).collection('blocks');
  }

  function sortByOrder(items) {
    var list = Array.isArray(items) ? items.slice() : [];
    list.sort(function (a, b) {
      return Number(a.order || 0) - Number(b.order || 0);
    });
    return list;
  }

  function readQueryParam(name) {
    try {
      return normalizeString(new URLSearchParams(window.location.search).get(name));
    } catch (_) {
      return '';
    }
  }

  function unitsHref(categoryId) {
    return 'units.html?categoryId=' + encodeURIComponent(normalizeString(categoryId));
  }

  function readHref(categoryId, unitId) {
    return (
      'read.html?categoryId=' +
      encodeURIComponent(normalizeString(categoryId)) +
      '&unitId=' +
      encodeURIComponent(normalizeString(unitId))
    );
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
      console.warn('[machine-web-lessons] revalidate failed', e);
      redirectLogin();
      return null;
    }
  }

  async function paintBranding(session) {
    var api = window.SA_MACHINE_WEB_SESSION;
    if (!api || !session) return;

    var heroEl = document.querySelector('.machine-web-lessons-hero');
    var instNameEl = $('machine-web-lessons-institution-name');
    var brandEl = $('machine-web-lessons-brand-name');
    var programEl = $('machine-web-lessons-program-title');
    var logoEl = $('machine-web-lessons-logo');
    var monoEl = $('machine-web-lessons-monogram');

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

  async function loadCategoryMeta(categoryId) {
    var cid = normalizeString(categoryId);
    var fb = CATEGORY_FALLBACK[cid] || { title: cid, description: '', accent: 'gold', order: 99 };
    var base = {
      id: cid,
      title: fb.title,
      description: fb.description,
      accent: fb.accent,
      order: fb.order,
      status: 'active'
    };
    var ref = lessonCategoriesRef();
    if (!ref) return base;
    try {
      var snap = await ref.doc(cid).get();
      if (!snap.exists) return base;
      var d = snap.data() || {};
      var status = normalizeString(d.status).toLowerCase() || 'draft';
      return {
        id: cid,
        title: normalizeString(d.title) || fb.title,
        description: normalizeString(d.description) || fb.description,
        accent: fb.accent,
        order: d.order != null ? Number(d.order) : fb.order,
        status: status
      };
    } catch (e) {
      console.warn('[machine-web-lessons] category meta failed', e);
      return base;
    }
  }

  async function loadActiveUnits(categoryId) {
    var cid = normalizeString(categoryId);
    if (!isCategoryAllowed(cid)) {
      return { ok: false, units: [], error: 'Bu ders kategorisi İş Makineleri programında kullanılamaz.' };
    }
    var ref = lessonUnitsRef(cid);
    if (!ref) {
      return { ok: false, units: [], error: 'Veritabanı hazır değil.' };
    }
    try {
      var snap = await ref.where('status', '==', 'active').get();
      var units = sortByOrder(
        snap.docs.map(function (doc) {
          var d = doc.data() || {};
          return {
            id: doc.id,
            title: normalizeString(d.title) || doc.id,
            order: d.order != null ? Number(d.order) : 999,
            status: normalizeString(d.status).toLowerCase() || 'draft',
            youtubeUrl: normalizeString(d.youtubeUrl)
          };
        })
      );
      return { ok: true, units: units, error: null };
    } catch (e) {
      console.warn('[machine-web-lessons] load units failed', e);
      return { ok: false, units: [], error: 'Üniteler yüklenemedi. Lütfen tekrar deneyin.' };
    }
  }

  async function loadUnitWithBlocks(categoryId, unitId) {
    var cid = normalizeString(categoryId);
    var uid = normalizeString(unitId);
    if (!isCategoryAllowed(cid)) {
      return { ok: false, unit: null, blocks: [], error: 'Bu ders kategorisi İş Makineleri programında kullanılamaz.' };
    }
    if (!uid) {
      return { ok: false, unit: null, blocks: [], error: 'Geçersiz ünite.' };
    }
    var unitsRef = lessonUnitsRef(cid);
    if (!unitsRef) {
      return { ok: false, unit: null, blocks: [], error: 'Veritabanı hazır değil.' };
    }
    try {
      var unitSnap = await unitsRef.doc(uid).get();
      if (!unitSnap.exists) {
        return { ok: false, unit: null, blocks: [], error: 'Ünite bulunamadı.' };
      }
      var d = unitSnap.data() || {};
      var unit = {
        id: unitSnap.id,
        title: normalizeString(d.title) || unitSnap.id,
        order: d.order != null ? Number(d.order) : 999,
        status: normalizeString(d.status).toLowerCase() || 'draft',
        youtubeUrl: normalizeString(d.youtubeUrl)
      };
      if (unit.status !== 'active') {
        return { ok: false, unit: null, blocks: [], error: 'Bu ünite yayında değil.' };
      }

      var blockSnap = await lessonBlocksRef(cid, uid).get();
      var blocks = sortByOrder(
        blockSnap.docs.map(function (doc) {
          var b = doc.data() || {};
          return {
            id: doc.id,
            type: b.type === 'image' ? 'image' : 'text',
            order: b.order != null ? Number(b.order) : 999,
            text: b.text != null ? String(b.text) : '',
            textPreset: normalizeString(b.textPreset).toLowerCase() || 'normal',
            textSegments: Array.isArray(b.textSegments) ? b.textSegments : [],
            textFormatVersion: b.textFormatVersion === 1 ? 1 : 0,
            imageUrl: normalizeString(b.imageUrl),
            caption: normalizeString(b.caption)
          };
        })
      );
      return { ok: true, unit: unit, blocks: blocks, error: null };
    } catch (e) {
      console.warn('[machine-web-lessons] load unit failed', e);
      return { ok: false, unit: null, blocks: [], error: 'Ders içeriği yüklenemedi. Lütfen tekrar deneyin.' };
    }
  }

  async function resolveUnitCompleted(session, categoryId, unitId) {
    var cid = normalizeString(categoryId);
    var uId = normalizeString(unitId);
    var docId = buildProgressDocId(cid, uId);
    if (!docId || !session) return false;
    if (Object.prototype.hasOwnProperty.call(completionCache, docId)) {
      return completionCache[docId] === true;
    }
    var db = getDb();
    if (!db) return false;
    try {
      var snap = await db
        .collection('users')
        .doc(session.uid)
        .collection('lessonProgress')
        .doc(docId)
        .get();
      if (!snap.exists) {
        completionCache[docId] = false;
        return false;
      }
      var ok = isProgressPayloadValid(snap.data() || {}, cid, uId);
      completionCache[docId] = ok;
      return ok;
    } catch (e) {
      console.warn('[machine-web-lessons] completion read failed', e);
      return false;
    }
  }

  async function loadCompletionMapForUnits(session, categoryId, unitIds) {
    var map = Object.create(null);
    var ids = Array.isArray(unitIds) ? unitIds : [];
    await Promise.all(
      ids.map(function (unitId) {
        return resolveUnitCompleted(session, categoryId, unitId).then(function (ok) {
          var docId = buildProgressDocId(categoryId, unitId);
          if (docId) map[docId] = !!ok;
        });
      })
    );
    return map;
  }

  async function markUnitCompleted(session, categoryId, unitId) {
    var cid = normalizeString(categoryId);
    var uId = normalizeString(unitId);
    if (!isCategoryAllowed(cid) || !uId) {
      return { ok: false, reason: 'category_not_allowed' };
    }
    if (!session || normalizeString(session.programType) !== PROGRAM_TYPE) {
      return { ok: false, reason: 'invalid_session' };
    }
    var sessionUid = normalizeString(session.uid);
    var auth = getAuth();
    var authUser = auth && auth.currentUser ? auth.currentUser : null;
    if (!sessionUid || !authUser || normalizeString(authUser.uid) !== sessionUid) {
      return { ok: false, reason: 'auth_mismatch' };
    }
    var db = getDb();
    if (!db || typeof firebase === 'undefined' || !firebase.firestore) {
      return { ok: false, reason: 'firestore_unavailable' };
    }

    var docId = buildProgressDocId(cid, uId);
    if (!docId) return { ok: false, reason: 'bad_doc_id' };

    if (completionCache[docId] === true) {
      return { ok: true, skipped: true, docId: docId };
    }

    var already = await resolveUnitCompleted(session, cid, uId);
    if (already) {
      return { ok: true, skipped: true, docId: docId };
    }

    var ts = firebase.firestore.FieldValue.serverTimestamp();
    var payload = {
      uid: sessionUid,
      categoryId: cid,
      unitId: uId,
      programType: PROGRAM_TYPE,
      completed: true,
      status: 'completed',
      progressPercent: 100,
      source: 'web',
      platform: 'web',
      completedAt: ts,
      lastSeenAt: ts
    };

    try {
      await db
        .collection('users')
        .doc(sessionUid)
        .collection('lessonProgress')
        .doc(docId)
        .set(payload, { merge: true });
    } catch (e) {
      console.warn('[machine-web-lessons] user lessonProgress write failed', e);
      return { ok: false, reason: 'write_failed' };
    }

    completionCache[docId] = true;

    var mirrorWarning = false;
    if (!isPublicSession(session)) {
      var tenantId = normalizeString(session.tenantId);
      if (tenantId) {
        try {
          var tenantDocId = buildTenantProgressDocId(sessionUid, cid, uId);
          if (tenantDocId) {
            await db
              .collection('tenants')
              .doc(tenantId)
              .collection('lesson_progress')
              .doc(tenantDocId)
              .set(
                {
                  uid: sessionUid,
                  tenantId: tenantId,
                  userType: 'institution_student',
                  categoryId: cid,
                  unitId: uId,
                  programType: PROGRAM_TYPE,
                  completed: true,
                  status: 'completed',
                  progressPercent: 100,
                  source: 'web',
                  platform: 'web',
                  completedAt: ts,
                  updatedAt: ts,
                  lastSeenAt: ts
                },
                { merge: true }
              );
          }
        } catch (tenantErr) {
          mirrorWarning = true;
          console.warn('[machine-web-lessons] tenant lesson_progress mirror failed', tenantErr);
        }
      }
    }

    return { ok: true, docId: docId, mirrorWarning: mirrorWarning };
  }

  /* —— Block rendering (Driving reader semantics, Machine-scoped classes) —— */

  function normalizeSegments(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (seg) {
        return {
          text: String(seg && seg.text || ''),
          marks: Array.isArray(seg && seg.marks) ? seg.marks : []
        };
      })
      .filter(function (seg) {
        return seg.text.length > 0;
      });
  }

  function segmentClassList(marks) {
    var cls = ['ml-text-seg'];
    var m = marks || [];
    if (m.indexOf('bold') >= 0) cls.push('ml-text-seg--bold');
    if (m.indexOf('danger') >= 0) cls.push('ml-text-seg--danger');
    if (m.indexOf('italic') >= 0) cls.push('ml-text-seg--italic');
    return cls.join(' ');
  }

  function renderTextBlock(block) {
    var attached = '';
    var attUrl = normalizeString(block.imageUrl);
    if (attUrl) {
      attached =
        '<div class="ml-block-attached">'
        + '<img class="ml-image ml-image--inline" src="' + escapeHtml(attUrl) + '" alt="" loading="lazy" />'
        + (block.caption
          ? '<p class="ml-image-caption">' + escapeHtml(block.caption) + '</p>'
          : '')
        + '</div>';
    }

    var segs = normalizeSegments(block.textSegments);
    if (segs.length) {
      var parts = segs
        .map(function (seg) {
          return (
            '<span class="' + segmentClassList(seg.marks) + '">' + escapeHtml(seg.text) + '</span>'
          );
        })
        .join('');
      return (
        '<article class="ml-block ml-block--text ml-block--segments">'
        + '<div class="ml-text-body ml-text-body--segments">' + parts + '</div>'
        + attached
        + '</article>'
      );
    }

    var preset = normalizeString(block.textPreset).toLowerCase() || 'normal';
    if (['normal', 'info', 'warning', 'danger'].indexOf(preset) < 0) preset = 'normal';
    var safeText = escapeHtml(block.text).replace(/\n/g, '<br />');

    return (
      '<article class="ml-block ml-block--text ml-block--preset-' + escapeHtml(preset) + '">'
      + '<div class="ml-text-body">' + safeText + '</div>'
      + attached
      + '</article>'
    );
  }

  function renderImageBlock(block) {
    var url = normalizeString(block.imageUrl);
    if (!url) return '';
    return (
      '<article class="ml-block ml-block--image">'
      + '<figure class="ml-figure">'
      + '<img class="ml-image" src="' + escapeHtml(url) + '" alt="" loading="lazy" />'
      + (block.caption
        ? '<figcaption class="ml-image-caption">' + escapeHtml(block.caption) + '</figcaption>'
        : '')
      + '</figure>'
      + '</article>'
    );
  }

  function isSafeYoutubeUrl(url) {
    var u = normalizeString(url);
    if (!/^https:\/\//i.test(u)) return false;
    return /^(https:\/\/(www\.)?youtube\.com\/|https:\/\/youtu\.be\/)/i.test(u);
  }

  function renderYoutubeArea(youtubeUrl) {
    if (!isSafeYoutubeUrl(youtubeUrl)) return '';
    return (
      '<aside class="ml-youtube">'
      + '<p class="ml-youtube__label">Video içeriği</p>'
      + '<a class="ml-youtube__link" href="' + escapeHtml(youtubeUrl) + '" target="_blank" rel="noopener noreferrer">YouTube\'da izle</a>'
      + '</aside>'
    );
  }

  function renderBlocks(blocks) {
    var host = $('machine-web-lessons-blocks');
    if (!host) return;
    if (!blocks || !blocks.length) {
      host.innerHTML = '<p class="machine-web-lessons-empty">Bu ünitede henüz içerik yok.</p>';
      return;
    }
    host.innerHTML = blocks
      .map(function (block) {
        if (block.type === 'image') return renderImageBlock(block);
        return renderTextBlock(block);
      })
      .join('');
  }

  /* —— Page renderers —— */

  async function renderHub() {
    var loading = $('machine-web-lessons-hub-loading');
    var errorEl = $('machine-web-lessons-hub-error');
    var grid = $('machine-web-lessons-category-grid');
    if (loading) loading.hidden = false;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    if (grid) {
      grid.hidden = true;
      grid.innerHTML = '';
    }

    var metas = await Promise.all(
      CATEGORY_ALLOWLIST.map(function (cid) {
        return loadCategoryMeta(cid);
      })
    );
    metas = sortByOrder(metas);

    if (loading) loading.hidden = true;
    if (!grid) return;

    grid.hidden = false;
    grid.innerHTML = metas
      .map(function (cat) {
        var accent = cat.accent === 'green' ? 'green' : 'gold';
        var note =
          cat.id === 'is_makineleri'
            ? '<p class="machine-web-lessons-book-card__note">Sadece operatörlük sınavına girecek adaylar içindir.</p>'
            : '';
        return (
          '<article class="machine-web-lessons-book-card machine-web-lessons-book-card--'
          + accent
          + ' machine-web-lessons-book-card--clickable" data-category-id="'
          + escapeHtml(cat.id)
          + '" role="link" tabindex="0">'
          + '<h2 class="machine-web-lessons-book-card__title">'
          + escapeHtml(cat.title)
          + '</h2>'
          + '<p class="machine-web-lessons-book-card__desc">'
          + escapeHtml(cat.description)
          + '</p>'
          + note
          + '<span class="machine-web-lessons-book-card__cta">Üniteleri Gör</span>'
          + '</article>'
        );
      })
      .join('');

    Array.prototype.slice
      .call(grid.querySelectorAll('.machine-web-lessons-book-card[data-category-id]'))
      .forEach(function (card) {
        var categoryId = card.getAttribute('data-category-id');
        function go() {
          if (!isCategoryAllowed(categoryId)) {
            redirectHub();
            return;
          }
          window.location.href = unitsHref(categoryId);
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

  async function renderUnits(session) {
    var categoryId = readQueryParam('categoryId');
    if (!isCategoryAllowed(categoryId)) {
      redirectHub();
      return;
    }

    var titleEl = $('machine-web-lessons-units-title');
    var loading = $('machine-web-lessons-units-loading');
    var errorEl = $('machine-web-lessons-units-error');
    var emptyEl = $('machine-web-lessons-units-empty');
    var grid = $('machine-web-lessons-unit-grid');
    var backCat = $('machine-web-lessons-back-categories');

    if (backCat) backCat.setAttribute('href', HUB_HREF);

    var meta = await loadCategoryMeta(categoryId);
    if (titleEl) titleEl.textContent = meta.title || categoryId;

    if (loading) loading.hidden = false;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    if (emptyEl) emptyEl.hidden = true;
    if (grid) {
      grid.hidden = true;
      grid.innerHTML = '';
    }

    var result = await loadActiveUnits(categoryId);
    if (loading) loading.hidden = true;

    if (!result.ok) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = result.error || 'Üniteler yüklenemedi.';
      }
      return;
    }

    var units = result.units || [];
    if (!units.length) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = 'Bu kitapta henüz yayında ünite yok.';
      }
      return;
    }

    var unitIds = units.map(function (u) {
      return u.id;
    });
    var completionMap = await loadCompletionMapForUnits(session, categoryId, unitIds);

    if (!grid) return;
    grid.hidden = false;
    grid.innerHTML = units
      .map(function (unit, index) {
        var docId = buildProgressDocId(categoryId, unit.id);
        var completed = !!(docId && completionMap[docId]);
        var cardClass =
          'machine-web-lessons-unit-card' + (completed ? ' machine-web-lessons-unit-card--completed' : '');
        var statusHtml = completed
          ? '<span class="machine-web-lessons-unit-status">✓ Tamamlandı</span>'
          : '';
        return (
          '<article class="'
          + cardClass
          + '" data-unit-id="'
          + escapeHtml(unit.id)
          + '" role="link" tabindex="0">'
          + '<span class="machine-web-lessons-unit-card__index">'
          + (index + 1)
          + '</span>'
          + '<h2 class="machine-web-lessons-unit-card__title">'
          + escapeHtml(unit.title)
          + '</h2>'
          + '<div class="machine-web-lessons-unit-card__actions">'
          + statusHtml
          + '<span class="machine-web-lessons-unit-card__cta">Oku</span>'
          + '</div>'
          + '</article>'
        );
      })
      .join('');

    Array.prototype.slice
      .call(grid.querySelectorAll('.machine-web-lessons-unit-card[data-unit-id]'))
      .forEach(function (card) {
        var unitId = card.getAttribute('data-unit-id');
        function go() {
          window.location.href = readHref(categoryId, unitId);
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

  function setProgressUi(completed, saving) {
    var panel = $('machine-web-lessons-progress');
    var status = $('machine-web-lessons-progress-status');
    var action = $('machine-web-lessons-progress-action');
    var msg = $('machine-web-lessons-progress-message');
    if (!panel) return;
    panel.hidden = false;
    panel.classList.toggle('machine-web-lessons-progress--completed', !!completed);
    if (status) {
      status.textContent = completed ? '✓ Tamamlandı' : 'Bu üniteyi tamamlandı olarak işaretleyebilirsiniz.';
      status.classList.toggle('machine-web-lessons-progress__status--done', !!completed);
    }
    if (action) {
      action.hidden = false;
      action.disabled = !!completed || !!saving;
      action.textContent = completed
        ? 'Tamamlandı'
        : saving
          ? 'Kaydediliyor…'
          : 'Tamamlandı olarak işaretle';
      action.classList.toggle('machine-web-lessons-progress__btn--completed', !!completed);
      action.classList.toggle('machine-web-lessons-progress__btn--saving', !!saving);
      action.setAttribute('aria-pressed', completed ? 'true' : 'false');
    }
    if (msg && !saving) {
      /* keep existing message unless cleared by caller */
    }
  }

  function setProgressMessage(text, isError) {
    var msg = $('machine-web-lessons-progress-message');
    if (!msg) return;
    if (!text) {
      msg.hidden = true;
      msg.textContent = '';
      msg.classList.remove('machine-web-lessons-progress__message--error');
      return;
    }
    msg.hidden = false;
    msg.textContent = text;
    msg.classList.toggle('machine-web-lessons-progress__message--error', !!isError);
  }

  async function renderReader(session) {
    var categoryId = readQueryParam('categoryId');
    var unitId = readQueryParam('unitId');
    if (!isCategoryAllowed(categoryId) || !unitId) {
      redirectHub();
      return;
    }

    var meta = await loadCategoryMeta(categoryId);
    var crumb = $('machine-web-lessons-crumb-category');
    var backUnits = $('machine-web-lessons-back-units');
    var unitsUrl = unitsHref(categoryId);
    if (crumb) {
      crumb.textContent = meta.title || categoryId;
      crumb.setAttribute('href', unitsUrl);
    }
    if (backUnits) backUnits.setAttribute('href', unitsUrl);

    var loading = $('machine-web-lessons-reader-loading');
    var errorEl = $('machine-web-lessons-reader-error');
    var titleEl = $('machine-web-lessons-reader-title');
    var ytHost = $('machine-web-lessons-youtube');
    var blocksHost = $('machine-web-lessons-blocks');
    var progress = $('machine-web-lessons-progress');

    if (loading) loading.hidden = false;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    if (ytHost) {
      ytHost.hidden = true;
      ytHost.innerHTML = '';
    }
    if (blocksHost) {
      blocksHost.hidden = true;
      blocksHost.innerHTML = '';
    }
    if (progress) progress.hidden = true;

    var result = await loadUnitWithBlocks(categoryId, unitId);
    if (loading) loading.hidden = true;

    if (!result.ok || !result.unit) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = result.error || 'Ders içeriği yüklenemedi.';
      }
      return;
    }

    if (titleEl) titleEl.textContent = result.unit.title || 'Ders';
    if (ytHost) {
      var ytHtml = renderYoutubeArea(result.unit.youtubeUrl);
      if (ytHtml) {
        ytHost.innerHTML = ytHtml;
        ytHost.hidden = false;
      }
    }
    if (blocksHost) {
      blocksHost.hidden = false;
      renderBlocks(result.blocks || []);
    }

    var completed = await resolveUnitCompleted(session, categoryId, unitId);
    setProgressUi(completed, false);
    setProgressMessage('', false);

    var action = $('machine-web-lessons-progress-action');
    if (action) {
      action.onclick = async function () {
        if (completionWriteInFlight) return;
        if (completionCache[buildProgressDocId(categoryId, unitId)] === true) {
          setProgressUi(true, false);
          return;
        }
        completionWriteInFlight = true;
        setProgressUi(false, true);
        setProgressMessage('', false);
        var writeResult = await markUnitCompleted(session, categoryId, unitId);
        completionWriteInFlight = false;
        if (writeResult && writeResult.ok) {
          setProgressUi(true, false);
          if (writeResult.mirrorWarning) {
            setProgressMessage(
              'Ders tamamlandı. Kurum senkronu geçici olarak gecikebilir.',
              false
            );
          } else {
            setProgressMessage('Ünite tamamlandı olarak kaydedildi.', false);
          }
        } else {
          setProgressUi(false, false);
          setProgressMessage('Tamamlama kaydedilemedi. Lütfen tekrar deneyin.', true);
        }
      };
    }
  }

  function bindChrome() {
    var homeLink = $('machine-web-lessons-home');
    if (homeLink) {
      homeLink.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.href = HOME_HREF;
      });
    }

    var logoutBtn = $('machine-web-lessons-logout');
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
  }

  async function bootPage(session) {
    var page = getPage();
    if (page === 'hub') {
      await renderHub();
      return;
    }
    if (page === 'units') {
      await renderUnits(session);
      return;
    }
    if (page === 'read') {
      await renderReader(session);
      return;
    }
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

    if (normalizeString(session.programType) !== PROGRAM_TYPE) {
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
    showShell();
    settled = true;
    await bootPage(session);
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
