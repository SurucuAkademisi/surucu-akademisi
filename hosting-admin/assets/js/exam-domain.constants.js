export const QUESTION_TYPES = {
    TEXT: 'text',
    IMAGE: 'image',
    VIDEO: 'video'
};

export const EXAM_STATUSES = {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    ARCHIVED: 'archived'
};

export const QUESTION_STATUSES = {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    ARCHIVED: 'archived'
};

export const QUESTION_MEDIA_TYPES = {
    NONE: 'none',
    IMAGE: 'image',
    VIDEO: 'video'
};

export const QUESTION_TYPE_VALUES = Object.freeze(Object.values(QUESTION_TYPES));
export const QUESTION_STATUS_VALUES = Object.freeze(Object.values(QUESTION_STATUSES));
export const EXAM_STATUS_VALUES = Object.freeze(Object.values(EXAM_STATUSES));
export const QUESTION_MEDIA_VALUES = Object.freeze(Object.values(QUESTION_MEDIA_TYPES));