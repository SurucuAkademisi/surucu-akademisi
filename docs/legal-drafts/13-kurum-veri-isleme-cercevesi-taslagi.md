# Kurum Veri İşleme Çerçevesi — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2C-B-0.1  
**Yürürlük:** Yok (yayımlanmamıştır)  
**Sözleşme durumu:** `[[KURUM_SOZLESMESI_SURUMU]]` · `[[VERI_ISLEYEN_SOZLESMESI_DURUMU]]` — **NOT COMPLETED**

---

## A. DAHİLİ UYARI

Bu belge nihai kurum sözleşmesi veya imzalanmış veri işleme anlaşması değildir. Tarafların veri sorumlusu / veri işleyen rolleri işlem bazında değişebilir. Tek tarafın her işlem için tek veri sorumlusu olduğu otomatik kabul edilmez.

`ROLE CLASSIFICATION — LEGAL REVIEW REQUIRED`

---

## B. ÇERÇEVE TASLAĞI

### 1. Amaç

Sürücü Akademisi platformunu kullanan sürücü kursu / kurumlar ile platform işletmecisi arasındaki kişisel veri işleme rollerini, sorumlulukları ve teknik sınırları çerçevelemek.

### 2. Kapsam

- Kurum paneli (tenant)  
- Kurum öğrencisi hesapları ve üyelikleri (`tenantMemberships`)  
- Kurum mesajları, duyuruları, ödeme/bakiye kayıtları  
- Kurumlar-İletişim odaları (kurum yöneticileri arası; kamu sosyal ağı değil)  
- Mevzuat Asistanı (Admin / kurum araç yolu)  
- Platform tarafı Firebase / Functions altyapısı  

Bağımsız kaydolmuş public kullanıcıların kurum dışı kullanımı ayrı aydınlatma ve koşullara tabidir.

### 3. Taraflar ve yer tutucular

| Taraf | Yer tutucu / rol adayı |
|-------|------------------------|
| Platform işletmecisi | **[[VERI_SORUMLUSU_TICARI_UNVANI]]** · `[[PLATFORM_VERI_SORUMLUSU_ROLU]]` |
| Kurum (sürücü kursu) | Kurum ticari unvanı (kurum sözleşmesinde) · `[[KURUM_VERI_SORUMLUSU_ROLU]]` |
| Öğrenci / kullanıcı | İlgili kişi |

### 4. Kurum ilişki modelleri

Ayrı değerlendirilir:

1. Kurum, kendi öğrencileri adına platforma erişim sağlar  
2. Sürücü Akademisi platformu işletir  
3. Kurum tarafından oluşturulan öğrenci hesabı  
4. Bağımsız kaydolmuş public kullanıcı  
5. Public kullanıcının sonradan kuruma bağlanması  
6. Birden fazla tenant üyeliği olan kullanıcı  
7. Eski (üyeliği bitmiş) kurum öğrencisi  

### 5–8. Rol değerlendirmesi

| Senaryo | Kurum adayı rolü | Platform adayı rolü | Durum |
|---------|------------------|---------------------|-------|
| Öğrenci hesabını kurum oluşturur / yönetir | Veri sorumlusu veya ortak (öğrenci ilişkisi) | Platform işletimi / olası işleyen veya bağımsız sorumluluk | `ROLE CLASSIFICATION — LEGAL REVIEW REQUIRED` |
| Platform eğitim içeriği, Auth, altyapı | — | Veri sorumlusu adayı (platform amaçları) | Aynı |
| Kurum paneli üzerinden öğrenci ilerleme izleme | Kurum amaçları | Teknik barındırma | Aynı |
| Kurumlar-İletişim | Kurum temsilcisi iletişim | Platform barındırma | Aynı |
| Super Admin çapraz tenant erişimi | — | Platform işletme / destek | Aynı |
| Ortak / bağımsız işleme | İşlem bazlı | İşlem bazlı | Aynı |

Nihai sınıflandırma: `[[KURUM_VERI_SORUMLUSU_ROLU]]` · `[[PLATFORM_VERI_SORUMLUSU_ROLU]]` · `[[VERI_ISLEYEN_SOZLESMESI_DURUMU]]`

### 9. Kurum öğrenci hesabı oluşturma

Kurum temsilcisi veya Super Admin öğrenci hesabı oluşturabilir. Tipik / koşullu alanlar:

- Ad / görünen ad  
- Kullanıcı adı  
- E-posta *(varsa)*  
- Firebase UID  
- Tenant membership  
- Hesap durumu  
- Erişim başlangıç / bitiş  

**Sağlık verisi, kimlik belgesi veya biyometrik veri zorunlu değildir.** Kurumlar gereksiz hassas veri yüklememelidir.

### 10. Aktivasyon ve deaktivasyon

Üyelik `active` / deaktive edilebilir. Deaktivasyon erişimi kısıtlar; **tam hesap silme değildir**.

### 11. Erişim süresi

Üyelik bitiş tarihi veya yönetim işlemi ile erişim sona erebilir. Süresiz erişim taahhüdü yoktur.

### 12. Öğrenci ilerleme izleme

Kurum paneli kendi tenant’ındaki sınav, ders, video ilerleme / erişim bilgilerini izleyebilir (kurallar ve panel yetkileri çerçevesinde).

### 13. Mesajlar ve bildirimler

Tenant mailbox, kurum duyuruları ve FCM push (aktif üyelik / token varsa) kullanılabilir. Her bildirim ticari pazarlama değildir (bkz. belge 14).

### 14. Kurumlar-İletişim odaları

Kurum yöneticileri arası sektörel iletişim; kamu kullanıcı sosyal ağı değildir. `functions_institution_chat` ve ilgili kurallar.

### 15. Ödeme ve bakiye kayıtları

`studentPayments` / paymentLog: manuel kurum kayıtları. Canlı online ödeme checkout **aktif değildir**.

### 16. Teknik destek

Super Admin destek amaçlı çapraz tenant erişimine sahip olabilir. Erişim asgari ve amaçla sınırlı olmalıdır. Bağımsız güvenlik sertifikası iddiası yoktur.

### 17. Güvenlik sorumlulukları

| Konu | Kurum | Platform |
|------|-------|----------|
| Temsilci hesap güvenliği | Evet | Rehberlik |
| Öğrenci parola paylaşımı yasağı | Evet | Platform kuralları |
| Altyapı / Rules / Functions | — | Evet |
| Yetkisiz veri yükleme | Evet (yasak) | Denetim / kaldırma |

### 18. Erişim kontrolleri (teknik)

- Tenant ayrımı (`tenantId` / membership)  
- Kurum admini yalnızca kendi tenant’ı (`isInstitutionAdminForTenant`)  
- Super Admin çapraz tenant (`isSuperAdmin`)  
- Öğrenci yönetimi callables (`functions_student_admin`)  
- Firestore Rules rol kontrolleri  
- Üyelik bitince erişim iptali (status)  
- Deaktivasyon sonrası veri silmenin eksik kalma riski  
- Periyodik erişim gözden geçirme ihtiyacı  

Penetrasyon testi / bağımsız sertifikasyon iddiası **yoktur**.

### 19. Gizlilik

Kurum, öğrenci verilerini eğitim / üyelik amaçları dışında paylaşmamalıdır. Platform personeli destek dışında kullanmamalıdır.

### 20. Veri doğruluğu

Kurum, oluşturduğu öğrenci bilgilerinin doğru ve güncel tutulmasından sorumludur (kendi süreçleri).

### 21. İlgili kişi başvuruları

Öğrenci başvuruları platform ve/veya kuruma yöneltilebilir. İşlem paylaşımı ve yanıt: **LEGAL REVIEW REQUIRED**. Form taslağı: belge 07.

### 22. Hesap silme talepleri

Kurum yönetim silmesi kısmi kaskaddır (Auth + users + membership + payments olabilir); forum/mesaj/token/Storage tam kaskad **UNVERIFIED**. Self-servis silme **NOT IMPLEMENTED**. Deaktivasyon ≠ silme (belge 11).

### 23. Saklama ve imha

`[[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]]` · belge 09. Otomasyon **NOT IMPLEMENTED**.

### 24. Veri ihlalleri

Bildirim ve iş birliği: belge 15. `[[VERI_IHLALI_BILDIRIM_SURECI]]`

### 25. Üçüncü taraf hizmetler

Firebase / Google, OpenAI (Mevzuat), FCM, Storage vb. — belge 16. Kurum kendi ek işlemcilerini platforma yüklemeden önce bildirmelidir.

### 26. Uluslararası işleme

`[[YURT_DISI_AKTARIM_MEKANIZMASI]]` · `[[YURT_DISI_AKTARIM_GUVENCESI]]` — **LEGAL REVIEW REQUIRED**

### 27–28. Sözleşme sonu / veri iade veya silme

Sözleşme bitişinde erişim kapatılır; veri iade/silme kapsamı ve süreleri sözleşmede belirlenir — **NOT COMPLETED**. `[[KURUM_SOZLESMESI_SURUMU]]`

### 29. Denetim ve delil

Membership, paymentLog, Admin işlem kayıtları, callable sonuçları. Erişim kısıtlı.

### 30. Kontrollü yer tutucular

`[[KURUM_SOZLESMESI_SURUMU]]` · `[[KURUM_VERI_SORUMLUSU_ROLU]]` · `[[PLATFORM_VERI_SORUMLUSU_ROLU]]` · `[[VERI_ISLEYEN_SOZLESMESI_DURUMU]]` · şirket kimliği · saklama · yurt dışı aktarım

---

## C. HUKUKİ İNCELEME NOTLARI

1. Rol sınıflandırması işlem bazlı yapılmalı; tek cümlelik “kurum her zaman işleyen” ifadesi kullanılmamalı.  
2. Çoklu tenant ve public→kurum bağlama senaryoları özel risk.  
3. Hassas veri yasağı kurum sözleşmesine yazılmalı.  
4. Silme / deaktivasyon ayrımı netleştirilmeli.

## D. TEKNİK BAĞIMLILIKLAR

Kurum sözleşmesi UI/imza süreci yok; DPA yok; periyodik access review otomasyonu yok; tam silme kaskadı yok; VERBIS / şirket kimliği eksik.
