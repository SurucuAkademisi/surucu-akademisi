# Üçüncü Taraf Veri İşleyen ve Hizmet Sağlayıcı Kaydı — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2C-B-0.1  
**Sözleşme / DPA durumu:** **UNVERIFIED** · `[[TEDARIKCI_SOZLESME_DURUMU]]` · `[[VERI_ISLEYEN_SOZLESMESI_DURUMU]]`  
**Aktarım güvencesi:** `[[YURT_DISI_AKTARIM_GUVENCESI]]` — **LEGAL REVIEW REQUIRED**

---

## A. DAHİLİ UYARI

Bu kayıt imzalanmış DPA veya tamamlanmış aktarım mekanizması değildir. Bağımlılık tek başına hukuki rol veya sözleşme varlığı kanıtı değildir. Planlı hizmetler aktif sayılmaz.

---

## B. KAYIT

### 1. Amaç

Teknik olarak kullanılan veya planlanan üçüncü taraf hizmetleri envanterlemek; sözleşme, aktarım ve silme kapasitesi boşluklarını görünür kılmak.

### 2. Kapsam

Firebase/Google ekosistemi, reklam, video, yapay zekâ, CDN, planlı ödeme/e-posta/analitik, Capacitor eklentileri.

### 3. Sınıflandırma kuralları

| Etiket | Anlam |
|--------|-------|
| ACTIVE | Üretimde veya doğrulanmış kullanım |
| TEST/DEVELOPMENT | Test yapılandırması |
| PLANNED | Planlı; aktif deme |
| DISABLED | Kod/UI var ama kullanıcıya kapalı |
| UNVERIFIED | Kanıt yetersiz |

Rol adayları: veri işleyen adayı · bağımsız sorumlu adayı · yalnızca hizmet / altyapı · **LEGAL REVIEW REQUIRED**

### 4–5. Doğrulanmış / planlı sağlayıcı kaydı

| Provider | Service | Status | Data categories | Data subjects | Purpose | Technical evidence | Role candidate | Location | Intl risk | Contract/DPA | Transfer mechanism | Security docs | Sub-processors | Deletion capability | Incident terms | Owner | Review date | Legal status |
|----------|---------|--------|-----------------|---------------|---------|-------------------|----------------|----------|-----------|--------------|-------------------|---------------|----------------|--------------------|----------------|-------|-------------|--------------|
| Google | Firebase Authentication | ACTIVE | Email, UID, provider IDs | Users | Auth | Auth usage, mobile Google Sign-In | Processor / provider candidate | Google infra | YES risk | UNVERIFIED | `[[YURT_DISI_AKTARIM_MEKANIZMASI]]` pending | Provider docs | Google sub-processors | Auth delete API | Provider terms UNVERIFIED | Eng/Legal | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google | Cloud Firestore | ACTIVE | Account, progress, UGC meta | Users, students | App data | europe-west3 project | Same | EU region + replicas? | YES risk | UNVERIFIED | Pending | Provider docs | Same | Doc delete; cascade incomplete | UNVERIFIED | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google | Firebase Hosting | ACTIVE | Hosted assets; possible logs | Visitors | Hosting | firebase.json targets | Same | Google | YES risk | UNVERIFIED | Pending | Provider docs | Same | Deploy revoke | UNVERIFIED | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google | Cloud Functions | ACTIVE | Request payloads, logs | Users/admins | Backend | functions*, us-central1 typical | Same | US-central possible | YES risk | UNVERIFIED | Pending | Provider docs | Same | Log retention provider-side | UNVERIFIED | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google | Firebase Storage | ACTIVE | Profile images | Users | Media | `user-profiles/{uid}` | Same | Google | YES risk | UNVERIFIED | Pending | Provider docs | Same | Object delete | UNVERIFIED | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google | FCM | ACTIVE | Device tokens, push payload | Mobile users | Push | push_dispatch, deviceTokens | Same | Google | YES risk | UNVERIFIED | Pending | Provider docs | Same | Token invalidate | UNVERIFIED | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google | Google Sign-In | ACTIVE | Account identifiers | Mobile users | Login | Capacitor Firebase Auth | Same | Google | YES risk | UNVERIFIED | Pending | Provider docs | Same | Unlink/revoke limited | UNVERIFIED | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google | AdMob / Mobile Ads | TEST/DEVELOPMENT | Ad/device signals possible | Mobile users | Ads test | initializeForTesting, test APP_ID | Same | Google | YES risk | UNVERIFIED | Pending | Provider docs | Same | Limited | UNVERIFIED | Eng/Legal | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google | Play services | ACTIVE (Android) | Device/Play | Android users | Runtime | Android app | Same | Google | YES risk | UNVERIFIED | Pending | Provider docs | Same | OS/Play controlled | UNVERIFIED | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Google / YouTube | YouTube embed/link | ACTIVE | Video interaction | Users | Education video | Mobile/web embeds | Independent controller candidate possible | Google | YES risk | UNVERIFIED | Pending | YouTube terms | Same | N/A platform | UNVERIFIED | Eng/Legal | 2026-07-29 | LEGAL REVIEW REQUIRED |
| OpenAI | Mevzuat Asistanı API | ACTIVE (admin/institution tool) | Prompts, context snippets | Admins / institution users | Legislation assist | `functions_legislation_ai` | Processor candidate | OpenAI infra | YES risk | UNVERIFIED | Pending | Provider docs | OpenAI subs | Provider retention policy | UNVERIFIED | Eng/Legal | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Cloudflare | Font Awesome CDN (cdnjs) | ACTIVE (asset CDN) | IP / request logs possible | Visitors/admins loading CSS | Static asset CDN | admin.html cdnjs.cloudflare.com | Provider | Cloudflare | YES risk | UNVERIFIED | Pending | CDN terms | Same | N/A | UNVERIFIED | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Cloudflare | DNS / proxy for domain | UNVERIFIED | DNS/proxy logs | Visitors | DNS/CDN | Ops may use; repo evidence limited | UNVERIFIED | Cloudflare | Possible | UNVERIFIED | Pending | — | — | — | — | Ops | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Capacitor / native plugins | App, Push, AdMob, Action Sheet, Firebase Auth plugin | ACTIVE | Bridge technical | Mobile users | Native features | package.json | Tooling / may embed SDKs | Various | Via SDKs | N/A open source | Via embedded SDKs | — | Plugin vendors | App uninstall / token clear | — | Eng | 2026-07-29 | LEGAL REVIEW REQUIRED |
| Microsoft | OAuth login | DISABLED (UI hidden; foundation exists) | Would be account IDs | — | Login | display:none + callback plumbing | — | Microsoft | — | — | — | — | — | — | — | Eng | 2026-07-29 | Do not treat as active |
| Payment provider (e.g. iyzico) | Online checkout | PLANNED / not live | Payment data | Buyers | Checkout | functions_payments stub/not live | — | — | — | UNVERIFIED | — | — | — | — | — | Product | 2026-07-29 | Not active |
| Apple | App Store / Apple services | PLANNED | Apple account | iOS users future | Distribution | iOS not confirmed live | — | Apple | Possible | UNVERIFIED | — | — | — | — | — | Product | 2026-07-29 | Not live |
| Transactional e-mail provider | Email delivery | PLANNED / UNVERIFIED | Email, content | Users | Transactional mail | Not verified active | — | — | Possible | UNVERIFIED | — | — | — | — | — | Ops | 2026-07-29 | Not active |
| Analytics provider | Product analytics | PLANNED / absent | Usage | Users | Analytics | Not in mobile deps as Firebase Analytics | — | — | — | — | — | — | — | — | — | Eng | 2026-07-29 | Not active |
| Crash reporting | Crashlytics etc. | PLANNED / absent | Diagnostics | Users | Stability | Not verified in deps | — | — | — | — | — | — | — | — | — | Eng | 2026-07-29 | Not active |
| E-mail routing (info@…) | Domain mail | UNVERIFIED | Mail content | Contacts | Support mail | Product address verified; provider UNVERIFIED | — | — | Possible | UNVERIFIED | — | — | — | — | — | Ops | 2026-07-29 | LEGAL REVIEW REQUIRED |

### 6. Sözleşme durumu özeti

| Madde | Durum |
|-------|-------|
| Google Cloud / Firebase DPA | UNVERIFIED |
| OpenAI DPA / data processing terms acceptance | UNVERIFIED |
| AdMob / ads terms review | UNVERIFIED |
| Cloudflare terms (CDN/DNS) | UNVERIFIED |
| Institution processor agreements | NOT COMPLETED |
| Signed DPAs overall | **NO / UNVERIFIED** |

### 7–11. Veri, amaç, konum, aktarım

Ayrıntılar tabloda. Mekanizma: `[[YURT_DISI_AKTARIM_MEKANIZMASI]]` · güvence: `[[YURT_DISI_AKTARIM_GUVENCESI]]` — tamamlanmış sayılmaz.

### 12–16. Güvenlik dokümanı, alt işlemci, silme, olay bildirimi, denetim

Sağlayıcı güvenlik sayfalarına dayanılır; iç denetim tarihi 2026-07-29 (bu taslak). Silme kapasitesi sağlayıcı + iç kaskad ile sınırlı. Olay bildirimi şartları sözleşme incelemesine bağlı — UNVERIFIED.

### 17. Çıkış / migrasyon

Auth/Firestore/Storage export planı; Functions yeniden barındırma; OpenAI anahtar iptali; AdMob hesap kapatma. Resmî exit runbook: **NOT COMPLETED**.

### 18–20. Yer tutucular / inceleme / bağımlılıklar

`[[TEDARIKCI_SOZLESME_DURUMU]]` · `[[VERI_ISLEYEN_SOZLESMESI_DURUMU]]` · `[[YURT_DISI_AKTARIM_GUVENCESI]]` · `[[YURT_DISI_AKTARIM_MEKANIZMASI]]`

**Bağımlılıklar:** DPA imza/kabul kanıtları; aktarım mekanizması seçimi; yıllık gözden geçirme takvimi; sağlayıcı incident contact listesi — henüz uygulanmadı / doğrulanmadı.
