const { Capacitor } = window;
const { Plugins } = window.Capacitor ?? {};
const App = Plugins?.App;
const ActionSheet = Plugins?.ActionSheet;
const AdMob = Plugins?.AdMob;

const TEST_BANNER_ANDROID = 'ca-app-pub-3940256099942544/6300978111';
const TEST_BANNER_IOS = 'ca-app-pub-3940256099942544/2934735716';
const TEST_INTERSTITIAL_ANDROID = 'ca-app-pub-3940256099942544/1033173712';
const TEST_INTERSTITIAL_IOS = 'ca-app-pub-3940256099942544/4411468910';
const TEST_REWARDED_ANDROID = 'ca-app-pub-3940256099942544/5224354917';
const TEST_REWARDED_IOS = 'ca-app-pub-3940256099942544/1712485313';

const INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000;
let lastInterstitialAt = 0;
let userInteracted = false;
let isExamActive = false;
let pendingInterstitialCooldownUpdate = false;
let activeExamSessionId = null;
let completionAdShownForSession = false;

function isNative() {
  const platform = Capacitor?.getPlatform?.();
  return platform === 'android' || platform === 'ios';
}

function getBannerAdUnitId() {
  return Capacitor?.getPlatform?.() === 'ios' ? TEST_BANNER_IOS : TEST_BANNER_ANDROID;
}

function getInterstitialAdUnitId() {
  return Capacitor?.getPlatform?.() === 'ios' ? TEST_INTERSTITIAL_IOS : TEST_INTERSTITIAL_ANDROID;
}

function getRewardedAdUnitId() {
  return Capacitor?.getPlatform?.() === 'ios' ? TEST_REWARDED_IOS : TEST_REWARDED_ANDROID;
}

function canShowInterstitial() {
  return userInteracted && Date.now() - lastInterstitialAt >= INTERSTITIAL_COOLDOWN_MS;
}

async function showBannerBottom() {
  await AdMob.showBanner({
    adId: getBannerAdUnitId(),
    adSize: 'BANNER',
    position: 'BOTTOM_CENTER',
    margin: 0,
    isTesting: true,
  });
}

async function ensureInterstitialReady() {
  if (!AdMob) {
    console.warn('[AdMob] ensureInterstitialReady: plugin unavailable.');
    return false;
  }

  try {
    console.log('[AdMob] Interstitial prepare start.');
    await AdMob.prepareInterstitial({
      adId: getInterstitialAdUnitId(),
      isTesting: true,
    });
    console.log('[AdMob] Interstitial prepare success.');

    pendingInterstitialCooldownUpdate = true;
    console.log('[AdMob] Interstitial show start.');
    await AdMob.showInterstitial();
    console.log('[AdMob] Interstitial show success.');

    // If dismiss callback is not emitted on this device/plugin path,
    // update cooldown after show call resolves.
    if (pendingInterstitialCooldownUpdate) {
      lastInterstitialAt = Date.now();
      pendingInterstitialCooldownUpdate = false;
      console.log('[AdMob] Interstitial cooldown fallback applied after show.');
    }

    return true;
  } catch (err) {
    pendingInterstitialCooldownUpdate = false;
    console.warn('[AdMob] Interstitial prepare/show failed:', err);
    return false;
  }
}

async function showInterstitialIfAllowed(reason) {
  if (!canShowInterstitial() || isExamActive || !AdMob) {
    console.log('[AdsGate] Interstitial skipped:', {
      reason,
      canShow: canShowInterstitial(),
      isExamActive,
      hasPlugin: Boolean(AdMob),
    });
    return false;
  }

  const shown = await ensureInterstitialReady();
  if (!shown) {
    console.warn('[AdsGate] Interstitial not shown:', reason);
    return false;
  }

  console.log('[AdsGate] Interstitial displayed:', reason);
  return true;
}

async function maybeShowInterstitialThen(actionName, continueFn) {
  try {
    if (!AdMob || isExamActive || !canShowInterstitial()) {
      return;
    }

    await showInterstitialIfAllowed(actionName);
  } catch (err) {
    console.warn('[AdsGate] maybeShowInterstitialThen failed:', actionName, err);
  } finally {
    if (typeof continueFn === 'function') {
      await continueFn();
    }
  }
}

async function ensureRewardedReadyAndShow(reason) {
  if (!AdMob || isExamActive) {
    console.log('[AdsGate] Rewarded skipped:', {
      reason,
      isExamActive,
      hasPlugin: Boolean(AdMob),
    });
    return { shown: false, rewarded: false };
  }

  try {
    console.log('[AdsGate] Rewarded prepare start:', reason);
    await AdMob.prepareRewardVideoAd({
      adId: getRewardedAdUnitId(),
      isTesting: true,
    });
    console.log('[AdsGate] Rewarded prepare success:', reason);

    console.log('[AdsGate] Rewarded show start:', reason);
    const rewardItem = await AdMob.showRewardVideoAd();
    const rewarded = Boolean(rewardItem && (rewardItem.type !== undefined || rewardItem.amount !== undefined));
    console.log('[AdsGate] Rewarded show finished:', { reason, rewarded, rewardItem });
    return { shown: true, rewarded };
  } catch (err) {
    console.warn('[AdsGate] Rewarded prepare/show failed:', reason, err);
    return { shown: false, rewarded: false };
  }
}

function postFrameResponse(sourceWindow, payload) {
  try {
    if (!sourceWindow || typeof sourceWindow.postMessage !== 'function') return;
    sourceWindow.postMessage(payload, '*');
  } catch (err) {
    console.warn('[AdsGate] postFrameResponse failed:', err);
  }
}

async function initNativeMenuPlaceholder() {
  const btn = document.getElementById('nativeMenuBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    userInteracted = true;

    if (!ActionSheet?.showActions) {
      console.warn('[Menu] ActionSheet plugini kullanilamiyor.');
      return;
    }

    try {
      const result = await ActionSheet.showActions({
        title: 'Sürücü Akademisi',
        message: 'Ucretsiz ozellikler menusu',
        options: [
          { title: 'Ozellikler' },
          { title: 'Iletisim' },
          { title: 'Kapat', style: 'cancel' },
        ],
      });

      const selectedIndex = result?.index;
      const isFeatureSelection = selectedIndex === 0 || selectedIndex === 1;
      const isDismissed = selectedIndex === 2 || selectedIndex === -1 || typeof selectedIndex !== 'number';

      if (isFeatureSelection || isDismissed) {
        await showInterstitialIfAllowed('menu-action-selected');
      }
    } catch (err) {
      console.warn('[Menu] ActionSheet hatası:', err);
    }
  });
}

function setupExamLifecycleBridge() {
  const frame = document.querySelector('.app-frame');
  const isTrustedSource = (event) => {
    if (!frame?.contentWindow) return false;
    if (event.source !== frame.contentWindow) return false;
    return true;
  };

  const parseEventType = (data) => {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed?.type;
      } catch {
        return data;
      }
    }
    if (data && typeof data === 'object') {
      return data.type;
    }
    return null;
  };

  const parseEventPayload = (data) => {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed && typeof parsed === 'object' ? parsed : { type: data };
      } catch {
        return { type: data };
      }
    }
    if (data && typeof data === 'object') {
      return data;
    }
    return { type: null };
  };

  const ensureExamSession = (sessionId) => {
    if (!sessionId) return;
    if (activeExamSessionId !== sessionId) {
      activeExamSessionId = sessionId;
      completionAdShownForSession = false;
      console.log('[ExamBridge] session switched:', activeExamSessionId);
    }
  };

  const maybeShowCompletionAdOnce = async (reason) => {
    if (completionAdShownForSession) {
      console.log('[ExamBridge] completion ad already shown for session:', activeExamSessionId);
      return;
    }

    await maybeShowInterstitialThen(reason, () => Promise.resolve());
    completionAdShownForSession = true;
  };

  const requestUiRestore = (sourceWindow) => {
    console.log('[UI] restore-exams sent');
    postFrameResponse(sourceWindow, {
      type: 'ui:reset-tabs',
    });
    postFrameResponse(sourceWindow, {
      type: 'ui:restore-exams',
    });
    postFrameResponse(sourceWindow, {
      type: 'ui:open-exams',
    });
  };

  const requestHardReset = (sourceWindow, options) => {
    postFrameResponse(sourceWindow, {
      type: 'ui:hard-reset',
      ...(options || {}),
    });
  };

  window.addEventListener('message', async (event) => {
    if (!isTrustedSource(event)) return;

    const eventPayload = parseEventPayload(event.data);
    const eventData = eventPayload && typeof eventPayload === 'object' ? eventPayload : null;
    const eventType = parseEventType(eventPayload);
    console.log('[AdsGate] received event:', eventType);
    console.log('[ExamBridge] raw event.data:', event.data);
    console.log('[ExamBridge] parsed type:', eventType ?? 'unknown');

    if (eventType === 'ad:request') {
      const requestId = eventData?.requestId;
      const adType = eventData?.adType;
      const reason = eventData?.reason || 'unknown';
      userInteracted = true;
      console.log('[AdsGate] ad:request received:', { requestId, adType, reason, isExamActive });

      if (!requestId || !adType) {
        postFrameResponse(event.source, {
          type: 'ad:result',
          requestId,
          adType,
          ok: false,
          reason,
          error: 'invalid-request',
        });
        return;
      }

      if (adType === 'interstitial') {
        if (reason === 'note-open') {
          console.log('[AdsGate] note-open click');
        }
        if (isExamActive && reason === 'note-open') {
          console.log('[AdsGate] note-open ignored (exam active)');
        }
        const shown = await showInterstitialIfAllowed(reason);
        postFrameResponse(event.source, {
          type: 'ad:result',
          requestId,
          adType,
          ok: true,
          shown,
          rewarded: false,
          reason,
        });
        return;
      }

      if (adType === 'rewarded') {
        if (reason === 'video-open') {
          console.log('[AdsGate] video-open click');
        }
        if (isExamActive && reason === 'video-open') {
          console.log('[AdsGate] video-open ignored (exam active)');
        }
        const result = await ensureRewardedReadyAndShow(reason);
        postFrameResponse(event.source, {
          type: 'ad:result',
          requestId,
          adType,
          ok: true,
          shown: result.shown,
          rewarded: result.rewarded,
          reason,
        });
        return;
      }

      postFrameResponse(event.source, {
        type: 'ad:result',
        requestId,
        adType,
        ok: false,
        reason,
        error: 'unsupported-ad-type',
      });
      return;
    }

    if (eventType === 'exam:start') {
      ensureExamSession(eventData?.sessionId);
      if (isExamActive) {
        console.log('[ExamBridge] exam:start ignored (already active).');
        postFrameResponse(event.source, { type: 'exam:start:proceed' });
        return;
      }

      userInteracted = true;
      completionAdShownForSession = false;
      console.log('[AdsGate] exam-start click');
      const examStartAdPromise = maybeShowInterstitialThen('exam-start', () => Promise.resolve());
      isExamActive = true;
      console.log('[ExamBridge] exam state entered. isExamActive=true');
      await examStartAdPromise;
      postFrameResponse(event.source, { type: 'exam:start:proceed' });
      return;
    }

    if (eventType === 'exam:results') {
      ensureExamSession(eventData?.sessionId);
      isExamActive = false;
      console.log('[ExamBridge] exam results transition. isExamActive=false');
      return;
    }

    if (eventType === 'exam:exit') {
      ensureExamSession(eventData?.sessionId);
      isExamActive = false;
      console.log('[ExamBridge] exam exit transition. isExamActive=false');
      requestUiRestore(event.source);
      return;
    }

    if (eventType === 'exam:end') {
      ensureExamSession(eventData?.sessionId);
      const wasExamActive = isExamActive;
      isExamActive = false;
      console.log('[ExamBridge] exam state exited. isExamActive=false');
      if (!wasExamActive) {
        console.log('[ExamBridge] exam:end ignored (was not active).');
      }
      await maybeShowCompletionAdOnce('exam-exit');
      requestUiRestore(event.source);
      return;
    }

    if (eventType === 'ui:section-change') {
      const tabId = typeof eventData?.tabId === 'string' ? eventData.tabId : null;
      const isKnownTab = tabId === 'exams' || tabId === 'notes' || tabId === 'videos' || tabId === 'contact';
      requestHardReset(event.source, {
        targetTab: isKnownTab ? tabId : null,
        showHome: false,
        hardReload: false,
      });
      return;
    }

    console.log('[ExamBridge] unrelated message ignored.');
  });
}

function bindInteractionSignals() {
  const markInteraction = () => {
    userInteracted = true;
  };

  window.addEventListener('touchstart', markInteraction, { passive: true });
  window.addEventListener('click', markInteraction, { passive: true });

}

async function bootstrap() {
  if (!isNative()) {
    console.log('[Info] Native dışı ortam, AdMob çalıştırılmadı.');
    return;
  }

  if (!AdMob || !ActionSheet || !App) {
    console.warn('[Info] Capacitor pluginleri bulunamadı.');
    return;
  }

  await initNativeMenuPlaceholder();
  setupExamLifecycleBridge();
  bindInteractionSignals();

  try {
    await AdMob.initialize({
      requestTrackingAuthorization: true,
      initializeForTesting: true,
      testingDevices: [],
    });

    await showBannerBottom();

    AdMob.addListener('interstitialAdDismissed', () => {
      lastInterstitialAt = Date.now();
      pendingInterstitialCooldownUpdate = false;
      console.log('[AdMob] interstitialAdDismissed received; cooldown updated.');
    });

    AdMob.addListener('onRewardedVideoAdReward', (rewardItem) => {
      console.log('[AdsGate] Rewarded event: rewarded', rewardItem);
    });

    AdMob.addListener('onRewardedVideoAdDismissed', () => {
      console.log('[AdsGate] Rewarded event: dismissed');
    });

  } catch (err) {
    console.warn('[AdMob] Başlatma hatası:', err);
  }
}

bootstrap();
