/**
 * Machine web Video Dersler — hub / list / player + premium access (read-only).
 * Allowlist: is_makineleri, ilk_yardim. No progress/entitlement writes.
 */
(function () {
  'use strict';

  var PROGRAM_TYPE = 'machine_operator';
  var REGION = 'us-central1';
  var HOME_HREF = '../';
  var LOGIN_HREF = '../giris/';
  var HUB_HREF = './';

  var CATEGORY_ALLOWLIST = ['is_makineleri', 'ilk_yardim'];

  var CATEGORY_META = {
    is_makineleri: {
      id: 'is_makineleri',
      title: 'İş Makineleri',
      description:
        'Öğretmen anlatımlı video dersler, önemli konu vurguları ve sınavda işine yarayacak özel tüyolarla İş Makineleri sınavına daha güçlü hazırlan.',
      accent: 'gold',
      order: 1
    },
    ilk_yardim: {
      id: 'ilk_yardim',
      title: 'İlk Yardım',
      description:
        'İlk yardım ve acil müdahale konularını öğretmen anlatımıyla izleyin.',
      accent: 'green',
      order: 2
    }
  };

  var CARD_VIDEO_LINK_MESSAGE =
    'Bu videonun YouTube bağlantısı okunamadı. Admin panelden video linkini kontrol edin.';

  var UPSELL_PLACEHOLDER_MSG =
    'Satın alma talebi özelliği yakında aktif olacak. Şimdilik premium erişim için yöneticiyle iletişime geçebilirsiniz.';

  var INSTITUTION_LOCK_MSG =
    'Bu video dersler premium erişime kapalıdır. Premium erişim için kurumunuz veya Sürücü Akademisi yönetimiyle iletişime geçebilirsiniz.';

  var settled = false;
  var currentSession = null;
  var currentAccess = null;
  var escapeBound = false;

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
    return normalizeString(document.body && document.body.getAttribute('data-mv-page'));
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

  function isPublicSession(session) {
    return !!(
      session &&
      (normalizeString(session.mode) === 'public' ||
        normalizeString(session.enrollmentSource) === 'public')
    );
  }

  function isInstitutionSession(session) {
    if (!session || isPublicSession(session)) return false;
    return (
      normalizeString(session.mode) === 'institution' ||
      normalizeString(session.enrollmentSource) === 'institution'
    );
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
    var shell = $('machine-web-videos');
    var gate = $('machine-web-videos-gate');
    if (shell) shell.hidden = false;
    if (gate) gate.hidden = true;
  }

  function readQueryParam(name) {
    try {
      return normalizeString(new URLSearchParams(window.location.search).get(name));
    } catch (_) {
      return '';
    }
  }

  function listHref(categoryId) {
    return 'liste.html?categoryId=' + encodeURIComponent(normalizeString(categoryId));
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
      console.warn('[machine-web-videos] revalidate failed', e);
      redirectLogin();
      return null;
    }
  }

  async function paintBranding(session) {
    var api = window.SA_MACHINE_WEB_SESSION;
    if (!api || !session) return;

    var heroEl = document.querySelector('.machine-web-videos-hero');
    var instNameEl = $('machine-web-videos-institution-name');
    var brandEl = $('machine-web-videos-brand-name');
    var programEl = $('machine-web-videos-program-title');
    var logoEl = $('machine-web-videos-logo');
    var monoEl = $('machine-web-videos-monogram');

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

  /* —— Entitlement (read-only) —— */

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
    if (typeof value.toMillis === 'function') {
      try {
        return value.toMillis();
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function hasUserVideoPremium(entitlement) {
    if (!entitlement || typeof entitlement !== 'object') return false;
    if (entitlement.videoLessonsPremium !== true) return false;
    var expiresRaw = entitlement.videoLessonsExpiresAt;
    if (expiresRaw == null || expiresRaw === '') return true;
    var untilMs = videoLessonsExpiryToMillis(expiresRaw);
    if (untilMs == null) return false;
    return untilMs >= Date.now();
  }

  async function loadUserEntitlement(uid) {
    var db = getDb();
    if (!db || !uid) {
      return { ok: false, entitlement: null, error: 'entitlement_unavailable' };
    }
    try {
      var snap = await db.collection('userEntitlements').doc(uid).get();
      return { ok: true, entitlement: snap.exists ? snap.data() || {} : null, error: null };
    } catch (e) {
      console.warn('[machine-web-videos] userEntitlements read failed', e);
      return { ok: false, entitlement: null, error: 'entitlement_read_failed' };
    }
  }

  async function loadTenantVideoPremium(tenantId) {
    var tid = normalizeString(tenantId);
    if (!tid) {
      return { ok: false, premiumVideoLessonsActive: false, error: 'missing_tenant' };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, premiumVideoLessonsActive: false, error: 'db_unavailable' };
    }
    try {
      var snap = await db.collection('tenantSettings').doc(tid).get();
      var data = snap.exists ? snap.data() || {} : {};
      return {
        ok: true,
        premiumVideoLessonsActive: data.premiumVideoLessonsActive === true,
        error: null
      };
    } catch (e) {
      console.warn('[machine-web-videos] tenantSettings read failed', e);
      return { ok: false, premiumVideoLessonsActive: false, error: 'tenant_settings_failed' };
    }
  }

  /**
   * Priority: 1) global user premium 2) institution tenant premium 3) lock.
   * Public Machine never inherits platform-tenant premium.
   * Fail closed if entitlement/tenant reads fail when needed for unlock.
   */
  async function resolveAccess(session) {
    var locked = {
      canPlay: false,
      isLocked: true,
      branch: 'LOCKED',
      hasUserPremium: false,
      hasTenantPremium: false,
      isPublic: isPublicSession(session),
      isInstitution: isInstitutionSession(session),
      error: null
    };

    if (!session) return locked;

    var entResult = await loadUserEntitlement(session.uid);
    if (!entResult.ok) {
      locked.error = 'premium_check_failed';
      locked.branch = 'FAIL_CLOSED';
      return locked;
    }
    if (hasUserVideoPremium(entResult.entitlement)) {
      return {
        canPlay: true,
        isLocked: false,
        branch: 'USER_ENTITLEMENT',
        hasUserPremium: true,
        hasTenantPremium: false,
        isPublic: locked.isPublic,
        isInstitution: locked.isInstitution,
        error: null
      };
    }

    if (locked.isInstitution) {
      var tid = normalizeString(session.tenantId);
      if (!tid) {
        locked.error = 'missing_tenant';
        locked.branch = 'FAIL_CLOSED';
        return locked;
      }
      var tenantResult = await loadTenantVideoPremium(tid);
      if (!tenantResult.ok) {
        locked.error = 'premium_check_failed';
        locked.branch = 'FAIL_CLOSED';
        return locked;
      }
      if (tenantResult.premiumVideoLessonsActive === true) {
        return {
          canPlay: true,
          isLocked: false,
          branch: 'TENANT',
          hasUserPremium: false,
          hasTenantPremium: true,
          isPublic: false,
          isInstitution: true,
          error: null
        };
      }
      locked.branch = 'TENANT_LOCKED';
      return locked;
    }

    // Public / Bireysel Machine: no rewarded-ad open path in C3.
    locked.branch = 'PUBLIC_LOCKED';
    return locked;
  }

  /* —— Content —— */

  function teacherVideosRef(categoryId) {
    var db = getDb();
    if (!db) return null;
    return db
      .collection('content')
      .doc('teacher_video_lessons')
      .collection('categories')
      .doc(normalizeString(categoryId))
      .collection('videos');
  }

  function isVideoPublished(data) {
    var d = data || {};
    if (d.isPublished === true) return true;
    var status = normalizeString(d.status).toLowerCase();
    return status === 'published' || status === 'active';
  }

  function parseYoutubeId(urlOrId) {
    var raw = normalizeString(urlOrId);
    if (!raw) return '';
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
    var m = raw.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return m && m[1] ? String(m[1]) : '';
  }

  function buildThumbnailUrl(videoId) {
    var id = normalizeString(videoId);
    if (!id) return '';
    return 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg';
  }

  function buildEmbedUrl(videoId) {
    var id = parseYoutubeId(videoId);
    if (!id) return '';
    return 'https://www.youtube.com/embed/' + encodeURIComponent(id) + '?playsinline=1&rel=0';
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

  function mapVideoDoc(doc, categoryId) {
    var d = doc.data() || {};
    if (!isVideoPublished(d)) return null;
    var youtubeUrl = normalizeString(d.youtubeUrl);
    var storedId = normalizeString(d.youtubeVideoId);
    var youtubeVideoId = storedId || parseYoutubeId(youtubeUrl);
    var hasPlayableVideo = !!youtubeVideoId;
    var lessonNo = Number(
      d.lessonNo != null ? d.lessonNo : d.order != null ? d.order : d.sortOrder != null ? d.sortOrder : 0
    );
    var order = Number(d.order != null ? d.order : d.sortOrder != null ? d.sortOrder : lessonNo);
    var thumb = normalizeString(d.youtubeThumbnailUrl || d.thumbnailUrl);
    if (!thumb && youtubeVideoId) thumb = buildThumbnailUrl(youtubeVideoId);
    return {
      id: doc.id,
      categoryId: normalizeString(d.categoryId || categoryId),
      title: normalizeString(d.title) || doc.id,
      description: normalizeString(d.description),
      lessonNo: lessonNo,
      order: order,
      sortOrder: d.sortOrder != null ? Number(d.sortOrder) : order,
      youtubeUrl: youtubeUrl,
      youtubeVideoId: youtubeVideoId,
      thumbnailUrl: thumb,
      hasPlayableVideo: hasPlayableVideo
    };
  }

  async function loadVideos(categoryId) {
    var cid = normalizeString(categoryId);
    if (!isCategoryAllowed(cid)) {
      return { ok: false, videos: [], error: 'Bu video kategorisi İş Makineleri programında kullanılamaz.' };
    }
    var ref = teacherVideosRef(cid);
    if (!ref) {
      return { ok: false, videos: [], error: 'Veritabanı hazır değil.' };
    }
    try {
      var snap = await ref.get();
      var videos = sortVideos(
        snap.docs
          .map(function (doc) {
            return mapVideoDoc(doc, cid);
          })
          .filter(function (v) {
            return !!v;
          })
      );
      return { ok: true, videos: videos, error: null };
    } catch (e) {
      console.warn('[machine-web-videos] load videos failed', e);
      return { ok: false, videos: [], error: 'Videolar yüklenemedi. Lütfen tekrar deneyin.' };
    }
  }

  /* —— Modals —— */

  function setPlayerModalError(message) {
    var errEl = $('machine-web-videos-player-error');
    if (!errEl) return;
    if (message) {
      errEl.hidden = false;
      errEl.textContent = message;
    } else {
      errEl.hidden = true;
      errEl.textContent = '';
    }
  }

  function setPlayerModalPlaybackVisible(visible) {
    var wrap = $('machine-web-videos-player-frame-wrap');
    if (wrap) wrap.hidden = !visible;
  }

  function closePlayerModal() {
    var modal = $('machine-web-videos-player-modal');
    var iframe = $('machine-web-videos-player-iframe');
    if (iframe) iframe.src = '';
    var title = $('machine-web-videos-player-title');
    if (title) title.textContent = '';
    setPlayerModalError('');
    setPlayerModalPlaybackVisible(true);
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('machine-web-videos-modal-open');
  }

  function openPlayerModalWithMessage(video, errorMessage) {
    bindPlayerModal();
    closeUpsellModal();
    closeInstitutionLockModal();
    var modal = $('machine-web-videos-player-modal');
    var iframe = $('machine-web-videos-player-iframe');
    var title = $('machine-web-videos-player-title');
    if (!modal) return;
    if (title) title.textContent = (video && video.title) || 'Video ders';
    if (iframe) iframe.src = '';
    setPlayerModalPlaybackVisible(false);
    setPlayerModalError(errorMessage || CARD_VIDEO_LINK_MESSAGE);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('machine-web-videos-modal-open');
  }

  function openPlayerModal(video) {
    bindPlayerModal();
    closeUpsellModal();
    closeInstitutionLockModal();
    var modal = $('machine-web-videos-player-modal');
    var iframe = $('machine-web-videos-player-iframe');
    var title = $('machine-web-videos-player-title');
    if (!modal || !iframe) return;

    var videoId = parseYoutubeId(video.youtubeVideoId || video.youtubeUrl);
    if (!videoId) {
      openPlayerModalWithMessage(video, CARD_VIDEO_LINK_MESSAGE);
      return;
    }
    var embedUrl = buildEmbedUrl(videoId);
    if (!embedUrl) {
      openPlayerModalWithMessage(
        video,
        'Video oynatıcı hazırlanamadı. Lütfen daha sonra tekrar deneyin.'
      );
      return;
    }
    if (title) title.textContent = video.title || 'Video ders';
    setPlayerModalError('');
    setPlayerModalPlaybackVisible(true);
    iframe.src = embedUrl;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('machine-web-videos-modal-open');
  }

  function hideUpsellNotice() {
    var notice = $('machine-web-videos-upsell-notice');
    if (!notice) return;
    notice.hidden = true;
    notice.textContent = '';
  }

  function showUpsellNotice(message) {
    var notice = $('machine-web-videos-upsell-notice');
    if (!notice) return;
    notice.textContent = message || UPSELL_PLACEHOLDER_MSG;
    notice.hidden = false;
  }

  function closeUpsellModal() {
    var modal = $('machine-web-videos-upsell-modal');
    var videoTitle = $('machine-web-videos-upsell-video-title');
    if (videoTitle) {
      videoTitle.hidden = true;
      videoTitle.textContent = '';
    }
    hideUpsellNotice();
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('machine-web-videos-upsell-open');
  }

  function openUpsellModal(video) {
    bindUpsellModal();
    closePlayerModal();
    closeInstitutionLockModal();
    var modal = $('machine-web-videos-upsell-modal');
    if (!modal) return;
    hideUpsellNotice();
    var videoTitle = $('machine-web-videos-upsell-video-title');
    if (videoTitle && video && video.title) {
      videoTitle.hidden = false;
      videoTitle.textContent = video.title;
    } else if (videoTitle) {
      videoTitle.hidden = true;
      videoTitle.textContent = '';
    }
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('machine-web-videos-upsell-open');
  }

  function closeInstitutionLockModal() {
    var modal = $('machine-web-videos-institution-lock-modal');
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('machine-web-videos-institution-lock-open');
  }

  function openInstitutionLockModal() {
    bindInstitutionLockModal();
    closePlayerModal();
    closeUpsellModal();
    var modal = $('machine-web-videos-institution-lock-modal');
    var text = $('machine-web-videos-institution-lock-text');
    if (text) text.textContent = INSTITUTION_LOCK_MSG;
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('machine-web-videos-institution-lock-open');
  }

  function bindPlayerModal() {
    var modal = $('machine-web-videos-player-modal');
    if (!modal || modal.getAttribute('data-bound') === '1') return;
    modal.setAttribute('data-bound', '1');
    var closeBtn = $('machine-web-videos-player-close');
    if (closeBtn) closeBtn.onclick = closePlayerModal;
    var backdrop = modal.querySelector('.machine-web-videos-player-modal__backdrop');
    if (backdrop) backdrop.onclick = closePlayerModal;
  }

  function bindUpsellModal() {
    var modal = $('machine-web-videos-upsell-modal');
    if (!modal || modal.getAttribute('data-bound') === '1') return;
    modal.setAttribute('data-bound', '1');
    var closeBtn = $('machine-web-videos-upsell-close');
    var dismissBtn = $('machine-web-videos-upsell-dismiss');
    var ctaBtn = $('machine-web-videos-upsell-cta');
    if (closeBtn) closeBtn.onclick = closeUpsellModal;
    if (dismissBtn) dismissBtn.onclick = closeUpsellModal;
    if (ctaBtn) {
      ctaBtn.onclick = function () {
        showUpsellNotice(UPSELL_PLACEHOLDER_MSG);
      };
    }
    var backdrop = modal.querySelector('.machine-web-videos-upsell-modal__backdrop');
    if (backdrop) backdrop.onclick = closeUpsellModal;
  }

  function bindInstitutionLockModal() {
    var modal = $('machine-web-videos-institution-lock-modal');
    if (!modal || modal.getAttribute('data-bound') === '1') return;
    modal.setAttribute('data-bound', '1');
    var closeBtn = $('machine-web-videos-institution-lock-close');
    var dismissBtn = $('machine-web-videos-institution-lock-dismiss');
    if (closeBtn) closeBtn.onclick = closeInstitutionLockModal;
    if (dismissBtn) dismissBtn.onclick = closeInstitutionLockModal;
    var backdrop = modal.querySelector('.machine-web-videos-institution-lock-modal__backdrop');
    if (backdrop) backdrop.onclick = closeInstitutionLockModal;
  }

  function bindEscape() {
    if (escapeBound) return;
    escapeBound = true;
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var upsell = $('machine-web-videos-upsell-modal');
      if (upsell && !upsell.hidden) {
        closeUpsellModal();
        return;
      }
      var inst = $('machine-web-videos-institution-lock-modal');
      if (inst && !inst.hidden) {
        closeInstitutionLockModal();
        return;
      }
      var player = $('machine-web-videos-player-modal');
      if (player && !player.hidden) closePlayerModal();
    });
  }

  function handleLockedClick(video, access) {
    if (access && access.isPublic) {
      openUpsellModal(video);
      return;
    }
    openInstitutionLockModal();
  }

  /* —— Pages —— */

  function renderHub() {
    var grid = $('machine-web-videos-category-grid');
    var loading = $('machine-web-videos-hub-loading');
    if (loading) loading.hidden = true;
    if (!grid) return;

    var cats = CATEGORY_ALLOWLIST.map(function (id) {
      return CATEGORY_META[id];
    }).sort(function (a, b) {
      return Number(a.order || 0) - Number(b.order || 0);
    });

    grid.hidden = false;
    grid.innerHTML = cats
      .map(function (cat) {
        var accent = cat.accent === 'green' ? 'green' : 'gold';
        return (
          '<article class="machine-web-videos-book-card machine-web-videos-book-card--'
          + accent
          + ' machine-web-videos-book-card--clickable" data-category-id="'
          + escapeHtml(cat.id)
          + '" role="link" tabindex="0">'
          + '<h2 class="machine-web-videos-book-card__title">'
          + escapeHtml(cat.title)
          + '</h2>'
          + '<p class="machine-web-videos-book-card__desc">'
          + escapeHtml(cat.description)
          + '</p>'
          + '<span class="machine-web-videos-book-card__cta">Videoları Gör</span>'
          + '</article>'
        );
      })
      .join('');

    Array.prototype.slice
      .call(grid.querySelectorAll('.machine-web-videos-book-card[data-category-id]'))
      .forEach(function (card) {
        var categoryId = card.getAttribute('data-category-id');
        function go() {
          if (!isCategoryAllowed(categoryId)) {
            redirectHub();
            return;
          }
          window.location.href = listHref(categoryId);
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

  function renderVideoList(videos, access) {
    var grid = $('machine-web-videos-list');
    var empty = $('machine-web-videos-list-empty');
    var lockPanel = $('machine-web-videos-lock');
    if (!grid) return;

    if (lockPanel) {
      if (access && access.isLocked && access.isInstitution) {
        lockPanel.hidden = false;
      } else {
        lockPanel.hidden = true;
      }
    }

    if (!videos.length) {
      grid.hidden = true;
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    var isLocked = !!(access && access.isLocked);
    var canPlay = !!(access && access.canPlay);

    grid.hidden = false;
    grid.innerHTML = videos
      .map(function (v) {
        var invalid = !v.hasPlayableVideo;
        var locked = isLocked && v.hasPlayableVideo;
        var playable = canPlay && v.hasPlayableVideo;
        var cardClass = 'machine-web-videos-card';
        if (locked) cardClass += ' machine-web-videos-card--locked';

        var thumbInner = v.thumbnailUrl
          ? '<img class="machine-web-videos-thumb__img" src="'
            + escapeHtml(v.thumbnailUrl)
            + '" alt="" loading="lazy" />'
          : '<span class="machine-web-videos-thumb__placeholder" aria-hidden="true">▶</span>';
        var lockOverlay = locked
          ? '<span class="machine-web-videos-thumb__lock-overlay" aria-hidden="true">'
            + '<span class="machine-web-videos-card__badge-premium">Premium</span>'
            + '</span>'
          : '';
        var thumb =
          '<div class="machine-web-videos-thumb">' + thumbInner + lockOverlay + '</div>';

        var lessonNoLabel = v.lessonNo > 0 ? String(v.lessonNo) : '';
        var lessonDesktop = lessonNoLabel ? 'Ders ' + lessonNoLabel : 'Video';
        var lessonMobile = lessonNoLabel ? 'Ders No: ' + lessonNoLabel : 'Video';
        var lesson =
          '<span class="machine-web-videos-card__lesson">'
          + '<span class="machine-web-videos-card__lesson-label machine-web-videos-card__lesson-label--desktop">'
          + escapeHtml(lessonDesktop)
          + '</span>'
          + '<span class="machine-web-videos-card__lesson-label machine-web-videos-card__lesson-label--mobile">'
          + escapeHtml(lessonMobile)
          + '</span>'
          + '</span>';

        var desc = v.description
          ? '<p class="machine-web-videos-card__desc">' + escapeHtml(v.description) + '</p>'
          : '';
        var warn = invalid
          ? '<p class="machine-web-videos-card__warn">' + escapeHtml(CARD_VIDEO_LINK_MESSAGE) + '</p>'
          : '';
        var premiumHint = locked
          ? '<p class="machine-web-videos-card__premium-hint">Premium erişimle açılır</p>'
          : '';

        var actionBtn;
        if (invalid) {
          actionBtn =
            '<button type="button" class="machine-web-videos-card__play machine-web-videos-card__play--unplayable" data-video-id="'
            + escapeHtml(v.id)
            + '" data-action="invalid">İzle</button>';
        } else if (playable) {
          actionBtn =
            '<button type="button" class="machine-web-videos-card__play" data-video-id="'
            + escapeHtml(v.id)
            + '" data-action="play">'
            + '<span class="machine-web-videos-card__play-label machine-web-videos-card__play-label--desktop">İzle</span>'
            + '<span class="machine-web-videos-card__play-label machine-web-videos-card__play-label--mobile">Videoyu Aç</span>'
            + '</button>';
        } else if (locked) {
          actionBtn =
            '<button type="button" class="machine-web-videos-card__play machine-web-videos-card__play--premium" data-video-id="'
            + escapeHtml(v.id)
            + '" data-action="locked">Premium</button>';
        } else {
          actionBtn =
            '<span class="machine-web-videos-card__play machine-web-videos-card__play--disabled">Kilitli</span>';
        }

        return (
          '<article class="'
          + cardClass
          + '" data-video-id="'
          + escapeHtml(v.id)
          + '">'
          + thumb
          + '<div class="machine-web-videos-card__body">'
          + '<h2 class="machine-web-videos-card__title">'
          + escapeHtml(v.title)
          + '</h2>'
          + desc
          + premiumHint
          + warn
          + '</div>'
          + '<div class="machine-web-videos-card__footer">'
          + lesson
          + actionBtn
          + '</div>'
          + '</article>'
        );
      })
      .join('');

    var videoById = {};
    videos.forEach(function (v) {
      videoById[v.id] = v;
    });

    function handleAction(ev, btn) {
      ev.stopPropagation();
      var id = btn.getAttribute('data-video-id');
      var item = videoById[id];
      if (!item) return;
      var action = btn.getAttribute('data-action');
      if (action === 'invalid' || !item.hasPlayableVideo) {
        openPlayerModalWithMessage(item, CARD_VIDEO_LINK_MESSAGE);
        return;
      }
      if (action === 'locked') {
        handleLockedClick(item, access);
        return;
      }
      if (action === 'play') {
        if (!access || !access.canPlay) {
          handleLockedClick(item, access);
          return;
        }
        openPlayerModal(item);
      }
    }

    Array.prototype.slice
      .call(grid.querySelectorAll('.machine-web-videos-card__play[data-video-id]'))
      .forEach(function (btn) {
        btn.onclick = function (ev) {
          handleAction(ev, btn);
        };
      });

    Array.prototype.slice
      .call(grid.querySelectorAll('.machine-web-videos-card--locked[data-video-id]'))
      .forEach(function (card) {
        card.onclick = function (ev) {
          if (ev.target && ev.target.closest && ev.target.closest('.machine-web-videos-card__play')) {
            return;
          }
          var id = card.getAttribute('data-video-id');
          var item = videoById[id];
          if (item && item.hasPlayableVideo && isLocked) {
            handleLockedClick(item, access);
          }
        };
      });
  }

  async function renderList(session) {
    var categoryId = readQueryParam('categoryId');
    if (!isCategoryAllowed(categoryId)) {
      redirectHub();
      return;
    }

    var meta = CATEGORY_META[categoryId] || { title: categoryId };
    var titleEl = $('machine-web-videos-list-title');
    if (titleEl) titleEl.textContent = meta.title || categoryId;

    var backHub = $('machine-web-videos-back-hub');
    if (backHub) backHub.setAttribute('href', HUB_HREF);

    var loading = $('machine-web-videos-list-loading');
    var errorEl = $('machine-web-videos-list-error');
    var empty = $('machine-web-videos-list-empty');
    var grid = $('machine-web-videos-list');

    if (loading) loading.hidden = false;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    if (empty) empty.hidden = true;
    if (grid) {
      grid.hidden = true;
      grid.innerHTML = '';
    }

    var access = await resolveAccess(session);
    currentAccess = access;

    var videosResult = await loadVideos(categoryId);
    if (loading) loading.hidden = true;

    if (access.branch === 'FAIL_CLOSED') {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent =
          'Premium erişim durumu doğrulanamadı. Videolar şu anda açılamıyor. Lütfen sayfayı yenileyin.';
      }
      return;
    }

    if (!videosResult.ok) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = videosResult.error || 'Videolar yüklenemedi.';
      }
      return;
    }

    renderVideoList(videosResult.videos || [], access);
  }

  function bindChrome() {
    var homeLink = $('machine-web-videos-home');
    if (homeLink) {
      homeLink.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.href = HOME_HREF;
      });
    }
    var logoutBtn = $('machine-web-videos-logout');
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
    bindEscape();
  }

  async function bootPage(session) {
    var page = getPage();
    if (page === 'hub') {
      renderHub();
      return;
    }
    if (page === 'list') {
      await renderList(session);
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
