# Ticari İletişim ve Pazarlama İzni Değerlendirmesi — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2C-B-0.1  
**Yürürlük:** Yok  
**Pazarlama izin sistemi:** **NOT IMPLEMENTED**  
**İYS durumu:** `[[IYS_DURUMU]]` — **NOT COMPLETED**

---

## A. DAHİLİ UYARI

Bu belge pazarlama izni UI’sı, onay kutusu veya ileti gönderimi oluşturmaz. Her bildirim pazarlama değildir; her pazarlama iletisi de hizmet bildirimi sayılmaz. Nihai onay metni üretilmez.

`FINAL CONSENT TEXT — LEGAL REVIEW REQUIRED`  
`[[TICARI_ILETISIM_ONAY_METNI_SURUMU]]`

---

## B. DEĞERLENDİRME

### 1. Amaç

Platform iletişim kanallarını sınıflandırıp ticari elektronik ileti / pazarlama izin ihtiyaçlarını ayırmak.

### 2. Kapsam

Push (FCM), uygulama içi bildirimler, kurum duyuruları, mesajlar, e-posta/SMS *(planlı veya doğrulanmamış kanallar)*, Premium teklifleri, kampanyalar.

### 3. İletişim kanal envanteri

| Kanal | Teknik kanıt | Durum |
|-------|--------------|-------|
| Uygulama içi bildirim paneli | `notifications` / Admin & tenant paneller | ACTIVE |
| FCM push | `functions/push_dispatch.js`, `deviceTokens` | ACTIVE |
| Kurum duyuruları / system announcements | Admin / tenant announcement UI | ACTIVE |
| Tenant mailbox mesajları | mailbox collections | ACTIVE |
| Pazarlama e-postası | Ayrı transactional/marketing provider | PLANNED / UNVERIFIED — aktif deme |
| Pazarlama SMS | — | PLANNED / UNVERIFIED |
| Contact Request yanıt e-postası | Destek süreci | Hizmet / destek (pazarlama değil varsayımı — inceleme) |

### 4–8. Hizmet / güvenlik / eğitim / kurum duyurusu

| Tür | Örnek | Pazarlama mı? |
|-----|-------|---------------|
| Hizmet / transactional | Hesap, erişim, üyelik durumu | Genelde hayır |
| Güvenlik | Şüpheli giriş, parola | Hayır |
| Eğitim | Ders/sınav hatırlatması, içerik güncellemesi | Genelde hayır; içerik teklife dönüşürse yeniden sınıflandır |
| Kurum operasyonel duyuru | Kurumun öğrencilerine ders/sınav duyurusu | Kurum operasyonu; platform pazarlaması değil *(kurum kendi ticari ileti kurallarına tabi olabilir)* |

### 9–13. Pazarlama e-posta / SMS / promotional push / Premium teklif / kampanya

Bunlar **ticari / pazarlama ileti adayıdır**. Ayrı izin, çekilme ve (uygulanırsa) İYS değerlendirmesi gerekir. Şu an ayrı pazarlama izin sistemi **NOT IMPLEMENTED**. Uygulama içi gönderildiği için otomatik “hizmet bildirimi” sayılmaz.

### 14. Ticari iletişim sınıflandırma kuralı

İçerik + amaç + gönderen + kanal birlikte değerlendirilir.  
`COMMERCIAL COMMUNICATION CLASSIFICATION — LEGAL REVIEW REQUIRED`

### 15. İzin gereksinimleri (gelecek pazarlama izni)

Herhangi bir gelecek pazarlama izni:

- Üyelik kabulünden **ayrı**  
- KVKK aydınlatmadan **ayrı**  
- Contact Request gönderiminden **ayrı** (`noticeAcknowledged` pazarlama izni değildir)  
- Amaca özgü  
- Geri alınabilir  
- Sürümlü (`[[TICARI_ILETISIM_ONAY_METNI_SURUMU]]`)  
- İspatlanabilir  
- Ön seçili olmamalı  
- Olağan hizmet erişimi için zorunlu olmamalı *(yasal istisna yoksa)*  

`FINAL CONSENT TEXT — LEGAL REVIEW REQUIRED`

### 16. İzin geri alma

Kanal bazlı opt-out + hesap tercihleri (uygulanacak). OS bildirim kapatma ≠ pazarlama izni kaydının hukuki yönetimi.

### 17. Delil ve sürümleme

İzin zaman damgası, metin sürümü, kanal, UID/e-posta, kaynak UI. **NOT IMPLEMENTED**.

### 18. İYS değerlendirme kontrol listesi

| Madde | Not | Durum |
|-------|-----|-------|
| Ticari elektronik ileti mi? | İçerik sınıflandırması | LEGAL REVIEW REQUIRED |
| Alıcı tipi (kişi / müşteri) | Public / öğrenci / kurum | İnceleme |
| Kanal (e-posta, SMS, push, çağrı) | Push her zaman İYS’ye tabi deme | İnceleme |
| Mevcut müşteri istisnaları | Uygulanabilirlik | İnceleme |
| İzin toplama | Ayrı UI | NOT IMPLEMENTED |
| İzin delili | Sürüm + timestamp | NOT IMPLEMENTED |
| İzin geri alma | — | NOT IMPLEMENTED |
| İYS senkronizasyonu | — | NOT COMPLETED |
| Hizmet sağlayıcı sorumluluğu | E-posta/SMS sağlayıcı (planlı) | UNVERIFIED |
| Kurum sorumluluğu | Kurumun kendi öğrencilerine ticari ileti | Kurum süreci |
| Şikâyet yönetimi | — | NOT IMPLEMENTED |

**Sonuç:** `[[IYS_DURUMU]]` = **NOT COMPLETED**  
Her bildirimin İYS gerektirdiği kesin olarak söylenmez. İYS kaydının tamamlandığı söylenmez.

### 19. Mevcut kullanıcı iletişimi

Mevcut bildirim/push alıcıları otomatik pazarlama izni sahibi sayılmaz.

### 20. Kurum kaynaklı iletişim

Kurum duyuru ve mailbox: kurum operasyonu. Kurum kendi ticari ileti / İYS yükümlülüğünden sorumlu olabilir. Platform, kurum mesajını kendi pazarlaması gibi sınıflandırmamalı; kötüye kullanım Topluluk / kurum çerçevesine tabidir.

### 21. Reşit olmayanlar

`[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]` — pazarlama özel dikkat.

### 22. Veri minimizasyonu

Pazarlama listeleri asgari alan; hizmet listelerinden ayrılmalı.

### 23. Sınır ötesi sağlayıcılar

FCM / gelecekteki e-posta sağlayıcıları: `[[YURT_DISI_AKTARIM_MEKANIZMASI]]`

### 24–26. Yer tutucular / inceleme / bağımlılıklar

`[[IYS_DURUMU]]` · `[[TICARI_ILETISIM_ONAY_METNI_SURUMU]]` · şirket kimliği  

**Bağımlılıklar:** Ayrı consent UI; preference center; İYS entegrasyonu; kanal sınıflandırma bayrakları; audit log — hiçbiri bu fazda uygulanmaz.
