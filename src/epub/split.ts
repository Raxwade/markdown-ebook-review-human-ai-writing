// Split markdown into chapters by heading level (spec §6, `splitLevel`).
import { normalizeNewlines } from './text'
import { parseMarkdownHeadings } from './markdown'

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
 * Chapters break at any ATX or Setext heading of depth <= splitLevel. Text before the
 * first such heading becomes its own chapter so nothing is silently dropped;
 * a document with no headings comes back as a single chapter.
 */
export function splitChapters(markdown: string, splitLevel: 1 | 2): Chapter[] {
    const lines = normalizeNewlines(markdown).split('\n')
    const headings = new Map(parseMarkdownHeadings(markdown)
        .filter(heading => heading.level <= splitLevel)
        .map(heading => [heading.startLine, heading]))

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
        const heading = headings.get(i)
        if (heading) {
            flush(i)
            current = { title: heading.title, level: heading.level, markdown: '', startLine: i }
            buffer.push(line)
            return
        }
        buffer.push(line)
    })
    flush(lines.length)

    return chapters.length ? chapters : [{ title: '', level: 0, markdown: '', startLine: 0 }]
}
