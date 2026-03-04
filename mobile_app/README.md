# Sürücü Akademisi Mobile Wrapper (Capacitor)

Bu klasör, mevcut web uygulamasını (`https://surucuakademisi.github.io/surucu-akademisi/`) Android/iOS mağaza paketine dönüştürmek için minimal Capacitor sarmalayıcıdır.

## Özellikler
- Capacitor App ID: `io.surucuakademisi.app`
- App Name: `Sürücü Akademisi`
- Remote web uygulama: tam ekran `iframe` ile yüklenir
- AdMob entegrasyonu:
  - Banner (alt sabit)
  - Interstitial (en fazla 3 dakikada 1 kez)
  - Sadece kullanıcı etkileşiminden sonra + app resume gibi anlarda
- Native menü placeholder (ActionSheet):
  - Uygulamayı Puanla (Yakında)
  - İletişim (Yakında)

## Test Reklam ID'leri
`src/main.js` içinde Google resmi test ID'leri kullanılır.
Yayına çıkmadan önce şu alanları gerçek reklam birimleriyle değiştirin:
- `TEST_BANNER_ANDROID`
- `TEST_BANNER_IOS`
- `TEST_INTERSTITIAL_ANDROID`
- `TEST_INTERSTITIAL_IOS`

## Kurulum
> Not: Bu ortamda `npm` yoktu, bu yüzden dependency kurulumu burada çalıştırılamadı. Aşağıdaki adımları kendi makinenizde çalıştırın.

```bash
cd mobile_app
npm install
npm run add:android
npm run add:ios
npm run sync
```

## Android Studio ile çalıştırma
```bash
cd mobile_app
npm run android
```

Sonra Android Studio'da:
1. Emülatör veya cihaz seç
2. Run (▶) ile debug çalıştır

## APK / AAB alma
Android Studio içinde:
- APK: `Build > Build Bundle(s)/APK(s) > Build APK(s)`
- AAB: `Build > Generate Signed Bundle / APK > Android App Bundle`

Play Store yükleme için AAB önerilir.

## iOS (Mac gerekli)
```bash
cd mobile_app
npm run ios
```

Xcode içinde target seçip Run/Archive ile devam edin.
