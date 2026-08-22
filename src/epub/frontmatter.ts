// YAML frontmatter → book metadata (spec §6).
import { load } from 'js-yaml'
import type { UiLocale } from '../i18n'
import { normalizeNewlines } from './text'

export interface BookMeta {
    title?: string
    author?: string
    lang?: string
    cover?: string
    identifier?: string
    [key: string]: string | undefined
}

export interface Frontmatter {
    meta: BookMeta
    body: string
    /**
     * 0-based line in the *original* document where `body` starts.
     *
     * Notes anchor to lines in the file the user edits, not to the stripped
     * body, so every consumer that reports a line has to add this back on.
     */
    bodyStartLine: number
    /** Parse failures are reported, never thrown — a typo in frontmatter must not kill the preview. */
    warnings: string[]
}

const countLines = (s: string): number => {
    let n = 0
    for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++
    return n
}

/**
 * YAML gives back whatever type it infers; the OPF only ever wants strings.
 * `year: 2024` arrives as a number and `draft: true` as a boolean, so coerce.
 * Non-scalars are flattened where that's meaningful and dropped where it isn't.
 */
function coerce(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) {
        const parts = value.map(coerce).filter((v): v is string => v !== undefined)
        return parts.length ? parts.join(', ') : undefined
    }
    return undefined
}

const FENCE = /^---[ \t]*\n/

const FRONTMATTER_WARNINGS: Record<UiLocale, Record<'unclosed' | 'invalidYaml' | 'notMapping', string>> = {
    en: {
        unclosed: 'Frontmatter starts with --- but has no closing delimiter; treating the entire file as content.',
        invalidYaml: 'Frontmatter YAML could not be parsed and was ignored: {error}',
        notMapping: 'Frontmatter is not a key-value mapping and was ignored.',
    },
    'zh-TW': {
        unclosed: 'frontmatter 開頭有 --- 但找不到結尾，整份當成內文處理。',
        invalidYaml: 'frontmatter YAML 解析失敗，已忽略：{error}',
        notMapping: 'frontmatter 不是 key: value 結構，已忽略。',
    },
}

function warning(locale: UiLocale, key: keyof typeof FRONTMATTER_WARNINGS.en, error?: unknown): string {
    return FRONTMATTER_WARNINGS[locale][key].replace('{error}', String(error ?? '{error}'))
}

export function parseFrontmatter(source: string, locale: UiLocale = 'en'): Frontmatter {
    const src = normalizeNewlines(source)
    const warnings: string[] = []

    if (!FENCE.test(src)) return { meta: {}, body: src, bodyStartLine: 0, warnings }

    // Closing delimiter is --- or ... on its own line, per YAML document rules.
    const rest = src.slice(src.indexOf('\n') + 1)
    const close = /^(?:---|\.\.\.)[ \t]*$/m.exec(rest)
    if (!close) {
        warnings.push(warning(locale, 'unclosed'))
        return { meta: {}, body: src, bodyStartLine: 0, warnings }
    }

    const yamlText = rest.slice(0, close.index)
    // Drop the newline that ends the delimiter line plus any blank lines after
    // it, so the body starts at real content.
    const afterClose = rest.slice(close.index + close[0].length)
    const body = afterClose.replace(/^\n+/, '')
    // Everything consumed before `body`: the opening delimiter line, the YAML,
    // the closing delimiter, and the blank lines that were trimmed after it.
    const bodyStartLine = 1
        + countLines(rest.slice(0, close.index + close[0].length))
        + countLines(afterClose.slice(0, afterClose.length - body.length))

    // `---\n---\n` is empty metadata, not a parse error; js-yaml throws on it.
    if (!yamlText.trim()) return { meta: {}, body, bodyStartLine, warnings }

    let parsed: unknown
    try {
        parsed = load(yamlText)
    } catch (err) {
        warnings.push(warning(locale, 'invalidYaml', (err as Error).message))
        return { meta: {}, body, bodyStartLine, warnings }
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        if (parsed !== null && parsed !== undefined) {
            warnings.push(warning(locale, 'notMapping'))
        }
        return { meta: {}, body, bodyStartLine, warnings }
    }

    const meta: BookMeta = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const str = coerce(value)
        if (str !== undefined) meta[key] = str
    }
    return { meta, body, bodyStartLine, warnings }
}
