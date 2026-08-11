# Genel KVKK Aydınlatma Metni — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2A-0.1  
**Yürürlük:** Yok (yayımlanmamıştır)

---

## A. DAHİLİ UYARI (KULLANICIYA GÖSTERİLMEZ)

Bu metin **nihai yayımlanmış aydınlatma metni değildir**.

- Çekirdek işletme kimliği belge 18’de doğrulanmıştır; MERSİS / KEP / sicil / vergi no gibi alanlar **PENDING** kalır.
- Hukuki sebepler ve saklama süreleri **nihai hukuki inceleme** gerektirir.
- Yurt dışı aktarım mekanizması henüz seçilmemiştir.
- Bu metin kamuya açık sayfaya bağlanmamalı, Contact CMS’e “nihai metin” olarak yapıştırılmamalıdır.
- Avukat onayı yoktur. **LEGAL REVIEW REQUIRED**.

**Teknik bağımlılıklar:** L3 kamu sayfaları; L6 ilgili kişi başvuru süreci; L7 saklama/imha otomasyonu; kalan kimlik/sicil alanları.

---

## B. KULLANICIYA YÖNELİK TASLAK METİN

### 1. Veri sorumlusu

Kişisel verilerinizin veri sorumlusu:

**Bilal Aksoy – Sürücü Akademisi** (Şahıs işletmesi)  
Gerçek kişi işletmeci: **Bilal Aksoy** · Marka: **Sürücü Akademisi**  
*(Vergi levhasında “Ticaret Unvanı” boştur; “Sürücü Akademisi” tescilli ticaret unvanı olarak sunulmaz.)*  
Adres: **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye**  
MERSİS: **PENDING / NOT CURRENTLY AVAILABLE**  
Vergi dairesi / no: **Alemdar Vergi Dairesi** / **PENDING_VERIFIED_ENTRY**  
Ticaret / esnaf sicil no: **PENDING VERIFICATION WITH ACCOUNTANT / REGISTRY**  
İletişim: **info@surucuakademisi.com** · **+90 532 058 88 46**  
Web: **https://surucuakademisi.com**  
KEP: **PENDING / NOT PROVIDED**  
Başvuru adresi: **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye**  
Yetkili: **Bilal Aksoy**

Belge sürümü: **[[BELGE_SURUMU]]** · Yürürlük tarihi: **[[YURURLUK_TARIHI]]**

### 2. Kapsam ve ilgili kişi grupları

Bu aydınlatma; Sürücü Akademisi kamu web sitesi, Android uygulaması ve ilgili yönetim panelleri üzerinden yürütülen kişisel veri işleme faaliyetlerini kapsar.

İlgili kişi grupları **ayrı ayrı** değerlendirilir:

1. Ziyaretçi (üyelik oluşturmayan)
2. Kayıtlı bireysel (public) kullanıcı
3. Premium / ek yetkili bireysel kullanıcı
4. Kurum (sürücü kursu) öğrencisi
5. Kurum temsilcisi / kurum yöneticisi
6. Super Admin kullanıcıları
7. Forum / topluluk katılımcıları
8. Mesaj gönderen ve alan kişiler
9. Mobil bildirim alıcıları
10. İletişim formu / talep başvurusu yapanlar

### 3. İşlenen kişisel veri kategorileri

Envanterde doğrulanan kategoriler (özel nitelikli veri alanları yapılandırılmış olarak toplanmamaktadır):

- Kimlik (ad, soyad, görünen ad, kullanıcı adı vb.)
- İletişim (e-posta; iletişim taleplerinde telefon vb.)
- Kimlik doğrulama tanımlayıcıları (Firebase Auth kullanıcı kimliği)
- Hesap ve rol bilgileri
- Kurum bilgileri (kurum kimliği, kurum adı, şehir vb. ilgili süreçlerde)
- Sınav ve ders ilerleme kayıtları
- Forum ve topluluk içerikleri
- Düello ve lig sonuçları / varlık bilgileri
- Mesajlar ve bildirimler
- Anlık bildirim (push) belirteçleri
- Cihaz / platform bilgisi (sınırlı; örn. android/ios/web)
- İletişim talepleri
- Super Admin iç notları (yalnızca ilgili talep kayıtlarında)
- Ödeme / bakiye kayıtları (manuel kurum öğrenci ödemeleri; canlı ödeme sağlayıcısı yok)
- Güvenlik ve kötüye kullanım önleme kayıtları (ör. oran sınırlama sayaçları)

**Parolalar:** Parolalar düz metin olarak Sürücü Akademisi tarafından saklanmaz. Kimlik doğrulama kimlik bilgileri **Firebase Authentication** hizmeti üzerinden işlenir.

### 4. İşleme amaçları

Amaçlar örneğin şunlardır (nihai hukuki sebep eşlemesi incelemededir):

- Üyelik ve oturum yönetimi
- Eğitim içeriklerine erişim ve ilerleme takibi
- Kurumsal öğrenci–kurs ilişkilerinin yönetimi
- Forum, mesajlaşma, düello/lig özelliklerinin sunulması
- Destek ve iletişim taleplerinin değerlendirilmesi
- Bildirimlerin iletilmesi (hizmet / güvenlik / eğitim odaklı)
- Premium / reklamsız gibi yetki kayıtlarının yönetimi
- Mevzuat Asistanı üzerinden idari/destek amaçlı bilgilendirme (resmî hukuki mütalaa değildir)
- Sistem güvenliği, spam ve kötüye kullanımın önlenmesi
- Yasal yükümlülüklerin yerine getirilmesi (uygulandığında)

**Pazarlama, profilleme ve kişiselleştirilmiş reklam** bu aydınlatma kapsamında hesap kaydı, iletişim talebi veya eğitim ilerlemesi ile **birlikte şart koşulmaz**. Bu amaçlar ayrı değerlendirme ve ayrı tercih/onay gerektirir.

### 5. Toplama yöntemleri

- Web ve mobil arayüzler üzerinden doğrudan sizden
- Otomatik olarak (oturum, teknik güvenlik, ilerleme kayıtları)
- Kurum yöneticisi tarafından öğrenci hesabı oluşturma süreçleri
- Sunucu tarafı çağrılar (ör. iletişim talebi oluşturma)

### 6. Aday hukuki sebepler

Her amaç için nihai KVKK m. 5 dayanağı ayrıca incelenecektir.

Genel not: **Tüm işlemeler açık rızaya dayanmaz.**  
Onaylanmamış eşlemeler: **[[HUKUKI_SEBEP_NIHAI_INCELEME_GEREKLI]]**

### 7. Aktarılan taraflar / alıcı grupları

İşleme faaliyetiyle sınırlı olmak üzere:

- Bulut ve altyapı sağlayıcıları (Firebase / Google hizmetleri)
- Anlık bildirim altyapısı (FCM)
- Mobil reklam SDK’sı (AdMob — mobil; test/geliştirme yapılandırması)
- Yerleşik video içerikleri (YouTube, kullanıldığında)
- Yapay zekâ sağlayıcısı (OpenAI — Mevzuat Asistanı soru/metin parçaları)
- Yetkili Super Admin ve ilgili kurum yöneticileri (yetki sınırları içinde)
- Yasal zorunluluk halinde yetkili kamu kurumları

Canlı iyzico / mağaza içi ödeme sağlayıcı entegrasyonu **şu an aktif değildir**.

### 8. Yurt dışı işleme ihtimali

Firebase, Google, OpenAI, FCM, AdMob ve benzeri hizmetler verilerin Türkiye dışında işlenmesine yol açabilir.

Seçilmiş nihai aktarım mekanizması: **[[YURT_DISI_AKTARIM_MEKANIZMASI]]**  
Durum: **[[YURT_DISI_AKTARIM_MEKANIZMASI_HUKUKI_INCELEME_GEREKLI]]**

İletişim formu onay kutusu, yurt dışı aktarımın **tek hukuki dayanağı** olarak kullanılmaz.

### 9. Saklama ve silme ilkeleri

Veriler; işleme amacı, operasyonel ihtiyaç ve yasal zorunluluklar çerçevesinde saklanır.

Belirli süreler: **[[SAKLAMA_SURESI_HUKUKI_INCELEME]]**  
veya “hesap ömrü + hukuken incelenecek kapanış sonrası süre” / “operasyonel ihtiyaç sonu + yasal süre”.

Ayrım:

- Teknik/operasyonel saklama  
- Hukuki saklama  
- Uyuşmazlık / güvenlik tutma  
- Silme / imha / anonimleştirme  

**Saklama otomasyonu şu an tam uygulanmış değildir** (teknik envanter).

### 10. Veri güvenliği ilkeleri

Yetki bazlı erişim, kimlik doğrulama hizmetleri, sunucu tarafı doğrulama ve mümkün olduğunca asgari veri ilkesi uygulanmaya çalışılır.

**Mutlak güvenlik taahhüdü verilmez.** Hiçbir sistem yüzde yüz güvende değildir.

### 11. İlgili kişinin hakları

KVKK m. 11 kapsamındaki haklarınız (öğrenme, düzeltme, silme/yok etme talebi, itiraz vb. — kanundaki şartlarla) saklıdır.

### 12. Başvuru yöntemi

Başvurular: **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** / **info@surucuakademisi.com** / **+90 532 058 88 46**  
KEP: **PENDING / NOT PROVIDED**  
Yetkili: **Bilal Aksoy**

Yapılandırılmış başvuru formu ve otuz günlük takip süreci **sonraki fazda** tamamlanacaktır.

### 13. Çocuklar ve olası reşit olmayan kullanıcılar

Platform potansiyel olarak 18 yaş altı kişilerce kullanılabilir.  
Doğum tarihi alanı veya teknik yaş kapısı **doğrulanmış değildir**.

Politika: **[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]**  
Gereksiz doğum tarihi toplama yalnızca belge için eklenmemelidir.

### 14. Belge sürümü

**[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]**  
VERBİS durumu: **[[VERBIS_DURUMU]]** (çekirdek kimlik doğrulandı; VERBİS kararı hâlâ PENDING)

---

## C. KONTROLLÜ YER TUTUCU KONTROL LİSTESİ

- [x] Veri sorumlusu gösterim adı / tür / adres / vergi dairesi / e-posta / telefon / yetkili *(belge 18 çekirdek kimlik)*
- [ ] `[[MERSIS_NUMARASI]]` — PENDING / NOT CURRENTLY AVAILABLE
- [ ] `[[VERGI_NUMARASI]]` — PENDING_VERIFIED_ENTRY
- [ ] `[[TICARET_SICIL_NUMARASI]]` — PENDING VERIFICATION
- [ ] `[[KEP_ADRESI]]` — PENDING / NOT PROVIDED
- [ ] `[[YURURLUK_TARIHI]]` / `[[BELGE_SURUMU]]` — counsel onayı sonrası
- [ ] `[[YURURLUK_TARIHI]]` / `[[BELGE_SURUMU]]`
- [ ] `[[HUKUKI_SEBEP_NIHAI_INCELEME_GEREKLI]]` amaç bazında kapatıldı
- [ ] `[[SAKLAMA_SURESI_HUKUKI_INCELEME]]`
- [ ] `[[YURT_DISI_AKTARIM_MEKANIZMASI]]`
- [ ] `[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]`
- [ ] `[[VERBIS_DURUMU]]`

---

## D. DAHİLİ HUKUKİ İNCELEME NOTLARI

1. Aydınlatma ile açık rıza **ayrı mekanizmalardır**; bu metin açık rıza metni değildir.  
2. Pazarlama/reklam amaçları kayıt veya iletişim ile paketlenmemelidir.  
3. Mevzuat Asistanı OpenAI aktarımı ayrıca açıklanmalı ve mekanizma seçilmelidir.  
4. Hesap silme self-servis eksikliği L7’de giderilmeden mağaza/uygulama taahhütleri verilmemelidir.
