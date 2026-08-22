import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter } from '../src/epub/frontmatter'

test('extracts frontmatter and leaves the body', () => {
    const { meta, body } = parseFrontmatter('---\ntitle: 書名\nauthor: Example Author\n---\n\n# 內文\n')
    assert.equal(meta.title, '書名')
    assert.equal(meta.author, 'Example Author')
    assert.equal(body, '# 內文\n')
})

test('a document without frontmatter is returned untouched', () => {
    const src = '# Just a heading\n\ntext\n'
    const { meta, body } = parseFrontmatter(src)
    assert.deepEqual(meta, {})
    assert.equal(body, src)
})

test('--- inside the body is not mistaken for frontmatter', () => {
    const src = '# Title\n\nsome text\n\n---\n\nmore text\n'
    const { meta, body } = parseFrontmatter(src)
    assert.deepEqual(meta, {})
    assert.equal(body, src)
})

test('CRLF frontmatter parses', () => {
    const { meta, body } = parseFrontmatter('---\r\ntitle: 書名\r\n---\r\n\r\n# 內文\r\n')
    assert.equal(meta.title, '書名')
    assert.equal(body, '# 內文\n')
})

test('non-string scalars are coerced to strings', () => {
    const { meta } = parseFrontmatter('---\ntitle: 2024\ndraft: true\nweight: 1.5\n---\nbody\n')
    assert.equal(meta.title, '2024')
    assert.equal(meta.draft, 'true')
    assert.equal(meta.weight, '1.5')
    for (const v of Object.values(meta)) assert.equal(typeof v, 'string')
})

test('title: No stays the string "No"', () => {
    // YAML 1.2's core schema does not treat No/yes as booleans. Asserted because
    // a schema change upstream would silently turn a title into `false`.
    const { meta } = parseFrontmatter('---\ntitle: No\nother: yes\n---\nbody\n')
    assert.equal(meta.title, 'No')
    assert.equal(meta.other, 'yes')
})

test('sequences are joined, nulls dropped', () => {
    const { meta } = parseFrontmatter('---\ntags:\n  - a\n  - b\nempty:\n---\nbody\n')
    assert.equal(meta.tags, 'a, b')
    assert.equal(meta.empty, undefined)
})

test('broken YAML is a warning, not a throw', () => {
    const { meta, body, warnings } = parseFrontmatter('---\ntitle: "unterminated\n---\n\nbody\n')
    assert.deepEqual(meta, {})
    assert.equal(body, 'body\n')
    assert.equal(warnings.length, 1)
})

test('an unclosed frontmatter fence falls back to treating everything as body', () => {
    const src = '---\ntitle: x\n\nno closing fence\n'
    const { meta, body, warnings } = parseFrontmatter(src)
    assert.deepEqual(meta, {})
    assert.equal(body, src)
    assert.equal(warnings.length, 1)
})

test('... closes a frontmatter block', () => {
    const { meta, body } = parseFrontmatter('---\ntitle: x\n...\nbody\n')
    assert.equal(meta.title, 'x')
    assert.equal(body, 'body\n')
})

test('empty frontmatter yields no metadata and no warning', () => {
    const { meta, body, warnings } = parseFrontmatter('---\n---\nbody\n')
    assert.deepEqual(meta, {})
    assert.equal(body, 'body\n')
    assert.deepEqual(warnings, [])
})
