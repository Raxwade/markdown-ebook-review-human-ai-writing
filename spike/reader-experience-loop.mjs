// Browser fixture for the reader-experience harness.
//
//   npm run compile
//   npm run spike:reader
//   npm run spike
//   google-chrome --headless --no-sandbox --disable-gpu \
//     --virtual-time-budget=20000 --dump-dom \
//     http://127.0.0.1:7331/reader-experience.html
//
// The result is emitted into <pre id="result" data-done="true">. This uses the
// real media/reader.html and bundled Foliate stage, not a DOM mock.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const { buildForPreview } = require(join(root, 'out/src/epub/build.js'))

const chapters = Array.from({ length: 8 }, (_, chapter) => {
    const paragraphs = Array.from({ length: 10 }, (_, paragraph) =>
        `CJK搜尋詞-${chapter + 1}-${paragraph + 1}。`+
        ` Latin needle ${chapter + 1}-${paragraph + 1}. `+
        '這段文字用來讓分頁、捲動、字距與行高的改變有足夠內容可以重新排版。'.repeat(5))
    return `## 第 ${chapter + 1} 章\n\n![Review diagram](evidence/notes-highlight.png)\n\n${paragraphs.join('\n\n')}`
})

const markdown = `# Reader Experience Fixture\n\n${chapters.join('\n\n')}\n`
const result = buildForPreview({
    markdown,
    basename: 'reader-experience',
    sourcePath: 'spike/reader-experience.md',
    readAsset: ref => {
        try { return new Uint8Array(readFileSync(join(here, ref))) }
        catch { return null }
    },
})

const out = join(here, 'reader-experience.epub')
writeFileSync(out, result.bytes)
console.log(`wrote ${out} (${result.chapters.length} chapters, ${(result.bytes.length / 1024).toFixed(1)} KB)`)
