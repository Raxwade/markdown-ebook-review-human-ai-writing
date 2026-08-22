// Split markdown into chapters by heading level (spec §6, `splitLevel`).
import { makeFenceTracker, normalizeNewlines } from './text'

export interface Chapter {
    /** Heading text, or '' for content that precedes the first heading. */
    title: string
    /** Heading depth that opened this chapter; 0 for the preamble. */
    level: number
    markdown: string
    /**
     * 0-based line, within the markdown handed to splitChapters, of this
     * chapter's first line of `markdown`.
     *
     * Notes anchor to lines in the file the user edits, so this has to survive
     * the trim below: `markdown` drops leading blank lines, and counting them
     * is the only way a line number inside a chapter maps back to the document.
     */
    startLine: number
}

/**
 * ATX heading, per CommonMark:
 *   - up to three leading spaces still count (four make it an indented code
 *     block, so ` {0,3}` is the whole rule, not a nicety — an editor that
 *     indents a heading by two spaces was silently losing the chapter break);
 *   - the text is optional, so a bare `#` line is an empty heading;
 *   - a trailing run of `#` closes the heading only when a space precedes it,
 *     which is what keeps `## C#` from being read as `## C`.
 */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/

/**
 * Chapters break at any ATX heading of depth <= splitLevel. Text before the
 * first such heading becomes its own chapter so nothing is silently dropped;
 * a document with no headings comes back as a single chapter.
 */
export function splitChapters(markdown: string, splitLevel: 1 | 2): Chapter[] {
    const lines = normalizeNewlines(markdown).split('\n')
    const inFence = makeFenceTracker()

    const chapters: Chapter[] = []
    let current: Chapter = { title: '', level: 0, markdown: '', startLine: 0 }
    let buffer: string[] = []
    // Line in `lines` at which `buffer` starts, so the trim below can be undone.
    let bufferStart = 0

    const flush = (nextStart: number) => {
        const text = buffer.join('\n').trim()
        if (text || current.title) {
            // `trim()` removes leading blank lines; skipping the same lines here
            // keeps startLine pointing at the first line `markdown` actually has.
            let lead = 0
            while (lead < buffer.length && buffer[lead]!.trim() === '') lead++
            chapters.push({ ...current, markdown: text, startLine: bufferStart + lead })
        }
        buffer = []
        bufferStart = nextStart
    }

    lines.forEach((line, i) => {
        // Fence state must advance for every line, including heading-looking ones.
        if (inFence(line)) { buffer.push(line); return }

        const m = HEADING.exec(line)
        if (m && m[1]!.length <= splitLevel) {
            flush(i)
            // m[2] is absent for a bare `#`; that is an empty title, not a crash.
            current = { title: (m[2] ?? '').trim(), level: m[1]!.length, markdown: '', startLine: i }
            buffer.push(line)
            return
        }
        buffer.push(line)
    })
    flush(lines.length)

    return chapters.length ? chapters : [{ title: '', level: 0, markdown: '', startLine: 0 }]
}
