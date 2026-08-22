import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    elideQuote, quoteEnds, isElided, parseNotes, serializeNotes, anchorNote,
    ELIDE_OVER, type Note,
} from '../src/notes'

const noteAt = (over: Partial<Note> = {}): Note => ({
    id: 'n1',
    color: 'yellow',
    chapter: '序章',
    range: { startLine: 10, startCol: 0, endLine: 10, endCol: 8 },
    quote: '兩者兼備，才是能喝進腦子裡的東西。',
    note: '這句是全書論點。',
    created: '2026-08-04T01:20:00Z',
    ...over,
})

test('a short mark is stored whole', () => {
    const short = '兩者兼備，才是能喝進腦子裡的東西。'
    const out = elideQuote(short)
    assert.equal(out.quote, short)
    assert.equal(out.quoteLength, undefined)
    assert.equal(isElided(out.quote), false)
})

test('a long mark keeps its head and tail and records the real length', () => {
    // Marking a whole paragraph must not copy the book into the sidecar.
    const long = '甲'.repeat(200) + '乙'.repeat(212)
    const out = elideQuote(long)
    assert.ok(isElided(out.quote), out.quote)
    assert.equal(out.quoteLength, 412)
    assert.ok(out.quote.length < ELIDE_OVER + 20, `still too long: ${out.quote.length}`)
    assert.ok(out.quote.startsWith('甲甲甲'))
    assert.ok(out.quote.endsWith('乙乙乙'))

    const { head, tail } = quoteEnds(out.quote)
    assert.ok(head.startsWith('甲') && !head.includes('乙'))
    assert.ok(tail.startsWith('乙') && !tail.includes('甲'))
})

test('quoteEnds on an un-elided quote returns the whole thing twice', () => {
    const { head, tail } = quoteEnds('短句')
    assert.equal(head, '短句')
    assert.equal(tail, '短句')
})

test('marks round-trip through the file', () => {
    const file = { version: 1 as const, source: 'book.md', notes: [noteAt()] }
    const { file: back, warnings } = parseNotes(serializeNotes(file), 'book.md')
    assert.deepEqual(warnings, [])
    assert.deepEqual(back, file)
})

test('notes are written in book order so diffs stay small', () => {
    const file = {
        version: 1 as const,
        source: 'book.md',
        notes: [
            noteAt({ id: 'c', range: { startLine: 90, startCol: 0, endLine: 90, endCol: 1 } }),
            noteAt({ id: 'a', range: { startLine: 10, startCol: 5, endLine: 10, endCol: 9 } }),
            noteAt({ id: 'b', range: { startLine: 10, startCol: 0, endLine: 10, endCol: 4 } }),
        ],
    }
    const ids = parseNotes(serializeNotes(file), 'book.md').file.notes.map(n => n.id)
    assert.deepEqual(ids, ['b', 'a', 'c'])
})

test('a broken entry drops itself instead of taking the file down', () => {
    // Hand-editing this file is expected, so one bad note must not cost the rest.
    const json = JSON.stringify({
        version: 1,
        source: 'book.md',
        notes: [
            noteAt({ id: 'good' }),
            { id: 'no-range', color: 'yellow', quote: 'x', note: '' },
            'not even an object',
            noteAt({ id: 'also-good', range: { startLine: 2, startCol: 0, endLine: 2, endCol: 3 } }),
        ],
    })
    // parseNotes stays faithful to file order; sorting is serializeNotes's job.
    const { file, warnings } = parseNotes(json, 'book.md')
    assert.deepEqual(file.notes.map(n => n.id), ['good', 'also-good'])
    assert.equal(warnings.length, 2, warnings.join(' / '))
})

test('malformed JSON reports itself and yields an empty file', () => {
    const { file, warnings } = parseNotes('{ this is not json', 'book.md')
    assert.deepEqual(file.notes, [])
    assert.equal(file.source, 'book.md')
    assert.match(warnings[0]!, /JSON/)
})

test('an unknown colour falls back rather than dropping the note', () => {
    const json = JSON.stringify({ notes: [{ ...noteAt(), color: 'chartreuse' }] })
    assert.equal(parseNotes(json, 'book.md').file.notes[0]!.color, 'yellow')
})

test('duplicate ids are made unique so deleting one cannot delete two', () => {
    const json = JSON.stringify({
        notes: [
            noteAt({ id: 'dup' }),
            noteAt({ id: 'dup', range: { startLine: 40, startCol: 0, endLine: 40, endCol: 3 } }),
        ],
    })
    const ids = parseNotes(json, 'book.md').file.notes.map(n => n.id)
    assert.equal(new Set(ids).size, 2, ids.join(', '))
})

// --- re-anchoring ---------------------------------------------------------

const DOC = [
    '# 序章',                                   // 0
    '',                                        // 1
    '一段合格的範例知識。',                         // 2
    '',                                        // 3
    '兩者兼備，才是能喝進腦子裡的東西。',              // 4
    '',                                        // 5
    '本書每一章都同時長著這兩隻手。',                 // 6
].join('\n')

test('a mark still on its line anchors clean', () => {
    const a = anchorNote(noteAt({ range: { startLine: 4, startCol: 0, endLine: 4, endCol: 17 } }), DOC)
    assert.equal(a.status, 'ok')
    assert.equal(a.line, 4)
})

test('a mark shifted by an edit above it is found and reported moved', () => {
    // Inserting two lines at the top is the ordinary case while revising.
    const shifted = '新增一行\n\n' + DOC
    const a = anchorNote(noteAt({ range: { startLine: 4, startCol: 0, endLine: 4, endCol: 17 } }), shifted)
    assert.equal(a.status, 'moved')
    assert.equal(a.line, 6)
    assert.equal(shifted.split('\n')[a.line], '兩者兼備，才是能喝進腦子裡的東西。')
})

test('a mark whose sentence was rewritten is kept and flagged stale', () => {
    // The user chose keep-and-flag: the comment is the expensive part, and an
    // unrelated edit must not silently bin it.
    const rewritten = DOC.replace('兩者兼備，才是能喝進腦子裡的東西。', '完全不同的句子。')
    const a = anchorNote(noteAt({ range: { startLine: 4, startCol: 0, endLine: 4, endCol: 17 } }), rewritten)
    assert.equal(a.status, 'stale')
    assert.equal(a.note.note, '這句是全書論點。', 'the comment must survive')
})

test('re-anchoring picks the nearest of several identical sentences', () => {
    const repeated = ['重複的句子。', '', 'x', '', '重複的句子。', '', 'y', '', '重複的句子。'].join('\n')
    const at = (line: number) => anchorNote(
        noteAt({ quote: '重複的句子。', range: { startLine: line, startCol: 0, endLine: line, endCol: 6 } }),
        repeated).line
    assert.equal(at(4), 4, 'an exact hit wins outright')
    assert.equal(at(5), 4, 'one line below its mark should snap back up')
    assert.equal(at(7), 8, 'one line above the third should snap down')
})

test('an elided long mark re-anchors on its head', () => {
    const long = '甲'.repeat(200) + '乙'.repeat(212)
    const doc = ['前言', '', long, '', '後記'].join('\n')
    const { quote, quoteLength } = elideQuote(long)
    const a = anchorNote(
        noteAt({ quote, quoteLength, range: { startLine: 2, startCol: 0, endLine: 2, endCol: 412 } }),
        doc)
    assert.equal(a.status, 'ok')
    assert.equal(a.line, 2)
})

test('an empty quote cannot anchor and says so', () => {
    assert.equal(anchorNote(noteAt({ quote: '' }), DOC).status, 'stale')
})

// A mark covering two paragraphs matches no single line, so it goes down the
// span path. That path used to hand back the *recorded* line while calling the
// note 'moved' — the one line the text is demonstrably not wholly on — and the
// webview then anchored there and, being a cross-block mark, painted the whole
// of whatever block was sitting at that position.
const SPANNING = '兩者兼備，才是能喝進腦子裡的東西。 本書每一章都同時長著這兩隻手。'

test('a mark spanning a line break anchors on the line it starts on', () => {
    const a = anchorNote(
        noteAt({ quote: SPANNING, range: { startLine: 4, startCol: 0, endLine: 6, endCol: 15 } }),
        DOC)
    assert.equal(a.status, 'ok')
    assert.equal(a.line, 4)
})

test('a spanning mark shifted by an edit above it reports where it actually is', () => {
    const shifted = '新增一行\n\n' + DOC
    const a = anchorNote(
        noteAt({ quote: SPANNING, range: { startLine: 4, startCol: 0, endLine: 6, endCol: 15 } }),
        shifted)
    assert.equal(a.status, 'moved')
    assert.equal(a.line, 6, 'must be the new line, not the recorded one')
    assert.equal(shifted.split('\n')[a.line], '兩者兼備，才是能喝進腦子裡的東西。')
})

test('a mark across five short paragraphs anchors, unedited', () => {
    // Nine lines once the blank line between each paragraph is counted, which a
    // fixed eight-line window could not reach: the note went stale against the
    // document it was made in. The window is bounded by the quote's length now.
    // (It still paints on the first block only — a cross-block mark is clamped
    // when drawn. This is about the note keeping its place, not its coverage.)
    const paras = ['甲段。', '乙段。', '丙段。', '丁段。', '戊段。']
    const doc = ['# 標題', '', ...paras.flatMap(p => [p, '']).slice(0, -1)].join('\n')
    const a = anchorNote(
        noteAt({ quote: paras.join(' '), range: { startLine: 2, startCol: 0, endLine: 10, endCol: 3 } }),
        doc)
    assert.equal(a.status, 'ok')
    assert.equal(a.line, 2)
})

test('a line above the mark does not claim it once its window reaches the text', () => {
    // Every earlier line's window eventually contains the quote. Only the line
    // the match *begins* on may claim it, or the note is reported lines above
    // where its text actually is — and the webview then anchors there.
    const doc = ['開頭一句。', '', '被標記的第一句。', '被標記的第二句。'].join('\n')
    const a = anchorNote(
        noteAt({ quote: '被標記的第一句。 被標記的第二句。',
                 range: { startLine: 2, startCol: 0, endLine: 3, endCol: 8 } }),
        doc)
    assert.equal(a.line, 2, 'not line 0, whose window also contains the quote')
    assert.equal(a.status, 'ok')
})

test('a spanning mark whose text is gone is still stale', () => {
    const rewritten = DOC.replace('本書每一章都同時長著這兩隻手。', '完全不同的結尾。')
    const a = anchorNote(
        noteAt({ quote: SPANNING, range: { startLine: 4, startCol: 0, endLine: 6, endCol: 15 } }),
        rewritten)
    assert.equal(a.status, 'stale')
})

// A quote is rendered text and the document is markdown source. Where the syntax
// markdown-it removes sits *between* two pieces of the marked text, the quote is
// not a substring of the source at all — and the note came back 找不到原句 with
// its highlight sitting in the book, which is the worst of both answers.
const TABLE = [
    '# 實測',                                                        // 0
    '',                                                             // 1
    '| 稿件 | 大小 | 章數 | 切章 |',                                   // 2
    '|---|---|---|---|',                                            // 3
    '| `short-sample.md` | 78 KB | 53 | 0.2 ms |',                   // 4
    '| `long-sample.md` | 321 KB | 62 | 1.7 ms |',                   // 5
].join('\n')

test('a mark across table cells anchors, pipes and all', () => {
    // Exactly what the panel produced: the cells' text, joined by the whitespace
    // between the <td>s. The pipes never appear in it.
    const a = anchorNote(
        noteAt({ quote: '321 KB 62 1.7 ms', range: { startLine: 5, startCol: 0, endLine: 5, endCol: 16 } }),
        TABLE)
    assert.equal(a.status, 'ok')
    assert.equal(a.line, 5)
})

test('a mark across an emphasised word in the middle anchors', () => {
    // `**兩者兼備**，才是` renders as `兩者兼備，才是`, and the asterisks are in
    // the middle of it — so the rendered text is not a substring of the source.
    const doc = ['前言', '', '**兩者兼備**，才是能喝進腦子裡的東西。'].join('\n')
    const a = anchorNote(
        noteAt({ quote: '兩者兼備，才是能喝', range: { startLine: 2, startCol: 0, endLine: 2, endCol: 9 } }),
        doc)
    assert.equal(a.status, 'ok')
    assert.equal(a.line, 2)
})

test('a mark running through a link keeps the label and drops the target', () => {
    const doc = ['前言', '', 'see [the docs](https://example.com/x) for more'].join('\n')
    const a = anchorNote(
        noteAt({ quote: 'see the docs for more', range: { startLine: 2, startCol: 0, endLine: 2, endCol: 21 } }),
        doc)
    assert.equal(a.status, 'ok')
})

test('looser matching does not resurrect a quote that is really gone', () => {
    // The whole point of 'stale' is that an unrelated edit must not silently
    // keep a mark alive somewhere else, so the tolerance has to stop short of
    // matching anything at all.
    const a = anchorNote(
        noteAt({ quote: '完全不存在的句子', range: { startLine: 5, startCol: 0, endLine: 5, endCol: 8 } }),
        TABLE)
    assert.equal(a.status, 'stale')
})

test('a table\'s delimiter row cannot claim a mark', () => {
    // `|---|---|` reduces to nothing once the syntax is stripped. A line that is
    // only syntax must not be a candidate, or the span search would start there.
    const a = anchorNote(
        noteAt({ quote: '稿件 大小 章數', range: { startLine: 2, startCol: 0, endLine: 2, endCol: 8 } }),
        TABLE)
    assert.equal(a.line, 2)
    assert.equal(a.status, 'ok')
})

test('a same-line range ending before it starts is rejected, not silently undrawn', () => {
    // Hand-edited files are expected here. The DOM collapses such a range and
    // the webview drops it as undrawable, so without this the note sits in the
    // list looking healthy and never appears in the book.
    const json = JSON.stringify({
        notes: [noteAt({ range: { startLine: 4, startCol: 17, endLine: 4, endCol: 2 } })],
    })
    const { file, warnings } = parseNotes(json, 'book.md')
    assert.equal(file.notes.length, 0)
    assert.match(warnings.join('\n'), /range/)
})
