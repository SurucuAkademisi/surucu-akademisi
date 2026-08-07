import {
  createExam as serviceCreateExam,
  addQuestionToExam as serviceAddQuestionToExam,
  updateQuestion as serviceUpdateQuestion,
  removeQuestion as serviceRemoveQuestion,
  reorderExamQuestions as serviceReorderExamQuestions,
} from './exam-builder.service.js';

// Exam builder store foundation.
// Safe non-breaking module: exported only, not wired to runtime yet.

function createEmptyState() {
  return {
    examId: null,
    tenantId: null,
    title: '',
    description: '',
    category: null,
    timeLimit: null,
    questions: [],
  };
}

let examBuilderState = createEmptyState();

function toStringOrNull(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function toStringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toQuestionList(value) {
  return Array.isArray(value) ? value : [];
}

function cloneState() {
  return {
    ...examBuilderState,
    questions: examBuilderState.questions.map((question) => ({ ...question })),
  };
}

function mergeExamMetadata(base, source) {
  return {
    examId: toStringOrNull(source.examId) || toStringOrNull(base.examId),
    tenantId: toStringOrNull(source.tenantId) || toStringOrNull(base.tenantId),
    title: toStringOrEmpty(source.title),
    description: toStringOrEmpty(source.description),
    category: toStringOrNull(source.category),
    timeLimit: source.timeLimit == null ? null : Number(source.timeLimit),
  };
}

function setQuestions(questions) {
  examBuilderState = {
    ...examBuilderState,
    questions: toQuestionList(questions).map((question) => ({ ...question })),
  };
}

export function initializeExamBuilder(examData) {
  const source = (examData && typeof examData === 'object') ? examData : {};
  const metadata = mergeExamMetadata(createEmptyState(), source);

  const createdExamResult = serviceCreateExam({
    examId: metadata.examId,
    tenantId: metadata.tenantId,
    title: metadata.title,
    description: metadata.description,
    category: metadata.category,
    timeLimit: metadata.timeLimit,
    totalQuestions: 0,
    status: source.status,
  });

  if (!createdExamResult.ok) {
    return {
      ok: false,
      errors: createdExamResult.errors,
      data: null,
    };
  }

  const createdExam = createdExamResult.data || {};
  examBuilderState = {
    examId: toStringOrNull(createdExam.examId),
    tenantId: toStringOrNull(createdExam.tenantId),
    title: toStringOrEmpty(createdExam.title),
    description: toStringOrEmpty(createdExam.description),
    category: toStringOrNull(createdExam.category),
    timeLimit: createdExam.timeLimit == null ? null : Number(createdExam.timeLimit),
    questions: [],
  };

  const initialQuestions = toQuestionList(source.questions);
  for (const question of initialQuestions) {
    const addResult = serviceAddQuestionToExam(examBuilderState.examId, question);
    if (!addResult.ok) {
      return {
        ok: false,
        errors: addResult.errors,
        data: cloneState(),
      };
    }

    setQuestions([...examBuilderState.questions, addResult.data]);
  }

  return {
    ok: true,
    errors: [],
    data: cloneState(),
  };
}

export function getExamBuilderState() {
  return cloneState();
}

export function addQuestion(question) {
  if (!examBuilderState.examId) {
    return {
      ok: false,
      errors: ['Exam builder is not initialized.'],
      data: null,
    };
  }

  const result = serviceAddQuestionToExam(examBuilderState.examId, question);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors,
      data: null,
    };
  }

  setQuestions([...examBuilderState.questions, result.data]);

  return {
    ok: true,
    errors: [],
    data: cloneState(),
  };
}

export function updateQuestion(questionId, payload) {
  if (!examBuilderState.examId) {
    return {
      ok: false,
      errors: ['Exam builder is not initialized.'],
      data: null,
    };
  }

  const result = serviceUpdateQuestion(questionId, payload);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors,
      data: null,
    };
  }

  const updatedQuestion = result.data;
  const nextQuestions = examBuilderState.questions.map((question) => {
    if (question.questionId !== updatedQuestion.questionId) return question;
    return { ...updatedQuestion };
  });

  setQuestions(nextQuestions);

  return {
    ok: true,
    errors: [],
    data: cloneState(),
  };
}

export function removeQuestion(questionId) {
  if (!examBuilderState.examId) {
    return {
      ok: false,
      errors: ['Exam builder is not initialized.'],
      data: null,
    };
  }

  const result = serviceRemoveQuestion(questionId);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors,
      data: null,
    };
  }

  const nextQuestions = examBuilderState.questions.filter((question) => question.questionId !== questionId);
  setQuestions(nextQuestions);

  return {
    ok: true,
    errors: [],
    data: cloneState(),
  };
}

export function reorderQuestions(questionIds) {
  if (!examBuilderState.examId) {
    return {
      ok: false,
      errors: ['Exam builder is not initialized.'],
      data: null,
    };
  }

  const result = serviceReorderExamQuestions(examBuilderState.examId, questionIds);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors,
      data: null,
    };
  }

  const reordered = Array.isArray(result.data?.questions) ? result.data.questions : [];
  setQuestions(reordered);

  return {
    ok: true,
    errors: [],
    data: cloneState(),
  };
}

export function clearExamBuilder() {
  examBuilderState = createEmptyState();
  return cloneState();
}