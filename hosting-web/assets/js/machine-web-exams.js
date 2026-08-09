/**
 * Machine web Deneme Sınavları — hub / list / runner.
 * Categories: work_machines, first_aid only.
 */
(function () {
  'use strict';

  var PROGRAM_TYPE = 'machine_operator';
  var REGION = 'us-central1';
  var SHARED_EXAM_TENANT_ID = 'surucu_akademisi';
  var HOME_HREF = '../';
  var LOGIN_HREF = '../giris/';
  var HUB_HREF = './';
  var CATEGORY_ALLOWLIST = ['work_machines', 'first_aid'];

  var CATEGORY_META = {
    work_machines: {
      id: 'work_machines',
      title: 'İş Makineleri',
      description:
        'İş makineleri operatörlük sınavlarına yönelik deneme ve çıkmış soru setleri.',
      accent: 'gold',
      order: 1
    },
    first_aid: {
      id: 'first_aid',
      title: 'İlk Yardım',
      description:
        'İş Makineleri sınavlarında sık karşılaşılan İlk Yardım sorularıyla hazırlanın.',
      accent: 'green',
      order: 2
    }
  };

  var settled = false;
  var currentSession = null;

  var runnerState = {
    exam: null,
    questions: [],
    answers: [],
    currentIndex: 0,
    phase: 'idle',
    categoryId: '',
    examId: '',
    attemptSaveStarted: false,
    attemptSaved: false,
    attemptSaveFailed: false,
    timerId: null,
    timerTotalSeconds: 0,
    timerRemainingSeconds: 0,
    timerStartedAt: 0,
    timerExpiredAutoFinish: false
  };

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
    return normalizeString(document.body && document.body.getAttribute('data-me-page'));
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
    return CATEGORY_ALLOWLIST.indexOf(normalizeString(categoryId).toLowerCase()) >= 0;
  }

  function isPublicSession(session) {
    return !!(
      session &&
      (normalizeString(session.mode) === 'public' ||
        normalizeString(session.enrollmentSource) === 'public')
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
    var shell = $('machine-web-exams');
    var gate = $('machine-web-exams-gate');
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
    return 'list.html?category=' + encodeURIComponent(normalizeString(categoryId).toLowerCase());
  }

  function examHref(categoryId, examId) {
    return (
      'exam.html?category=' +
      encodeURIComponent(normalizeString(categoryId).toLowerCase()) +
      '&examId=' +
      encodeURIComponent(normalizeString(examId))
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
      console.warn('[machine-web-exams] revalidate failed', e);
      redirectLogin();
      return null;
    }
  }

  async function paintBranding(session) {
    var api = window.SA_MACHINE_WEB_SESSION;
    if (!api || !session) return;

    var heroEl = document.querySelector('.machine-web-exams-hero');
    var instNameEl = $('machine-web-exams-institution-name');
    var brandEl = $('machine-web-exams-brand-name');
    var programEl = $('machine-web-exams-program-title');
    var logoEl = $('machine-web-exams-logo');
    var monoEl = $('machine-web-exams-monogram');

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

  /* —— Exam content (shared bank) —— */

  function sortExams(exams) {
    var list = Array.isArray(exams) ? exams.slice() : [];
    function toNumberOrNull(v) {
      if (v == null || v === '') return null;
      var n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    function getLastNumber(value) {
      var text = String(value || '');
      var matches = text.match(/(\d+)(?!.*\d)/);
      if (!matches || !matches[1]) return null;
      return toNumberOrNull(matches[1]);
    }
    list.sort(function (a, b) {
      var aOrder = toNumberOrNull(a && (a.order != null ? a.order : a.sortOrder != null ? a.sortOrder : a.sequence));
      var bOrder = toNumberOrNull(b && (b.order != null ? b.order : b.sortOrder != null ? b.sortOrder : b.sequence));
      if (aOrder != null && bOrder != null && aOrder !== bOrder) return aOrder - bOrder;
      if (aOrder != null && bOrder == null) return -1;
      if (aOrder == null && bOrder != null) return 1;
      var aNum = getLastNumber((a && a.title) || (a && a.examId));
      var bNum = getLastNumber((b && b.title) || (b && b.examId));
      if (aNum != null && bNum != null && aNum !== bNum) return aNum - bNum;
      return String((a && a.title) || '').localeCompare(String((b && b.title) || ''), 'tr');
    });
    return list;
  }

  function mapExamDoc(doc) {
    var d = doc.data() || {};
    return {
      examId: doc.id,
      title: normalizeString(d.title) || doc.id,
      description: normalizeString(d.description),
      category: normalizeString(d.category).toLowerCase(),
      totalQuestions: d.totalQuestions != null ? Number(d.totalQuestions) : null,
      timeLimit: d.timeLimit != null ? Number(d.timeLimit) : null,
      status: normalizeString(d.status) || 'published',
      order: d.order != null ? d.order : d.sortOrder != null ? d.sortOrder : d.sequence,
      sortOrder: d.sortOrder,
      sequence: d.sequence
    };
  }

  async function loadPublishedExamsForCategory(categoryId) {
    var cid = normalizeString(categoryId).toLowerCase();
    if (!isCategoryAllowed(cid)) {
      return { ok: false, exams: [], error: 'Bu sınav kategorisi İş Makineleri programında kullanılamaz.' };
    }
    var db = getDb();
    if (!db) return { ok: false, exams: [], error: 'Veritabanı hazır değil.' };
    try {
      var snap = await db
        .collection('tenantExams')
        .doc(SHARED_EXAM_TENANT_ID)
        .collection('exams')
        .where('status', '==', 'published')
        .get();
      var exams = [];
      snap.docs.forEach(function (doc) {
        var exam = mapExamDoc(doc);
        if (exam.category === cid) exams.push(exam);
      });
      return { ok: true, exams: sortExams(exams), error: null };
    } catch (e) {
      console.warn('[machine-web-exams] load exams failed', e);
      return { ok: false, exams: [], error: 'Sınav listesi yüklenemedi. Lütfen tekrar deneyin.' };
    }
  }

  function normalizeCorrectLetter(value) {
    var letter = String(value || '').trim().toUpperCase();
    if (!letter) return 'A';
    letter = letter.charAt(0);
    if (letter >= 'A' && letter <= 'D') return letter;
    return 'A';
  }

  function isImageUrlValue(value) {
    var raw = String(value || '').trim();
    if (!raw) return false;
    if (/^data:image\//i.test(raw)) return true;
    if (!/^https?:\/\//i.test(raw)) return false;
    if (/firebasestorage\.googleapis\.com/i.test(raw)) return true;
    if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(raw)) return true;
    return false;
  }

  function coerceOptionMedia(text, imageUrl) {
    var t = String(text || '').trim();
    var img = String(imageUrl || '').trim();
    if (!img && isImageUrlValue(t)) return { text: '', imageUrl: t };
    if (img && isImageUrlValue(t) && t === img) return { text: '', imageUrl: img };
    return { text: t, imageUrl: img };
  }

  function normalizeOptionEntry(opt, index) {
    var key = String.fromCharCode(65 + index);
    if (typeof opt === 'string') {
      var trimmed = opt.trim();
      if (isImageUrlValue(trimmed)) return { key: key, text: '', imageUrl: trimmed };
      return { key: key, text: trimmed, imageUrl: '' };
    }
    if (opt && typeof opt === 'object') {
      var text = opt.text != null ? String(opt.text).trim() : opt.label != null ? String(opt.label).trim() : '';
      var imageUrl = opt.imageUrl && String(opt.imageUrl).trim() ? String(opt.imageUrl).trim() : '';
      var optKey = opt.key != null ? String(opt.key).trim().toUpperCase() : key;
      if (optKey.length === 1 && optKey >= 'A' && optKey <= 'D') key = optKey;
      var coerced = coerceOptionMedia(text, imageUrl);
      return { key: key, text: coerced.text, imageUrl: coerced.imageUrl };
    }
    return { key: key, text: '', imageUrl: '' };
  }

  function transformFsQuestionToWeb(data, id) {
    var d = data && typeof data === 'object' ? data : {};
    var rawOpts = Array.isArray(d.options) ? d.options : [];
    var options = rawOpts
      .map(function (opt, i) {
        return normalizeOptionEntry(opt, i);
      })
      .filter(function (opt) {
        return opt.text || opt.imageUrl;
      });
    while (options.length < 4) {
      options.push({ key: String.fromCharCode(65 + options.length), text: '', imageUrl: '' });
    }
    options = options.slice(0, 4);
    for (var j = 0; j < options.length; j++) {
      options[j].key = String.fromCharCode(65 + j);
    }
    var questionImage = (d.questionImage || (d.mediaType === 'image' ? d.mediaUrl : null) || '')
      .toString()
      .trim();
    return {
      questionId: id || d.questionId || '',
      order: d.order != null ? Number(d.order) : 999,
      q: (d.prompt || d.q || d.question || '').toString().trim() || '(Soru metni yok)',
      options: options,
      answer: normalizeCorrectLetter(d.correctOption || d.answer),
      explain: (d.explanation || d.explain || '').toString().trim(),
      questionImage: questionImage
    };
  }

  async function loadPublishedExamById(examId) {
    var id = normalizeString(examId);
    if (!id) return { ok: false, exam: null, error: 'Geçersiz sınav.' };
    var db = getDb();
    if (!db) return { ok: false, exam: null, error: 'Veritabanı hazır değil.' };
    try {
      var snap = await db
        .collection('tenantExams')
        .doc(SHARED_EXAM_TENANT_ID)
        .collection('exams')
        .doc(id)
        .get();
      if (!snap.exists) return { ok: false, exam: null, error: 'Sınav bulunamadı.' };
      var exam = mapExamDoc(snap);
      if (String(exam.status || '').toLowerCase() !== 'published') {
        return { ok: false, exam: exam, error: 'Bu sınav henüz yayınlanmamış.' };
      }
      return { ok: true, exam: exam, error: null };
    } catch (e) {
      console.warn('[machine-web-exams] load exam failed', e);
      return { ok: false, exam: null, error: 'Sınav yüklenemedi. Lütfen tekrar deneyin.' };
    }
  }

  async function loadQuestions(examId) {
    var id = normalizeString(examId);
    if (!id) return { ok: false, questions: [], error: 'Geçersiz sınav.' };
    var db = getDb();
    if (!db) return { ok: false, questions: [], error: 'Veritabanı hazır değil.' };
    try {
      var snap = await db
        .collection('tenantExams')
        .doc(SHARED_EXAM_TENANT_ID)
        .collection('questions')
        .where('examKey', '==', id)
        .get();
      var raw = snap.docs.map(function (doc) {
        return {
          id: doc.id,
          order: doc.data().order != null ? Number(doc.data().order) : 999,
          data: doc.data()
        };
      });
      raw.sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
      var questions = raw
        .map(function (r) {
          return transformFsQuestionToWeb(r.data, r.id);
        })
        .filter(function (q) {
          return (
            q.q &&
            q.q !== '(Soru metni yok)' &&
            q.options.some(function (opt) {
              return opt.text || opt.imageUrl;
            })
          );
        });
      return { ok: true, questions: questions, error: null };
    } catch (e) {
      console.warn('[machine-web-exams] load questions failed', e);
      return { ok: false, questions: [], error: 'Sorular yüklenemedi. Lütfen tekrar deneyin.' };
    }
  }

  /* —— Hub / List —— */

  function renderHub() {
    var grid = $('machine-web-exams-category-grid');
    var loading = $('machine-web-exams-hub-loading');
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
          '<article class="machine-web-exams-book-card machine-web-exams-book-card--'
          + accent
          + ' machine-web-exams-book-card--clickable" data-category-id="'
          + escapeHtml(cat.id)
          + '" role="link" tabindex="0">'
          + '<h2 class="machine-web-exams-book-card__title">'
          + escapeHtml(cat.title)
          + '</h2>'
          + '<p class="machine-web-exams-book-card__desc">'
          + escapeHtml(cat.description)
          + '</p>'
          + '<span class="machine-web-exams-book-card__cta">Sınavları Gör</span>'
          + '</article>'
        );
      })
      .join('');
    Array.prototype.slice
      .call(grid.querySelectorAll('.machine-web-exams-book-card[data-category-id]'))
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

  function formatExamMeta(exam) {
    var parts = [];
    if (exam.totalQuestions != null && Number.isFinite(Number(exam.totalQuestions))) {
      parts.push(Number(exam.totalQuestions) + ' soru');
    }
    if (exam.timeLimit != null && Number.isFinite(Number(exam.timeLimit))) {
      parts.push(Number(exam.timeLimit) + ' dk');
    }
    return parts.join(' · ');
  }

  async function renderList() {
    var categoryId = readQueryParam('category').toLowerCase();
    if (!isCategoryAllowed(categoryId)) {
      redirectHub();
      return;
    }
    var meta = CATEGORY_META[categoryId] || { title: categoryId };
    var titleEl = $('machine-web-exams-list-title');
    if (titleEl) titleEl.textContent = meta.title || categoryId;
    var back = $('machine-web-exams-back-hub');
    if (back) back.setAttribute('href', HUB_HREF);

    var loading = $('machine-web-exams-list-loading');
    var errorEl = $('machine-web-exams-list-error');
    var empty = $('machine-web-exams-list-empty');
    var root = $('machine-web-exams-list-root');
    if (loading) loading.hidden = false;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    if (empty) empty.hidden = true;
    if (root) root.innerHTML = '';

    var result = await loadPublishedExamsForCategory(categoryId);
    if (loading) loading.hidden = true;
    if (!result.ok) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = result.error || 'Sınav listesi yüklenemedi.';
      }
      return;
    }
    var exams = result.exams || [];
    if (!exams.length) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'Bu kategori için henüz yayımlanmış sınav bulunmuyor.';
      }
      return;
    }
    if (!root) return;
    root.innerHTML = exams
      .map(function (exam) {
        var desc = exam.description
          ? '<p class="machine-web-exams-pub-card__desc">' + escapeHtml(exam.description) + '</p>'
          : '';
        var metaLine = formatExamMeta(exam);
        var metaHtml = metaLine
          ? '<p class="machine-web-exams-pub-card__meta">' + escapeHtml(metaLine) + '</p>'
          : '';
        return (
          '<article class="machine-web-exams-pub-card">'
          + '<div class="machine-web-exams-pub-card__head">'
          + '<h2 class="machine-web-exams-pub-card__title">'
          + escapeHtml(exam.title || exam.examId)
          + '</h2>'
          + '<span class="machine-web-exams-pub-card__status">Yayınlandı</span>'
          + '</div>'
          + desc
          + metaHtml
          + '<div class="machine-web-exams-pub-card__actions">'
          + '<button type="button" class="machine-web-exams-pub-card__btn" data-exam-id="'
          + escapeHtml(exam.examId)
          + '">Sınavı Çöz</button>'
          + '</div>'
          + '</article>'
        );
      })
      .join('');
    Array.prototype.slice
      .call(root.querySelectorAll('.machine-web-exams-pub-card__btn[data-exam-id]'))
      .forEach(function (btn) {
        btn.onclick = function () {
          var examId = btn.getAttribute('data-exam-id');
          if (!examId) return;
          window.location.href = examHref(categoryId, examId);
        };
      });
  }

  /* —— Runner —— */

  function hidePanel(el) {
    if (el) el.hidden = true;
  }

  function showPanel(el) {
    if (el) el.hidden = false;
  }

  function hideAllRunnerPanels() {
    hidePanel($('machine-web-exams-intro'));
    hidePanel($('machine-web-exams-solving'));
    hidePanel($('machine-web-exams-result'));
  }

  function stopTimer() {
    if (runnerState.timerId) {
      clearInterval(runnerState.timerId);
      runnerState.timerId = null;
    }
  }

  function formatTimerDisplay(totalSeconds) {
    var s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function updateTimerUi() {
    var el = $('machine-web-exams-timer');
    if (!el) return;
    if (runnerState.timerTotalSeconds <= 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = formatTimerDisplay(runnerState.timerRemainingSeconds);
  }

  function startTimerIfNeeded() {
    stopTimer();
    var minutes = runnerState.exam && runnerState.exam.timeLimit != null
      ? Number(runnerState.exam.timeLimit)
      : 0;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      runnerState.timerTotalSeconds = 0;
      runnerState.timerRemainingSeconds = 0;
      updateTimerUi();
      return;
    }
    runnerState.timerTotalSeconds = Math.round(minutes * 60);
    runnerState.timerRemainingSeconds = runnerState.timerTotalSeconds;
    runnerState.timerStartedAt = Date.now();
    runnerState.timerExpiredAutoFinish = false;
    updateTimerUi();
    runnerState.timerId = setInterval(function () {
      runnerState.timerRemainingSeconds -= 1;
      if (runnerState.timerRemainingSeconds <= 0) {
        runnerState.timerRemainingSeconds = 0;
        updateTimerUi();
        stopTimer();
        runnerState.timerExpiredAutoFinish = true;
        finishExam(true);
        return;
      }
      updateTimerUi();
    }, 1000);
  }

  function computeResults() {
    var correct = 0;
    var wrong = 0;
    var blank = 0;
    var total = runnerState.questions.length;
    var details = [];
    runnerState.questions.forEach(function (q, i) {
      var user = runnerState.answers[i] || '';
      var isBlank = !user;
      var isCorrect = !isBlank && user === q.answer;
      if (isBlank) blank++;
      else if (isCorrect) correct++;
      else wrong++;
      details.push({
        index: i,
        question: q,
        userAnswer: user,
        correctAnswer: q.answer,
        isBlank: isBlank,
        isCorrect: isCorrect
      });
    });
    var percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
    var elapsedSeconds = 0;
    if (runnerState.timerTotalSeconds > 0) {
      elapsedSeconds = runnerState.timerTotalSeconds - Math.max(0, runnerState.timerRemainingSeconds);
    } else if (runnerState.timerStartedAt) {
      elapsedSeconds = Math.max(0, Math.round((Date.now() - runnerState.timerStartedAt) / 1000));
    }
    return {
      correct: correct,
      wrong: wrong,
      blank: blank,
      total: total,
      percentage: percentage,
      details: details,
      elapsedSeconds: elapsedSeconds
    };
  }

  function renderOptionContent(opt) {
    if (opt.imageUrl) {
      return (
        '<span class="machine-web-exams-option__media">'
        + (opt.text ? '<span class="machine-web-exams-option__text">' + escapeHtml(opt.text) + '</span>' : '')
        + '<img class="machine-web-exams-option__img" src="'
        + escapeHtml(opt.imageUrl)
        + '" alt="" loading="lazy" />'
        + '</span>'
      );
    }
    return '<span class="machine-web-exams-option__text">' + escapeHtml(opt.text) + '</span>';
  }

  function isQuestionAnswered(index) {
    var a = runnerState.answers[index];
    return !!(a && String(a).trim());
  }

  function normalizeAnswerLetter(letter) {
    var L = String(letter || '').trim().toUpperCase().charAt(0);
    if (L >= 'A' && L <= 'D') return L;
    return '';
  }

  function renderSolvingQuestion() {
    var q = runnerState.questions[runnerState.currentIndex];
    if (!q) return;
    var total = runnerState.questions.length;
    var idx = runnerState.currentIndex;
    var titleEl = $('machine-web-exams-solving-title');
    var progressEl = $('machine-web-exams-progress');
    if (titleEl) titleEl.textContent = (runnerState.exam && runnerState.exam.title) || 'Sınav';
    if (progressEl) progressEl.textContent = 'Soru ' + (idx + 1) + ' / ' + total;

    var answered = isQuestionAnswered(idx);
    var userLetter = answered ? normalizeAnswerLetter(runnerState.answers[idx]) : '';
    var correctLetter = normalizeAnswerLetter(q.answer) || 'A';

    var html = '';
    html += '<p class="machine-web-exams-question__text">' + escapeHtml(q.q) + '</p>';
    if (q.questionImage) {
      html +=
        '<div class="machine-web-exams-question__media"><img src="'
        + escapeHtml(q.questionImage)
        + '" alt="" loading="lazy" /></div>';
    }
    html += '<div class="machine-web-exams-options" role="listbox" aria-label="Cevap seçenekleri">';
    q.options.forEach(function (opt) {
      if (!opt.text && !opt.imageUrl) return;
      var optClass = 'machine-web-exams-option';
      if (answered) {
        optClass += ' machine-web-exams-option--locked';
        if (opt.key === correctLetter) optClass += ' machine-web-exams-option--correct';
        if (userLetter && opt.key === userLetter && userLetter !== correctLetter) {
          optClass += ' machine-web-exams-option--wrong';
        }
      }
      html +=
        '<button type="button" class="'
        + optClass
        + '" data-option-key="'
        + escapeHtml(opt.key)
        + '"'
        + (answered ? ' disabled' : '')
        + '>';
      html += '<span class="machine-web-exams-option__key">' + escapeHtml(opt.key) + '</span>';
      html += renderOptionContent(opt);
      html += '</button>';
    });
    html += '</div>';
    if (answered) {
      html +=
        '<div class="machine-web-exams-answer-badge">Doğru cevap: <strong>'
        + escapeHtml(correctLetter)
        + '</strong></div>';
      if (q.explain) {
        html +=
          '<div class="machine-web-exams-explain"><span class="machine-web-exams-explain__label">Açıklama</span><p>'
          + escapeHtml(q.explain)
          + '</p></div>';
      }
    }

    var questionRoot = $('machine-web-exams-question');
    if (questionRoot) {
      questionRoot.innerHTML = html;
      if (!answered) {
        Array.prototype.slice
          .call(questionRoot.querySelectorAll('.machine-web-exams-option[data-option-key]'))
          .forEach(function (btn) {
            btn.addEventListener('click', function () {
              selectOption(btn.getAttribute('data-option-key'));
            });
          });
      }
    }

    var prevBtn = $('machine-web-exams-prev-btn');
    var nextBtn = $('machine-web-exams-next-btn');
    var finishBtn = $('machine-web-exams-finish-btn');
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.hidden = idx >= total - 1;
    if (finishBtn) finishBtn.hidden = idx < total - 1;
  }

  function selectOption(optionKey) {
    if (runnerState.phase !== 'solving') return;
    if (isQuestionAnswered(runnerState.currentIndex)) return;
    var key = normalizeAnswerLetter(optionKey);
    if (!key) return;
    runnerState.answers[runnerState.currentIndex] = key;
    renderSolvingQuestion();
  }

  function reviewStatusBadge(d) {
    if (d.isBlank) return '<span class="machine-web-exams-review-badge machine-web-exams-review-badge--blank">Boş</span>';
    if (d.isCorrect) {
      return '<span class="machine-web-exams-review-badge machine-web-exams-review-badge--correct">Doğru</span>';
    }
    return '<span class="machine-web-exams-review-badge machine-web-exams-review-badge--wrong">Yanlış</span>';
  }

  function renderResult() {
    var res = computeResults();
    hideAllRunnerPanels();
    showPanel($('machine-web-exams-result'));

    var summary = $('machine-web-exams-summary');
    if (summary) {
      var summaryHtml =
        '<div class="machine-web-exams-summary__grid">'
        + '<div class="machine-web-exams-stat machine-web-exams-stat--correct"><span class="machine-web-exams-stat__value">'
        + res.correct
        + '</span><span class="machine-web-exams-stat__label">Doğru</span></div>'
        + '<div class="machine-web-exams-stat machine-web-exams-stat--wrong"><span class="machine-web-exams-stat__value">'
        + res.wrong
        + '</span><span class="machine-web-exams-stat__label">Yanlış</span></div>'
        + '<div class="machine-web-exams-stat machine-web-exams-stat--blank"><span class="machine-web-exams-stat__value">'
        + res.blank
        + '</span><span class="machine-web-exams-stat__label">Boş</span></div>'
        + '<div class="machine-web-exams-stat machine-web-exams-stat--pct"><span class="machine-web-exams-stat__value">%'
        + res.percentage
        + '</span><span class="machine-web-exams-stat__label">Başarı</span></div>'
        + '</div>';
      if (runnerState.timerExpiredAutoFinish) {
        summaryHtml +=
          '<p class="machine-web-exams-result__note">Süre dolduğu için sınav otomatik bitirildi.</p>';
      }
      if (runnerState.attemptSaveFailed) {
        summaryHtml +=
          '<p class="machine-web-exams-result__note machine-web-exams-result__note--error">Sonuç kaydedilemedi. Lütfen internet bağlantınızı kontrol edip sınavı yeniden tamamlamayı deneyin.</p>';
      } else if (runnerState.attemptSaved) {
        summaryHtml +=
          '<p class="machine-web-exams-result__note machine-web-exams-result__note--ok">Sonucunuz kaydedildi.</p>';
      }
      summary.innerHTML = summaryHtml;
    }

    var review = $('machine-web-exams-review');
    if (review) {
      var reviewHtml = '<ol class="machine-web-exams-review-list">';
      res.details.forEach(function (d, i) {
        reviewHtml +=
          '<li class="machine-web-exams-review-item">'
          + '<div class="machine-web-exams-review-item__head">'
          + '<span>Soru '
          + (i + 1)
          + '</span>'
          + reviewStatusBadge(d)
          + '</div>'
          + '<p class="machine-web-exams-review-item__q">'
          + escapeHtml(d.question.q)
          + '</p>'
          + '<p class="machine-web-exams-review-item__ans">Sizin cevap: <strong>'
          + escapeHtml(d.userAnswer || '—')
          + '</strong> · Doğru: <strong>'
          + escapeHtml(d.correctAnswer)
          + '</strong></p>';
        if (d.question.explain) {
          reviewHtml +=
            '<p class="machine-web-exams-review-item__explain">'
            + escapeHtml(d.question.explain)
            + '</p>';
        }
        reviewHtml += '</li>';
      });
      reviewHtml += '</ol>';
      review.innerHTML = reviewHtml;
    }

    var backCat = $('machine-web-exams-back-category');
    if (backCat) backCat.setAttribute('href', listHref(runnerState.categoryId));
  }

  async function persistAttempt(res) {
    if (runnerState.attemptSaveStarted || runnerState.attemptSaved) return;
    runnerState.attemptSaveStarted = true;
    var attemptsApi = window.SA_MACHINE_WEB_EXAM_ATTEMPTS;
    if (!attemptsApi || typeof attemptsApi.persistMachineWebExamAttempt !== 'function') {
      runnerState.attemptSaveStarted = false;
      runnerState.attemptSaveFailed = true;
      return;
    }
    try {
      var result = await attemptsApi.persistMachineWebExamAttempt({
        session: currentSession,
        categoryId: runnerState.categoryId,
        examId: runnerState.examId,
        examTitle: runnerState.exam && runnerState.exam.title,
        result: res
      });
      if (result && result.ok) {
        runnerState.attemptSaved = true;
        runnerState.attemptSaveFailed = false;
      } else {
        runnerState.attemptSaveFailed = true;
        runnerState.attemptSaveStarted = false;
      }
    } catch (e) {
      console.warn('[machine-web-exams] persist failed', e);
      runnerState.attemptSaveFailed = true;
      runnerState.attemptSaveStarted = false;
    }
  }

  async function finishExam(fromTimer) {
    if (runnerState.phase === 'result') return;
    if (runnerState.attemptSaveStarted && !fromTimer) return;
    stopTimer();
    runnerState.phase = 'result';
    var res = computeResults();
    await persistAttempt(res);
    renderResult();
  }

  function closeFinishModal() {
    var gate = $('machine-web-exams-finish-gate');
    if (gate) {
      gate.hidden = true;
      gate.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('machine-web-exams-finish-open');
  }

  function openFinishModal(blankCount) {
    var gate = $('machine-web-exams-finish-gate');
    var msg = $('machine-web-exams-finish-gate-message');
    if (!gate) {
      finishExam(false);
      return;
    }
    if (msg) {
      msg.textContent = blankCount + ' soru boş. Sınavı bitirmek istediğinize emin misiniz?';
    }
    gate.hidden = false;
    gate.setAttribute('aria-hidden', 'false');
    document.body.classList.add('machine-web-exams-finish-open');
  }

  function confirmFinish() {
    if (runnerState.phase !== 'solving') return;
    var blankCount = runnerState.answers.filter(function (a) {
      return !a;
    }).length;
    if (blankCount > 0) {
      openFinishModal(blankCount);
      return;
    }
    finishExam(false);
  }

  function bindRunnerControls() {
    var startBtn = $('machine-web-exams-start-btn');
    if (startBtn) {
      startBtn.onclick = function () {
        hideAllRunnerPanels();
        showPanel($('machine-web-exams-solving'));
        runnerState.phase = 'solving';
        runnerState.currentIndex = 0;
        runnerState.timerStartedAt = Date.now();
        startTimerIfNeeded();
        renderSolvingQuestion();
      };
    }
    var prevBtn = $('machine-web-exams-prev-btn');
    if (prevBtn) {
      prevBtn.onclick = function () {
        if (runnerState.currentIndex <= 0) return;
        runnerState.currentIndex -= 1;
        renderSolvingQuestion();
      };
    }
    var nextBtn = $('machine-web-exams-next-btn');
    if (nextBtn) {
      nextBtn.onclick = function () {
        if (runnerState.currentIndex >= runnerState.questions.length - 1) return;
        runnerState.currentIndex += 1;
        renderSolvingQuestion();
      };
    }
    var finishBtn = $('machine-web-exams-finish-btn');
    if (finishBtn) finishBtn.onclick = confirmFinish;

    var dismiss = $('machine-web-exams-finish-dismiss');
    var confirmBtn = $('machine-web-exams-finish-confirm');
    var backdrop = $('machine-web-exams-finish-backdrop');
    if (dismiss) dismiss.onclick = closeFinishModal;
    if (confirmBtn) {
      confirmBtn.onclick = function () {
        closeFinishModal();
        finishExam(false);
      };
    }
    if (backdrop) backdrop.onclick = closeFinishModal;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var gate = $('machine-web-exams-finish-gate');
      if (gate && !gate.hidden) closeFinishModal();
    });
  }

  async function renderExam(session) {
    var categoryId = readQueryParam('category').toLowerCase();
    var examId = readQueryParam('examId');
    if (!isCategoryAllowed(categoryId) || !examId) {
      redirectHub();
      return;
    }

    runnerState.categoryId = categoryId;
    runnerState.examId = examId;
    runnerState.attemptSaveStarted = false;
    runnerState.attemptSaved = false;
    runnerState.attemptSaveFailed = false;

    var loading = $('machine-web-exams-runner-loading');
    var errorEl = $('machine-web-exams-runner-error');
    if (loading) loading.hidden = false;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    hideAllRunnerPanels();

    var examResult = await loadPublishedExamById(examId);
    if (!examResult.ok || !examResult.exam) {
      if (loading) loading.hidden = true;
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = examResult.error || 'Sınav yüklenemedi.';
      }
      return;
    }
    if (normalizeString(examResult.exam.category).toLowerCase() !== categoryId) {
      if (loading) loading.hidden = true;
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = 'Bu sınav seçilen İş Makineleri kategorisine ait değil.';
      }
      return;
    }
    if (!isCategoryAllowed(examResult.exam.category)) {
      redirectHub();
      return;
    }

    var qResult = await loadQuestions(examId);
    if (loading) loading.hidden = true;
    if (!qResult.ok || !qResult.questions.length) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = qResult.error || 'Bu sınav için soru bulunamadı.';
      }
      return;
    }

    runnerState.exam = examResult.exam;
    runnerState.questions = qResult.questions;
    runnerState.answers = new Array(qResult.questions.length).fill('');
    runnerState.currentIndex = 0;
    runnerState.phase = 'intro';

    var introTitle = $('machine-web-exams-intro-title');
    var introCat = $('machine-web-exams-intro-category');
    var introMeta = $('machine-web-exams-intro-meta');
    if (introTitle) introTitle.textContent = examResult.exam.title || 'Sınav';
    if (introCat) {
      var catMeta = CATEGORY_META[categoryId];
      introCat.textContent = (catMeta && catMeta.title) || categoryId;
    }
    if (introMeta) {
      var items = [];
      items.push('<li>' + qResult.questions.length + ' soru</li>');
      if (examResult.exam.timeLimit != null && Number.isFinite(Number(examResult.exam.timeLimit))) {
        items.push('<li>' + Number(examResult.exam.timeLimit) + ' dakika</li>');
      }
      introMeta.innerHTML = items.join('');
    }

    var backList = $('machine-web-exams-intro-back');
    if (backList) backList.setAttribute('href', listHref(categoryId));

    showPanel($('machine-web-exams-intro'));
    bindRunnerControls();
  }

  function bindChrome() {
    var homeLink = $('machine-web-exams-home');
    if (homeLink) {
      homeLink.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.href = HOME_HREF;
      });
    }
    var logoutBtn = $('machine-web-exams-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        logoutBtn.disabled = true;
        stopTimer();
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
      renderHub();
      return;
    }
    if (page === 'list') {
      await renderList();
      return;
    }
    if (page === 'exam') {
      await renderExam(session);
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
