/**
 * Firebase Storage orphan cleanup for exam-media.
 *
 * SAFETY:
 * - NEVER deletes files outside exam-media/
 * - NEVER deletes files younger than GRACE_PERIOD_MS (48h)
 * - DRY_RUN=true by default: only logs, does not delete
 *
 * Firestore refs: questionImage, mediaUrl (if firebasestorage), options[].imageUrl
 */

const functions = require('firebase-functions');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const EXAM_MEDIA_PREFIX = 'exam-media/';
const FIREBASE_STORAGE_DOMAIN = 'firebasestorage.googleapis.com';
const GRACE_PERIOD_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Extract Storage path from Firebase Storage download URL.
 * Example: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/exam-media%2Ftenant%2Fexam%2Fq%2Ffile?alt=media&token=...
 * Returns: exam-media/tenant/exam/q/file  or null if not a valid exam-media URL
 */
function extractStoragePathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Skip non-Storage URLs (e.g. YouTube)
  if (!trimmed.includes(FIREBASE_STORAGE_DOMAIN)) return null;
  if (!trimmed.includes('/o/')) return null;

  try {
    const match = trimmed.match(/\/o\/([^?]+)/);
    if (!match || !match[1]) return null;
    const encoded = match[1];
    const path = decodeURIComponent(encoded.replace(/\+/g, ' '));
    // Only accept paths under exam-media/
    if (!path.startsWith(EXAM_MEDIA_PREFIX)) return null;
    return path;
  } catch (_) {
    return null;
  }
}

/**
 * Collect all referenced Storage paths from Firestore question docs.
 */
async function collectReferencedPaths(db) {
  const referencedPaths = new Set();

  const questionsSnap = await db.collectionGroup('questions').get();

  for (const doc of questionsSnap.docs) {
    const data = doc.data() || {};

    const fields = [
      data.questionImage,
      data.mediaUrl,
      ...(Array.isArray(data.options)
        ? data.options.map((o) => (o && typeof o === 'object' ? o.imageUrl : null))
        : []),
    ].filter(Boolean);

    for (const val of fields) {
      const str = typeof val === 'string' ? val : String(val || '');
      const path = extractStoragePathFromUrl(str);
      if (path) referencedPaths.add(path);
    }
  }

  return referencedPaths;
}

/**
 * Main cleanup logic.
 */
async function runCleanup() {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const dryRun =
    (functions.config().storage_cleanup && functions.config().storage_cleanup.dry_run) !== 'false';

  const stats = {
    totalFiles: 0,
    referencedCount: 0,
    orphanCandidates: 0,
    skippedTooNew: 0,
    deletedCount: 0,
  };

  // STEP 1 — Collect references
  const referencedPaths = await collectReferencedPaths(db);
  stats.referencedCount = referencedPaths.size;
  functions.logger.info('[storageCleanup] Referenced paths count:', stats.referencedCount);

  // STEP 2 — List Storage files under exam-media/
  const [files] = await bucket.getFiles({ prefix: EXAM_MEDIA_PREFIX });
  stats.totalFiles = files.length;
  functions.logger.info('[storageCleanup] Total exam-media files:', stats.totalFiles);

  const now = Date.now();

  for (const file of files) {
    const name = file.name;
    // Safety: never touch files outside exam-media/
    if (!name.startsWith(EXAM_MEDIA_PREFIX)) continue;

    // STEP 3 — Compare
    if (referencedPaths.has(name)) continue;

    stats.orphanCandidates++;

    // STEP 4 — Safety: grace period
    let timeCreated = null;
    try {
      const [meta] = await file.getMetadata();
      timeCreated = meta && meta.timeCreated ? new Date(meta.timeCreated).getTime() : null;
    } catch (_) {
      functions.logger.warn('[storageCleanup] Could not get metadata for', name, '- skipping');
      continue;
    }

    if (timeCreated != null && now - timeCreated < GRACE_PERIOD_MS) {
      stats.skippedTooNew++;
      functions.logger.info('[storageCleanup] SKIP (too new):', name);
      continue;
    }

    // STEP 5 — Dry run vs delete
    if (dryRun) {
      functions.logger.info('[storageCleanup] ORPHAN (dry run, would delete):', name);
    } else {
      try {
        await file.delete();
        stats.deletedCount++;
        functions.logger.info('[storageCleanup] DELETED:', name);
      } catch (e) {
        functions.logger.error('[storageCleanup] Delete failed:', name, e && e.message ? e.message : e);
      }
    }
  }

  functions.logger.info('[storageCleanup] Summary:', {
    totalFiles: stats.totalFiles,
    referencedCount: stats.referencedCount,
    orphanCandidates: stats.orphanCandidates,
    skippedTooNew: stats.skippedTooNew,
    deletedCount: stats.deletedCount,
    dryRun,
  });

  return stats;
}

exports.cleanupOrphanExamMedia = onSchedule('every 24 hours', async () => {
    try {
      await runCleanup();
      return null;
    } catch (e) {
      functions.logger.error('[storageCleanup] Fatal error:', e && e.message ? e.message : e);
      throw e;
    }
  });
