// Find and rewrite local asset references (spec §3, §6).
//
// This module does NOT touch the filesystem. It reports which relative paths a
// rendered chapter refers to and rewrites them to their in-EPUB location; the
// caller reads the bytes and hands them back. That keeps src/epub/* pure and
// headless-testable, which is the whole point of the §3 split.
import { unescapeXml } from './text'

const SUPPORTED = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'])

export const MEDIA_TYPES: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
}

export function extname(p: string): string {
    const i = p.lastIndexOf('.')
    const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
    return i > slash ? p.slice(i).toLowerCase() : ''
}

/** Absolute URLs and data: URIs are left alone — only local files get packed. */
export function isLocalRef(ref: string): boolean {
    if (!ref || ref.startsWith('#')) return false
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) && !ref.startsWith('//')
}

/**
 * An `src` attribute value → the path the author actually wrote on disk.
 *
 * markdown-it percent-encodes the URL and *then* escapes it for HTML, so undo
 * it in that order: `![](a&b.png)` reaches us as `src="a&amp;b.png"`, and
 * decoding only the percent-escapes would send `a&amp;b.png` to the filesystem,
 * where it reads as a missing image and the picture is silently dropped.
 *
 * decodeURI throws on a malformed escape (`a%zz.png`); one such filename must
 * not take the whole build down, so the literal text is used instead. Every
 * call site goes through here — if they disagreed, plan lookups would miss and
 * images would vanish for no visible reason.
 */
export function decodeRef(raw: string): string {
    const unescaped = unescapeXml(raw)
    try {
        return decodeURI(unescaped)
    } catch {
        return unescaped
    }
}

const IMG_SRC = /(<img\b[^>]*?\bsrc=)(["'])(.*?)\2/gi

/** Every distinct local image path referenced by the fragment, in first-seen order. */
export function collectAssetRefs(xhtml: string): string[] {
    const found: string[] = []
    const seen = new Set<string>()
    for (const m of xhtml.matchAll(IMG_SRC)) {
        const ref = decodeRef(m[3]!)
        if (!isLocalRef(ref) || !SUPPORTED.has(extname(ref))) continue
        if (seen.has(ref)) continue
        seen.add(ref)
        found.push(ref)
    }
    return found
}

/**
 * Map each source-relative path to a flat location inside the EPUB.
 *
 * Flattening is deliberate: a reference like `../../pics/a.png` is legal in
 * markdown but would escape the OEBPS directory if copied verbatim, producing
 * an archive that strict readers reject. Names are deduplicated by prefix so two
 * different directories can both contain `cover.png`.
 *
 * The prefix search loops rather than trying once: a manuscript holding
 * `x/2-cover.png`, `a/cover.png` and `b/cover.png` makes the third ref land on
 * `assets/2-cover.png`, which the first already owns, and one of the two images
 * would be overwritten in the archive with nothing said about it.
 */
export function planAssetPaths(refs: string[]): Map<string, string> {
    const plan = new Map<string, string>()
    const used = new Set<string>()
    refs.forEach((ref, i) => {
        const base = ref.split(/[/\\]/).pop() || ''
        // This charset is what lets package.ts and the chapter XHTML embed the
        // packed name without escaping it; test/assets.test.ts pins it.
        const safe = base.replace(/[^A-Za-z0-9._-]/g, '_') || `asset${i}`
        let target = `assets/${safe}`
        for (let n = 1; used.has(target); n++) target = `assets/${n}-${safe}`
        used.add(target)
        plan.set(ref, target)
    })
    return plan
}

/** Rewrite img src values to their planned in-EPUB paths. */
export function rewriteAssetRefs(xhtml: string, plan: Map<string, string>): string {
    return xhtml.replace(IMG_SRC, (whole, head: string, quote: string, ref: string) => {
        const target = plan.get(decodeRef(ref))
        return target ? `${head}${quote}${target}${quote}` : whole
    })
}

const IMG_TAG = /<img\b[^>]*?\/?>/gi
const SRC_ATTR = /\bsrc=(["'])(.*?)\1/i
const ALT_ATTR = /\balt=(["'])(.*?)\1/i

/**
 * Rewrite resolved images and remove the ones that could not be read.
 *
 * Dropping matters: an <img> whose file never made it into the archive renders
 * as a broken-image icon in the reader. Rewriting the src alone is not enough,
 * because an unresolved reference keeps its original path and points at a file
 * the archive does not contain. Alt text is preserved so the reader still knows
 * something was meant to be there.
 */
export function applyAssetPlan(xhtml: string, resolved: Map<string, string>): string {
    return xhtml.replace(IMG_TAG, tag => {
        const src = SRC_ATTR.exec(tag)
        if (!src) return tag
        const ref = decodeRef(src[2]!)
        if (!isLocalRef(ref) || !SUPPORTED.has(extname(ref))) return tag

        const target = resolved.get(ref)
        if (target) return tag.replace(SRC_ATTR, (_m, q: string) => `src=${q}${target}${q}`)

        const alt = ALT_ATTR.exec(tag)?.[2] ?? ''
        return alt ? `<span class="missing-image">${alt}</span>` : ''
    })
}
