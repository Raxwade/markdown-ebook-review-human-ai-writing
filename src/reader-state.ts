import { createHash } from 'node:crypto'

export const READER_PROFILE_VERSION = 1 as const
export const BOOK_READER_STATE_VERSION = 1 as const
export const READER_PROFILE_KEY = 'mdepub.readerProfile'
export const BOOK_READER_STATES_KEY = 'mdepub.bookReaderStates'
export const MAX_BOOK_READER_STATES = 100

export type ReaderFont = 'publisher' | 'serif' | 'sans-serif' | 'monospace'
export type ReaderAlignment = 'publisher' | 'left' | 'justify'
export type ReaderColumns = 'auto' | 'single' | 'double'
export type ReaderMode = 'paginated' | 'scrolled'
export type ReaderTheme = 'publisher' | 'system' | 'light' | 'paper' | 'sepia' | 'gray' | 'dark'

export interface ReaderProfile {
    version: typeof READER_PROFILE_VERSION
    fontSize: number
    fontFamily: ReaderFont
    bold: boolean
    lineHeight: number
    characterSpacing: number
    wordSpacing: number
    pageMargin: number
    textAlign: ReaderAlignment
    columns: ReaderColumns
    readingMode: ReaderMode
    theme: ReaderTheme
}

/**
 * The defaults deliberately generate no reader stylesheet and no paginator
 * attributes. Reset therefore restores the EPUB's own CSS rather than replacing
 * it with values that merely happen to look similar today.
 */
export const DEFAULT_READER_PROFILE: Readonly<ReaderProfile> = Object.freeze({
    version: READER_PROFILE_VERSION,
    fontSize: 100,
    fontFamily: 'publisher',
    bold: false,
    lineHeight: 1.5,
    characterSpacing: 0,
    wordSpacing: 0,
    pageMargin: 48,
    textAlign: 'publisher',
    columns: 'auto',
    readingMode: 'paginated',
    theme: 'publisher',
})

export interface ReaderBookmark {
    id: string
    cfi: string | null
    fraction: number
    chapter: string
    created: string
}

export interface BookReaderState {
    version: typeof BOOK_READER_STATE_VERSION
    cfi: string | null
    fraction: number
    bookmarks: ReaderBookmark[]
    lastUsed: number
}

interface StoredBookReaderStates {
    version: typeof BOOK_READER_STATE_VERSION
    books: Record<string, BookReaderState>
}

export interface MementoLike {
    get<T>(key: string, defaultValue?: T): T | undefined
    update(key: string, value: unknown): Thenable<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const numberOr = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value))

const rounded = (value: number, places = 2): number => {
    const scale = 10 ** places
    return Math.round((value + Number.EPSILON) * scale) / scale
}

const enumOr = <T extends string>(
    value: unknown,
    values: readonly T[],
    fallback: T,
): T => typeof value === 'string' && values.includes(value as T) ? value as T : fallback

const FONTS = ['publisher', 'serif', 'sans-serif', 'monospace'] as const
const ALIGNMENTS = ['publisher', 'left', 'justify'] as const
const COLUMNS = ['auto', 'single', 'double'] as const
const MODES = ['paginated', 'scrolled'] as const
const THEMES = ['publisher', 'system', 'light', 'paper', 'sepia', 'gray', 'dark'] as const

/** Validate current profiles and migrate the unversioned prototype field names. */
export function normalizeReaderProfile(value: unknown): ReaderProfile {
    const source = isRecord(value) ? value : {}

    // These aliases make the v1 reader tolerant of the unversioned prototype
    // used by early development builds. Unknown values still fall back safely.
    const fontSize = source.fontSize ?? source.fontScale
    const fontFamily = source.fontFamily ?? source.font
    const bold = source.bold ?? source.boldText
    const lineHeight = source.lineHeight ?? source.lineSpacing
    const characterSpacing = source.characterSpacing ?? source.letterSpacing
    const pageMargin = source.pageMargin ?? source.margin
    const textAlign = source.textAlign ?? source.alignment
    const columns = source.columns ?? source.layout
    const readingMode = source.readingMode ?? source.flow
    const theme = source.theme ?? source.colorTheme

    // Font size is the one control with a specified discrete scale: 80–200 in
    // ten-percent steps. The other sliders keep their documented precision.
    const clampedFont = clamp(numberOr(fontSize, DEFAULT_READER_PROFILE.fontSize), 80, 200)

    return {
        version: READER_PROFILE_VERSION,
        fontSize: Math.round(clampedFont / 10) * 10,
        fontFamily: enumOr(fontFamily, FONTS, DEFAULT_READER_PROFILE.fontFamily),
        bold: typeof bold === 'boolean' ? bold : DEFAULT_READER_PROFILE.bold,
        lineHeight: rounded(clamp(
            numberOr(lineHeight, DEFAULT_READER_PROFILE.lineHeight), 1.2, 2), 1),
        characterSpacing: rounded(clamp(
            numberOr(characterSpacing, DEFAULT_READER_PROFILE.characterSpacing), -0.02, 0.12)),
        wordSpacing: rounded(clamp(
            numberOr(source.wordSpacing, DEFAULT_READER_PROFILE.wordSpacing), 0, 0.3)),
        pageMargin: Math.round(clamp(
            numberOr(pageMargin, DEFAULT_READER_PROFILE.pageMargin), 16, 96)),
        textAlign: enumOr(textAlign, ALIGNMENTS, DEFAULT_READER_PROFILE.textAlign),
        columns: enumOr(columns, COLUMNS, DEFAULT_READER_PROFILE.columns),
        readingMode: enumOr(readingMode, MODES, DEFAULT_READER_PROFILE.readingMode),
        theme: enumOr(theme, THEMES, DEFAULT_READER_PROFILE.theme),
    }
}

const FONT_STACKS: Record<Exclude<ReaderFont, 'publisher'>, string> = {
    serif: 'ui-serif, Georgia, "Times New Roman", "Noto Serif CJK TC", serif',
    'sans-serif': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK TC", sans-serif',
    monospace: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", "Noto Sans Mono CJK TC", monospace',
}

const STATIC_THEMES: Record<Exclude<ReaderTheme, 'publisher' | 'system'>, { bg: string; fg: string; link: string }> = {
    light: { bg: '#ffffff', fg: '#202124', link: '#0b57d0' },
    paper: { bg: '#f7f3e8', fg: '#302d27', link: '#735c20' },
    sepia: { bg: '#f4ecd8', fg: '#493b2a', link: '#7a4f22' },
    gray: { bg: '#dedede', fg: '#252525', link: '#315f85' },
    dark: { bg: '#171717', fg: '#dedede', link: '#8ab4f8' },
}

/** CSS passed only to Foliate's renderer; it is never included in an export. */
export function readerProfileStyles(value: unknown): string {
    const profile = normalizeReaderProfile(value)
    const rules: string[] = []

    if (profile.fontSize !== DEFAULT_READER_PROFILE.fontSize)
        rules.push(`html { font-size: ${profile.fontSize}% !important; }`)

    if (profile.fontFamily !== 'publisher') {
        const stack = FONT_STACKS[profile.fontFamily]
        rules.push(`html, body, body * { font-family: ${stack} !important; }`)
    }

    if (profile.bold)
        rules.push('body, p, li, blockquote, dd, dt, td, th { font-weight: 600 !important; }')

    if (profile.lineHeight !== DEFAULT_READER_PROFILE.lineHeight)
        rules.push(`body, p, li, blockquote, dd, dt, td, th { line-height: ${profile.lineHeight} !important; }`)

    if (profile.characterSpacing !== DEFAULT_READER_PROFILE.characterSpacing)
        rules.push(`body { letter-spacing: ${profile.characterSpacing}em !important; }`)

    if (profile.wordSpacing !== DEFAULT_READER_PROFILE.wordSpacing)
        rules.push(`body { word-spacing: ${profile.wordSpacing}em !important; }`)

    if (profile.textAlign !== 'publisher')
        rules.push(`body, p, li, blockquote, dd, dt { text-align: ${profile.textAlign} !important; }`)

    if (profile.theme === 'system') {
        rules.push(':root { color-scheme: light dark; --theme-bg-color: Canvas; }')
        rules.push('html, body { background-color: Canvas !important; color: CanvasText !important; }')
        rules.push('a:link { color: LinkText !important; } a:visited { color: VisitedText !important; }')
    } else if (profile.theme !== 'publisher') {
        const theme = STATIC_THEMES[profile.theme]
        const scheme = profile.theme === 'dark' ? 'dark' : 'light'
        rules.push(`:root { color-scheme: ${scheme}; --theme-bg-color: ${theme.bg}; }`)
        rules.push(`html, body { background-color: ${theme.bg} !important; color: ${theme.fg} !important; }`)
        rules.push(`a:link, a:visited { color: ${theme.link} !important; }`)
    }

    return rules.join('\n')
}

function normalizeCreated(value: unknown, now: number): string {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value
    return new Date(now).toISOString()
}

function normalizeBookmark(value: unknown, now: number): ReaderBookmark | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null
    const cfi = typeof value.cfi === 'string' && value.cfi ? value.cfi : null
    return {
        id: value.id,
        cfi,
        fraction: rounded(clamp(numberOr(value.fraction, 0), 0, 1), 6),
        chapter: typeof value.chapter === 'string' ? value.chapter : '',
        created: normalizeCreated(value.created, now),
    }
}

export function emptyBookReaderState(now = Date.now()): BookReaderState {
    return {
        version: BOOK_READER_STATE_VERSION,
        cfi: null,
        fraction: 0,
        bookmarks: [],
        lastUsed: now,
    }
}

/** Validate v1 state and migrate the prototype's `lastCfi`/`percentage` keys. */
export function normalizeBookReaderState(value: unknown, now = Date.now()): BookReaderState {
    const source = isRecord(value) ? value : {}
    const rawFraction = source.fraction ?? source.percentage
    const migratedFraction = typeof rawFraction === 'number' && rawFraction > 1
        ? rawFraction / 100
        : rawFraction
    const rawBookmarks = Array.isArray(source.bookmarks) ? source.bookmarks : []
    const bookmarks: ReaderBookmark[] = []
    const ids = new Set<string>()
    for (const raw of rawBookmarks) {
        const bookmark = normalizeBookmark(raw, now)
        if (!bookmark || ids.has(bookmark.id)) continue
        ids.add(bookmark.id)
        bookmarks.push(bookmark)
    }

    const cfiValue = source.cfi ?? source.lastCfi
    return {
        version: BOOK_READER_STATE_VERSION,
        cfi: typeof cfiValue === 'string' && cfiValue ? cfiValue : null,
        fraction: rounded(clamp(numberOr(migratedFraction, 0), 0, 1), 6),
        bookmarks,
        lastUsed: Math.max(0, numberOr(source.lastUsed, now)),
    }
}

/** Stable, non-reversible key; raw paths are not exposed in globalState keys. */
export function manuscriptId(canonicalUri: string): string {
    return createHash('sha256').update(canonicalUri).digest('hex')
}

function normalizeStoredBooks(value: unknown, now: number): Record<string, BookReaderState> {
    if (!isRecord(value)) return {}
    // The envelope is v1. Accepting a direct map makes unversioned development
    // data migratable without weakening validation of individual entries.
    const rawBooks = isRecord(value.books) ? value.books : value
    const books: Record<string, BookReaderState> = {}
    for (const [id, raw] of Object.entries(rawBooks)) {
        if (!/^[a-f0-9]{64}$/i.test(id)) continue
        books[id] = normalizeBookReaderState(raw, now)
    }
    return books
}

function pruneBooks(
    books: Record<string, BookReaderState>,
    limit = MAX_BOOK_READER_STATES,
): Record<string, BookReaderState> {
    const keep = Object.entries(books)
        .sort(([aId, a], [bId, b]) => b.lastUsed - a.lastUsed || aId.localeCompare(bId))
        .slice(0, Math.max(0, limit))
    return Object.fromEntries(keep)
}

/**
 * Cached globalState façade. Preview stages relocations here immediately and
 * controls when `persistBooks()` runs, which is what makes a 500 ms debounce
 * flushable on document switch and panel disposal.
 */
export class ReaderStateStore {
    private profile: ReaderProfile
    private books: Record<string, BookReaderState>

    constructor(
        private readonly state: MementoLike,
        private readonly clock: () => number = Date.now,
        private readonly bookLimit = MAX_BOOK_READER_STATES,
    ) {
        const now = this.clock()
        this.profile = normalizeReaderProfile(state.get(READER_PROFILE_KEY))
        this.books = pruneBooks(
            normalizeStoredBooks(state.get(BOOK_READER_STATES_KEY), now), bookLimit)
    }

    getProfile(): ReaderProfile {
        return { ...this.profile }
    }

    async saveProfile(value: unknown): Promise<ReaderProfile> {
        this.profile = normalizeReaderProfile(value)
        await this.state.update(READER_PROFILE_KEY, this.profile)
        return this.getProfile()
    }

    getBook(id: string): BookReaderState {
        return normalizeBookReaderState(this.books[id], this.clock())
    }

    stageBook(id: string, value: unknown): BookReaderState {
        const now = this.clock()
        const normalized = normalizeBookReaderState(value, now)
        normalized.lastUsed = now
        this.books[id] = normalized
        this.books = pruneBooks(this.books, this.bookLimit)
        return structuredClone(normalized)
    }

    touchBook(id: string): BookReaderState {
        return this.stageBook(id, this.books[id] ?? emptyBookReaderState(this.clock()))
    }

    async persistBooks(): Promise<void> {
        const payload: StoredBookReaderStates = {
            version: BOOK_READER_STATE_VERSION,
            books: structuredClone(this.books),
        }
        await this.state.update(BOOK_READER_STATES_KEY, payload)
    }

    /** Exposed for deterministic unit tests and diagnostics. */
    snapshotBooks(): Record<string, BookReaderState> {
        return structuredClone(this.books)
    }
}
