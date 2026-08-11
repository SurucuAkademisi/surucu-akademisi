# Hukukçu Final İnceleme Paketi — Yayın Adayı Özeti

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Amaç:** Türkçe gizlilik / internet hukuku danışmanına, mevcut yayın adayının hızlı ve odaklı incelenmesi için tek sayfalık paket sunmak.  
**Bu belge hukuki tavsiye değildir ve hukuki onay üretmez.**  
**Yayın onayı:** **YOK** · `PUBLICATION APPROVED` **değildir**

---

## YAYIN KİLİDİ (INTERNAL RELEASE LOCK)

**KAMUYA AÇIK YASAL SAYFALAR VE İLETİŞİM / KURUMSAL BAŞVURU FORMLARI, BU İNCELEME KONTROL NOKTASI TAMAMLANMADAN NİHAİ CANLI YASAL YÜZEY OLARAK DEPLOY EDİLMEMELİDİR.**

Bu paket “avukat onaylı” veya “yayına hazır hukuki metin” olarak işaretlenmez.

---

## 1. Şirket kimliği (doğrulanmış çekirdek)

| Kavram | Değer |
|--------|-------|
| Kamuya gösterim / veri sorumlusu gösterim adı | **Bilal Aksoy – Sürücü Akademisi** |
| Gerçek kişi / işletmeci | **Bilal Aksoy** |
| İşletme türü | **Şahıs işletmesi** |
| Marka | **Sürücü Akademisi** |
| Adres | **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** |
| E-posta | **info@surucuakademisi.com** |
| Telefon | **+90 532 058 88 46** |
| Vergi dairesi | **Alemdar Vergi Dairesi** |
| NACE | **621000** |
| Faaliyete başlama | **03.08.2026** |
| Web | **https://surucuakademisi.com** |

### Kimlik uyarıları (counsel varsayımı istenmez)

- Vergi levhasında **“Ticaret Unvanı” alanı boştur**.
- **“Sürücü Akademisi” marka olarak kullanılmaktadır**; tescilli ticaret unvanı olarak sunulmamaktadır.
- **MERSİS** şu an mevcut / doğrulanmış değildir → uydurulmaz.
- **KEP** mevcut değildir → başvuru kanalı olarak listelenmez.
- **Ticaret / esnaf sicil** muhasebeci / sicil doğrulaması bekliyor.
- **Vergi numarası** kamuya yazılmamış; TCKN kamuya yazılmaz.
- Counsel’tan uydurulmuş MERSİS / KEP / sicil / vergi numarası varsayması istenmez.

Kaynak: `docs/legal-drafts/18-sirket-bilgileri-ve-kontrollu-placeholder-kaydi.md`

---

## 2. İncelemeye sunulan kamu yasal sayfa adayları

Teknik yayın adayı kaynaklar `hosting-web/` altındadır. Durum: **teknik aday · hukuki onay yok**.

| Rota | Amaç | Taslak kaynak | Önemli ürün varsayımları | Counsel’a açık sorular |
|------|------|---------------|--------------------------|------------------------|
| `/kvkk-aydinlatma/` | Genel KVKK aydınlatma | 01 | Firebase/Google, FCM, OpenAI (Mevzuat), YouTube, mobil AdMob; iyzico canlı değil; pazarlama paketlenmez; yurt dışı ihtimali belirtilir, mekanizma seçilmez | Hukuki sebepler; saklama; aktarım güvenceleri; reşit olmayan; VERBİS |
| `/iletisim-formu-aydinlatma/` | İletişim + kurumsal başvuru form aydınlatması | 02 | `noticeAcknowledged` / `noticeVersion: contact-v1`; bilgi edinme bildirimi; açık rıza değildir | Formla işleme dayanağı; saklama/silme; yurt dışı aktarım; onay modeli |
| `/gizlilik-politikasi/` | Genel gizlilik özeti | 03 | Auth, ilerleme, kurum, forum, iletişim talepleri, FCM, AdMob (mobil), OpenAI; web AdSense/GA yok; self-servis silme yok | Kapsam doğruluğu; silme/saklama; aktarım |
| `/cerez-politikasi/` | Çerez / benzeri teknolojiler | 04 | Web’de bilinçli `document.cookie` yok; sessionStorage/localStorage + Auth kalıcılığı; GA/GTM/Pixel/AdSense yok; YouTube üçüncü taraf; tercih merkezi yok | CMP ihtiyacı; YouTube öncesi onay; Auth depolama sınıflandırması |
| `/kullanim-kosullari/` | Kullanım koşulları | 05 | Eğitim içerik / topluluk / kurumsal başvuru; iyzico canlı değil; kurumsal başvuru otomatik üyelik değildir | Uygulanacak hukuk / yetkili merci; sorumluluk dili |
| `/ilgili-kisi-basvurusu/` | İlgili kişi başvuru kanalları / şablon | 07 | Kanallar: e-posta + posta; telefon yalnızca genel iletişim; KEP yok; çevrimiçi takip yok | Kanal yeterliliği; info@ niteliği; kimlik doğrulama |

---

## 3. İletişim / kurumsal başvuru veri akışı

### A) Genel iletişim — `/iletisim/`

Olası alanlar: ad soyad, e-posta, isteğe bağlı telefon, talep kategorisi, mesaj; kurum öğrencisi desteğinde kurum adı; honeypot (`website`).

### B) Kurumsal katılım — `/kurumsal-basvuru/`

Alanlar: kurum adı, yetkili ad soyad, isteğe bağlı ünvan, e-posta, telefon, il, isteğe bağlı ilçe, ilgilenilen program (`driving_license` / `machine_operator` / `both`), isteğe bağlı tahmini öğrenci sayısı, mesaj; honeypot.

### Ortak teknik model

- Koleksiyon: `contactRequests`
- Yazma: sunucu tarafı callable (`submitContactRequest`); istemciden doğrudan create yok
- Okuma: yalnızca Super Admin
- `noticeAcknowledged: true`
- `noticeVersion: "contact-v1"`
- Form onay kutusu metni:  
  **“İletişim Formu Aydınlatma Metnini okudum ve bilgi edindim.”**

### Semantik (açık)

Bu kutu **bilgi edinme / aydınlatma bildirimi**dir.  
**Açık rıza değildir.**  
**Pazarlama izni değildir.**  
**Ticari ileti onayı değildir.**  
**Çerez / yurt dışı aktarım izni değildir.**

Kurumsal başvuru: anında Auth kullanıcısı, tenant, membership veya ödeme oluşturmaz.

---

## 4. Güncel teknik gerçekler (yalnızca doğrulanmış)

| Konu | Durum |
|------|--------|
| Firebase Authentication | Kullanılıyor |
| Cloud Firestore | Kullanılıyor |
| Firebase Storage | Kullanılıyor |
| Cloud Functions | Kullanılıyor |
| FCM | Kullanılıyor (mobil bildirim) |
| Google Sign-In | Kullanılıyor (mobil) |
| YouTube gömülü medya | Kullanılıyor |
| OpenAI | Mevzuat Asistanı bağlamında |
| AdMob | Mobilde var (test/geliştirme odaklı yapılandırma) |
| Web GA / GTM / Facebook Pixel | Yüklenmiyor |
| Web AdSense runtime | Yüklenmiyor |
| Bilinçli web `document.cookie` yazımı | Doğrulanmamış / yok |
| sessionStorage / localStorage | İşlevsel kullanım var |
| Firebase Auth tarayıcı kalıcılığı | Var |
| YouTube üçüncü taraf teknolojileri | Oyuncu/medya yüklenince oluşabilir |
| Firestore fiziksel bölge | Repodan kesin belirlenemiyor |
| Storage fiziksel bölge | Repodan kesin belirlenemiyor |
| Functions bölgesi | Birçok çağrı açıkça `us-central1` kullanıyor |
| iyzico / online checkout | **CANLI DEĞİL** |
| Pazarlama SMS / e-posta kampanyası | **AKTİF DEĞİL** |
| Self-servis hesap silme | **CANLI DEĞİL** |

**Yurt dışı işleme:** Google/Firebase, OpenAI, YouTube, FCM, AdMob ve benzeri altyapı nedeniyle veriler Türkiye dışında işlenebilir. Nihai aktarım mekanizması / güvence seçimi counsel kararındadır; kaynak metinlerde uydurulmuş mekanizma yoktur.

---

## 5. Hukukçudan Karar / Onay Beklenen Konular

Aşağıdaki maddeler için **açık onay / değişiklik / uygulanmaz** kararı istenmektedir:

- [ ] KVKK işleme amaçları
- [ ] Her ana işleme faaliyeti için hukuki sebepler
- [ ] Alıcı / aktarım ifadeleri
- [ ] Google/Firebase, OpenAI, YouTube, FCM, AdMob ve ilgili altyapı için uluslararası aktarım mekanizması / güvenceleri
- [ ] Standart sözleşmeler veya KVKK m. 9 kapsamında başka bir mekanizmanın gerekip gerekmediği
- [ ] Saklama ifadeleri ve gerektiğinde somut saklama süreleri
- [ ] `contactRequests` saklama / silme politikası
- [ ] VERBİS yükümlülüğü / durum
- [ ] Çocuklar / reşit olmayanlar ve asgari yaş ifadesi
- [ ] Çerez Politikası ifadesi
- [ ] YouTube gömülü oynatıcının yüklenmeden önce onay / tercih mekanizması gerektirip gerektirmediği
- [ ] Firebase Auth işlevsel depolamasının ek onay / banner gerektirip gerektirmediği
- [ ] İlgili kişi başvuru yöntemleri: e-posta / posta; ek resmi kanal gerekip gerekmediği
- [ ] `info@surucuakademisi.com` kanalının başvuru kanalı olarak nasıl nitelendirileceği
- [ ] Kullanım Koşulları — uygulanacak hukuk / yetkili merci ifadesi
- [ ] Vergi levhasında ticaret unvanı boşken “Bilal Aksoy – Sürücü Akademisi” gösteriminin kabul edilebilirliği
- [ ] Mevcut hukuki / işletme durumunda MERSİS veya sicil bilgisinin sitede gösterilmesinin zorunlu olup olmadığı
- [ ] Önerilen aydınlatma bildirim modeli ile kamu iletişim / kurumsal formların yayına alınıp alınamayacağı

---

## 6. Ödeme notu

- Online ödeme **şu an canlı değildir**.
- iyzico hesabı **henüz açılmamıştır**.
- Ayrı işletme banka hesabı planlanmaktadır.
- Ödeme koşulları, iade / iptal, mesafeli satış / e-ticaret ödeme metinleri **bu inceleme paketinin parçası değildir**.
- Ödeme go-live öncesi **ayrı hukuki inceleme** gerekir.
- Spekülatif ödeme yükümlülüğü eklenmez.

---

## 7. Ticari ileti / pazarlama notu

Mevcut ürün kararı:

- Reklam / tanıtım SMS **yok**
- Pazarlama SMS **yok**
- Promosyonel pazarlama e-posta kampanyası **yok**
- İYS iş akışı ürünün parçası **değil**

Counsel’tan: mevcut operasyonel iletişimlerin yine de yükümlülük doğurup doğurmayacağına dair not istenebilir.  
**Kalıcı muafiyet iddiası yapılmaz.**

---

## 8. Hesap silme notu

- Kullanıcı self-servis hesap silme rotası **bugün canlı değildir**.
- Yönetici operasyonel silme imkânı vardır.
- Dahili silme prosedürü belgelenmiştir (taslak 11).
- Self-servis silme uygulanana kadar kamu ifadesinin uygunluğunun counsel tarafından teyidi istenmektedir.

---

## 9. Counsel yanıt formatı

| Konu | Karar: APPROVED / CHANGE REQUIRED / NOT APPLICABLE | İstenen ifade / değişiklik | Notlar |
|------|----------------------------------------------------|----------------------------|--------|
| Genel KVKK aydınlatma | | | |
| İletişim formu aydınlatma | | | |
| Gizlilik politikası | | | |
| Çerez politikası | | | |
| Kullanım koşulları | | | |
| İlgili kişi başvurusu | | | |
| Yurt dışı aktarım mekanizması | | | |
| Saklama süreleri | | | |
| VERBİS | | | |
| Reşit olmayanlar | | | |
| Form aydınlatma bildirim modeli | | | |
| Kimlik gösterimi (ticaret unvanı boş) | | | |
| Diğer | | | |

### FINAL RELEASE DECISION

- [ ] APPROVED FOR PUBLICATION AS IS
- [ ] APPROVED SUBJECT TO LISTED CHANGES
- [ ] NOT APPROVED FOR PUBLICATION

**Reviewer name:** _______________________  
**Date:** _______________________  
**Notes:** _______________________

---

## 10. Teslim notu

Counsel’a birlikte sunulması önerilen kaynaklar (bu paketin kendisi metinleri çoğaltmaz):

- Taslaklar: 01, 02, 03, 04, 05, 07, 18, 19  
- Teknik yayın adayı HTML:  
  `hosting-web/kvkk-aydinlatma/`  
  `hosting-web/iletisim-formu-aydinlatma/`  
  `hosting-web/gizlilik-politikasi/`  
  `hosting-web/cerez-politikasi/`  
  `hosting-web/kullanim-kosullari/`  
  `hosting-web/ilgili-kisi-basvurusu/`

**Son hatırlatma:** Bu paket tamamlanmış hukuki onay değildir. Yayın kilidi, yukarıdaki FINAL RELEASE DECISION tamamlanana kadar geçerlidir.
