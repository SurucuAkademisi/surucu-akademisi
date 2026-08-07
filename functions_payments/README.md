# functions_payments

Bireysel **Video Öğretmen Dersleri Premium** (249 TRY / 180 gün) için ödeme altyapısı iskeleti.

## Durum (Phase 4A-2)

- Bu codebase yalnızca **skeleton / stub** fonksiyonları içerir.
- **iyzico**, **Google Play Billing** ve **Apple IAP** entegrasyonu **aktif değildir**.
- Stub fonksiyonlar premium **vermez**, ödeme sağlayıcısı **çağırmaz**, sipariş **oluşturmaz**.
- `grantVideoLessonsPremiumFromPayment` internal helper olarak `lib/` altında hazırdır; istemciye export edilmez.

## Export edilen stub fonksiyonlar

| Fonksiyon | Tip | Davranış |
|-----------|-----|----------|
| `createWebIyzicoCheckoutSession` | Callable | Auth zorunlu → `PAYMENT_NOT_ACTIVE` |
| `handleIyzicoCallback` | HTTPS | 200 + altyapı aktif değil |
| `verifyGooglePlayPurchaseAndGrantEntitlement` | Callable | Auth zorunlu → `PAYMENT_NOT_ACTIVE` |
| `verifyApplePurchaseAndGrantEntitlement` | Callable | Auth zorunlu → `PAYMENT_NOT_ACTIVE` |

## Kurulum

```bash
cd functions_payments
npm install
```

## Deploy (yalnızca bu codebase)

**Tüm functions deploy edilmemelidir** — projede `functions_ms` ve diğer codebase'lerde bilinen riskler olabilir.

```bash
firebase deploy --only functions:payments
```

## İlgili dokümantasyon

- [`docs/PAYMENT_INFRA.md`](../docs/PAYMENT_INFRA.md) — şema, rules, faz planı

## Gelecek fazlar

- **4B:** iyzico test entegrasyonu
- **4C:** Web CTA checkout
- **4D:** Doğrulanmış ödeme sonrası otomatik grant
- **5 / 6:** Google Play / Apple IAP
