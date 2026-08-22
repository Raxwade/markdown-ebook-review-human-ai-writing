// Settings shape and defaults (spec §6). Pure — reading them out of VSCode is
// extension.ts's job, so this stays testable and importable from anywhere.

export type PresetName =
    | 'iphone-se' | 'iphone' | 'iphone-max' | 'pixel' | 'galaxy'
    | 'ipad-mini' | 'ipad' | 'ipad-pro-11' | 'ipad-pro-13'
    | 'kindle' | 'kindle-oasis' | 'kobo-clara' | 'remarkable'
    | 'desktop' | 'desktop-wide'

/**
 * `panel` and `custom` are resolved in the webview, not here — `panel` means
 * "whatever this panel currently is", which only the webview knows.
 */
export type DeviceName = PresetName | 'panel' | 'custom'

export interface DeviceSize {
    width: number
    height: number
}

export interface DevicePreset extends DeviceSize {
    label: string
    /** Language-neutral key translated by the reader webview. */
    group: 'phone' | 'tablet' | 'ereader' | 'desktop'
}

/**
 * Approximate logical viewports in CSS px, NOT device pixels (spec §6.1).
 * iPhone 15 is 393×852, not 1179×2556.
 *
 * These are deliberately approximate. The question being answered is "does this
 * paragraph orphan at roughly phone size", not device certification — the
 * e-reader figures especially are ballpark reading viewports, since e-ink
 * devices do not publish a CSS-px viewport the way phones do. Use `custom` when
 * a specific target matters.
 *
 * This is the single source of truth. The webview receives this table over the
 * config message rather than keeping its own copy, and `test/config.test.ts`
 * pins package.json's enum to it — unsynchronised copies of the device list is
 * exactly how the picker silently rots.
 */
export const DEVICES: Record<PresetName, DevicePreset> = {
    'iphone-se': { group: 'phone', label: 'iPhone SE', width: 375, height: 667 },
    'iphone': { group: 'phone', label: 'iPhone', width: 393, height: 852 },
    'iphone-max': { group: 'phone', label: 'iPhone Pro Max', width: 430, height: 932 },
    'pixel': { group: 'phone', label: 'Pixel', width: 412, height: 915 },
    'galaxy': { group: 'phone', label: 'Galaxy S', width: 360, height: 800 },

    'ipad-mini': { group: 'tablet', label: 'iPad mini', width: 744, height: 1133 },
    'ipad': { group: 'tablet', label: 'iPad', width: 820, height: 1180 },
    'ipad-pro-11': { group: 'tablet', label: 'iPad Pro 11"', width: 834, height: 1194 },
    'ipad-pro-13': { group: 'tablet', label: 'iPad Pro 13"', width: 1024, height: 1366 },

    'kindle': { group: 'ereader', label: 'Kindle Paperwhite', width: 620, height: 830 },
    'kindle-oasis': { group: 'ereader', label: 'Kindle Oasis', width: 675, height: 900 },
    'kobo-clara': { group: 'ereader', label: 'Kobo Clara', width: 600, height: 800 },
    'remarkable': { group: 'ereader', label: 'reMarkable', width: 830, height: 1100 },

    'desktop': { group: 'desktop', label: '1280×800', width: 1280, height: 800 },
    'desktop-wide': { group: 'desktop', label: '1440×900', width: 1440, height: 900 },
}

export interface Config {
    splitLevel: 1 | 2
    device: DeviceName
    customWidth: number
    customHeight: number
    css: string | null
    lang: string
    author: string | null
    cover: string | null
    debounce: number
}

export const DEFAULTS: Config = {
    splitLevel: 2,
    device: 'iphone',
    customWidth: 393,
    customHeight: 852,
    css: null,
    lang: 'en',
    author: null,
    cover: null,
    debounce: 120,
}

/**
 * Resolve a config to the frame size it asks for. Returns null for `panel`,
 * whose size is only knowable inside the webview.
 */
export function deviceSize(
    config: Pick<Config, 'device' | 'customWidth' | 'customHeight'>,
): DeviceSize | null {
    if (config.device === 'panel') return null
    if (config.device === 'custom') {
        return { width: config.customWidth, height: config.customHeight }
    }
    return DEVICES[config.device as PresetName] ?? DEVICES['iphone']
}
