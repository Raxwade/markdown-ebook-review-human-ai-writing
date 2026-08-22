import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { HOST_CATALOGS, bookLocale, hostCount, hostText, uiLocale } from '../src/i18n'
import { parseFrontmatter } from '../src/epub/frontmatter'
import { parseNotes } from '../src/notes'

const REPO_ROOT = path.resolve(__dirname, '../..')

test('unsupported interface locales fall back to English', () => {
    assert.equal(uiLocale(undefined), 'en')
    assert.equal(uiLocale('en-US'), 'en')
    assert.equal(uiLocale('fr'), 'en')
    assert.equal(uiLocale('zh-CN'), 'en')
    assert.equal(uiLocale('zh-TW'), 'zh-TW')
    assert.equal(uiLocale('zh-Hant-HK'), 'zh-TW')
    assert.equal(bookLocale('fr'), 'fr')
    assert.equal(bookLocale('zh_tw'), 'zh-TW')
    assert.equal(bookLocale('not a locale'), 'en')
})

test('host messages interpolate and pluralize in the selected locale', () => {
    assert.equal(
        hostCount('en', 'exportSummary', 2, { file: 'book.epub' }),
        'mdepub: Exported book.epub (2 chapters)',
    )
    assert.match(hostText('zh-TW', 'openMarkdownToPreview'), /Markdown/)
    assert.match(hostCount('zh-TW', 'exportIssues', 3, { summary: '完成' }), /3/)
})

test('English is the language-neutral source catalog', () => {
    assert.doesNotMatch(JSON.stringify(HOST_CATALOGS.en), /\p{Script=Han}/u)
    const html = fs.readFileSync(path.join(REPO_ROOT, 'media/reader.html'), 'utf8')
    assert.doesNotMatch(html, /\p{Script=Han}/u)
})

test('manifest localization keys exist in both locale bundles', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    const english = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.nls.json'), 'utf8'))
    const traditional = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.nls.zh-tw.json'), 'utf8'))
    const keys = [...JSON.stringify(manifest).matchAll(/%([^%]+)%/g)].map(match => match[1]!)
    assert.ok(keys.length > 20)
    for (const key of new Set(keys)) {
        assert.equal(typeof english[key], 'string', `English bundle is missing ${key}`)
        assert.equal(typeof traditional[key], 'string', `zh-TW bundle is missing ${key}`)
    }
    assert.doesNotMatch(JSON.stringify(english), /\p{Script=Han}/u)
})

test('parser warnings use English by default and zh-TW only when selected', () => {
    assert.match(parseFrontmatter('---\ntitle: x').warnings[0]!, /^Frontmatter/)
    assert.match(parseFrontmatter('---\ntitle: x', 'zh-TW').warnings[0]!, /找不到結尾/)
    assert.match(parseNotes('{ bad', 'book.md').warnings[0]!, /^The notes file/)
    assert.match(parseNotes('{ bad', 'book.md', 'zh-TW').warnings[0]!, /註記檔/)
})
