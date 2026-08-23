// User-interface localization shared by the extension host and the webview
// protocol. English is deliberately the source and fallback language: an
// unsupported VS Code locale must never inherit a language-specific UI.

export type UiLocale = 'en' | 'zh-TW'

export function uiLocale(value: unknown): UiLocale {
    const locale = String(value ?? '').replaceAll('_', '-').toLowerCase()
    return locale === 'zh-tw' || locale === 'zh-hk' || locale === 'zh-mo'
        || locale === 'zh-hant' || locale.startsWith('zh-hant-')
        ? 'zh-TW'
        : 'en'
}

/** Canonical BCP 47 tag for book metadata, independent of UI catalog support. */
export function bookLocale(value: unknown): string {
    const locale = String(value ?? '').replaceAll('_', '-').trim()
    if (!locale) return 'en'
    try {
        return Intl.getCanonicalLocales(locale)[0] ?? 'en'
    } catch {
        return 'en'
    }
}

const EN = {
    customCssUnreadable: 'mdepub: Could not read custom CSS {path}; using built-in styles.',
    customCssOutsideWorkspace: 'mdepub: Custom CSS {path} from workspace settings points outside the workspace; it was blocked and built-in styles will be used.',
    openMarkdownToExport: 'mdepub: Open a Markdown file before exporting.',
    exportBuildFailed: 'mdepub: Build failed — {error}',
    exportWriteFailed: 'mdepub: Could not write the EPUB — {error}',
    'exportSummary.one': 'mdepub: Exported {file} ({count} chapter)',
    'exportSummary.other': 'mdepub: Exported {file} ({count} chapters)',
    'exportIssues.one': '{summary}; {count} issue',
    'exportIssues.other': '{summary}; {count} issues',
    showDetails: 'Show Details',
    openMarkdownToPreview: 'mdepub: Open a Markdown file before starting the preview.',
    notesSaveFailed: 'mdepub: Could not save notes — {error}',
    'closeStalePrompt.one': 'Remove {count} stale note from the active review file?',
    'closeStalePrompt.other': 'Remove {count} stale notes from the active review file?',
    closeStaleDetail: 'Archive writes the selected stale notes to a separate JSON file first. Discard removes them without an archive.',
    archiveStale: 'Archive…',
    discardStale: 'Discard',
    staleArchiveSaveTitle: 'Archive stale notes',
    staleArchiveFailed: 'mdepub: Could not archive stale notes — {error}',
    staleArchiveUnsafePath: 'mdepub: Choose a new archive file; the manuscript and active notes file cannot be overwritten.',
    profileSaveFailed: 'mdepub: Could not save reading appearance — {error}',
    locationSaveFailed: 'mdepub: Could not save the reading location — {error}',
    previewBuildFailed: 'Build failed:\n{error}',
} as const

export type HostMessageKey = keyof typeof EN
export type HostCountKey = 'exportSummary' | 'exportIssues' | 'closeStalePrompt'

const ZH_TW: Record<HostMessageKey, string> = {
    customCssUnreadable: 'mdepub：讀不到自訂 CSS {path}，改用內建樣式。',
    customCssOutsideWorkspace: 'mdepub：工作區設定的自訂 CSS {path} 指到專案外，已拒絕載入並改用內建樣式。',
    openMarkdownToExport: 'mdepub：請先開啟 Markdown 檔再匯出。',
    exportBuildFailed: 'mdepub：建置失敗 — {error}',
    exportWriteFailed: 'mdepub：EPUB 寫檔失敗 — {error}',
    'exportSummary.one': 'mdepub：已匯出 {file}（{count} 章）',
    'exportSummary.other': 'mdepub：已匯出 {file}（{count} 章）',
    'exportIssues.one': '{summary}；有 {count} 個問題',
    'exportIssues.other': '{summary}；有 {count} 個問題',
    showDetails: '查看詳細資訊',
    openMarkdownToPreview: 'mdepub：請先開啟 Markdown 檔再預覽。',
    notesSaveFailed: 'mdepub：註記存檔失敗 — {error}',
    'closeStalePrompt.one': '要從目前的審閱檔移除 {count} 則失效註記嗎？',
    'closeStalePrompt.other': '要從目前的審閱檔移除 {count} 則失效註記嗎？',
    closeStaleDetail: '「封存」會先將選取的失效註記寫入另一個 JSON 檔；「捨棄」則不保留封存檔。',
    archiveStale: '封存…',
    discardStale: '捨棄',
    staleArchiveSaveTitle: '封存失效註記',
    staleArchiveFailed: 'mdepub：失效註記封存失敗 — {error}',
    staleArchiveUnsafePath: 'mdepub：請選擇新的封存檔；不能覆寫原稿或目前的註記檔。',
    profileSaveFailed: 'mdepub：閱讀外觀存檔失敗 — {error}',
    locationSaveFailed: 'mdepub：閱讀位置存檔失敗 — {error}',
    previewBuildFailed: '建置失敗：\n{error}',
}

export const HOST_CATALOGS: Record<UiLocale, Record<HostMessageKey, string>> = {
    en: EN,
    'zh-TW': ZH_TW,
}

export function hostText(
    locale: UiLocale,
    key: HostMessageKey,
    values: Record<string, unknown> = {},
): string {
    return HOST_CATALOGS[locale][key].replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) =>
        Object.hasOwn(values, name) ? String(values[name]) : match)
}

export function hostCount(
    locale: UiLocale,
    key: HostCountKey,
    count: number,
    values: Record<string, unknown> = {},
): string {
    const messageKey = `${key}.${count === 1 ? 'one' : 'other'}` as HostMessageKey
    return hostText(locale, messageKey, { ...values, count })
}
