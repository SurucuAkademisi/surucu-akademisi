# Hukukçu İnceleme ve Onay Kontrol Listesi — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2D-0.1  
**Tarih:** 29 July 2026  
**Mevcut inceleme durumu (tüm belgeler):** `NOT REVIEWED`

---

## 1. Dahili uyarı

Bu kontrol listesi onay üretmez; imza veya “APPROVED FOR PUBLICATION” önceden doldurulmaz. Gelecek iş akışı değerleri: NOT REVIEWED · REVIEW IN PROGRESS · REVISION REQUIRED · APPROVED FOR IMPLEMENTATION · APPROVED FOR PUBLICATION.

## 2. Amaç

Harici hukuk danışmanına teslim ve inceleme kapsamını standartlaştırmak.

## 3. İnceleme kapsamı

Taslaklar 01–16 + konsolidasyon 17–18 + teknik envanter + şirket kimlik paketi (P0 sonrası).

## 4. Teknik envanter paketi (teslim listesi — ek oluşturma yok)

- Repository compliance inventory  
- Legal drafts 01–16  
- Master legal register (17)  
- Company identity / placeholder register (18)  
- Data-flow diagrams *(mevcut dokümantasyondan)*  
- Firestore collection inventory  
- Roles and permissions matrix (Rules özeti)  
- Contact Request data contract (`noticeAcknowledged` / `noticeVersion`)  
- Mobile SDK inventory (12)  
- Cookie/storage inventory (04)  
- Provider register (16)  
- Retention matrix (09)  
- Account-deletion cascade matrix (11)  
- Institution workflow (13)  
- Marketing communication inventory (14)  
- Incident-response matrix (15)  
- Current public pages (Hakkımızda / Hizmetlerimiz; Contact blocked)  
- Registration / login screenshots *(toplanacak)*  
- Current mobile store status (Android exists; iOS not confirmed live)  

## 5. Şirket kimlik paketi

Belge 18 kaynak checklist; değerler doldurulmadan yayın onayı verilmez.

## 6–21. Belge bazlı inceleme alanları

Her belge için counsel: hukuki sebep, saklama, aktarım, reşit olmayan, şirket kimliği, teknik davranış doğruluğu, düzeltme talepleri, onaylı sürüm, yayın onayı.

## 22. Yurt dışı aktarım incelemesi

Firestore europe-west3 vs Functions us-central1; Auth/FCM/Storage/Hosting; OpenAI; AdMob/Google Sign-In; mekanizma `[[YURT_DISI_AKTARIM_MEKANIZMASI]]` / güvence `[[YURT_DISI_AKTARIM_GUVENCESI]]`.

## 23. VERBIS

`[[VERBIS_DURUMU]]` · **PENDING COMPANY DATA**

## 24. Reşit olmayan kullanıcı

`[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]` · AdMob çocuk yönelimli değerlendirme **REQUIRED**

## 25–27. Nihai metin / teknik uygulama / yayın onayı

Yalnızca counsel + teknik onay sonrası. Şu an: **NOT REVIEWED** / yayın **BLOCKED**.

## Counsel review matrix (01–16)

| Document | Legal reviewer | Review date | Legal-basis? | Retention? | Transfer? | Minors? | Company ID verified? | Technical verified? | Required corrections | Approved version | Publication approved? | Signature | Notes |
|----------|----------------|-------------|--------------|------------|-----------|---------|----------------------|---------------------|----------------------|------------------|----------------------|-----------|-------|
| 01 Genel KVKK | | | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | |
| 02 İletişim aydınlatma | | | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | noticeAcknowledged |
| 03 Gizlilik | | | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | vs 10 |
| 04 Çerez | | | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | CMP missing |
| 05 Kullanım | | | NOT REVIEWED | — | — | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | liability |
| 06 Üyelik | | | NOT REVIEWED | — | — | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | deletion gap |
| 07 Başvuru formu | | | NOT REVIEWED | — | — | — | NO | NOT REVIEWED | | | NO | | channels |
| 08 Topluluk | | | NOT REVIEWED | — | — | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | appeal |
| 09 Saklama/imha | | | NOT REVIEWED | NOT REVIEWED | — | — | NO | NOT REVIEWED | | | NO | | periods |
| 10 Mobil gizlilik | | | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | AdMob test |
| 11 Hesap silme | | | NOT REVIEWED | NOT REVIEWED | — | — | NO | NOT REVIEWED | | | NO | | not implemented |
| 12 Mağaza checklist | | | NOT REVIEWED | — | NOT REVIEWED | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | preliminary |
| 13 Kurum çerçeve | | | NOT REVIEWED | NOT REVIEWED | NOT REVIEWED | — | NO | NOT REVIEWED | | | NO | | roles |
| 14 Ticari iletişim | | | NOT REVIEWED | — | NOT REVIEWED | NOT REVIEWED | NO | NOT REVIEWED | | | NO | | İYS |
| 15 İhlal prosedürü | | | NOT REVIEWED | NOT REVIEWED | — | — | NO | NOT REVIEWED | | | NO | | deadlines |
| 16 İşlemci kaydı | | | NOT REVIEWED | — | NOT REVIEWED | — | NO | NOT REVIEWED | | | NO | | DPA |

## 28. Onay delil kaydı

| Evidence ID | Document | Approver | Date | Type | Location |
|-------------|----------|----------|------|------|----------|
| *(empty)* | | | | | |

## 29. Revizyon talep kaydı

| Request ID | Document | Issue | Requested by | Date | Status |
|------------|----------|-------|--------------|------|--------|
| CR-L2D-01 | 01–04 vs 09 | Retention placeholder naming | L2D consolidation | 2026-07-29 | OPEN — do not edit 01–16 in L2D |
| CR-L2D-02 | 03 vs 10 | Dual privacy strategy | L2D | 2026-07-29 | OPEN |
| CR-L2D-03 | 01 | Meta `[[PLACEHOLDER]]` | L2D | 2026-07-29 | OPEN |

## 30. Final sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Legal counsel | | | **NOT SIGNED** |
| Product owner | | | **NOT SIGNED** |
| Engineering lead | | | **NOT SIGNED** |

**Publication approved: NO**

## 31. Dahili notlar

Counsel henüz kontaklanmamıştır (bu fazda yasak). İnceleme P1’de başlar; P0 şirket kimliği önkoşuldur.
