// The project's Markdown compatibility profile, implemented as markdown-it
// configuration rather than scattered renderer exceptions.
import MarkdownIt, {
    type Delimiter,
    type Env,
    type MarkdownIt as MarkdownItInstance,
    type StateCore,
    type StateInline,
} from 'markdown-it'
import { normalizeAuthorMarkdown, protectRawHtml } from './text'

const TILDE = '~'.charCodeAt(0)

export type MarkdownReferences = NonNullable<Env['references']>

/** Convert paired one- or two-tilde runs into a single strike element. */
function processStrikes(state: StateInline, delimiters: Delimiter[]): void {
    for (const delimiter of delimiters) {
        if (delimiter.marker !== TILDE || delimiter.end === -1) continue
        const closer = delimiters[delimiter.end]
        if (!closer) continue
        const open = state.tokens[delimiter.token]
        const close = state.tokens[closer.token]
        if (!open || !close) continue
        const markup = open.content
        open.type = 's_open'
        open.tag = 'del'
        open.nesting = 1
        open.markup = markup
        open.content = ''
        close.type = 's_close'
        close.tag = 'del'
        close.nesting = -1
        close.markup = markup
        close.content = ''
    }
}

/** GFM accepts both `~text~` and `~~text~~`, but not runs of three or more. */
function gfmStrike(md: MarkdownItInstance): void {
    md.inline.ruler.at('strikethrough', (state, silent) => {
        if (silent || state.src.charCodeAt(state.pos) !== TILDE) return false
        const scanned = state.scanDelims(state.pos, true)
        const markup = '~'.repeat(scanned.length)
        if (scanned.length > 2) {
            // Returning false would let markdown-it's fallback consume only the
            // first tilde; the remaining pair would then become a strike. GFM
            // defines the whole run of three or more as literal text.
            const literal = state.push('text', '', 0)
            literal.content = markup
            state.pos += scanned.length
            return true
        }
        const token = state.push('text', '', 0)
        token.content = markup
        state.delimiters.push({
            marker: TILDE,
            length: scanned.length,
            token: state.tokens.length - 1,
            end: -1,
            open: scanned.can_open,
            close: scanned.can_close,
        })
        state.pos += scanned.length
        return true
    })
    md.inline.ruler2.at('strikethrough', state => {
        processStrikes(state, state.delimiters)
        for (const meta of state.tokens_meta) {
            if (meta?.delimiters) processStrikes(state, meta.delimiters)
        }
    })
}

/** Render GFM task items as inert, accessible ebook content rather than forms. */
function taskLists(md: MarkdownItInstance): void {
    md.core.ruler.after('inline', 'task_lists', (state: StateCore) => {
        for (let i = 2; i < state.tokens.length; i++) {
            const inline = state.tokens[i]
            const paragraph = state.tokens[i - 1]
            const item = state.tokens[i - 2]
            if (inline?.type !== 'inline' || paragraph?.type !== 'paragraph_open'
                || item?.type !== 'list_item_open') continue
            const first = inline.children?.[0]
            if (first?.type !== 'text') continue
            const marker = /^\[([ \txX])\][ \t]+/.exec(first.content)
            if (!marker) continue

            item.attrJoin('class', 'task-list-item')
            first.content = first.content.slice(marker[0].length)
            inline.content = inline.content.slice(marker[0].length)
            const task = new state.Token('task_marker', 'span', 0)
            task.info = marker[1]!.toLowerCase() === 'x' ? 'checked' : 'unchecked'
            inline.children!.unshift(task)
        }
    })
    md.renderer.rules.task_marker = (tokens, index) => {
        const checked = tokens[index]?.info === 'checked'
        return `<span class="task-list-marker" role="checkbox" aria-checked="${checked}">${checked ? '☒' : '☐'}</span> `
    }
}

interface LinkMatch {
    schema: string
    index: number
    lastIndex: number
    raw: string
    text: string
    url: string
}

const TRAILING_PUNCTUATION = /[?!.,:*_~]$/u

const isExtendedEmail = (text: string): boolean => {
    const at = text.lastIndexOf('@')
    if (at <= 0 || at === text.length - 1) return false
    const local = text.slice(0, at)
    const domain = text.slice(at + 1)
    return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)
        && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/u.test(domain)
}

/** GFM's path suffix rules, shared by www, scheme, and bare-domain links. */
const trimExtendedPath = (candidate: string): string => {
    let result = candidate
    let changed = true
    while (changed) {
        changed = false
        while (TRAILING_PUNCTUATION.test(result)) {
            result = result.slice(0, -1)
            changed = true
        }
        if (result.endsWith(')')) {
            const opens = (result.match(/\(/g) ?? []).length
            const closes = (result.match(/\)/g) ?? []).length
            if (closes > opens) {
                result = result.slice(0, -1)
                changed = true
            }
        }
    }
    // An entity-looking suffix is prose immediately following the autolink.
    const entity = /&[A-Za-z0-9]+;$/u.exec(result)
    return entity ? result.slice(0, entity.index) : result
}

const isWebAutolink = (match: LinkMatch): boolean =>
    match.schema === '' || /^(?:https?|ftp):$/iu.test(match.schema)

/**
 * linkify-it provides the useful broad candidate detection, but its URL-edge
 * handling differs from GFM. Re-shape each candidate using GFM's path and
 * email rules while retaining this profile's intentional bare-domain superset.
 */
const gfmMatches = (text: string, matches: LinkMatch[]): LinkMatch[] => {
    const result: LinkMatch[] = []
    let occupied = 0
    for (const original of matches) {
        if (original.index < occupied) continue
        if (original.schema === 'mailto:' && !isExtendedEmail(original.text)) continue

        let match = { ...original }
        if (isWebAutolink(match)) {
            const end = text.slice(match.index).search(/[\s<]/u)
            const candidate = text.slice(match.index, end < 0 ? text.length : match.index + end)
            const trimmed = trimExtendedPath(candidate)
            if (!trimmed) continue
            match = {
                ...match,
                lastIndex: match.index + trimmed.length,
                raw: trimmed,
                text: trimmed,
                url: match.schema ? trimmed : `http://${trimmed}`,
            }
        }
        result.push(match)
        occupied = match.lastIndex
    }
    return result
}

/** Render extended links in a core pass, after normal inline parsing. */
function extendedAutolinks(md: MarkdownItInstance): void {
    // The stock inline rule eagerly handles scheme URLs before the core pass.
    // Keeping links in text tokens lets one implementation enforce the same
    // GFM suffix rules for www, bare domains, schemes, and email addresses.
    md.inline.ruler.disable(['linkify'])
    md.core.ruler.at('linkify', (state: StateCore) => {
        if (!state.md.options.linkify) return
        for (let block = 0; block < state.tokens.length; block++) {
            if (state.tokens[block]?.type !== 'inline') continue
            let tokens = state.tokens[block]!.children ?? []
            for (let i = tokens.length - 1; i >= 0; i--) {
                const current = tokens[i]!
                if (current.type === 'link_close') {
                    i--
                    while (i >= 0 && tokens[i]!.level !== current.level && tokens[i]!.type !== 'link_open') i--
                    continue
                }
                if (current.type !== 'text') continue

                const text = current.content
                const matches = gfmMatches(text, (state.md.linkify.match(text) as LinkMatch[] | null) ?? [])
                if (!matches.length) continue

                const nodes = []
                let level = current.level
                let last = 0
                for (const match of matches) {
                    const href = state.md.normalizeLink(match.url)
                    if (!state.md.validateLink(href)) continue
                    if (match.index > last) {
                        const before = new state.Token('text', '', 0)
                        before.content = text.slice(last, match.index)
                        before.level = level
                        nodes.push(before)
                    }
                    const open = new state.Token('link_open', 'a', 1)
                    open.attrs = [['href', href]]
                    open.level = level++
                    open.markup = 'linkify'
                    open.info = 'auto'
                    nodes.push(open)

                    const label = new state.Token('text', '', 0)
                    label.content = match.schema
                        ? state.md.normalizeLinkText(match.text)
                        : state.md.normalizeLinkText(`http://${match.text}`).replace(/^http:\/\//u, '')
                    label.level = level
                    nodes.push(label)

                    const close = new state.Token('link_close', 'a', -1)
                    close.level = --level
                    close.markup = 'linkify'
                    close.info = 'auto'
                    nodes.push(close)
                    last = match.lastIndex
                }
                if (last < text.length) {
                    const after = new state.Token('text', '', 0)
                    after.content = text.slice(last)
                    after.level = level
                    nodes.push(after)
                }
                tokens.splice(i, 1, ...nodes)
                state.tokens[block]!.children = tokens
            }
        }
    })
}

/** Create a parser with the exact syntax profile promised by the specification. */
export function createMarkdown(): MarkdownItInstance {
    const md = new MarkdownIt({
        html: false,
        xhtmlOut: true,
        breaks: false,
        linkify: true,
        typographer: false,
    })
    // GFM extended autolinks include `www.` forms. Fuzzy links are also an
    // intentional safe authoring superset for bare domains.
    md.linkify.set({ fuzzyLink: true })
    gfmStrike(md)
    taskLists(md)
    extendedAutolinks(md)
    return md
}

export interface MarkdownHeading {
    startLine: number
    endLine: number
    level: number
    /** 0 means document level; a larger value is nested in a list or quote. */
    containerLevel: number
    /** Markdown source inside the heading, before reduction to a plain label. */
    title: string
}

const headingParser = createMarkdown()

/** Discover ATX and Setext headings using the same parser that renders them. */
export function parseMarkdownHeadings(markdown: string): MarkdownHeading[] {
    const rawHtml = protectRawHtml(markdown)
    const tokens = headingParser.parse(normalizeAuthorMarkdown(rawHtml.markdown), {})
    const headings: MarkdownHeading[] = []
    for (let i = 0; i < tokens.length - 1; i++) {
        const open = tokens[i]
        const inline = tokens[i + 1]
        if (open?.type !== 'heading_open' || inline?.type !== 'inline' || !open.map) continue
        const level = Number(open.tag.slice(1))
        if (!Number.isInteger(level)) continue
        headings.push({
            startLine: open.map[0],
            endLine: open.map[1],
            level,
            containerLevel: open.level,
            title: rawHtml.restore(inline.content).replace(/\s+/g, ' ').trim(),
        })
    }
    return headings
}

/** Parse the document once so every split chapter shares CommonMark references. */
export function parseMarkdownReferences(markdown: string): MarkdownReferences {
    const env: Env = {}
    const rawHtml = protectRawHtml(markdown)
    headingParser.parse(normalizeAuthorMarkdown(rawHtml.markdown), env)
    return env.references ?? {}
}
