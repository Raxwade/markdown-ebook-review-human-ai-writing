// The annotation sidecar: `<book>.md.notes.json` (spec §10).
//
// Pure, like src/epub/*: strings in, objects out. extension.ts owns the file.
// That matters more here than elsewhere — this file is a contract with whatever
// reads it next (a person, Claude, Codex), so its shape has to be verifiable
// without a filesystem or an editor in the loop.

/** Highlight colours, mirroring what a phone e-reader offers. */
export const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const
export type Color = typeof COLORS[number]

export interface NoteRange {
    /** 0-based, and relative to the `.md` the user edits, not to a chapter. */
    startLine: number
    startCol: number
    endLine: number
    endCol: number
}

export interface Note {
    id: string
    color: Color
    /** Chapter title at the time of marking; for reading, not for anchoring. */
    chapter: string
    range: NoteRange
    /**
     * The marked text. Elided in the middle past ELIDE_OVER characters — see
     * elideQuote — in which case `quoteLength` carries the true length.
     */
    quote: string
    quoteLength?: number
    /** The reviewer's comment. May be empty: a bare highlight is a valid note. */
    note: string
    /** ISO 8601. */
    created: string
}

export interface NotesFile {
    version: 1
    /** Filename of the markdown this belongs to, for a reader opening it alone. */
    source: string
    notes: Note[]
}

/**
 * Longer marks are stored head + tail + count rather than whole.
 *
 * A review pass marks paragraphs, not just sentences, and copying them verbatim
 * would grow a second copy of the book inside the sidecar. Head and tail are
 * what re-anchoring matches on anyway, and they are enough for a reader to see
 * what was marked; `range` carries the exact position.
 */
export const ELIDE_OVER = 120
const KEEP_EACH = 45

export function elideQuote(text: string): Pick<Note, 'quote' | 'quoteLength'> {
    const clean = text.replace(/\s+/g, ' ').trim()
    const chars = [...clean]
    if (chars.length <= ELIDE_OVER) return { quote: clean }
    const head = chars.slice(0, KEEP_EACH).join('')
    const tail = chars.slice(-KEEP_EACH).join('')
    const hidden = chars.length - KEEP_EACH * 2
    return { quote: `${head} […${hidden}…] ${tail}`, quoteLength: chars.length }
}

// Accept the original Traditional Chinese marker so existing sidecars keep
// anchoring, while writing a language-neutral marker from now on.
const ELISION = /\s*(?:\[…\d+…\]|〔…\d+ 字…〕)\s*/

/** The head and tail of a quote, whether or not it was elided. */
export function quoteEnds(quote: string): { head: string; tail: string } {
    const parts = quote.split(ELISION)
    return parts.length === 2
        ? { head: parts[0]!, tail: parts[1]! }
        : { head: quote, tail: quote }
}

export const isElided = (quote: string): boolean => ELISION.test(quote)

// --- parsing -------------------------------------------------------------
// Hand-editing this file is expected — that is half the point of it being JSON
// next to the book — so a malformed entry drops itself and reports why, rather
// than throwing away the other notes with it.

const isColor = (v: unknown): v is Color => COLORS.includes(v as Color)

function parseRange(v: unknown): NoteRange | null {
    if (!v || typeof v !== 'object') return null
    const r = v as Record<string, unknown>
    const nums = ['startLine', 'startCol', 'endLine', 'endCol']
        .map(k => (typeof r[k] === 'number' && Number.isInteger(r[k]) && (r[k] as number) >= 0
            ? r[k] as number : null))
    if (nums.some(n => n === null)) return null
    const [startLine, startCol, endLine, endCol] = nums as number[]
    if (endLine! < startLine!) return null
    // An end before the start on the same line has to be rejected here, because
    // nothing downstream reports it: the DOM collapses such a range, the webview
    // drops it as undrawable, and the note sits in the list looking fine and
    // never appearing in the book. Hand-editing this file is expected, so a
    // typo in a column has to come back as a warning, not as a vanished mark.
    if (endLine === startLine && endCol! < startCol!) return null
    return { startLine: startLine!, startCol: startCol!, endLine: endLine!, endCol: endCol! }
}

export interface ParseResult {
    file: NotesFile
    warnings: string[]
}

type NotesLocale = 'en' | 'zh-TW'
type NotesWarning = 'invalidJson' | 'notObject' | 'missingNotes' | 'invalidEntry' | 'invalidRange'

const NOTES_WARNINGS: Record<NotesLocale, Record<NotesWarning, string>> = {
    en: {
        invalidJson: 'The notes file is not valid JSON and was ignored: {error}',
        notObject: 'The notes file is not an object and was ignored.',
        missingNotes: 'The notes file has no notes array; treating it as empty.',
        invalidEntry: 'Note {number} is not an object and was skipped.',
        invalidRange: 'Note {number} has an invalid range and was skipped.',
    },
    'zh-TW': {
        invalidJson: '註記檔不是合法的 JSON，已忽略：{error}',
        notObject: '註記檔不是物件，已忽略。',
        missingNotes: '註記檔缺少 notes 陣列，當成空的處理。',
        invalidEntry: '第 {number} 筆註記不是物件，已略過。',
        invalidRange: '第 {number} 筆註記的 range 不合法，已略過。',
    },
}

function notesWarning(
    locale: NotesLocale,
    key: NotesWarning,
    values: Record<string, unknown> = {},
): string {
    return NOTES_WARNINGS[locale][key].replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) =>
        Object.hasOwn(values, name) ? String(values[name]) : match)
}

export function parseNotes(json: string, source: string, locale: NotesLocale = 'en'): ParseResult {
    const warnings: string[] = []
    const empty: NotesFile = { version: 1, source, notes: [] }
    if (!json.trim()) return { file: empty, warnings }

    let raw: unknown
    try {
        raw = JSON.parse(json)
    } catch (err) {
        return {
            file: empty,
            warnings: [notesWarning(locale, 'invalidJson', { error: (err as Error).message })],
        }
    }
    if (!raw || typeof raw !== 'object') {
        return { file: empty, warnings: [notesWarning(locale, 'notObject')] }
    }

    const obj = raw as Record<string, unknown>
    const list = Array.isArray(obj.notes) ? obj.notes : []
    if (!Array.isArray(obj.notes)) warnings.push(notesWarning(locale, 'missingNotes'))

    const notes: Note[] = []
    const seen = new Set<string>()
    list.forEach((item, i) => {
        if (!item || typeof item !== 'object') {
            warnings.push(notesWarning(locale, 'invalidEntry', { number: i + 1 }))
            return
        }
        const n = item as Record<string, unknown>
        const range = parseRange(n.range)
        if (!range) {
            warnings.push(notesWarning(locale, 'invalidRange', { number: i + 1 }))
            return
        }
        // An id is what the panel uses to address a note; a duplicate would make
        // deleting one silently delete the other.
        const id = typeof n.id === 'string' && n.id && !seen.has(n.id) ? n.id : `n${i + 1}-${range.startLine}`
        seen.add(id)
        notes.push({
            id,
            color: isColor(n.color) ? n.color : 'yellow',
            chapter: typeof n.chapter === 'string' ? n.chapter : '',
            range,
            quote: typeof n.quote === 'string' ? n.quote : '',
            ...(typeof n.quoteLength === 'number' ? { quoteLength: n.quoteLength } : {}),
            note: typeof n.note === 'string' ? n.note : '',
            created: typeof n.created === 'string' ? n.created : new Date(0).toISOString(),
        })
    })

    return {
        file: { version: 1, source: typeof obj.source === 'string' ? obj.source : source, notes },
        warnings,
    }
}

/** Sorted by position so the file reads in book order and diffs stay small. */
export function serializeNotes(file: NotesFile): string {
    const notes = [...file.notes].sort((a, b) =>
        a.range.startLine - b.range.startLine || a.range.startCol - b.range.startCol)
    return JSON.stringify({ version: 1, source: file.source, notes }, null, 2) + '\n'
}

// --- re-anchoring --------------------------------------------------------

export type AnchorStatus = 'ok' | 'moved' | 'stale'

export interface Anchored {
    note: Note
    status: AnchorStatus
    /** Where the quote actually is now; equals note.range.startLine when 'ok'. */
    line: number
}

/**
 * `[label](target)` renders as just the label.
 *
 * The target has to go before the brackets do: strip the brackets alone and the
 * URL is left sitting in the middle of the text, between the label and whatever
 * the mark covered next.
 */
const LINK_TARGET = /\]\([^)]*\)/g

/** What markdown-it eats, plus whitespace. */
const SYNTAX = /[\s`*_~|[\]()!\\]+/g

/**
 * The form both sides of the search are compared in.
 *
 * A quote is *rendered* text; the document is *markdown source*. They are never
 * quite the same string, and where the syntax markdown-it removes sits **between**
 * two pieces of the marked text, the quote is not a substring of the source at
 * all. The `|` between table cells is the everyday case: a mark across one row
 * came back 找不到原句 with the highlight sitting right there in the book. The
 * same goes for a mark that runs across a `**bold**` word or a link, and it is
 * why matching the raw line worked for so long — most marks either contain no
 * syntax or sit *inside* a pair of it, where the rendered text is still a
 * substring.
 *
 * Whitespace goes too, and that is not only tidiness: a paragraph wrapped over
 * two source lines renders as one line joined by a space, so removing whitespace
 * from both sides is what lets the span search below join lines with nothing
 * between them and still be exact.
 *
 * A character strip rather than a real markdown render, deliberately. This runs
 * for every note against every line on every rebuild — 60 notes over a 3000-line
 * manuscript — and rendering each line would cost orders of magnitude more. The
 * price is that matching is looser than markdown's own rules; the search already
 * takes the match nearest the recorded line, which is what keeps that honest.
 */
const matchable = (s: string): string => s.replace(LINK_TARGET, ']').replace(SYNTAX, '')

/**
 * Find where a note's text sits in the current document.
 *
 * Editing above a mark shifts it, so the recorded line is a hint rather than an
 * answer: the search starts there and widens outwards, which keeps the common
 * case (a small edit nearby) at the top of the loop and makes the wrong-but-
 * identical-text case pick the closest one.
 *
 * A mark whose text is gone is reported 'stale' rather than dropped — the user
 * asked to keep those and flag them, because the comment is the part worth
 * money and losing it to an unrelated edit is the worse failure.
 */
export function anchorNote(note: Note, markdown: string): Anchored {
    const lines = markdown.split('\n')
    const { head } = quoteEnds(note.quote)
    const needle = matchable(head)
    if (!needle) return { note, status: 'stale', line: note.range.startLine }

    // Reduced once, not once per test: `at` is called for every line and the
    // span pass re-reads the same lines while growing its window.
    const norm = lines.map(matchable)
    // A blank line — or one that is only syntax, like a table's `|---|---|` —
    // reduces to nothing and cannot start or carry a quote, so the span pass
    // walks only the lines that can. That is also what keeps a long run of blank
    // lines from being re-walked for every line, for every note.
    const content: number[] = []
    const nth = new Map<number, number>()
    norm.forEach((s, i) => { if (s) nth.set(i, content.push(i) - 1) })

    const at = (i: number): boolean => i >= 0 && i < lines.length && norm[i]!.includes(needle)

    /**
     * Does the quote start on line `i`, possibly running past the end of it?
     *
     * Lines are joined with nothing between them, because whitespace is already
     * gone from both sides: a paragraph wrapped over two source lines renders as
     * one line joined by a space, and the quote of it has no more claim to that
     * space than to the line break it came from. So a quote that spans a break —
     * including across a blank line, where the mark covered two paragraphs — is
     * found from the line it starts on.
     */
    const spanAt = (i: number): boolean => {
        if (i < 0 || i >= lines.length) return false
        const first = norm[i]!
        if (!first) return false                       // nothing starts on an empty one
        // How far the window is worth growing. A match this test accepts begins
        // before first.length and runs needle.length characters, so once the
        // window is that long, no larger one can contain a match that starts on
        // line i. Bounding it by the quote's length rather than by a line count
        // is not a micro-optimisation: a fixed eight-line window called a mark
        // spanning five short paragraphs stale with the document unedited,
        // because the blank line between each paragraph spent the budget.
        const enough = first.length + needle.length
        let window = first
        let k = nth.get(i)! + 1
        while (k < content.length && window.length < enough) {
            window += norm[content[k]!]!
            k++
            const found = window.indexOf(needle)
            // The match has to *begin* on line i. Merely appearing somewhere in
            // the window is what any earlier line would also see once its window
            // grew far enough, and every one of them would then claim the mark —
            // reporting it lines above where the text actually is.
            if (found >= 0) return found < first.length
        }
        return false
    }

    /** Search outwards from the recorded line: the nearest match wins. */
    const outwards = (test: (i: number) => boolean): number | null => {
        if (test(note.range.startLine)) return note.range.startLine
        for (let d = 1; d < lines.length; d++) {
            const before = note.range.startLine - d
            const after = note.range.startLine + d
            if (test(after)) return after
            if (test(before)) return before
            if (before < 0 && after >= lines.length) break
        }
        return null
    }

    // Single-line first, and not only because it is the common case: it is one
    // normalize() per line against the span pass's MAX_SPAN, and this runs for
    // every note on every rebuild.
    const single = outwards(at)
    if (single !== null) {
        return { note, status: single === note.range.startLine ? 'ok' : 'moved', line: single }
    }

    // A quote that spans a line break cannot be seen from any single line. This
    // used to report 'moved' while handing back the *recorded* line, which is
    // the one line the text demonstrably is not wholly on — so the webview
    // anchored at a stale position and, for a cross-block mark, painted the
    // whole of whatever block happened to be there.
    const spanned = outwards(spanAt)
    if (spanned !== null) {
        return { note, status: spanned === note.range.startLine ? 'ok' : 'moved', line: spanned }
    }

    return { note, status: 'stale', line: note.range.startLine }
}

export const anchorAll = (notes: Note[], markdown: string): Anchored[] =>
    notes.map(n => anchorNote(n, markdown))
