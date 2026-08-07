#!/usr/bin/env node
/**
 * Koleksiyon denetim script'i
 * Mevcut Firestore koleksiyonlarının schema ve doc sayılarını raporlar
 */

const { getFirestore } = require('./lib/firestore.js');
const { COLLECTIONS } = require('./config.js');
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, 'reports');
const DATE_STR = new Date().toISOString().slice(0, 10);

async function countDocs(collectionRef) {
  try {
    // firebase-admin 11+ count aggregation
    const snap = await collectionRef.count().get();
    return snap.data().count;
  } catch {
    // Fallback: tüm dokümanları çek (küçük koleksiyonlar için)
    const snap = await collectionRef.get();
    return snap.size;
  }
}

async function getSampleDoc(collectionRef, docId = null) {
  let ref = collectionRef;
  if (docId) {
    ref = collectionRef.doc(docId);
    const doc = await ref.get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }
  const snap = await ref.limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function auditCollection(db, name) {
  const col = db.collection(name);
  const count = await countDocs(col);
  const sample = await getSampleDoc(col);
  return { name, count, sample };
}

async function auditContentLinks(db) {
  const doc = await db.collection('content').doc('links').get();
  return {
    name: 'content/links',
    exists: doc.exists,
    sample: doc.exists ? doc.data() : null,
  };
}

async function auditTenantExams(db, tenantId) {
  const examsRef = db.collection('tenantExams').doc(tenantId).collection('exams');
  const questionsRef = db.collection('tenantExams').doc(tenantId).collection('questions');
  const examsCount = await countDocs(examsRef);
  const questionsCount = await countDocs(questionsRef);
  const examSample = await getSampleDoc(examsRef);
  const questionSample = await getSampleDoc(questionsRef);
  return {
    tenantId,
    exams: { count: examsCount, sample: examSample },
    questions: { count: questionsCount, sample: questionSample },
  };
}

async function main() {
  console.log('Firestore koleksiyon denetimi başlıyor...\n');

  const db = getFirestore();
  if (!db) {
    console.error('Firestore bağlantısı kurulamadı. GOOGLE_APPLICATION_CREDENTIALS kontrol edin.');
    process.exit(1);
  }

  const report = {
    date: new Date().toISOString(),
    projectId: db.projectId || 'surucuakademisi-f5e1f',
    collections: {},
  };

  // Root koleksiyonlar
  const rootCols = [
    COLLECTIONS.users,
    COLLECTIONS.accessCodes,
    COLLECTIONS.platformUsers,
    COLLECTIONS.tenants,
    COLLECTIONS.tenantMemberships,
  ];

  for (const name of rootCols) {
    try {
      report.collections[name] = await auditCollection(db, name);
      console.log('%s: %d doc', name, report.collections[name].count);
    } catch (err) {
      report.collections[name] = { error: err.message };
      console.log('%s: HATA - %s', name, err.message);
    }
  }

  // content/links
  try {
    report.collections.contentLinks = await auditContentLinks(db);
    console.log('content/links: %s', report.collections.contentLinks.exists ? 'var' : 'yok');
  } catch (err) {
    report.collections.contentLinks = { error: err.message };
    console.log('content/links: HATA - %s', err.message);
  }

  // tenantExams (varsayılan tenant)
  try {
    report.collections.tenantExams = await auditTenantExams(db, 'surucu_akademisi');
    console.log(
      'tenantExams/surucu_akademisi: exams=%d, questions=%d',
      report.collections.tenantExams.exams.count,
      report.collections.tenantExams.questions.count
    );
  } catch (err) {
    report.collections.tenantExams = { error: err.message };
    console.log('tenantExams: HATA - %s', err.message);
  }

  // reports/ klasörüne JSON kaydet
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
  const reportPath = path.join(REPORTS_DIR, `audit-${DATE_STR}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\nRapor kaydedildi:', reportPath);

  // COLLECTIONS_AUDIT template yolunu hatırlat
  const templatePath = path.join(__dirname, '..', '..', 'docs', 'COLLECTIONS_AUDIT_TEMPLATE.md');
  console.log('COLLECTIONS_AUDIT için template:', templatePath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
