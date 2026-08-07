# Payment Infrastructure — Sürücü Akademisi

Bu doküman, bireysel **Video Öğretmen Dersleri Premium** satın alma altyapısının veri modeli, güvenlik kuralları ve faz planını tanımlar.

**Phase 4A-1 kapsamı:** Dokümantasyon + Firestore rules + indeksler. Gerçek ödeme sağlayıcı entegrasyonu, Cloud Functions ve otomatik entitlement grant bu fazda **aktif değildir**.

---

## 1. Ürün tanımı

| Alan | Değer |
|------|-------|
| `productType` | `video_lessons_180_days` |
| `productTitle` | Video Öğretmen Dersleri Premium |
| `amount` | `249` |
| `currency` | `TRY` |
| `durationDays` | `180` |

**İş kuralları (hedef):**

- Web: iyzico Checkout Form (ileride)
- Android: Google Play Billing (ileride)
- iOS: Apple In-App Purchase (ileride)
- Başarılı doğrulanmış ödeme → anında premium (admin onayı gerekmez)
- Manuel Super Admin grant operasyonel fallback olarak kalır

---

## 2. Paylaşılan entitlement hedefi

**Koleksiyon:** `userEntitlements/{uid}`

Bireysel video premium tüm kaynaklar bu dokümana uyumlu alanlar yazar. Reklamsız (`adFree`) alanları video premium grant akışı tarafından **değiştirilmemelidir**.

### Video premium alanları (mevcut şema ile uyumlu)

| Alan | Açıklama |
|------|----------|
| `videoLessonsPremium` | `true` / `false` |
| `videoLessonsStartedAt` | `YYYY-MM-DD` |
| `videoLessonsExpiresAt` | `YYYY-MM-DD` |
| `videoLessonsSource` | Kaynak (aşağıda) |
| `videoLessonsDurationDays` | `180` |
| `videoLessonsUpdatedAt` | Sunucu zaman damgası |
| `videoLessonsUpdatedBy` | Admin uid veya `system` / `payment:{orderId}` |
| `videoLessonsPaymentAmount` | Opsiyonel; örn. `249` |
| `videoLessonsPaymentOrderId` | Opsiyonel audit |
| `videoLessonsNote` | Opsiyonel |

### İzin verilen `videoLessonsSource` değerleri

| Değer | Anlam |
|-------|-------|
| `super_admin_manual` | Mevcut Super Admin manuel grant |
| `web_iyzico` | Web iyzico Checkout Form |
| `google_play` | Android Google Play Billing |
| `apple_iap` | iOS Apple In-App Purchase |
| `manual_bank_transfer` | İleride manuel havale / banka |

**Not:** Reklamsız entitlement `source` alanını kullanır; video premium `videoLessonsSource` kullanır. Karıştırılmamalıdır.

---

## 3. `paymentOrders/{orderId}` şeması

Kök koleksiyon. `orderId` backend tarafından üretilir.

| Alan | Tip | Açıklama |
|------|-----|----------|
| `uid` | string | Satın alan kullanıcı |
| `email` | string | Sipariş anındaki e-posta snapshot |
| `displayName` | string | Opsiyonel görünen ad |
| `productType` | string | `video_lessons_180_days` |
| `productTitle` | string | `Video Öğretmen Dersleri Premium` |
| `amount` | number | `249` |
| `currency` | string | `TRY` |
| `durationDays` | number | `180` |
| `provider` | string | `iyzico` \| `google_play` \| `apple_iap` \| `manual` |
| `source` | string | `web` \| `android` \| `ios` \| `admin` |
| `status` | string | Lifecycle (aşağıda) |
| `providerConversationId` | string | iyzico conversation id |
| `providerToken` | string | Checkout token (kısa ömürlü) |
| `providerPaymentId` | string | Sağlayıcı ödeme kimliği; idempotency anahtarı |
| `providerProductId` | string | Play / App Store product id |
| `providerPurchaseToken` | string | Play purchase token |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |
| `paidAt` | timestamp | |
| `failedAt` | timestamp | |
| `cancelledAt` | timestamp | |
| `refundedAt` | timestamp | |
| `entitlementGrantedAt` | timestamp | Premium verildiyse |
| `entitlementUid` | string | Genelde `uid` ile aynı |
| `grantError` | string | Grant başarısızsa |
| `note` | string | Admin / sistem notu |
| `rawProviderStatusSafe` | map | Redakte edilmiş sağlayıcı özeti |

**Yazma:** Yalnızca Admin SDK (Cloud Functions). İstemci create/update/delete **yasak**.

---

## 4. `paymentEvents/{eventId}` şeması

Append-only backend audit log.

| Alan | Tip | Açıklama |
|------|-----|----------|
| `orderId` | string | İlgili `paymentOrders` id |
| `uid` | string | Kullanıcı |
| `provider` | string | `iyzico` vb. |
| `source` | string | `web` \| `android` \| `ios` \| `admin` |
| `eventType` | string | Örn. `checkout_created`, `callback_received`, `payment_verified`, `entitlement_granted`, `grant_skipped_duplicate` |
| `statusBefore` | string | Önceki order status |
| `statusAfter` | string | Sonraki order status |
| `createdAt` | timestamp | |
| `payloadSafe` | map | Redakte edilmiş event yükü |
| `processedBy` | string | Fonksiyon adı veya `system` |

**Okuma:** Yalnızca `super_admin`. **Yazma:** Yalnızca Admin SDK.

---

## 5. Status lifecycle

```
draft → pending_payment → paid
                       → failed
                       → cancelled
paid → refunded
```

| Status | Anlam |
|--------|-------|
| `draft` | Taslak; henüz ödeme başlamadı |
| `pending_payment` | Checkout / store ödeme bekleniyor |
| `paid` | Sağlayıcı ödemesi doğrulandı |
| `failed` | Ödeme başarısız |
| `cancelled` | Kullanıcı veya sistem iptal |
| `refunded` | İade (ileride) |

### Güvenlik ve idempotency kuralları

1. **İstemci asla** siparişi `paid` olarak işaretleyemez.
2. **İstemci asla** entitlement grant edemez (`userEntitlements` client yazımı zaten kapalı).
3. Yalnızca **doğrulanmış backend** ödeme akışı premium verebilir.
4. Başarılı online ödeme **idempotent** olmalıdır.
5. Tekrarlayan callback'ler premium'u **iki kez vermemelidir** (`providerPaymentId` + `entitlementGrantedAt` kontrolü).
6. `paymentEvents` yalnızca backend tarafından append edilir; güncelleme/silme yok.

### Önerilen idempotency kontrol sırası (ileride functions_payments)

1. `paymentOrders/{orderId}` oku
2. `entitlementGrantedAt` doluysa → skip, event: `grant_skipped_duplicate`
3. `providerPaymentId` başka `paid` order'da varsa → skip veya hata
4. Transaction: entitlement merge + order `paid` + `entitlementGrantedAt` + event

---

## 6. Firestore rules özeti (Phase 4A-1)

| Koleksiyon | Kullanıcı okuma | Super Admin okuma | Client yazma |
|------------|-----------------|-------------------|--------------|
| `paymentOrders` | Kendi `uid` | Tümü | **Yasak** |
| `paymentEvents` | Yasak | Tümü | **Yasak** |
| `userEntitlements` | Kendi uid | Tümü | **Yasak** (değişmedi) |

Tenant izolasyonu ve kurum `studentPayments` kuralları bu doküman kapsamında değiştirilmez.

---

## 7. Firestore indeksleri

| Koleksiyon | Alanlar | Kullanım |
|------------|---------|----------|
| `paymentOrders` | `uid` ASC, `createdAt` DESC | Kullanıcı sipariş geçmişi |
| `paymentOrders` | `status` ASC, `createdAt` DESC | Admin liste / operasyon |

---

## 8. Gelecek fazlar

| Faz | İçerik |
|-----|--------|
| **4A-1** (bu patch) | Dokümantasyon + rules + indeksler |
| **4A-2** | `functions_payments` iskelet / stub export'lar |
| **4B** | iyzico test entegrasyonu |
| **4C** | Web CTA checkout akışı |
| **4D** | Doğrulanmış iyzico ödemesi sonrası otomatik entitlement grant |
| **5** | Google Play Billing |
| **6** | Apple In-App Purchase |

**Admin panel:** İleride salt okunur "Bireysel Satın Almalar" listesi; başarılı online ödeme için admin onayı **gerekmez**.

---

## 9. Bilinçli olarak bu fazda yapılmayanlar

- iyzico / Google Play / Apple SDK entegrasyonu
- Cloud Functions deploy
- Web / mobil CTA ödeme akışı
- Otomatik entitlement grant
- `userEntitlements` runtime okuma/yazma davranışı değişikliği
- Mevcut manuel admin grant/revoke callable değişikliği
