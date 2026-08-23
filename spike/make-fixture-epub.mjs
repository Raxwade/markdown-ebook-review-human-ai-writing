// M0 fixture: a multi-chapter EPUB to load in the spike.
// Deliberately in the same shape as the real pipeline will emit (spec §3 epub/package.ts)
// so the spike exercises something representative, not a toy.
import { zipSync, strToU8 } from 'fflate'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CHAPTERS = 60
const PARAS_PER_CHAPTER = 12

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const body = i => {
    const paras = []
    for (let p = 0; p < PARAS_PER_CHAPTER; p++) {
        // Mixed CJK/Latin, roughly novel-length paragraphs — pagination needs real text to break.
        paras.push(`<p>第 ${i} 章第 ${p + 1} 段。` +
            '這是一段用來測試分頁的文字，長度接近一般段落，混雜 Latin text so the line breaker has both to chew on. '.repeat(3) +
            '</p>')
    }
    return paras.join('\n')
}

const chapterDoc = i => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-TW">
<head><meta charset="utf-8"/><title>${esc(`第 ${i} 章`)}</title>
<link rel="stylesheet" href="style.css"/></head>
<body><section epub:type="chapter"><h1>第 ${i} 章</h1>
${body(i)}
</section></body></html>`

const ids = Array.from({ length: CHAPTERS }, (_, n) => `ch${String(n + 1).padStart(3, '0')}`)

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="zh-TW">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:00000000-0000-4000-8000-000000000000</dc:identifier>
    <dc:title>M0 分頁測試稿</dc:title>
    <dc:language>zh-TW</dc:language>
    <dc:creator>Markdown Ebook Review spike</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${ids.map(id => `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${ids.map(id => `    <itemref idref="${id}"/>`).join('\n')}
  </spine>
</package>`

const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-TW">
<head><meta charset="utf-8"/><title>目次</title></head>
<body><nav epub:type="toc" id="toc"><h1>目次</h1><ol>
${ids.map((id, n) => `<li><a href="${id}.xhtml">第 ${n + 1} 章</a></li>`).join('\n')}
</ol></nav></body></html>`

const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-TW">
  <head><meta name="dtb:uid" content="urn:uuid:00000000-0000-4000-8000-000000000000"/></head>
  <docTitle><text>M0 分頁測試稿</text></docTitle>
  <navMap>
${ids.map((id, n) => `    <navPoint id="np${n + 1}" playOrder="${n + 1}"><navLabel><text>第 ${n + 1} 章</text></navLabel><content src="${id}.xhtml"/></navPoint>`).join('\n')}
  </navMap>
</ncx>`

const css = `html { font-family: system-ui, "Noto Sans CJK TC", sans-serif; }
body { margin: 0; line-height: 1.7; }
h1 { font-size: 1.4em; margin: 1.5em 0 0.8em; }
p { margin: 0 0 1em; text-align: justify; }`

const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

// mimetype MUST be the first entry and STORED (level 0) — readers check bytes 30..60.
const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/toc.ncx': strToU8(ncx),
    'OEBPS/style.css': strToU8(css),
}
for (const [n, id] of ids.entries()) files[`OEBPS/${id}.xhtml`] = strToU8(chapterDoc(n + 1))

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixture.epub')
const bytes = zipSync(files, { level: 6 })
writeFileSync(out, bytes)
console.log(`wrote ${out}  ${CHAPTERS} chapters  ${(bytes.length / 1024).toFixed(1)} KB`)
