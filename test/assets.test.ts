import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectAssetRefs, planAssetPaths, rewriteAssetRefs, applyAssetPlan, isLocalRef, extname, decodeRef } from '../src/epub/assets'

test('collects local image references in first-seen order', () => {
    const xhtml = '<p><img src="a.png"/><img src="sub/b.jpg"/><img src="a.png"/></p>'
    assert.deepEqual(collectAssetRefs(xhtml), ['a.png', 'sub/b.jpg'])
})

test('remote and data URLs are left alone', () => {
    const xhtml = '<img src="https://x.com/a.png"/><img src="data:image/png;base64,AAA"/><img src="//cdn/a.png"/>'
    assert.deepEqual(collectAssetRefs(xhtml), [])
})

test('unsupported extensions are skipped', () => {
    assert.deepEqual(collectAssetRefs('<img src="a.bmp"/><img src="b.tiff"/><img src="c.png"/>'), ['c.png'])
})

test('percent-encoded paths are decoded', () => {
    assert.deepEqual(collectAssetRefs('<img src="my%20pic.png"/>'), ['my pic.png'])
})

test('XML entities in the src are decoded back to the real filename', () => {
    // markdown-it renders ![](a&b.png) as src="a&amp;b.png". Decoding only the
    // percent-escapes sent 'a&amp;b.png' to the filesystem, where it read as a
    // missing image and the picture was dropped without the file being at fault.
    assert.deepEqual(collectAssetRefs('<img src="a&amp;b.png"/>'), ['a&b.png'])
    assert.deepEqual(collectAssetRefs('<img src="a&#38;b.png"/>'), ['a&b.png'])
    assert.deepEqual(collectAssetRefs('<img src="a&#x26;b.png"/>'), ['a&b.png'])
})

test('decodeRef unescapes before percent-decoding', () => {
    // The order is markdown-it's, reversed: it percent-encodes and then escapes
    // for HTML. Doing it the other way round mangles a literal %26 in a name.
    assert.equal(decodeRef('a&amp;b.png'), 'a&b.png')
    assert.equal(decodeRef('my%20pic.png'), 'my pic.png')
    // Defensive: a malformed escape makes decodeURI throw, and one bad filename
    // must not take the whole build down with it.
    assert.equal(decodeRef('a%zz.png'), 'a%zz.png')
    assert.equal(decodeRef('a&notanentity;b.png'), 'a&notanentity;b.png')
})

test('an entity-escaped reference survives the whole plan round trip', () => {
    const refs = collectAssetRefs('<img src="a&amp;b.png"/>')
    const plan = planAssetPaths(refs)
    const out = applyAssetPlan('<img src="a&amp;b.png"/>', plan)
    assert.ok(out.includes(`src="${plan.get('a&b.png')}"`), out)
})

test('single-quoted attributes are found', () => {
    assert.deepEqual(collectAssetRefs("<img alt='x' src='a.png'/>"), ['a.png'])
})

test('parent-relative paths are flattened so they cannot escape OEBPS', () => {
    // '../../pics/a.png' copied verbatim would point outside the container and
    // produce an archive strict readers reject.
    const plan = planAssetPaths(['../../pics/a.png'])
    assert.equal(plan.get('../../pics/a.png'), 'assets/a.png')
})

test('same basename from different directories does not collide', () => {
    const plan = planAssetPaths(['one/cover.png', 'two/cover.png'])
    const targets = [...plan.values()]
    assert.equal(new Set(targets).size, 2, `collision: ${targets.join(', ')}`)
})

test('a name that already looks like a dedup prefix does not collide', () => {
    // The prefixed candidate can itself be taken. Trying once and giving up put
    // two different images at assets/2-cover.png and silently packed only one.
    const plan = planAssetPaths(['x/2-cover.png', 'a/cover.png', 'b/cover.png', 'c/cover.png'])
    const targets = [...plan.values()]
    assert.equal(new Set(targets).size, targets.length, `collision: ${targets.join(', ')}`)
})

test('unsafe characters are stripped from packed names', () => {
    const target = planAssetPaths(['圖 片?.png']).get('圖 片?.png')!
    assert.match(target, /^assets\/[A-Za-z0-9._-]+$/)
})

test('rewrite points img src at the packed location', () => {
    const xhtml = '<img src="sub/b.jpg"/>'
    const out = rewriteAssetRefs(xhtml, planAssetPaths(['sub/b.jpg']))
    assert.equal(out, '<img src="assets/b.jpg"/>')
})

test('references with no plan entry are left untouched', () => {
    assert.equal(rewriteAssetRefs('<img src="x.png"/>', new Map()), '<img src="x.png"/>')
})

test('applyAssetPlan drops images that were never packed', () => {
    const out = applyAssetPlan('<p><img src="gone.png" alt="說明"/></p>', new Map())
    assert.ok(!out.includes('<img'), out)
    assert.ok(out.includes('說明'), 'alt text should survive')
})

test('applyAssetPlan drops the element entirely when there is no alt text', () => {
    assert.equal(applyAssetPlan('<p><img src="gone.png"/></p>', new Map()), '<p></p>')
})

test('applyAssetPlan rewrites packed images and leaves remote ones', () => {
    const plan = new Map([['a.png', 'assets/a.png']])
    const out = applyAssetPlan('<img src="a.png"/><img src="https://x.com/b.png"/>', plan)
    assert.ok(out.includes('src="assets/a.png"'))
    assert.ok(out.includes('https://x.com/b.png'))
})

test('isLocalRef and extname handle the awkward cases', () => {
    assert.equal(isLocalRef('#anchor'), false)
    assert.equal(isLocalRef(''), false)
    assert.equal(isLocalRef('C:/x.png'), false, 'windows drive letters parse as a scheme')
    assert.equal(isLocalRef('./a.png'), true)
    assert.equal(extname('dir.with.dot/file'), '')
    assert.equal(extname('a.PNG'), '.png')
})
