// Fixtures for the rebuild-loop check (§4.2).
//
// `npm test` cannot reach this behaviour from either side: all three of
// foliate-js's shadow roots are `mode: 'closed'`, so rendering is only
// observable visually, and the stubbed `vscode` module never fires
// onDidChangeTextDocument. So "an edit actually re-renders" is checked here, the
// same way the device frame was — through the browser harness.
//
// The bug this exists to catch: foliate-js's `view.open()` *appends* a renderer
// to its shadow root and never removes the previous one. Opening a second book
// therefore left the first one on screen (the second is clipped by
// `#frame { overflow: hidden }`) while `view.renderer` — what the page buttons
// drive — pointed at the invisible one. Typing changed nothing and the buttons
// did nothing.
//
//   npm run compile && node spike/rebuild-loop.mjs && npm run spike
//
// then, against http://127.0.0.1:7331/preview.html:
//
//   const view = document.getElementById('view')
//   const seen = []
//   view.addEventListener('load', e => seen.push(e.detail.doc.body.textContent.trim()))
//   const load = async n => new Uint8Array(await (await fetch(`/rebuild-${n}.epub`)).arrayBuffer())
//   window.postMessage({ type: 'book', bytes: await load(1) }, '*')
//   window.postMessage({ type: 'book', bytes: await load(2), keepPosition: true }, '*')
//
// Four things must hold:
//   1. `seen` ends on VERSION-TWO — the newer book is what is on screen.
//   2. `view.renderer.parentNode.children.length === 1` — one renderer in the
//      shadow root, not one per rebuild. `renderer` is a public property, which
//      is the only handle the closed shadow root leaves us.
//   3. clicking #next moves #progress — the buttons drive the visible book.
//   4. Book 3 is book 1 with one word changed — the edit loop the tool exists
//      for. Page a few screens into book 1, post book 3 with keepPosition, and
//      #progress must stay where it was. This is the §4.2 invariant: without CFI
//      restore every keystroke throws the reader back to the cover, which is a
//      worse regression than the stale-renderer bug and is invisible in a
//      book-1 → book-2 swap, where the old CFI cannot resolve in the new book
//      anyway and "restored" and "reset to the start" look identical.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

const { buildForPreview } = require(join(root, 'out/src/epub/build.js'))

// Long enough to paginate into several pages, so a stuck "next" is visible.
const filler = (word) => Array.from({ length: 40 }, (_, i) => `${word} 段落 ${i + 1}。`.repeat(6)).join('\n\n')

const one = `# VERSION-ONE\n\n${filler('第一版')}\n\n## VERSION-ONE 第二章\n\n${filler('第一版乙')}\n`

const BOOKS = {
    1: one,
    2: `# VERSION-TWO\n\n${filler('第二版')}\n\n## VERSION-TWO 第二章\n\n${filler('第二版乙')}\n`,
    // Book 1 with a single word edited, which is what typing actually produces.
    // A book-1 → book-2 swap cannot test CFI restore: the old position does not
    // exist in a different book, so a working restore and a reset to the cover
    // are the same observation.
    3: one.replace('第一版 段落 3。', '第一版 段落 3 已改。'),
}

for (const [n, markdown] of Object.entries(BOOKS)) {
    const result = buildForPreview({ markdown, basename: `rebuild-${n}` })
    const out = join(here, `rebuild-${n}.epub`)
    writeFileSync(out, result.bytes)
    console.log(`wrote ${out}  (${result.chapters.length} chapters, ${(result.bytes.length / 1024).toFixed(1)} KB)`)
}
