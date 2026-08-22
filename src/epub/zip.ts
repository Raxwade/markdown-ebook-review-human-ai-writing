// EPUB packaging (spec §2.3).
import { zipSync, strToU8 } from 'fflate'

export type ZipFiles = Record<string, Uint8Array>

/**
 * Preview uses STORE, export uses DEFLATE. Measured on a 321 KB manuscript:
 * level 0 = 2.3 ms / 914 KB, level 6 = 51.9 ms / 442 KB. Preview bytes never
 * leave memory, so the 50 ms matters and the size doesn't.
 */
export const PREVIEW_LEVEL = 0
export const EXPORT_LEVEL = 6

const MIMETYPE = 'application/epub+zip'

/**
 * Pack an EPUB. `mimetype` must be the archive's first entry and must be
 * STORED, uncompressed — readers check those bytes at a fixed offset before
 * they will look at anything else. fflate preserves the insertion order of the
 * files object, which is what puts it first; `test/zip.test.ts` asserts on the
 * resulting bytes so a dependency bump cannot quietly break it.
 */
export function packEpub(files: ZipFiles, level: 0 | 6): Uint8Array {
    const ordered: Record<string, [Uint8Array, { level: 0 }] | Uint8Array> = {
        mimetype: [strToU8(MIMETYPE), { level: 0 }],
    }
    for (const [name, bytes] of Object.entries(files)) {
        if (name === 'mimetype') continue
        ordered[name] = bytes
    }
    return zipSync(ordered as Parameters<typeof zipSync>[0], { level })
}
