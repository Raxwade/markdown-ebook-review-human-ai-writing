// Standing check for the annotation loop. `npm test` cannot see any of this:
// the marks live on foliate's overlayer, inside three closed shadow roots, and
// the only handle through is `view.renderer.getContents()[i].overlayer.element`
// — an <svg> with one child per drawn mark. Counting those children is how
// "the highlight is actually gone" gets verified.
//
// This writes spike/notes.epub — a *preview* build, so its blocks carry the
// data-md-line stamps the note anchoring resolves against. Export builds do not
// have them and cannot be used here.
//
//   node spike/notes-loop.mjs
//   npm run spike                      # then open http://127.0.0.1:7331/preview.html
//
// Paste the block printed at the end into the devtools console. It plays the
// whole loop — mark, delete, delete again, delete the file — and asserts:
//
//   1. two marks           → exactly 2 drawings. Three means a note carries two
//                            CFIs: one from the live selection and one rebuilt
//                            from its stored columns, and only one is removable.
//   1b. and in colour      → the computed fill is the configured colour at
//                            opacity 1. The overlayer draws in the *frame's*
//                            document and custom properties do not cross a
//                            document boundary, so with marks.css loaded only by
//                            the webview every highlight painted black at the .3
//                            fallback — with the fill attribute still reading
//                            back a perfectly correct var(--mark-yellow), and the
//                            child count below unchanged, which is how the other
//                            eight assertions walked straight past it.
//   2. delete the first    → 1 drawing left, 1 note posted to the host.
//   3. click where it was  → nothing opens. A ghost would hit-test to a value no
//                            note carries, and the editor would stop opening —
//                            which is what "I can't delete another one" is.
//   4. click the second    → its editor still opens.
//   5. delete it           → 0 drawings.
//   6. echo notes: []      → 0 drawings. Deleting the sidecar in the explorer
//                            clears the page; README promises exactly this.
//   7. same, in chapter 3  → a chapter reached by paging, not the one the book
//                            opened on, removes its drawings too.
//   0. declared size       → the frame's content viewport equals the device size
//                            whatever the zoom. Worth re-running after resizing
//                            the window small enough to scale the frame down:
//                            before the frame was an iframe this tracked the
//                            *visual* size, so a 56%-zoomed iPhone paginated the
//                            book 204px wide instead of 366.
//   9. inside a code block → a mark on a line that is not its block's first one
//                            is still drawn after the host's round trip. One
//                            <pre> covers the whole fence, so the note is stored
//                            against the block's first line while the host, which
//                            re-anchors by searching the markdown, reports the
//                            line the quote is on. Looking that up as a key found
//                            no block and the note was skipped — saved, listed in
//                            the panel, never drawn. Nothing about this is
//                            code-block specific: a hard-wrapped paragraph breaks
//                            identically and looks much more like a mystery.
//  10. jump across chapters → clicking a note whose chapter has never been
//                            rendered goes there and draws it. Such a note has
//                            no CFI — drawSection assigns those, and it only
//                            runs for loaded sections — so the click used to
//                            fall through to the editor, which for a book of any
//                            size is most of the list. Needs the host's
//                            chapterStartLines, hence the value printed above.
//  11. the selected edge   → the mark being looked at draws with a black edge and
//                            the others do not, and Escape gives it up without
//                            erasing the mark. Computed stroke, not the attribute.
//  12. across table cells → the saved quote keeps the cells' text separated,
//                            because that string is what the host has to find in
//                            a source line full of `|`. It is not a substring of
//                            that line, which is what made a table mark report
//                            找不到原句 with its highlight sitting right there.
//                            The matching itself lives in test/notes.test.ts;
//                            what only a browser can settle is this string.
//  13. a stale note        → paints nothing. A mark flagged stale while still
//                            highlighted is indistinguishable in a screenshot
//                            from a leftover browser selection, which greys out
//                            rather than disappearing when the frame loses focus.
//   8. act from the list   → every note carries 編輯 and 刪除, and 刪除 works on
//                            the last remaining one. Only stale notes used to
//                            get those buttons, and an anchored note's list row
//                            only navigated — so from the panel a fresh mark
//                            looked undeletable: the click did nothing visible
//                            and no way to delete ever appeared.
//
// Assertions 2, 3 and 6 are the regression: drawSection used to only ever add,
// and addAnnotation clears only the drawing under the *same* value string, so
// nothing removed the highlight of a note that had been deleted, had gone stale,
// or had moved. It stayed painted until the next rebuild tore the document down.
//
// The one console error you will see, `e.target.closest is not a function`, is
// the harness's own: a click dispatched on the document rather than an element
// trips foliate's link handler. The overlayer's handler runs regardless.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

const { buildForPreview } = require(join(root, 'out/src/epub/build.js'))
const { DEFAULTS } = require(join(root, 'out/src/config.js'))

// Three chapters, two paragraphs each. Two paragraphs so a mark can be made in a
// block that is not the first one — anchoring is per-block, and the first block
// is the case that accidentally works. Three chapters because the repaint used
// to be driven off a map of sections that had already been drawn once, which is
// only ever true of the chapter you opened on; assertion 7 is that path.
const MARKDOWN = `# 註記迴圈

這是第一段，用來標記。標記之後不應該出現兩條線。

這是第二段，刪掉之後不應該還留在畫面上。

\`\`\`
第一行是圍籬後面那行。
第二行才是斷言 9 要標的，因為它不是這個區塊的第一行。
\`\`\`

## 第二章

中間這章只是把第三章推到後面去。

沒有標記會下在這裡。

## 第三章

這一章要等翻頁才會渲染，重畫的時候很容易被漏掉。

在這裡標記再刪掉，是第七項斷言。

| 欄一 | 欄二 | 欄三 |
|---|---|---|
| 甲 | 78 KB | 0.2 ms |
`

const result = buildForPreview({
    markdown: MARKDOWN,
    config: { ...DEFAULTS, splitLevel: 2 },
    basename: 'notes',
    sourcePath: 'spike/notes.md',
    readAsset: () => null,
})

const out = join(here, 'notes.epub')
writeFileSync(out, result.bytes)

console.log(`wrote ${out}  (${(result.bytes.length / 1024).toFixed(1)} KB, ${result.chapters.length} chapter)`)
console.log(`data-md-line stamps present: ${/data-md-line/.test(readFileSync(out).toString('latin1'))}`)
console.log(`
--- paste into the devtools console on /preview.html -----------------------
`)
console.log(String.raw`
const frame = document.getElementById('frame')          // the device frame: an iframe
// chapterStartLines is what the host really sends, printed from this build so it
// cannot drift from the fixture. Assertion 10 is the only thing that needs it.
window.postMessage({ type: 'book', keepPosition: false,
    chapterStartLines: ${JSON.stringify(result.chapterStartLines)},
    bytes: new Uint8Array(await (await fetch('/notes.epub')).arrayBuffer()) }, '*')
await new Promise(r => setTimeout(r, 1800))
// foliate lives in the frame's own realm, so the view is reached through it.
const view = frame.contentWindow.document.getElementById('view')

const at     = i => view.renderer.getContents().find(c => c.index === i)
const marks  = i => at(i).overlayer.element.children.length
const sent   = () => window.__toExtension.at(-1)          // what the webview asked the host to save
const settle = () => new Promise(r => setTimeout(r, 300))
// Stands in for the host: it wrote the file and is echoing the list back.
const echo   = ns => window.postMessage({ type: 'notes', warnings: [], path: 'notes.md.notes.json',
    notes: ns.map(n => ({ ...n, status: 'ok', line: n.range.startLine })) }, '*')

const editorOpen = () => !document.getElementById('note-editor').hidden
const ok = (label, pass, ...extra) => console.log(pass ? 'OK  ' : 'FAIL', label, ...extra)

// The invariant the iframe exists for: the frame's content viewport is the
// declared device size at every zoom. Shrink the panel and re-run to see it hold.
ok('0. paginated at the declared size, not the visual one',
    frame.contentWindow.innerWidth === parseInt(frame.style.width, 10),
    frame.contentWindow.innerWidth + ' vs ' + frame.style.width, frame.style.transform)

// A mouse drag: both boundaries land inside a text node, part-way through.
const mark = (i, nth, a, b, color) => {
    const doc = at(i).doc
    const t = [...doc.querySelectorAll('[data-md-line]')][nth].firstChild
    const rng = doc.createRange(); rng.setStart(t, a); rng.setEnd(t, b)
    const sel = doc.defaultView.getSelection(); sel.removeAllRanges(); sel.addRange(rng)
    doc.dispatchEvent(new doc.defaultView.MouseEvent('mouseup', { bubbles: true }))
    document.querySelector('#mark-bar .swatch[data-color="' + color + '"]').click()
    return rng.getBoundingClientRect()
}
const clickMark = (i, r) => {
    const doc = at(i).doc
    doc.defaultView.getSelection().removeAllRanges()
    doc.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
}
const del = async () => { document.querySelector('#note-delete').click(); await settle() }

const rA = mark(0, 1, 2, 10, 'yellow'); await settle()
const rB = mark(0, 2, 2, 12, 'green');  await settle()
ok('1. two marks, two drawings', marks(0) === 2, marks(0))

// The *computed* fill, not the attribute — the attribute read back as a correct
// var(--mark-yellow) the whole time it painted black. Two colours, because a
// mapping bug that collapsed everything onto one would pass on a single one.
const paint = i => [...at(i).overlayer.element.querySelectorAll('g')]
    .map(g => frame.contentWindow.getComputedStyle(g))
    .map(cs => cs.fill + ' @' + cs.opacity)
ok('1b. drawn in the configured colours',
    JSON.stringify(paint(0)) === JSON.stringify(
        ['rgba(255, 214, 61, 0.5) @1', 'rgba(120, 222, 132, 0.45) @1']),
    paint(0).join('  |  '))

clickMark(0, rA); await settle(); await del()
ok('2. deleted the first', marks(0) === 1 && sent().notes.length === 1, 'drawn=' + marks(0), 'saved=' + sent().notes.length)

clickMark(0, rA); await settle()
ok('3. its old spot is inert', editorOpen() === false)
clickMark(0, rB); await settle()
ok('4. the other one still opens', editorOpen() === true)
await del()
ok('5. deleted the second', marks(0) === 0 && sent().notes.length === 0, 'drawn=' + marks(0))

echo([
    { id: 'x1', color: 'yellow', chapter: '', quote: 'q', note: '', range: { startLine: 2, startCol: 2, endLine: 2, endCol: 10 } },
    { id: 'x2', color: 'green',  chapter: '', quote: 'q', note: '', range: { startLine: 4, startCol: 2, endLine: 4, endCol: 12 } },
]); await settle()
const restored = marks(0)
echo([]); await settle()
ok('6. sidecar deleted, page follows', restored === 2 && marks(0) === 0, 'before=' + restored, 'after=' + marks(0))

// A mark inside the fenced code block. One <pre> covers every line of it, so the
// note is stored against the block's first line while the host re-anchors it by
// searching the markdown and reports the line the quote is actually on. Mark the
// *second* content line: on the first the two numbers agree and the bug hides.
const docD = at(0).doc
const pre = docD.querySelector('pre')
const codeNode = (pre.querySelector('code') ?? pre).firstChild
const from = codeNode.textContent.indexOf('第二行才是')
const rngD = docD.createRange()
rngD.setStart(codeNode, from); rngD.setEnd(codeNode, from + 10)
const selD = docD.defaultView.getSelection(); selD.removeAllRanges(); selD.addRange(rngD)
docD.dispatchEvent(new docD.defaultView.MouseEvent('mouseup', { bubbles: true }))
document.querySelector('#mark-bar .swatch[data-color="blue"]').click()
await settle()
const inCode = sent().notes.at(-1)
// Posted directly rather than through echo(), which forces every note to
// status 'ok' at its own startLine — the one shape that cannot show this. What
// the real host sends for this note is 'moved' at line 8: the line the quote
// sits on, inside the block whose own line is 6. The draw on marking cannot
// show it either, because that runs before the host has said anything.
window.postMessage({ type: 'notes', warnings: [], path: 'notes.md.notes.json',
    notes: [{ ...inCode, status: 'moved', line: 8 }] }, '*'); await settle()
ok('9. a mark inside a code block survives the host round trip',
    marks(0) === 1 && inCode.range.startLine === 6,
    'drawn=' + marks(0), 'stored=' + inCode.range.startLine, 'host said 8')
echo([]); await settle()

// Chapter 3, reached through the toolbar dropdown — a section the book did not
// open on, so nothing had drawn it before. Note the dropdown, not
// view.goTo(book.sections[i].href): sections carry an id, not an href.
const toc = document.getElementById('toc')
toc.value = '2'; toc.dispatchEvent(new Event('change'))
await settle(); await settle()
const rC = mark(2, 1, 2, 10, 'pink'); await settle()
const drew = marks(2)
clickMark(2, rC); await settle(); await del()
ok('7. same in a chapter paged to', drew === 1 && marks(2) === 0, 'before=' + drew, 'after=' + marks(2))

// Everything from the note list, on a single note — the panel-only path.
mark(2, 1, 2, 10, 'yellow'); await settle()
document.getElementById('notes-toggle').click(); await settle()
const row = document.querySelector('#notes-list .note-item')
const btns = [...row.querySelectorAll('.actions button')].map(b => b.textContent).join('/')
row.querySelector('.actions button').click(); await settle()
const opened = editorOpen()
document.getElementById('note-cancel').click(); await settle()
;[...document.querySelectorAll('#notes-list .note-item .actions button')]
    .find(b => b.textContent === '刪除').click()
await settle()
ok('8. edit and delete from the list', btns === '編輯/刪除' && opened && marks(2) === 0 && sent().notes.length === 0,
    btns, 'editor=' + opened, 'drawn=' + marks(2))

// Back to chapter 1, then click a note that lives in chapter 3. Nothing has
// rendered that section, so the note has no CFI — which is the whole point: a
// CFI is assigned by drawSection, and drawSection only runs for sections
// foliate has loaded. Clicking used to fall through to the editor.
toc.value = '0'; toc.dispatchEvent(new Event('change'))
await settle(); await settle()
const far = { id: 'far', color: 'blue', chapter: '第三章', quote: '在這裡標記',
    note: '', range: { startLine: 21, startCol: 0, endLine: 21, endCol: 5 } }
echo([far]); await settle()
const fromSection = document.getElementById('progress').textContent
document.querySelector('#notes-list .note-item').click()
await settle(); await settle(); await settle()
const landed = document.getElementById('progress').textContent
// Not marks(): when the jump does not happen the section was never rendered and
// at(2) is undefined, and a throw here would take the next assertion with it.
const drawnIn = i => at(i)?.overlayer?.element?.children?.length ?? 0
ok('10. jump to a note in a chapter that was never rendered',
    drawnIn(2) === 1 && landed !== fromSection && !editorOpen(),
    fromSection, '->', landed, 'drawn=' + drawnIn(2), 'editor=' + editorOpen())

// The selected mark carries a hard edge, and only the selected one. Computed
// style, not the attribute — an attribute that reads back correctly while
// nothing is painted is exactly how the black-fill bug survived nine of these.
const edgeOf = i => {
    const g = at(i)?.overlayer?.element?.querySelector('g')
    return g ? frame.contentWindow.getComputedStyle(g).stroke : 'none'
}
const selectedEdge = edgeOf(2)
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await settle()
ok('11. the edge is on the selected mark, and goes with it',
    selectedEdge === 'rgb(0, 0, 0)' && edgeOf(2) === 'none' && drawnIn(2) === 1,
    'selected=' + selectedEdge, 'after Escape=' + edgeOf(2), 'still drawn=' + drawnIn(2))

// A mark across two table cells. Only a browser can say what text a selection
// across <td>s actually yields, and that string is what the host has to find in
// a line full of pipes — so this pins the input test/notes.test.ts assumes.
// Whether the host then finds it is that file's job, not this one's.
echo([]); await settle()
const docT = at(2).doc
const cells = [...docT.querySelectorAll('td')]
const rT = docT.createRange()
rT.setStart(cells[1].firstChild, 0); rT.setEnd(cells[2].firstChild, 5)
const selT = docT.defaultView.getSelection(); selT.removeAllRanges(); selT.addRange(rT)
docT.dispatchEvent(new docT.defaultView.MouseEvent('mouseup', { bubbles: true }))
document.querySelector('#mark-bar .swatch[data-color="purple"]').click()
await settle()
const cellNote = sent().notes.at(-1)
ok('12. a mark across table cells keeps the cells apart, and draws',
    /78 KB\s+0\.2 m/.test(cellNote.quote) && drawnIn(2) === 1 && cellNote.range.startLine === 23,
    JSON.stringify(cellNote.quote), 'drawn=' + drawnIn(2), 'block line=' + cellNote.range.startLine)

// And a stale note is not drawn at all — worth pinning, because a mark reported
// stale while its highlight is still on the page is exactly what a leftover
// browser selection looks like, and the two are easy to confuse in a screenshot.
window.postMessage({ type: 'notes', warnings: [], path: 'notes.md.notes.json',
    notes: [{ ...cellNote, status: 'stale', line: cellNote.range.startLine }] }, '*')
await settle()
ok('13. a stale note paints nothing', drawnIn(2) === 0, 'drawn=' + drawnIn(2))
`)
