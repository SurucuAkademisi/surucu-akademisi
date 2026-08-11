# Hesap ve Kişisel Veri Silme Prosedürü — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2C-A-0.1  
**Yürürlük:** Yok (yayımlanmamıştır)  
**Uygulama durumu:** **NOT IMPLEMENTED** (prosedür belgelenir; runtime oluşturulmaz)

---

## A. DAHİLİ UYARI

Bu belge hesap silmeyi uygulamaya almaz. Self-servis silme, kamu silme sayfası, in-app silme düğmesi ve tam kaskad **NOT IMPLEMENTED / UNVERIFIED**. Kurum öğrenci yönetim silmesi (kısmi Admin callable) self-servis silme sayılmaz ve her ilişkili kaydı silmez.

---

# PART A — Gelecek kullanıcıya yönelik açıklama (uygulama sonrası)

### 1. Amaç

Hesabınızı ve ilgili kişisel verilerinizi talep üzerine silme veya kısıtlama sürecini açıklamak.

### 2. Kapsam

Mobil uygulama, web hesabı ve ilişkili Firebase kayıtları. Deaktivasyon / üyelik bitişi silme değildir.

### 3. Silme kanalları (gelecek tasarım — henüz yok)

- Mobil uygulama içi kolay bulunur silme yolu — **NOT IMPLEMENTED**  
- Kimlik doğrulamalı web silme / talep kaynağı: `[[HESAP_SILME_PUBLIC_URLSI]]` — **NOT IMPLEMENTED**  
- Erişim kaybında destek: `[[HESAP_SILME_DESTEK_KANALI]]`  
- Yalnızca e-posta ile “hesabı kapatma” talebi tek başına yeterli silme sayılmaz  

### 4. Kimlik doğrulama ve yeniden kimlik doğrulama

Yıkıcı işlem öncesi oturum doğrulaması veya güvenli kimlik teyidi gerekir. Kimlik belgesi kopyası varsayılan olarak istenmez; istisnai haller **LEGAL REVIEW REQUIRED**.

### 5. Onay ve süre

Kullanıcı silmenin geri alınamayabileceğini onaylar. Hedef tamamlanma: `[[HESAP_SILME_TAMAMLANMA_SURESI]]` *(hukuki/teknik teyit gerekir)*.

### 6. Sonuç bildirimi

Tamamlama, kısmi saklama veya ret gerekçesi bildirilir.

### 7. Paylaşılan içerik

Forum, mesaj, düello/lig gibi paylaşılan kayıtlar her zaman tamamen silinmeyebilir; anonimleştirme veya kısıtlı saklama uygulanabilir. **LEGAL REVIEW REQUIRED**

---

# PART B — Dahili operasyonel prosedür

### 1. Amaç / kapsam

Operasyonel silme taleplerinin alınması, doğrulanması, işlenmesi ve delillendirilmesi.

### 2. Hesap türleri (ayrı yollar)

1. Kayıtlı bireysel (public) kullanıcı  
2. Premium bireysel kullanıcı  
3. Kurum öğrencisi  
4. Kurum temsilcisi *(yükseltilmiş operasyonel inceleme)*  
5. Super Admin *(yükseltilmiş operasyonel inceleme; genel self-servis dışı)*  
6. Eski kurum öğrencisi  
7. Askıya alınmış / deaktive hesap  
8. Google Sign-In hesabı  
9. E-posta/parola hesabı  

Tek evrensel silme yolu tanımlanmaz.

### 3. Deaktivasyon ≠ silme

| İşlem | Anlamı |
|-------|--------|
| Üyelik süresi bitişi | Erişim kısıtı; kayıtlar kalabilir |
| Kurum deaktivasyonu | Erişim kısıtı |
| Kurumdan çıkarma | Membership kaldırma; tam imha değil |
| Kullanıcı silme talebi | Kaskad silme / anonimleştirme prosedürü |
| Kurum temsilcisi silmesi | Öğrenci yönetim silmesi (kısmi); tam kaskad UNVERIFIED |
| Super Admin silmesi | Operasyonel; kaskad kapsamı doğrulanmalı |

### 4. Talep kanalları (gelecek)

In-app; kimlik doğrulamalı web kaynağı; destek kanalı. Placeholder URL/süreler yukarıda.

### 5. Talep doğrulama (kavramsal)

- Authenticated UID (mümkünse)  
- Yakın zamanda yeniden kimlik doğrulama / güvenli teyit  
- Hesap rolü ve tenant ilişkisi  
- Silme kapsamı  
- Legal/security hold kontrolü  
- Kasıtlı silme onayı  
- Sağlayıcı (Google) incelemesi  
- Yinelenen talep koruması  
- Tamamlama kaydı  

### 6. Kurum öğrencisi özel notlar

Çoklu tenant üyeliği varsa kalıcı silme Super Admin özel temizlik gerektirebilir (mevcut yönetim callable uyarısı). Public geçmiş + kurum üyeliği + mesaj/paylaşılan içerik riskleri ayrı değerlendirilir.

### 7. Bekleyen mali / hukuki yükümlülükler

Manuel ödeme/bakiye kayıtları, uyuşmazlık veya yasal saklama silmeyi erteleyebilir veya kısıtlı saklamaya çevirebilir. Canlı mağaza aboneliği şu an aktif kabul edilmez; gelecekte sağlayıcı faturalama geçmişi platformca silinemez.

### 8. İşleme aşamaları

1. Talep kaydı ve zaman damgası  
2. Kimlik / rol doğrulama  
3. Hold kontrolü  
4. Kaskad planı seçimi (hesap türüne göre)  
5. Auth / Firestore / Storage / token işlemleri  
6. Paylaşılan içerik kararı (sil / anonimleştir / kısıtlı sakla)  
7. Üçüncü taraf talep (mümkünse)  
8. Yanıt ve delil  
9. Kapanış  

### 9. Saklanması gerekebilecek kategoriler

Hukuki uyuşmazlık, güvenlik incelemesi, yasal zorunluluk, başka kullanıcının meşru kaydı. Süre: `[[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]]`.

### 10. Yedekler

Yedek silme / expiry **UNVERIFIED**.

### 11. Tamamlama / ret / kısmi saklama

Gerekçeli bildirim. Fraud/security hold erteleyebilir.

### 12. Sorumluluk matrisi

| Rol | Sorumluluk |
|-----|------------|
| Kullanıcı | Talep / onay |
| Destek | `[[HESAP_SILME_DESTEK_KANALI]]` intake |
| Super Admin | Operasyonel silme / çoklu tenant |
| Kurum temsilcisi | Öğrenci yönetim silmesi (sınırlı) |
| Hukuk / uyum | `[[YETKILI_KISI_BIRIMI]]` — hold, kısmi saklama |
| Mühendislik | Kaskad callable / otomasyon (henüz yok) |

### 13. Delil ve denetim

Application ID, talep zamanı, doğrulama durumu, sistemler, aksiyon, yanıt, hold, notlar. Erişim kısıtlı.

---

# PART C — Teknik silme ve kaskad matrisi (önerilen sınıflandırma; runtime iddiası değil)

Sınıflar: `DELETE` · `ANONYMIZE` · `RETAIN WITH RESTRICTION` · `REVOKE ACCESS` · `UNVERIFIED` · `LEGAL REVIEW REQUIRED`

| Kayıt / veri | Doğrulanan yol | Sahiplik | Paylaşımlı? | Önerilen silme | Önerilen anonimleştirme | Saklama istisnası | Kaskad durumu | Backend bileşen | İnceleme |
|--------------|----------------|----------|-------------|----------------|-------------------------|-------------------|---------------|-----------------|----------|
| Firebase Auth hesabı | Firebase Auth | Kullanıcı | Hayır | DELETE | — | Hold | Kısmi (kurum öğrenci callable) | Auth Admin | LEGAL REVIEW REQUIRED |
| `users/{uid}` | Firestore | Kullanıcı | Hayır | DELETE | — | Hold | Kısmi | Callable / SA | LEGAL REVIEW REQUIRED |
| Public profile | `publicProfiles` (varsa) | Kullanıcı | Görünür | DELETE / ANONYMIZE | İsim kaldırma | — | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Profil görseli | Storage `user-profiles/{uid}/avatar.jpg` | Kullanıcı | URL paylaşımı | DELETE | — | — | UNVERIFIED | Storage | LEGAL REVIEW REQUIRED |
| Tenant memberships | `tenantMemberships` | Kullanıcı–kurum | Kurum | DELETE / REVOKE ACCESS | — | Kurumsal kayıt? | Kısmi | IA callable | LEGAL REVIEW REQUIRED |
| Kurum öğrenci kayıtları | users + membership + payments | Kurum/öğrenci | Kurum | DELETE (kapsamlı değil) | — | Mali kayıt | Kısmi | `functions_student_admin` | LEGAL REVIEW REQUIRED |
| Premium / ad-free | `userEntitlements` vb. | Kullanıcı | Hayır | DELETE / REVOKE ACCESS | — | — | UNVERIFIED | SA / CF | LEGAL REVIEW REQUIRED |
| Sınav denemeleri | exam attempt collections | Kullanıcı | Hayır | DELETE | Aggregate? | — | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Ders ilerlemesi | lesson progress paths | Kullanıcı | Hayır | DELETE | — | — | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Video ilerlemesi | progress / entitlement | Kullanıcı | Hayır | DELETE / REVOKE ACCESS | — | — | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Pratik rehber ilerlemesi | saklanıyorsa | Kullanıcı | Hayır | DELETE | — | — | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Forum gönderileri | `forum_posts` | Yazar | Evet | ANONYMIZE veya DELETE | Yazar kimliği kaldırma | Moderasyon/abuse | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Forum yanıtları | replies/comments | Yazar | Evet | ANONYMIZE veya DELETE | Aynı | Aynı | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Düello davetleri | duel invites | Oyuncular | Evet | ANONYMIZE / DELETE | Rakip kayıtları bozulmadan | — | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Düello sonuçları | `duels` | Oyuncular | Evet | ANONYMIZE | Aynı | — | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Lig kayıtları | `duelLeague` | Oyuncular | Evet | ANONYMIZE | Aynı | — | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Mailbox / mesajlar | mailboxes | Taraflar | Evet | Soft-hide ≠ DELETE; ANONYMIZE | Karşı taraf kaydı | Abuse | Soft-hide mevcut; kalıcı UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Bildirimler | `notifications` | Alıcı | Hayır | DELETE | — | Kısa operasyon | UNVERIFIED | TBD | LEGAL REVIEW REQUIRED |
| Cihaz tokenleri | `users/{uid}/deviceTokens` | Kullanıcı | Hayır | DELETE / invalidate | — | — | UNVERIFIED (kayıt var; silme kaskadı eksik) | Client / CF | LEGAL REVIEW REQUIRED |
| Contact Requests (auth) | `contactRequests` | Başvuran | SA | RETAIN WITH RESTRICTION veya DELETE | — | Destek/yasal | Zamanlanmış silme yok | SA | LEGAL REVIEW REQUIRED |
| Contact Requests (misafir) | `contactRequests` | Başvuran | SA | Aynı | — | Aynı | Yok | SA | LEGAL REVIEW REQUIRED |
| Ödeme / bakiye | `studentPayments` | Öğrenci–kurum | Kurum | RETAIN WITH RESTRICTION veya DELETE | — | Ticari/vergi? | Kısmi (IA callable) | IA/SA | LEGAL REVIEW REQUIRED |
| Admin notları | Contact `adminNote` vb. | İç | — | RETAIN WITH RESTRICTION | — | İç süreç | Yok | SA | LEGAL REVIEW REQUIRED |
| Status history | request / membership history | — | — | RETAIN WITH RESTRICTION | — | Denetim | UNVERIFIED | — | LEGAL REVIEW REQUIRED |
| Rate-limit | `contactRequestRateLimits` | Hash | Hayır | Kısa pencere / overwrite | — | Güvenlik | Pencere kodda | CF | — |
| Mobil tercihler | localStorage / session | Cihaz | Hayır | Cihaz tarafı temizleme | — | — | Kullanıcı cihazı | Client | — |
| Auth provider tokenleri | Google / Auth | Kullanıcı | Hayır | REVOKE / unlink | — | — | UNVERIFIED | Auth | LEGAL REVIEW REQUIRED |
| Yedekler | Backup | — | — | Backup expiry | — | Felaket kurtarma | UNVERIFIED | Ops | LEGAL REVIEW REQUIRED |
| Üçüncü taraf işlemci | Google / AdMob / (OpenAI) | İşlemci | — | Provider deletion request | — | Provider politikası | UNVERIFIED | Ops/Legal | LEGAL REVIEW REQUIRED |

### Kullanıcı içeriği — ayrı değerlendirme

| İçerik | Önerilen yaklaşım | Not |
|--------|-------------------|-----|
| Forum post / reply | DELETE veya ANONYMIZE | Konuşma bütünlüğü; **LEGAL REVIEW REQUIRED** |
| Düello / lig | ANONYMIZE tercih | Rakip kaydını bozmadan |
| Mesajlar | Soft-hide ≠ imha; ANONYMIZE / kalıcı silme ayrı | Karşı taraf |
| Kurumlar-İletişim | Kurum kapsamı; kamu sosyal ağ değil | Ayrı prosedür |

### Dış sağlayıcı silme kontrol listesi

- [ ] Firebase Authentication hesabı  
- [ ] Firestore ilişkili belgeler  
- [ ] Firebase Storage nesneleri  
- [ ] FCM token invalidation  
- [ ] Google Sign-In bağlantısı / token revoke (mümkünse)  
- [ ] AdMob / reklam tanımlayıcıları (uygulanabilir ise; platform kontrolü sınırlı)  
- [ ] Google Play abonelik / faturalama *(gelecek; şu an canlı satın alma yok; faturalama geçmişi silinemez iddiası yok)*  
- [ ] Apple abonelik *(yalnızca gelecekte iOS/abonelik varsa)*  
- [ ] OpenAI kayıtları *(yalnızca ilgili aktarım varsa)*  

---

## D. YER TUTUCULAR

`[[HESAP_SILME_PUBLIC_URLSI]]` · `[[HESAP_SILME_TAMAMLANMA_SURESI]]` · `[[HESAP_SILME_DESTEK_KANALI]]` · şirket kimliği yer tutucuları · `[[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]]`

## E. TEKNİK BAĞIMLILIKLAR (uygulanmadı)

Self-servis silme UI (mobil + web); reauth; kaskad Cloud Function; UGC anonimleştirme; token silme; Storage object delete; yedek politikası; provider revoke; denetim kaydı.  
**Mevcut:** Kurum öğrenci yönetim silmesi Auth + `users` + membership + payments (kısmi); forum/mesaj/duello/token/Storage tam kaskad **yok**.
