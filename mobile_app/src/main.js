import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ActionSheet } from '@capacitor/action-sheet';
import {
  AdMob,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
} from '@capacitor-community/admob';

const TEST_BANNER_ANDROID = 'ca-app-pub-3940256099942544/6300978111';
const TEST_BANNER_IOS = 'ca-app-pub-3940256099942544/2934735716';
const TEST_INTERSTITIAL_ANDROID = 'ca-app-pub-3940256099942544/1033173712';
const TEST_INTERSTITIAL_IOS = 'ca-app-pub-3940256099942544/4411468910';

const INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000;
let lastInterstitialAt = 0;
let userInteracted = false;

function isNative() {
  return Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios';
}

function getBannerAdUnitId() {
  return Capacitor.getPlatform() === 'ios' ? TEST_BANNER_IOS : TEST_BANNER_ANDROID;
}

function getInterstitialAdUnitId() {
  return Capacitor.getPlatform() === 'ios' ? TEST_INTERSTITIAL_IOS : TEST_INTERSTITIAL_ANDROID;
}

function canShowInterstitial() {
  return userInteracted && Date.now() - lastInterstitialAt >= INTERSTITIAL_COOLDOWN_MS;
}

async function showBannerBottom() {
  await AdMob.showBanner({
    adId: getBannerAdUnitId(),
    adSize: BannerAdSize.BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: 0,
    isTesting: true,
  });
}

async function showInterstitialIfAllowed(reason) {
  if (!canShowInterstitial()) return;

  try {
    await AdMob.prepareInterstitial({
      adId: getInterstitialAdUnitId(),
      isTesting: true,
    });
    await AdMob.showInterstitial();
    lastInterstitialAt = Date.now();
    console.log('[AdMob] Interstitial gösterildi:', reason);
  } catch (err) {
    console.warn('[AdMob] Interstitial hatası:', err);
  }
}

async function initNativeMenuPlaceholder() {
  const btn = document.getElementById('nativeMenuBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    userInteracted = true;
    await showInterstitialIfAllowed('menu-click');

    try {
      await ActionSheet.showActions({
        title: 'Sürücü Akademisi',
        message: 'Yakında: Uygulamayı puanla / İletişim menüsü eklenecek.',
        options: [
          { title: 'Uygulamayı Puanla (Yakında)' },
          { title: 'İletişim (Yakında)' },
          { title: 'Kapat', style: 'cancel' },
        ],
      });
    } catch (err) {
      console.warn('[Menu] ActionSheet hatası:', err);
    }
  });
}

function bindInteractionSignals() {
  const markInteraction = () => {
    userInteracted = true;
  };

  window.addEventListener('touchstart', markInteraction, { passive: true });
  window.addEventListener('click', markInteraction, { passive: true });

  const frame = document.querySelector('.app-frame');
  if (frame) {
    frame.addEventListener('load', async () => {
      if (userInteracted) {
        await showInterstitialIfAllowed('frame-loaded');
      }
    });
  }
}

async function bootstrap() {
  if (!isNative()) {
    console.log('[Info] Native dışı ortam, AdMob çalıştırılmadı.');
    return;
  }

  await initNativeMenuPlaceholder();
  bindInteractionSignals();

  try {
    await AdMob.initialize({
      requestTrackingAuthorization: true,
      initializeForTesting: true,
      testingDevices: [],
    });

    await showBannerBottom();

    AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
      lastInterstitialAt = Date.now();
    });

    App.addListener('resume', async () => {
      await showInterstitialIfAllowed('app-resume');
    });
  } catch (err) {
    console.warn('[AdMob] Başlatma hatası:', err);
  }
}

bootstrap();
