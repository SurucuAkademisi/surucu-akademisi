import {
  validateQuestionSchema,
  validateExamSchema,
} from './exam-builder.schema.js';
import {
  createQuestionFromPayload,
} from './exam-question.model.js';
import {
  EXAM_STATUSES,
  QUESTION_STATUSES,
} from './exam-domain.constants.js';

// Exam builder service foundation.
// Safe non-breaking module: exported only, not wired to runtime yet.

const examStore = new Map();
const questionStore = new Map();
const examQuestionOrderStore = new Map();

const EXAM_GROUP_TYPES = Object.freeze({
  MOCK_EXAM: 'mock_exam',
  LESSON_BASED: 'lesson_based',
});

const EXAM_GROUP_TYPE_VALUES = Object.freeze(Object.values(EXAM_GROUP_TYPES));

const LESSON_KEYS = Object.freeze({
  MOTOR: 'motor',
  TRAFFIC_RULES: 'traffic_rules',
  TRAFFIC_ETIQUETTE: 'traffic_etiquette',
  FIRST_AID: 'first_aid',
  ENVIRONMENT: 'environment',
});

const LESSON_KEY_VALUES = Object.freeze(Object.values(LESSON_KEYS));

function toStringOrNull(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function createId(prefix) {
  const seed = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${seed}`;
}

function toNormalizedValue(value) {
  const normalized = toStringOrNull(value);
  return normalized ? normalized.toLowerCase() : null;
}

function toNonNegativeNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

function toPositiveNumberOrNull(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function getFirestoreOrThrow() {
  const hasWindow = typeof window !== 'undefined';
  const firebaseRef = hasWindow ? window.firebase : null;
  const firestoreFactory = firebaseRef && typeof firebaseRef.firestore === 'function'
    ? firebaseRef.firestore
    : null;

  if (!firestoreFactory) {
    throw new Error('Firestore is not available in this runtime.');
  }

  return firebaseRef.firestore();
}

function getServerTimestampOrIso() {
  const hasWindow = typeof window !== 'undefined';
  const firebaseRef = hasWindow ? window.firebase : null;

  if (
    firebaseRef
    && firebaseRef.firestore
    && firebaseRef.firestore.FieldValue
    && typeof firebaseRef.firestore.FieldValue.serverTimestamp === 'function'
  ) {
    return firebaseRef.firestore.FieldValue.serverTimestamp();
  }

  return new Date().toISOString();
}

function normalizeExamMetadata(payload, fallback = {}) {
  const source = (payload && typeof payload === 'object') ? payload : {};
  const base = (fallback && typeof fallback === 'object') ? fallback : {};

  const groupTypeRaw = toNormalizedValue(source.groupType) || toNormalizedValue(base.groupType);
  const groupType = EXAM_GROUP_TYPE_VALUES.includes(groupTypeRaw)
    ? groupTypeRaw
    : EXAM_GROUP_TYPES.MOCK_EXAM;

  const lessonKeyRaw = toNormalizedValue(source.lessonKey) || toNormalizedValue(base.lessonKey);
  const lessonKey = LESSON_KEY_VALUES.includes(lessonKeyRaw) ? lessonKeyRaw : null;

  return {
    examId: toStringOrNull(source.examId) || toStringOrNull(base.examId) || null,
    tenantId: toStringOrNull(source.tenantId) || toStringOrNull(base.tenantId) || null,
    title: toStringOrNull(source.title) || toStringOrNull(base.title) || '',
    description: toStringOrNull(source.description) || toStringOrNull(base.description) || '',
    category: toStringOrNull(source.category) || toStringOrNull(base.category) || null,
    groupType,
    lessonKey: groupType === EXAM_GROUP_TYPES.LESSON_BASED ? lessonKey : null,
    totalQuestions: toNonNegativeNumber(
      source.totalQuestions != null ? source.totalQuestions : base.totalQuestions,
      0
    ),
    timeLimit: toPositiveNumberOrNull(source.timeLimit != null ? source.timeLimit : base.timeLimit),
    status: toNormalizedValue(source.status)
      || toNormalizedValue(base.status)
      || EXAM_STATUSES.DRAFT,
  };
}

function normalizeQuestionForSave(examId, examMetadata, questionPayload) {
  const validation = validateQuestionSchema(questionPayload);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors, value: null };
  }

  const normalizedQuestion = createQuestionFromPayload({
    ...validation.value,
    ...questionPayload,
    examKey: examId,
    tenantId: toStringOrNull(questionPayload?.tenantId) || examMetadata.tenantId || null,
    status: validation.value.status || QUESTION_STATUSES.DRAFT,
  });

  const questionId = toStringOrNull(normalizedQuestion.questionId) || createId('question');

  return {
    valid: true,
    errors: [],
    value: {
      ...normalizedQuestion,
      questionId,
      examKey: examId,
      tenantId: toStringOrNull(normalizedQuestion.tenantId) || examMetadata.tenantId || null,
    },
  };
}

function createResult(ok, data = null, errors = []) {
  return { ok, data, errors };
}

function getExamById(examId) {
  return examStore.get(examId) || null;
}

function getQuestionById(questionId) {
  return questionStore.get(questionId) || null;
}

function getExamQuestionIds(examId) {
  return [...(examQuestionOrderStore.get(examId) || [])];
}

function setExamQuestionIds(examId, questionIds) {
  examQuestionOrderStore.set(examId, [...questionIds]);
}

function reindexQuestions(examId) {
  const orderedIds = getExamQuestionIds(examId);

  orderedIds.forEach((id, index) => {
    const question = getQuestionById(id);
    if (!question) return;

    questionStore.set(id, {
      ...question,
      order: index + 1,
      updatedAt: new Date().toISOString(),
    });
  });
}

export function createExam(examPayload) {
  const validation = validateExamSchema(examPayload);
  if (!validation.valid) {
    return createResult(false, null, validation.errors);
  }

  const now = new Date().toISOString();
  const normalized = validation.value;
  const metadata = normalizeExamMetadata(examPayload, normalized);
  const examId = toStringOrNull(metadata.examId) || createId('exam');

  const exam = {
    ...normalized,
    ...metadata,
    examId,
    status: metadata.status || normalized.status || EXAM_STATUSES.DRAFT,
    createdAt: now,
    updatedAt: now,
  };

  examStore.set(examId, exam);
  setExamQuestionIds(examId, []);

  return createResult(true, { ...exam, questionIds: [] }, []);
}

export function addQuestionToExam(examId, questionPayload) {
  const normalizedExamId = toStringOrNull(examId);
  if (!normalizedExamId) {
    return createResult(false, null, ['examId is required.']);
  }

  const exam = getExamById(normalizedExamId);
  if (!exam) {
    return createResult(false, null, ['exam not found.']);
  }

  const validation = validateQuestionSchema(questionPayload);
  if (!validation.valid) {
    return createResult(false, null, validation.errors);
  }

  const existingOrder = getExamQuestionIds(normalizedExamId);
  const normalizedQuestion = createQuestionFromPayload({
    ...validation.value,
    examKey: normalizedExamId,
    tenantId: toStringOrNull(questionPayload?.tenantId) || exam.tenantId || null,
    status: validation.value.status || QUESTION_STATUSES.DRAFT,
  });

  const questionId = toStringOrNull(normalizedQuestion.questionId) || createId('question');
  const now = new Date().toISOString();

  const question = {
    ...normalizedQuestion,
    questionId,
    examKey: normalizedExamId,
    order: normalizedQuestion.order > 0 ? normalizedQuestion.order : (existingOrder.length + 1),
    createdAt: now,
    updatedAt: now,
  };

  questionStore.set(questionId, question);
  setExamQuestionIds(normalizedExamId, [...existingOrder, questionId]);
  reindexQuestions(normalizedExamId);

  const persistedQuestion = getQuestionById(questionId);

  return createResult(true, persistedQuestion ? { ...persistedQuestion } : { ...question }, []);
}

export function updateQuestion(questionId, payload) {
  const normalizedQuestionId = toStringOrNull(questionId);
  if (!normalizedQuestionId) {
    return createResult(false, null, ['questionId is required.']);
  }

  const existingQuestion = getQuestionById(normalizedQuestionId);
  if (!existingQuestion) {
    return createResult(false, null, ['question not found.']);
  }

  const sourcePayload = (payload && typeof payload === 'object') ? payload : {};
  const validation = validateQuestionSchema({
    ...existingQuestion,
    ...sourcePayload,
  });

  if (!validation.valid) {
    return createResult(false, null, validation.errors);
  }

  const normalizedQuestion = createQuestionFromPayload({
    ...existingQuestion,
    ...validation.value,
    questionId: existingQuestion.questionId,
    tenantId: existingQuestion.tenantId,
    examKey: existingQuestion.examKey,
    createdAt: existingQuestion.createdAt,
    createdBy: existingQuestion.createdBy,
    updatedBy: toStringOrNull(sourcePayload.updatedBy) || existingQuestion.updatedBy || null,
    status: validation.value.status || existingQuestion.status || QUESTION_STATUSES.DRAFT,
  });

  const updatedQuestion = {
    ...existingQuestion,
    ...normalizedQuestion,
    updatedAt: new Date().toISOString(),
  };

  questionStore.set(normalizedQuestionId, updatedQuestion);

  return createResult(true, { ...updatedQuestion }, []);
}

export function removeQuestion(questionId) {
  const normalizedQuestionId = toStringOrNull(questionId);
  if (!normalizedQuestionId) {
    return createResult(false, null, ['questionId is required.']);
  }

  const existingQuestion = getQuestionById(normalizedQuestionId);
  if (!existingQuestion) {
    return createResult(false, null, ['question not found.']);
  }

  questionStore.delete(normalizedQuestionId);

  const examId = toStringOrNull(existingQuestion.examKey);
  if (examId) {
    const orderedIds = getExamQuestionIds(examId).filter((id) => id !== normalizedQuestionId);
    setExamQuestionIds(examId, orderedIds);
    reindexQuestions(examId);
  }

  return createResult(true, { ...existingQuestion, status: QUESTION_STATUSES.ARCHIVED }, []);
}

export function reorderExamQuestions(examId, orderedQuestionIds) {
  const normalizedExamId = toStringOrNull(examId);
  if (!normalizedExamId) {
    return createResult(false, null, ['examId is required.']);
  }

  const exam = getExamById(normalizedExamId);
  if (!exam) {
    return createResult(false, null, ['exam not found.']);
  }

  if (!Array.isArray(orderedQuestionIds)) {
    return createResult(false, null, ['orderedQuestionIds must be an array.']);
  }

  const normalizedOrder = orderedQuestionIds
    .map((id) => toStringOrNull(id))
    .filter((id) => Boolean(id));

  const currentQuestionIds = getExamQuestionIds(normalizedExamId);
  const currentIdSet = new Set(currentQuestionIds);
  const normalizedIdSet = new Set(normalizedOrder);

  if (normalizedOrder.length !== currentQuestionIds.length) {
    return createResult(false, null, ['orderedQuestionIds length does not match current question count.']);
  }

  if (currentIdSet.size !== normalizedIdSet.size) {
    return createResult(false, null, ['orderedQuestionIds must not contain duplicates.']);
  }

  const hasMissingIds = currentQuestionIds.some((id) => !normalizedIdSet.has(id));
  const hasUnknownIds = normalizedOrder.some((id) => !currentIdSet.has(id));

  if (hasMissingIds || hasUnknownIds) {
    return createResult(false, null, ['orderedQuestionIds must include exactly the current exam question ids.']);
  }

  setExamQuestionIds(normalizedExamId, normalizedOrder);
  reindexQuestions(normalizedExamId);

  const reorderedQuestions = getExamQuestionIds(normalizedExamId)
    .map((id) => getQuestionById(id))
    .filter((question) => Boolean(question))
    .map((question) => ({ ...question }));

  return createResult(true, {
    examId: normalizedExamId,
    questionIds: [...normalizedOrder],
    questions: reorderedQuestions,
  }, []);
}

export async function saveExam(examPayload) {
  const localExamResult = createExam(examPayload);
  if (!localExamResult.ok) {
    return createResult(false, null, localExamResult.errors);
  }

  try {
    const db = getFirestoreOrThrow();
    const exam = localExamResult.data || {};
    const metadata = normalizeExamMetadata(examPayload, exam);

    const tenantId = toStringOrNull(metadata.tenantId);
    if (!tenantId) {
      return createResult(false, null, ['tenantId is required.']);
    }

    const examId = toStringOrNull(metadata.examId) || toStringOrNull(exam.examId) || createId('exam');
    const now = new Date().toISOString();
    const timestamp = getServerTimestampOrIso();

    const examDoc = {
      examId,
      tenantId,
      title: metadata.title,
      description: metadata.description,
      category: metadata.category,
      groupType: metadata.groupType,
      lessonKey: metadata.lessonKey,
      totalQuestions: metadata.totalQuestions,
      timeLimit: metadata.timeLimit,
      status: metadata.status,
      updatedAt: timestamp,
      createdAt: exam.createdAt || timestamp,
      source: 'admin_exam_builder',
      schemaVersion: 1,
    };

    await db
      .collection('tenantExams')
      .doc(tenantId)
      .collection('exams')
      .doc(examId)
      .set(examDoc, { merge: true });

    const persistedExam = {
      ...exam,
      ...metadata,
      examId,
      tenantId,
      updatedAt: now,
      createdAt: exam.createdAt || now,
    };

    examStore.set(examId, persistedExam);
    setExamQuestionIds(examId, getExamQuestionIds(examId));

    return createResult(true, {
      ...persistedExam,
      firestorePath: `tenantExams/${tenantId}/exams/${examId}`,
    }, []);
  } catch (error) {
    return createResult(false, null, [String(error && error.message ? error.message : error)]);
  }
}

export async function saveQuestion(examId, questionPayload) {
  const normalizedExamId = toStringOrNull(examId);
  if (!normalizedExamId) {
    return createResult(false, null, ['examId is required.']);
  }

  const exam = getExamById(normalizedExamId);
  if (!exam) {
    return createResult(false, null, ['exam not found. Create/save exam first.']);
  }

  const prepared = normalizeQuestionForSave(normalizedExamId, exam, questionPayload);
  if (!prepared.valid) {
    return createResult(false, null, prepared.errors);
  }

  try {
    const db = getFirestoreOrThrow();
    const question = prepared.value;
    const tenantId = toStringOrNull(question.tenantId) || toStringOrNull(exam.tenantId);
    if (!tenantId) {
      return createResult(false, null, ['tenantId is required to save question.']);
    }

    const now = new Date().toISOString();
    const timestamp = getServerTimestampOrIso();

    const existingOrder = getExamQuestionIds(normalizedExamId);
    const order = question.order > 0 ? question.order : (existingOrder.length + 1);

    const questionDoc = {
      ...question,
      questionId: question.questionId,
      tenantId,
      examKey: normalizedExamId,
      order,
      updatedAt: timestamp,
      createdAt: question.createdAt || timestamp,
      source: 'admin_exam_builder',
      schemaVersion: question.schemaVersion === 2 ? 2 : 1,
    };

    await db
      .collection('tenantExams')
      .doc(tenantId)
      .collection('questions')
      .doc(question.questionId)
      .set(questionDoc, { merge: true });

    const persistedQuestion = {
      ...question,
      tenantId,
      examKey: normalizedExamId,
      order,
      updatedAt: now,
      createdAt: question.createdAt || now,
    };

    questionStore.set(question.questionId, persistedQuestion);
    if (!existingOrder.includes(question.questionId)) {
      setExamQuestionIds(normalizedExamId, [...existingOrder, question.questionId]);
      reindexQuestions(normalizedExamId);
    }

    const currentQuestionIds = getExamQuestionIds(normalizedExamId);
    const currentExam = getExamById(normalizedExamId);
    if (currentExam) {
      const updatedExam = {
        ...currentExam,
        totalQuestions: currentQuestionIds.length,
        updatedAt: now,
      };
      examStore.set(normalizedExamId, updatedExam);

      await db
        .collection('tenantExams')
        .doc(tenantId)
        .collection('exams')
        .doc(normalizedExamId)
        .set({
          totalQuestions: currentQuestionIds.length,
          updatedAt: timestamp,
        }, { merge: true });
    }

    return createResult(true, {
      ...persistedQuestion,
      firestorePath: `tenantExams/${tenantId}/questions/${question.questionId}`,
    }, []);
  } catch (error) {
    return createResult(false, null, [String(error && error.message ? error.message : error)]);
  }
}

export async function loadExamQuestions(examId) {
  const normalizedExamId = toStringOrNull(examId);
  if (!normalizedExamId) {
    return createResult(false, null, ['examId is required.']);
  }

  const exam = getExamById(normalizedExamId);
  if (!exam || !exam.tenantId) {
    return createResult(false, null, ['exam not found in service store or tenantId is missing.']);
  }

  try {
    const db = getFirestoreOrThrow();
    const tenantId = toStringOrNull(exam.tenantId);
    const querySnap = await db
      .collection('tenantExams')
      .doc(tenantId)
      .collection('questions')
      .where('examKey', '==', normalizedExamId)
      .orderBy('order', 'asc')
      .get();

    const questions = querySnap.docs.map((doc) => {
      const data = doc.data() || {};
      const normalized = createQuestionFromPayload({
        ...data,
        questionId: doc.id,
        examKey: normalizedExamId,
        tenantId,
      });

      return {
        ...normalized,
        questionId: doc.id,
        examKey: normalizedExamId,
        tenantId,
        order: toNonNegativeNumber(data.order, 0),
      };
    });

    questions.forEach((question) => {
      questionStore.set(question.questionId, { ...question });
    });
    setExamQuestionIds(normalizedExamId, questions.map((q) => q.questionId));

    return createResult(true, {
      examId: normalizedExamId,
      tenantId,
      questions,
      firestorePath: `tenantExams/${tenantId}/questions/*`,
    }, []);
  } catch (error) {
    return createResult(false, null, [String(error && error.message ? error.message : error)]);
  }
}

export {
  EXAM_GROUP_TYPES,
  LESSON_KEYS,
};