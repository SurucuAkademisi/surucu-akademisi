/**
 * Read-only web exam repository — published exam metadata from tenantExams/surucu_akademisi.
 */
(function () {
  'use strict';

  var catalog = window.SA_WEB_EXAM_CATALOG;
  var SHARED_EXAM_TENANT_ID = catalog && catalog.SHARED_EXAM_TENANT_ID
    ? catalog.SHARED_EXAM_TENANT_ID
    : 'surucu_akademisi';

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

  function mapExamDoc(doc) {
    var d = doc.data() || {};
    return {
      examId: doc.id,
      title: (d.title || '').toString().trim() || doc.id,
      description: (d.description || '').toString().trim() || '',
      category: (d.category || '').toString().trim().toLowerCase() || '',
      totalQuestions: d.totalQuestions != null ? Number(d.totalQuestions) : null,
      timeLimit: d.timeLimit != null ? Number(d.timeLimit) : null,
      status: (d.status || '').toString().trim() || 'published',
      order: d.order != null ? d.order : (d.sortOrder != null ? d.sortOrder : d.sequence),
      sortOrder: d.sortOrder,
      sequence: d.sequence,
      createdAt: d.createdAt || null,
      updatedAt: d.updatedAt || null
    };
  }

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

  function getCreatedAtMs(x) {
    var c = x && x.createdAt;
    if (!c) return null;
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (typeof c.seconds === 'number') return c.seconds * 1000;
    var t = Date.parse(String(c));
    return Number.isFinite(t) ? t : null;
  }

  function sortExams(exams) {
    var list = Array.isArray(exams) ? exams.slice() : [];
    list.sort(function (a, b) {
      var aOrder = toNumberOrNull(a && (a.order != null ? a.order : (a.sortOrder != null ? a.sortOrder : a.sequence)));
      var bOrder = toNumberOrNull(b && (b.order != null ? b.order : (b.sortOrder != null ? b.sortOrder : b.sequence)));
      if (aOrder != null && bOrder != null && aOrder !== bOrder) return aOrder - bOrder;
      if (aOrder != null && bOrder == null) return -1;
      if (aOrder == null && bOrder != null) return 1;

      var aNum = getLastNumber((a && a.title) || (a && a.examId));
      var bNum = getLastNumber((b && b.title) || (b && b.examId));
      if (aNum != null && bNum != null && aNum !== bNum) return aNum - bNum;
      if (aNum != null && bNum == null) return -1;
      if (aNum == null && bNum != null) return 1;

      var aCreated = getCreatedAtMs(a);
      var bCreated = getCreatedAtMs(b);
      if (aCreated != null && bCreated != null && aCreated !== bCreated) return aCreated - bCreated;
      if (aCreated != null && bCreated == null) return -1;
      if (aCreated == null && bCreated != null) return 1;

      return String((a && a.title) || '').localeCompare(String((b && b.title) || ''), 'tr');
    });
    return list;
  }

  function groupExamsByCategory(exams) {
    var grouped = {};
    var list = Array.isArray(exams) ? exams : [];
    list.forEach(function (exam) {
      var cat = (exam && exam.category) ? String(exam.category).trim().toLowerCase() : '';
      if (!cat) cat = '_uncategorized';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(exam);
    });
    Object.keys(grouped).forEach(function (key) {
      grouped[key] = sortExams(grouped[key]);
    });
    return grouped;
  }

  async function loadPublishedExams() {
    if (!isAuthenticated()) {
      return {
        ok: true,
        authenticated: false,
        exams: [],
        grouped: {},
        error: null
      };
    }

    var db = getDb();
    if (!db) {
      return {
        ok: false,
        authenticated: true,
        exams: [],
        grouped: {},
        error: 'Veritabanı hazır değil.'
      };
    }

    try {
      var snap = await db
        .collection('tenantExams')
        .doc(SHARED_EXAM_TENANT_ID)
        .collection('exams')
        .where('status', '==', 'published')
        .get();

      var exams = [];
      snap.docs.forEach(function (doc) {
        exams.push(mapExamDoc(doc));
      });
      exams = sortExams(exams);

      return {
        ok: true,
        authenticated: true,
        exams: exams,
        grouped: groupExamsByCategory(exams),
        error: null
      };
    } catch (e) {
      console.warn('[SA_WEB_EXAM_REPO] loadPublishedExams failed', e);
      return {
        ok: false,
        authenticated: true,
        exams: [],
        grouped: {},
        error: (e && e.message) ? String(e.message) : 'Sınav listesi yüklenemedi.'
      };
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
    if (!img && isImageUrlValue(t)) {
      return { text: '', imageUrl: t };
    }
    if (img && isImageUrlValue(t) && t === img) {
      return { text: '', imageUrl: img };
    }
    return { text: t, imageUrl: img };
  }

  function normalizeOptionEntry(opt, index) {
    var key = String.fromCharCode(65 + index);
    if (typeof opt === 'string') {
      var trimmed = opt.trim();
      if (isImageUrlValue(trimmed)) {
        return { key: key, text: '', imageUrl: trimmed };
      }
      return { key: key, text: trimmed, imageUrl: '' };
    }
    if (opt && typeof opt === 'object') {
      var text = opt.text != null ? String(opt.text).trim() : (opt.label != null ? String(opt.label).trim() : '');
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
    var options = rawOpts.map(function (opt, i) {
      return normalizeOptionEntry(opt, i);
    }).filter(function (opt) {
      return opt.text || opt.imageUrl;
    });

    while (options.length < 4) {
      options.push({ key: String.fromCharCode(65 + options.length), text: '', imageUrl: '' });
    }
    options = options.slice(0, 4);
    for (var j = 0; j < options.length; j++) {
      options[j].key = String.fromCharCode(65 + j);
    }

    var questionImage = (d.questionImage || (d.mediaType === 'image' ? d.mediaUrl : null) || '').toString().trim();
    var questionVideoUrl = (d.questionVideoUrl || (d.mediaType === 'video' ? d.mediaUrl : null) || '').toString().trim();
    var mediaType = d.mediaType != null ? String(d.mediaType).trim().toLowerCase() : '';
    var mediaUrl = d.mediaUrl != null ? String(d.mediaUrl).trim() : '';

    return {
      questionId: id || d.questionId || '',
      order: d.order != null ? Number(d.order) : 999,
      q: (d.prompt || d.q || d.question || '').toString().trim() || '(Soru metni yok)',
      options: options,
      answer: normalizeCorrectLetter(d.correctOption || d.answer),
      explain: (d.explanation || d.explain || '').toString().trim(),
      questionImage: questionImage,
      questionVideoUrl: questionVideoUrl,
      mediaType: mediaType,
      mediaUrl: mediaUrl
    };
  }

  async function loadPublishedExamById(examId) {
    var id = String(examId || '').trim();
    if (!id) {
      return { ok: false, authenticated: isAuthenticated(), exam: null, notFound: true, notPublished: false, error: 'Geçersiz sınav.' };
    }
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, exam: null, notFound: false, notPublished: false, error: null };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, authenticated: true, exam: null, notFound: false, notPublished: false, error: 'Veritabanı hazır değil.' };
    }
    try {
      var snap = await db.collection('tenantExams').doc(SHARED_EXAM_TENANT_ID).collection('exams').doc(id).get();
      if (!snap.exists) {
        return { ok: false, authenticated: true, exam: null, notFound: true, notPublished: false, error: 'Sınav bulunamadı.' };
      }
      var exam = mapExamDoc(snap);
      if (String(exam.status || '').toLowerCase() !== 'published') {
        return { ok: false, authenticated: true, exam: exam, notFound: false, notPublished: true, error: 'Bu sınav henüz yayınlanmamış.' };
      }
      return { ok: true, authenticated: true, exam: exam, notFound: false, notPublished: false, error: null };
    } catch (e) {
      console.warn('[SA_WEB_EXAM_REPO] loadPublishedExamById failed', e);
      return {
        ok: false,
        authenticated: true,
        exam: null,
        notFound: false,
        notPublished: false,
        error: (e && e.message) ? String(e.message) : 'Sınav yüklenemedi.'
      };
    }
  }

  async function loadQuestions(examId) {
    var id = String(examId || '').trim();
    if (!id) {
      return { ok: false, authenticated: isAuthenticated(), questions: [], error: 'Geçersiz sınav.' };
    }
    if (!isAuthenticated()) {
      return { ok: true, authenticated: false, questions: [], error: null };
    }
    var db = getDb();
    if (!db) {
      return { ok: false, authenticated: true, questions: [], error: 'Veritabanı hazır değil.' };
    }
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
          return q.q && q.q !== '(Soru metni yok)' && q.options.some(function (opt) {
            return opt.text || opt.imageUrl;
          });
        });

      return { ok: true, authenticated: true, questions: questions, error: null };
    } catch (e) {
      console.warn('[SA_WEB_EXAM_REPO] loadQuestions failed', e);
      return {
        ok: false,
        authenticated: true,
        questions: [],
        error: (e && e.message) ? String(e.message) : 'Sorular yüklenemedi.'
      };
    }
  }

  function formatUpdatedAt(ts) {
    if (!ts) return '';
    try {
      var date;
      if (typeof ts.toDate === 'function') date = ts.toDate();
      else if (typeof ts.seconds === 'number') date = new Date(ts.seconds * 1000);
      else date = new Date(ts);
      if (!date || isNaN(date.getTime())) return '';
      return date.toLocaleDateString('tr-TR', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) {
      return '';
    }
  }

  window.SA_WEB_EXAM_REPO = {
    SHARED_EXAM_TENANT_ID: SHARED_EXAM_TENANT_ID,
    getDb: getDb,
    getAuth: getAuth,
    isAuthenticated: isAuthenticated,
    loadPublishedExams: loadPublishedExams,
    loadPublishedExamById: loadPublishedExamById,
    loadQuestions: loadQuestions,
    transformFsQuestionToWeb: transformFsQuestionToWeb,
    isImageUrlValue: isImageUrlValue,
    groupExamsByCategory: groupExamsByCategory,
    sortExams: sortExams,
    formatUpdatedAt: formatUpdatedAt
  };
})();
