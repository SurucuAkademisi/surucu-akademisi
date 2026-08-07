/**
 * Web exam runner — read-only solve flow (no persistence).
 */
(function () {
  'use strict';

  var SESSION_EXAM_ID_KEY = 'sa_web_exam_id';
  var SESSION_CATEGORY_KEY = 'sa_web_exam_list_category';

  var state = {
    mode: 'normal',
    duelId: '',
    onDuelFinish: null,
    duelFinishInFlight: false,
    examId: '',
    exam: null,
    questions: [],
    answers: [],
    currentIndex: 0,
    phase: 'idle',
    timerTotalSeconds: 0,
    timerRemainingSeconds: 0,
    timerIntervalId: null,
    timerStartedAt: null,
    timerExpiredAutoFinish: false,
    attemptSaveStarted: false,
    attemptSaved: false
  };

  function isDuelMode() {
    return state.mode === 'duel';
  }

  function isVideoAnimationMode() {
    return String(state.exam && state.exam.category ? state.exam.category : '').toLowerCase() === 'video_animation';
  }

  function getVideoAnimationListUrl() {
    try {
      var listUrl = new URL('./list.html', window.location.href);
      listUrl.searchParams.set('category', 'video_animation');
      return listUrl.href;
    } catch (_) {
      return 'list.html?category=video_animation';
    }
  }

  function clearVideoModeChrome() {
    document.body.classList.remove('exam-runner-video-mode');
    var returnBtn = $('exam-runner-return-list-btn');
    if (returnBtn) hide(returnBtn);
  }

  function applyVideoModeChrome() {
    document.body.classList.add('exam-runner-video-mode');
    hide($('exam-runner-timer'));
    var returnBtn = $('exam-runner-return-list-btn');
    if (returnBtn) {
      returnBtn.href = getVideoAnimationListUrl();
      show(returnBtn);
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function show(el) {
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('aria-hidden');
  }

  function hide(el) {
    if (!el) return;
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
  }

  function hideAllPanels() {
    hide($('exam-runner-intro'));
    hide($('exam-runner-solving'));
    hide($('exam-runner-result'));
    hide($('exam-runner-guest-cta'));
    hide($('exam-runner-error'));
  }

  function resolveExamId() {
    try {
      var params = new URLSearchParams(window.location.search);
      var fromUrl = String(params.get('examId') || '').trim();
      if (fromUrl) return fromUrl;
    } catch (_) {}
    try {
      return String(sessionStorage.getItem(SESSION_EXAM_ID_KEY) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function getRepo() {
    return window.SA_WEB_EXAM_REPO || null;
  }

  function getCatalog() {
    return window.SA_WEB_EXAM_CATALOG || null;
  }

  function categoryLabel(key) {
    var catalog = getCatalog();
    if (!catalog || !catalog.getCategoryByKey) return key || '';
    var cat = catalog.getCategoryByKey(key);
    return cat ? cat.title : (key || '');
  }

  function formatTimeLimit(minutes) {
    var n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) return '';
    return n + ' dakika';
  }

  function resolveExamDurationSeconds(exam) {
    var n = exam && exam.timeLimit != null ? Number(exam.timeLimit) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.floor(n * 60);
    return 45 * 60;
  }

  function formatTimerDisplay(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var mm = String(Math.floor(s / 60));
    var ss = String(s % 60);
    if (mm.length < 2) mm = '0' + mm;
    if (ss.length < 2) ss = '0' + ss;
    return mm + ':' + ss;
  }

  function updateTimerDisplay() {
    var el = $('exam-runner-timer');
    if (!el) return;
    el.textContent = formatTimerDisplay(state.timerRemainingSeconds);
    el.classList.remove('exam-runner-timer--warn', 'exam-runner-timer--danger');
    if (state.timerRemainingSeconds <= 60) {
      el.classList.add('exam-runner-timer--danger');
    } else if (state.timerRemainingSeconds <= 300) {
      el.classList.add('exam-runner-timer--warn');
    }
  }

  function stopExamTimer() {
    if (state.timerIntervalId) {
      clearInterval(state.timerIntervalId);
      state.timerIntervalId = null;
    }
    var el = $('exam-runner-timer');
    if (el) hide(el);
  }

  function resetTimerState() {
    stopExamTimer();
    state.timerTotalSeconds = 0;
    state.timerRemainingSeconds = 0;
    state.timerStartedAt = null;
    state.timerExpiredAutoFinish = false;
  }

  function handleTimeExpired() {
    if (isVideoAnimationMode()) return;
    if (state.phase === 'result') return;
    stopExamTimer();
    state.timerRemainingSeconds = 0;
    state.timerExpiredAutoFinish = true;
    closeFinishModal();
    finishExam();
  }

  function startExamTimer() {
    if (isVideoAnimationMode()) return;
    stopExamTimer();
    var total = resolveExamDurationSeconds(state.exam);
    state.timerTotalSeconds = total;
    state.timerRemainingSeconds = total;
    state.timerStartedAt = Date.now();
    state.timerExpiredAutoFinish = false;
    var el = $('exam-runner-timer');
    if (el) {
      show(el);
      updateTimerDisplay();
    }
    state.timerIntervalId = setInterval(function () {
      if (state.phase !== 'solving') return;
      state.timerRemainingSeconds--;
      updateTimerDisplay();
      if (state.timerRemainingSeconds <= 0) {
        handleTimeExpired();
      }
    }, 1000);
  }

  function youtubeEmbedUrl(url) {
    var raw = String(url || '').trim();
    if (!raw) return '';
    var id = '';
    try {
      if (raw.indexOf('youtu.be/') !== -1) {
        id = raw.split('youtu.be/')[1].split(/[?&#]/)[0];
      } else if (raw.indexOf('youtube.com') !== -1) {
        var u = new URL(raw);
        id = u.searchParams.get('v') || '';
        if (!id && u.pathname.indexOf('/embed/') !== -1) {
          id = u.pathname.split('/embed/')[1].split('/')[0];
        }
      }
    } catch (_) {}
    if (!id) return '';
    return 'https://www.youtube.com/embed/' + encodeURIComponent(id);
  }

  function findOptionByKey(q, key) {
    if (!key || !q || !q.options) return null;
    return (q.options || []).find(function (o) {
      return o.key === key;
    }) || null;
  }

  function renderOptionImageHtml(imageUrl, imgClass) {
    var cls = imgClass || 'exam-runner-option__img';
    return (
      '<span class="exam-option-media">' +
      '<img class="' + cls + '" src="' + escapeHtml(imageUrl) + '" alt="" loading="lazy" decoding="async" />' +
      '<span class="exam-option-media__fallback" hidden>Görsel yüklenemedi</span>' +
      '</span>'
    );
  }

  function renderOptionContent(opt, opts) {
    var options = opts || {};
    var compact = !!options.compact;
    var imgClass = compact ? 'exam-review-option__img' : 'exam-runner-option__img';
    var html = '<div class="exam-option-content">';
    if (opt && opt.imageUrl) {
      html += renderOptionImageHtml(opt.imageUrl, imgClass);
    }
    if (opt && opt.text) {
      html += '<span class="exam-option-content__text">' + escapeHtml(opt.text) + '</span>';
    }
    html += '</div>';
    return html;
  }

  function bindBrokenOptionImages(root) {
    if (!root) return;
    root.querySelectorAll('.exam-option-media img').forEach(function (img) {
      if (img.dataset.boundError) return;
      img.dataset.boundError = '1';
      img.addEventListener('error', function () {
        img.hidden = true;
        var wrap = img.closest('.exam-option-media');
        var fallback = wrap && wrap.querySelector('.exam-option-media__fallback');
        if (fallback) fallback.hidden = false;
      });
    });
  }

  function bindBrokenQuestionImages(root) {
    if (!root) return;
    root.querySelectorAll('.exam-runner-media img').forEach(function (img) {
      if (img.dataset.boundError) return;
      img.dataset.boundError = '1';
      img.addEventListener('error', function () {
        img.hidden = true;
        var figure = img.closest('.exam-runner-media');
        if (!figure || figure.querySelector('.exam-runner-media__fallback')) return;
        var p = document.createElement('p');
        p.className = 'exam-runner-media__fallback';
        p.textContent = 'Görsel yüklenemedi';
        figure.appendChild(p);
      });
    });
  }

  function renderReviewAnswerBlock(label, q, answerLetter, modifier) {
    var mod = modifier ? ' ' + modifier : '';
    var html = '<div class="exam-review-answer exam-review-answer' + mod + '">';
    html += '<span class="exam-review-answer__label">' + escapeHtml(label) + '</span>';
    html += '<div class="exam-review-answer__body">';
    if (!answerLetter) {
      html += '<span class="exam-review-answer__empty">Boş</span>';
    } else {
      html += '<span class="exam-review-answer__letter">' + escapeHtml(answerLetter) + '</span>';
      var opt = findOptionByKey(q, answerLetter);
      if (opt) {
        html += renderOptionContent(opt, { compact: true });
      }
    }
    html += '</div></div>';
    return html;
  }

  function renderQuestionMedia(q) {
    var html = '';
    var imgUrl = (q.questionImage || '').trim();
    if (!imgUrl && q.mediaType === 'image' && q.mediaUrl) imgUrl = q.mediaUrl.trim();
    if (imgUrl) {
      html += '<figure class="exam-runner-media exam-runner-media--image exam-runner-media--bounded">';
      html += '<img src="' + escapeHtml(imgUrl) + '" alt="" loading="lazy" decoding="async" />';
      html += '</figure>';
    }
    var videoUrl = (q.questionVideoUrl || '').trim();
    if (!videoUrl && q.mediaType === 'video' && q.mediaUrl) videoUrl = q.mediaUrl.trim();
    if (videoUrl) {
      var embed = youtubeEmbedUrl(videoUrl);
      html += '<figure class="exam-runner-media exam-runner-media--video">';
      if (embed) {
        html += '<iframe src="' + escapeHtml(embed) + '" title="Soru videosu" allowfullscreen loading="lazy"></iframe>';
      } else {
        html += '<a class="exam-runner-video-link" href="' + escapeHtml(videoUrl) + '" target="_blank" rel="noopener noreferrer">Videoyu aç</a>';
      }
      html += '</figure>';
    }
    return html;
  }

  function renderIntro() {
    clearVideoModeChrome();
    var exam = state.exam;
    var catalog = getCatalog();
    hideAllPanels();
    show($('exam-runner-intro'));

    var introTitle = $('exam-runner-intro-title');
    if (introTitle) {
      introTitle.textContent = exam.title || exam.examId;
      introTitle.setAttribute('aria-current', 'page');
    }
    $('exam-runner-intro-category').textContent = categoryLabel(exam.category) || '';

    var meta = [];
    meta.push('<li><strong>Soru sayısı:</strong> ' + state.questions.length + '</li>');
    var timeText = formatTimeLimit(exam.timeLimit);
    if (timeText) meta.push('<li><strong>Süre:</strong> ' + escapeHtml(timeText) + ' (bilgi amaçlı)</li>');
    if (exam.description) meta.push('<li>' + escapeHtml(exam.description) + '</li>');
    $('exam-runner-intro-meta').innerHTML = meta.join('');
  }

  function isQuestionAnswered(index) {
    var a = state.answers[index];
    return !!(a && String(a).trim());
  }

  function normalizeAnswerLetter(letter) {
    var L = String(letter || '').trim().toUpperCase().charAt(0);
    if (L >= 'A' && L <= 'D') return L;
    return '';
  }

  function applySolvingFeedback(q, userLetter) {
    var correctLetter = normalizeAnswerLetter(q.answer) || 'A';
    var user = normalizeAnswerLetter(userLetter);
    return {
      correctLetter: correctLetter,
      userLetter: user,
      isCorrect: user === correctLetter,
      optionClass: function (key) {
        var parts = [];
        if (key === correctLetter) parts.push('exam-runner-option--correct');
        if (user && key === user && user !== correctLetter) parts.push('exam-runner-option--wrong');
        return parts.join(' ');
      }
    };
  }

  function renderSolvingExplainPanel(q) {
    var exp = (q.explain && String(q.explain).trim()) || '';
    if (!exp) return '';
    return (
      '<div class="exam-runner-solve-explain">' +
      '<span class="exam-runner-solve-explain__label">Açıklama</span>' +
      '<p class="exam-runner-solve-explain__text">' + escapeHtml(exp) + '</p>' +
      '</div>'
    );
  }

  function renderSolvingAnswerBadge(correctLetter) {
    if (!correctLetter) return '';
    return (
      '<div class="exam-runner-answer-badge" aria-live="polite">' +
      'Doğru cevap: <strong>' + escapeHtml(correctLetter) + '</strong>' +
      '</div>'
    );
  }

  function selectSolvingOption(optionKey) {
    if (isQuestionAnswered(state.currentIndex)) return;
    var key = String(optionKey || '').trim().toUpperCase().charAt(0);
    if (!key || key < 'A' || key > 'D') return;
    state.answers[state.currentIndex] = key;
    renderSolvingQuestion();
  }

  function renderSolvingQuestion() {
    var q = state.questions[state.currentIndex];
    if (!q) return;

    var total = state.questions.length;
    var idx = state.currentIndex;
    $('exam-runner-solving-title').textContent = state.exam.title || 'Sınav';
    if (isVideoAnimationMode()) {
      $('exam-runner-progress').textContent = 'Soru 1';
    } else {
      $('exam-runner-progress').textContent = 'Soru ' + (idx + 1) + ' / ' + total;
    }

    var answered = isQuestionAnswered(idx);
    var userLetter = answered ? state.answers[idx] : '';
    var feedback = answered && !isDuelMode() ? applySolvingFeedback(q, userLetter) : null;
    var duelMode = isDuelMode();

    var html = '';
    html += '<p class="exam-runner-question__text">' + escapeHtml(q.q) + '</p>';
    html += renderQuestionMedia(q);
    html += '<div class="exam-runner-options" role="listbox" aria-label="Cevap seçenekleri">';
    q.options.forEach(function (opt) {
      if (!opt.text && !opt.imageUrl) return;
      var optClass = 'exam-runner-option';
      if (answered) {
        optClass += ' exam-runner-option--locked';
        if (duelMode) {
          if (normalizeAnswerLetter(opt.key) === normalizeAnswerLetter(userLetter)) {
            optClass += ' exam-runner-option--selected';
          }
        } else if (feedback) {
          var fbClass = feedback.optionClass(opt.key);
          if (fbClass) optClass += ' ' + fbClass;
        }
      }
      html += '<button type="button" class="' + optClass + '" data-option-key="' + escapeHtml(opt.key) + '"' + (answered ? ' disabled' : '') + '>';
      html += '<span class="exam-runner-option__key">' + escapeHtml(opt.key) + '</span>';
      html += renderOptionContent(opt);
      html += '</button>';
    });
    html += '</div>';
    if (answered && feedback) {
      html += renderSolvingAnswerBadge(feedback.correctLetter);
      html += renderSolvingExplainPanel(q);
    }
    var questionRoot = $('exam-runner-question');
    questionRoot.innerHTML = html;
    bindBrokenOptionImages(questionRoot);
    bindBrokenQuestionImages(questionRoot);

    if (!answered) {
      questionRoot.querySelectorAll('.exam-runner-option[data-option-key]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectSolvingOption(btn.getAttribute('data-option-key'));
        });
      });
    }

    if (!isVideoAnimationMode()) {
      $('exam-runner-prev-btn').disabled = idx <= 0;
      $('exam-runner-next-btn').hidden = idx >= total - 1;
      $('exam-runner-finish-btn').hidden = idx < total - 1;
    }
  }

  function showSolving() {
    hideAllPanels();
    show($('exam-runner-solving'));
    renderSolvingQuestion();
  }

  function computeResults() {
    var correct = 0;
    var wrong = 0;
    var blank = 0;
    var total = state.questions.length;
    var details = [];

    state.questions.forEach(function (q, i) {
      var user = state.answers[i] || '';
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
    return { correct: correct, wrong: wrong, blank: blank, total: total, percentage: percentage, details: details };
  }

  function reviewStatusBadge(d) {
    if (d.isBlank) return '<span class="exam-review-badge exam-review-badge--blank">Boş</span>';
    if (d.isCorrect) return '<span class="exam-review-badge exam-review-badge--correct">Doğru</span>';
    return '<span class="exam-review-badge exam-review-badge--wrong">Yanlış</span>';
  }

  function buildDuelOutcomeBanner(outcomeData) {
    var data = outcomeData || {};
    var outcome = data.outcome || 'draw';
    var statusText = 'Berabere';
    var statusClass = 'duel-outcome-badge--draw';
    if (outcome === 'win') {
      statusText = 'Kazandın';
      statusClass = 'duel-outcome-badge--win';
    } else if (outcome === 'lose') {
      statusText = 'Kaybettin';
      statusClass = 'duel-outcome-badge--lose';
    }

    var my = data.my || {};
    var opp = data.opponent || {};
    var oppName = escapeHtml(data.opponentName || 'Rakip');

    return (
      '<div class="duel-outcome-card">' +
      '<p class="duel-outcome-card__label">Düello Sonucu</p>' +
      '<p class="duel-outcome-badge ' + statusClass + '">' + escapeHtml(statusText) + '</p>' +
      '<p class="duel-outcome-card__vs">Sen vs ' + oppName + '</p>' +
      '<div class="duel-outcome-scores">' +
      '<div class="duel-outcome-score"><span class="duel-outcome-score__label">Sen</span><span class="duel-outcome-score__value">%' +
      escapeHtml(String(my.score != null ? my.score : 0)) +
      '</span></div>' +
      '<div class="duel-outcome-score"><span class="duel-outcome-score__label">Rakip</span><span class="duel-outcome-score__value">%' +
      escapeHtml(String(opp.score != null ? opp.score : 0)) +
      '</span></div>' +
      '</div></div>'
    );
  }

  function renderResult() {
    if (isVideoAnimationMode()) return;
    var res = computeResults();
    hideAllPanels();
    show($('exam-runner-result'));

    var summaryHtml =
      '<div class="exam-runner-summary__grid">' +
      '<div class="exam-runner-stat exam-runner-stat--correct"><span class="exam-runner-stat__value">' + res.correct + '</span><span class="exam-runner-stat__label">Doğru</span></div>' +
      '<div class="exam-runner-stat exam-runner-stat--wrong"><span class="exam-runner-stat__value">' + res.wrong + '</span><span class="exam-runner-stat__label">Yanlış</span></div>' +
      '<div class="exam-runner-stat exam-runner-stat--blank"><span class="exam-runner-stat__value">' + res.blank + '</span><span class="exam-runner-stat__label">Boş</span></div>' +
      '<div class="exam-runner-stat exam-runner-stat--pct"><span class="exam-runner-stat__value">%' + res.percentage + '</span><span class="exam-runner-stat__label">Başarı</span></div>' +
      '</div>';
    if (state.timerExpiredAutoFinish) {
      summaryHtml += '<p class="exam-runner-result__expired-note">Süre dolduğu için sınav otomatik bitirildi.</p>';
    }
    if (state.timerStartedAt && state.timerTotalSeconds > 0) {
      var elapsed = state.timerTotalSeconds - Math.max(0, state.timerRemainingSeconds);
      summaryHtml += '<p class="exam-runner-result__elapsed">Geçen süre: ' + escapeHtml(formatTimerDisplay(elapsed)) + '</p>';
    }
    $('exam-runner-summary').innerHTML = summaryHtml;

    var reviewHtml = '<ol class="exam-runner-review-list">';
    res.details.forEach(function (d) {
      var statusClass = d.isBlank ? 'exam-review-item--blank' : (d.isCorrect ? 'exam-review-item--correct' : 'exam-review-item--wrong');
      reviewHtml += '<li class="exam-review-item ' + statusClass + '">';
      reviewHtml += '<div class="exam-review-item__head">';
      reviewHtml += '<span class="exam-review-item__num">Soru ' + (d.index + 1) + '</span>';
      reviewHtml += reviewStatusBadge(d);
      reviewHtml += '</div>';
      reviewHtml += '<p class="exam-review-item__q">' + escapeHtml(d.question.q) + '</p>';
      var qMedia = renderQuestionMedia(d.question);
      if (qMedia) {
        reviewHtml += '<div class="exam-review-item__media">' + qMedia + '</div>';
      }
      reviewHtml += '<div class="exam-review-answers">';
      reviewHtml += renderReviewAnswerBlock('Sizin cevabınız', d.question, d.userAnswer, '--user');
      reviewHtml += renderReviewAnswerBlock('Doğru cevap', d.question, d.correctAnswer, '--correct');
      reviewHtml += '</div>';
      if (d.question.explain) {
        reviewHtml += '<div class="exam-review-item__explain"><span class="exam-review-item__explain-label">Açıklama</span><p>' + escapeHtml(d.question.explain) + '</p></div>';
      }
      reviewHtml += '</li>';
    });
    reviewHtml += '</ol>';
    var reviewRoot = $('exam-runner-review');
    reviewRoot.innerHTML = reviewHtml;
    bindBrokenOptionImages(reviewRoot);
    bindBrokenQuestionImages(reviewRoot);

    var catLink = $('exam-runner-back-category');
    var catKey = '';
    try {
      catKey = String(sessionStorage.getItem(SESSION_CATEGORY_KEY) || '').trim();
    } catch (_) {}
    if (catKey) {
      try {
        var listUrl = new URL('./list.html', window.location.href);
        listUrl.searchParams.set('category', catKey);
        catLink.href = listUrl.href;
      } catch (_) {
        catLink.href = 'list.html?category=' + encodeURIComponent(catKey);
      }
    } else {
      catLink.href = 'list.html';
    }
  }

  function renderDuelResolvedResult(outcomeData) {
    renderResult();
    var summary = $('exam-runner-summary');
    if (summary) {
      summary.insertAdjacentHTML('afterbegin', buildDuelOutcomeBanner(outcomeData));
    }
    var title = document.querySelector('#exam-runner-result .exam-runner-result__title');
    if (title) title.textContent = 'Düello Sonucu';
    var backCat = $('exam-runner-back-category');
    if (backCat) {
      try {
        backCat.href = new URL('./index.html', window.location.href).href;
      } catch (_) {
        backCat.href = './index.html';
      }
      backCat.textContent = 'Düello Lobisine Dön';
    }
  }

  function beginExamAfterPreExamTransition() {
    if (isVideoAnimationMode()) return;
    state.phase = 'solving';
    startExamTimer();
    showSolving();
  }

  function beginVideoAnimationSession() {
    state.phase = 'solving';
    state.currentIndex = 0;
    resetTimerState();
    applyVideoModeChrome();
    showSolving();
  }

  function persistExamAttemptAsync() {
    if (isVideoAnimationMode()) return;
    if (isDuelMode()) return;
    if (state.attemptSaveStarted || state.attemptSaved) return;
    state.attemptSaveStarted = true;

    var attemptsApi = window.SA_WEB_EXAM_ATTEMPTS;
    if (!attemptsApi || typeof attemptsApi.saveWebExamAttempt !== 'function') {
      state.attemptSaveStarted = false;
      return;
    }

    var res = computeResults();
    var durationSeconds = 0;
    if (state.timerTotalSeconds > 0) {
      durationSeconds = state.timerTotalSeconds - Math.max(0, state.timerRemainingSeconds);
    }

    var categoryKey = '';
    try {
      categoryKey = String(sessionStorage.getItem(SESSION_CATEGORY_KEY) || '').trim();
    } catch (_) {}
    if (!categoryKey && state.exam && state.exam.category) {
      categoryKey = String(state.exam.category).trim();
    }

    var startedAt = null;
    if (state.timerStartedAt) {
      try {
        startedAt = new Date(state.timerStartedAt);
      } catch (_) {
        startedAt = null;
      }
    }

    attemptsApi
      .saveWebExamAttempt({
        examId: state.examId,
        examTitle: state.exam && state.exam.title ? state.exam.title : '',
        category: categoryKey,
        categoryLabel: categoryLabel(categoryKey),
        results: res,
        durationSeconds: durationSeconds,
        timerExpiredAutoFinish: !!state.timerExpiredAutoFinish,
        startedAt: startedAt
      })
      .then(function (result) {
        if (result && result.ok) {
          state.attemptSaved = true;
        }
      })
      .catch(function (err) {
        console.warn('[web exam attempts] save failed', err);
      });
  }

  function finishExam() {
    if (isVideoAnimationMode()) return;
    stopExamTimer();

    if (isDuelMode()) {
      if (state.duelFinishInFlight) return;
      state.duelFinishInFlight = true;
      state.phase = 'duel_submitted';

      var res = computeResults();
      if (state.timerTotalSeconds > 0) {
        res.elapsedSec = state.timerTotalSeconds - Math.max(0, state.timerRemainingSeconds);
      } else {
        res.elapsedSec = 0;
      }

      hideAllPanels();

      var handler = state.onDuelFinish;
      if (typeof handler === 'function') {
        Promise.resolve(handler(res))
          .catch(function (err) {
            console.warn('[web-exam-runner] duel finish handler failed', err);
          })
          .finally(function () {
            state.duelFinishInFlight = false;
          });
      } else {
        state.duelFinishInFlight = false;
      }
      return;
    }

    state.phase = 'result';
    persistExamAttemptAsync();
    renderResult();
  }

  function startDuelSession(opts) {
    var options = opts || {};
    var questions = Array.isArray(options.questions) ? options.questions : [];
    if (!questions.length) {
      showError('Düello soruları yüklenemedi.');
      return false;
    }

    state.mode = 'duel';
    state.duelId = String(options.duelId || '').trim();
    state.onDuelFinish = typeof options.onFinish === 'function' ? options.onFinish : null;
    state.duelFinishInFlight = false;
    state.examId = String(options.examId || '').trim();
    state.exam = {
      examId: state.examId,
      title: options.examTitle || 'Düello Sınavı',
      category: options.category || 'standard',
      timeLimit: options.timeLimit != null ? options.timeLimit : null,
      description: ''
    };
    state.questions = questions;
    state.answers = new Array(questions.length).fill('');
    state.currentIndex = 0;
    state.phase = 'solving';
    state.attemptSaveStarted = false;
    state.attemptSaved = false;
    resetTimerState();

    hide($('exam-runner-loading'));
    hideAllPanels();
    beginExamAfterPreExamTransition();
    return true;
  }

  function getPhase() {
    return state.phase;
  }

  function getDuelReviewSnapshot() {
    return {
      answers: state.answers.slice(),
      questions: state.questions,
      exam: state.exam
    };
  }

  function restoreDuelReviewSnapshot(snapshot) {
    var data = snapshot || {};
    state.mode = 'duel';
    state.questions = Array.isArray(data.questions) ? data.questions : [];
    state.answers = Array.isArray(data.answers) ? data.answers.slice() : [];
    state.exam = data.exam || { title: 'Düello Sınavı' };
    state.phase = 'result';
  }

  function openFinishModal(blankCount) {
    if (isVideoAnimationMode()) return;
    var gate = $('exam-runner-finish-gate');
    var msg = $('exam-runner-finish-gate-message');
    if (!gate) {
      finishExam();
      return;
    }
    if (msg) {
      msg.textContent = blankCount + ' soru boş. Sınavı bitirmek istediğinize emin misiniz?';
    }
    show(gate);
    document.body.classList.add('exam-finish-gate-open');
    var confirmBtn = $('exam-runner-finish-confirm');
    if (confirmBtn) confirmBtn.focus();
  }

  function closeFinishModal() {
    var gate = $('exam-runner-finish-gate');
    hide(gate);
    document.body.classList.remove('exam-finish-gate-open');
  }

  function onFinishModalConfirm() {
    closeFinishModal();
    finishExam();
  }

  function bindFinishModal() {
    var dismiss = $('exam-runner-finish-dismiss');
    var confirmBtn = $('exam-runner-finish-confirm');
    var backdrop = $('exam-runner-finish-backdrop');
    if (dismiss) dismiss.addEventListener('click', closeFinishModal);
    if (confirmBtn) confirmBtn.addEventListener('click', onFinishModalConfirm);
    if (backdrop) backdrop.addEventListener('click', closeFinishModal);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var gate = $('exam-runner-finish-gate');
      if (gate && !gate.hidden) closeFinishModal();
    });
  }

  function confirmFinish() {
    if (isVideoAnimationMode()) return;
    var blankCount = state.answers.filter(function (a) {
      return !a;
    }).length;
    if (blankCount > 0) {
      openFinishModal(blankCount);
      return;
    }
    finishExam();
  }

  function showError(msg) {
    hideAllPanels();
    hide($('exam-runner-loading'));
    var el = $('exam-runner-error');
    el.textContent = msg || 'Bir hata oluştu.';
    show(el);
  }

  function showGuest() {
    hideAllPanels();
    hide($('exam-runner-loading'));
    show($('exam-runner-guest-cta'));
  }

  function showAccessError() {
    showError('Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.');
  }

  async function loadExamData() {
    var repo = getRepo();
    if (!repo) {
      showError('Sınav modülü yüklenemedi.');
      return;
    }

    state.examId = resolveExamId();
    if (!state.examId) {
      showError('Geçersiz sınav bağlantısı.');
      return;
    }

    try {
      sessionStorage.setItem(SESSION_EXAM_ID_KEY, state.examId);
    } catch (_) {}

    show($('exam-runner-loading'));
    hideAllPanels();

    var examRes = await repo.loadPublishedExamById(state.examId);
    if (!examRes.authenticated) {
      showGuest();
      return;
    }
    if (examRes.notFound || examRes.notPublished) {
      showError(examRes.error || 'Sınav bulunamadı veya yayında değil.');
      return;
    }
    if (!examRes.ok || !examRes.exam) {
      showError(examRes.error || 'Sınav yüklenemedi.');
      return;
    }

    var qRes = await repo.loadQuestions(state.examId);
    if (!qRes.ok) {
      showError(qRes.error || 'Sorular yüklenemedi.');
      return;
    }
    if (!qRes.questions || !qRes.questions.length) {
      showError('Bu sınav için soru bulunamadı.');
      return;
    }

    clearVideoModeChrome();
    state.exam = examRes.exam;
    state.questions = qRes.questions;
    state.currentIndex = 0;
    resetTimerState();

    if (isVideoAnimationMode()) {
      state.questions = state.questions.slice(0, 1);
      state.answers = new Array(state.questions.length).fill('');
      hide($('exam-runner-loading'));
      beginVideoAnimationSession();
      return;
    }

    state.answers = new Array(state.questions.length).fill('');
    state.phase = 'intro';

    hide($('exam-runner-loading'));
    renderIntro();
  }

  function bindUi() {
    bindFinishModal();

    var startBtn = $('exam-runner-start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        beginExamAfterPreExamTransition();
      });
    }

    var prevBtn = $('exam-runner-prev-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (isVideoAnimationMode()) return;
        if (state.currentIndex > 0) {
          state.currentIndex--;
          renderSolvingQuestion();
        }
      });
    }

    var nextBtn = $('exam-runner-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (isVideoAnimationMode()) return;
        if (state.currentIndex < state.questions.length - 1) {
          state.currentIndex++;
          renderSolvingQuestion();
        }
      });
    }

    var finishBtn = $('exam-runner-finish-btn');
    if (finishBtn) {
      finishBtn.addEventListener('click', confirmFinish);
    }
  }

  function bootstrapViaViewer() {
    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showAccessError();
      return;
    }
    viewer.whenReady().then(function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showAccessError();
        return;
      }
      if (ctx.kind === 'guest') {
        showGuest();
        return;
      }
      loadExamData();
    });
  }

  function refresh() {
    bootstrapViaViewer();
  }

  function init() {
    bindUi();
    if (document.body && document.body.classList.contains('page-duel-game')) {
      return;
    }
    bootstrapViaViewer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SA_WEB_EXAM_RUNNER = {
    refresh: refresh,
    beginExamAfterPreExamTransition: beginExamAfterPreExamTransition,
    startDuelSession: startDuelSession,
    getPhase: getPhase,
    renderDuelResolvedResult: renderDuelResolvedResult,
    computeResults: computeResults,
    getDuelReviewSnapshot: getDuelReviewSnapshot,
    restoreDuelReviewSnapshot: restoreDuelReviewSnapshot
  };
})();
