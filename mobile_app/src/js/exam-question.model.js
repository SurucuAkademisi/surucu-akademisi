import {
  QUESTION_TYPES,
  QUESTION_STATUSES,
  QUESTION_MEDIA_TYPES,
  QUESTION_TYPE_VALUES,
  QUESTION_STATUS_VALUES,
  QUESTION_MEDIA_VALUES,
} from './exam-domain.constants.js';

// Exam question domain model foundation.
// Safe non-breaking module: exported only, not wired to runtime yet.

function toNormalizedString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function toOptionalString(value) {
  const normalized = toNormalizedString(value);
  return normalized || null;
}

function toNonNegativeNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

/**
 * Normalize options for schemaVersion 1/2 compatibility.
 * - string[] => legacy, preserved as-is (trimmed)
 * - object[] => { key, text, imageUrl }[], normalized structure
 */
function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  if (value.length === 0) return [];
  const first = value[0];
  if (typeof first === 'string') {
    return value.map((item) => (typeof item === 'string' ? item.trim() : ''));
  }
  const keys = ['A', 'B', 'C', 'D'];
  return value.slice(0, 4).map((o, i) => {
    if (!o || typeof o !== 'object') return { key: keys[i], text: '', imageUrl: null };
    const k = (o.key && typeof o.key === 'string') ? o.key.trim().toUpperCase().charAt(0) || keys[i] : keys[i];
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    const imageUrl = (typeof o.imageUrl === 'string' && o.imageUrl.trim()) ? o.imageUrl.trim() : null;
    return { key: k, text, imageUrl };
  });
}

function toNormalizedValue(value) {
  return toNormalizedString(value).toLowerCase();
}

function toQuestionType(value) {
  const normalized = toNormalizedValue(value);
  return QUESTION_TYPE_VALUES.includes(normalized)
    ? normalized
    : QUESTION_TYPES.TEXT;
}

function toQuestionStatus(value) {
  const normalized = toNormalizedValue(value);
  return QUESTION_STATUS_VALUES.includes(normalized)
    ? normalized
    : QUESTION_STATUSES.DRAFT;
}

function toQuestionMediaType(value) {
  const normalized = toNormalizedValue(value);
  return QUESTION_MEDIA_VALUES.includes(normalized)
    ? normalized
    : QUESTION_MEDIA_TYPES.NONE;
}

export function createEmptyQuestion() {
  return {
    questionId: null,
    tenantId: null,
    examKey: null,
    order: 0,
    prompt: '',
    options: [],
    questionImage: null,
    questionVideoUrl: null,
    correctOption: null,
    explanation: '',
    questionType: QUESTION_TYPES.TEXT,
    mediaType: QUESTION_MEDIA_TYPES.NONE,
    mediaUrl: null,
    difficulty: null,
    tags: [],
    status: QUESTION_STATUSES.DRAFT,
    schemaVersion: 1,
    createdAt: null,
    updatedAt: null,
    createdBy: null,
    updatedBy: null,
  };
}

export function createQuestionFromPayload(payload) {
  const source = (payload && typeof payload === 'object') ? payload : {};
  const base = createEmptyQuestion();

  const opts = Array.isArray(source.options) ? normalizeOptions(source.options) : base.options;
  const hasNewFormat = opts.length > 0 && opts[0] && typeof opts[0] === 'object';
  const schemaVersion = source.schemaVersion === 2 || hasNewFormat || source.questionImage || source.questionVideoUrl ? 2 : 1;

  return {
    ...base,
    questionId: toOptionalString(source.questionId),
    tenantId: toOptionalString(source.tenantId),
    examKey: toOptionalString(source.examKey),
    order: toNonNegativeNumber(source.order, base.order),
    prompt: toNormalizedString(source.prompt),
    options: opts,
    questionImage: toOptionalString(source.questionImage),
    questionVideoUrl: toOptionalString(source.questionVideoUrl),
    correctOption: source.correctOption ?? base.correctOption,
    explanation: toNormalizedString(source.explanation),
    questionType: toQuestionType(source.questionType),
    mediaType: toQuestionMediaType(source.mediaType),
    mediaUrl: toOptionalString(source.mediaUrl),
    difficulty: toOptionalString(source.difficulty),
    tags: toStringArray(source.tags),
    status: toQuestionStatus(source.status),
    schemaVersion,
    createdAt: source.createdAt ?? base.createdAt,
    updatedAt: source.updatedAt ?? base.updatedAt,
    createdBy: toOptionalString(source.createdBy),
    updatedBy: toOptionalString(source.updatedBy),
  };
}