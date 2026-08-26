import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8, strToU8 } from 'fflate'
import { XMLValidator } from 'fast-xml-parser'
import { build, buildForExport, buildForPreview } from '../src/epub/build'

const MODIFIED = '2026-01-01T00:00:00Z'
const open = (bytes: Uint8Array) => unzipSync(bytes)
const text = (files: Record<string, Uint8Array>, name: string) => {
    const f = files[name]
    assert.ok(f, `missing ${name} — have: ${Object.keys(files).join(', ')}`)
    return strFromU8(f!)
}

const SAMPLE = `---
title: 測試書
author: Example Author
lang: zh-TW
---

# 測試書

前言。

## 第一章

內容一。

## 第二章

內容二。
`

test('produces an archive with every document an EPUB needs', () => {
    const files = open(build({ markdown: SAMPLE, modified: MODIFIED }).bytes)
    for (const name of [
        'mimetype', 'META-INF/container.xml', 'OEBPS/content.opf',
        'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/style.css',
    ]) assert.ok(files[name], `missing ${name}`)
})

test('every generated XML document is well-formed', () => {
    const files = open(build({ markdown: SAMPLE, modified: MODIFIED }).bytes)
    for (const name of Object.keys(files)) {
        if (name === 'mimetype' || name.endsWith('.css') || name.startsWith('OEBPS/assets/')) continue
        const result = XMLValidator.validate(text(files, name))
        if (result !== true) assert.fail(`${name}: ${result.err.msg} (line ${result.err.line})`)
    }
})

test('chapters, spine and TOC all agree', () => {
    const result = build({ markdown: SAMPLE, modified: MODIFIED })
    const files = open(result.bytes)
    const opf = text(files, 'OEBPS/content.opf')

    assert.deepEqual(result.chapters.map(c => c.title), ['測試書', '第一章', '第二章'])
    for (const c of result.chapters) {
        assert.ok(files[`OEBPS/${c.href}`], `spine references missing file ${c.href}`)
        assert.ok(opf.includes(`idref="${c.id}"`), `${c.id} not in spine`)
        assert.ok(opf.includes(`href="${c.href}"`), `${c.href} not in manifest`)
    }
    const nav = text(files, 'OEBPS/nav.xhtml')
    for (const c of result.chapters) assert.ok(nav.includes(c.href), `${c.href} missing from nav`)
})

test('metadata precedence: frontmatter beats settings', () => {
    const opf = text(open(build({
        markdown: SAMPLE,
        config: { author: 'Settings Author', lang: 'en' },
        modified: MODIFIED,
    }).bytes), 'OEBPS/content.opf')
    assert.ok(opf.includes('<dc:creator id="creator">Example Author</dc:creator>'))
    assert.ok(opf.includes('<dc:title>測試書</dc:title>'))
    assert.ok(opf.includes('<dc:language>zh-TW</dc:language>'))
})

test('settings beat inference when frontmatter is absent', () => {
    const opf = text(open(build({
        markdown: '# From Heading\n\ntext\n',
        config: { author: 'Settings Author', lang: 'ja' },
        modified: MODIFIED,
    }).bytes), 'OEBPS/content.opf')
    assert.ok(opf.includes('Settings Author'))
    assert.ok(opf.includes('<dc:language>ja</dc:language>'))
    assert.ok(opf.includes('<dc:title>From Heading</dc:title>'), 'title should come from the first #')
})

test('the filename is the last-resort title', () => {
    const result = build({ markdown: 'no headings at all\n', basename: '範例書', modified: MODIFIED })
    assert.equal(result.title, '範例書')
})

test('build returns one content hash per chapter and they track content', () => {
    // Nothing consumes these yet; they exist so the §4.3 optimisation stays
    // available without a pipeline change (see CLAUDE.md).
    const a = build({ markdown: SAMPLE, modified: MODIFIED })
    const b = build({ markdown: SAMPLE, modified: MODIFIED })
    assert.equal(a.chapterHashes.length, a.chapters.length)
    assert.deepEqual(a.chapterHashes, b.chapterHashes, 'same input must hash the same')

    const changed = build({ markdown: SAMPLE.replace('內容二。', '內容二改了。'), modified: MODIFIED })
    assert.equal(changed.chapterHashes[0], a.chapterHashes[0], 'untouched chapter should keep its hash')
    assert.notEqual(changed.chapterHashes[2], a.chapterHashes[2], 'edited chapter should change hash')
})

test('images are packed, rewritten, and declared in the manifest', () => {
    const png = strToU8('not-really-a-png')
    const result = build({
        markdown: '# T\n\n![alt](pics/a.png)\n',
        readAsset: ref => (ref === 'pics/a.png' ? png : null),
        modified: MODIFIED,
    })
    const files = open(result.bytes)
    assert.deepEqual(result.assets, ['assets/a.png'])
    assert.ok(files['OEBPS/assets/a.png'], 'image not packed')
    assert.ok(text(files, 'OEBPS/content.opf').includes('media-type="image/png"'))
    assert.ok(text(files, 'OEBPS/ch001.xhtml').includes('src="assets/a.png"'))
})

test('document-wide reference definitions survive chapter splitting', () => {
    const result = build({
        markdown: [
            '# My [book][title]',
            '',
            'See [the appendix][appendix]. ![Cover][cover]',
            '',
            '## Appendix',
            '',
            '[title]: https://example.com/title',
            '[appendix]: https://example.com/appendix',
            '[cover]: cover.png',
        ].join('\n'),
        readAsset: ref => (ref === 'cover.png' ? strToU8('image') : null),
        modified: MODIFIED,
    })
    const files = open(result.bytes)
    const first = text(files, 'OEBPS/ch001.xhtml')
    assert.equal(result.title, 'My book')
    assert.equal(result.chapters[0]!.title, 'My book')
    assert.match(first, /href="https:\/\/example\.com\/title">book<\/a>/)
    assert.match(first, /href="https:\/\/example\.com\/appendix">the appendix<\/a>/)
    assert.match(first, /src="assets\/cover\.png"/)
    assert.ok(files['OEBPS/assets/cover.png'], 'reference image was not packaged')
})

test('an unreadable image warns and leaves no dangling reference', () => {
    const result = build({
        markdown: '# T\n\n![alt](missing.png)\n',
        readAsset: () => null,
        modified: MODIFIED,
    })
    assert.equal(result.assets.length, 0)
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0]!, /missing\.png/)

    // The <img> element itself must go. An earlier version only checked that the
    // rewritten 'assets/…' path was absent, which passed while the original src
    // survived — the reader then drew a broken-image icon. Assert on the tag.
    const chapter = text(open(result.bytes), 'OEBPS/ch001.xhtml')
    assert.ok(!chapter.includes('<img'), `dangling img element: ${chapter}`)
    assert.ok(!chapter.includes('missing.png'), 'dangling href')
    assert.ok(chapter.includes('alt'), 'alt text should survive as a span')
})

test('resolved and unresolved images in the same chapter are handled independently', () => {
    const result = build({
        markdown: '# T\n\n![ok](good.png)\n\n![gone](bad.png)\n',
        readAsset: ref => (ref === 'good.png' ? strToU8('img') : null),
        modified: MODIFIED,
    })
    const chapter = text(open(result.bytes), 'OEBPS/ch001.xhtml')
    assert.ok(chapter.includes('src="assets/good.png"'), 'resolved image should be rewritten')
    assert.equal((chapter.match(/<img/g) ?? []).length, 1, 'exactly one img should remain')
    assert.ok(!chapter.includes('bad.png'))
})

test('remote images are left alone rather than stripped', () => {
    const result = build({
        markdown: '# T\n\n![x](https://example.com/a.png)\n',
        readAsset: () => null,
        modified: MODIFIED,
    })
    const chapter = text(open(result.bytes), 'OEBPS/ch001.xhtml')
    assert.ok(chapter.includes('https://example.com/a.png'), 'remote refs are not ours to remove')
    assert.equal(result.warnings.length, 0)
})

test('a cover from frontmatter is marked cover-image', () => {
    const result = build({
        markdown: '---\ntitle: T\ncover: cover.png\n---\n\n# T\n\ntext\n',
        readAsset: () => strToU8('img'),
        modified: MODIFIED,
    })
    const opf = text(open(result.bytes), 'OEBPS/content.opf')
    assert.ok(opf.includes('properties="cover-image"'), 'cover not flagged')
    assert.ok(opf.includes('<meta name="cover"'), 'legacy cover meta missing for EPUB2 readers')
})

test('an image whose name needs XML escaping is still packed', () => {
    // markdown-it renders ![](a&b.png) as src="a&amp;b.png"; the reader used to
    // be handed the escaped text and report the file as missing.
    const result = build({
        markdown: '# T\n\n![alt](a&b.png)\n',
        readAsset: ref => (ref === 'a&b.png' ? strToU8('img') : null),
        modified: MODIFIED,
    })
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(result.assets, ['assets/a_b.png'])
    const chapter = text(open(result.bytes), 'OEBPS/ch001.xhtml')
    assert.ok(chapter.includes('src="assets/a_b.png"'), chapter)
})

test('manifest ids stay unique for names that mangle the same', () => {
    // 'a-b.png' and 'a_b.png' both became id="a-assets-a-b-png", and duplicate
    // ids make the package document invalid.
    const result = build({
        markdown: '# T\n\n![x](a-b.png)\n\n![y](a_b.png)\n',
        readAsset: () => strToU8('img'),
        modified: MODIFIED,
    })
    const opf = text(open(result.bytes), 'OEBPS/content.opf')
    const ids = [...opf.matchAll(/<item id="([^"]+)"/g)].map(m => m[1]!)
    assert.equal(result.assets.length, 2)
    assert.equal(new Set(ids).size, ids.length, `duplicate manifest ids: ${ids.join(', ')}`)
    assert.equal(XMLValidator.validate(opf), true)
})

test('the cover meta points at an id the manifest actually declares', () => {
    const result = build({
        markdown: '---\ntitle: T\ncover: art/封面 圖.png\n---\n\n# T\n\n![x](a.png)\n',
        readAsset: () => strToU8('img'),
        modified: MODIFIED,
    })
    const opf = text(open(result.bytes), 'OEBPS/content.opf')
    const coverId = /<meta name="cover" content="([^"]+)"/.exec(opf)?.[1]
    assert.ok(coverId, `no cover meta: ${opf}`)
    assert.match(opf, new RegExp(`<item id="${coverId}"[^>]*properties="cover-image"`))
})

test('an explicit frontmatter identifier is used verbatim', () => {
    const opf = text(open(build({
        markdown: '---\ntitle: T\nidentifier: isbn:9781234567897\n---\n\n# T\n\ntext\n',
        modified: MODIFIED,
    }).bytes), 'OEBPS/content.opf')
    assert.ok(opf.includes('>isbn:9781234567897</dc:identifier>'), opf)
})

test('books that differ only in author or filename get different identifiers', () => {
    // A shared dc:identifier makes a library treat two books as one file and
    // merge their reading positions, so title+lang alone is not enough.
    const idOf = (input: Parameters<typeof build>[0]) =>
        /<dc:identifier id="pub-id">([^<]+)</.exec(
            text(open(build({ ...input, modified: MODIFIED }).bytes), 'OEBPS/content.opf'))?.[1]

    const base = { markdown: '# 手記\n\ntext\n', basename: 'a' }
    const ids = [
        idOf(base),
        idOf({ ...base, config: { author: 'Example Author' } }),
        idOf({ ...base, config: { author: 'Someone Else' } }),
        idOf({ ...base, basename: 'b' }),
    ]
    assert.ok(ids.every(Boolean), `identifier missing: ${ids.join(', ')}`)
    assert.equal(new Set(ids).size, ids.length, `collision: ${ids.join(', ')}`)
    assert.equal(idOf(base), ids[0], 'the same book must keep the same identifier')
    assert.match(ids[0]!, /^urn:uuid:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
})

const identifierOf = (input: Parameters<typeof build>[0]) =>
    /<dc:identifier id="pub-id">([^<]+)</.exec(
        text(open(build({ ...input, modified: MODIFIED }).bytes), 'OEBPS/content.opf'))?.[1]

test('two unrelated documents with identical metadata get different identifiers', () => {
    // The reproduction: same heading, same default language, no author, and the
    // same filename. Metadata alone cannot tell these apart, so the derivation
    // has to be keyed on where the document lives.
    const a = identifierOf({ markdown: '# Notes\n\nOne project.\n', basename: 'index', sourcePath: 'alpha/index.md' })
    const b = identifierOf({ markdown: '# Notes\n\nA different project.\n', basename: 'index', sourcePath: 'beta/index.md' })
    assert.ok(a && b)
    assert.notEqual(a, b)
})

test('the identifier survives editing but not moving', () => {
    // Stability across edits is the whole point — an identifier that changed on
    // every keystroke would make a reader library treat each save as a new book.
    const at = (markdown: string, sourcePath: string) =>
        identifierOf({ markdown, basename: 'index', sourcePath })
    const original = at('# Notes\n\nfirst draft\n', 'alpha/index.md')
    assert.equal(at('# Notes\n\nfirst draft, revised at length\n', 'alpha/index.md'), original)
    assert.notEqual(at('# Notes\n\nfirst draft\n', 'moved/index.md'), original)
})

test('a document with no path still gets an identifier', () => {
    // Unsaved buffers have no stable identity to offer; the filename carries it.
    const id = identifierOf({ markdown: '# Notes\n\ntext\n', basename: 'Untitled-1' })
    assert.match(id!, /^urn:uuid:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
})

test('markdown in a heading is reduced to text for every label slot', () => {
    // dc:title, the nav document, the NCX and the chapter's own <title> are all
    // plain-text slots — the source leaked through verbatim and readers showed
    // the asterisks and brackets.
    const result = build({
        markdown: '# My *great* [book](https://example.com)\n\n本文\n\n## 第一章 `code` 與 **粗體**\n\n內容\n',
        modified: MODIFIED,
    })
    assert.equal(result.title, 'My great book')
    assert.deepEqual(result.chapters.map(c => c.title), ['My great book', '第一章 code 與 粗體'])

    const files = open(result.bytes)
    const opf = text(files, 'OEBPS/content.opf')
    assert.ok(opf.includes('<dc:title>My great book</dc:title>'), opf)
    for (const name of ['OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/ch001.xhtml', 'OEBPS/ch002.xhtml']) {
        const doc = text(files, name)
        assert.ok(!doc.includes('[book]'), `markdown link syntax survived into ${name}`)
        assert.ok(!doc.includes('**粗體**'), `markdown emphasis survived into ${name}`)
    }
    // The heading still renders as markdown in the body — only the label is reduced.
    assert.ok(text(files, 'OEBPS/ch001.xhtml').includes('<a href="https://example.com">'))
})

test('an ampersand in a heading is escaped exactly once', () => {
    // plainText undoes markdown-it's HTML escaping so the XML layer can do its
    // own. Skipping that step produced &amp;amp; in the reader's title bar.
    const files = open(build({ markdown: '# Tom & Jerry\n\ntext\n', modified: MODIFIED }).bytes)
    const opf = text(files, 'OEBPS/content.opf')
    assert.ok(opf.includes('<dc:title>Tom &amp; Jerry</dc:title>'), opf)
    assert.ok(!opf.includes('&amp;amp;'), 'double-escaped')
    assert.equal(XMLValidator.validate(opf), true)
    assert.equal(XMLValidator.validate(text(files, 'OEBPS/nav.xhtml')), true)
})

test('a heading that is only an image falls through to the next title source', () => {
    // It reduces to an empty string, which must not become an empty <dc:title>.
    const result = build({
        markdown: '# ![封面](cover.png)\n\n本文\n\n## 真正的標題\n\n內容\n',
        readAsset: () => strToU8('img'),
        modified: MODIFIED,
    })
    assert.equal(result.title, '真正的標題')
    assert.equal(result.chapters[0]!.title, '真正的標題', 'an unlabelled chapter borrows the book title')
    assert.ok(text(open(result.bytes), 'OEBPS/content.opf').includes('<dc:title>真正的標題</dc:title>'))
})

test('preview builds tag every block with its line in the document', () => {
    // This attribute is the whole basis for anchoring a highlight back to the
    // .md, so the numbers have to be real document lines — past the frontmatter,
    // past the chapter split, and past markdown-it's chapter-relative token.map.
    const lines = [
        '---', 'title: T', '---', '',   // 0-3
        '# 第一章', '',                  // 4-5
        '第一段。', '',                   // 6-7
        '## 第二節', '',                 // 8-9
        '第二段。', '',                   // 10-11
        '```js', 'const x = 1', '```',  // 12-14
    ]
    const files = open(build({ markdown: lines.join('\n'), modified: MODIFIED }).bytes)

    const tagged = (name: string) =>
        [...text(files, name).matchAll(/<(\w+)[^>]*\bdata-md-line="(\d+)"/g)]
            .map(m => [m[1], Number(m[2])] as const)

    assert.deepEqual(tagged('OEBPS/ch001.xhtml'), [['h1', 4], ['p', 6]])
    assert.deepEqual(tagged('OEBPS/ch002.xhtml'), [['h2', 8], ['p', 10], ['pre', 12]])

    // Every number must name the line it claims to.
    for (const name of ['OEBPS/ch001.xhtml', 'OEBPS/ch002.xhtml']) {
        for (const [, line] of tagged(name)) assert.ok(lines[line]!.trim().length > 0)
    }
})

test('a block that covers several lines says how many', () => {
    // The start alone cannot place a mark that is not on the block's first line,
    // and a fenced code block is nothing but inner lines. Without the end, the
    // webview looked the line up as a key, found no block, and drew nothing —
    // while the panel went on listing the note as healthy.
    const lines = [
        '# 第一章', '',                                  // 0-1
        '一段被硬換行的文字，', '第二行還是同一段。', '',    // 2-4
        '```js', 'const x = 1', 'const y = 2', '```',   // 5-8
    ]
    const files = open(build({ markdown: lines.join('\n'), modified: MODIFIED }).bytes)
    const spans = [...text(files, 'OEBPS/ch001.xhtml')
        .matchAll(/<(\w+)[^>]*\bdata-md-line="(\d+)"[^>]*\bdata-md-line-end="(\d+)"/g)]
        .map(m => [m[1], Number(m[2]), Number(m[3])] as const)

    assert.deepEqual(spans, [['h1', 0, 1], ['p', 2, 4], ['pre', 5, 9]])

    // The span is what a line is tested against, so it has to *contain* the
    // inner lines — end is exclusive, as markdown-it's token.map is.
    const covering = (line: number) => spans.filter(([, s, e]) => s <= line && line < e).at(-1)?.[0]
    assert.equal(covering(3), 'p', 'the second line of a wrapped paragraph')
    assert.equal(covering(6), 'pre', 'a line inside the fence')
    assert.equal(covering(7), 'pre', 'the last line inside the fence')
})

test('the build reports where each chapter starts', () => {
    // The panel turns a note's line into a chapter with this, which is the only
    // way it can reach a note in a section foliate has not rendered — until it
    // renders, there is no CFI to navigate to. Past the frontmatter, and one
    // entry per chapter, in chapter order, or it indexes the wrong TOC item.
    const lines = [
        '---', 'title: T', '---', '',   // 0-3
        '# 第一章', '',                  // 4-5
        '內文。', '',                    // 6-7
        '## 第二節', '',                 // 8-9
        '內文。', '',                    // 10-11
        '## 第三節', '',                 // 12-13
        '內文。',                        // 14
    ]
    const result = build({ markdown: lines.join('\n'), modified: MODIFIED })

    assert.deepEqual(result.chapterStartLines, [4, 8, 12])
    assert.equal(result.chapterStartLines.length, result.chapters.length)
    // Every number must name the heading that opens its chapter.
    for (const line of result.chapterStartLines) assert.match(lines[line]!, /^#/)
})

test('exported builds carry no line bookkeeping', () => {
    const files = open(buildForExport({ markdown: '# A\n\ntext\n', modified: MODIFIED }).bytes)
    assert.ok(!text(files, 'OEBPS/ch001.xhtml').includes('data-md-line'))
})

test('export compresses, preview stores', () => {
    const input = { markdown: SAMPLE.repeat(20), modified: MODIFIED }
    const previewBytes = buildForPreview(input).bytes
    const exportBytes = buildForExport(input).bytes
    assert.ok(exportBytes.length < previewBytes.length,
        `export ${exportBytes.length} should be smaller than preview ${previewBytes.length}`)
})

test('the same input always produces the same bytes', () => {
    const input = { markdown: SAMPLE, modified: MODIFIED }
    assert.deepEqual(buildForExport(input).bytes, buildForExport(input).bytes)
})

test('hostile frontmatter cannot break the OPF', () => {
    const opf = text(open(build({
        markdown: '---\ntitle: \'A & B <injected/> "q"\'\nauthor: \'</dc:creator><script/>\'\n---\n\ntext\n',
        modified: MODIFIED,
    }).bytes), 'OEBPS/content.opf')
    assert.equal(XMLValidator.validate(opf), true, 'injection made the OPF non-well-formed')
    assert.ok(!opf.includes('<injected/>'))
})

test('an empty document still builds a valid EPUB', () => {
    const files = open(build({ markdown: '', basename: 'empty', modified: MODIFIED }).bytes)
    assert.ok(files['OEBPS/content.opf'])
    assert.equal(XMLValidator.validate(text(files, 'OEBPS/content.opf')), true)
})
