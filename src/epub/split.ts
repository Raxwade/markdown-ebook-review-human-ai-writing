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
 * Chapters break at document-level ATX or Setext headings of depth <= splitLevel.
 * Text before the first such heading becomes its own chapter so nothing is silently dropped;
 * a document with no headings comes back as a single chapter.
 */
export function splitChapters(markdown: string, splitLevel: 1 | 2): Chapter[] {
    const lines = normalizeNewlines(markdown).split('\n')
    const headings = new Map(parseMarkdownHeadings(markdown)
        .filter(heading => heading.level <= splitLevel && heading.containerLevel === 0)
        .map(heading => [heading.startLine, heading]))

    const chapters: Chapter[] = []
    let current: Chapter = { title: '', level: 0, markdown: '', startLine: 0 }
    let buffer: string[] = []
    // Line in `lines` at which `buffer` starts, so the trim below can be undone.
    let bufferStart = 0

    const flush = (nextStart: number) => {
        let first = 0
        let last = buffer.length
        while (first < last && buffer[first]!.trim() === '') first++
        while (last > first && buffer[last - 1]!.trim() === '') last--
        const text = buffer.slice(first, last).join('\n')
        if (text || current.title) {
            // Trim only blank boundary lines. Whitespace inside a non-blank line
            // is Markdown syntax: stripping it would turn an indented code block
            // into a paragraph or mutate code text at the end of a chapter.
            chapters.push({ ...current, markdown: text, startLine: bufferStart + first })
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
