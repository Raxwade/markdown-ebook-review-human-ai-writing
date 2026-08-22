import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BOOK_READER_STATES_KEY,
    DEFAULT_READER_PROFILE,
    MAX_BOOK_READER_STATES,
    READER_PROFILE_KEY,
    ReaderStateStore,
    manuscriptId,
    normalizeBookReaderState,
    normalizeReaderProfile,
    readerProfileStyles,
    type MementoLike,
} from '../src/reader-state'

class MemoryMemento implements MementoLike {
    readonly values = new Map<string, unknown>()
    readonly updates: { key: string; value: unknown }[] = []

    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined
    }

    update(key: string, value: unknown): Promise<void> {
        const copy = structuredClone(value)
        this.values.set(key, copy)
        this.updates.push({ key, value: copy })
        return Promise.resolve()
    }
}

test('reader profile validates enums, clamps numbers, and enforces font-size steps', () => {
    const low = normalizeReaderProfile({
        fontSize: 61,
        fontFamily: 'comic-sans',
        bold: 'yes',
        lineHeight: 0,
        characterSpacing: -2,
        wordSpacing: -1,
        pageMargin: 0,
        textAlign: 'center',
        columns: 'triple',
        readingMode: 'horizontal',
        theme: 'neon',
    })
    assert.deepEqual(low, {
        ...DEFAULT_READER_PROFILE,
        fontSize: 80,
        lineHeight: 1.2,
        characterSpacing: -0.02,
        pageMargin: 16,
    })

    const high = normalizeReaderProfile({
        fontSize: 197,
        fontFamily: 'monospace',
        bold: true,
        lineHeight: 9,
        characterSpacing: 9,
        wordSpacing: 9,
        pageMargin: 999,
        textAlign: 'justify',
        columns: 'double',
        readingMode: 'scrolled',
        theme: 'dark',
    })
    assert.deepEqual(high, {
        version: 1,
        fontSize: 200,
        fontFamily: 'monospace',
        bold: true,
        lineHeight: 2,
        characterSpacing: 0.12,
        wordSpacing: 0.3,
        pageMargin: 96,
        textAlign: 'justify',
        columns: 'double',
        readingMode: 'scrolled',
        theme: 'dark',
    })
    assert.equal(normalizeReaderProfile({ fontSize: 86 }).fontSize, 90)
})

test('unversioned reader profile fields migrate to v1', () => {
    const profile = normalizeReaderProfile({
        fontScale: 130,
        font: 'serif',
        boldText: true,
        lineSpacing: 1.8,
        letterSpacing: 0.04,
        margin: 64,
        alignment: 'left',
        layout: 'single',
        flow: 'scrolled',
        colorTheme: 'sepia',
    })
    assert.equal(profile.version, 1)
    assert.equal(profile.fontSize, 130)
    assert.equal(profile.fontFamily, 'serif')
    assert.equal(profile.bold, true)
    assert.equal(profile.lineHeight, 1.8)
    assert.equal(profile.characterSpacing, 0.04)
    assert.equal(profile.pageMargin, 64)
    assert.equal(profile.textAlign, 'left')
    assert.equal(profile.columns, 'single')
    assert.equal(profile.readingMode, 'scrolled')
    assert.equal(profile.theme, 'sepia')
})

test('publisher defaults generate no CSS overrides', () => {
    assert.equal(readerProfileStyles(DEFAULT_READER_PROFILE), '')
    assert.equal(readerProfileStyles(undefined), '')
})

test('reader CSS covers fonts, weight, spacing, alignment, and themes', () => {
    for (const [font, marker] of [
        ['serif', 'ui-serif'],
        ['sans-serif', 'ui-sans-serif'],
        ['monospace', 'ui-monospace'],
    ] as const) {
        assert.match(readerProfileStyles({ fontFamily: font }), new RegExp(marker))
    }

    const typography = readerProfileStyles({
        fontSize: 140,
        bold: true,
        lineHeight: 1.9,
        characterSpacing: 0.07,
        wordSpacing: 0.2,
        textAlign: 'justify',
    })
    assert.match(typography, /font-size: 140%/)
    assert.match(typography, /font-weight: 600/)
    assert.match(typography, /line-height: 1\.9/)
    assert.match(typography, /letter-spacing: 0\.07em/)
    assert.match(typography, /word-spacing: 0\.2em/)
    assert.match(typography, /text-align: justify/)

    for (const theme of ['system', 'light', 'paper', 'sepia', 'gray', 'dark'] as const) {
        const css = readerProfileStyles({ theme })
        assert.match(css, /--theme-bg-color:/, `${theme} has no Foliate background variable`)
        assert.match(css, /background-color:/, `${theme} has no page background`)
        assert.match(css, /color:/, `${theme} has no foreground`)
    }
})

test('book state validates bookmarks and migrates percentage fallback', () => {
    const now = Date.parse('2026-08-16T00:00:00Z')
    const state = normalizeBookReaderState({
        lastCfi: 'epubcfi(/6/2)',
        percentage: 42,
        bookmarks: [
            { id: 'one', cfi: 'epubcfi(/6/2)', fraction: 3, chapter: 'A', created: 'bad' },
            { id: 'one', fraction: 0.2 },
            { id: '', fraction: 0.3 },
        ],
    }, now)
    assert.equal(state.version, 1)
    assert.equal(state.cfi, 'epubcfi(/6/2)')
    assert.equal(state.fraction, 0.42)
    assert.equal(state.bookmarks.length, 1)
    assert.equal(state.bookmarks[0]?.fraction, 1)
    assert.equal(state.bookmarks[0]?.created, '2026-08-16T00:00:00.000Z')
})

test('reader store persists a global profile and isolated book states', async () => {
    const memory = new MemoryMemento()
    let now = 1000
    const store = new ReaderStateStore(memory, () => ++now)
    await store.saveProfile({ fontSize: 130, theme: 'paper' })
    assert.equal((memory.values.get(READER_PROFILE_KEY) as any).fontSize, 130)

    const a = manuscriptId('file:///workspace/a.md')
    const b = manuscriptId('file:///workspace/b.md')
    store.stageBook(a, { cfi: 'epubcfi(/6/2)', fraction: 0.25, bookmarks: [] })
    store.stageBook(b, { cfi: 'epubcfi(/6/8)', fraction: 0.75, bookmarks: [] })
    await store.persistBooks()

    const reopened = new ReaderStateStore(memory, () => ++now)
    assert.equal(reopened.getProfile().theme, 'paper')
    assert.equal(reopened.getBook(a).fraction, 0.25)
    assert.equal(reopened.getBook(b).fraction, 0.75)
    assert.notEqual(reopened.getBook(a).cfi, reopened.getBook(b).cfi)
    assert.ok(memory.updates.some(update => update.key === BOOK_READER_STATES_KEY))
})

test('reader store prunes least-recently-used books to 100 entries', async () => {
    const memory = new MemoryMemento()
    let now = 0
    const store = new ReaderStateStore(memory, () => ++now)
    const ids = Array.from({ length: MAX_BOOK_READER_STATES + 1 }, (_, index) =>
        manuscriptId(`file:///book-${index}.md`))
    for (const [index, id] of ids.entries()) {
        store.stageBook(id, { fraction: index / ids.length })
    }
    await store.persistBooks()

    const books = store.snapshotBooks()
    assert.equal(Object.keys(books).length, MAX_BOOK_READER_STATES)
    assert.equal(books[ids[0]!], undefined, 'oldest entry was not pruned')
    assert.ok(books[ids.at(-1)!], 'newest entry was pruned')
})

test('manuscript ids are stable hashes of canonical URIs', () => {
    const a = manuscriptId('file:///workspace/book.md')
    assert.equal(a, manuscriptId('file:///workspace/book.md'))
    assert.notEqual(a, manuscriptId('file:///workspace/other.md'))
    assert.match(a, /^[a-f0-9]{64}$/)
})
