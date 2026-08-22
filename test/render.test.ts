import { test } from 'node:test'
import assert from 'node:assert/strict'
import { XMLValidator } from 'fast-xml-parser'
import { renderChapter, renderFragment, plainText } from '../src/epub/render'

/** Well-formedness is checked with a real parser — eyeballing output is not a test. */
function assertWellFormed(xml: string, label: string) {
    const result = XMLValidator.validate(xml, { allowBooleanAttributes: false })
    if (result !== true) {
        assert.fail(`${label} is not well-formed XML: ${result.err.msg} (line ${result.err.line})`)
    }
}

const opts = { lang: 'zh-TW', stylesheet: 'style.css' }

test('plainText reduces inline markdown to its label text', () => {
    assert.equal(plainText('My *great* [book](https://example.com)'), 'My great book')
    assert.equal(plainText('第一章 `code` 與 **粗體**'), '第一章 code 與 粗體')
    assert.equal(plainText('plain'), 'plain')
})

test('plainText hands back characters, not entities', () => {
    // markdown-it escapes for HTML; everything downstream escapes again on the
    // way into XML, so leaving the entities on produces &amp;amp; in dc:title.
    assert.equal(plainText('Tom & Jerry'), 'Tom & Jerry')
    assert.equal(plainText('a < b > c'), 'a < b > c')
    assert.equal(plainText('&copy; 2026'), '© 2026')
})

test('plainText leaves nothing behind for a heading that is only an image', () => {
    // The caller has to fall through to another title source rather than emit an
    // empty <dc:title>.
    assert.equal(plainText('![封面](cover.png)'), '')
    assert.equal(plainText(''), '')
})

test('a rendered chapter is well-formed XHTML', () => {
    assertWellFormed(renderChapter('# Title\n\ntext\n', 'Title', opts), 'chapter')
})

test('raw HTML in the source is escaped, not passed through', () => {
    // One raw <br> would make the document non-well-formed and strict readers
    // reject the entire chapter, not just that element.
    const xml = renderChapter('a <br> b <b>bold</b> <script>x</script>\n', 'T', opts)
    assert.ok(!xml.includes('<br>'))
    assert.ok(!xml.includes('<script>'))
    assertWellFormed(xml, 'chapter with raw html')
})

test('named entities become literal characters', () => {
    // &nbsp; and friends are invalid in XHTML without a DTD; markdown-it decodes
    // them, and this test fails loudly if that ever stops being true.
    const frag = renderFragment('a&nbsp;b &copy; c &hellip;\n')
    assert.ok(!/&[a-zA-Z]+;/.test(frag.replace(/&(amp|lt|gt|quot|apos);/g, '')),
        `unexpected named entity in: ${frag}`)
    assert.ok(frag.includes(' '))
    assert.ok(frag.includes('©'))
})

test('bare ampersands are escaped', () => {
    const xml = renderChapter('AT&T and R&D\n', 'T', opts)
    assert.ok(xml.includes('AT&amp;T'))
    assertWellFormed(xml, 'chapter with ampersands')
})

test('void elements are self-closed for XHTML', () => {
    const xml = renderChapter('![alt](a.png)\n\n---\n', 'T', opts)
    assert.match(xml, /<img[^>]*\/>/)
    assert.match(xml, /<hr\s*\/>/)
    assertWellFormed(xml, 'chapter with void elements')
})

test('tables, code fences and blockquotes stay well-formed', () => {
    const src = [
        '| a | b |', '|---|---|', '| 1 | 2 |', '',
        '```js', 'const x = a < b && c > d;', '```', '',
        '> quoted <tag> & more', '',
        '- item 1', '- item 2', '',
    ].join('\n')
    assertWellFormed(renderChapter(src, 'T', opts), 'chapter with mixed blocks')
})

test('a title containing markup is escaped in the head', () => {
    const xml = renderChapter('text\n', 'A & B <c> "d"', opts)
    assert.ok(xml.includes('<title>A &amp; B &lt;c&gt; &quot;d&quot;</title>'))
    assertWellFormed(xml, 'chapter with hostile title')
})

test('an empty chapter is still well-formed', () => {
    assertWellFormed(renderChapter('', 'Empty', opts), 'empty chapter')
})

test('the declared language reaches the document element', () => {
    const xml = renderChapter('x\n', 'T', { lang: 'ja', stylesheet: 'style.css' })
    assert.ok(xml.includes('xml:lang="ja"'))
})
