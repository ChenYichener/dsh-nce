/**
 * Shared domain constants for the NCE host half.
 *
 * @module host/domain/constants
 */

export const LESSON_STEPS = ['words', 'grammar', 'exercise']
export const GRADES = new Set(['again', 'hard', 'good', 'easy'])
export const LESSON_STATUS = new Set(['learning', 'done'])
export const MAX_TEXT = 300
/** Local TTS rate bounds: the client sends a raw number, we clamp it. */
export const SAY_DEFAULT_RATE = 150
export const SAY_MIN_RATE = 80
export const SAY_MAX_RATE = 240
