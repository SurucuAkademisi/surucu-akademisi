# Web Architecture — Sürücü Akademisi

Bu belge, public ehliyet eğitim portalı (`hosting-web/`), kurum öğrenci web paneli (`/app/*`) ve mevcut admin paneli / mobil uygulama ile nasıl hizalandığını açıklar.

## 1. Amaç

- **hosting-web `/`:** Herkese açık, SEO odaklı **ehliyet sınavı eğitim portalı** (deneme, dersler, pratik, forum, düello; reklam destekli ücretsiz içerik — W1.2+). Premium ürün: **öğretmen canlı video dersler** (bireysel yıllık satın alma ileride). Admin/öğrenci/kurum girişi **gösterilmez**.
- **hosting-web `/panel/`:** Kurum **giriş kapısı** (P1) — öğrenci ve admin yönlendirmesi; Firebase yok.
- **hosting-web `/app/*`:** Kurum **öğrenci giriş formu** (`login.html`) ve oturumlu panel (W3); kurum Premium Reklamsız Paket + aktif → reklam/video kilidi yok.
- **hosting-admin:** Süper Admin / kurum yöneticisi paneli (mevcut üretim deploy).
- **mobile_app:** Öğrenci Capacitor uygulaması (canonical runtime: `mobile_app/src/index.html`).

### Public portal vs kurum öğrenci paneli

| Yol | Kitle | Auth | Reklam (gelecek) |
|-----|-------|------|------------------|
| `/` (landing) | Herkes | Yok | Tanıtım; AdSense yok; Üye Girişi / Kayıt Ol → public auth kabukları |
| `/uye-giris/`, `/kayit/` | Public üye (gelecek) | Yok (P2.1 statik) | P2.2’de Firebase `public_user` |
| `/panel/` | Kurum öğrencisi / admin | Yok | Giriş kapısı; Öğrenci → `/app/login.html`, Admin → `/admin` |
| `/deneme-sinavi`, `/dersler`, … (planlı) | Herkes | Yok / hafif | AdSense listeleme sayfalarında |
| `/app/login.html` | Kurum öğrencisi | Firebase + kurum seçimi | W3 — gerçek öğrenci giriş formu |
| `/app/home.html` | Giriş yapmış öğrenci | Oturum | Ad-policy (premium kurum → reklam yok) |

**Tek kaynak ilkesi:** Eğitim içeriği Firestore’da bir kez tutulur; admin yazar, mobil ve web okur. İçerik koleksiyonlarını web için kopyalamayın.

## 2. Mevcut ayrım

| Bileşen | Klasör | Deploy (bugün) |
|---------|--------|------------------|
| Admin panel | `hosting-admin/` (kaynak: kök `admin.html`) | `firebase deploy --only hosting` → `surucuakademisi-f5e1f.web.app` |
| Public ehliyet portalı | `hosting-web/` | **Henüz Firebase Hosting’e bağlı değil (W1)** |
| Mobil öğrenci | `mobile_app/src/` | Capacitor / mağaza; Hosting dışı |

### Üretim URL’leri (admin — değişmedi)

- `https://surucuakademisi-f5e1f.web.app/` → admin yönlendirmesi
- `https://surucuakademisi-f5e1f.web.app/admin` → `admin.html` rewrite
- `https://surucuakademisi-f5e1f.web.app/admin.html`

`firebase.json` W1 sonrası **değiştirilmedi**; mevcut admin deploy komutu aynı kalır:

```bash
firebase deploy --only hosting --project surucuakademisi-f5e1f
```

## 3. hosting-web yerel önizleme

W1 statik sitedir; Firebase SDK yok.

```bash
# Örnek: basit statik sunucu (Node npx serve veya Python)
npx --yes serve hosting-web -p 5080
```

Tarayıcı: `http://localhost:5080/`

Veya `hosting-web/index.html` dosyasını doğrudan açın (göreli asset yolları çalışır).

**Not:** `/admin` linkleri yerel dosya sunucusunda çalışmaz; yalnızca Firebase Hosting’de veya birleşik deploy’da geçerlidir.

**Panel önizleme:** `http://localhost:5080/panel/`

### Hedef domain ayrımı (planlı)

| Domain | Kök | Açıklama |
|--------|-----|----------|
| **surucuakademisi.com** | `/` → `index.html` | Public ehliyet eğitim portalı |
| **panel.surucuakademisi.com** | `/` → `panel/index.html` | Kurum giriş kapısı; `/app/*` öğrenci paneli |
| (mevcut Firebase Hosting) | `/admin` | `admin.html` — mantık değişmedi |

## 4. Gelecek deploy seçenekleri (TODO)

Aynı Firebase projesinde kök URL’de hem marketing hem admin için tipik yollar:

1. **İkinci Hosting site** (Firebase Console) + `hosting:web` target, veya  
2. **Tek public kök** altında birleştirme: `/` → marketing, `/admin` → admin (rewrite), `/app` → öğrenci portalı.

W1 yalnızca `hosting-web/` dosyalarını ekler; üretim hosting yapılandırması sonraki fazda güncellenecek.

## 5. Paylaşılan Firestore koleksiyonları

Admin panel tek yazar; mobil ve web okur.

| İçerik | Yol |
|--------|-----|
| Sınav meta | `tenantExams/surucu_akademisi/exams/{examId}` |
| Sınav soruları | `tenantExams/surucu_akademisi/questions/{questionId}` |
| Video ders kategorileri | `content/teacher_video_lessons/categories/{categoryId}` |
| Video dersler | `.../categories/{categoryId}/videos/{videoId}` |
| Video erişim ayarı | `content/teacher_video_lessons/settings/access` |
| Ders kitabı (v2) | `content/lesson_categories/items/{categoryId}/units/{unitId}/blocks/{blockId}` |
| Kurum faturalama | `tenantBilling/{tenantId}` |
| Kurum ayarları | `tenantSettings/{tenantId}` |
| Kullanıcı reklamsız | `userEntitlements/{uid}` |
| Üyelik | `tenantMemberships/{membershipId}` |
| Kullanıcı | `users/{uid}` |
| Sınav denemesi | `tenants/{tenantId}/exam_attempts/{attemptId}` |

Referans modüller (mobil): `mobile_app/src/js/tenant.repository.js`, `ad-policy.resolver.js`, `exam.repository.js`.

## 6. Web reklam politikası (gelecek)

| Kanal | Teknoloji |
|-------|-----------|
| Mobil | AdMob (Capacitor) — **web’e taşınmaz** |
| Web | Google AdSense / display slotları (planlı) |

Öncelik (mobil ile uyumlu):

1. `userEntitlements/{uid}.adFree` aktif  
2. `tenantBilling` Premium Reklamsız + aktif fatura  
3. Kurum deneme süresi (`tenantSettings.adTrialEndsAt`)  
4. `tenantSettings.adsEnabled`  
5. Varsayılan: reklam göster  

Premium / reklamsız kullanıcılar web’de AdSense görmemeli.

## 7. hosting-web rota haritası

| Rota | Dosya | Durum |
|------|-------|--------|
| `/` veya `/index.html` | `hosting-web/index.html` | W1.2 — public ehliyet portalı landing (statik, SEO) |
| `/uye-giris/` | `hosting-web/uye-giris/index.html` | P2.2b — public üye girişi (Firebase Auth + `public_user`) |
| `/kayit/` | `hosting-web/kayit/index.html` | P2.2b — public kayıt (`public_user`, `sa_public_session_v1`) |
| `/cikmis-sorular/` | `hosting-web/cikmis-sorular/index.html` | P3.1 — public sınav hazırlık SEO hub (statik; 7 kategori kartı, reklam placeholder; Firebase / AdSense / runner yok) |
| `/panel/` veya `/panel/index.html` | `hosting-web/panel/index.html` | P1 — kurum öğrencisi / admin giriş kapısı (statik, Firebase yok) |
| `/deneme-sinavi` (planlı) | — | Eski plan; deneme alt sayfası `/cikmis-sorular/deneme-sinavlari/` olarak hub altında |
| `/dersler` (planlı) | — | Konu anlatımlı kitaplar |
| `/video-dersler` (planlı) | — | Canlı video dersler (öğretmen); premium |
| `/pratik-bilgiler` (planlı) | — | Pratik bilgiler rehberi |
| `/forum` (planlı) | — | Ehliyet öğrenci forumu |
| `/duello` (planlı) | — | Bilgi düellosu |
| `/app/login.html` | `hosting-web/app/login.html` | W3 — Firebase Auth + kurum seçimi |
| `/admin` | `hosting-admin/admin.html` | Üretim — mevcut admin (değişmedi) |
| `/app/home.html` | `hosting-web/app/home.html` | W3 — korumalı öğrenci panel kabuğu |
| `/app/exams.html` | (planlı) | Deneme sınavları |
| `/app/lessons.html` | (planlı) | Dersler |
| `/app/videos.html` | (planlı) | Video dersler |
| `/app/practical.html` | (planlı) | Pratik bilgiler |
| `/app/forum.html` | (planlı) | Forum |
| `/app/duel.html` | (planlı) | Düello |
| `/app/leagues.html` | (planlı) | Ligler |
| `/app/profile.html` | (planlı) | Profilim |

W1.2 landing: hero (ehliyet portalı), 6 hazırlık modülü, footer. W1.1 SaaS paket/demo bölümleri kaldırıldı.

W1.2 UI polish: ortalanmış marka + logo kilidi header; üst metin nav kaldırıldı; modül kartları accent renk + mini görsel alan.

**W1.2+ (public landing sadeleştirme):** Ana sayfada doğrudan admin linki yok; kurum öğrenci/admin kapısı için ikincil navigasyon: header sol altta **Sürücü Kursları Öğrenci Girişi** → `/panel/` (public üyelik ile birleştirilmez, yalnızca kolaylık linki).

**P1 (panel giriş kapısı):** `hosting-web/panel/index.html` — Öğrenci Girişi → `/app/login.html`, Admin Girişi → `/admin`. Önizleme: (1) **6 eğitim modülü** kartı — public portal ile aynı modül adları; (2) **3 kurum avantajı** kartı (öğrenci paneli, duyuru/mesaj, kurum logosu). Tümü tıklanamaz; public portala link yok. Öğrenci `home.html` giriş sonrası `tenantName` / `tenantLogoUrl` ile kurum kimliğini gösterir (W3.1).

**P2.1 (public auth kabukları):** `hosting-web/uye-giris/index.html`, `hosting-web/kayit/index.html` — yalnızca statik form UI; **Firebase / gerçek giriş-kayıt yok**. Landing header: Üye Girişi → `/uye-giris/`, Kayıt Ol → `/kayit/`. Kurum öğrencileri → `/panel/` notu. Firebase `public_user` akışı P2.2b’de.

**P2.2a (landing modül kilidi):** Misafirde modül kartları üye-giriş modalı açar; kart hedefleri `data-module-href` ile saklanır.

**P2.2b (public Firebase auth):** `public-session.js` (`sa_public_session_v1`), `public-auth.js` (kayıt/giriş/çıkış, `role: public_user`), `/uye-giris/` ve `/kayit/` formları aktif. Landing: giriş sonrası header isim + Çıkış; modül 1 → `cikmis-sorular/`, diğerleri “yakında” modalı. Kurum akışı (`/panel/`, `web-login.js`, `sa_web_session_v1`) ayrı ve dokunulmaz.

**P2.2b polish:** Girişli public header — sol yeşil buton `Merhaba, {firstName}`, sağ altın `Çıkış`; misafirde Üye Girişi / Kayıt Ol / Kurum girişi. Aynı header durumu `/cikmis-sorular/` doğrudan yüklemede (`public-landing-auth.js` + session). Çıkmış sorular grid: İlk Yardım, liste arası reklamdan önce (orta boşluk giderildi).

**M1 (mobil public_user girişi):** `mobile_app` — web’de kayıtlı `public_user` hesapları aynı e-posta/şifre ile mobilde giriş yapabilir (`login.js` `@` dalı, `role === public_user`). Oturum anahtarı: `sa_public_mobile_session_v1` (`public-user-session.store.js`); kurum seçimi / `tenantMemberships` gerekmez; reklam politikası external/market (`userEntitlements.adFree` hariç). Kurum öğrencisi (`student`) akışı değişmedi. **M2:** public ilerleme senkronu (`users/{uid}/...`). **M3:** tenant panel ilerleme görünürlüğü + kurallar.

**P2.5 (zorunlu, henüz yok):** `firestore.rules` — `users/{uid}` için `public_user` create/update whitelist; client rol yazımı production öncesi sıkılaştırılmalı. P2.2b geçici olarak client write kullanır.

**P3.1 (çıkmış sorular hub):** `hosting-web/cikmis-sorular/index.html` — ilk gerçek public içerik modülü. Kanonik URL: `https://surucuakademisi.com/cikmis-sorular/`. Landing ilk modül kartı bu rotaya bağlanır. Misafir erişimli statik hub; 7 kategori kartı (mobil `loadExamList` aileleriyle uyumlu); reklam placeholder kutuları (gerçek AdSense yok). **Firebase, Firestore sınav listesi ve exam runner yok.** Gelecek alt rotalar (henüz dosya yok): `/cikmis-sorular/deneme-sinavlari/`, `/cikmis-sorular/motor-ve-arac-teknigi/`, `/cikmis-sorular/sinav/{examId}`.

Landing modül adları (public): Çıkmış Sorular, Konu Anlatımlı Kitaplar, Pratik Bilgiler Rehberi, Öğrenci Forumu, Sınav Yarışları, Canlı Video Dersler (Öğretmen).

Landing hero: kompakt düzen; slogan «Yapay zeka destekli yeni nesil ehliyet eğitim deneyimi»; modül grid hero’nun hemen altında. Header logosu: `hosting-web/assets/images/logo.png` (kaynak: proje `resimler/logo.png` / `hosting-admin/resimler/logo.png`).

**Premium video (henüz yok):** Bireysel kullanıcı için tek seferlik ~1 yıl erişim (muhtemelen `userEntitlements/{uid}`); kurum tarafı `tenantBilling` Premium Reklamsız + aktif.

**Web reklamları (henüz yok):** Public içerik sayfalarında AdSense; aktif sınav çözüm ekranında agresif reklam yok; premium kurum öğrencilerinde ve satın alınmış video erişiminde reklam yok.

## 8. Sonraki fazlar

| Faz | Kapsam |
|-----|--------|
| **W1** | Public landing (`hosting-web/`) — tamamlandı |
| **W1.1** | Minimalist landing sadeleştirmesi — tamamlandı |
| **W1.2** | Public ehliyet portalı landing (SEO, modül IA, kurum girişi ayrımı) — tamamlandı |
| **W2** | Statik öğrenci giriş kabuğu (kurum seç + kullanıcı/şifre UI, Auth yok) — tamamlandı |
| **W3** | Firebase Auth, kurum seçimi, öğrenci doğrulama, oturum, `home.html` kabuğu — tamamlandı |
| **W3.1** | Home shell: Ana Sayfa kartı kaldırıldı, kurum logosu/monogram, oturumda logo alanları — tamamlandı |
| **P1** | Panel giriş kapısı (`/panel/`) — tamamlandı |
| **P2.1** | Public üye girişi / kayıt statik kabukları (`/uye-giris/`, `/kayit/`) — tamamlandı |
| **P2.2a** | Landing modül kartları statik üye-giriş modalı + auth sayfası marka ortalama — tamamlandı |
| **P2.2b** | Firebase public register/login + `public_user` + landing header/kart kilidi — tamamlandı |
| **P2.5** | Firestore rules `public_user` whitelist — planlı (production öncesi zorunlu) |
| **P3** | Web şifremi unuttum (kurum vs public e-posta ayrımı) — planlı |
| **W4** | Web video ders (read-only, premium / ilk video kuralı) |
| **W5** | Web sınav listesi + çözüm + deneme kaydı |
| **W6** | AdSense slotları (politika kapılı) |
| **W7** | Ders kitabı + pratik rehber read-only |

## 9. W3 öğrenci web girişi

**Scriptler:** Firebase v8 CDN + `assets/js/web-firebase.js`, `web-session.js`, `web-login.js` (login) / `web-home.js` (home).

**Giriş akışı (`/app/login.html`):**

1. `tenants` koleksiyonu: `status in ['active','trial']` (okuma kuralları: public read).
2. Kullanıcı kurum + kullanıcı adı + şifre girer.
3. Kullanıcı adı → `@surucu.app` e-posta eşlemesi (mobil ile aynı).
4. `signInWithEmailAndPassword`.
5. `users/{uid}` okunur; **web yeni kullanıcı oluşturmaz**. `role` yalnızca `student` kabul edilir; `super_admin` / `institution_admin` reddedilir.
6. `tenantMemberships/{uid}_{tenantId}` (veya `uid` sorgusu) ile seçili kurumda `status===active`, `role===student` doğrulanır.
7. `tenants/{tenantId}` `active` veya `trial` olmalı.
8. Oturum yazılır → `home.html` yönlendirme.

**Oturum anahtarları (`sessionStorage`):**

| Anahtar | İçerik |
|---------|--------|
| `sa_selected_tenant_id` | Seçili kurum id (mobil ile uyumlu) |
| `sa_web_session_v1` | JSON: `uid`, `tenantId`, `tenantName`, `tenantRole`, `membershipId`, `username`, `displayName`, `globalRole`, `tenantLogoUrl`, `showInstitutionLogo`, `savedAt` |

**Kurum logosu (W3.1):** Girişte `tenants/{tenantId}` alanları (`logoUrl`, `logo`, `logoPath`, `logoFile`) + `tenantSettings.showInstitutionLogo` okunur. Çözümleme: `assets/js/web-tenant-brand.js` → `resolveWebTenantLogoUrl`; yerel yedek `hosting-web/assets/tenant-logos/{tenantId}.png` (dosya yoksa monogram).

**Home (`/app/home.html`):** Firebase `currentUser` + `sa_web_session_v1` zorunlu; 8 modül kartı (Ana Sayfa yok), hepsi devre dışı. Header’da kurum logosu veya monogram. Çıkış: `signOut` + oturum temizliği.

**W3 Firestore:** yalnızca okuma (`tenants`, `users`, `tenantMemberships`). Yazma yok.

**Landing (`index.html`):** Firebase yok. Header **Üye Girişi** → `/uye-giris/`, **Kayıt Ol** → `/kayit/` (public kullanıcı; kurum/admin değil). Modül gating P2.3’te.

## 10. Statik public landing kapsam dışı (W1.2)

`hosting-web/index.html` dosyasında **yok:**

- Firebase SDK  
- Firestore  
- AdSense  
- Ödeme / satın alma  

Öğrenci uygulama sayfalarında (`/app/*`, W3+) ve planlı public modül sayfalarında (W5+) içerik runtime henüz yok.
