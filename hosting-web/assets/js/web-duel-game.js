/**
 * Web duel game page controller — oyun.html (W3).
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-duel-game]';
  var REVIEW_CACHE_PREFIX = 'sa_duel_review_';

  var duelId = '';
  var myUid = '';
  var opponentUid = '';
  var opponentName = 'Rakip';
  var duelUnsub = null;
  var resultsUnsub = null;
  var quizStarted = false;
  var resultSubmitted = false;
  var resolutionHandled = false;

  function $(id) {
    return document.getElementById(id);
  }

  function showPanel(id) {
    var panels = [
      'duel-game-loading',
      'duel-game-denied',
      'duel-game-error',
      'duel-game-preparing',
      'duel-game-waiting',
      'exam-runner-solving',
      'exam-runner-result'
    ];
    panels.forEach(function (pid) {
      var el = $(pid);
      if (!el) return;
      if (pid === id) {
        el.hidden = false;
        el.removeAttribute('aria-hidden');
      } else {
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function showErrorMessage(msg) {
    var text = $('duel-game-error-text');
    if (text) text.textContent = msg || 'Düello yüklenemedi.';
    showPanel('duel-game-error');
  }

  function showDenied(msg) {
    var text = $('duel-game-denied-text');
    if (text) text.textContent = msg || 'Bu düello oturumuna katılamazsınız.';
    showPanel('duel-game-denied');
  }

  function parseDuelId() {
    try {
      var params = new URLSearchParams(window.location.search);
      return String(params.get('duelId') || '').trim();
    } catch (_) {
      return '';
    }
  }

  function getSessionApi() {
    return window.SA_WEB_DUEL_SESSION || null;
  }

  function getPresenceApi() {
    return window.SA_WEB_DUEL_PRESENCE || null;
  }

  function getRunner() {
    return window.SA_WEB_EXAM_RUNNER || null;
  }

  function getExamRepo() {
    return window.SA_WEB_EXAM_REPO || null;
  }

  function saveReviewCache(id, snapshot) {
    try {
      sessionStorage.setItem(REVIEW_CACHE_PREFIX + id, JSON.stringify(snapshot));
    } catch (_) {}
  }

  function loadReviewCache(id) {
    try {
      var raw = sessionStorage.getItem(REVIEW_CACHE_PREFIX + id);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function resolveOpponent(duel) {
    if (!duel || !myUid) return;
    opponentUid =
      duel.playerA === myUid
        ? duel.playerB
        : duel.playerB === myUid
          ? duel.playerA
          : '';
    if (!opponentUid) {
      console.warn(
        LOG_PREFIX + ' resolveOpponent failed',
        'myUid=' + myUid,
        'playerA=' + (duel.playerA || ''),
        'playerB=' + (duel.playerB || '')
      );
    }
  }

  function setOpponentName(name) {
    if (name && String(name).trim()) opponentName = String(name).trim();
    var el = $('duel-game-opponent-name');
    if (el) el.textContent = opponentName;
  }

  function cleanupSubscriptions() {
    if (typeof duelUnsub === 'function') {
      try {
        duelUnsub();
      } catch (_) {}
    }
    duelUnsub = null;
    if (typeof resultsUnsub === 'function') {
      try {
        resultsUnsub();
      } catch (_) {}
    }
    resultsUnsub = null;
  }

  async function loadQuestions(examId) {
    var repo = getExamRepo();
    if (!repo || typeof repo.loadQuestions !== 'function') {
      return { ok: false, error: 'exam_repo_missing' };
    }
    return repo.loadQuestions(examId);
  }

  function startQuiz(duel, examInfo, questions) {
    if (quizStarted) return;
    var runner = getRunner();
    if (!runner || typeof runner.startDuelSession !== 'function') {
      showErrorMessage('Sınav arayüzü yüklenemedi.');
      return;
    }

    quizStarted = true;
    showPanel('exam-runner-solving');

    runner.startDuelSession({
      duelId: duelId,
      examId: examInfo.examId,
      examTitle: examInfo.examTitle || 'Düello Sınavı',
      category: examInfo.category || 'standard',
      timeLimit: null,
      questions: questions,
      onFinish: handleDuelFinish
    });
  }

  async function tryLaunchQuiz(duel) {
    if (quizStarted || resultSubmitted) return;

    var examInfo = null;
    if (duel.examId) {
      examInfo = {
        examId: duel.examId,
        examTitle: duel.examTitle,
        category: duel.category
      };
    } else {
      var session = getSessionApi();
      if (!session || typeof session.ensureDuelExamAssigned !== 'function') {
        showErrorMessage('Düello oturumu hazırlanamadı.');
        return;
      }
      var assignRes = await session.ensureDuelExamAssigned(duelId);
      if (!assignRes || !assignRes.ok || !assignRes.examId) {
        showErrorMessage('Düello sınavı atanamadı.');
        return;
      }
      examInfo = assignRes;
    }

    var qRes = await loadQuestions(examInfo.examId);
    if (!qRes || !qRes.ok || !qRes.questions || !qRes.questions.length) {
      showErrorMessage('Düello soruları yüklenemedi.');
      return;
    }

    startQuiz(duel, examInfo, qRes.questions);
  }

  function showWaiting() {
    showPanel('duel-game-waiting');
  }

  function getOutcomeFromResults(myResult, oppResult, winnerUid) {
    var session = getSessionApi();
    if (session && typeof session.getDuelOutcome === 'function') {
      return session.getDuelOutcome(myUid, winnerUid);
    }
    var myScore = Number(myResult && myResult.score || 0);
    var oppScore = Number(oppResult && oppResult.score || 0);
    if (myScore > oppScore) return 'win';
    if (myScore < oppScore) return 'lose';
    return 'draw';
  }

  async function handleResolution(duel, resultsByUid) {
    if (resolutionHandled) return;
    var session = getSessionApi();
    if (!session) return;

    var pA = duel.playerA;
    var pB = duel.playerB;
    if (!resultsByUid[pA] || !resultsByUid[pB]) return;

    if (duel.resultStatus !== 'resolved') {
      await session.resolveDuelResultFromDocs(duelId);
    }

    var duelRes = await session.getDuel(duelId);
    var finalDuel = (duelRes && duelRes.ok && duelRes.duel) || duel;

    await session.updateOwnLeagueStats(duelId, myUid, finalDuel.winnerUid);

    resolutionHandled = true;

    var myResult = resultsByUid[myUid] || {};
    var oppResult = resultsByUid[opponentUid] || {};
    var outcome = getOutcomeFromResults(myResult, oppResult, finalDuel.winnerUid);

    var runner = getRunner();
    if (!runner) return;

    var cache = loadReviewCache(duelId);
    if (cache && typeof runner.restoreDuelReviewSnapshot === 'function') {
      runner.restoreDuelReviewSnapshot(cache);
    }

    if (typeof runner.renderDuelResolvedResult === 'function') {
      runner.renderDuelResolvedResult({
        outcome: outcome,
        my: myResult,
        opponent: oppResult,
        opponentName: opponentName
      });
      showPanel('exam-runner-result');
    }
  }

  function bindResultsWatcher(duel) {
    var session = getSessionApi();
    if (!session || typeof session.subscribeDuelResults !== 'function') return;

    if (resultsUnsub) {
      try {
        resultsUnsub();
      } catch (_) {}
    }

    resultsUnsub = session.subscribeDuelResults(duelId, function (snap) {
      if (!snap || !snap.ok) return;
      var resultsByUid = snap.resultsByUid || {};

      if (resultSubmitted && resultsByUid[myUid] && resultsByUid[opponentUid]) {
        handleResolution(duel, resultsByUid);
        return;
      }

      if (resultSubmitted && resultsByUid[myUid] && !resultsByUid[opponentUid]) {
        showWaiting();
      }

      if (duel.resultStatus === 'resolved' && resultsByUid[myUid] && resultsByUid[opponentUid]) {
        handleResolution(duel, resultsByUid);
      }
    });
  }

  async function handleDuelFinish(result) {
    if (resultSubmitted) return;
    resultSubmitted = true;

    var session = getSessionApi();
    if (!session || typeof session.submitDuelResult !== 'function') {
      showErrorMessage('Düello sonucu kaydedilemedi.');
      return;
    }

    var runner = getRunner();
    if (runner && typeof runner.getDuelReviewSnapshot === 'function') {
      saveReviewCache(duelId, runner.getDuelReviewSnapshot());
    }

    var submitRes = await session.submitDuelResult(duelId, myUid, result);
    if (!submitRes || !submitRes.ok) {
      resultSubmitted = false;
      showErrorMessage('Düello sonucu kaydedilemedi.');
      return;
    }

    showWaiting();

    var duelRes = await session.getDuel(duelId);
    if (duelRes && duelRes.ok && duelRes.duel) {
      bindResultsWatcher(duelRes.duel);
      var snap = await new Promise(function (resolve) {
        var unsub = session.subscribeDuelResults(duelId, function (r) {
          if (typeof unsub === 'function') unsub();
          resolve(r);
        });
      });
      if (snap && snap.ok) {
        var resultsByUid = snap.resultsByUid || {};
        if (resultsByUid[myUid] && resultsByUid[opponentUid]) {
          await handleResolution(duelRes.duel, resultsByUid);
        }
      }
    }
  }

  function fetchResultsSnapshotOnce() {
    var session = getSessionApi();
    if (!session || typeof session.subscribeDuelResults !== 'function') {
      return Promise.resolve({ ok: true, resultsByUid: {} });
    }

    return new Promise(function (resolve) {
      var settled = false;
      var unsub = session.subscribeDuelResults(duelId, function (snap) {
        if (settled) return;
        settled = true;
        if (typeof unsub === 'function') {
          try {
            unsub();
          } catch (_) {}
        }
        resolve(snap || { ok: true, resultsByUid: {} });
      });
      window.setTimeout(function () {
        if (settled) return;
        settled = true;
        if (typeof unsub === 'function') {
          try {
            unsub();
          } catch (_) {}
        }
        resolve({ ok: true, resultsByUid: {} });
      }, 4000);
    });
  }

  async function resumeFromExistingState(duel) {
    var session = getSessionApi();
    if (!session) return false;

    resolveOpponent(duel);

    var resultsSnap = await fetchResultsSnapshotOnce();
    var resultsByUid = (resultsSnap && resultsSnap.resultsByUid) || {};

    if (duel.resultStatus === 'resolved' && resultsByUid[myUid] && resultsByUid[opponentUid]) {
      await handleResolution(duel, resultsByUid);
      return true;
    }

    if (resultsByUid[myUid]) {
      resultSubmitted = true;
      if (resultsByUid[opponentUid]) {
        await handleResolution(duel, resultsByUid);
      } else {
        showWaiting();
        bindResultsWatcher(duel);
      }
      return true;
    }

    return false;
  }

  function subscribeDuelDoc() {
    var session = getSessionApi();
    if (!session || typeof session.subscribeDuel !== 'function') return;

    showPanel('duel-game-preparing');

    duelUnsub = session.subscribeDuel(duelId, function (res) {
      if (!res || !res.ok || !res.duel) {
        if (res && res.reason === 'duel_missing') {
          showErrorMessage('Düello oturumu bulunamadı.');
        }
        return;
      }

      var duel = res.duel;
      resolveOpponent(duel);

      if (duel.resultStatus === 'resolved') {
        resumeFromExistingState(duel);
        return;
      }

      if (!quizStarted && !resultSubmitted) {
        tryLaunchQuiz(duel);
      }
    });
  }

  async function bootstrap() {
    duelId = parseDuelId();
    if (!duelId) {
      showErrorMessage('Geçersiz düello bağlantısı.');
      return;
    }

    showPanel('duel-game-loading');

    var session = getSessionApi();
    var presence = getPresenceApi();
    if (!session) {
      showErrorMessage('Düello modülü yüklenemedi.');
      return;
    }

    myUid = session.getAuthUid ? session.getAuthUid() : '';
    if (!myUid && presence && typeof presence.resolveDuelContext === 'function') {
      var ctx = presence.resolveDuelContext();
      if (ctx && ctx.uid) myUid = ctx.uid;
    }

    if (!myUid) {
      showDenied('Düelloya katılmak için giriş yapmalısınız.');
      return;
    }

    var duelRes = await session.getDuel(duelId);
    if (!duelRes || !duelRes.ok || !duelRes.duel) {
      showErrorMessage('Düello oturumu bulunamadı.');
      return;
    }

    var duel = duelRes.duel;
    if (duel.playerA !== myUid && duel.playerB !== myUid) {
      showDenied();
      return;
    }

    resolveOpponent(duel);
    setOpponentName(opponentName);

    var resumed = await resumeFromExistingState(duel);
    if (resumed) {
      subscribeDuelDoc();
      return;
    }

    subscribeDuelDoc();
  }

  function bootstrapViaViewer() {
    var viewer = window.SA_VIEWER_CONTEXT;
    if (!viewer || typeof viewer.whenReady !== 'function') {
      showErrorMessage('Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.');
      return;
    }

    viewer.whenReady().then(function (ctx) {
      if (!ctx || ctx.kind === 'error') {
        showErrorMessage('Oturum doğrulanamadı. Sayfayı yenileyerek tekrar deneyin.');
        return;
      }
      if (ctx.kind === 'guest') {
        showDenied('Düelloya katılmak için giriş yapmalısınız.');
        return;
      }
      bootstrap();
    });
  }

  function init() {
    if (!document.body || !document.body.classList.contains('page-duel-game')) return;
    bootstrapViaViewer();
    window.addEventListener('pagehide', cleanupSubscriptions);
    window.addEventListener('beforeunload', cleanupSubscriptions);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
