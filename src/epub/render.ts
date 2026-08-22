// markdown → XHTML (spec §3). Pure: string in, string out.
import MarkdownIt from 'markdown-it'
import { escapeXml, unescapeXml } from './text'

// html:false is a correctness requirement, not a policy choice. One raw `<br>`
// from the source would make the chapter non-well-formed, and a strict EPUB
// reader rejects the whole document, not just the offending element.
// markdown-it decodes named entities (&nbsp; &copy;) into literal characters,
// so nothing outside the five XML built-ins survives into the output.
const md = new MarkdownIt({
    html: false,
    xhtmlOut: true,
    breaks: false,
    linkify: true,
    typographer: false,
})

export interface RenderOptions {
    lang: string
    /** Relative href from the chapter to the stylesheet, e.g. 'style.css'. */
    stylesheet?: string
    /**
     * When set, every block element carries `data-md-line` and
     * `data-md-line-end` — the 0-based `[start, end)` lines it covers in the
     * *document*, obtained by adding this to markdown-it's chapter-relative
     * `token.map`. Those attributes are how a highlight in the panel resolves
     * back to a line in the `.md` the user edits. The end is not decoration: one
     * block routinely covers many lines, and a mark on an inner one has no other
     * way home.
     *
     * Preview builds only. An exported EPUB has no use for it and readers should
     * not be handed our bookkeeping.
     */
    lineOffset?: number
}

/**
 * A second renderer that stamps `data-md-line` on every block element.
 *
 * markdown-it gives block tokens a `map` of `[startLine, endLineExclusive)`
 * relative to the string it was handed, and nothing downstream can reconstruct
 * it — by the time we hold HTML the source positions are gone. So it is
 * captured here, and the chapter's offset into the document rides along in
 * `env` rather than in a closure, so one instance serves every chapter.
 *
 * Kept separate from `md` rather than toggled on it: render rules are renderer
 * state, and a flag would leak line numbers into whatever exported next.
 */
const mdTagged = new MarkdownIt({
    html: false, xhtmlOut: true, breaks: false, linkify: true, typographer: false,
})

const offsetOf = (env: unknown): number => (env as { lineOffset?: number })?.lineOffset ?? 0

const lineOf = (token: { map?: [number, number] | null }, env: unknown): number =>
    offsetOf(env) + (token.map?.[0] ?? 0)

/**
 * The line after the block's last, `data-md-line-end`.
 *
 * A block is not one line, and the start alone cannot say which one it is: a
 * fenced code block is a single element covering a dozen source lines, and so is
 * a hard-wrapped paragraph. A mark inside one is stored against the *block's*
 * first line, but the host re-anchors it by searching for the quote and hands
 * back the line the text is actually on — an inner line, which nothing carries.
 * The webview then found no block for it and silently drew nothing: the note was
 * saved, listed in the panel, and invisible in the book. So the span is stamped
 * and the webview looks up by containment.
 *
 * The offset has to be added here too. Without it the span is chapter-relative
 * while the line being tested is document-relative, which is worse than no span
 * at all — it matches confidently in the wrong chapter.
 */
const endLineOf = (token: { map?: [number, number] | null }, env: unknown): number =>
    offsetOf(env) + (token.map?.[1] ?? ((token.map?.[0] ?? 0) + 1))

// These have no default rule — markdown-it renders them through renderToken —
// so setting an attribute on the token is enough.
for (const name of ['paragraph_open', 'heading_open', 'blockquote_open',
    'bullet_list_open', 'ordered_list_open', 'list_item_open', 'table_open', 'hr']) {
    mdTagged.renderer.rules[name] = (tokens, idx, options, env, self) => {
        const token = tokens[idx]!
        if (token.map) {
            token.attrSet('data-md-line', String(lineOf(token, env)))
            token.attrSet('data-md-line-end', String(endLineOf(token, env)))
        }
        return self.renderToken(tokens, idx, options)
    }
}

// `fence` and `code_block` build their own markup instead of calling
// renderToken, so their attributes have to be injected into the result.
for (const name of ['fence', 'code_block']) {
    const original = mdTagged.renderer.rules[name]!
    mdTagged.renderer.rules[name] = (tokens, idx, options, env, self) => {
        const token = tokens[idx]!
        const html = original(tokens, idx, options, env, self)
        if (!token.map) return html
        return html.replace(/^(\s*<[a-zA-Z][^\s>/]*)/,
            `$1 data-md-line="${lineOf(token, env)}" data-md-line-end="${endLineOf(token, env)}"`)
    }
}

/**
 * Render a chapter's markdown body to an XHTML fragment (no document wrapper).
 *
 * @param lineOffset the chapter's 0-based start line in the document. Supplying
 *   it turns on `data-md-line`; leave it out for exports.
 */
export function renderFragment(markdown: string, lineOffset?: number): string {
    return lineOffset === undefined
        ? md.render(markdown)
        : mdTagged.render(markdown, { lineOffset })
}

/**
 * A heading's markdown source → the label a reader should show for it.
 *
 * `# My *great* [book](x)` is a heading whose *text* is "My great book"; the
 * asterisks and brackets are formatting, and they have nowhere to render in
 * `dc:title`, in the nav document, or in the panel's chapter picker — those are
 * all plain-text slots, so the source leaks through verbatim.
 *
 * Order matters at the end: markdown-it escapes for HTML, so the entities have
 * to come back off before the string is handed on. Everything downstream escapes
 * it again on the way into XML, and `&` would otherwise reach the reader as
 * `&amp;`.
 */
export function plainText(markdown: string): string {
    const inline = md.renderInline(markdown.trim())
    return unescapeXml(inline.replace(/<[^>]*>/g, '')).trim()
}

/** Wrap a rendered fragment in a complete, well-formed XHTML document. */
export function wrapDocument(fragment: string, title: string, opts: RenderOptions): string {
    const link = opts.stylesheet
        ? `\n  <link rel="stylesheet" type="text/css" href="${escapeXml(opts.stylesheet)}"/>`
        : ''
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(opts.lang)}" lang="${escapeXml(opts.lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>${link}
</head>
<body>
<section epub:type="chapter">
${fragment.trim()}
</section>
</body>
</html>
`
}

export function renderChapter(markdown: string, title: string, opts: RenderOptions): string {
    return wrapDocument(renderFragment(markdown, opts.lineOffset), title, opts)
}

/**
 * Default reading styles, used when `mdepub.css` is unset (spec §6).
 *
 * Tuned to read like a phone e-reader rather than a web page, because that is
 * what the panel is simulating. The three settings that do the work are the
 * sans-serif face, `line-height: 1.9` and the 3% side margin — a serif at 1.75
 * with no margin is what made the panel look cramped next to the same book in
 * Apple Books.
 *
 * Font stack order is deliberate and falls through per character. The Latin
 * faces come first so numerals and品種 names get a humanist sans, and the CJK
 * families follow. **"Microsoft JhengHei" is load-bearing**: under Remote-WSL
 * the webview renders in the Windows-side process, where PingFang and Noto Sans
 * TC do not exist, and without a Windows Traditional Chinese sans in the list
 * the whole stack falls through to a default serif with nothing reported.
 */
export const DEFAULT_CSS = `html {
  font-family: system-ui, -apple-system, "Segoe UI",
    "PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Source Han Sans TC",
    "Microsoft JhengHei", "Hiragino Sans", "Heiti TC", sans-serif;
  font-size: 105%;
}
/* The side margin reaches exported files only. foliate-js's paginator sets
   body margin to 0 with !important and derives the panel's inset from its own
   \`gap\`, so this line cannot affect the preview — do not "fix" it there. */
body { margin: 0 3%; line-height: 1.9; }
h1, h2, h3 { line-height: 1.45; font-weight: 700; text-align: left; }
h1 { font-size: 1.55em; margin: 1.3em 0 0.9em; }
h2 { font-size: 1.28em; margin: 1.6em 0 0.7em; }
h3 { font-size: 1.1em; margin: 1.4em 0 0.55em; }
p { margin: 0.8em 0; text-align: justify; }
li { margin: 0.4em 0; }
ul, ol { padding-left: 1.4em; }
img { max-width: 100%; height: auto; }
blockquote {
  margin: 1em 0; padding: 0 1em;
  border-inline-start: 3px solid currentColor; opacity: 0.85;
}
pre {
  white-space: pre-wrap; word-wrap: break-word;
  font-size: 0.85em; padding: 0.8em; background: rgba(127,127,127,0.12);
}
code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.9em; }
table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
th, td { border: 1px solid rgba(127,127,127,0.4); padding: 0.4em 0.6em; }
hr { border: 0; border-top: 1px solid rgba(127,127,127,0.4); margin: 2em 0; }
`
