# Mobil Mağaza Gizlilik ve Veri Güvenliği Kontrol Listesi — Dahili

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2C-A-0.1  
**Tür:** İç release checklist — kamu politikası değildir  
**Mağaza beyanı durumu:** **NOT COMPLETED** / `STORE CONSOLE VERIFICATION REQUIRED`  
**Bu patch:** Mağaza konsoluna gönderim **YOK**

---

## 1. Dahili uyarı

Bu liste Google Play Data Safety veya Apple App Privacy formunu doldurmuş sayılmaz. Tahminle “Data Not Collected” işaretlenmez. iOS canlı yayım doğrulanmamıştır.

## 2. İncelenen depo sürümü

- Tarih: 29 July 2026  
- Odak: `mobile_app/**` (READ-ONLY), Capacitor config, Android manifest, `package.json`, AdMob/Push/Auth kaynakları  
- App ID: `io.surucuakademisi.app`  
- App Name: Sürücü Akademisi  

## 3. Android release status

Android Capacitor uygulaması **mevcut**. Production store listing beyanları: **NOT COMPLETED**.

## 4. iOS release status

`@capacitor/ios` devDependency mevcut; canlı App Store yayını **doğrulanmadı**. Apple beyanları geleceğe hazırlık taslağıdır.

## 5. Public privacy-policy requirement

`[[GIZLILIK_POLITIKASI_PUBLIC_URLSI]]` — **MISSING** · Politika taslağı L2C-A doc 10 · Yayımlama **BLOCKED**

## 6. In-app privacy-policy access

Uygulama içi gizlilik politikası linki: **UNVERIFIED / INCOMPLETE**

## 7. Google Play Data Safety preparation

Aşağıdaki ön matris — kesin form yanıtı değildir.

## 8. Google Play account-deletion preparation

- In-app silme: **NOT IMPLEMENTED**  
- Dış silme URL: **NOT IMPLEMENTED** (`[[HESAP_SILME_PUBLIC_URLSI]]`)  
- Play Console silme beyanı: **NOT COMPLETED**  

## 9. Apple App Privacy preparation

Ön matris aşağıda. iOS canlı değilken form gönderilmez.

## 10. Apple account-deletion preparation

Aynı teknik boşluklar. Apple Account Deletion: **NOT IMPLEMENTED**

---

## 11. SDK inventory

| SDK / bileşen | package.json | Kaynakta init | Runtime kullanım | Test config | Prod config | Veri | Store etkisi |
|---------------|--------------|---------------|------------------|-------------|-------------|------|--------------|
| Firebase Auth (JS + Capacitor Firebase Auth) | Evet (`@capacitor-firebase/authentication`) | Evet | Evet | — | Kullanılır | Kimlik | Data Safety / App Privacy |
| Cloud Firestore | Firebase web SDK (uygulama) | Evet | Evet | — | Kullanılır | Hesap/aktivite | Evet |
| Firebase Storage | Firebase web SDK | Evet | Profil foto | — | Kullanılır | Foto/dosya | Evet |
| FCM / Push Notifications | `@capacitor/push-notifications` | Evet | Evet (native) | — | Kullanılır | Token / bildirim | Evet |
| Google Sign-In | Capacitor Firebase Auth `google.com` | Evet | Evet | — | Kullanılır | Kimlik | Evet |
| AdMob | `@capacitor-community/admob` | Evet | Evet | **initializeForTesting: true**; test ad unit IDs; test APP_ID | Üretim kimlikleri doğrulanmadı | Reklam ID / cihaz sinyalleri olası | Evet — `DEPENDS ON SDK CONFIGURATION` |
| Capacitor App / Action Sheet / Core | Evet | Evet | Evet | — | — | Teknik | Düşük |
| Microsoft Auth | Config `microsoft.com` + UI `display:none` + foundation | Kod var | **Aktif kullanıcı girişi olarak sunulmaz** | — | Disabled UI | — | Aktif olarak beyan etme |
| Crashlytics | Yok | Yok | Yok | — | — | — | Aktif deme |
| Firebase Analytics | Yok (bağımlılıkta doğrulanmadı) | Yok | Yok | — | — | — | Aktif deme |
| OpenAI | Mobil öğrenci yolu UNVERIFIED | — | Mobilde doğrulanmadı | — | — | — | Mobil formda “toplanıyor” deme |
| YouTube embed / link | Kod | Evet | Evet | — | — | Video etkileşimi | Üçüncü taraf |

---

## 12. Permission inventory

| İzin | Kaynak | Declared? | Runtime requested? | Özellik | Veri | Gerekli? | Kaldırılabilir? | Politika | Play etkisi |
|------|--------|-----------|--------------------|---------|------|----------|-----------------|----------|-------------|
| `INTERNET` | `android/app/.../AndroidManifest.xml` | YES | N/A | Ağ | Teknik | YES | NO | Açıkla | App info |
| `ACCESS_NETWORK_STATE` | AdMob plugin manifest | YES (merge) | N/A | Reklam | Ağ durumu | Ads için tipik | Ads kaldırılırsa gözden geçir | Açıkla | Ads |
| `POST_NOTIFICATIONS` | Push plugin | Plugin model | YES (`requestPermissions`) | Push | Token | Optional | YES (push kapatılır) | Açıkla | Notifications |
| CAMERA / FINE_LOCATION / CONTACTS / RECORD_AUDIO | App manifest | NO (doğrulanan app manifest) | NO | — | — | — | — | Kesin konum/kişiler deme | NO without evidence |
| File picker (profil foto) | Sistem UI | Ayrı izin yok | Kullanıcı seçer | Avatar | Photos | Optional | YES | Storage/photo | Photos/files if declared |

**Flag:** Birleşik izinlerin yalnızca bağımlılıktan gelip gelmediği üretim APK merge sonrası yeniden doğrulanmalı — `STORE CONSOLE VERIFICATION REQUIRED`. Bu fazda izin silinmez.

---

## 13–15. Data category / sharing / purpose inventory (özet)

| Kategori | Toplanır? | Paylaşılır? | Amaç |
|----------|-----------|-------------|------|
| Kimlik / e-posta / UID | YES | Auth/Google sağlayıcıları | Hesap |
| Profil foto | YES (opsiyonel) | Storage URL | Profil |
| App activity (sınav, ders, forum, düello) | YES | Backend | Eğitim / topluluk |
| Messages | YES | Alıcı / sistem | İletişim |
| Device identifiers / FCM token | YES | FCM | Push |
| Ad identifiers | DEPENDS ON SDK CONFIGURATION (test AdMob) | Google Ads | Reklam (test/dev) |
| Precise location | NO (doğrulanmadı) | — | — |
| Contacts | NO | — | — |
| Health | NO | — | — |
| Financial (canlı checkout) | NO live checkout; kurum manuel bakiye ayrı kanal | — | — |

---

## 16–17. Security / encryption declarations

| Beyan | Durum |
|-------|-------|
| Transit encryption (HTTPS/TLS) | Sağlayıcı varsayılanları — tipik YES; konsol teyidi gerekir |
| Encryption at rest (tüm veri) | Mutlak iddia YOK — `STORE CONSOLE VERIFICATION REQUIRED` |
| End-to-end encryption | NO claim |
| Independent certification / pen-test | NO claim |
| Her veri silinebilir | NO — cascade incomplete |
| Hiç veri paylaşılmıyor | NO |
| Uluslararası işleme yok | NO |

---

## 18. Deletion-request declarations

| Madde | Durum |
|-------|-------|
| User can request deletion (ürün) | **NOT CURRENTLY IMPLEMENTED** |
| In-app path | NOT IMPLEMENTED |
| Web resource | NOT IMPLEMENTED |
| Tam kaskad | NOT IMPLEMENTED / UNVERIFIED |
| Play / Apple silme beyanı | NOT COMPLETED |

---

## 19. Advertising declarations

- AdMob: test/development (`initializeForTesting`, test APP_ID `ca-app-pub-3940256099942544~3347511713`, test interstitial/rewarded unit IDs)  
- Rewarded + interstitial kodda  
- Production live advertising: **doğrulanmadı** — production live deme  
- Personalized ads: UNVERIFIED / `TECHNICAL AND LEGAL VERIFICATION REQUIRED`  
- CMP: NOT IMPLEMENTED  
- Ad-free entitlement: kodda (`adFree`)  
- Web AdSense: **not active**  
- Minor-user advertising assessment: **REQUIRED**

---

## 20. Children / minors assessment

`[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]` · Child-directed treatment / COPPA-benzeri mağaza alanları: **REQUIRED** · Tamamlanmış sayılmaz.

## 21. User-generated content assessment

Forum, yanıt, mesaj, düello/lig — UGC mevcut. Silmede paylaşımlı kayıtlar ayrı (**LEGAL REVIEW REQUIRED**).

## 22. Push-notification assessment

İzin öncesi modal + runtime permission; token Firestore’a yazılır; hizmet/eğitim/duyuru; pazarlama ayrı sınıflandırma; token silme kaskadı UNVERIFIED.

---

## Google Play Data Safety — ön matris

| Kategori | Collected? | Shared? | Required/Optional | Purpose | Ephemeral? | Linked to identity? | Encrypted in transit? | User can request deletion? | Evidence | Verification |
|----------|------------|---------|-------------------|---------|------------|---------------------|----------------------|----------------------------|----------|--------------|
| Personal info (name, email) | YES | YES (Auth/Google) | Account | Account mgmt | NO | YES | UNVERIFIED (provider TLS typical) | NOT CURRENTLY IMPLEMENTED | Auth, users | Preliminary |
| App activity | YES | Backend only typical | Core | App functionality | NO | YES | UNVERIFIED | NOT CURRENTLY IMPLEMENTED | Firestore attempts/forum/duel | Preliminary |
| App info and performance | UNVERIFIED | UNVERIFIED | — | — | — | — | — | — | No Crashlytics/Analytics dep verified | Do not guess |
| Device or other IDs | YES (UID, FCM; ads ID possible) | YES (FCM/Ads) | Push/Ads | Push / Ads | Token may refresh | YES | UNVERIFIED | NOT CURRENTLY IMPLEMENTED | deviceTokens, AdMob | DEPENDS ON SDK CONFIGURATION |
| Messages | YES | Recipients | Optional feature | Comms | NO | YES | UNVERIFIED | Soft-hide ≠ full delete | mailboxes | Preliminary |
| Photos/files | YES (avatar optional) | Storage URL | Optional | Profile | NO | YES | UNVERIFIED | NOT CURRENTLY IMPLEMENTED | Storage path | Preliminary |
| Financial info | NO live checkout | — | — | — | — | — | — | — | No live IAP verified | Preliminary |
| Location | NO | — | — | — | — | — | — | — | No fine location permission | Preliminary |
| Contacts | NO | — | — | — | — | — | — | — | No contacts permission | Preliminary |
| Health and fitness | NO | — | — | — | — | — | — | — | — | Preliminary |

## Apple App Privacy — ön matris

| Tip | App collects? | Third-party SDK? | Linked to user? | Used for tracking? | Purpose | Evidence | Declaration status |
|-----|---------------|------------------|-----------------|--------------------|---------|----------|--------------------|
| Contact Info | YES | Google Sign-In / Auth possible | YES | UNVERIFIED | Account | Auth | NOT COMPLETED |
| User Content | YES | YouTube embed possible | YES | UNVERIFIED | Education/UGC | Forum, photo, messages | NOT COMPLETED |
| Identifiers | YES | AdMob / FCM possible | YES | `requestTrackingAuthorization: true` — tracking beyanı UNVERIFIED | Push/Ads | Push, AdMob init | NOT COMPLETED |
| Usage Data | YES | UNVERIFIED analytics | YES | UNVERIFIED | App function | Activity collections | NOT COMPLETED |
| Diagnostics | UNVERIFIED | No Crashlytics verified | — | — | — | — | Do not mark without evidence |
| Purchases | NO live | — | — | — | — | — | Preliminary |
| Other Data | UNVERIFIED | — | — | — | — | — | NOT COMPLETED |

**“Data Not Collected” işaretleme:** Tüm SDK’lar doğrulanmadan **YAPILMAZ**.

---

## 23. Store listing links (gelecek)

- `[[GOOGLE_PLAY_UYGULAMA_URLSI]]`  
- `[[APPLE_APP_STORE_UYGULAMA_URLSI]]`  
- `[[GIZLILIK_POLITIKASI_PUBLIC_URLSI]]`  
- `[[HESAP_SILME_PUBLIC_URLSI]]`  
- Public Terms / Data Subject / Privacy Choices — placeholder aşamasında; route oluşturulmaz  

## 24. Evidence register

| Kanıt | Konum |
|-------|-------|
| Capacitor config AdMob testing | `mobile_app/capacitor.config.ts` |
| Package deps | `mobile_app/package.json` |
| App manifest INTERNET + test AdMob APP_ID | `mobile_app/android/app/src/main/AndroidManifest.xml` |
| AdMob test units / init | `mobile_app/src/index.html` AdsGate |
| Push + deviceTokens | `mobile_app/src/index.html` PushSetup; `SaFirebaseMessagingService.java` |
| Google Sign-In | `mobile_app/src/js/login.js` / index handlers |
| Microsoft UI hidden | index.html `display:none` on Microsoft button |
| Profile Storage | `user-profiles/{uid}/avatar.jpg` |
| Partial admin student delete | `functions_student_admin/index.js` |
| No self-service delete UI | mobile src grep — not found |

## 25. Final sign-off roles

| Rol | İmza |
|-----|------|
| Product | |
| Engineering | |
| Legal counsel | |
| Store console operator | |

Tamamlanmadı.

## 26. Release blockers (mobil + genel)

- Public legal pages: **BLOCKED**  
- Public Contact form: **BLOCKED**  
- Contact CMS publication: **BLOCKED**  
- Company identity: **INCOMPLETE**  
- Legal review: **REQUIRED**  
- Mobile privacy policy public URL: **MISSING**  
- In-app privacy-policy link: **UNVERIFIED / INCOMPLETE**  
- Mobile in-app account deletion: **NOT IMPLEMENTED**  
- External account-deletion resource: **NOT IMPLEMENTED**  
- Full deletion cascade: **NOT IMPLEMENTED**  
- Play Data Safety verification: **NOT COMPLETED**  
- Apple App Privacy verification: **NOT COMPLETED**  
- AdMob consent/personalization assessment: **REQUIRED**  
- Minor-user advertising assessment: **REQUIRED**  
- Cookie preference center: **NOT IMPLEMENTED**  
- Cross-border mechanism: **LEGAL REVIEW REQUIRED**  
- Retention automation: **NOT IMPLEMENTED**  

## 27. Controlled placeholders

`[[GIZLILIK_POLITIKASI_PUBLIC_URLSI]]` · `[[HESAP_SILME_PUBLIC_URLSI]]` · `[[GOOGLE_PLAY_UYGULAMA_URLSI]]` · `[[APPLE_APP_STORE_UYGULAMA_URLSI]]` · `[[HESAP_SILME_TAMAMLANMA_SURESI]]` · `[[HESAP_SILME_DESTEK_KANALI]]` · şirket kimliği yer tutucuları · `[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]` · `[[YURT_DISI_AKTARIM_MEKANIZMASI]]`
