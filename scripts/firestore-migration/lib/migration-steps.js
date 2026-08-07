/**
 * Migration adım mantığı
 * M0: tenantMemberships — uygulandı
 * M1–M5: placeholder / Faz 2'de implement edilecek
 */

const { COLLECTIONS } = require('../config.js');
const { admin } = require('./firestore.js');

/**
 * tenants/{tenantId} dokümanının varlığını kontrol eder. Yoksa oluşturur.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} tenantId
 * @param {boolean} dryRun
 * @returns {{ exists: boolean, created: boolean }}
 */
async function ensureTenantExists(db, tenantId, dryRun = false) {
  const ref = db.collection(COLLECTIONS.tenants).doc(tenantId);
  const snap = await ref.get();
  if (snap.exists) {
    return { exists: true, created: false };
  }
  if (dryRun) {
    console.log('[M0] DRY RUN: tenants/%s oluşturulacak (şu an yok)', tenantId);
    return { exists: false, created: false };
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set({
    tenantId,
    name: tenantId,
    slug: tenantId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  console.log('[M0] tenants/%s oluşturuldu', tenantId);
  return { exists: false, created: true };
}

/**
 * M0: tenantMemberships oluştur
 * platformUsers -> institution_admin, users -> student
 * membershipId = {uid}_{tenantId}, idempotent
 */
async function runM0(db, tenantId, options = {}) {
  const dryRun = !!options.dryRun;
  const membershipsCol = db.collection(COLLECTIONS.tenantMemberships);

  let created = 0;
  let skipped = 0;
  const errors = [];

  if (dryRun) {
    console.log('[M0] DRY RUN: tenantMemberships oluşturma (tenantId=%s)', tenantId);
  }

  // 1. Tenant varlığını sağla
  const tenantResult = await ensureTenantExists(db, tenantId, dryRun);

  // 2. platformUsers oku -> institution_admin membership planla
  const platformUsersSnap = await db.collection(COLLECTIONS.platformUsers).get();
  const plannedUids = new Set();
  const toWrite = [];

  platformUsersSnap.docs.forEach((doc) => {
    const uid = doc.id;
    if (!uid || typeof uid !== 'string') return;
    const membershipId = `${uid}_${tenantId}`;
    plannedUids.add(uid);
    toWrite.push({
      membershipId,
      uid,
      tenantId,
      role: 'institution_admin',
      status: 'active',
    });
  });

  // 3. users oku -> student membership (uid zaten plannedUids'de ise atla)
  const usersSnap = await db.collection(COLLECTIONS.users).get();
  usersSnap.docs.forEach((doc) => {
    const uid = doc.id;
    if (!uid || typeof uid !== 'string') return;
    if (plannedUids.has(uid)) return; // platformUsers'dan geliyor, atla
    const membershipId = `${uid}_${tenantId}`;
    toWrite.push({
      membershipId,
      uid,
      tenantId,
      role: 'student',
      status: 'active',
    });
  });

  if (dryRun) {
    console.log('[M0] DRY RUN: %d platformUser -> institution_admin', platformUsersSnap.size);
    console.log('[M0] DRY RUN: %d user -> student (çakışan uid atlandı)', toWrite.length - platformUsersSnap.size);
    toWrite.forEach((m) => {
      console.log('[M0] DRY RUN: tenantMemberships/%s yazılacak: role=%s', m.membershipId, m.role);
    });
    return {
      ok: true,
      dryRun: true,
      tenantExists: tenantResult.exists,
      tenantCreated: tenantResult.created,
      platformUsersProcessed: platformUsersSnap.size,
      usersProcessed: usersSnap.size,
      created: 0,
      skipped: 0,
      errors: [],
    };
  }

  // 4. Idempotent yazma (merge)
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const m of toWrite) {
    try {
      const ref = membershipsCol.doc(m.membershipId);
      const existing = await ref.get();
      const payload = {
        membershipId: m.membershipId,
        uid: m.uid,
        tenantId: m.tenantId,
        role: m.role,
        status: m.status,
        updatedAt: now,
      };
      if (!existing.exists) {
        payload.createdAt = now;
      }
      await ref.set(payload, { merge: true });
      if (existing.exists) {
        skipped++;
      } else {
        created++;
      }
    } catch (err) {
      errors.push(`${m.membershipId}: ${err.message}`);
    }
  }

  console.log('[M0] Tamamlandı: created=%d, skipped=%d, errors=%d', created, skipped, errors.length);
  if (errors.length) {
    errors.forEach((e) => console.error('[M0] Hata:', e));
  }

  return {
    ok: errors.length === 0,
    tenantExists: tenantResult.exists,
    tenantCreated: tenantResult.created,
    platformUsersProcessed: platformUsersSnap.size,
    usersProcessed: usersSnap.size,
    created,
    skipped,
    errors,
  };
}

/**
 * M1: content/links → tenants/{tenantId}/content/links
 * TODO: Implement — tek doküman taşıma
 */
async function runM1(db, tenantId, options = {}) {
  if (options.dryRun) {
    console.log('[M1] DRY RUN: content/links → tenants/%s/content/links', tenantId);
    return { ok: true, dryRun: true };
  }
  // TODO: Gerçek taşıma
  throw new Error('M1 not implemented yet');
}

/**
 * M2: users → tenants/{tenantId}/users + tenantMemberships
 * TODO: Implement — her user için subcollection + membership
 */
async function runM2(db, tenantId, options = {}) {
  if (options.dryRun) {
    console.log('[M2] DRY RUN: users → tenants/%s/users + tenantMemberships', tenantId);
    return { ok: true, dryRun: true };
  }
  throw new Error('M2 not implemented yet');
}

/**
 * M3: accessCodes → tenants/{tenantId}/accessCodes
 * TODO: Implement
 */
async function runM3(db, tenantId, options = {}) {
  if (options.dryRun) {
    console.log('[M3] DRY RUN: accessCodes → tenants/%s/accessCodes', tenantId);
    return { ok: true, dryRun: true };
  }
  throw new Error('M3 not implemented yet');
}

/**
 * M4: tenantExams/{tid}/exams → tenants/{tid}/exams
 * TODO: Implement — path değişikliği (tenantExams → tenants)
 */
async function runM4(db, tenantId, options = {}) {
  if (options.dryRun) {
    console.log('[M4] DRY RUN: tenantExams/%s/exams → tenants/%s/exams', tenantId, tenantId);
    return { ok: true, dryRun: true };
  }
  throw new Error('M4 not implemented yet');
}

/**
 * M5: tenantExams/{tid}/questions → tenants/{tid}/questions (examKey→examId)
 * TODO: Implement — examKey alanını examId'ye dönüştür
 */
async function runM5(db, tenantId, options = {}) {
  if (options.dryRun) {
    console.log('[M5] DRY RUN: tenantExams/%s/questions → tenants/%s/questions', tenantId, tenantId);
    return { ok: true, dryRun: true };
  }
  throw new Error('M5 not implemented yet');
}

/**
 * Tüm adımları sırayla çalıştır (M0 önce, sonra M1–M5)
 */
async function runAll(db, tenantId, options = {}) {
  const steps = [runM0, runM1, runM2, runM3, runM4, runM5];
  const results = [];
  for (const step of steps) {
    const r = await step(db, tenantId, options);
    results.push(r);
  }
  return results;
}

module.exports = {
  ensureTenantExists,
  runM0,
  runM1,
  runM2,
  runM3,
  runM4,
  runM5,
  runAll,
};
