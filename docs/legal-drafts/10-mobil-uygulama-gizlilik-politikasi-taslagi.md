# Mobil Uygulama Gizlilik Politikası — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2C-A-0.1  
**Yürürlük:** Yok (yayımlanmamıştır)  
**Kamu URL:** `[[GIZLILIK_POLITIKASI_PUBLIC_URLSI]]` — **MISSING**  
**Uygulama içi erişim:** **UNVERIFIED / INCOMPLETE**

---

## A. DAHİLİ UYARI (KULLANICIYA GÖSTERİLMEZ)

Bu metin nihai mobil gizlilik politikası değildir; mağaza beyanı veya yayımlanmış politika sayılmaz. Çekirdek işletme kimliği belge 18’de doğrulanmıştır; hukuki sebepler, saklama süreleri, yurt dışı aktarım mekanizması, reklam kişiselleştirme/izin ve reşit olmayan kullanıcı değerlendirmesi **LEGAL REVIEW REQUIRED**.

**Hesap silme:** Mobil self-servis silme **NOT IMPLEMENTED**. Dış hesap silme kaynağı **NOT IMPLEMENTED**. Kullanıcıya yönelik metinde silmenin “şu an mevcut” olduğu ima edilmemelidir; mevcut boşluklar dahili / teknik bağımlılık bölümlerinde tutulur.

Do not treat this draft as store-compliant or publication-ready.

---

## B. KULLANICIYA YÖNELİK TASLAK METİN

### 1. Veri sorumlusu

**Bilal Aksoy – Sürücü Akademisi** (Şahıs işletmesi)  
Gerçek kişi işletmeci: **Bilal Aksoy** · Marka: **Sürücü Akademisi**  
**Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye**  
**info@surucuakademisi.com** · **+90 532 058 88 46** · KEP: **PENDING / NOT PROVIDED**  
Başvuru: aynı adres · Yetkili: **Bilal Aksoy**  
Web: **https://surucuakademisi.com**  
*(KEP doğrulanmamıştır; başvuru kanalı olarak kullanılmaz.)*

**[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]**

### 2. Politika kapsamı

Bu politika, Sürücü Akademisi mobil uygulaması üzerinden işlenen kişisel verilere ilişkindir. Web sitesi, Admin panelleri ve kurum panelleri için ayrıca yayımlanan metinler geçerli olabilir.

### 3. Desteklenen uygulama platformları

- **Android:** Mevcut Capacitor tabanlı uygulama (`io.surucuakademisi.app`)  
- **iOS:** Yayım planı / değerlendirme aşamasında olabilir; bu taslakta **canlı mağaza yayını doğrulanmış kabul edilmez**  
- Mağaza bağlantıları (gelecek): `[[GOOGLE_PLAY_UYGULAMA_URLSI]]` · `[[APPLE_APP_STORE_UYGULAMA_URLSI]]`

### 4. Kullanıcı ve hesap türleri

- Ziyaretçi / oturum açmamış kullanım (sınırlı)  
- Kayıtlı bireysel (public) kullanıcı  
- Premium / yetkili bireysel kullanıcı  
- Kurum öğrencisi  
- Kurum temsilcisi *(mobil öğrenci uygulamasının birincil hedefi değildir; erişim varsa ayrıca değerlendirilir)*  
- Super Admin *(iç işletme; genel mobil gizlilik kapsamı dışıdır)*

### 5. Hesap oluşturma ve kimlik doğrulama

- E-posta ve parola ile kayıt / giriş Firebase Authentication üzerinden yapılır.  
- Parolalar Firestore’da düz metin olarak saklanmaz; kimlik doğrulama Firebase Auth altyapısındadır.  
- Oturum sürekliliği (authentication persistence) reklam tercihinden ayrıdır.

### 6. Google Sign-In

Mobil uygulamada Google ile giriş kullanılabilir. Google hesap tanımlayıcıları ve profil bilgileri Google hizmetleri üzerinden işlenebilir. Google’ın kendi gizlilik koşulları ayrıca geçerlidir.

### 7. Hesap ve profil bilgileri

İşlenebilecek kategoriler (doğrulanan kullanım çerçevesinde):

- Ad / görünen ad  
- E-posta adresi  
- Firebase UID  
- Hesap rolü / durum bilgisi  
- Kurum / tenant ilişkisi  
- Kimlik doğrulama sağlayıcı bilgisi  
- Profil görseli (`profilePhotoUrl`; Storage: `user-profiles/{uid}/avatar.jpg`)

### 8. Kurum öğrenci hesapları

Kurum öğrencisi hesapları kurum temsilcisi veya Super Admin tarafından oluşturulup yönetilebilir. Üyelik süresi sınırlı olabilir. Üyelik bitişi veya deaktivasyon, hesap silme ile aynı değildir.

### 9. Eğitim etkinliği ve ilerleme

- Sınav denemeleri  
- Dijital ders ilerlemesi  
- Video ders erişimi / ilerleme (yetki kayıtlarına bağlı)  
- Pratik rehber kullanımı (saklanan ilerleme varsa)

### 10. Forum ve kullanıcı içeriği

Forum gönderileri ve yanıtlar kullanıcı tarafından üretilen içeriktir; diğer kullanıcılar tarafından görülebilir.

### 11. Düello ve lig bilgileri

Davetler, sonuçlar ve lig sıralama kayıtları yarışma/eğitim özellikleri için işlenebilir.

### 12. Mesajlar ve bildirimler

Uygulama içi mesajlar ve bildirim kayıtları hizmet, güvenlik veya eğitim iletişimi için kullanılabilir. Her bildirim ticari pazarlama sayılmaz.

### 13. Anlık bildirim (push) tokenleri

- OS bildirim izni istenebilir (ön bilgilendirme + `PushNotifications.requestPermissions`).  
- FCM / cihaz tokeni `users/{uid}/deviceTokens/{token}` altında kullanıcı ve cihaz/platform bilgisiyle ilişkilendirilebilir.  
- Hizmet, güvenlik, eğitim ve duyuru bildirimleri gönderilebilir.  
- Ticari / pazarlama push sınıflandırması ayrı değerlendirme gerektirir.  
- Token kaldırma / geçersizleştirme boşlukları olabilir.  
- Kullanıcı OS seviyesinde bildirim tercihlerini kontrol edebilir.

### 14. Cihaz ve teknik bilgiler

Uygulama çalışması için platform bilgisi (ör. android/ios), temel teknik günlükler ve yerel tercihler (ör. `localStorage` / `sessionStorage` anahtarları) kullanılabilir. **Hassas GPS konum toplandığı doğrulanmamıştır.**

### 15. Mobil reklamlar

- Google Mobile Ads / AdMob entegrasyonu mevcuttur.  
- Mevcut yapılandırma **test / geliştirme** odaklıdır (`initializeForTesting: true`, Google test uygulama ve reklam birimi kimlikleri).  
- Ödüllü (rewarded) ve geçiş (interstitial) reklam çağrıları kodda yer alır.  
- Premium / `adFree` yetkisi reklam gösterimini sınırlayabilir.  
- Kişiselleştirilmiş reklamın üretimde açık olduğu **doğrulanmamıştır**.  
- Çalışan bir rıza yönetim platformu (CMP) **doğrulanmamıştır**.  
- Reklam rızası üyelikle paketlenmemelidir.  
- Reşit olmayanlara yönelik reklam değerlendirmesi: **REQUIRED**  

`TECHNICAL AND LEGAL VERIFICATION REQUIRED`

### 16. Premium ve reklamsız yetkiler

Video / reklamsız gibi özellikler hesap veya kurum yetki kayıtlarına bağlı olabilir. Canlı self-servis online satın alma şu an aktif kabul edilmez.

### 17. Medya ve Storage kullanımı

Profil görseli yükleme Firebase Storage kullanır. Dosya seçimi sistem dosya seçicisi üzerinden yapılabilir; Android uygulama manifestinde ayrı `CAMERA` izni doğrulanmamıştır.

### 18. Mevzuat Asistanı (mobil)

Mevzuat Asistanı (OpenAI destekli) öncelikle Admin / kurum araçları kapsamında doğrulanmıştır. Mobil öğrenci kullanıcısının bu araca prompt gönderdiği **doğrulanmamıştır**. Bu durumda OpenAI’ye mobil kullanıcıdan doğrudan veri aktığı varsayılmaz.

### 19. Üçüncü taraf hizmetler (özet tablo)

| Hizmet | Veri kategorisi | Amaç | Güncel durum | Olası yurt dışı işleme | Hukuki inceleme |
|--------|-----------------|------|--------------|------------------------|-----------------|
| Firebase Authentication | E-posta, Auth UID, sağlayıcı | Kimlik doğrulama | Aktif | Olası (Google altyapısı) | `[[YURT_DISI_AKTARIM_MEKANIZMASI]]` — REQUIRED |
| Cloud Firestore | Hesap, ilerleme, içerik meta | Uygulama verisi | Aktif (europe-west3) | Functions vb. yollar ayrı | REQUIRED |
| Firebase Storage | Profil görseli | Medya | Aktif | Olası | REQUIRED |
| Firebase Cloud Messaging | Cihaz tokeni, bildirim | Push | Aktif | Olası | REQUIRED |
| Google Sign-In | Hesap tanımlayıcıları / profil | Giriş | Aktif (mobil) | Olası | REQUIRED |
| Google Mobile Ads / AdMob | Reklam / cihaz sinyalleri | Reklam (test/dev) | Test/geliştirme | Olası | `TECHNICAL AND LEGAL VERIFICATION REQUIRED` |
| Capacitor / native köprü | Teknik | Native özellikler | Aktif | — | — |
| Google Play hizmetleri | Cihaz / Play | Dağıtım, reklam, auth | Android’de tipik | Olası | REQUIRED |
| Apple hizmetleri | — | Gelecek iOS | Canlı yayım doğrulanmadı | Olası | REQUIRED (iOS yayımında) |
| YouTube (gömülü / bağlantı) | Video izleme etkileşimi | Eğitim videosu | Kullanılır | Olası | REQUIRED |
| OpenAI | Prompt/çıktı | Mevzuat Asistanı | Mobil öğrenci için UNVERIFIED | Olası | REQUIRED |

Nihai aktarım mekanizması tamamlanmış sayılmaz.

### 20. Uluslararası veri işleme

Firebase Auth, FCM, Storage, Hosting, Cloud Functions (ör. us-central1) ve Google / reklam hizmetleri Türkiye dışında işleme içerebilir. Mekanizma: `[[YURT_DISI_AKTARIM_MEKANIZMASI]]` — **LEGAL REVIEW REQUIRED**. Verilerin yalnızca Türkiye’de kaldığı iddia edilmez.

### 21. Veri saklama

Saklama süreleri: `[[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]]`. Ayrıntılar Saklama ve İmha Politikası taslağına (L2B) tabidir. Zamanlanmış saklama otomasyonu **NOT IMPLEMENTED**.

### 22. Hesap ve veri silme — mevcut durum (dahili açıklama; yayımlamada uygulanmış gibi sunulmaz)

- Mobil self-servis hesap silme: **NOT IMPLEMENTED / UNVERIFIED**  
- Dış kamu silme kaynağı: **NOT IMPLEMENTED** (`[[HESAP_SILME_PUBLIC_URLSI]]`)  
- Deaktivasyon ≠ silme  
- Birincil hesap kaydının silinmesi tüm ilişkili kayıtları silmez  
- Sınırlı kayıtlar için yasal saklama gerekebilir  
- Tam silme iş akışı mağaza / KVKK uyumu için **release dependency**  

Gelecek kullanıcı metni yalnızca uygulama sonrası etkinleştirilir; süre: `[[HESAP_SILME_TAMAMLANMA_SURESI]]`; destek: `[[HESAP_SILME_DESTEK_KANALI]]`.

### 23. Mobil izinler

| İzin / özellik | Kaynak | Beyan | Runtime istek | Kullanım / amaç | Gerekli? | Reddedilince |
|----------------|--------|-------|---------------|-----------------|----------|--------------|
| `INTERNET` | App manifest | Evet | Sistem | Ağ iletişimi | Evet | Uygulama çalışmaz |
| `ACCESS_NETWORK_STATE` | AdMob plugin manifest | Evet (birleşik) | — | Reklam / ağ durumu | Reklam için tipik | Reklam etkilenir |
| `POST_NOTIFICATIONS` | Push plugin | Plugin izin modeli | `requestPermissions` | Push bildirimleri | İsteğe bağlı | Push kurulmaz |
| Dosya / görsel seçimi | Sistem picker | Ayrı CAMERA izni yok | Kullanıcı seçimi | Profil fotoğrafı | İsteğe bağlı | Foto yüklenmez |
| Hassas konum | — | Doğrulanmadı | Hayır | — | — | — |
| Kişiler / mikrofon | — | Doğrulanmadı | Hayır | — | — | — |

İzin yalnızca bağımlılıkta var diye veri toplandığı anlamına gelmez.

### 24. Güvenlik önlemleri

Firebase Auth, HTTPS/TLS (sağlayıcı varsayılanları), erişim kuralları ve rol bazlı erişim kullanılır. Mutlak güvenlik, uçtan uca şifreleme veya bağımsız sertifikasyon iddiası yoktur.

### 25. Olası reşit olmayan kullanıcılar

**[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]** · Reklam / çocuk yönelimli işlem değerlendirmesi: **REQUIRED**

### 26. Kullanıcı hakları

KVKK kapsamındaki haklar için İlgili Kişi Başvuru Formu taslağı ve kanallar geçerlidir. Her talep otomatik kabul edilmez.

### 27. Politika değişiklikleri

Politika güncellenebilir; yürürlük tarihi ve sürüm alanı kullanılır.

### 28. İletişim

**info@surucuakademisi.com** · **+90 532 058 88 46** · **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** · Yetkili: **Bilal Aksoy**

### 29. Yürürlük ve sürüm

**[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]**

### 30. Kontrollü yer tutucular

Çekirdek kimlik belge 18’den doldurulmuştur. Hâlâ PENDING: `[[GIZLILIK_POLITIKASI_PUBLIC_URLSI]]`, `[[GOOGLE_PLAY_UYGULAMA_URLSI]]`, `[[APPLE_APP_STORE_UYGULAMA_URLSI]]`, `[[HESAP_SILME_PUBLIC_URLSI]]`, `[[HESAP_SILME_TAMAMLANMA_SURESI]]`, `[[HESAP_SILME_DESTEK_KANALI]]`, `[[YURT_DISI_AKTARIM_MEKANIZMASI]]`, `[[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]]`, `[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]`, `[[HUKUKI_SEBEP_NIHAI_INCELEME_GEREKLI]]`, KEP / MERSİS / vergi no.

---

## C. DAHİLİ HUKUKİ İNCELEME NOTLARI

1. Microsoft girişi UI’da gizli / aktif sunulmamalı; foundation kodu olsa da “aktif Microsoft login” denmez.  
2. AdMob üretim canlısı ve kişiselleştirme durumu doğrulanmadan kesin dil kullanılmaz.  
3. Crashlytics / Analytics paket bağımlılığında aktif olarak doğrulanmadı; “aktif” denmez.  
4. Hesap silme kullanıcı metni ancak teknik + hukuki tamamlanınca yayımlanır.  
5. Hukuki sebepler: `[[HUKUKI_SEBEP_NIHAI_INCELEME_GEREKLI]]`.

## D. TEKNİK UYGULAMA BAĞIMLILIKLARI

- Kamu gizlilik URL’si ve uygulama içi link  
- Hesap silme (in-app + dış kaynak) ve kaskad  
- AdMob üretim kimlikleri / CMP / kişiselleştirme tercihi  
- Token invalidation  
- iOS yayım ve App Privacy formu (canlı değilse beyan yok)  
- Mağaza Data Safety / App Privacy hizalaması
