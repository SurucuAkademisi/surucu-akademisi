# Firestore Koleksiyon Denetim Raporu

**Tarih:** `YYYY-MM-DD`  
**Proje:** `surucuakademisi-f5e1f`  
**Denetleyen:** _________________

---

## Özet

| Koleksiyon | Doc Sayısı | Durum | Not |
|------------|------------|-------|-----|
| users | | ☐ Tamamlandı | |
| accessCodes | | ☐ Tamamlandı | |
| content/links | | ☐ Var / ☐ Yok | |
| platformUsers | | ☐ Tamamlandı | |
| tenants | | ☐ Tamamlandı | |
| tenantMemberships | | ☐ Tamamlandı | |
| tenantExams/{tid}/exams | | ☐ Tamamlandı | |
| tenantExams/{tid}/questions | | ☐ Tamamlandı | |

---

## 1. users

- **Doc ID formatı:** `uid` (Firebase Auth uid)
- **Doc sayısı:** _____
- **Örnek alanlar:** `isActive`, `expiresAt`, `email`, ...
- **tenantId ilişkisi:** ☐ Var / ☐ Yok
- **Örnek doc (anonimleştirilmiş):**

```json
{
  "isActive": true,
  "expiresAt": "<Timestamp>",
  "...": "..."
}
```

---

## 2. accessCodes

- **Doc ID formatı:** `SA-XXXX-XXXX` (kod)
- **Doc sayısı:** _____
- **Örnek alanlar:** `active`, `expiresAt`, `maxDevices`, `devices`, `note`
- **tenantId ilişkisi:** ☐ Var / ☐ Yok
- **Örnek doc:**

```json
{
  "active": true,
  "expiresAt": "<Timestamp>",
  "maxDevices": 3,
  "devices": {},
  "note": ""
}
```

---

## 3. content/links

- **Path:** `content/links` (tek doküman)
- **Var mı:** ☐ Evet / ☐ Hayır
- **pdfLinks yapısı:** ☐ array / ☐ object / ☐ yok
- **videoLinks yapısı:** ☐ array / ☐ object / ☐ yok
- **Örnek yapı:**

```json
{
  "pdfLinks": [],
  "videoLinks": []
}
```

---

## 4. platformUsers

- **Doc ID formatı:** `uid`
- **Doc sayısı:** _____
- **Örnek alanlar:** `globalRole`, `email`, ...
- **Not:** _________________

---

## 5. tenants

- **Doc ID formatı:** `tenantId`
- **Doc sayısı:** _____
- **surucu_akademisi kaydı:** ☐ Var / ☐ Yok
- **Örnek alanlar:** `name`, `slug`, `status`

---

## 6. tenantMemberships

- **Doc ID formatı:** `membershipId`
- **Doc sayısı:** _____
- **student rolü:** ☐ Var / ☐ Yok
- **Örnek alanlar:** `uid`, `tenantId`, `role`, `status`

---

## 7. tenantExams

- **Tenant ID'ler:** _________________
- **exams doc sayısı:** _____
- **questions doc sayısı:** _____
- **examKey vs examId:** Sorularda `examKey` mi `examId` mi kullanılıyor? _________________
- **Örnek exam doc:**

```json
{
  "examId": "",
  "title": "",
  "groupKey": "",
  "status": ""
}
```

- **Örnek question doc:**

```json
{
  "questionId": "",
  "examKey": "",
  "examId": "",
  "order": 0,
  "prompt": "",
  "options": [],
  "correctOption": "",
  "status": ""
}
```

---

## 8. Migration Notları

- [ ] Eksik tenant kayıtları (varsa oluşturulacak)
- [ ] examKey → examId dönüşüm stratejisi
- [ ] Varsayılan tenantId: `surucu_akademisi`

---

## 9. Audit Script Çıktısı

`scripts/firestore-migration/audit.js` çalıştırıldıktan sonra `reports/audit-YYYY-MM-DD.json` dosyasındaki özet buraya yapıştırılabilir veya referans verilebilir.
