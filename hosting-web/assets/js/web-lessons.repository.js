/**
 * Read-only web lessons repository — global Lesson V2 content.
 */
(function () {
  'use strict';

  var catalog = window.SA_WEB_LESSONS_CATALOG;

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

  function lessonCategoriesRef() {
    var db = getDb();
    if (!db) return null;
    return db.collection('content').doc('lesson_categories').collection('items');
  }

  function lessonCategoryDocRef(categoryId) {
    var ref = lessonCategoriesRef();
    if (!ref) return null;
    return ref.doc(String(categoryId || '').trim());
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
      return Number(a.order || 0) - Number(b.order || 0);
    });
    return list;
  }

  function mapCategoryDoc(doc, fallback) {
    var d = doc.data() || {};
    var fb = fallback || {};
    return {
      id: doc.id,
      title: (d.title || fb.title || doc.id).toString().trim(),
      order: d.order != null ? Number(d.order) : (fb.order != null ? Number(fb.order) : 999),
      status: (d.status || '').toString().trim().toLowerCase() || 'draft',
      description: (fb.description || '').toString().trim()
    };
  }

  function mapUnitDoc(doc) {
    var d = doc.data() || {};
    return {
      id: doc.id,
      title: (d.title || '').toString().trim() || doc.id,
      order: d.order != null ? Number(d.order) : 999,
      status: (d.status || '').toString().trim().toLowerCase() || 'draft',
      youtubeUrl: (d.youtubeUrl || '').toString().trim()
    };
  }

  function mapBlockDoc(doc) {
    var d = doc.data() || {};
    return {
      id: doc.id,
      type: d.type === 'image' ? 'image' : 'text',
      order: d.order != null ? Number(d.order) : 999,
      text: (d.text || '').toString(),
      textPreset: (d.textPreset || 'normal').toString().trim().toLowerCase(),
      textSegments: Array.isArray(d.textSegments) ? d.textSegments : [],
      textFormatVersion: d.textFormatVersion === 1 ? 1 : 0,
      imageUrl: (d.imageUrl || '').toString().trim(),
      caption: (d.caption || '').toString().trim()
    };
  }

  async function loadLessonCategories() {
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, categories: [], error: null };
    }
    if (!catalog || !catalog.categories) {
      return { ok: false, authenticated: true, categories: [], error: 'Ders kataloğu yüklenemedi.' };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, authenticated: true, categories: [], error: 'Veritabanı hazır değil.' };
    }

    try {
      var snap = await lessonCategoriesRef().where('status', '==', 'active').get();
      var byId = {};
      snap.docs.forEach(function (doc) {
        if (catalog.isPracticalCategoryId(doc.id)) return;
        if (!catalog.isValidLessonCategoryId(doc.id)) return;
        var fb = catalog.getCategoryById(doc.id);
        byId[doc.id] = mapCategoryDoc(doc, fb);
      });

      var categories = [];
      catalog.categories.forEach(function (fb) {
        var row = byId[fb.id];
        if (row && row.status === 'active') {
          categories.push(row);
        }
      });
      categories = sortByOrder(categories);

      return { ok: true, authenticated: true, categories: categories, error: null };
    } catch (e) {
      console.warn('[SA_WEB_LESSONS_REPO] loadLessonCategories failed', e);
      return {
        ok: false,
        authenticated: true,
        categories: [],
        error: (e && e.message) ? String(e.message) : 'Ders kategorileri yüklenemedi.'
      };
    }
  }

  async function loadUnits(categoryId) {
    var cid = String(categoryId || '').trim();
    if (!catalog || !catalog.isValidLessonCategoryId(cid)) {
      return { ok: false, authenticated: isAuthenticated(), units: [], error: 'Geçersiz ders kategorisi.' };
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
      console.warn('[SA_WEB_LESSONS_REPO] loadUnits failed', e);
      return {
        ok: false,
        authenticated: true,
        units: [],
        error: (e && e.message) ? String(e.message) : 'Üniteler yüklenemedi.'
      };
    }
  }

  async function loadUnitWithBlocks(categoryId, unitId) {
    var cid = String(categoryId || '').trim();
    var uid = String(unitId || '').trim();
    if (!catalog || !catalog.isValidLessonCategoryId(cid)) {
      return { ok: false, authenticated: isAuthenticated(), unit: null, blocks: [], error: 'Geçersiz ders kategorisi.' };
    }
    if (!uid) {
      return { ok: false, authenticated: isAuthenticated(), unit: null, blocks: [], error: 'Geçersiz ünite.' };
    }
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, unit: null, blocks: [], error: null };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, authenticated: true, unit: null, blocks: [], error: 'Veritabanı hazır değil.' };
    }

    try {
      var unitSnap = await lessonUnitsRef(cid).doc(uid).get();
      if (!unitSnap.exists) {
        return { ok: false, authenticated: true, unit: null, blocks: [], error: 'Ünite bulunamadı.' };
      }
      var unit = mapUnitDoc(unitSnap);
      if (unit.status !== 'active') {
        return { ok: false, authenticated: true, unit: null, blocks: [], error: 'Bu ünite yayında değil.' };
      }

      var blockSnap = await lessonBlocksRef(cid, uid).get();
      var blocks = sortByOrder(blockSnap.docs.map(mapBlockDoc));

      return { ok: true, authenticated: true, unit: unit, blocks: blocks, error: null };
    } catch (e) {
      console.warn('[SA_WEB_LESSONS_REPO] loadUnitWithBlocks failed', e);
      return {
        ok: false,
        authenticated: true,
        unit: null,
        blocks: [],
        error: (e && e.message) ? String(e.message) : 'Ders içeriği yüklenemedi.'
      };
    }
  }

  window.SA_WEB_LESSONS_REPO = {
    getDb: getDb,
    getAuth: getAuth,
    isAuthenticated: isAuthenticated,
    loadLessonCategories: loadLessonCategories,
    loadUnits: loadUnits,
    loadUnitWithBlocks: loadUnitWithBlocks,
    sortByOrder: sortByOrder
  };
})();
