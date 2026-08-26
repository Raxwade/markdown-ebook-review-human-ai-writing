// Shared string helpers. Line-ending normalisation lives here so every module
// downstream can assume '\n' — CRLF files are the norm on Windows/WSL and every
// naive ^## / --- match breaks on them.

/** Normalise CRLF and lone CR to LF, and strip a UTF-8 BOM. */
export function normalizeNewlines(src: string): string {
    return src.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

/** Escape for XML text content and attribute values. */
export function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

interface RawTag {
    end: number
    name?: string
    closing?: boolean
    selfClosing?: boolean
}

export interface RawHtmlProtection {
    markdown: string
    restore: (xhtml: string) => string
}

const VOID_HTML = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
])

const BLOCK_HTML = new Set([
    'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
    'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
    'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html',
    'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'ol',
    'p', 'pre', 'script', 'search', 'section', 'summary', 'table', 'tbody',
    'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
])

const isRawBlockStart = (source: string, index: number): boolean => {
    const lineStart = source.lastIndexOf('\n', index - 1) + 1
    return /^[ \t]{0,3}$/.test(source.slice(lineStart, index))
}

/** Read one HTML-like tag without being confused by a > inside quoted attributes. */
const readRawTag = (source: string, start: number): RawTag | null => {
    if (source[start] !== '<') return null
    if (source.startsWith('<!--', start)) {
        const close = source.indexOf('-->', start + 4)
        return { end: close < 0 ? source.length : close + 3 }
    }
    if (source.startsWith('<![CDATA[', start)) {
        const close = source.indexOf(']]>', start + 9)
        return { end: close < 0 ? source.length : close + 3 }
    }
    if (source.startsWith('<?', start)) {
        const close = source.indexOf('?>', start + 2)
        return { end: close < 0 ? source.length : close + 2 }
    }
    if (/^<![A-Z]/.test(source.slice(start))) {
        const close = source.indexOf('>', start + 2)
        return { end: close < 0 ? source.length : close + 1 }
    }

    const opening = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\t\n\f\r />])/.exec(source.slice(start))
    if (!opening) return null
    let quote = ''
    for (let index = start + opening[0].length; index < source.length; index++) {
        const char = source[index]!
        if (quote) {
            if (char === quote) quote = ''
            continue
        }
        if (char === '"' || char === "'") {
            quote = char
            continue
        }
        if (char === '>') {
            const name = opening[1]!.toLowerCase()
            return {
                end: index + 1,
                name,
                closing: opening[0]!.startsWith('</'),
                selfClosing: VOID_HTML.has(name) || /\/\s*>$/.test(source.slice(start, index + 1)),
            }
        }
    }
    return null
}

const matchingClose = (source: string, from: number, name: string): number | null => {
    for (let index = source.indexOf('<', from); index >= 0; index = source.indexOf('<', index + 1)) {
        const tag = readRawTag(source, index)
        if (!tag) continue
        if (tag.closing && tag.name === name) return tag.end
    }
    return null
}

const blockEnd = (source: string, from: number): number => {
    const blank = /\n[ \t]*\n/g
    blank.lastIndex = from
    const close = blank.exec(source)
    return close ? close.index : source.length
}

/**
 * Shield raw HTML before Markdown parsing. html:false safely escapes tags, but
 * otherwise lets emphasis and linkification interpret characters *inside* a
 * disabled tag. Replacing each raw unit with a private marker keeps the source
 * literal and restores it as XML text after rendering. Newlines are retained so
 * token maps and source-backed annotations remain exact.
 */
export function protectRawHtml(markdown: string): RawHtmlProtection {
    const source = normalizeNewlines(markdown)
    const masks = codeMasks(source.split('\n'))
    const lineStarts = [0]
    for (let index = 0; index < source.length; index++) {
        if (source[index] === '\n') lineStarts.push(index + 1)
    }
    const isCode = (index: number): boolean => {
        let low = 0
        let high = lineStarts.length - 1
        while (low < high) {
            const middle = Math.ceil((low + high) / 2)
            if (lineStarts[middle]! <= index) low = middle
            else high = middle - 1
        }
        return masks[low]![index - lineStarts[low]! ] ?? false
    }
    const replacements = new Map<string, string>()
    let prefix = '\uE000mdepub-raw-'
    while (source.includes(prefix)) prefix = `\uE000${prefix}`
    let output = ''
    let cursor = 0
    let number = 0

    while (cursor < source.length) {
        const start = source.indexOf('<', cursor)
        if (start < 0) {
            output += source.slice(cursor)
            break
        }
        const tag = readRawTag(source, start)
        if (!tag || isEscaped(source, start) || isCode(start)) {
            output += source.slice(cursor, start + 1)
            cursor = start + 1
            continue
        }

        let end = tag.end
        if (!tag.closing && tag.name && !tag.selfClosing) {
            end = matchingClose(source, tag.end, tag.name) ?? end
            if (end === tag.end && BLOCK_HTML.has(tag.name) && isRawBlockStart(source, start)) {
                end = blockEnd(source, tag.end)
            }
        }

        const raw = source.slice(start, end)
        const opening = source.slice(start, tag.end)
        const hasAttributes = /<\/?[A-Za-z][A-Za-z0-9-]*[\t\n\f\r ]+[^>]/.test(opening)
        // A bare tag cannot turn text inside itself into a link or emphasis. Do
        // not shield it: `<url>` is also valid CommonMark link-destination
        // syntax, whose grammar must retain precedence over raw-HTML fallback.
        if (end === tag.end && !hasAttributes && !tag.closing) {
            output += source.slice(cursor, end)
            cursor = end
            continue
        }
        const marker = `${prefix}${number++}\uE001`
        replacements.set(marker, raw)
        output += source.slice(cursor, start) + marker + '\n'.repeat((raw.match(/\n/g) ?? []).length)
        cursor = end
    }

    return {
        markdown: output,
        restore: xhtml => {
            let restored = xhtml
            for (const [marker, raw] of replacements) {
                restored = restored.split(marker).join(escapeXml(raw))
            }
            return restored
        },
    }
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

/**
 * The inverse of escapeXml, plus numeric character references.
 *
 * Both callers are undoing markdown-it's HTML escaping to recover plain text —
 * an asset path on its way to the filesystem, and a heading on its way into
 * dc:title. Getting it wrong is quiet in both directions: a missed `&amp;` is
 * read as a filename that does not exist, or is escaped a second time and shows
 * up as `&amp;amp;` in the reader's title bar.
 */
export function unescapeXml(s: string): string {
    return s.replace(/&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
        if (body[0] !== '#') return NAMED_ENTITIES[body] ?? whole
        const code = body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
        return String.fromCodePoint(code)
    })
}

/**
 * Track fenced code blocks while walking lines. A `# heading` inside ```…```
 * is code, not a heading, and must not split a chapter.
 */
export function makeFenceTracker(): (line: string) => boolean {
    // CommonMark: a fence closes only on the same character and at least as many
    // of them. Collapsing every fence to length 3 would let an inner ``` close a
    // ```` block, and any heading after that point would split a chapter from
    // inside code.
    let open: { char: string; length: number } | null = null
    return (line: string): boolean => {
        const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
        if (m) {
            const marker = m[1]!
            const char = marker[0]!
            const rest = m[2]!
            if (open === null) {
                // A backtick fence's info string may not itself contain a
                // backtick. Without that rule a paragraph line that opens with
                // an inline code span — ```lang``` written in prose — reads as
                // the start of a code block and swallows the rest of the file.
                if (char !== '`' || !rest.includes('`')) open = { char, length: marker.length }
            } else if (char === open.char && marker.length >= open.length && rest.trim() === '') {
                // A closing fence carries nothing but whitespace after the run.
                // Treating ```not-a-close as a close ends the block early, and
                // every `# comment` after it splits a chapter from inside code.
                open = null
            }
        }
        return open !== null
    }
}

/**
 * Markdown accepted as a convenience for manuscript authors.
 *
 * CommonMark intentionally requires whitespace after an ATX heading marker and
 * forbids whitespace just inside a strong-emphasis delimiter. AI-written drafts
 * nevertheless commonly contain `##Heading` and `** important **`. Treat those
 * two forms as their unambiguous author intent, while leaving every kind of
 * code byte-for-byte alone. The transform never adds or removes a newline, so
 * markdown-it's token maps still address the source document's real lines.
 */
type Mask = boolean[]

interface Position {
    line: number
    column: number
}

const hasMask = (mask: Mask, start: number, end: number): boolean =>
    mask.slice(start, end).some(Boolean)

const mark = (masks: Mask[], start: Position, end: Position): void => {
    for (let line = start.line; line <= end.line; line++) {
        const from = line === start.line ? start.column : 0
        const to = line === end.line ? end.column : masks[line]!.length
        masks[line]!.fill(true, from, to)
    }
}

const isEscaped = (line: string, index: number): boolean => {
    let slashes = 0
    for (let i = index - 1; i >= 0 && line[i] === '\\'; i--) slashes++
    return slashes % 2 === 1
}

/**
 * A conservative recognition of indented code. Over-recognising a nested prose
 * line merely declines an optional correction; under-recognising it would
 * mutate literal code, which is never acceptable.
 */
const isIndentedCodeLine = (line: string): boolean => {
    let rest = line
    while (true) {
        const quote = /^(?: {0,3}>[ \t]?)/.exec(rest)
        if (!quote) break
        rest = rest.slice(quote[0].length)
    }
    return /^(?: {4}|\t)/.test(rest)
}

/** A code span cannot cross a blank line or a block that interrupts a paragraph. */
const isInlineBoundary = (line: string): boolean =>
    line.trim() === ''
    || /^(?: {0,3}(?:#{1,6}(?:[ \t]+|[ \t]*$)|(?:[-*_][ \t]*){3,}$|[-+*][ \t]+|\d{1,9}[.)][ \t]+|>))/.test(line)

const backtickRunEnd = (line: string, start: number): number => {
    let end = start + 1
    while (line[end] === '`') end++
    return end
}

/** Find the first CommonMark-compatible closer for a backtick run. */
const findCodeSpanClose = (
    lines: string[], masks: Mask[], start: Position, length: number,
): Position | null => {
    for (let line = start.line; line < lines.length; line++) {
        if (line !== start.line && (isInlineBoundary(lines[line]!) || hasMask(masks[line]!, 0, masks[line]!.length))) {
            return null
        }
        const text = lines[line]!
        let column = line === start.line ? start.column : 0
        while (column < text.length) {
            if (text[column] !== '`' || masks[line]![column] || isEscaped(text, column)) {
                column++
                continue
            }
            const end = backtickRunEnd(text, column)
            if (end - column === length) return { line, column: end }
            column = end
        }
    }
    return null
}

/** Mark fenced, indented, and inline-code source ranges as immutable. */
const codeMasks = (lines: string[]): Mask[] => {
    const masks = lines.map(line => Array<boolean>(line.length).fill(false))
    const inFence = makeFenceTracker()
    let wasInFence = false
    for (let line = 0; line < lines.length; line++) {
        const isInFence = inFence(lines[line]!)
        if (wasInFence || isInFence || isIndentedCodeLine(lines[line]!)) {
            masks[line]!.fill(true)
        }
        wasInFence = isInFence
    }

    for (let line = 0; line < lines.length; line++) {
        const text = lines[line]!
        for (let column = 0; column < text.length;) {
            if (text[column] !== '`' || masks[line]![column] || isEscaped(text, column)) {
                column++
                continue
            }
            const end = backtickRunEnd(text, column)
            const close = findCodeSpanClose(lines, masks, { line, column: end }, end - column)
            if (!close) {
                column = end
                continue
            }
            mark(masks, { line, column }, close)
            if (close.line !== line) break
            column = close.column
        }
    }
    return masks
}

const normalizeStrongOutsideCode = (line: string, mask: Mask): string => {
    const pattern = /(^|[^\p{L}\p{N}\\])(\*\*|__)[ \t]+(\S(?:.*?\S)?)[ \t]+\2(?=$|[^\p{L}\p{N}])/gu
    let output = ''
    let cursor = 0
    for (const match of line.matchAll(pattern)) {
        const index = match.index ?? 0
        const whole = match[0]!
        const prefix = match[1]!
        const marker = match[2]!
        const content = match[3]!
        if (hasMask(mask, index, index + whole.length)) continue
        output += line.slice(cursor, index) + prefix + marker + content + marker
        cursor = index + whole.length
    }
    return output ? output + line.slice(cursor) : line
}

const normalizeAuthorLine = (line: string, mask: Mask): string => {
    // `(?!#)` prevents a run of seven or more hashes from backtracking into a
    // six-hash heading. Up to three leading spaces remain the CommonMark limit.
    const heading = /^( {0,3})(#{1,6})(?!#)(?=\S)(.*)$/u.exec(line)
    const withHeadingSpace = heading && !hasMask(mask, 0, line.length)
        ? `${heading[1]}${heading[2]} ${heading[3]}`
        : line
    return normalizeStrongOutsideCode(withHeadingSpace, mask)
}

export function normalizeAuthorMarkdown(markdown: string): string {
    const lines = normalizeNewlines(markdown).split('\n')
    const masks = codeMasks(lines)
    return lines
        .map((line, index) => normalizeAuthorLine(line, masks[index]!))
        .join('\n')
}
