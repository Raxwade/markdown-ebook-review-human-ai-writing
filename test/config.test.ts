import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { DEVICES, DEFAULTS, deviceSize } from '../src/config'

const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
) as {
    icon: string
    contributes: {
        configuration: {
            properties: Record<string, { default?: unknown; enum?: string[]; enumDescriptions?: string[] }>
        }
    }
}
const props = manifest.contributes.configuration.properties

test('manifest declares the packaged extension icon', () => {
    assert.equal(manifest.icon, 'images/extension-icon.png')
    assert.ok(fs.existsSync(path.resolve(__dirname, '../..', manifest.icon)))
})

test('package.json device enum matches the DEVICES table', () => {
    // The picker's data lives in src/config.ts and is shipped to the webview
    // over the config message. package.json is the one copy that cannot be
    // derived, so it gets asserted instead. 'panel' and 'custom' are resolved
    // in the webview and so are not table entries.
    const declared = props['mdepub.device']!.enum!
    assert.deepEqual(declared, [...Object.keys(DEVICES), 'panel', 'custom'])
    assert.equal(props['mdepub.device']!.enumDescriptions!.length, declared.length)
})

test('every device preset carries a label, a group, and a plausible logical size', () => {
    for (const [key, d] of Object.entries(DEVICES)) {
        assert.ok(d.label, `${key} has no label`)
        assert.ok(d.group, `${key} has no group`)
        // Logical points, not device pixels: iPhone 15 is 393x852, not 1179x2556.
        assert.ok(d.width >= 320 && d.width <= 1600, `${key} width ${d.width} looks like device pixels`)
        assert.ok(d.height >= 480 && d.height <= 1600, `${key} height ${d.height} looks like device pixels`)
    }
})

test('presets are contiguous within each group so the menu does not interleave', () => {
    // fillDeviceMenu builds one <optgroup> per group in first-seen order; a
    // group whose entries are split would render as two separate groups.
    const seen: string[] = []
    for (const d of Object.values(DEVICES)) {
        if (seen[seen.length - 1] !== d.group) {
            assert.ok(!seen.includes(d.group), `group "${d.group}" is not contiguous`)
            seen.push(d.group)
        }
    }
    assert.ok(seen.length >= 3, `expected several groups, got ${seen.join(', ')}`)
})

test('manifest defaults agree with DEFAULTS', () => {
    assert.equal(props['mdepub.device']!.default, DEFAULTS.device)
    assert.equal(props['mdepub.splitLevel']!.default, DEFAULTS.splitLevel)
    assert.equal(props['mdepub.customWidth']!.default, DEFAULTS.customWidth)
    assert.equal(props['mdepub.customHeight']!.default, DEFAULTS.customHeight)
    assert.equal(props['mdepub.debounce']!.default, DEFAULTS.debounce)
    // Empty means auto in VS Code: readConfig follows the display locale. Pure
    // builds still need a deterministic fallback, which is English.
    assert.equal(props['mdepub.lang']!.default, '')
    assert.equal(DEFAULTS.lang, 'en')
})

test('deviceSize resolves presets and custom', () => {
    const pro = deviceSize({ device: 'ipad-pro-11', customWidth: 1, customHeight: 2 })!
    assert.equal(pro.width, 834)
    assert.equal(pro.height, 1194)
    assert.deepEqual(deviceSize({ device: 'custom', customWidth: 500, customHeight: 900 }), {
        width: 500, height: 900,
    })
})

test('deviceSize returns null for panel, whose size only the webview knows', () => {
    assert.equal(deviceSize({ device: 'panel', customWidth: 1, customHeight: 2 }), null)
})

test('an unknown device name falls back rather than throwing', () => {
    const size = deviceSize({ device: 'nonsense' as never, customWidth: 1, customHeight: 2 })!
    assert.equal(size.width, DEVICES['iphone'].width)
})
