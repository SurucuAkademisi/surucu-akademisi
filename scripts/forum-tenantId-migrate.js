#!/usr/bin/env node
/**
 * forum_posts tenantId migration
 * Sets tenantId: null on any post that lacks the field (for Türkiye Geneli Forum split).
 *
 * Usage: node forum-tenantId-migrate.js [--dry-run]
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or Firebase config in scripts/firestore-migration/
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'firestore-migration', '.env') });
const admin = require(path.join(__dirname, 'firestore-migration', 'node_modules', 'firebase-admin'));
const PROJECT_ID = process.env.PROJECT_ID || 'surucuakademisi-f5e1f';

let db = null;

function getFirestore() {
  if (db) return db;
  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: PROJECT_ID });
    }
    db = admin.firestore();
    return db;
  } catch (err) {
    console.error('Firestore init error:', err.message);
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('*** DRY RUN — no writes ***\n');

  const database = getFirestore();
  if (!database) process.exit(1);

  const snap = await database.collection('forum_posts').get();
  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!('tenantId' in data)) {
      if (dryRun) {
        console.log('Would set tenantId: null on', doc.id);
        updated++;
      } else {
        await doc.ref.update({ tenantId: null });
        console.log('Updated', doc.id);
        updated++;
      }
    }
  }
  console.log('Done. Updated', updated, 'posts.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
