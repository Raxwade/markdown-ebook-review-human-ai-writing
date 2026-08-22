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
