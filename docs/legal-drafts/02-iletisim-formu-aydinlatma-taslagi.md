# İletişim Formu KVKK Aydınlatma Metni — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2A-0.2 · teknik bildirim sürümü: `noticeVersion: "contact-v1"`  
**Yürürlük:** Yok (yayımlanmamıştır)  
**Bağımlılık:** Kamuya açık `/iletisim/` formu **BLOCKED**

---

## A. DAHİLİ UYARI (KULLANICIYA GÖSTERİLMEZ)

- Bu metin nihai değildir; çekirdek şirket kimliği belge 18’de doğrulanmıştır; saklama süreleri ve aktarım mekanizması hâlâ eksiktir / **LEGAL REVIEW REQUIRED**.
- Backend alanları `noticeAcknowledged` / `noticeVersion` **açık rıza kaydı değildir**; yalnızca aydınlatma metninin okunup bilgi edinildiğine dair teknik kayıttır.
- Kamuya açık form ve onay kutusu metni henüz uygulanmamıştır (L5).
- Contact CMS taslağı bu metnin yerine geçmez; **CMS yayını BLOCKED**.
- Alan yeniden adlandırma (eski `consentAccepted` / `consentVersion` → `noticeAcknowledged` / `noticeVersion`) teknik olarak **tamamlanmıştır** (E1B); bu belgeler buna hizalanmıştır.

**Teknik bağımlılıklar:** L3 genel gizlilik/çerez sayfaları; L5 form + aydınlatma gösterimi + `noticeAcknowledged` kutusu.

---

## B. KULLANICIYA YÖNELİK TASLAK METİN

### 1. Veri sorumlusu

**Bilal Aksoy – Sürücü Akademisi** (Şahıs işletmesi)  
Gerçek kişi işletmeci: **Bilal Aksoy** · Marka: **Sürücü Akademisi**  
**Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** · **info@surucuakademisi.com** · **+90 532 058 88 46**  
Başvuru: aynı adres · Yetkili: **Bilal Aksoy**  
Web: **https://surucuakademisi.com**

**[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]**

### 2. Form üzerinden toplanan veriler

İletişim / talep formu ve sunucu tarafı kayıt süreci (`contactRequests`) kapsamında işlenebilecek veriler:

| Alan | Açıklama |
|------|----------|
| fullName | Ad soyad |
| email | E-posta |
| phone | Telefon (opsiyonel) |
| userType | Kullanıcı türü |
| requestType | Talep türü |
| institutionName | Kurum adı (koşullu/opsiyonel) |
| city | Şehir (koşullu/opsiyonel) |
| message | Mesaj metni |
| noticeAcknowledged | Teknik aydınlatma bildirimi kaydı (`true`) |
| noticeVersion | Gösterilen aydınlatma metni sürümü (`contact-v1`) |

Sunucu tarafından üretilebilen alanlar: `schemaVersion`, `status`, `sourcePage`, `submitterUid`, `tenantId`, zaman damgaları (`createdAt`, `updatedAt`, `readAt`, `answeredAt`, `closedAt`), `adminNote`, `statusHistory`, `userAgent`.

Honeypot alanı (`website`) botlara karşı kullanılır; dolu ise talep kaydı oluşturulmaz.

### 3. Zorunlu alanlar

- fullName  
- email  
- userType  
- requestType  
- message  
- `noticeAcknowledged === true` (aydınlatma metninin okunup bilgi edinildiğine dair bildirim; **açık rıza değildir**)

### 4. Opsiyonel ve koşullu alanlar

- phone — opsiyonel  
- institutionName + city — `institution_membership` taleplerinde zorunlu  
- institutionName — `institution_student_support` taleplerinde zorunlu; city opsiyonel  
- Diğer talep türlerinde kurum/şehir opsiyonel  

### 5. Sunucu güvenlik ve iş akışı alanları

- status / statusHistory: talep durumu ve hesap verebilirlik  
- adminNote: yalnızca Super Admin iç notu  
- userAgent: güvenlik / kötüye kullanım analizi (kırpılmış)  
- Oran sınırlama kayıtları: e-posta ve IP’nin **tek yönlü özetleri** (ham IP saklanmaz)  
- submitterUid: oturum açıksa kullanıcı kimliği; değilse boş  
- tenantId: istemciden güvenilmez; şu an sunucuda null bırakılır  
- noticeAcknowledged / noticeVersion: aydınlatma bildirimi kaydı (paketlenmiş açık rıza değildir)  

### 6. İşleme amaçları

Yalnızca:

- Talebin alınması ve değerlendirilmesi  
- Başvuranla iletişim  
- Teknik veya hesap desteği  
- Bireysel Premium erişim taleplerinin değerlendirilmesi  
- Kurumsal üyelik taleplerinin değerlendirilmesi  
- İş birliği taleplerinin değerlendirilmesi  
- Spam ve kötüye kullanıma karşı koruma  
- Talep iş akışı ve hesap verebilirlik  

**Dahil edilmez (ayrı faz / ayrı yetki olmadan):** reklam, pazarlama kampanyası, ilgisiz profilleme, kişisel veri satışı, otomatik ticari ileti.

### 7. Toplama yöntemi

Web formu üzerinden; kayıt **sunucu tarafı callable** ile oluşturulur. İstemciden `contactRequests` koleksiyonuna doğrudan yazma **reddedilir**. Okuma: **yalnızca Super Admin**.

İletişim Formu Aydınlatma Metni, kişisel veri toplanmadan **önce** gösterilir.

### 8. Aday hukuki sebepler

Talebinizi yanıtlamak için gerekli işleme ile aydınlatma yükümlülüğü ayrıdır.

Açık rıza, iletişim talebini yanıtlamak için **otomatik zorunlu değildir**; nihai dayanak: **[[HUKUKI_SEBEP_NIHAI_INCELEME_GEREKLI]]**

Pazarlama açık rızası, çerez tercihi, reklam tercihi ve yurt dışı aktarım mekanizması bu forma **paketlenmez**; her biri ayrı değerlendirilir.

### 9. Dahili erişim

- Super Admin: liste, detay, durum, iç not  
- Kurum yöneticisi / kamu: doğrudan erişim yok  
- İstemci: oluşturma/güncelleme/silme yok  

### 10. Hizmet sağlayıcılar ve olası aktarımlar

Firebase / Google altyapısı ve Cloud Functions üzerinden işlenebilir.  
Yurt dışı ihtimali: **[[YURT_DISI_AKTARIM_MEKANIZMASI_HUKUKI_INCELEME_GEREKLI]]**  
Nihai mekanizma: **[[YURT_DISI_AKTARIM_MEKANIZMASI]]**

`noticeAcknowledged` kaydı yurt dışı aktarımın tek dayanağı değildir.

### 11. Saklama ve silme

Aktif talep: sonuçlanana kadar + **[[SAKLAMA_SURESI_HUKUKI_INCELEME]]**  
Kapalı talep: **[[SAKLAMA_SURESI_HUKUKI_INCELEME]]**  
Otomatik silme: şu an **uygulanmamıştır**.

### 12. İlgili kişi hakları

KVKK m. 11 hakları saklıdır.

### 13. Başvuru kanalı

**Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** · **info@surucuakademisi.com** · **+90 532 058 88 46** · Yetkili: **Bilal Aksoy**

### 14. Hassas / gereksiz veri uyarısı

Lütfen **göndermeyin**:

- Parola  
- Ödeme kartı bilgisi  
- Banka hesap erişim bilgisi  
- Kimlik belgesi kopyası  
- Sağlık verisi  
- Biyometrik veri  
- Adli sicil ayrıntıları  
- Talebin değerlendirilmesi için gerekli olmayan diğer hassas kişisel veriler  

Serbest metin alanı yalnızca talebi değerlendirmek için gerekli bilgileri içermelidir.

### 15. Bildirim sürümü ve teknik kayıt

- `noticeAcknowledged`: başvuranın aydınlatma metnini okuyup bilgi edindiğine dair **teknik bildirim kaydı**  
- `noticeVersion`: sunulan aydınlatma metni sürümü — şu an `"contact-v1"`  
- Bu alanlar paketlenmiş açık rıza, pazarlama, reklam, ticari ileti veya yurt dışı aktarım izni **değildir**

Önerilen gelecekteki form ifadesi:

> İletişim Formu Aydınlatma Metnini okudum ve bilgi edindim.

### 16. Kontrollü yer tutucular

Çekirdek kimlik (gösterim adı, tür, adres, e-posta, telefon, yetkili) belge 18’den doldurulmuştur. Hâlâ PENDING: `[[YURURLUK_TARIHI]]`, `[[BELGE_SURUMU]]`, `[[SAKLAMA_SURESI_HUKUKI_INCELEME]]`, `[[YURT_DISI_AKTARIM_MEKANIZMASI]]`, `[[HUKUKI_SEBEP_NIHAI_INCELEME_GEREKLI]]`

---

## C. AYDINLATMA BİLDİRİMİ SEMANTİĞİ — DAHİLİ NOT

| Konu | Karar / uyarı |
|------|----------------|
| Backend alanları | `noticeAcknowledged`, `noticeVersion` |
| Anlam | Aydınlatma metni okundu / bilgi edinildi — **teknik bildirim** |
| Otomatik anlam değil | Açık rıza, KVKK izni, pazarlama, reklam, ticari ileti, çerez, yurt dışı aktarım izni, sözleşme kabulü |
| Yasak örnek metin | “Kişisel verilerimin işlenmesine ve pazarlama amacıyla kullanılmasına izin veriyorum.” |
| Zorunlu açık rıza kutusu | Talebi yanıtlamak için **yalnızca bu nedenle** dayatılmamalıdır |
| Eski alan adları | `consentAccepted` / `consentVersion` artık kanonik değildir (E1B ile değiştirildi) |
| Hukuki sebep incelemesi | İşleme dayanakları için `[[HUKUKI_SEBEP_NIHAI_INCELEME_GEREKLI]]` devam eder |

---

## D. DAHİLİ HUKUKİ İNCELEME NOTLARI

1. Aydınlatma metni gönderimden **önce** gösterilmelidir.  
2. `adminNote` Super Admin’e özeldir; başvuranın erişimi yoktur — iç süreç notu olarak sınırlandırılmalıdır.  
3. userAgent ve oran sınırlama işleme faaliyetleri aydınlatmada yer almalıdır.  
4. Kapalı taleplerin otomatik silinmesi L7’de planlanmalıdır.  
5. Nihai işleme hukuki sebepleri ayrı incelenmeye devam eder (alan adı düzeltmesi hukuki sebep kararını tamamlamaz).
