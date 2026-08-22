// EPUB 3 container/package documents (spec §3).
import { escapeXml } from './text'
import { MEDIA_TYPES, extname } from './assets'

export interface ManifestChapter {
    id: string
    href: string
    title: string
}

export interface PackageInput {
    title: string
    author: string | null
    lang: string
    identifier: string
    /** ISO 8601. Passed in rather than read from the clock so builds are reproducible. */
    modified: string
    chapters: ManifestChapter[]
    /** In-EPUB paths, e.g. 'assets/a.png'. */
    assets: string[]
    /** In-EPUB path of the cover image, if any. Must also appear in `assets`. */
    cover: string | null
    stylesheet: string
}

export const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

export function buildOpf(input: PackageInput): string {
    const { title, author, lang, identifier, modified, chapters, assets, cover, stylesheet } = input

    // Manifest ids are positional rather than derived from the href. Mangling
    // the path (`href.replace(/[^A-Za-z0-9]/g, '-')`) is not injective — both
    // `a_b.png` and `a-b.png` mangle to the same string — and duplicate ids make
    // the package document invalid. `img` cannot collide with the fixed ids
    // below or with the `ch###` chapters.
    const assetIds = new Map(assets.map((href, i) => [href, `img${i + 1}`]))

    const creator = author
        ? `\n    <dc:creator id="creator">${escapeXml(author)}</dc:creator>`
        : ''
    // Only emit the legacy cover meta when the image really is in the manifest;
    // pointing it at an id that does not exist is worse than omitting it.
    const coverId = cover ? assetIds.get(cover) : undefined
    const coverMeta = coverId
        ? `\n    <meta name="cover" content="${coverId}"/>`
        : ''

    const assetItems = assets.map(href => {
        const type = MEDIA_TYPES[extname(href)] ?? 'application/octet-stream'
        const props = href === cover ? ' properties="cover-image"' : ''
        return `    <item id="${assetIds.get(href)}" href="${escapeXml(href)}" media-type="${type}"${props}/>`
    }).join('\n')

    const chapterItems = chapters.map(c =>
        `    <item id="${escapeXml(c.id)}" href="${escapeXml(c.href)}" media-type="application/xhtml+xml"/>`
    ).join('\n')

    const spine = chapters.map(c => `    <itemref idref="${escapeXml(c.id)}"/>`).join('\n')

    return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(lang)}</dc:language>${creator}
    <meta property="dcterms:modified">${escapeXml(modified)}</meta>${coverMeta}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="${escapeXml(stylesheet)}" media-type="text/css"/>
${chapterItems}${assetItems ? '\n' + assetItems : ''}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`
}

export function buildNav(input: Pick<PackageInput, 'title' | 'lang' | 'chapters'>): string {
    const items = input.chapters.map(c =>
        `      <li><a href="${escapeXml(c.href)}">${escapeXml(c.title)}</a></li>`
    ).join('\n')
    const contentsLabel = /^(?:zh|ja)(?:-|$)/i.test(input.lang) ? '目次' : 'Contents'
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(input.lang)}" lang="${escapeXml(input.lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(input.title)}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${contentsLabel}</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`
}

/** NCX is superseded in EPUB 3 but several readers still look for it. */
export function buildNcx(input: Pick<PackageInput, 'title' | 'lang' | 'identifier' | 'chapters'>): string {
    const points = input.chapters.map((c, i) =>
        `    <navPoint id="np-${escapeXml(c.id)}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${escapeXml(c.href)}"/>
    </navPoint>`
    ).join('\n')
    return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeXml(input.lang)}">
  <head>
    <meta name="dtb:uid" content="${escapeXml(input.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(input.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`
}
