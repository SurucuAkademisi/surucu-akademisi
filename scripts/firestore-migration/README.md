# Firestore V1 Migration — Faz 1 Araçları

> Sürücü Akademisi çok kiracılı Firestore mimarisine geçiş için migration ve denetim araçları.

## Ön Koşullar

- Node.js 18+
- Firebase projesi: `surucuakademisi-f5e1f`
- Service Account anahtarı (Firebase Console → Project Settings → Service Accounts)
- [ ] TODO: gcloud CLI veya Firebase Admin SDK ile export kurulumu

## Kurulum

```bash
cd scripts/firestore-migration
npm install
cp .env.example .env
# .env içinde GOOGLE_APPLICATION_CREDENTIALS ve PROJECT_ID ayarla
```

## Kullanım

### Koleksiyon Denetimi (Audit)

```bash
node audit.js
# Çıktı: reports/audit-YYYY-MM-DD.json ve COLLECTIONS_AUDIT_*.md template
```

### Migration (Dry Run — Henüz Yazma Yok)

```bash
node migrate.js --dry-run
node migrate.js --dry-run --step=M1
```

### Migration (Gerçek — Faz 2'de)

```bash
# node migrate.js --step=all
# node migrate.js --step=M1 --tenant=surucu_akademisi
```

## Adımlar

| Adım | Kaynak | Hedef |
|------|--------|-------|
| M1 | content/links | tenants/{tenantId}/content/links |
| M2 | users | tenants/{tenantId}/users + tenantMemberships |
| M3 | accessCodes | tenants/{tenantId}/accessCodes |
| M4 | tenantExams/.../exams | tenants/{tenantId}/exams |
| M5 | tenantExams/.../questions | tenants/{tenantId}/questions (examKey→examId) |

## Klasör Yapısı

```
scripts/firestore-migration/
├── README.md
├── package.json
├── .env.example
├── config.js
├── audit.js
├── migrate.js
├── lib/
│   ├── firestore.js
│   └── migration-steps.js
└── reports/
```

## Yedekleme

Firestore export'ları `firestore-backups/` klasörüne kaydedilir (repo kökü).
Bu klasör .gitignore'da — hassas veri içerir.

## Notlar

- [ ] TODO: Faz 1 tamamlandığında migration script'i yaz
- [ ] TODO: Audit sonuçları COLLECTIONS_AUDIT markdown'a aktarılacak
