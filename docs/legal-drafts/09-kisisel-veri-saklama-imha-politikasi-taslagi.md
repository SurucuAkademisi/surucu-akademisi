# Kişisel Veri Saklama ve İmha Politikası — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2B-0.1  
**Yürürlük:** Yok (yayımlanmamıştır)  
**Otomasyon durumu:** **NOT IMPLEMENTED**

---

## A. DAHİLİ UYARI

Nihai saklama/imha politikası değildir. Süreler uydurulmamıştır. Birincil kullanıcı belgesinin silinmesi tek başına tüm ilişkili kayıtların silindiği anlamına gelmez. Kaskad boşlukları açıktır.

---

## B. POLİTİKA TASLAĞI

### 1. Amaç

Kişisel verilerin ne kadar süreyle saklanacağı, ne zaman silineceği/imha edileceği veya anonimleştirileceğine dair çerçeve oluşturmak.

### 2. Kapsam

Web, mobil, Admin panelleri, Firebase Auth/Firestore/Storage/Functions, Contact Requests, mesajlar, forum, eğitim ilerlemesi ve ilgili yedekler.

### 3. Tanımlar

- **Saklama:** Amaca bağlı tutma  
- **Silme:** Erişilebilir kaydın kaldırılması  
- **İmha:** Geri döndürülemez yok etme  
- **Anonimleştirme:** Kimlikle ilişkilendirilemez hale getirme  
- **Legal hold:** Uyuşmazlık/güvenlik nedeniyle erteleme  

### 4. Veri sorumlusu

**[[VERI_SORUMLUSU_TICARI_UNVANI]]** · **[[MERKEZ_ADRESI]]** · **[[ILETISIM_EPOSTASI]]** · **[[YETKILI_KISI_BIRIMI]]**

### 5. Roller

- Super Admin: işletme erişimi / silme callables  
- Kurum yöneticisi: kendi kurum kayıtları  
- Hukuk/uyum birimi: **[[YETKILI_KISI_BIRIMI]]** *(oluşturulacak)*  
- İşlemci sağlayıcılar: Google/Firebase, OpenAI, AdMob vb.  

### 6. Saklama ortamları

Firestore, Auth, Storage, Functions logları, istemci depoları, üçüncü taraf işlemci sistemleri, yedekler *(doğrulanmamış)*.

### 7–8. Gerekçeler ve ilkeler

Asgari veri, amaçla sınırlılık, süre sınırlılığı. Süre: **[[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]]** veya “hesap ömrü + hukuken incelenecek kapanış sonrası süre”.

### 9–12. Silme / imha / anonimleştirme / periyodik imha

Periyodik imha otomasyonu **yoktur**. İlgili kişi talebiyle silme şartlara bağlıdır. Legal hold silmeyi erteleyebilir.

### 13–15. Yedek, işlemci, güvenlik

Yedek silme doğrulanmamıştır. Üçüncü taraf silme yayılımı tam değildir. Mutlak güvenlik iddiası yoktur.

### 16. Saklama matrisi

| Veri/kayıt | İlgili kişi grubu | Amaç | Sistem/yol | Tetikleyici | Aday süre | Gerekçe | Yöntem | Sorumlu | Otomasyon | İnceleme |
|------------|-------------------|------|------------|-------------|-----------|---------|--------|---------|-----------|----------|
| Kullanıcı hesapları | Public / öğrenci / admin | Üyelik | `users/{uid}`, Auth | Hesap kapanışı | [[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]] | İş / yasal | Auth+doc silme + kaskad | SA / sistem | Eksik | Gerekli |
| Auth tanımlayıcıları | Üyeler | Kimlik doğrulama | Firebase Auth | Hesap silme | Aynı | Güvenlik | Auth delete | SA / callable | Kısmi | Gerekli |
| Public profiles | Public | Görünür profil | `publicProfiles` | Hesap silme | Aynı | Ürün | Doc silme | Sistem | Eksik | Gerekli |
| Kurum üyelikleri | Öğrenci / kurum | Erişim | `tenantMemberships` | Üyelik sonu / silme | Aynı | Kurumsal | Doc silme | SA / IA callable | Kısmi | Gerekli |
| Kurum öğrenci kayıtları | Öğrenci | CRM | users + membership + payments | Üyelik/silme | Aynı | Kurumsal | Callable kaskad | IA/SA | Kısmi | Gerekli |
| Sınav denemeleri | Öğrenci / public | Eğitim | `web_exam_attempts` / tenant attempts | Hesap/amaç sonu | Aynı | Eğitim | Doc silme | Sistem | Eksik | Gerekli |
| Ders ilerlemesi | Aynı | Eğitim | lesson progress paths | Aynı | Aynı | Eğitim | Doc silme | Sistem | Eksik | Gerekli |
| Video ilerleme/erişim | Premium | Yetki | entitlements + progress | Yetki sonu | Aynı | Ürün | Revoke + silme | SA | Kısmi | Gerekli |
| Forum gönderileri | Katılımcılar | Topluluk | `forum_posts` | Silme talebi/moderasyon | Aynı | Topluluk | Doc silme | SA/IA/yazar | Manuel | Gerekli |
| Forum yanıtları | Katılımcılar | Topluluk | comments/replies | Aynı | Aynı | Topluluk | Doc silme | Aynı | Manuel | Gerekli |
| Düello kayıtları | Oyuncular | Oyun | `duels`, invites | Aynı | Aynı | Ürün | Doc silme | Sistem | Eksik | Gerekli |
| Lig kayıtları | Oyuncular | Sıralama | `duelLeague` | Aynı | Aynı | Ürün | Doc silme | Sistem | Eksik | Gerekli |
| Mesajlar | Gönderen/alan | İletişim | mailboxes | Gizleme ≠ imha | Aynı | Destek | Soft-hide / silme | Kullanıcı/SA | Soft-hide | Gerekli |
| Bildirimler | Alıcılar | Bilgilendirme | `notifications` | Operasyon sonu | Kısa operasyonel + inceleme | Operasyon | Doc silme | SA | Eksik | Gerekli |
| Cihaz tokenleri | Mobil kullanıcı | Push | `deviceTokens` | Çıkış/geçersiz | Token ömrü | Operasyon | Invalidate | İstemci/CF | Kısmi | Gerekli |
| Contact Requests | Başvuran | Destek | `contactRequests` | Kapanış | [[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]] | Destek | Doc silme | SA | Yok | Gerekli |
| Kapalı Contact Requests | Başvuran | Arşiv | Aynı | closed | [[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]] | Hesap verebilirlik | Zamanlanmış silme | Sistem | Yok | Gerekli |
| Status history | Başvuran/SA | Denetim | request alanı | Talep ile | Talep ile | Denetim | Talep ile | Sistem | Yok | Gerekli |
| Super Admin iç notları | — / başvuranla ilişkili | İç süreç | `adminNote` | Talep ile | Talep ile | İç | Talep ile | SA | Yok | Gerekli |
| Rate-limit kayıtları | Başvuran (hash) | Spam önleme | `contactRequestRateLimits` | Pencere | ~30dk / 24s (kod) | Güvenlik | Üzerine yazma | CF | Var (pencere) | — |
| Öğrenci ödemeleri | Öğrenci/kurum | Bakiye | `studentPayments` | Üyelik/yasal | [[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]] | Ticari/vergi? | Doc silme | IA/SA | Manuel | Gerekli |
| Premium/ad-free | Kullanıcı | Yetki | `userEntitlements` | Revoke | Aynı | Ürün | Update/silme | SA | Kısmi | Gerekli |
| Website CMS | Ziyaretçi | İçerik | `siteContent` | Yayın politikası | İş ihtiyacı | CMS | SA yazma | SA | Manuel | — |
| Admin aktivite | Admin | Denetim | statusHistory, paymentLog, CMS *By | Olay | [[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]] | Denetim | Politika | SA | Kısmi | Gerekli |
| Mevzuat AI | Admin/kurum | Destek | OpenAI + logs | Oturum | Prompt: işlemci politikası; log: kısa | Destek | İşlemci talep | Birim | Kısmi | Gerekli |
| Storage dosyaları | Kullanıcı/kurum | Medya | Storage paths | Silme talebi | Aynı | Ürün | Object delete | SA/owner | Kısmi | Gerekli |
| Teknik loglar | — | Güvenlik | Functions logs | Operasyon | Kısa + inceleme | Güvenlik | Rotasyon | Ops | UNVERIFIED | Gerekli |
| Notice acknowledgement | Contact başvuran | Aydınlatma kaydı | `noticeAcknowledged`/`noticeVersion` | Talep ile | Talep ile | Hesap verebilirlik | Talep ile | Sistem | Yok | Gerekli |
| Silinen hesap yedekleri | Eski kullanıcı | Yedek | Backup | Yedek politikası | UNVERIFIED | Felaket kurtarma | Backup expiry | Ops | UNVERIFIED | Gerekli |

### 17. İmha yöntemleri (kavramsal)

- Firestore document deletion  
- Auth-account deletion  
- Storage-object deletion  
- Token invalidation/removal  
- Access revocation  
- Logical deletion / soft-hide  
- Permanent destruction  
- Anonymization / aggregation  
- Backup expiry  
- Third-party processor deletion request  

Birincil `users` belgesinin silinmesi tek başına tam imha sayılmaz.

### 18. Mevcut uygulama boşlukları

- Zamanlanmış saklama otomasyonu yok  
- Self-servis hesap silme yok/eksik  
- Yönetici silmede kaskad eksikleri olabilir  
- Mesaj gizleme ≠ kalıcı imha  
- Contact Requests için zamanlanmış silme yok  
- Kapalı talepler ve iç notlar saklanır  
- Yedek silme doğrulanmamış  
- Üçüncü taraf silme yayılımı tam değil  
- Mobil mağaza silme gereksinimleri eksik  

### 19. Sürüm

**[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]** · **[[VERBIS_DURUMU]]**

---

## C. TEKNİK BAĞIMLILIKLAR (L7)

Zamanlanmış Functions; hesap silme callable’ları; mailbox kalıcı silme; contact request TTL; Storage/Auth kaskad; işlemci silme talepleri; yedek politikası.
