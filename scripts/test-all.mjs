/**
 * Full verification suite for dsh-nce:
 *
 *   1. rebuild the client bundle from the fragments (`build-client`)
 *   2. the layering contract holds (`check-architecture`)
 *   3. the client bundle loads and renders every page (`test-client-load`)
 *   4. built-in data hygiene, IPA and OCR-junk guards (`check-data`)
 *   5. single-page lesson render (`test-lesson-page`)
 *   6. exercise-paper engine (`test-paper`)
 *   7. exercise-paper AI-grading UI (`test-paper-ui`)
 *   8. 错题本 store + page (`test-mistakes`)
 *   9. 错题 AI 讲解 prompts/route (`test-explain`)
 *  10. AI-teacher grading parser/prompts (`test-ai-grade`)
 *  11. pure host domain units (`test-host-domain`)
 *  12. host HTTP API through the real plugin entry with isolated HOME (`smoke-api`)
 *
 * Usage: node scripts/test-all.mjs
 *
 * `client.js` is a build artifact, so step 1 intentionally writes it; use
 * `npm run build:check` when you only want to verify it is up to date.
 *
 * The last step boots the plugin against a temporary HOME so the developer's real
 * learning data (`~/.dsh/dsh-nce`) is never touched; a `.migrated`/`.corrupt`
 * artifact cannot escape into it.
 */
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const failures = []

const steps = [
  { name: 'client bundle build', args: ['scripts/build-client.mjs'] },
  { name: 'architecture', args: ['scripts/check-architecture.mjs'] },
  { name: 'client load + render', args: ['scripts/test-client-load.mjs'] },
  { name: 'data hygiene', args: ['scripts/check-data.mjs'] },
  { name: 'single-page lesson', args: ['scripts/test-lesson-page.mjs'] },
  { name: 'exercise paper', args: ['scripts/test-paper.mjs'] },
  { name: 'paper UI', args: ['scripts/test-paper-ui.mjs'] },
  { name: 'mistake notebook', args: ['scripts/test-mistakes.mjs'] },
  { name: 'mistake AI explanation', args: ['scripts/test-explain.mjs'] },
  { name: 'AI grading', args: ['scripts/test-ai-grade.mjs'] },
  { name: 'host domain', args: ['scripts/test-host-domain.mjs'] },
  { name: 'host API', args: ['scripts/smoke-api.mjs'], isolatedHome: true },
]

const startedAt = Date.now()
for (const step of steps) {
  let home = process.env.HOME
  let temporaryHome = null
  if (step.isolatedHome === true) {
    temporaryHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-nce-test-'))
    home = temporaryHome
  }
  process.stdout.write(`\n▸ ${step.name}\n`)
  const started = Date.now()
  const result = spawnSync(node, step.args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, HOME: home },
  })
  const ms = Date.now() - started
  if (temporaryHome !== null) await fs.rm(temporaryHome, { recursive: true, force: true })
  if (result.status !== 0) failures.push(`${step.name} (exit ${result.status ?? result.signal})`)
  process.stdout.write(`  ${result.status === 0 ? 'ok' : 'FAIL'} (${ms} ms)\n`)
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
if (failures.length > 0) {
  console.error(`\ntest-all: ${failures.length} failing step(s) of ${steps.length} — ${failures.join(', ')} (${seconds}s)`)
  process.exit(1)
}
console.log(`\ntest-all: ok — ${steps.length} steps passed (${seconds}s)`)
