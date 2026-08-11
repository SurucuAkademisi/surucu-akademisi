# Üyelik ve Hesap Koşulları — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2B-0.1  
**Yürürlük:** Yok (yayımlanmamıştır)

---

## A. DAHİLİ UYARI (KULLANICIYA GÖSTERİLMEZ)

Nihai üyelik sözleşmesi değildir. Çekirdek işletme kimliği belge 18’de doğrulanmıştır. Ödeme, süre, silme ve ticari ileti hükümleri hukuki inceleme gerektirir. Self-servis hesap silme **eksik/yok** olarak açıklanmalıdır. **LEGAL REVIEW REQUIRED**.

---

## B. KULLANICIYA YÖNELİK TASLAK METİN

### 1. Üyelik türleri

1. Kayıtlı bireysel (public) kullanıcı  
2. Premium / ek yetkili bireysel kullanıcı  
3. Kurum (sürücü kursu) öğrencisi  
4. Kurum temsilcisi / kurum yöneticisi  
5. Super Admin (iç işletme hesabı; genel üyelik değildir)

### 2. Kayıtlı bireysel kullanıcılar

Web üzerinden e-posta ve parola ile kayıt oluşturulabilir. Mobilde Google Sign-In kullanılabilir. Microsoft girişi şu an devre dışıdır.

### 3. Premium bireysel kullanıcılar

Video ders veya reklamsız gibi özellikler hesap yetkilerine bağlı olabilir. Tüm özelliklere sınırsız erişim vaadi yoktur.

### 4. Kurum öğrencileri

Hesaplar kurum temsilcisi veya Super Admin tarafından oluşturulup yönetilebilir. Erişim süresi kurum üyeliğine bağlı olarak sınırlı olabilir.

### 5. Kurum temsilcileri

Kendi kurumlarındaki öğrenci, mesaj, ödeme/bakiye notu ve duyuru süreçlerini yönetebilir. Çapraz kurum erişimi yoktur (Super Admin hariç).

### 6. Hesap oluşturma

Kayıt veya kurum oluşturma sırasında verilen bilgilerin doğru ve güncel olması beklenir.

### 7. Bilgi doğruluğu

Yanlış veya yanıltıcı hesap bilgisi erişimin kısıtlanmasına yol açabilir.

### 8. Kimlik doğrulama ve parolalar

Parolalar düz metin saklanmaz; Firebase Authentication kullanılır. Kullanıcı parolasını gizli tutmakla yükümlüdür.

### 9. Hesap güvenliği

Şüpheli erişimde parola değiştirilmeli ve destek kanallarına bildirilmelidir.

### 10. Hesap paylaşımı

Erişim kontrollerini aşan hesap paylaşımı yasaktır.

### 11. Kurum tarafından oluşturulan öğrenci hesapları

Kurum, öğrenci hesabını oluştururken gerekli asgari bilgileri kullanmalıdır. Kurum kendi iç süreçlerinden sorumludur. **LEGAL REVIEW REQUIRED** (kurum–öğrenci ilişkisi).

### 12. Erişim süresi

Kurum üyeliği bitiş tarihi, deaktivasyon veya Super Admin işlemi ile erişim sona erebilir. Süresiz erişim taahhüdü yoktur.

### 13. Aktivasyon ve deaktivasyon

Kurum veya Super Admin hesapları etkinleştirebilir / devre dışı bırakabilir.

### 14. Premium video erişimi

Yetki kayıtları (`userEntitlements` vb.) üzerinden yönetilebilir. Canlı self-servis online satın alma **şu an aktif değildir**.

### 15. Reklam ve reklamsız yetkiler

Mobilde AdMob (test/geliştirme yapılandırması) bulunabilir. Web AdSense aktif değildir. Reklamsız yetki atanabilir. Kişiselleştirilmiş reklam tercihleri ayrı değerlendirilir.

### 16. Ödeme sistemi durumu

Canlı online ödeme / iyzico / mağaza içi satın alma entegrasyonu **aktif değildir**. Kurum panellerinde manuel ödeme/bakiye kayıtları bulunabilir.

### 17. Bildirimler

Hizmet, güvenlik ve eğitim bildirimleri hesap işleyişinin parçası olabilir. Ticari pazarlama izni üyelikten otomatik doğmaz.

### 18. Askıya alma

Kural ihlali, güvenlik veya yasal zorunluluk halinde hesap askıya alınabilir.

### 19. Sonlandırma

Ciddi veya tekrarlayan ihlallerde hesap sonlandırılabilir. Teknik kalıcı silme kapasitesi sonraki fazda doğrulanmalıdır.

### 20. Hesap ve veri silme durumu

- Web/mobil self-servis hesap silme: **doğrulanmamış / eksik**  
- Yönetici silme: her ilişkili kaydı otomatik silmeyebilir  
- Tam silme ve kaskad davranış: sonraki teknik faz  
- Mobil mağaza silme gereksinimleri: tamamlanmamış  

### 21. Süresi biten kurum üyeliği

Üyelik süresi dolunca eğitim erişimi kısıtlanabilir; kayıtların saklanması saklama politikasına tabidir.

### 22. Olası reşit olmayan kullanıcılar

**[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]**

### 23. Ticari iletişim

Pazarlama / ticari elektronik ileti ayrı izin ve süreç gerektirir (İYS vb. — **LEGAL REVIEW REQUIRED**).

### 24. Kişisel veri bildirimleri

Aydınlatma metinleri ve gizlilik politikası geçerlidir. İletişim taleplerinde `noticeAcknowledged` / `noticeVersion` açık rıza değildir.

### 25. Hizmet değişiklikleri

Üyelik kapsamı ve özellikler değiştirilebilir.

### 26. Sürüm

**[[BELGE_SURUMU]]** · **[[YURURLUK_TARIHI]]** · İşletmeci: **Bilal Aksoy – Sürücü Akademisi**

### 27–28. Yer tutucular ve inceleme

Çekirdek kimlik belge 18’den doldurulmuştur. Yaş/ticari ileti incelemeleri, self-servis silme ve canlı ödeme iddiası yasaktır (ödeme **NOT LIVE**).

---

## C. TEKNİK BAĞIMLILIKLAR

Auth, membership, entitlements, öğrenci oluşturma/silme callables, ödeme stub’ları, hesap silme UI (eksik).
