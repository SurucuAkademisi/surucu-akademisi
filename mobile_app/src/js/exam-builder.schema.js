import {
  QUESTION_TYPES,
  QUESTION_STATUSES,
  QUESTION_MEDIA_TYPES,
  QUESTION_TYPE_VALUES,
  QUESTION_STATUS_VALUES,
  QUESTION_MEDIA_VALUES,
  EXAM_STATUSES,
  EXAM_STATUS_VALUES,
} from './exam-domain.constants.js';

// Exam builder schema foundation.
// Safe non-breaking module: exported only, not wired to runtime yet.

export const QUESTION_SCHEMA = Object.freeze({
  prompt: '',
  questionType: QUESTION_TYPES.TEXT,
  mediaType: QUESTION_MEDIA_TYPES.NONE,
  mediaUrl: null,
  questionImage: null,
  questionVideoUrl: null,
  options: [],
  correctOption: null,
  explanation: '',
  difficulty: null,
  tags: [],
  status: QUESTION_STATUSES.DRAFT,
});

export const MEDIA_SCHEMA = Object.freeze({
  type: QUESTION_MEDIA_TYPES.NONE,
  url: null,
  thumbnail: null,
  duration: null,
});

export const EXAM_SCHEMA = Object.freeze({
  examId: null,
  tenantId: null,
  title: '',
  description: '',
  category: null,
  timeLimit: null,
  totalQuestions: 0,
  status: EXAM_STATUSES.DRAFT,
});

function toStringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringOrNull(value) {
  const normalized = toStringOrEmpty(value);
  return normalized || null;
}

function toNormalizedValue(value) {
  return toStringOrEmpty(value).toLowerCase();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isValidStatus(value, statusValues) {
  return statusValues.includes(toNormalizedValue(value));
}

export function validateQuestionSchema(input) {
  const source = (input && typeof input === 'object') ? input : {};
  const errors = [];

  const prompt = toStringOrEmpty(source.prompt);
  const questionType = toNormalizedValue(source.questionType || QUESTION_SCHEMA.questionType);
  const mediaType = toNormalizedValue(source.mediaType || QUESTION_SCHEMA.mediaType);
  const mediaUrl = toStringOrNull(source.mediaUrl);
  const options = toArray(source.options);
  const explanation = toStringOrEmpty(source.explanation);
  const difficulty = toStringOrNull(source.difficulty);
  const tags = toArray(source.tags)
    .map((item) => toStringOrEmpty(item))
    .filter((item) => item.length > 0);
  const status = toNormalizedValue(source.status || QUESTION_SCHEMA.status);

  if (!prompt) {
    errors.push('prompt is required.');
  }

  if (!QUESTION_TYPE_VALUES.includes(questionType)) {
    errors.push('questionType is invalid.');
  }

  if (!QUESTION_MEDIA_VALUES.includes(mediaType)) {
    errors.push('mediaType is invalid.');
  }

  const questionImage = toStringOrNull(source.questionImage);
  const questionVideoUrl = toStringOrNull(source.questionVideoUrl);
  if (mediaType === QUESTION_MEDIA_TYPES.IMAGE && !mediaUrl && !questionImage) {
    errors.push('mediaUrl or questionImage is required for image mediaType.');
  }
  if (mediaType === QUESTION_MEDIA_TYPES.VIDEO && !mediaUrl && !questionVideoUrl) {
    errors.push('mediaUrl or questionVideoUrl is required for video mediaType.');
  }

  if (!isValidStatus(status, QUESTION_STATUS_VALUES)) {
    errors.push('status is invalid.');
  }

  return {
    valid: errors.length === 0,
    errors,
    value: {
      ...QUESTION_SCHEMA,
      prompt,
      questionType: QUESTION_TYPE_VALUES.includes(questionType) ? questionType : QUESTION_SCHEMA.questionType,
      mediaType: QUESTION_MEDIA_VALUES.includes(mediaType) ? mediaType : QUESTION_SCHEMA.mediaType,
      mediaUrl,
      questionImage,
      questionVideoUrl,
      options,
      correctOption: source.correctOption ?? QUESTION_SCHEMA.correctOption,
      explanation,
      difficulty,
      tags,
      status: isValidStatus(status, QUESTION_STATUS_VALUES) ? status : QUESTION_SCHEMA.status,
    },
  };
}

export function validateExamSchema(input) {
  const source = (input && typeof input === 'object') ? input : {};
  const errors = [];

  const examId = toStringOrNull(source.examId);
  const tenantId = toStringOrNull(source.tenantId);
  const title = toStringOrEmpty(source.title);
  const description = toStringOrEmpty(source.description);
  const category = toStringOrNull(source.category);
  const timeLimit = source.timeLimit == null ? null : Number(source.timeLimit);
  const totalQuestions = Number.isFinite(Number(source.totalQuestions))
    ? Math.max(0, Number(source.totalQuestions))
    : EXAM_SCHEMA.totalQuestions;
  const status = toNormalizedValue(source.status || EXAM_SCHEMA.status);

  if (!title) {
    errors.push('title is required.');
  }

  if (timeLimit != null && (!Number.isFinite(timeLimit) || timeLimit <= 0)) {
    errors.push('timeLimit must be a positive number when provided.');
  }

  if (!isValidStatus(status, EXAM_STATUS_VALUES)) {
    errors.push('status is invalid.');
  }

  return {
    valid: errors.length === 0,
    errors,
    value: {
      ...EXAM_SCHEMA,
      examId,
      tenantId,
      title,
      description,
      category,
      timeLimit,
      totalQuestions,
      status: isValidStatus(status, EXAM_STATUS_VALUES) ? status : EXAM_SCHEMA.status,
    },
  };
}