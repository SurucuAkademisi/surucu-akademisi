/**
 * Migration yapılandırması
 * Faz 1 — Sadece config, runtime değişiklik yok
 */

require('dotenv').config();

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'surucu_akademisi';
const PROJECT_ID = process.env.PROJECT_ID || 'surucuakademisi-f5e1f';

// Migration adım sabitleri
const STEPS = {
  M0: 'M0', // tenantMemberships oluştur (platformUsers + users)
  M1: 'M1', // content/links → tenants/{tid}/content/links
  M2: 'M2', // users → tenants/{tid}/users + tenantMemberships
  M3: 'M3', // accessCodes → tenants/{tid}/accessCodes
  M4: 'M4', // tenantExams/.../exams → tenants/{tid}/exams
  M5: 'M5', // tenantExams/.../questions → tenants/{tid}/questions
  ALL: 'all',
};

// Denetlenecek / taşınacak koleksiyonlar
const COLLECTIONS = {
  users: 'users',
  accessCodes: 'accessCodes',
  content: 'content',
  platformUsers: 'platformUsers',
  tenants: 'tenants',
  tenantMemberships: 'tenantMemberships',
  tenantExams: 'tenantExams',
};

// Batch boyutu (Firestore write limitleri)
const BATCH_SIZE = 500;

module.exports = {
  DEFAULT_TENANT_ID,
  PROJECT_ID,
  STEPS,
  COLLECTIONS,
  BATCH_SIZE,
};
