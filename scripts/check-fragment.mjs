/**
 * Syntax-check one client fragment in isolation.
 *
 * Usage: node scripts/check-fragment.mjs src/client/00-platform.js
 *
 * Fragments are concatenated inside one factory body, so a bare `new Function`
 * on the fragment text is the same parse context the browser gets. Nothing is
 * executed.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: node scripts/check-fragment.mjs <fragment.js>')
  process.exit(2)
}

const text = await fs.readFile(path.resolve(process.cwd(), target), 'utf8')
try {
  // Parse only: the body is never called.
  new Function(`return function factory(require) {\n${text}\n}`)
  console.log(`ok: ${target}`)
} catch (error) {
  console.error(`FAIL ${target}: ${error.message}`)
  process.exit(1)
}
