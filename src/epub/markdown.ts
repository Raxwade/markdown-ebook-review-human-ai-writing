// The project's Markdown compatibility profile, implemented as markdown-it
// configuration rather than scattered renderer exceptions.
import MarkdownIt, {
    type Delimiter,
    type MarkdownIt as MarkdownItInstance,
    type StateCore,
    type StateInline,
} from 'markdown-it'
import { normalizeAuthorMarkdown } from './text'

const TILDE = '~'.charCodeAt(0)

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
            const marker = /^\[([ xX])\][ \t]+/.exec(first.content)
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

/** Create a parser with the exact syntax profile promised by the specification. */
export function createMarkdown(): MarkdownItInstance {
    const md = new MarkdownIt({
        html: false,
        xhtmlOut: true,
        breaks: false,
        linkify: true,
        typographer: false,
    })
    // GFM extended autolinks include `www.` forms. markdown-it 15 disables
    // fuzzy links by default; enabling them also accepts bare domains, a useful
    // and safe authoring superset. validateLink still rejects unsafe schemes.
    md.linkify.set({ fuzzyLink: true })
    gfmStrike(md)
    taskLists(md)
    return md
}

export interface MarkdownHeading {
    startLine: number
    endLine: number
    level: number
    /** Markdown source inside the heading, before reduction to a plain label. */
    title: string
}

const headingParser = createMarkdown()

/** Discover ATX and Setext headings using the same parser that renders them. */
export function parseMarkdownHeadings(markdown: string): MarkdownHeading[] {
    const tokens = headingParser.parse(normalizeAuthorMarkdown(markdown), {})
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
            title: inline.content.replace(/\s+/g, ' ').trim(),
        })
    }
    return headings
}
