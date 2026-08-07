'use strict';

/** @type {Readonly<{
 *   productType: string,
 *   productTitle: string,
 *   amount: number,
 *   currency: string,
 *   durationDays: number
 * }>} */
const VIDEO_LESSONS_180_DAYS = Object.freeze({
  productType: 'video_lessons_180_days',
  productTitle: 'Video Öğretmen Dersleri Premium',
  amount: 249,
  currency: 'TRY',
  durationDays: 180
});

module.exports = {
  VIDEO_LESSONS_180_DAYS
};
