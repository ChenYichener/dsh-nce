/**
 * Ports (interfaces) that the application layer depends on.
 *
 * This file is documentation only: it contains JSDoc typedefs, no runtime
 * code and no imports, so the composition root can inject any adapter that
 * satisfies them (`src/host/infrastructure/*` in production, fakes in tests).
 *
 * Progress shape notes: `progress` below is the normalized object produced by
 * `domain/progress.js` (`emptyProgress`/`normalizeProgress`).
 *
 * @module host/ports
 */

/**
 * Persistence adapter for the whole learning-progress document.
 *
 * @typedef {object} ProgressRepository
 * @property {() => Promise<void>} ensureReady  Open the backing store lazily (DB first open also migrates legacy JSON).
 * @property {() => Promise<object>} load       Read the stored progress; JSON fallback + corrupt-file handling live here.
 * @property {(progress: object) => Promise<void>} save Persist one snapshot (SQLite, else queued atomic JSON mirror).
 * @property {() => Promise<boolean>} reset     Clear every persisted row; resolves false when only the JSON fallback is active.
 * @property {(wordKey: string, grade: string, dueBefore: string|null, dueAfter: string) => void} recordReview Append one review-log row (best effort).
 * @property {string} storageMode               'sqlite' or 'json'.
 * @property {() => { mode: string, file: string, legacyFile: string, dbFile: string }} storageInfo Where the data currently lives.
 */

/**
 * Read-only adapter over the bundled NCE dataset and the derived word lookup.
 *
 * @typedef {object} DataRepository
 * @property {string} dir Path of the bundled `data/` directory (reported by `/api/info`).
 * @property {() => Promise<object>} loadIndex
 * @property {(id: number) => Promise<object>} loadLesson
 * @property {() => Promise<object>} loadWordbank
 * @property {() => Promise<object>} loadPhonetics
 * @property {() => Promise<Map<string, object>>} wordLookup key → word bank entry, cached.
 */

/**
 * Text-to-speech adapter (macOS `say` in production).
 *
 * @typedef {object} SpeechEngine
 * @property {() => Promise<boolean>} available Whether local speech synthesis works on this machine.
 * @property {(text: string, rate: number) => Promise<Buffer>} synthesize Rendered WAV bytes (cached on disk).
 */

/**
 * Bridge to the profile's default model.
 *
 * `ctx` is the opaque host cordis context; the application layer only passes it
 * through to this port.
 *
 * @typedef {object} LlmGateway
 * @property {(ctx: object) => boolean} isAvailable Whether the host exposes an `llm` service.
 * @property {(ctx: object) => { provider: string, model: string }} currentSelection Resolved default model ('' when unset).
 * @property {(ctx: object, options: object) => AsyncIterable<object>} stream Raw model stream.
 * @property {(ctx: object, options: object) => Promise<{ text: string, finishReason: string }>} collect Drain one stream into plain text.
 * @property {(lessonId: number, items: object[], output: string, repairOutput: string, finishReason: string, repairFinishReason: string) => Promise<void>} saveFailure Persist the last failed grading output for diagnosis.
 * @property {(text: string) => string} snippet Compact one-line excerpt of model output for error messages.
 * @property {string} debugFile File the failure diagnostics are written to.
 */

/**
 * Read-only access to the dsh-translate plugin's history file.
 *
 * @typedef {object} TranslateHistorySource
 * @property {() => Promise<{ available: boolean, records: object[] }>} load Normalized history records; `available:false` when the file is missing.
 */

/**
 * Time source. The current host uses `Date` directly; this port documents the
 * seam for making the application layer deterministic in tests.
 *
 * @typedef {object} Clock
 * @property {() => number} now Epoch milliseconds.
 * @property {() => Date} today Current local date.
 * @property {() => string} dayKey Today as `YYYY-MM-DD` in local time.
 */

/**
 * Minimal structured logger port (the host currently uses `console` directly).
 *
 * @typedef {object} Logger
 * @property {(message: string, ...args: unknown[]) => void} info
 * @property {(message: string, ...args: unknown[]) => void} error
 */
