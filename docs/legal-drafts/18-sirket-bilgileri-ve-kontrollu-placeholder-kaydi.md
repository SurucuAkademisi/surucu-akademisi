# Şirket Bilgileri ve Kontrollü Placeholder Kaydı — Taslak

**Belge durumu:** `INTERNAL DRAFT — LEGAL REVIEW REQUIRED`  
**Sürüm taslağı:** L2D-0.2  
**Tarih:** 09 August 2026  
**Şirket kimliği:** `SOLE PROPRIETORSHIP ESTABLISHED — CORE IDENTITY VERIFIED — SOME REGISTRY / LEGAL REVIEW FIELDS PENDING`  
**Yayın onayı:** **NO** · `PUBLICATION APPROVED` **değildir**

---

## 1. Dahili uyarı

Bu kayıt, doğrulanmış çekirdek kimliği belgeler; **MERSİS / KEP / sicil / vergi numarası uydurmaz**.  
Diğer taslaklara (01–17, 19–20) otomatik yayılmaz. Kamuya bağlanmaz.  
Durum: **INTERNAL DRAFT — LEGAL REVIEW REQUIRED**. Yayın için güvenli değildir.

## 2. Amaç

Veri sorumlusu / işletme kimliği ve tüm `[[PLACEHOLDER_*]]` alanlarını tek tabloda izlemek.

## 2b. Hukuki ayrım (ticaret unvanı)

Vergi levhasında **“Ticaret Unvanı” alanı boştur**.

Bu nedenle:

- **YAPILMAZ:** “Tescilli Ticaret Unvanı: Sürücü Akademisi” iddiası  
- **YAPILMAZ:** “Sürücü Akademisi”nin tescilli ticaret unvanı olduğu beyanı  

Kullanılan model:

| Kavram | Değer |
|--------|-------|
| Veri sorumlusu / yasal işletmeci (kamuya gösterim) | **Bilal Aksoy – Sürücü Akademisi** |
| Gerçek kişi / mükellef | **Bilal Aksoy** |
| Marka | **Sürücü Akademisi** |
| İşletme türü | **Şahıs işletmesi** (gerçek kişi işletmesi) |

`[[VERI_SORUMLUSU_TICARI_UNVANI]]` placeholder’ı sonraki metinlerde **tescilli ticaret unvanı** olarak değil; **yasal işletmeci / veri sorumlusu gösterim adı** olarak doldurulmalıdır: `Bilal Aksoy – Sürücü Akademisi`.

---

## 3–11. Kimlik / sicil / vergi / iletişim / adres / KEP / yetkili / başvuru kanalları

| Alan | Değer |
|------|-------|
| Yasal işletmeci / gösterim adı | **Bilal Aksoy – Sürücü Akademisi** → `[[VERI_SORUMLUSU_TICARI_UNVANI]]` *(tescilli ticaret unvanı değil)* |
| Gerçek kişi / mükellef | **Bilal Aksoy** |
| Marka | **Sürücü Akademisi** |
| İşletme türü | **Şahıs işletmesi** → `[[SIRKET_TURU]]` |
| Merkez / işyeri adresi | **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** → `[[MERKEZ_ADRESI]]` |
| MERSİS | **PENDING / NOT CURRENTLY AVAILABLE** → `[[MERSIS_NUMARASI]]` · ödeme / e-ticaret canlıya alınmadan önce gerekirse yeniden doğrulanacak; şu an placeholder değeri olarak kullanılmıyor |
| Vergi dairesi | **Alemdar Vergi Dairesi** → `[[VERGI_DAIRESI]]` |
| Vergi numarası | **PENDING_VERIFIED_ENTRY** → `[[VERGI_NUMARASI]]` · `taxNumberStatus: PENDING_VERIFIED_ENTRY` · tahmin yok; TCKN kamuya yazılmaz |
| Ticaret / esnaf sicil | **PENDING VERIFICATION WITH ACCOUNTANT / REGISTRY** → `[[TICARET_SICIL_NUMARASI]]` · NACE’den tacir/esnaf çıkarımı yapılmaz |
| Faaliyete başlama | **03.08.2026** |
| NACE / ana faaliyet kodu | **621000** |
| Ana faaliyet | Bilgisayar programlama faaliyetleri (sistem, veri tabanı, network, web sayfası yazılımları, müşteriye özel yazılım kodlama, masaüstü ve mobil uygulama geliştirme vb.) |
| Web sitesi | **https://surucuakademisi.com** |
| İletişim e-posta | **info@surucuakademisi.com** → `[[ILETISIM_EPOSTASI]]` |
| Telefon | **+90 532 058 88 46** → `[[TELEFON_NUMARASI]]` |
| KEP | **PENDING / NOT PROVIDED** → `[[KEP_ADRESI]]` · başvuru kanalı olarak kullanılmaz |
| Başvuru / posta adresi | İşyeri adresi ile aynı (ayrı başvuru adresi henüz ayrılmadı) → `[[VERI_SORUMLUSU_BASVURU_ADRESI]]` |
| Yetkili kişi/birim | **Bilal Aksoy** (şahıs işletmesi işletmecisi) → `[[YETKILI_KISI_BIRIMI]]` · birim yapısı hukuki incelemede netleştirilebilir |

Başvuru kanalları (e-posta, telefon, posta adresi; KEP yok): **FINAL CHANNEL SET — LEGAL REVIEW REQUIRED**.  
`[[GUVENLI_ELEKTRONIK_IMZA_KANALI]]`, `[[KAYITLI_BASVURU_EPOSTASI]]` hâlâ PENDING.

## 11b. Ticari elektronik ileti / İYS

| Madde | Durum |
|-------|-------|
| Reklam / tanıtım SMS | **NOT CURRENTLY ACTIVE** |
| Pazarlama e-posta kampanyası | **NOT CURRENTLY ACTIVE** |
| İstenmeyen ticari elektronik ileti | **NOT CURRENTLY ACTIVE** |
| İYS / MERSİS pazarlama iş akışı | **DEFERRED / RECHECK IF MARKETING COMMUNICATIONS ARE ENABLED** → `[[IYS_DURUMU]]` |
| Kalıcı muafiyet iddiası | **YAPILMAZ** · İYS’nin hiç gerekmeyeceği iddia edilmez |

## 11c. Ödeme / banka

| Madde | Durum |
|-------|-------|
| iyzico hesabı | **NOT OPENED YET** |
| Online ödeme altyapısı | **NOT LIVE** |
| İşletme banka hesabı / IBAN | **PLANNED / PENDING** |
| Karar | Ödeme sağlayıcı onboarding, özel banka hesabı / IBAN hazır olduktan sonra başlar |
| Yasal metinlerde “ödeme canlı değil” | Korunur; bu kayıt aksi iddia etmez |

## 12–16. Rol sahipleri

| Rol | Atama |
|-----|-------|
| Provider-contract owner | **PENDING** (aday: Bilal Aksoy) |
| Incident-response owner | `[[OLAY_MUDAHALE_SORUMLUSU]]` = **PENDING** (aday: Bilal Aksoy) |
| Legal-document owner | **PENDING** (aday: Bilal Aksoy) |
| Store-account owner | **PENDING** |
| Institution-contract owner | **PENDING** (aday: Bilal Aksoy) |

## 17. Domain ve e-posta sahipliği

| Öğe | Durum |
|-----|-------|
| Domain | `surucuakademisi.com` — sahiplik kaydı **PENDING verification** |
| İletişim e-posta | `info@surucuakademisi.com` — kamuya açık kanal; controller e-posta ile hizalı |
| Firebase billing/account owner | PENDING |
| Cloudflare account owner | UNVERIFIED / PENDING |
| Google Play developer identity | PENDING |
| Apple developer identity | PENDING (iOS not live) |

## 18. Placeholder master tablosu

| Placeholder | Meaning | Documents | Required source | Responsible | Current value | Verification | Legal approval | Safe to publish? | Notes |
|-------------|---------|-----------|-----------------|-------------|---------------|--------------|----------------|------------------|-------|
| `[[VERI_SORUMLUSU_TICARI_UNVANI]]` | Controller / legal operator display name | 01–16 (çoğu) | Tax cert + product | Legal | **Bilal Aksoy – Sürücü Akademisi** | CORE VERIFIED | NOT REVIEWED | **NO** | Not a registered trade title; trade-name field on tax cert blank |
| `[[SIRKET_TURU]]` | Entity type | 01,02,05,07,10 | Tax cert | Legal | **Şahıs işletmesi** | CORE VERIFIED | NOT REVIEWED | **NO** | Gerçek kişi işletmesi |
| `[[MERKEZ_ADRESI]]` | Registered / workplace address | 01–05,07,09,10 | Tax cert | Legal | **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** | CORE VERIFIED | NOT REVIEWED | **NO** | |
| `[[MERSIS_NUMARASI]]` | MERSİS | 01 | MERSİS | Legal | **PENDING / NOT CURRENTLY AVAILABLE** | NOT VERIFIED | NOT REVIEWED | **NO** | Re-verify before payment/e-commerce go-live if required; do not invent |
| `[[VERGI_DAIRESI]]` | Tax office | 01 | Tax certificate | Legal | **Alemdar Vergi Dairesi** | CORE VERIFIED | NOT REVIEWED | **NO** | |
| `[[VERGI_NUMARASI]]` | Tax number | 01 | Tax certificate | Legal | **PENDING_VERIFIED_ENTRY** | NOT VERIFIED | NOT REVIEWED | **NO** | taxNumberStatus PENDING; no TCKN in public placeholders |
| `[[TICARET_SICIL_NUMARASI]]` | Trade / artisan registry | 01 | Accountant / registry | Legal | **PENDING VERIFICATION WITH ACCOUNTANT / REGISTRY** | NOT VERIFIED | NOT REVIEWED | **NO** | Do not infer from NACE |
| `[[ILETISIM_EPOSTASI]]` | Official / public e-mail | 01–05,07,09,10 | Product | Legal | **info@surucuakademisi.com** | CORE VERIFIED | NOT REVIEWED | **NO** | |
| `[[TELEFON_NUMARASI]]` | Phone | 01,02,03,05,07,10 | Product | Legal | **+90 532 058 88 46** | CORE VERIFIED | NOT REVIEWED | **NO** | |
| `[[KEP_ADRESI]]` | KEP | 01,07,10 | KEP record | Legal | **PENDING / NOT PROVIDED** | NOT VERIFIED | NOT REVIEWED | **NO** | Not a contact route until verified |
| `[[VERI_SORUMLUSU_BASVURU_ADRESI]]` | Application / postal address | 02,03,07,10 | Same as workplace | Legal | **Sarımeşe Mah. Sade Sk. No: 29 C İç Kapı No: 10, Kartepe / Kocaeli, Türkiye** | CORE VERIFIED | NOT REVIEWED | **NO** | Same as merkez unless later separated |
| `[[YETKILI_KISI_BIRIMI]]` | Authorized person / unit | 02,03,07,09–11,15 | Operator | Legal | **Bilal Aksoy** | CORE VERIFIED | NOT REVIEWED | **NO** | Sole proprietor; org unit TBD by counsel |
| `[[YURURLUK_TARIHI]]` | Effective date | 01–10 | Counsel+product | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Business start 03.08.2026 ≠ policy effective date |
| `[[BELGE_SURUMU]]` | Doc version | 01–10 | Docs | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[HUKUKI_SEBEP_NIHAI_INCELEME_GEREKLI]]` | Legal basis flag | 02,10 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Flag not a value |
| `[[SAKLAMA_SURESI_HUKUKI_INCELEME_GEREKLI]]` | Retention period | 09–11,13,15 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Canonical name preferred |
| `[[SAKLAMA_SURESI_HUKUKI_INCELEME]]` | Legacy retention | 02,03,04 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Align with GEREKLI |
| `[[YURT_DISI_AKTARIM_MEKANIZMASI]]` | Transfer mechanism | 02–04,10,13,14,16 | Counsel+DPA | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Unresolved |
| `[[YURT_DISI_AKTARIM_MEKANIZMASI_HUKUKI_INCELEME_GEREKLI]]` | Transfer review flag | 02,03,04 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[YURT_DISI_AKTARIM_GUVENCESI]]` | Transfer safeguard | 13,16 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[VERBIS_DURUMU]]` | VERBIS status | 03,09 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Still counsel decision |
| `[[YAS_POLITIKASI_HUKUKI_INCELEME_GEREKLI]]` | Age/minors | 03,05,06,08,10,12,14 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[GOOGLE_PLAY_UYGULAMA_URLSI]]` | Play URL | 10,12 | Store listing | Store | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Do not invent |
| `[[APPLE_APP_STORE_UYGULAMA_URLSI]]` | App Store URL | 10,12 | Store listing | Store | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | iOS not live |
| `[[GIZLILIK_POLITIKASI_PUBLIC_URLSI]]` | Public privacy URL | 10,12 | Hosting | Eng | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | MISSING |
| `[[HESAP_SILME_PUBLIC_URLSI]]` | Deletion URL | 10–12 | Hosting | Eng | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | NOT IMPLEMENTED |
| `[[HESAP_SILME_TAMAMLANMA_SURESI]]` | Deletion SLA | 10,11,12 | Counsel+Eng | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[HESAP_SILME_DESTEK_KANALI]]` | Deletion support | 10–12 | Support | Ops | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Candidate: info@ / phone |
| `[[KURUM_SOZLESMESI_SURUMU]]` | Institution agreement ver | 13 | Contract | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[KURUM_VERI_SORUMLUSU_ROLU]]` | Institution role | 13 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[PLATFORM_VERI_SORUMLUSU_ROLU]]` | Platform role | 13 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[VERI_ISLEYEN_SOZLESMESI_DURUMU]]` | Processor agreement | 13,16 | Contracts | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[IYS_DURUMU]]` | İYS status | 14 | İYS | Legal | **DEFERRED / RECHECK IF MARKETING ENABLED** | PRODUCT DECISION RECORDED | NOT REVIEWED | **NO** | Marketing SMS/e-mail not currently active; not a permanent exemption |
| `[[TICARI_ILETISIM_ONAY_METNI_SURUMU]]` | Marketing consent ver | 14 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | N/A while marketing inactive |
| `[[VERI_IHLALI_BILDIRIM_SURECI]]` | Breach notify process | 13,15 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[OLAY_MUDAHALE_SORUMLUSU]]` | Incident owner | 15 | Org | Ops | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | Candidate: Bilal Aksoy |
| `[[KVKK_KURUL_BILDIRIM_KANALI]]` | Board notify channel | 15 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[ETKILENEN_KISI_BILDIRIM_KANALI]]` | Affected person channel | 15 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[TEDARIKCI_SOZLESME_DURUMU]]` | Supplier contract status | 15,16 | Contracts | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | UNVERIFIED |
| `[[GUVENLI_ELEKTRONIK_IMZA_KANALI]]` | E-sign channel | 07 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[KAYITLI_BASVURU_EPOSTASI]]` | Registered app e-mail | 07 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | May align with info@ after counsel |
| `[[ITIRAZ_SURECI]]` | Community appeal | 08 | Counsel+Eng | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[UYGULANACAK_HUKUK]]` | Governing law | 05 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[UYUSMAZLIK_COZUMU]]` | Dispute resolution | 05 | Counsel | Legal | PENDING VERIFIED COMPANY DATA | NOT VERIFIED | NOT REVIEWED | **NO** | |
| `[[PLACEHOLDER]]` | Non-controlled meta in 01 | 01 only | — | Docs | N/A | CORRECTIVE REVIEW REQUIRED | — | **NO** | Replace in later corrective |

## 19. Placeholder kullanım haritası (özet)

- Kimlik seti: 01–07, 09–10, 13  
- Saklama: 02–04 (legacy), 09–11, 13, 15 (GEREKLI)  
- Aktarım: 02–04, 10, 13–14, 16  
- Silme/URL: 10–12  
- Kurum/İYS/ihlal: 13–16  
- Mağaza URL: 10, 12  

## 20. Eksik bilgi kontrol listesi

- [x] Yasal işletmeci gösterim adı / tür (çekirdek)  
- [x] Merkez adresi / vergi dairesi / NACE / başlangıç  
- [x] Resmî e-posta / telefon  
- [ ] MERSİS  
- [ ] Vergi numarası (PENDING_VERIFIED_ENTRY)  
- [ ] Ticaret / esnaf sicil sınıflandırması  
- [ ] KEP  
- [ ] Rol sahipleri resmi ataması (12–16)  
- [ ] Public privacy + deletion URLs  
- [ ] Play / Apple listing URLs  
- [ ] VERBIS kararı girdisi  
- [ ] Yurt dışı aktarım mekanizması  
- [ ] Saklama süreleri (counsel)  

## 21. Kaynak belge kontrol listesi (gelecek — yükleme yok)

- [x] Tax certificate (çekirdek alanlar bu kayıtta kullanıldı; belge dosyası repoya yüklenmedi)  
- [ ] Trade registry gazette / artisan registry  
- [ ] MERSİS record  
- [ ] Signature circular (if applicable)  
- [ ] Registered office evidence (additional)  
- [ ] KEP record  
- [ ] Domain ownership record  
- [ ] Corporate e-mail ownership  
- [ ] Google Play developer account identity  
- [ ] Apple developer account identity (when applicable)  
- [ ] Firebase billing/account owner  
- [ ] Cloudflare account owner  
- [ ] Provider-contract signatory  
- [ ] Bank/company payment account / IBAN (when required)  
- [ ] iyzico merchant onboarding (after bank account)  

## 22–24. Doğrulama / değişiklik günlüğü / notlar

| Placeholder set | Verified by | Date | Approved for publication |
|-----------------|-------------|------|--------------------------|
| Core identity (operator, brand, type, address, tax office, NACE, start, email, phone) | Product / tax certificate (user-provided) | 09 August 2026 | **NO** |
| MERSİS / KEP / registry / tax number / counsel fields | — | — | **NO** |

Changelog:

- L2D-0.1 — initial empty register (29 July 2026).  
- L2D-0.2 — sole proprietorship core identity recorded (09 August 2026). Stale “company not established / all identity missing” status replaced. No MERSİS/KEP/registry/tax number invented. Marketing/İYS deferred. Payment not live. **LEGAL REVIEW REQUIRED** retained. **PUBLICATION APPROVED** not set.
