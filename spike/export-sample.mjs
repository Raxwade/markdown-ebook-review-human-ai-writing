// Runs a markdown file through the real pipeline and writes the EPUB into spike/,
// so the M0 harness can load our own output instead of the synthetic fixture.
// This is how §9's "能被 Foliate 開啟" gets checked here: foliate-js is the same
// engine desktop Foliate uses.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

const { buildForExport } = require(join(root, 'out/src/epub/build.js'))

const mdPath = resolve(process.argv[2] ?? join(root, 'test/fixtures/sample.md'))
const outPath = join(here, 'exported.epub')
const baseDir = dirname(mdPath)

const readAsset = ref => {
    const full = resolve(baseDir, ref)
    const rel = relative(baseDir, full)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    try { return new Uint8Array(readFileSync(full)) } catch { return null }
}

const result = buildForExport({
    markdown: readFileSync(mdPath, 'utf8'),
    basename: mdPath.split('/').pop().replace(/\.md$/, ''),
    readAsset,
})

writeFileSync(outPath, result.bytes)
console.log(`wrote ${outPath}`)
console.log(`  title    : ${result.title}`)
console.log(`  chapters : ${result.chapters.length}  ${result.chapters.map(c => c.title).join(' / ')}`)
console.log(`  assets   : ${result.assets.length}`)
console.log(`  hashes   : ${result.chapterHashes.length}`)
console.log(`  size     : ${(result.bytes.length / 1024).toFixed(1)} KB`)
for (const w of result.warnings) console.log(`  warning  : ${w}`)
