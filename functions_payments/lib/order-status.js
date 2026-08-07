'use strict';

const ORDER_STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded'
});

const ALL_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.PAID,
  ORDER_STATUS.FAILED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REFUNDED
]);

/** @type {Readonly<Record<string, readonly string[]>>} */
const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.DRAFT]: [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PENDING_PAYMENT]: [
    ORDER_STATUS.PAID,
    ORDER_STATUS.FAILED,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.FAILED]: [],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REFUNDED]: []
});

/**
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
function canTransitionOrderStatus(fromStatus, toStatus) {
  const from = String(fromStatus || '').trim();
  const to = String(toStatus || '').trim();
  if (!from || !to || from === to) return false;
  const allowed = ALLOWED_STATUS_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.indexOf(to) !== -1;
}

/**
 * @param {string} status
 * @returns {boolean}
 */
function isValidOrderStatus(status) {
  return ALL_ORDER_STATUSES.indexOf(String(status || '').trim()) !== -1;
}

module.exports = {
  ORDER_STATUS,
  ALL_ORDER_STATUSES,
  ALLOWED_STATUS_TRANSITIONS,
  canTransitionOrderStatus,
  isValidOrderStatus
};
