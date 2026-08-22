import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strToU8, strFromU8 } from 'fflate'
import { packEpub, PREVIEW_LEVEL, EXPORT_LEVEL } from '../src/epub/zip'

const sample = () => ({
    'META-INF/container.xml': strToU8('<container/>'),
    'OEBPS/ch001.xhtml': strToU8('<html/>'.repeat(400)),
})

/** Read the local file header of the first entry straight out of the bytes. */
function firstEntry(zip: Uint8Array) {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    assert.equal(view.getUint32(0, true), 0x04034b50, 'missing local file header signature')
    const method = view.getUint16(8, true)
    const nameLen = view.getUint16(26, true)
    const name = strFromU8(zip.subarray(30, 30 + nameLen))
    return { name, method }
}

test('mimetype is the first entry and is stored uncompressed', () => {
    // Readers check these bytes at a fixed offset before looking at anything
    // else, and fflate's insertion-order behaviour is what puts them there.
    for (const level of [PREVIEW_LEVEL, EXPORT_LEVEL] as const) {
        const { name, method } = firstEntry(packEpub(sample(), level))
        assert.equal(name, 'mimetype', `level ${level}: wrong first entry`)
        assert.equal(method, 0, `level ${level}: mimetype must be STORED`)
    }
})

test('the mimetype bytes appear at the fixed offset readers probe', () => {
    const zip = packEpub(sample(), EXPORT_LEVEL)
    assert.equal(strFromU8(zip.subarray(30, 38)), 'mimetype')
    assert.equal(strFromU8(zip.subarray(38, 58)), 'application/epub+zip')
})

test('a caller-supplied mimetype cannot displace the real one', () => {
    const zip = packEpub({ ...sample(), mimetype: strToU8('text/plain') }, EXPORT_LEVEL)
    assert.equal(strFromU8(unzipSync(zip)['mimetype']!), 'application/epub+zip')
    assert.equal(firstEntry(zip).name, 'mimetype')
})

test('all files round-trip', () => {
    const files = sample()
    const out = unzipSync(packEpub(files, EXPORT_LEVEL))
    for (const name of Object.keys(files)) {
        assert.deepEqual(out[name], files[name as keyof typeof files], `${name} did not round-trip`)
    }
})

test('export compresses and preview does not', () => {
    const files = sample()
    const preview = packEpub(files, PREVIEW_LEVEL)
    const exported = packEpub(files, EXPORT_LEVEL)
    assert.ok(exported.length < preview.length,
        `expected DEFLATE to beat STORE, got ${exported.length} vs ${preview.length}`)
})
