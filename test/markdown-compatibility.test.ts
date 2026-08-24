import { test } from 'node:test'
import assert from 'node:assert/strict'
import { XMLValidator } from 'fast-xml-parser'
import { unzipSync, strFromU8 } from 'fflate'
import { buildForExport, buildForPreview } from '../src/epub/build'
import { renderChapter, renderFragment } from '../src/epub/render'
import { splitChapters } from '../src/epub/split'

const rendered = (source: string): string => renderFragment(source)
const wellFormed = (source: string): void => {
    const result = XMLValidator.validate(renderChapter(source, 'Grammar', { lang: 'en' }))
    assert.equal(result, true, typeof result === 'object' ? result.err.msg : '')
}

test('CommonMark block families 1–12 retain their semantic structure', () => {
    const source = [
        '---', '',                                      // 1 thematic break
        '### ATX', '',                                  // 2 ATX heading
        'Setext one', '===', '',                        // 3 Setext heading
        '    indented <code>', '',                      // 4 indented code
        '```js', 'const fenced = true', '```', '',      // 5 fenced code
        '<div>raw block</div>', '',                     // 6 rejected HTML block
        '[full]: https://example.com "Reference"', '', // 7 reference definition
        'First paragraph.', '', 'Second paragraph.', '',// 8–9 paragraphs/blank lines
        '> outer', '>> inner', '',                      // 10 block quotes
        '- first', '  - nested', '',                    // 11 list items
        '3. third', '4. fourth', '',                    // 12 lists
    ].join('\n')
    const html = rendered(source)
    assert.match(html, /<hr \/>/)
    assert.match(html, /<h3>ATX<\/h3>/)
    assert.match(html, /<h1>Setext one<\/h1>/)
    assert.match(html, /<pre><code>indented &lt;code&gt;/)
    assert.match(html, /<code class="language-js">const fenced = true/)
    assert.match(html, /&lt;div&gt;raw block&lt;\/div&gt;/)
    assert.doesNotMatch(html, /<div>raw block/)
    assert.doesNotMatch(html, /\[full\]:/)
    assert.equal((html.match(/<p>/g) ?? []).length >= 4, true)
    assert.match(html, /<blockquote>[\s\S]*<blockquote>/)
    assert.match(html, /<ul>[\s\S]*<ul>/)
    assert.match(html, /<ol start="3">/)
    wellFormed(source)
})

test('CommonMark inline families 13–23 retain their semantic structure', () => {
    const source = [
        '\\*escaped\\* &copy; &#169;',                 // 13–14 escapes/entities
        '',
        '`<code>` *italic* **bold**',                   // 15–16 code/emphasis
        '',
        '[inline](https://example.com) [full][id] [collapsed][] [shortcut]', // 17
        '',
        '![inline image](inline.png) ![reference image][image]',             // 18
        '',
        '<https://example.com> <reader@example.com>',   // 19 autolinks
        '',
        '<span onclick="bad()">raw inline</span>',     // 20 rejected raw HTML
        '',
        'space break  ', 'next', 'slash break\\', 'next', // 21 hard breaks
        'soft', 'line',                                 // 22 soft break
        '',
        '5 < 6 & 7 > 3',                                // 23 textual content
        '',
        '[id]: https://example.org',
        '[collapsed]: https://collapsed.example',
        '[shortcut]: https://shortcut.example',
        '[image]: reference.png',
    ].join('\n')
    const html = rendered(source)
    assert.match(html, /\*escaped\* © ©/)
    assert.match(html, /<code>&lt;code&gt;<\/code> <em>italic<\/em> <strong>bold<\/strong>/)
    assert.equal((html.match(/<a href=/g) ?? []).length, 6)
    assert.equal((html.match(/<img /g) ?? []).length, 2)
    assert.match(html, /href="mailto:reader@example\.com"/)
    assert.match(html, /&lt;span onclick=&quot;bad\(\)&quot;&gt;raw inline&lt;\/span&gt;/)
    assert.doesNotMatch(html, /<span onclick=/)
    assert.equal((html.match(/<br \/>/g) ?? []).length, 2)
    assert.match(html, /soft\nline/)
    assert.doesNotMatch(html, /soft<br/)
    assert.match(html, /5 &lt; 6 &amp; 7 &gt; 3/)
    wellFormed(source)
})

test('GFM families 24–27 are all supported', () => {
    const source = [
        '| Left | Center | Right |',
        '|:-----|:------:|------:|',
        '| A | B | C |',
        '',
        '- [x] finished',
        '- [ ] unfinished',
        '',
        '~single~ and ~~double~~ and three ~~~literal~~~ tildes',
        '',
        'www.example.com example.org person@example.com',
    ].join('\n')
    const html = rendered(source)
    assert.match(html, /<table>/)
    assert.match(html, /text-align:left/)
    assert.match(html, /text-align:center/)
    assert.match(html, /text-align:right/)
    assert.match(html, /role="checkbox" aria-checked="true">☒<\/span> finished/)
    assert.match(html, /role="checkbox" aria-checked="false">☐<\/span> unfinished/)
    assert.match(html, /<del>single<\/del> and <del>double<\/del>/)
    assert.match(html, /three ~~~literal~~~ tildes/)
    assert.match(html, /href="http:\/\/www\.example\.com"/)
    assert.match(html, /href="http:\/\/example\.org"/)
    assert.match(html, /href="mailto:person@example\.com"/)
    wellFormed(source)
})

test('raw HTML and unsafe links remain inactive', () => {
    const source = [
        '<img src="cover.png" onerror="bad()">',
        '<a href="javascript:bad()">bad</a>',
        '<script>bad()</script>',
        '[unsafe](javascript:bad())',
    ].join('\n\n')
    const html = rendered(source)
    assert.doesNotMatch(html, /<(?:img|script)(?:\s|>)/)
    assert.doesNotMatch(html, /href="javascript:/)
    assert.match(html, /&lt;img/)
    assert.match(html, /&lt;script&gt;/)
    wellFormed(source)
})

test('author-friendly corrections never enter inline or fenced code', () => {
    const html = rendered([
        '##Heading', '',
        '** padded **', '',
        '`##Code ** padded ** ~strike~`', '',
        '```markdown', '##Code', '** padded ** ~strike~', '```',
    ].join('\n'))
    assert.match(html, /<h2>Heading<\/h2>/)
    assert.match(html, /<strong>padded<\/strong>/)
    assert.match(html, /<code>##Code \*\* padded \*\* ~strike~<\/code>/)
    assert.match(html, /<code class="language-markdown">##Code\n\*\* padded \*\* ~strike~\n<\/code>/)
})

test('ATX and Setext headings produce the same chapter and TOC behavior', () => {
    const source = [
        '# ATX book', '', 'intro', '',
        'Setext chapter', '---------------', '', 'body', '',
        '## ATX chapter', '', 'body',
    ].join('\n')
    const chapters = splitChapters(source, 2)
    assert.deepEqual(chapters.map(chapter => chapter.title),
        ['ATX book', 'Setext chapter', 'ATX chapter'])
    assert.deepEqual(chapters.map(chapter => chapter.startLine), [0, 4, 9])

    const result = buildForExport({ markdown: source, basename: 'grammar' })
    const files = unzipSync(result.bytes)
    const nav = strFromU8(files['OEBPS/nav.xhtml']!)
    for (const label of ['ATX book', 'Setext chapter', 'ATX chapter']) {
        assert.match(nav, new RegExp(`>${label}<`))
    }
})

test('preview and export apply the same compatibility semantics', () => {
    const source = [
        'Book', '====', '',
        '##Chapter', '',
        '- [x] ~reviewed~', '',
        'Visit www.example.com.',
    ].join('\n')
    const preview = unzipSync(buildForPreview({ markdown: source, basename: 'grammar' }).bytes)
    const exported = unzipSync(buildForExport({ markdown: source, basename: 'grammar' }).bytes)
    for (const name of ['OEBPS/ch001.xhtml', 'OEBPS/ch002.xhtml']) {
        const previewChapter = strFromU8(preview[name]!)
        const exportChapter = strFromU8(exported[name]!)
        for (const pattern of [/<h[12](?:\s|>)/, /role="checkbox"/, /<del>reviewed<\/del>/,
            /href="http:\/\/www\.example\.com"/]) {
            if (pattern.test(previewChapter) || pattern.test(exportChapter)) {
                assert.equal(pattern.test(previewChapter), pattern.test(exportChapter), `${name}: ${pattern}`)
            }
        }
    }
})
