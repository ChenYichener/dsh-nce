/**
 * Guards `screenshots.json`, the file dsh-market reads to render the
 * App-Store-style screenshot carousel on the plugin detail page.
 *
 * Why this exists: the first version of that file listed six paths that all
 * existed on disk, so a plain `existsSync` check passed — but two of them were
 * gitignored and therefore never pushed, so the storefront would have rendered
 * two broken images. "The file is here" is not "the file is published"; the app
 * store only ever fetches the second one. This check therefore asserts both:
 *
 *   1. the shape dsh-market accepts: 1–8 non-empty relative paths
 *   2. every path exists in the working tree AND is tracked by git
 *
 * Outside a git checkout (for example inside an installed npm package) the
 * tracked check is skipped with a warning rather than failing, because the
 * registry pipeline that consumes this file always runs in a checkout.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = path.join(root, 'screenshots.json')
const problems = []
const warnings = []

let parsed
try {
  parsed = JSON.parse(await fs.readFile(manifest, 'utf8'))
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log('PASS  screenshots.json absent (storefront shows a text-only tile)')
    process.exit(0)
  }
  console.error(`FAIL  screenshots.json is not valid JSON: ${err.message}`)
  process.exit(1)
}

const list = Array.isArray(parsed) ? parsed : parsed?.screenshots
if (!Array.isArray(list)) {
  problems.push('screenshots.json must be a JSON array of relative paths')
} else if (list.length < 1 || list.length > 8) {
  problems.push(`expected 1-8 screenshots, found ${list.length}`)
}

const isRepo =
  spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' })
    .status === 0

for (const entry of Array.isArray(list) ? list : []) {
  if (typeof entry !== 'string' || entry.trim() === '') {
    problems.push(`empty or non-string entry: ${JSON.stringify(entry)}`)
    continue
  }
  if (path.isAbsolute(entry) || entry.includes('..') || /^[a-z]+:\/\//i.test(entry)) {
    problems.push(`${entry}: must be a repo-relative path, not a URL or an absolute path`)
    continue
  }
  if (!existsSync(path.join(root, entry))) {
    problems.push(`${entry}: declared but missing from the working tree`)
    continue
  }
  if (!isRepo) {
    warnings.push(`${entry}: skipped the git-tracked check (not a git checkout)`)
    continue
  }
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', entry], {
    cwd: root,
    encoding: 'utf8',
  })
  if (tracked.status !== 0) {
    problems.push(
      `${entry}: exists on disk but is NOT tracked by git — check .gitignore; ` +
        'the storefront fetches it from the remote, so it would render as a broken image',
    )
  }
}

for (const warning of warnings) console.warn(`WARN  ${warning}`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL  ${problem}`)
  console.error(`\n${problems.length} problem(s) in screenshots.json`)
  process.exit(1)
}

console.log(`PASS  screenshots.json (${list.length} published screenshots)`)
