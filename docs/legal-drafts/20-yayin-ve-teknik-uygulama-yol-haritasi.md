# Yayın ve Teknik Uygulama Yol Haritası — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2D-0.1  
**Tarih:** 29 July 2026  
**Uygulama:** Bu belge hiçbir fazı uygulamaz; canlı deploy komutu içermez.

---

## 1. Dahili uyarı

Yayın / teknik uygulama yalnızca P0–P1 sonrası ve ayrı onaylarla. Deploy hedefleri birleştirilmez.

## 2. Amaç

Gelecek yayın sırasını, giriş/çıkış kriterlerini ve deploy ayrımını belgelemek.

## 3. Mevcut durum

| Öğe | Durum |
|-----|-------|
| Legal drafts 01–16 | INTERNAL DRAFT · READY FOR COUNSEL REVIEW |
| L2D consolidation 17–20 | DRAFT COMPLETE (indeks) |
| Company identity | INCOMPLETE |
| Legal review | REQUIRED / NOT REVIEWED |
| Public legal pages | BLOCKED |
| Contact CMS / form | BLOCKED |
| Cookie preference | NOT IMPLEMENTED |
| Account deletion | NOT IMPLEMENTED |
| Store declarations | NOT COMPLETED |
| Overall | `INTERNAL LEGAL DRAFT LIBRARY COMPLETE — COMPANY DATA AND LEGAL REVIEW PENDING` |

## 4. Yayın ilkeleri

1. Şirket kimliği doğrulanmadan kamu metni yok  
2. Counsel onayı olmadan yayın yok  
3. Teknik bağımlılık hazır olmadan “canlı kontrol var” iddiası yok  
4. Contact CMS, form, cookie CMP, silme, mağaza beyanı ayrı kapılar  
5. Deploy hedefleri ayrık  

## 5–7. Önkoşullar

P0 şirket kimliği → P1 counsel inceleme / düzeltici revizyon → metin finalizasyonu.

## 8–24. Hedef alanlar (özet)

Public routes + footer; cookie CMP; Contact + notice; başvuru kanalı; silme; saklama otomasyonu; kurum sözleşme; pazarlama/İYS; olay workflow; DPA/aktarım; mobil privacy link; Play/Apple — her biri ilgili P fazında.

## 25–30. Test / deploy sırası / rollback / delil / post-release / periyodik inceleme

Her faz: staging test → hedef deploy → rollback planı → delil klasörü → yayın sonrası gözden geçirme → yıllık hukuki gözden geçirme.

## 31. Sorumlu roller

Product · Engineering · Legal counsel · Store operator · Ops (`[[OLAY_MUDAHALE_SORUMLUSU]]`) · Institution-contract owner

## 32. Release checklist (hiçbiri şu an tamam değil)

- [ ] P0 company identity  
- [ ] P1 counsel approval  
- [ ] P2 public pages  
- [ ] P3 cookie CMP  
- [ ] P4 Contact  
- [ ] … P5–P12  

## Implementation phases P0–P12

### PHASE P0 — Verified company identity and responsibility register

| Field | Value |
|-------|-------|
| Objective | Fill belge 18 with verified company data and role owners |
| Required input | Formation/tax/MERSİS/KEP/domain docs |
| Files/systems | docs/legal-drafts/18 (+ later placeholder fills in 01–16) |
| Legal approval | Required for values |
| Technical approval | N/A |
| Test | Consistency check across placeholders |
| Deployment target | Docs only |
| Rollback | Revert doc values |
| Evidence | Source checklist completed |
| Entry | L2D complete |
| Exit | All critical identity placeholders verified; roles named |
| Current status | **NOT STARTED** · **BLOCKED** (no company data pack) |

### PHASE P1 — Counsel review and corrective revisions

| Field | Value |
|-------|-------|
| Objective | Review 01–16; resolve CR-L2D queue; approve wording |
| Required input | P0 + handoff package (19) |
| Files/systems | drafts 01–16 corrective edits only after counsel |
| Legal approval | Required |
| Technical approval | Technical accuracy sign-off |
| Test | Cross-doc consistency |
| Deployment target | Docs only |
| Rollback | Prior draft versions |
| Evidence | Matrix 19 signed |
| Entry | P0 exit |
| Exit | APPROVED FOR IMPLEMENTATION (not necessarily publication) |
| Current status | **NOT STARTED** · **BLOCKED** (P0) |

### PHASE P2 — Public legal pages and footer

| Field | Value |
|-------|-------|
| Objective | Publish approved legal routes + footer links |
| Required input | P1 publication approval for public docs |
| Files/systems | `hosting-web/**` routes |
| Legal approval | APPROVED FOR PUBLICATION |
| Technical approval | Required |
| Test | Mobile/desktop links; no draft watermark |
| Deployment target | **Public web deploy only** |
| Rollback | Unpublish routes / prior hosting |
| Evidence | URLs live + version |
| Entry | P1 exit for public set |
| Exit | Pages live; footer OK |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P3 — Cookie preference center

| Field | Value |
|-------|-------|
| Objective | CMP / non-essential gating |
| Required input | Approved 04 |
| Files/systems | hosting-web (+ maybe mobile later) |
| Legal / Technical | Both |
| Test | Reject/accept paths; YouTube/AdSense gating |
| Deployment target | Public web (separate from Admin) |
| Rollback | Disable CMP; essential-only |
| Entry | P2 recommended |
| Exit | Preference center live |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P4 — Contact notice + `/iletisim/`

| Field | Value |
|-------|-------|
| Objective | Public Contact form with notice acknowledgement |
| Required input | Approved 02; P2 privacy links |
| Files/systems | hosting-web; Contact CMS publish; existing Functions |
| Legal / Technical | Both |
| Test | noticeAcknowledged path; rate limits |
| Deployment target | Public web + Admin CMS publish step (separate) + Functions if needed |
| Rollback | Unpublish form/CMS |
| Entry | P1+P2; CMS alignment |
| Exit | Form live; CMS published intentionally |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P5 — Data subject application intake

| Field | Value |
|-------|-------|
| Objective | Channel + internal tracking for 07 |
| Required input | Approved 07; channels |
| Files/systems | Web form and/or ops process; optional Functions |
| Deployment target | Public web and/or internal ops only |
| Entry | P1 |
| Exit | Intake works; 30-day tracking |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P6 — Account deletion + public deletion resource

| Field | Value |
|-------|-------|
| Objective | In-app + `/hesap-silme/` + cascade |
| Required input | Approved 11 |
| Files/systems | mobile_app; hosting-web; Functions; Auth |
| Deployment target | Mobile sync/build **separate**; Public web **separate**; Functions **separate** |
| Entry | P1; store requirements |
| Exit | Deletion usable; store URLs ready |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P7 — Retention / destruction automation

| Field | Value |
|-------|-------|
| Objective | Scheduled retention per approved 09 |
| Required input | Legal periods filled |
| Files/systems | Functions scheduled jobs; Rules if needed |
| Deployment target | **Functions deploy** (+ Rules only if needed, separate) |
| Entry | P1 periods + P6 design |
| Exit | Jobs documented and running |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P8 — Institution contractual onboarding

| Field | Value |
|-------|-------|
| Objective | Role-classified institution agreement |
| Required input | Approved 13; roles |
| Files/systems | Contract process; maybe Admin flags |
| Deployment target | Docs/ops; Admin only if UI |
| Entry | P0+P1 |
| Exit | Agreement template in use |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P9 — Commercial communication / İYS (only if used)

| Field | Value |
|-------|-------|
| Objective | Separate marketing consent + İYS if commercial messages used |
| Required input | Approved 14; `[[IYS_DURUMU]]` |
| Files/systems | Consent UI; provider; İYS sync |
| Deployment target | Web/mobile/Functions as needed (split) |
| Entry | Business decision to send marketing |
| Exit | Consent provable; İYS aligned if required |
| Current status | **NOT STARTED** · **BLOCKED** (and may remain unused) |

### PHASE P10 — Security incident operational workflow

| Field | Value |
|-------|-------|
| Objective | Operationalize 15 |
| Required input | Owners; counsel channels |
| Files/systems | Ticketing/runbooks (not necessarily product code) |
| Deployment target | Ops tooling |
| Entry | P0 owners + P1 |
| Exit | Drill completed |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P11 — Provider contracts + transfer mechanism

| Field | Value |
|-------|-------|
| Objective | DPA evidence; `[[YURT_DISI_AKTARIM_MEKANIZMASI]]` set |
| Required input | 16 + counsel |
| Files/systems | Contract archive; disclosure updates |
| Deployment target | Docs / legal pages update if needed (web separate) |
| Entry | P0 signatory + P1 |
| Exit | DPAs verified; mechanism documented |
| Current status | **NOT STARTED** · **BLOCKED** |

### PHASE P12 — Google Play / future Apple alignment

| Field | Value |
|-------|-------|
| Objective | Data Safety / App Privacy / deletion declarations |
| Required input | 12; live privacy+deletion URLs; P6 |
| Files/systems | Store consoles; mobile build |
| Deployment target | **Store submission** separate from Firebase hosting |
| Entry | P2/P6/P11 as applicable; Android listing ready |
| Exit | Declarations submitted with evidence |
| Current status | **NOT STARTED** · **BLOCKED** |

## Deployment separation (zorunlu)

| Target | Examples | Do not mix with |
|--------|----------|-----------------|
| Public web deploy | hosting-web | Admin, Functions, mobile |
| Admin deploy | hosting-admin | Public web |
| Functions deploy | functions* | Hosting |
| Firestore Rules deploy | firestore.rules | App code |
| Mobile Android sync/build | mobile_app | Store submit |
| Store submission | Play / App Store consoles | Firebase deploy |

Live deploy commands bu belgede verilmez.

## 33–34. Yer tutucular / notlar

URL ve süre placeholder’ları belge 18.  
Next operational milestone: **P0 — VERIFIED COMPANY IDENTITY AND RESPONSIBILITY REGISTER**.  
L2D yalnızca dokümantasyon tamamlar; yayın hazır değildir.
