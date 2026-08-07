/**
 * Read-only Teacher Video Lessons repository.
 */
(function () {
  'use strict';

  var CATEGORIES = [
    {
      id: 'trafik_ve_cevre_bilgisi',
      title: 'Trafik ve Çevre Bilgisi',
      description: 'Trafik kuralları, levhalar ve çevre bilgisi konularını video derslerle pekiştirin.',
      order: 1,
      accent: 'cyan'
    },
    {
      id: 'ilk_yardim',
      title: 'İlk Yardım Bilgisi',
      description: 'İlk yardım ve acil müdahale konularını öğretmen anlatımıyla izleyin.',
      order: 2,
      accent: 'rose'
    },
    {
      id: 'motor_ve_arac_teknigi',
      title: 'Motor ve Araç Tekniği',
      description: 'Motor, araç tekniği ve bakım konularını video derslerle tamamlayın.',
      order: 3,
      accent: 'green'
    },
    {
      id: 'trafik_adabi',
      title: 'Trafik Adabı',
      description: 'Trafik adabı ve sürücü davranışlarına dair öğretmen videoları.',
      order: 4,
      accent: 'indigo'
    },
    {
      id: 'is_makineleri',
      title: 'İş Makineleri',
      description: 'İş makineleri ile ilgili ehliyet video dersleri.',
      order: 5,
      accent: 'gold'
    }
  ];

  var categoryById = {};
  CATEGORIES.forEach(function (c) {
    categoryById[c.id] = c;
  });

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
    return !!categoryById[String(categoryId || '').trim()];
  }

  function teacherVideoRootRef() {
    var db = getDb();
    if (!db) return null;
    return db.collection('content').doc('teacher_video_lessons');
  }

  function teacherVideoVideosRef(categoryId) {
    var root = teacherVideoRootRef();
    if (!root) return null;
    return root.collection('categories').doc(String(categoryId || '').trim()).collection('videos');
  }

  function teacherVideoAccessRef() {
    var root = teacherVideoRootRef();
    if (!root) return null;
    return root.collection('settings').doc('access');
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
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
  }

  /**
   * @param {*} value
   * @returns {number|null}
   */
  function videoLessonsExpiryToMillis(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        var parts = trimmed.slice(0, 10).split('-');
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10) - 1;
        var d = parseInt(parts[2], 10);
        if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
        return new Date(y, m, d, 23, 59, 59, 999).getTime();
      }
      var parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) {
      var dateMs = value.getTime();
      return Number.isFinite(dateMs) ? dateMs : null;
    }
    if (typeof value.toDate === 'function') {
      try {
        var asDate = value.toDate();
        if (asDate instanceof Date) {
          var toDateMs = asDate.getTime();
          return Number.isFinite(toDateMs) ? toDateMs : null;
        }
      } catch (_) {}
    }
    return timestampToMillis(value);
  }

  /**
   * @param {Object|null|undefined} entitlement
   * @returns {boolean}
   */
  function hasWebTeacherVideoPremiumAccess(entitlement) {
    if (!entitlement || typeof entitlement !== 'object') return false;
    if (entitlement.videoLessonsPremium !== true) return false;
    var expiresRaw = entitlement.videoLessonsExpiresAt;
    if (expiresRaw == null || expiresRaw === '') return true;
    var untilMs = videoLessonsExpiryToMillis(expiresRaw);
    if (untilMs == null) return false;
    return untilMs >= Date.now();
  }

  /**
   * @param {string} [uid]
   * @returns {Promise<{ ok: boolean, entitlement: Object|null, error: string|null }>}
   */
  async function loadWebTeacherVideoUserEntitlement(uid) {
    if (!isAuthenticated()) {
      return { ok: true, entitlement: null, error: null };
    }
    var auth = getAuth();
    var resolvedUid = String(
      uid || (auth && auth.currentUser && auth.currentUser.uid ? auth.currentUser.uid : '')
    ).trim();
    if (!resolvedUid) {
      return { ok: true, entitlement: null, error: null };
    }
    var db = getDb();
    if (!db) {
      console.warn('[WebTeacherVideo] loadWebTeacherVideoUserEntitlement: db not ready');
      return { ok: false, entitlement: null, error: 'Veritabanı hazır değil.' };
    }
    try {
      var snap = await db.collection('userEntitlements').doc(resolvedUid).get();
      var entitlement = snap.exists ? (snap.data() || {}) : null;
      return { ok: true, entitlement: entitlement, error: null };
    } catch (e) {
      console.warn('[WebTeacherVideo] loadWebTeacherVideoUserEntitlement failed', e);
      return {
        ok: false,
        entitlement: null,
        error: (e && e.message) ? String(e.message) : 'Entitlement yüklenemedi.'
      };
    }
  }

  function parseYoutubeId(urlOrId) {
    var raw = String(urlOrId || '').trim();
    if (!raw) return '';
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
    var m = raw.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return m && m[1] ? String(m[1]) : '';
  }

  function buildThumbnailUrl(videoId) {
    var id = String(videoId || '').trim();
    if (!id) return '';
    return 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg';
  }

  function isVideoPublished(data) {
    var d = data || {};
    if (d.isPublished === true) return true;
    var status = String(d.status || '').trim().toLowerCase();
    return status === 'published' || status === 'active';
  }

  function sortVideos(items) {
    var list = Array.isArray(items) ? items.slice() : [];
    list.sort(function (a, b) {
      var al = Number(a.lessonNo != null ? a.lessonNo : a.order != null ? a.order : 0);
      var bl = Number(b.lessonNo != null ? b.lessonNo : b.order != null ? b.order : 0);
      if (al !== bl) return al - bl;
      var ao = Number(a.order != null ? a.order : a.sortOrder != null ? a.sortOrder : 0);
      var bo = Number(b.order != null ? b.order : b.sortOrder != null ? b.sortOrder : 0);
      if (ao !== bo) return ao - bo;
      return String(a.title || '').localeCompare(String(b.title || ''), 'tr');
    });
    return list;
  }

  var VIDEO_LINK_ERROR = 'YouTube bağlantısı okunamadı';

  function mapVideoDoc(doc, categoryId) {
    var d = doc.data() || {};
    if (!isVideoPublished(d)) return null;
    var youtubeUrl = String(d.youtubeUrl || '').trim();
    var storedId = String(d.youtubeVideoId || '').trim();
    var youtubeVideoId = storedId || parseYoutubeId(youtubeUrl);
    var hasPlayableVideo = !!youtubeVideoId;
    var lessonNo = Number(
      d.lessonNo != null ? d.lessonNo : d.order != null ? d.order : d.sortOrder != null ? d.sortOrder : 0
    );
    var order = Number(d.order != null ? d.order : d.sortOrder != null ? d.sortOrder : lessonNo);
    var thumb = String(d.youtubeThumbnailUrl || d.thumbnailUrl || '').trim();
    if (!thumb && youtubeVideoId) thumb = buildThumbnailUrl(youtubeVideoId);
    return {
      id: doc.id,
      categoryId: String(d.categoryId || categoryId || '').trim(),
      title: String(d.title || '').trim() || doc.id,
      description: String(d.description || '').trim(),
      lessonNo: lessonNo,
      order: order,
      youtubeUrl: youtubeUrl,
      youtubeVideoId: youtubeVideoId,
      thumbnailUrl: thumb,
      hasPlayableVideo: hasPlayableVideo,
      videoError: hasPlayableVideo ? null : VIDEO_LINK_ERROR
    };
  }

  function getDefaultAccessSettings() {
    return {
      accessMode: 'open_with_rewarded',
      requireRewardedAd: true,
      launchOpenUntil: null
    };
  }

  function normalizeAccessSettings(data) {
    var d = data || {};
    var mode = String(d.accessMode || '').trim();
    if (mode !== 'open_with_rewarded' && mode !== 'premium_locked') {
      mode = 'open_with_rewarded';
    }
    return {
      accessMode: mode,
      requireRewardedAd: d.requireRewardedAd !== false,
      launchOpenUntil: d.launchOpenUntil || null
    };
  }

  function isLaunchOpen(settings) {
    var launchMs = timestampToMillis(settings && settings.launchOpenUntil);
    return launchMs != null && Date.now() < launchMs;
  }

  function getEffectiveAccessMode(settings) {
    var s = settings || getDefaultAccessSettings();
    if (isLaunchOpen(s)) return 'open_with_rewarded';
    return s.accessMode === 'premium_locked' ? 'premium_locked' : 'open_with_rewarded';
  }

  /**
   * Resolve active institution tenantId from hosting-web session/viewer context.
   * Does not invent brand defaults or guess tenant IDs.
   * @returns {string}
   */
  function resolveWebTeacherVideoTenantId() {
    var auth = getAuth();
    var authUid = auth && auth.currentUser && auth.currentUser.uid
      ? String(auth.currentUser.uid).trim()
      : '';
    if (!authUid) return '';

    var viewer = window.SA_VIEWER_CONTEXT;
    if (viewer && typeof viewer.getSnapshot === 'function') {
      try {
        var snap = viewer.getSnapshot();
        if (
          snap
          && snap.kind === 'institution'
          && snap.institutionSession
          && typeof snap.institutionSession === 'object'
        ) {
          var sessionUid = String(snap.uid || snap.institutionSession.uid || '').trim();
          var sessionTenantId = String(snap.institutionSession.tenantId || '').trim();
          if (sessionUid && sessionUid === authUid && sessionTenantId) {
            return sessionTenantId;
          }
        }
      } catch (_) {}
    }

    var sessionApi = window.SA_WEB_SESSION;
    if (sessionApi && typeof sessionApi.requireWebStudentSession === 'function') {
      try {
        var webSession = sessionApi.requireWebStudentSession();
        if (webSession && typeof webSession === 'object') {
          var webUid = String(webSession.uid || '').trim();
          var webTenantId = String(webSession.tenantId || '').trim();
          if (webUid && webUid === authUid && webTenantId) {
            return webTenantId;
          }
        }
      } catch (_) {}
    }

    return '';
  }

  /**
   * Read tenantSettings/{tenantId} for Video Teacher premium only.
   * Does not read tenantBilling or trial fields.
   * @param {string} tenantId
   * @returns {Promise<{ ok: boolean, tenantId: string, premiumVideoLessonsActive: boolean, error: string|null }>}
   */
  async function loadWebTeacherVideoTenantSettings(tenantId) {
    var tid = String(tenantId || '').trim();
    if (!tid) {
      return {
        ok: false,
        tenantId: '',
        premiumVideoLessonsActive: false,
        error: 'Kurum kimliği bulunamadı.'
      };
    }
    var db = getDb();
    if (!db) {
      console.warn('[WebTeacherVideo] loadWebTeacherVideoTenantSettings: db not ready');
      return {
        ok: false,
        tenantId: tid,
        premiumVideoLessonsActive: false,
        error: 'Veritabanı hazır değil.'
      };
    }
    try {
      var snap = await db.collection('tenantSettings').doc(tid).get();
      var data = snap.exists ? (snap.data() || {}) : {};
      return {
        ok: true,
        tenantId: tid,
        premiumVideoLessonsActive: data.premiumVideoLessonsActive === true,
        error: null
      };
    } catch (e) {
      console.warn('[WebTeacherVideo] loadWebTeacherVideoTenantSettings failed', e);
      return {
        ok: false,
        tenantId: tid,
        premiumVideoLessonsActive: false,
        error: (e && e.message) ? String(e.message) : 'Kurum video ayarları yüklenemedi.'
      };
    }
  }

  /**
   * Access decision:
   * A) userEntitlements premium → play
   * B) institution student → tenantSettings.premiumVideoLessonsActive only
   * C) institutionless public → global content/.../settings/access
   *
   * @param {Object|null|undefined} settings
   * @param {Object|null|undefined} userEntitlement
   * @param {Object|null|undefined} tenantAccess
   * @returns {{ effectiveMode: string, canPlayAll: boolean, isPremiumLocked: boolean, hasUserVideoPremium: boolean, hasTenantVideoPremium: boolean, accessBranch: string, tenantId: string|null }}
   */
  function buildWebTeacherVideoAccessContext(settings, userEntitlement, tenantAccess) {
    var hasUserPremium = hasWebTeacherVideoPremiumAccess(userEntitlement);
    if (hasUserPremium) {
      return {
        effectiveMode: 'user_premium',
        canPlayAll: true,
        isPremiumLocked: false,
        hasUserVideoPremium: true,
        hasTenantVideoPremium: false,
        accessBranch: 'USER_ENTITLEMENT',
        tenantId: tenantAccess && tenantAccess.tenantId ? String(tenantAccess.tenantId) : null
      };
    }

    var isInstitution = !!(tenantAccess && tenantAccess.isInstitutionStudent === true);
    if (isInstitution) {
      var tenantPremium = tenantAccess.premiumVideoLessonsActive === true;
      return {
        effectiveMode: tenantPremium ? 'tenant_premium' : 'premium_locked',
        canPlayAll: tenantPremium,
        isPremiumLocked: !tenantPremium,
        hasUserVideoPremium: false,
        hasTenantVideoPremium: tenantPremium,
        accessBranch: 'TENANT',
        tenantId: tenantAccess.tenantId ? String(tenantAccess.tenantId) : null
      };
    }

    var effectiveMode = getEffectiveAccessMode(settings);
    var isPremiumLocked = effectiveMode === 'premium_locked';
    var canPlayAll = !isPremiumLocked;
    return {
      effectiveMode: effectiveMode,
      canPlayAll: canPlayAll,
      isPremiumLocked: isPremiumLocked,
      hasUserVideoPremium: false,
      hasTenantVideoPremium: false,
      accessBranch: 'PUBLIC',
      tenantId: null
    };
  }

  function getCategories() {
    return {
      ok: true,
      authenticated: isAuthenticated(),
      categories: CATEGORIES.slice().sort(function (a, b) {
        return Number(a.order || 0) - Number(b.order || 0);
      }),
      error: null
    };
  }

  function getCategoryById(categoryId) {
    return categoryById[String(categoryId || '').trim()] || null;
  }

  async function getVideos(categoryId) {
    var cid = String(categoryId || '').trim();
    if (!isValidCategoryId(cid)) {
      return { ok: false, authenticated: isAuthenticated(), videos: [], error: 'Geçersiz kategori.' };
    }
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, videos: [], error: null };
    }
    var ref = teacherVideoVideosRef(cid);
    if (!ref) {
      return { ok: false, authenticated: true, videos: [], error: 'Veritabanı hazır değil.' };
    }

    try {
      var snap = await ref.get();
      var total = snap.docs.length;
      var published = snap.docs
        .map(function (doc) {
          return mapVideoDoc(doc, cid);
        })
        .filter(function (v) {
          return !!v;
        });
      var playable = published.filter(function (v) {
        return v.hasPlayableVideo;
      }).length;
      published.forEach(function (v) {
        if (!v.hasPlayableVideo) {
          console.warn('[WebTeacherVideo] video without playable YouTube id', {
            id: v.id,
            title: v.title
          });
        }
      });
      console.log('[WebTeacherVideo] videos fetched', {
        categoryId: cid,
        total: total,
        published: published.length,
        playable: playable
      });
      var videos = sortVideos(published);
      return { ok: true, authenticated: true, videos: videos, error: null };
    } catch (e) {
      console.warn('[WebTeacherVideo] getVideos failed', e);
      return {
        ok: false,
        authenticated: true,
        videos: [],
        error: (e && e.message) ? String(e.message) : 'Videolar yüklenemedi.'
      };
    }
  }

  async function getAccessSettings() {
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, settings: getDefaultAccessSettings(), error: null };
    }
    var ref = teacherVideoAccessRef();
    if (!ref) {
      return { ok: false, authenticated: true, settings: getDefaultAccessSettings(), error: 'Veritabanı hazır değil.' };
    }

    try {
      var snap = await ref.get();
      var settings = snap.exists
        ? normalizeAccessSettings(snap.data() || {})
        : getDefaultAccessSettings();
      return { ok: true, authenticated: true, settings: settings, error: null };
    } catch (e) {
      console.warn('[SA_WEB_TEACHER_VIDEO] getAccessSettings failed', e);
      return {
        ok: false,
        authenticated: true,
        settings: getDefaultAccessSettings(),
        error: (e && e.message) ? String(e.message) : 'Erişim ayarları yüklenemedi.'
      };
    }
  }

  window.SA_WEB_TEACHER_VIDEO = {
    VIDEO_LINK_ERROR: VIDEO_LINK_ERROR,
    getDb: getDb,
    getAuth: getAuth,
    isAuthenticated: isAuthenticated,
    isValidCategoryId: isValidCategoryId,
    getCategoryById: getCategoryById,
    getCategories: getCategories,
    getVideos: getVideos,
    getAccessSettings: getAccessSettings,
    getEffectiveAccessMode: getEffectiveAccessMode,
    resolveWebTeacherVideoTenantId: resolveWebTeacherVideoTenantId,
    loadWebTeacherVideoTenantSettings: loadWebTeacherVideoTenantSettings,
    buildWebTeacherVideoAccessContext: buildWebTeacherVideoAccessContext,
    videoLessonsExpiryToMillis: videoLessonsExpiryToMillis,
    hasWebTeacherVideoPremiumAccess: hasWebTeacherVideoPremiumAccess,
    loadWebTeacherVideoUserEntitlement: loadWebTeacherVideoUserEntitlement,
    parseYoutubeId: parseYoutubeId,
    buildEmbedUrl: function (videoId) {
      var id = parseYoutubeId(videoId);
      if (!id) return '';
      return 'https://www.youtube.com/embed/' + encodeURIComponent(id) + '?playsinline=1&rel=0';
    }
  };
})();
