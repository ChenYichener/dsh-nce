/**
 * Node half of dsh-nce: one `/dsh-nce/api` JSON route for the NCE learning panel.
 *
 * This file is only the composition root: it builds the runtime config, wires
 * infrastructure adapters into the application use cases, registers every
 * operation and mounts the HTTP handler under the host web server. The actual
 * logic lives in `src/host/`:
 *
 * - `domain/`         pure rules (SRS, progress model, views, AI grading)
 * - `application/`    use cases (one per API area), adapters injected via ports
 * - `infrastructure/` SQLite/JSON persistence, bundled data, macOS `say`, LLM
 * - `http/`           trust fence, body parsing, dispatch, error mapping
 *
 * Behavior contract (see `docs/API-CONTRACT.md` / `docs/PERSISTENCE.md`): all
 * `/dsh-nce/api/<op>` ops, status codes, storage fallback/migration, caches and
 * lazy initialization stay exactly as before the split.
 *
 * @module dsh-nce
 */

import { createContentOperations } from './src/host/application/content.js'
import { createExplainOperations } from './src/host/application/explain.js'
import { createGradingOperations } from './src/host/application/grading.js'
import { createLearningOperations } from './src/host/application/learning.js'
import { createProgressOperations, createProgressService } from './src/host/application/progress.js'
import { createReviewOperations } from './src/host/application/review.js'
import { createSpeechOperations } from './src/host/application/speech.js'
import { createTranslateService } from './src/host/application/translate.js'
import { createConfig } from './src/host/config.js'
import { RouteError } from './src/host/http/errors.js'
import { createHandler } from './src/host/http/handler.js'
import { createDataRepository } from './src/host/infrastructure/data-repository.js'
import { createLlmGateway } from './src/host/infrastructure/llm.js'
import { createProgressRepository } from './src/host/infrastructure/progress-repository.js'
import { createSpeechEngine } from './src/host/infrastructure/speech-engine.js'
import { createTranslateHistorySource } from './src/host/infrastructure/translate-history.js'

/** Service required before the route can mount. */
export const inject = ['webServer']

// ---------------------------------------------------------------------------
// Composition: config -> infrastructure adapters -> application use cases
// (constructors are lazy: the DB is opened on the first op, data on first read)
// ---------------------------------------------------------------------------

const config = createConfig()

const progressRepository = createProgressRepository(config)
const dataRepository = createDataRepository(config)
const speechEngine = createSpeechEngine(config)
const translateHistorySource = createTranslateHistorySource(config)
const llmGateway = createLlmGateway(config)

const progressService = createProgressService({ repository: progressRepository })
const translateService = createTranslateService({ translateHistorySource, progressService, RouteError })

const contentOperations = createContentOperations({
  dataRepository,
  progressRepository,
  progressService,
  speechEngine,
  translateHistorySource,
  RouteError,
})
const learningOperations = createLearningOperations({ progressService, RouteError })
const reviewOperations = createReviewOperations({ dataRepository, progressService, translateService, RouteError })
const gradingOperations = createGradingOperations({ dataRepository, llmGateway, RouteError })
const explainOperations = createExplainOperations({ llmGateway, RouteError })
const speechOperations = createSpeechOperations({ speechEngine, RouteError })
const progressOperations = createProgressOperations({ progressService, RouteError })

/** `op name -> async (payload, { ctx, res })`; every HTTP op is registered here. */
const operations = {
  ...contentOperations,
  ...learningOperations,
  ...reviewOperations,
  'translate/list': translateService['translate/list'],
  'translate/add': translateService['translate/add'],
  'translate/remove': translateService['translate/remove'],
  tts: speechOperations.tts,
  'paper/grade': gradingOperations.paperGrade,
  'paper/explain': explainOperations.explain,
  'progress/reset': progressOperations.reset,
}

/**
 * Plugin body: mount the /dsh-nce/api route under the host webServer.
 * @param ctx - host cordis context (webServer).
 */
export function apply(ctx) {
  const handler = createHandler({
    operations,
    ctx,
    routePrefix: config.routePrefix,
    maxBodyBytes: config.maxBodyBytes,
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: config.routePrefix,
    handler,
  }), 'dsh-nce: /dsh-nce/api routes')
}
