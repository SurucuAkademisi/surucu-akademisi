/**
 * Exam repository: Firestore tenantExams koleksiyonundan sınav listesi ve soruları okur.
 * Admin panelde kaydedilen sınavların mobil uygulamada görünmesini sağlar.
 * Sınavlar ortak/global: tüm kurumlar aynı tenant altındaki sınavları görür.
 * window.SA_EXAM_REPO olarak expose edilir.
 */
(function () {
  'use strict';

  var SHARED_EXAM_TENANT_ID = 'surucu_akademisi';

  function getFirestore() {
    if (typeof window === 'undefined' || !window.firebase || !window.firebase.firestore) return null;
    return window.firebase.firestore();
  }

  /**
   * Firestore sorusunu mobil quiz formatına dönüştürür.
   * schemaVersion 1/2 uyumlu: options string[] veya object[] desteklenir.
   * @param {object} fsQuestion - Firestore doc data
   * @returns {{ q: string, options: string[], answer: string, explain: string, questionImage?: string, questionVideoUrl?: string }}
   */
  function transformFsQuestionToMobile(fsQuestion) {
    var data = fsQuestion && typeof fsQuestion === 'object' ? fsQuestion : {};
    var rawOpts = Array.isArray(data.options) ? data.options : [];
    var options = rawOpts.map(function (o) {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object') {
        var text = (o.text != null ? String(o.text).trim() : '');
        var imageUrl = (o.imageUrl && typeof o.imageUrl === 'string') ? o.imageUrl.trim() : null;
        if (imageUrl) return { text: text, imageUrl: imageUrl };
        return text;
      }
      return '';
    });
    var correctOption = (data.correctOption || 'A').toString().trim().toUpperCase().charAt(0);
    if (!['A','B','C','D'].includes(correctOption)) correctOption = 'A';
    var questionImage = (data.questionImage || (data.mediaType === 'image' ? data.mediaUrl : null) || '').toString().trim() || null;
    var questionVideoUrl = (data.questionVideoUrl || (data.mediaType === 'video' ? data.mediaUrl : null) || '').toString().trim() || null;
    var out = {
      q: (data.prompt || '').toString().trim() || '(Soru metni yok)',
      options: options,
      answer: correctOption,
      explain: (data.explanation || '').toString().trim() || ''
    };
    if (questionImage) out.questionImage = questionImage;
    if (questionVideoUrl) out.questionVideoUrl = questionVideoUrl;
    var mediaType = (data.mediaType && typeof data.mediaType === 'string') ? data.mediaType.trim().toLowerCase() : null;
    var mediaUrl = (data.mediaUrl && typeof data.mediaUrl === 'string') ? data.mediaUrl.trim() : null;
    if (mediaType && mediaType !== 'none') out.mediaType = mediaType;
    if (mediaUrl) out.mediaUrl = mediaUrl;
    return out;
  }

  /**
   * tenantExams/SHARED_EXAM_TENANT_ID/exams koleksiyonundan status=published sınavları yükler.
   * Ortak sınav kaynağı kullanılır; seçili kurumdan bağımsızdır.
   * @param {string} [tenantId] - Yoksayılır; her zaman SHARED_EXAM_TENANT_ID kullanılır
   * @param {string} [category] - standard, motor_tech, traffic_ethics, first_aid, traffic_env
   * @returns {Promise<Array<{examId:string,title:string,source:'firestore',...}>>}
   */
  async function loadExams(tenantId, category) {
    // #region agent log
    fetch('http://127.0.0.1:7736/ingest/cd372bb6-79f4-4723-9076-d91478da1094',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3ce40e'},body:JSON.stringify({sessionId:'3ce40e',runId:'tenant-debug-1',hypothesisId:'H3',location:'exam.repository.js:loadExams:entry',message:'loadExams entry',data:{tenantIdArg:tenantId?String(tenantId):null,categoryArg:category?String(category):null,sharedTenantId:SHARED_EXAM_TENANT_ID},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    var db = getFirestore();
    if (!db) return [];
    try {
      var snap = await db
        .collection('tenantExams')
        .doc(SHARED_EXAM_TENANT_ID)
        .collection('exams')
        .where('status', '==', 'published')
        .get();

      var list = [];
      snap.docs.forEach(function (doc) {
        var d = doc.data() || {};
        list.push({
          examId: doc.id,
          examKey: doc.id,
          title: (d.title || '').toString().trim() || doc.id,
          description: (d.description || '').toString().trim() || '',
          category: (d.category || '').toString().trim() || null,
          source: 'firestore',
          sub: 'Firestore',
          file: '#',
          icon: '📝'
        });
      });

      if (category && typeof category === 'string' && category.trim()) {
        var cat = category.trim().toLowerCase();
        list = list.filter(function (e) {
          var c = (e.category || '').toLowerCase();
          return c === cat;
        });
      }
      // #region agent log
      fetch('http://127.0.0.1:7736/ingest/cd372bb6-79f4-4723-9076-d91478da1094',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3ce40e'},body:JSON.stringify({sessionId:'3ce40e',runId:'tenant-debug-1',hypothesisId:'H3',location:'exam.repository.js:loadExams:success',message:'loadExams return list',data:{tenantIdArg:tenantId?String(tenantId):null,categoryArg:category?String(category):null,resultCount:Array.isArray(list)?list.length:null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return list;
    } catch (e) {
      console.warn('[SA_EXAM_REPO] loadExams error:', e && e.message ? e.message : e);
      // #region agent log
      fetch('http://127.0.0.1:7736/ingest/cd372bb6-79f4-4723-9076-d91478da1094',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3ce40e'},body:JSON.stringify({sessionId:'3ce40e',runId:'tenant-debug-1',hypothesisId:'H3',location:'exam.repository.js:loadExams:error',message:'loadExams caught error',data:{tenantIdArg:tenantId?String(tenantId):null,categoryArg:category?String(category):null,error:(e&&e.message)?String(e.message):String(e)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return [];
    }
  }

  /**
   * tenantExams/SHARED_EXAM_TENANT_ID/questions koleksiyonundan examKey=eşleşen soruları yükler.
   * Ortak sınav kaynağı kullanılır; seçili kurumdan bağımsızdır.
   * @param {string} [tenantId] - Yoksayılır; her zaman SHARED_EXAM_TENANT_ID kullanılır
   * @param {string} examId
   * @returns {Promise<Array<{q,options,answer,explain}>>}
   */
  async function loadQuestions(tenantId, examId) {
    var db = getFirestore();
    if (!db || !examId) return [];
    try {
      var snap = await db
        .collection('tenantExams')
        .doc(SHARED_EXAM_TENANT_ID)
        .collection('questions')
        .where('examKey', '==', String(examId).trim())
        .get();

      var raw = snap.docs.map(function (doc) {
        return { id: doc.id, order: (doc.data().order != null ? Number(doc.data().order) : 999), data: doc.data() };
      });
      raw.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

      return raw.map(function (r) { return transformFsQuestionToMobile(r.data); }).filter(function (q) { return q.q; });
    } catch (e) {
      console.warn('[SA_EXAM_REPO] loadQuestions error:', e && e.message ? e.message : e);
      return [];
    }
  }

  window.SA_EXAM_REPO = {
    loadExams: loadExams,
    loadQuestions: loadQuestions,
    transformFsQuestionToMobile: transformFsQuestionToMobile
  };
})();
