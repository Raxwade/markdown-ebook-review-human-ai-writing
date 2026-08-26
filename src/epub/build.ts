// The whole pipeline (spec §3, §4). Pure: no `vscode`, no filesystem.
// Asset bytes arrive through the `readAsset` callback so the caller owns all I/O.
import { createHash } from 'node:crypto'
import { strToU8 } from 'fflate'
import type { Config } from '../config'
import { DEFAULTS } from '../config'
import type { UiLocale } from '../i18n'
import { parseFrontmatter } from './frontmatter'
import { parseMarkdownReferences, type MarkdownReferences } from './markdown'
import { splitChapters } from './split'
import { renderChapter, plainText, DEFAULT_CSS } from './render'
import { collectAssetRefs, planAssetPaths, applyAssetPlan } from './assets'
import { buildNav, buildNcx, buildOpf, CONTAINER_XML, type ManifestChapter } from './package'
import { packEpub, PREVIEW_LEVEL, EXPORT_LEVEL, type ZipFiles } from './zip'

export interface BuildInput {
    markdown: string
    /** Partial config; anything missing falls back to spec §6 defaults. */
    config?: Partial<Config>
    /** Filename without extension, used to infer a title as the last resort. */
    basename?: string
    /**
     * A stable identity for the source document, used only to derive
     * `dc:identifier`. Workspace-relative with `/` separators when the caller can
     * manage it, so two clones of the same repository agree; an absolute path
     * otherwise. Omit for a document that has no path (unsaved buffers), and the
     * derivation falls back to `basename`.
     */
    sourcePath?: string
    /** Returns bytes for a source-relative path, or null when unreadable. */
    readAsset?: (relativePath: string) => Uint8Array | null
    /** Overrides DEFAULT_CSS when `mdepub.css` points at a file. */
    css?: string
    /** ISO 8601; injectable to keep builds reproducible in tests. */
    modified?: string
    /** Picks the zip compression level (spec §2.3). Defaults to preview/STORE. */
    mode?: 'preview' | 'export'
    /** Display language for build warnings; book metadata still uses config.lang. */
    interfaceLocale?: UiLocale
}

export interface BuildResult {
    bytes: Uint8Array
    /**
     * Per-chapter content hashes. Nothing consumes these yet — they exist so the
     * §4.3 optimisation (swap one iframe instead of reloading the book) stays
     * available without a pipeline change. Do not remove as dead code.
     */
    chapterHashes: string[]
    /**
     * Each chapter's 0-based start line in the document, parallel to `chapters`.
     *
     * The panel needs it to jump to a note: a note carries a line, and only this
     * side knows which chapter a line landed in. Without it the panel can only
     * reach notes in the chapter foliate happens to have rendered, because a CFI
     * does not exist until then.
     */
    chapterStartLines: number[]
    chapters: ManifestChapter[]
    assets: string[]
    warnings: string[]
    title: string
}

const STYLESHEET = 'style.css'
const sha1 = (data: string | Uint8Array) => createHash('sha1').update(data).digest('hex')

/** frontmatter > settings > first `#` heading, then filename (spec §6). */
function resolveTitle(
    meta: Record<string, string | undefined>,
    chapters: { title: string; level: number }[],
    basename?: string,
    references?: MarkdownReferences,
): string {
    // Frontmatter is a literal string the user wrote, not markdown, so it is used
    // as typed. A heading is markdown and has to be reduced to its text first —
    // and a heading that is *only* an image reduces to nothing, which is why the
    // chain keeps falling through rather than accepting the first match.
    if (meta.title) return meta.title
    const fromHeadings = [
        ...chapters.filter(c => c.level === 1),
        ...chapters,
    ].map(c => plainText(c.title, references)).find(Boolean)
    return fromHeadings || basename || 'Untitled'
}

/**
 * `dc:identifier` is what a reader uses to decide whether two files are the same
 * publication — a shared one makes a library merge reading positions and
 * annotations across unrelated books. So an explicit `identifier:` in the
 * frontmatter (`isbn:…`, a DOI, a URN) wins outright.
 *
 * The fallback is keyed on where the document lives, not only on what it says.
 * Metadata alone does not distinguish enough: two unrelated `index.md` files
 * with the same `# Notes` heading, no author and the default language hash
 * identically however different their contents are. What it deliberately does
 * *not* include is the text — an identifier that changed on every keystroke
 * would defeat the point, which is that a book stays the same publication while
 * it is edited. The cost is that moving or renaming the file mints a new one; a
 * manuscript that must outlive a rename should declare its own in frontmatter.
 *
 * The parts are joined with U+0000 because no field can contain it: without a
 * separator that cannot appear in the data, ('AB', 'C') and ('A', 'BC') hash the
 * same. Written as an escape, not as a literal — a raw NUL in a .ts file makes
 * git and grep treat the source as binary.
 */
function resolveIdentifier(
    explicit: string | undefined,
    parts: { title: string; lang: string; author: string | null; basename?: string; sourcePath?: string },
): string {
    if (explicit?.trim()) return explicit.trim()
    const source = parts.sourcePath ?? parts.basename ?? ''
    const h = sha1([parts.title, parts.lang, parts.author ?? '', source].join('\u0000'))
    // Shaped as a v4 UUID (version nibble 4, variant 8) so readers that parse
    // urn:uuid: rather than treating it as an opaque string still accept it.
    return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function build(input: BuildInput): BuildResult {
    const config: Config = { ...DEFAULTS, ...input.config }
    const warnings: string[] = []
    const interfaceLocale = input.interfaceLocale ?? 'en'

    const { meta, body, bodyStartLine, warnings: fmWarnings } = parseFrontmatter(
        input.markdown,
        interfaceLocale,
    )
    warnings.push(...fmWarnings)

    const lang = meta.lang || config.lang
    const author = meta.author ?? config.author
    const chapters = splitChapters(body, config.splitLevel)
    const references = parseMarkdownReferences(body)
    const title = resolveTitle(meta, chapters, input.basename, references)

    // Render every chapter, then collect asset references across all of them so
    // one plan covers the whole book and a shared image is packed once.
    // The chapter's own heading still renders as markdown inside the body; what
    // needs reducing is the label, which lands in plain-text slots only.
    // Line numbers ride along in preview builds only: they are how a highlight
    // in the panel resolves back to a line in the .md, and an exported book has
    // no use for them.
    const tagLines = input.mode !== 'export'
    const rendered = chapters.map((c, i) => {
        const label = plainText(c.title, references) || title
        return {
            id: `ch${String(i + 1).padStart(3, '0')}`,
            title: label,
            startLine: bodyStartLine + c.startLine,
            xhtml: renderChapter(c.markdown, label, {
                lang,
                stylesheet: STYLESHEET,
                lineOffset: tagLines ? bodyStartLine + c.startLine : undefined,
                references,
            }),
        }
    })

    const coverRef = meta.cover ?? config.cover
    const allRefs = [
        ...(coverRef ? [coverRef] : []),
        ...rendered.flatMap(r => collectAssetRefs(r.xhtml)),
    ]
    const plan = planAssetPaths([...new Set(allRefs)])

    const files: ZipFiles = {}
    const packedAssets: string[] = []
    for (const [ref, target] of plan) {
        const bytes = input.readAsset?.(ref) ?? null
        if (!bytes) {
            warnings.push(interfaceLocale === 'zh-TW'
                ? `找不到圖片，已略過：${ref}`
                : `Image not found and was skipped: ${ref}`)
            continue
        }
        files[`OEBPS/${target}`] = bytes
        packedAssets.push(target)
    }

    // Images that failed to load are removed from the XHTML entirely. Leaving
    // the element behind — even with its original src — renders a broken-image
    // icon in the reader, because that file is not in the archive either.
    const packed = new Set(packedAssets)
    const livePlan = new Map([...plan].filter(([, target]) => packed.has(target)))

    const manifestChapters: ManifestChapter[] = rendered.map(r => ({
        id: r.id, href: `${r.id}.xhtml`, title: r.title,
    }))

    const chapterHashes: string[] = []
    for (const r of rendered) {
        const xhtml = applyAssetPlan(r.xhtml, livePlan)
        chapterHashes.push(sha1(xhtml))
        files[`OEBPS/${r.id}.xhtml`] = strToU8(xhtml)
    }

    const cover = coverRef ? livePlan.get(coverRef) ?? null : null
    const pkg = {
        title, author, lang,
        identifier: resolveIdentifier(meta.identifier, {
            title, lang, author, basename: input.basename, sourcePath: input.sourcePath,
        }),
        modified: input.modified ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        chapters: manifestChapters,
        assets: packedAssets,
        cover,
        stylesheet: STYLESHEET,
    }

    files['META-INF/container.xml'] = strToU8(CONTAINER_XML)
    files['OEBPS/content.opf'] = strToU8(buildOpf(pkg))
    files['OEBPS/nav.xhtml'] = strToU8(buildNav(pkg))
    files['OEBPS/toc.ncx'] = strToU8(buildNcx(pkg))
    files[`OEBPS/${STYLESHEET}`] = strToU8(input.css ?? DEFAULT_CSS)

    return {
        bytes: packEpub(files, input.mode === 'export' ? EXPORT_LEVEL : PREVIEW_LEVEL),
        chapterHashes,
        chapterStartLines: rendered.map(r => r.startLine),
        chapters: manifestChapters,
        assets: packedAssets,
        warnings,
        title,
    }
}

/** Preview path: STORE — speed over size, bytes never leave memory. */
export const buildForPreview = (input: BuildInput): BuildResult =>
    build({ ...input, mode: 'preview' })

/** Export path: DEFLATE — size over speed, this one hits the disk. */
export const buildForExport = (input: BuildInput): BuildResult =>
    build({ ...input, mode: 'export' })
