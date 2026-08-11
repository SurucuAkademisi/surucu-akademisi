# Çerez ve Benzeri Teknolojiler Politikası — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2A-0.1  
**Yürürlük:** Yok (yayımlanmamıştır)

---

## A. DAHİLİ UYARI (KULLANICIYA GÖSTERİLMEZ)

- **Çerez tercih merkezi henüz uygulanmamıştır.**  
- Bu politika, tercih kontrolleri canlıymış gibi yayımlanamaz.  
- Gereksiz teknolojilerin (gömülü medya / gelecekteki reklam) kapısı sonraki teknik faza aittir (L4).  
- Firebase/Auth oturum teknolojileri, reklam ve gömülü medyadan **ayrı** değerlendirilmelidir.  
- Mobil AdMob, web çerezlerinden ayrı mobil açıklama gerektirir.  
- Tam tarayıcı üçüncü taraf çerez taraması tamamlanmış gibi sunulmamalıdır.

---

## B. KULLANICIYA YÖNELİK TASLAK METİN

### 1. Taslak uyarısı

Bu metin iç inceleme taslağıdır; nihai çerez politikası değildir.  
Veri sorumlusu: **Bilal Aksoy – Sürücü Akademisi** · **info@surucuakademisi.com** · **+90 532 058 88 46**  
Adres: **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye**  
**[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]**

### 2. Çerezler ve benzeri teknolojiler nedir?

“Çerezler ve benzeri teknolojiler” ifadesi yalnızca HTTP çerezlerini değil; **localStorage**, **sessionStorage**, kimlik doğrulama kalıcılığı, olası IndexedDB, mobil uygulama tercihleri, gömülü medya ve reklam SDK tanımlayıcılarını da kapsar.

### 3. Güncel birinci taraf çerez durumu

Uygulama kaynak kodunda **bilinçli birinci taraf `document.cookie` yazımı doğrulanmamıştır**.  
Bu, tarayıcı veya üçüncü taraf SDK’ların hiç çerez oluşturmayacağı anlamına gelmez.

Bilinmeyen üçüncü taraf çerezleri için:

`PROVIDER-DYNAMIC / BROWSER-DEPENDENT — TECHNICAL VERIFICATION REQUIRED`

### 4. Kimlik doğrulama ve oturum teknolojileri

Firebase Authentication oturum kalıcılığı (genellikle zorunlu işlevsel / oturum için gerekli sınıfında değerlendirilir — nihai sınıflandırma hukuki incelemededir).  
Web oturum anahtarları sessionStorage üzerinde tutulur.

### 5. localStorage envanter özeti (doğrulanmış)

Örnekler (tam liste ürün sürümüne göre değişebilir):

- Forum kuralları onay anahtarları (`sa_web_forum_rules_ack_v1_…` / mobil eşdeğerleri)  
- Mobil: push ön-izin durumu, duyuru görüldü bayrakları, reklam bekleme süresi, oturum yardımcıları  
- Geliştirme/hata ayıklama anahtarları (üretimde sınırlandırılmalıdır)  

### 6. sessionStorage envanter özeti (doğrulanmış)

- `sa_public_session_v1` — bireysel kullanıcı oturum özeti  
- `sa_web_session_v1` — kurum oturum özeti  
- `sa_selected_tenant_id` — seçili kurum  
- Sınav / ders / pratik rehber gezinme anahtarları  
- Düello inceleme önbellekleri  
- Mobil: push kurulum bayrakları, forum oturum gösterimi vb.  

### 7. Firebase / Auth kalıcılığı

Giriş sonrası Firebase Auth varsayılan kalıcılığı (LOCAL) IndexedDB veya benzeri tarayıcı depoları kullanabilir. Bu, oturumun sürdürülmesi içindir.

### 8. Gömülü YouTube / medya teknolojileri

İçerikte YouTube yerleştirmeleri kullanıldığında Google/YouTube tarafında çerez veya benzeri teknolojiler oluşabilir.  
Bunlar **medya** kategorisinde değerlendirilir; tercih merkezi olmadan “önceden onaylı reklam” sayılmaz.

### 9. Analitik durumu

Web’de GTM / Google Analytics / Facebook pikseli **aktif değildir** (envanter).

### 10. Web reklam durumu

Web AdSense **aktif değildir**. Yer tutucu reklam alanları vardır.

### 11. Mobil AdMob ayrımı

Mobil uygulamada AdMob (ödüllü/geçiş reklamları) vardır; mevcut yapılandırma **test/geliştirme** odaklıdır.  
Cihaz reklam tanımlayıcıları ve kişiselleştirme, **web çerez politikasından ayrı** mobil mağaza ve SDK açıklamaları gerektirir.

### 12. Zorunlu (gerekli) teknolojiler — aday sınıf

- Kimlik doğrulama ve güvenli oturum  
- Güvenlik / kötüye kullanım önleme ile sınırlı teknik kayıtlar  

Nihai “zorunlu” listesi: hukuki + teknik sınıflandırma gerektirir.

### 13. İşlevsel teknolojiler — aday sınıf

- Oturum ve gezinme anahtarları  
- Forum kuralları hatırlama  
- Bildirim ön-tercih bayrakları  

### 14. Medya teknolojileri — aday sınıf

- YouTube gömülü oynatıcıları  

### 15. Analitik teknolojileri

- Şu an web’de aktif birinci taraf analitik doğrulanmamıştır  

### 16. Reklam teknolojileri

- Web: aktif değil  
- Mobil: AdMob (ayrı açıklama)  

### 17. Saklama / süre yer tutucu tablosu

| Teknoloji grubu | Süre |
|-----------------|------|
| Oturum (sessionStorage) | Oturum / sekme ömrü |
| localStorage bayrakları | **[[SAKLAMA_SURESI_HUKUKI_INCELEME]]** / ürün ihtiyacı |
| Firebase Auth kalıcılığı | Hesap oturumu + sağlayıcı politikası |
| YouTube / üçüncü taraf | `PROVIDER-DYNAMIC / BROWSER-DEPENDENT — TECHNICAL VERIFICATION REQUIRED` |
| AdMob tanımlayıcıları | Sağlayıcı + cihaz ayarları; **[[SAKLAMA_SURESI_HUKUKI_INCELEME]]** |

### 18. Tercihlerin nasıl kontrol edileceği (gelecek)

Planlanan (henüz yok): Kabul / Reddet / Ayarlar eşit erişilebilirlik; zorunlu ile zorunlu olmayan ayrımı; geri çekme.

**Bugün:** Çalışan tercih merkezi **yoktur**.

### 19. Tercihin geri alınması / değiştirilmesi

Tercih merkezi sonrası: ayarlardan değişiklik.  
Bugün: tarayıcı depolamasını temizleme / site verilerini silme kullanıcı inisiyatifine bağlıdır (kaba yöntem).

### 20. Tarayıcı ayarları

Kullanıcılar tarayıcılarından çerez ve site verilerini yönetebilir; oturum açma işlevi etkilenebilir.

### 21. Politika güncellemeleri

Yayımlanmış sürüm: **[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]**

### 22. İletişim

**Bilal Aksoy – Sürücü Akademisi** · **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** · **info@surucuakademisi.com** · **+90 532 058 88 46**

### 23. Kontrollü yer tutucular

Çekirdek kimlik belge 18’den doldurulmuştur. Hâlâ PENDING: `[[YURURLUK_TARIHI]]`, `[[BELGE_SURUMU]]`, `[[YURT_DISI_AKTARIM_MEKANIZMASI_HUKUKI_INCELEME_GEREKLI]]` (üçüncü taraf medya/reklam aktarımları için). Cookie preference center **NOT IMPLEMENTED**.

---

## C. DAHİLİ İNCELEME NOTLARI — YAYIN ENGELLERİ

| Madde | Durum |
|-------|--------|
| Cookie preference center | **NOT IMPLEMENTED** |
| Non-essential gating | Sonraki teknik faz |
| Politikanın “canlı kontroller varmış” gibi yayımlanması | **Yasak** |
| Firebase/Auth vs reklam/medya ayrımı | Zorunlu |
| Mobil AdMob | Mobil özel açıklama |
| Tam tarayıcı çerez taraması | Tamamlanmış gibi sunulmaz |

Yurt dışı: **[[YURT_DISI_AKTARIM_MEKANIZMASI]]** / **[[YURT_DISI_AKTARIM_MEKANIZMASI_HUKUKI_INCELEME_GEREKLI]]**
