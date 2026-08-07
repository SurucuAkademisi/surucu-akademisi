/**
 * Read-only Practical Guide repository — Lesson V2 paths, practical categories only.
 */
(function () {
  'use strict';

  var catalog = window.SA_WEB_PRACTICAL_CATALOG;

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

  function isAuthenticated() {
    var auth = getAuth();
    return !!(auth && auth.currentUser && auth.currentUser.uid);
  }

  function isValidCategoryId(categoryId) {
    return !!(catalog && catalog.isPracticalCategoryId && catalog.isPracticalCategoryId(categoryId));
  }

  function lessonCategoryDocRef(categoryId) {
    var db = getDb();
    if (!db) return null;
    return db.collection('content').doc('lesson_categories').collection('items').doc(String(categoryId || '').trim());
  }

  function lessonUnitsRef(categoryId) {
    var catRef = lessonCategoryDocRef(categoryId);
    if (!catRef) return null;
    return catRef.collection('units');
  }

  function lessonBlocksRef(categoryId, unitId) {
    var unitsRef = lessonUnitsRef(categoryId);
    if (!unitsRef) return null;
    return unitsRef.doc(String(unitId || '').trim()).collection('blocks');
  }

  function sortByOrder(items) {
    var list = Array.isArray(items) ? items.slice() : [];
    list.sort(function (a, b) {
      var ao = Number(a.order != null ? a.order : a.sortOrder != null ? a.sortOrder : a.sequence != null ? a.sequence : 0);
      var bo = Number(b.order != null ? b.order : b.sortOrder != null ? b.sortOrder : b.sequence != null ? b.sequence : 0);
      if (ao !== bo) return ao - bo;
      return String(a.title || '').localeCompare(String(b.title || ''), 'tr');
    });
    return list;
  }

  function mapCategoryDoc(doc, fallback) {
    var d = doc.data() || {};
    var fb = fallback || {};
    return {
      id: doc.id,
      title: (d.title || fb.title || doc.id).toString().trim(),
      description: (fb.description || '').toString().trim(),
      order: d.order != null ? Number(d.order) : fb.order != null ? Number(fb.order) : 999,
      status: (d.status || '').toString().trim().toLowerCase() || 'draft',
      accent: fb.accent || 'orange'
    };
  }

  function mapUnitDoc(doc) {
    var d = doc.data() || {};
    var orderVal =
      d.order != null ? d.order : d.sortOrder != null ? d.sortOrder : d.sequence != null ? d.sequence : 999;
    return {
      id: doc.id,
      title: (d.title || '').toString().trim() || doc.id,
      order: Number(orderVal),
      sortOrder: d.sortOrder != null ? Number(d.sortOrder) : null,
      sequence: d.sequence != null ? Number(d.sequence) : null,
      status: (d.status || '').toString().trim().toLowerCase() || 'draft',
      youtubeUrl: (d.youtubeUrl || '').toString().trim(),
      groupId: (d.groupId || '').toString().trim(),
      groupTitle: (d.groupTitle || '').toString().trim()
    };
  }

  function isBlockVisible(d) {
    if (!d || typeof d !== 'object') return false;
    if (d.isPublished === false) return false;
    var status = String(d.status || '').trim().toLowerCase();
    if (status === 'draft' || status === 'inactive' || status === 'archived') return false;
    return true;
  }

  function mapBlockDoc(doc) {
    var d = doc.data() || {};
    if (!isBlockVisible(d)) return null;
    var orderVal =
      d.order != null ? d.order : d.sortOrder != null ? d.sortOrder : d.sequence != null ? d.sequence : 999;
    return {
      id: doc.id,
      type: d.type === 'image' ? 'image' : 'text',
      order: Number(orderVal),
      title: (d.title || '').toString().trim(),
      text: (d.text || '').toString(),
      textPreset: (d.textPreset || 'normal').toString().trim().toLowerCase(),
      textSegments: Array.isArray(d.textSegments) ? d.textSegments : [],
      textFormatVersion: d.textFormatVersion === 1 ? 1 : 0,
      imageUrl: (d.imageUrl || '').toString().trim(),
      caption: (d.caption || '').toString().trim()
    };
  }

  function filterVisibleBlocks(blocks) {
    return (blocks || []).filter(function (b) {
      return !!b;
    });
  }

  function extractUnitPreviewFromBlocks(blocks) {
    var list = sortByOrder(blocks || []);
    var strictImg = '';
    var fallImg = '';
    var strictTxt = '';
    var fallTxt = '';
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var imgUrl = String(b.imageUrl || '').trim();
      var txt = String(b.text || '').trim();
      if (b.type === 'image' && imgUrl) {
        if (b.id === 'image_block' && !strictImg) strictImg = imgUrl;
        if (!fallImg) fallImg = imgUrl;
      }
      if (b.type === 'text' && txt) {
        if (b.id === 'short_text' && !strictTxt) strictTxt = txt;
        if (!fallTxt) fallTxt = txt;
      }
      if (b.type === 'text' && imgUrl && !fallImg) fallImg = imgUrl;
    }
    return {
      previewImageUrl: strictImg || fallImg || '',
      previewText: strictTxt || fallTxt || ''
    };
  }

  async function fetchBlocksForUnit(categoryId, unitId) {
    var ref = lessonBlocksRef(categoryId, unitId);
    if (!ref) return [];
    var blockSnap = await ref.get();
    return filterVisibleBlocks(
      sortByOrder(
        blockSnap.docs
          .map(mapBlockDoc)
          .filter(function (b) {
            return !!b;
          })
      )
    );
  }

  async function enrichUnitsWithPreviews(categoryId, units) {
    var cid = String(categoryId || '').trim();
    var list = Array.isArray(units) ? units.slice() : [];
    if (!list.length || !isValidCategoryId(cid)) return list;

    var tasks = list.map(function (unit) {
      var uid = String(unit && unit.id || '').trim();
      if (!uid) {
        unit.previewImageUrl = '';
        unit.previewText = '';
        return Promise.resolve(unit);
      }
      return fetchBlocksForUnit(cid, uid)
        .then(function (blocks) {
          var preview = extractUnitPreviewFromBlocks(blocks);
          unit.previewImageUrl = preview.previewImageUrl;
          unit.previewText = preview.previewText;
          return unit;
        })
        .catch(function (e) {
          console.warn('[SA_WEB_PRACTICAL_REPO] enrich preview failed', uid, e);
          unit.previewImageUrl = '';
          unit.previewText = '';
          return unit;
        });
    });

    await Promise.all(tasks);
    return list;
  }

  async function getCategories() {
    if (!catalog || !catalog.categories) {
      return { ok: false, authenticated: isAuthenticated(), categories: [], error: 'Katalog yüklenemedi.' };
    }
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, categories: catalog.categories.slice(), error: null };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, authenticated: true, categories: [], error: 'Veritabanı hazır değil.' };
    }

    try {
      var rows = [];
      for (var i = 0; i < catalog.categories.length; i++) {
        var fb = catalog.categories[i];
        var snap = await lessonCategoryDocRef(fb.id).get();
        if (snap.exists) {
          var row = mapCategoryDoc(snap, fb);
          if (row.status === 'active') {
            rows.push(row);
          }
        } else {
          rows.push({
            id: fb.id,
            title: fb.title,
            description: fb.description,
            order: fb.order,
            status: 'active',
            accent: fb.accent
          });
        }
      }
      rows = sortByOrder(rows);
      return { ok: true, authenticated: true, categories: rows, error: null };
    } catch (e) {
      console.warn('[SA_WEB_PRACTICAL_REPO] getCategories failed', e);
      return {
        ok: false,
        authenticated: true,
        categories: catalog.categories.slice(),
        error: (e && e.message) ? String(e.message) : 'Kategoriler yüklenemedi.'
      };
    }
  }

  async function getUnits(categoryId) {
    var cid = String(categoryId || '').trim();
    if (!isValidCategoryId(cid)) {
      return { ok: false, authenticated: isAuthenticated(), units: [], error: 'Geçersiz kategori.' };
    }
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, units: [], error: null };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, authenticated: true, units: [], error: 'Veritabanı hazır değil.' };
    }

    try {
      var snap = await lessonUnitsRef(cid).where('status', '==', 'active').get();
      var units = sortByOrder(snap.docs.map(mapUnitDoc));
      return { ok: true, authenticated: true, units: units, error: null };
    } catch (e) {
      console.warn('[SA_WEB_PRACTICAL_REPO] getUnits failed', e);
      return {
        ok: false,
        authenticated: true,
        units: [],
        error: (e && e.message) ? String(e.message) : 'Üniteler yüklenemedi.'
      };
    }
  }

  async function getUnit(categoryId, unitId) {
    var cid = String(categoryId || '').trim();
    var uid = String(unitId || '').trim();
    if (!isValidCategoryId(cid)) {
      return { ok: false, authenticated: isAuthenticated(), unit: null, error: 'Geçersiz kategori.' };
    }
    if (!uid) {
      return { ok: false, authenticated: isAuthenticated(), unit: null, error: 'Geçersiz ünite.' };
    }
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, unit: null, error: null };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, authenticated: true, unit: null, error: 'Veritabanı hazır değil.' };
    }

    try {
      var unitSnap = await lessonUnitsRef(cid).doc(uid).get();
      if (!unitSnap.exists) {
        return { ok: false, authenticated: true, unit: null, error: 'Ünite bulunamadı.' };
      }
      var unit = mapUnitDoc(unitSnap);
      if (unit.status !== 'active') {
        return { ok: false, authenticated: true, unit: null, error: 'Bu ünite yayında değil.' };
      }
      return { ok: true, authenticated: true, unit: unit, error: null };
    } catch (e) {
      console.warn('[SA_WEB_PRACTICAL_REPO] getUnit failed', e);
      return {
        ok: false,
        authenticated: true,
        unit: null,
        error: (e && e.message) ? String(e.message) : 'Ünite yüklenemedi.'
      };
    }
  }

  async function getBlocks(categoryId, unitId) {
    var cid = String(categoryId || '').trim();
    var uid = String(unitId || '').trim();
    if (!isValidCategoryId(cid)) {
      return { ok: false, authenticated: isAuthenticated(), blocks: [], error: 'Geçersiz kategori.' };
    }
    if (!uid) {
      return { ok: false, authenticated: isAuthenticated(), blocks: [], error: 'Geçersiz ünite.' };
    }
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, blocks: [], error: null };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, authenticated: true, blocks: [], error: 'Veritabanı hazır değil.' };
    }

    try {
      var blocks = await fetchBlocksForUnit(cid, uid);
      return { ok: true, authenticated: true, blocks: blocks, error: null };
    } catch (e) {
      console.warn('[SA_WEB_PRACTICAL_REPO] getBlocks failed', e);
      return {
        ok: false,
        authenticated: true,
        blocks: [],
        error: (e && e.message) ? String(e.message) : 'İçerik yüklenemedi.'
      };
    }
  }

  window.SA_WEB_PRACTICAL_REPO = {
    getDb: getDb,
    getAuth: getAuth,
    isAuthenticated: isAuthenticated,
    isValidCategoryId: isValidCategoryId,
    getCategories: getCategories,
    getUnits: getUnits,
    getUnit: getUnit,
    getBlocks: getBlocks,
    sortByOrder: sortByOrder,
    extractUnitPreviewFromBlocks: extractUnitPreviewFromBlocks,
    enrichUnitsWithPreviews: enrichUnitsWithPreviews
  };
})();
