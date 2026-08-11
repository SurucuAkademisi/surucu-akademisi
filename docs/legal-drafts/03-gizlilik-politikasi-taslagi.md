# Gizlilik Politikası — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2A-0.1  
**Yürürlük:** Yok (yayımlanmamıştır)

---

## A. DAHİLİ UYARI (KULLANICIYA GÖSTERİLMEZ)

Bu politika taslağı kamuya bağlanmamalıdır. Çekirdek işletme kimliği belge 18’de doğrulanmıştır; saklama süreleri, yurt dışı aktarım mekanizması ve kalan sicil alanları tamamlanmadan “nihai gizlilik politikası” olarak sunulamaz. **LEGAL REVIEW REQUIRED**.

Mutlak güvenlik veya “veriler asla yurt dışına çıkmaz / hiçbir üçüncü tarafla paylaşılmaz” ifadeleri **kullanılmamıştır ve kullanılmamalıdır**.

---

## B. KULLANICIYA YÖNELİK TASLAK METİN

### 1. Taslak uyarısı

Bu metin **iç inceleme taslağıdır**. Nihai yayımlanmış gizlilik politikası değildir.  
Veri sorumlusu: **Bilal Aksoy – Sürücü Akademisi** (Şahıs işletmesi) · **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye**  
Gerçek kişi işletmeci: **Bilal Aksoy** · Marka: **Sürücü Akademisi**  
İletişim: **info@surucuakademisi.com** · **+90 532 058 88 46** · Web: **https://surucuakademisi.com**  
**[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]**

### 2. Kapsam

Bu politika; Sürücü Akademisi dijital eğitim platformunun kişisel veri işleme pratiklerini genel olarak açıklar. Ayrıntılı KVKK aydınlatma metinleri (genel ve iletişim formu) ile birlikte okunmalıdır.

### 3. Platform kanalları

- Kamu web sitesi  
- Android uygulaması (Capacitor tabanlı)  
- iOS uygulaması: yayım planı / süreçte olabilir; bu taslak tarihinde **canlı mağaza yayını doğrulanmış kabul edilmez**  
- Super Admin ve Kurum Yönetici panelleri  

### 4. Hesap ve kimlik doğrulama

- Web: e-posta / parola ile kayıt ve giriş  
- Mobil: e-posta / parola; **Google Sign-In** (Android)  
- Microsoft ile giriş: teknik olarak **devre dışı**  
- Parolalar düz metin saklanmaz; Firebase Authentication kullanılır  
- Oturum bilgileri tarayıcı/oturum depolarında tutulabilir  

### 5. Eğitim faaliyetleri ve ilerleme

Sınav denemeleri, ders ve pratik rehber ilerleme kayıtları hesabınıza bağlı olarak işlenebilir. Amaç: eğitimin sunulması, ilerlemenin gösterilmesi ve kurumsal takip (kurum öğrencileri için).

### 6. Kurum kullanıcı ilişkileri

Kurum yöneticileri kendi kurumlarındaki öğrenci hesaplarını oluşturabilir, üyelik süresini yönetebilir, ödeme/bakiye notlarını tutabilir ve mesajlaşabilir. Super Admin çapraz kurum yetkilerine sahiptir.

### 7. Forum, mesajlar, düello ve ligler

Kullanıcı tarafından oluşturulan içerikler (gönderi, yorum, mesaj, düello sonuçları, lig istatistikleri, çevrimiçi varlık) ilgili özelliklerin işletilmesi için işlenir. Forum kuralları ayrı bir topluluk metni ile desteklenmelidir (henüz L2A kapsamında değildir).

### 8. İletişim talepleri (Contact Requests)

- Kayıtlar `contactRequests` koleksiyonunda tutulur  
- Oluşturma: sunucu tarafı callable  
- Doğrudan istemci yazması: reddedilir  
- Okuma: **yalnızca Super Admin**  
- İç notlar (`adminNote`): Super Admin  
- Aydınlatma bildirimi: `noticeAcknowledged` (okundu / bilgi edinildi — teknik kayıt)  
- Aydınlatma sürümü: `noticeVersion` (şu an `"contact-v1"`)  
- Bu kayıt pazarlama, reklam, çerez veya genel açık rıza kaydı **değildir**  
- Kamuya açık form: henüz yayımlanmamıştır (**BLOCKED**)  

Ayrıntı: İletişim Formu Aydınlatma Metni taslağı.

### 9. Mobil bildirimler

Android uygulamasında anlık bildirim için cihaz belirteci (FCM token) kaydedilebilir. Bildirim izni işletim sistemi ve uygulama içi ön bilgilendirme akışına bağlıdır. Ticari pazarlama bildirimleri ayrı rıza/tercih olmadan bu politikada “açık” sayılmaz.

### 10. Reklam ve Premium erişim

- **Web AdSense:** aktif değildir (yer tutucu alanlar)  
- **Mobil AdMob:** mevcuttur; şu an test/geliştirme yapılandırması  
- Premium / reklamsız gibi yetkiler `userEntitlements` üzerinden yönetilebilir  
- Kişiselleştirilmiş reklam tercihleri mobil özel açıklama gerektirir  

### 11. Yapay zekâ destekli Mevzuat Asistanı

Mevzuat Asistanı idari/destek amaçlı bir araçtır. Kullanıcı soruları ve ilgili mevzuat parçaları yapay zekâ sağlayıcısına (OpenAI) iletilebilir.  
Çıktılar **bilgilendirme amaçlıdır**; resmî hukuki mütalaa veya MEB onayı değildir.

### 12. Dış hizmet sağlayıcılar

Envanterde doğrulananlar arasında: Firebase Authentication, Cloud Firestore, Firebase Hosting, Cloud Functions, Firebase Storage, Firebase Cloud Messaging, Google Sign-In (mobil), AdMob (mobil), YouTube (yerleşik içerik), OpenAI (Mevzuat Asistanı).

Canlı ödeme sağlayıcı entegrasyonu **yoktur** (stub / aktif değil).

### 13. Yurt dışı işleme

Uluslararası hizmet sağlayıcılar nedeniyle veriler Türkiye dışında işlenebilir.  
Mekanizma: **[[YURT_DISI_AKTARIM_MEKANIZMASI]]** · Durum: **[[YURT_DISI_AKTARIM_MEKANIZMASI_HUKUKI_INCELEME_GEREKLI]]**

“Verileriniz hiçbir zaman yurt dışına aktarılmaz” ifadesi kullanılmaz.

### 14. Güvenlik

Yetkilendirme kuralları, sunucu tarafı doğrulama ve asgari veri ilkesi hedeflenir.  
“Verileriniz yüzde yüz güvendedir” ifadesi kullanılmaz.

### 15. Saklama ve silme

**[[SAKLAMA_SURESI_HUKUKI_INCELEME]]**  
Saklama otomasyonu henüz tam değildir. Uyuşmazlık/güvenlik tutmaları silmeyi geciktirebilir.

### 16. Hesap silme durumu

- Web ve mobil **self-servis hesap silme** şu an doğrulanmış değildir / eksiktir  
- Yönetici silme işlemleri her ilişkili kaydı otomatik olarak kaskad silmeyebilir  
- Hesap ve veri silme iş akışı sonraki zorunlu fazdır  
- Mobil mağaza hesap silme gereksinimleri nihai mağaza uyumundan önce uygulanmalıdır  

### 17. Kullanıcı hakları

KVKK kapsamındaki haklarınız için: **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye**, **info@surucuakademisi.com**, **+90 532 058 88 46**, Yetkili: **Bilal Aksoy**.

### 18. Çocuklar ve reşit olmayanlar

**[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]**  
Doğum tarihi alanı veya yaş kapısı doğrulanmamıştır. Gereksiz DOB toplanmamalıdır.

### 19. Politika değişiklikleri

Yayımlanmış sürümler **[[BELGE_SURUMU]]** ve **[[YURURLUK_TARIHI]]** ile izlenecektir. Bu taslak sürüm yayımlanmış sayılmaz.

### 20. İletişim

**Bilal Aksoy – Sürücü Akademisi** · **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** · **info@surucuakademisi.com** · **+90 532 058 88 46**

### 21. Kontrollü yer tutucular

Çekirdek kimlik belge 18’den doldurulmuştur. Saklama, aktarım, yaş ve VERBİS yer tutucuları hâlâ PENDING / README listesine tabidir. VERBİS: **[[VERBIS_DURUMU]]**.

---

## C. DAHİLİ HUKUKİ İNCELEME NOTLARI

1. iOS canlı yayını doğrulanmadan “iOS uygulamamız vardır” kesin dili kullanılmamalıdır.  
2. AdMob test kimlikleri üretim kimlikleriyle karıştırılmamalıdır.  
3. OpenAI aktarımı aydınlatma + mekanizma ile birlikte ele alınmalıdır.  
4. Hesap silme eksikliği mağaza ve KVKK silme talepleri açısından risklidir.
