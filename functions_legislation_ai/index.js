/**
 * Mevzuat AI — isolated Gen2 codebase (legislation-ai).
 *
 * Exported temporarily as askLegislationAINew to avoid name collision with
 * default Gen1 askLegislationAI / askLegislationAIHttp / askLegislationAIV2.
 * After removing legacy exports, rename export to askLegislationAI.
 */

const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const OpenAI = require('openai');
const { retrieveMevzuatSources, extractKeywords, filterSourcesForDisplay } = require('./retrieval');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const openaiApiKey = defineSecret('OPENAI_API_KEY');

/** @type {string} Configurable OpenAI model id */
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

/** Minimum retrieval score before calling OpenAI (aligned with legacy heuristic). */
const MIN_SCORE_THRESHOLD = 10;

const INSUFFICIENT_ANSWER =
  'Bu konuda yayımlanmış mevzuat içinde yeterli kaynak bulunamadı.';

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function isAllowedLegislationAiRole(role) {
  return role === 'super_admin' || role === 'institution_admin';
}

async function getUserRoleByUid(uid) {
  if (!uid) return '';
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return '';
  return normalizeRole((snap.data() || {}).role);
}

function mapConfidence(topScore) {
  const s = Number(topScore) || 0;
  if (s >= 30) return 'high';
  if (s >= 20) return 'medium';
  return 'low';
}

function buildInsufficientPayload() {
  return {
    ok: true,
    insufficientSource: true,
    answer: INSUFFICIENT_ANSWER,
    sources: [],
    sourceCount: 0,
    confidence: 'low',
    matchedLegislation: null,
    relatedItems: [],
    cta: null,
  };
}

function buildSourcesContextBlock(sources) {
  return (sources || [])
    .map((src, idx) => {
      const title = src.title || '(Başlıksız)';
      const excerpt = src.excerpt || '';
      return (
        `[Kaynak ${idx + 1}] id=${src.id}\n` +
        `Başlık: ${title}\n` +
        `Pasaj:\n${excerpt}`
      );
    })
    .join('\n\n---\n\n');
}

function buildOpenAIMessages(question, sources) {
  const systemPrompt =
    'Sen Sürücü Akademisi Mevzuat Asistanısın. Yalnızca sana verilen yayımlanmış mevzuat pasajlarına dayanarak cevap ver.\n' +
    'Genel bilgi veya tahmin kullanma. Pasajlarda yeterli bilgi yoksa tam olarak şunu yaz: ' +
    `"${INSUFFICIENT_ANSWER}"\n` +
    'Madde numarası veya kanun maddesi uydurma; metinde geçmiyorsa madde numarası yazma.\n' +
    'Cevabında hangi mevzuat başlıklarına dayandığını belirt.\n' +
    'Sade, anlaşılır Türkçe kullan; kısa ve yardımcı bir hukuki açıklama tarzında yaz.\n' +
    'Bu bir genel hukuki danışmanlık değildir; yalnızca sistemdeki mevzuat metinlerini özetlersin.';

  const userPrompt =
    `Kullanıcı sorusu:\n${question}\n\n` +
    `Aşağıdaki yayımlanmış mevzuat pasajları dışında kaynak kullanma:\n\n${buildSourcesContextBlock(sources)}`;

  return { systemPrompt, userPrompt };
}

async function generateAnswerWithOpenAI(apiKey, question, sources) {
  const client = new OpenAI({ apiKey });
  const { systemPrompt, userPrompt } = buildOpenAIMessages(question, sources);

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    instructions: systemPrompt,
    input: userPrompt,
    temperature: 0.2,
    max_output_tokens: 1200,
  });

  const text =
    (response && typeof response.output_text === 'string' && response.output_text.trim()) ||
    '';

  if (!text) {
    throw new Error('OpenAI returned empty output.');
  }

  return text.trim();
}

function buildSuccessPayload(sources, answer) {
  const list = Array.isArray(sources) ? sources : [];
  const first = list[0] || null;
  const sourceCount = list.length;
  const topScore = first ? first.score : 0;

  const matchedLegislation = first
    ? {
        id: first.id,
        title: first.title,
        excerpt: first.excerpt || '',
      }
    : null;

  const relatedItems = list.slice(1).map((s) => ({
    id: s.id,
    title: s.title,
    excerpt: s.excerpt || '',
    score: s.score,
  }));

  const cta = first
    ? { type: 'open_legislation', targetId: first.id }
    : null;

  return {
    ok: true,
    insufficientSource: false,
    answer,
    sources: list.map((s) => ({
      id: s.id,
      title: s.title,
      score: s.score,
      excerpt: s.excerpt || '',
    })),
    sourceCount,
    confidence: mapConfidence(topScore),
    matchedLegislation,
    relatedItems,
    cta,
  };
}

/**
 * Core handler — rename export to askLegislationAI after legacy removal.
 */
async function handleAskLegislationAI(request) {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const questionRaw = data && typeof data.question === 'string' ? data.question : '';
  const question = questionRaw.trim();

  if (!question) {
    throw new HttpsError('invalid-argument', 'question must be a non-empty string.');
  }
  if (question.length > 1000) {
    throw new HttpsError('invalid-argument', 'question must be 1000 characters or less.');
  }

  const role = await getUserRoleByUid(callerUid);
  if (!isAllowedLegislationAiRole(role)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions for legislation assistant.');
  }

  const keywords = extractKeywords(question);
  if (!keywords.length) {
    console.log('[askLegislationAINew] no keywords uid=', callerUid, 'len=', question.length);
    return buildInsufficientPayload();
  }

  const snap = await db.collection('mevzuat').where('published', '==', true).get();
  const docItems = (snap.docs || []).map((d) => ({ id: d.id, data: d.data() || {} }));

  const rankedSources = retrieveMevzuatSources(question, docItems, {
    maxSources: 5,
    maxExcerptChars: 700,
  });

  const filterResult = filterSourcesForDisplay(rankedSources, question);
  const filteredSources = filterResult.sources || [];
  const initialSourceCount = rankedSources.length;
  const filteredSourceCount = filteredSources.length;
  const topScore = filteredSources.length ? filteredSources[0].score : 0;
  const secondScore = filteredSources.length > 1 ? filteredSources[1].score : 0;

  console.log(
    '[askLegislationAINew] uid=',
    callerUid,
    'role=',
    role,
    'qLen=',
    question.length,
    'keywords=',
    keywords.length,
    'initialSources=',
    initialSourceCount,
    'filteredSources=',
    filteredSourceCount,
    'topScore=',
    topScore,
    'secondScore=',
    secondScore,
    'singleSourceReason=',
    filterResult.singleSourceReason || 'none'
  );

  if (!filteredSources.length || topScore < MIN_SCORE_THRESHOLD) {
    return buildInsufficientPayload();
  }

  let apiKey;
  try {
    apiKey = openaiApiKey.value();
  } catch (e) {
    console.error('[askLegislationAINew] secret unavailable:', e && e.message ? e.message : e);
    throw new HttpsError('failed-precondition', 'OpenAI API key is not configured.');
  }

  if (!apiKey || !String(apiKey).trim()) {
    throw new HttpsError('failed-precondition', 'OpenAI API key is not configured.');
  }

  let answer;
  try {
    answer = await generateAnswerWithOpenAI(apiKey, question, filteredSources);
  } catch (e) {
    console.error('[askLegislationAINew] OpenAI error:', e && e.message ? e.message : e);
    throw new HttpsError('internal', 'Legislation assistant failed to generate an answer.');
  }

  const normalizedAnswer = String(answer || '').trim();
  if (
    normalizedAnswer.includes(INSUFFICIENT_ANSWER) ||
    normalizedAnswer.toLowerCase().includes('yeterli kaynak bulunamadi')
  ) {
    return buildInsufficientPayload();
  }

  return buildSuccessPayload(filteredSources, normalizedAnswer);
}

exports.askLegislationAINew = onCall(
  {
    region: 'us-central1',
    secrets: [openaiApiKey],
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  handleAskLegislationAI
);
