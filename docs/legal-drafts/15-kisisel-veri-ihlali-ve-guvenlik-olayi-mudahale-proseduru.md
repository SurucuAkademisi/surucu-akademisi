# Kişisel Veri İhlali ve Güvenlik Olayı Müdahale Prosedürü — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2C-B-0.1  
**Uygulama durumu:** **DRAFT, NOT IMPLEMENTED**  
**Sorumlu:** `[[OLAY_MUDAHALE_SORUMLUSU]]` · `[[YETKILI_KISI_BIRIMI]]`

---

## A. DAHİLİ UYARI

Bu prosedür olay bileti açmaz, Kurul’a veya ilgili kişilere bildirim göndermez. Bildirim süreleri / kanalları uydurulmaz. Otomatik tespit iddiası yoktur (doğrulanmadıkça).

`[[VERI_IHLALI_BILDIRIM_SURECI]]` · `[[KVKK_KURUL_BILDIRIM_KANALI]]` · `[[ETKILENEN_KISI_BILDIRIM_KANALI]]` — **LEGAL REVIEW REQUIRED**

---

## B. PROSEDÜR TASLAĞI

### 1. Amaç

Kişisel veri ihlali ve güvenlik olaylarının tespiti, kayıt, sınırlama, değerlendirme, olası bildirim ve iyileştirme çerçevesi.

### 2. Kapsam

Web, mobil, Admin, kurum paneli, Firebase (Auth/Firestore/Storage/Functions/Hosting/FCM), Contact Requests, mesajlar, Mevzuat Asistanı, üçüncü taraf olayları.

### 3. Tanımlar

- **Güvenlik olayı:** Gizlilik, bütünlük veya erişilebilirliği tehdit eden olay  
- **Kişisel veri ihlali:** Kişisel verinin yetkisiz ifşası, erişimi, değişmesi veya yok edilmesi *(nihai hukuki tanım — LEGAL REVIEW REQUIRED)*  
- **Containment:** Yayılmayı durdurma  
- **Legal hold:** Delil ve kayıtların korunması  

### 4–7. Olay kategorileri ve örnekler

1. Yetkisiz hesap erişimi  
2. Kimlik bilgisi ele geçirme  
3. Super Admin hesap ele geçirme  
4. Kurum admin hesap ele geçirme  
5. Tenant ayrımı hatası  
6. Firestore Rules yanlış yapılandırma  
7. Storage ifşası  
8. Contact Request ifşası  
9. Mesaj ifşası  
10. Push token ifşası  
11. Kazara Admin dışa aktarım  
12. Zararlı yazılım / kötü niyetli bağlantı  
13. Kayıp cihaz  
14. Üçüncü taraf hizmet olayı  
15. OpenAI prompt ifşası  
16. Silme başarısızlığı / eksik kaskad  
17. Yedek ifşası  
18. Public hosting yapılandırma hatası  

### 8. Tespit kaynakları

Kullanıcı şikâyeti, Admin gözlemi, log incelemesi, sağlayıcı bildirimi, güvenlik uyarısı. **Otomatik SIEM/IDS doğrulanmadı.**

### 9–10. İlk bildirim ve kayıt

Keşif zamanı, bildiren, sistem, kısa özet, ilk severity tahmini. Dahili olay kaydı (aşağıdaki şablon). Runtime ticket sistemi **NOT IMPLEMENTED**.

### 11–13. Acil sınırlama, erişim iptali, delil

Şifre/reset, oturum iptali, Rules rollback adayı, token deaktivasyonu, export durdurma, etkilenen hesabı askıya alma. Log / ekran görüntüsü / sağlayıcı ticket ID saklanır; delil yok edilmez.

### 14–17. Etki, kategoriler, ilgili kişiler, risk

Etkilenen veri kategorileri ve kişi grupları listelenir. Severity: **LOW / MEDIUM / HIGH / CRITICAL** (operasyonel; yasal sonuç değildir).

### 18–20. Hukuki değerlendirme, yönetim, sağlayıcı

`[[OLAY_MUDAHALE_SORUMLUSU]]` + hukuk. Google/OpenAI vb. ile koordinasyon. Sözleşme şartları: `[[TEDARIKCI_SOZLESME_DURUMU]]` — UNVERIFIED.

### 21–22. Kurul / ilgili kişi bildirim değerlendirmesi

Bildirim kararı hukuki değerlendirme sonrası. Kanallar: `[[KVKK_KURUL_BILDIRIM_KANALI]]` · `[[ETKILENEN_KISI_BILDIRIM_KANALI]]`.  
Bildirim yapılmama gerekçesi kayda geçer. Bu fazda bildirim **gönderilmez**.

### 23. İletişim kontrolleri

Dışarıya kontrolsüz açıklama yapılmaz; tek sözcü / onaylı metin.

### 24–27. Düzeltme, kurtarma, post-incident, düzeltici eylem

Kök neden, yama, erişim gözden geçirme, kullanıcı bilgilendirme (gerekirse), dersler ve takip aksiyonları.

### 28. Olay kayıt şablonu (dahili)

| Alan | Değer |
|------|-------|
| Incident ID | |
| Discovery time | |
| Assessment start | |
| Containment time | |
| Decision time | |
| Category | |
| Severity | |
| Systems | |
| Data categories | |
| Data subjects | |
| Notification decision | |
| Authority notification details | |
| Affected-person notification details | |
| Justification if no notification | |
| Corrective actions | |
| Closure status | |
| Legal hold | |

### 29. Delil saklama

`[[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]]` · erişim kısıtlı.

---

## C. OLAY MÜDAHALE MATRİSİ (örnek)

| Kategori | Severity | Sistem | Olası veri | İlk sahip | Containment | Delil | Bildirim değerlendirmesi | İnceleme | Kapanış |
|----------|----------|--------|------------|-----------|-------------|-------|--------------------------|----------|---------|
| Yetkisiz hesap erişimi | MEDIUM–HIGH | Auth/users | Profil, ilerleme | Destek / SA | Parola reset, oturum iptal | Auth log | Risk’e göre | LEGAL REVIEW REQUIRED | Erişim kapatıldı + kullanıcı bilgilendi |
| Super Admin compromise | CRITICAL | Admin | Geniş | `[[OLAY_MUDAHALE_SORUMLUSU]]` | Anında revoke | Admin audit | Yüksek ihtimal | LEGAL REVIEW REQUIRED | Tüm SA erişim gözden geçirildi |
| Kurum admin compromise | HIGH | Tenant panel | Öğrenci verisi | SA + kurum | Reset / askı | Membership log | Değerlendir | LEGAL REVIEW REQUIRED | Tenant erişim temiz |
| Tenant ayrımı hatası | HIGH–CRITICAL | Rules/Firestore | Çapraz tenant | Engineering + Legal | Rules fix, erişim kes | Query log | Değerlendir | LEGAL REVIEW REQUIRED | Ayrım doğrulandı |
| Rules misconfig | HIGH | firestore.rules | Çoklu | Engineering | Rollback | Rules diff | Değerlendir | LEGAL REVIEW REQUIRED | Rules test geçti |
| Storage exposure | HIGH | Storage | Avatar/medya | Engineering | Rules/ACL fix | Storage access | Değerlendir | LEGAL REVIEW REQUIRED | Nesne erişimi kısıtlı |
| Contact Request disclosure | HIGH | contactRequests | Başvuru PII | SA | Erişim kısıt | Admin UI log | Değerlendir | LEGAL REVIEW REQUIRED | Erişim listesi gözden geçirildi |
| Message disclosure | HIGH | mailbox | Mesaj içeriği | SA | Erişim kısıt | Message meta | Değerlendir | LEGAL REVIEW REQUIRED | Containment + bildirim kararı |
| Push token exposure | MEDIUM | deviceTokens | Token/UID | Engineering | Token invalidate | Token docs | Düşük–orta | LEGAL REVIEW REQUIRED | Tokenler yenilendi |
| Accidental Admin export | MEDIUM–HIGH | Admin | Export set | SA | Export imha / kısıt | Export file | Değerlendir | LEGAL REVIEW REQUIRED | Kopyalar imha edildi |
| Malware / malicious link | MEDIUM | Forum/msg | URL | Moderasyon | İçerik kaldır | Post ID | Duruma göre | LEGAL REVIEW REQUIRED | İçerik temiz |
| Lost device | LOW–MEDIUM | Mobil | Yerel cache/token | Kullanıcı + Destek | Uzaktan oturum sonu | Kullanıcı beyanı | Genelde düşük | LEGAL REVIEW REQUIRED | Oturumlar kapandı |
| Third-party incident | MEDIUM–CRITICAL | Provider | Provider kapsamı | Ops + Legal | Provider ticket | Provider notice | Provider + iç risk | LEGAL REVIEW REQUIRED | Provider kapanış + iç aksiyon |
| OpenAI prompt disclosure | MEDIUM–HIGH | Mevzuat AI | Prompt | Admin/Legal | Key rotate / kullanım durdur | Function log | Değerlendir | LEGAL REVIEW REQUIRED | Prompt politikası güncellendi |
| Deletion failure | MEDIUM | Silme kaskadı | Artık veri | Engineering | Manuel temizlik | Cascade report | Duruma göre | LEGAL REVIEW REQUIRED | Artık kayıt temizlendi veya hold |
| Backup exposure | HIGH–CRITICAL | Backup | Geniş | Ops | Erişim kes | Backup ACL | Yüksek | LEGAL REVIEW REQUIRED | Backup güvenliği doğrulandı |
| Hosting config error | MEDIUM–HIGH | Hosting | Public paths | Engineering | Config fix | Hosting config | Duruma göre | LEGAL REVIEW REQUIRED | Public sızıntı yok |

---

## D. YER TUTUCULAR / BAĞIMLILIKLAR

`[[VERI_IHLALI_BILDIRIM_SURECI]]` · `[[OLAY_MUDAHALE_SORUMLUSU]]` · `[[KVKK_KURUL_BILDIRIM_KANALI]]` · `[[ETKILENEN_KISI_BILDIRIM_KANALI]]` · `[[TEDARIKCI_SOZLESME_DURUMU]]`

**Teknik:** Olay kayıt aracı, on-call, log erişimi, provider contact listesi, bildirim şablonları — **NOT IMPLEMENTED**.
