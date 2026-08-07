#!/usr/bin/env node
/**
 * Migration ana giriş noktası
 * --dry-run: Sadece log, yazma yok
 * --step=M0|M1|M2|M3|M4|M5|all: Hangi adım çalışacak
 * --tenant=surucu_akademisi: Hedef tenant ID
 *
 * Örnek: node migrate.js --dry-run --step=M0
 */

const { getFirestore } = require('./lib/firestore.js');
const { DEFAULT_TENANT_ID, STEPS } = require('./config.js');
const {
  runM0,
  runM1,
  runM2,
  runM3,
  runM4,
  runM5,
  runAll,
} = require('./lib/migration-steps.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    step: STEPS.ALL,
    tenant: DEFAULT_TENANT_ID,
  };
  for (const arg of args) {
    if (arg === '--dry-run') opts.dryRun = true;
    if (arg.startsWith('--step=')) opts.step = arg.slice(7);
    if (arg.startsWith('--tenant=')) opts.tenant = arg.slice(9);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log('Migration options:', opts);
  if (opts.dryRun) {
    console.log('*** DRY RUN — Hiçbir yazma yapılmayacak ***\n');
  }

  const db = getFirestore();
  if (!db) {
    console.error('Firestore bağlantısı kurulamadı.');
    process.exit(1);
  }

  const options = { dryRun: opts.dryRun };

  try {
    if (opts.step === STEPS.ALL) {
      await runAll(db, opts.tenant, options);
      console.log('\nTüm adımlar tamamlandı (dry-run modunda)');
    } else {
      const stepMap = {
        [STEPS.M0]: runM0,
        [STEPS.M1]: runM1,
        [STEPS.M2]: runM2,
        [STEPS.M3]: runM3,
        [STEPS.M4]: runM4,
        [STEPS.M5]: runM5,
      };
      const fn = stepMap[opts.step];
      if (!fn) {
        console.error('Geçersiz adım:', opts.step);
        process.exit(1);
      }
      await fn(db, opts.tenant, options);
      console.log('\nAdım %s tamamlandı', opts.step);
    }
  } catch (err) {
    console.error('Migration hatası:', err.message);
    process.exit(1);
  }
}

main();
