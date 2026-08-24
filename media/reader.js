// Webview side: device frame, position preservation, and swapping the book on
// each rebuild (spec §4.2, §4.4, §6.1).
// foliate is not imported here. It lives in the device frame's own realm — see
// media/stage.js and startStage() below — because the frame has to be an iframe
// for the book to be paginated at its declared size.

const vscode = acquireVsCodeApi()

// English is the source and fallback language. The host sends VS Code's display
// locale with the config message; only explicitly supported locales override
// these strings, so an unsupported language can never fall back to Chinese.
const EN_MESSAGES = {
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'toolbar.historyBack': 'Go back (Alt+Left)',
    'toolbar.historyForward': 'Go forward (Alt+Right)',
    'toolbar.previousPage': 'Previous page (Left / PageUp)',
    'toolbar.nextPage': 'Next page (Right / PageDown / Space)',
    'toolbar.chapter': 'Jump to chapter',
    'toolbar.scrubProgress': 'Scrub reading progress',
    'toolbar.readingProgress': 'Reading progress',
    'toolbar.appearance': 'Reading appearance',
    'toolbar.search': 'Search book (Ctrl+F)',
    'toolbar.bookmarks': 'Bookmarks',
    'toolbar.notes': 'Notes',
    'toolbar.device': 'Device viewport',
    'toolbar.rotate': 'Swap portrait and landscape',
    'appearance.title': 'Reading appearance',
    'appearance.fontSize': 'Font size',
    'appearance.font': 'Font',
    'appearance.originalBook': 'Original book',
    'appearance.serif': 'Serif',
    'appearance.sansSerif': 'Sans serif',
    'appearance.monospace': 'Monospace',
    'appearance.bold': 'Bold text',
    'appearance.lineHeight': 'Line height',
    'appearance.characterSpacing': 'Character spacing',
    'appearance.wordSpacing': 'Word spacing',
    'appearance.pageMargins': 'Page margins',
    'appearance.alignment': 'Alignment',
    'appearance.leftAligned': 'Left aligned',
    'appearance.justified': 'Justified',
    'appearance.columns': 'Columns',
    'appearance.automatic': 'Automatic',
    'appearance.oneColumn': 'One column',
    'appearance.twoColumns': 'Two columns',
    'appearance.readingMode': 'Reading mode',
    'appearance.paginated': 'Paginated',
    'appearance.verticalScrolling': 'Vertical scrolling',
    'appearance.pageTheme': 'Page theme',
    'appearance.system': 'System',
    'appearance.light': 'Light',
    'appearance.paper': 'Paper',
    'appearance.sepia': 'Sepia',
    'appearance.gray': 'Gray',
    'appearance.dark': 'Dark',
    'appearance.reset': 'Reset reader overrides',
    'bookmark.addCurrent': 'Add bookmark at current location (Ctrl+D)',
    'bookmark.removeCurrent': 'Remove bookmark at current location (Ctrl+D)',
    'bookmark.unknownChapter': 'Unknown chapter',
    'bookmark.count.one': '{count} bookmark',
    'bookmark.count.other': '{count} bookmarks',
    'bookmark.empty': 'No bookmarks yet. Use ☆ in the toolbar to save the current location.',
    'color.yellow': 'Yellow',
    'color.green': 'Green',
    'color.blue': 'Blue',
    'color.pink': 'Pink',
    'color.purple': 'Purple',
    'notes.highlightAndNote': 'Highlight and add a note',
    'notes.note': 'Note',
    'notes.placeholder': 'Write a note for yourself or an AI…',
    'notes.deleteHighlight': 'Delete highlight',
    'notes.fileFallback': 'Notes file',
    'notes.warningCount.one': '{path}: {count} issue',
    'notes.warningCount.other': '{path}: {count} issues',
    'notes.count.one': '{count} note',
    'notes.count.other': '{count} notes',
    'notes.staleCount.one': '{count} source target not found',
    'notes.staleCount.other': '{count} source targets not found',
    'notes.empty': 'No notes yet. Select text or click an image in the book to add one.',
    'notes.stale': 'Source target not found',
    'notes.image': 'Image: {label}',
    'notes.closeStale': 'Archive / discard stale…',
    'drawer.tools': 'Reader tools',
    'drawer.search': 'Search',
    'drawer.bookmarks': 'Bookmarks',
    'drawer.notes': 'Notes',
    'search.placeholder': 'Search the whole book…',
    'search.label': 'Search the whole book',
    'search.cancel': 'Cancel and clear search',
    'search.prompt': 'Enter text to search the whole book',
    'search.previous': 'Previous result',
    'search.next': 'Next result',
    'search.searching': 'Searching…',
    'search.searchingCount.one': 'Searching… {count} result so far',
    'search.searchingCount.other': 'Searching… {count} results so far',
    'search.resultCount.one': '{count} result',
    'search.resultCount.other': '{count} results',
    'search.noResults': 'No results',
    'search.failed': 'Search failed: {error}',
    'search.chapter': 'Chapter {number}',
    'device.group.phone': 'Phones',
    'device.group.tablet': 'Tablets',
    'device.group.ereader': 'E-readers (approximate)',
    'device.group.desktop': 'Desktop windows',
    'device.group.other': 'Other',
    'device.panel': 'Fit current panel',
    'device.custom': 'Custom  {width}×{height}',
    'toc.untitled': '(Untitled)',
    'progress.chapter': '{current}/{total} ch.',
    'error.preview': 'Preview failed:\n{error}',
    'error.stageFailed': 'The device frame failed to load Foliate:\n{error}',
    'error.stageMissing': 'The device frame did not run stage.bundle.js. The CSP nonce usually does not match.',
    'error.frameMissing': 'The device frame did not load its document.',
    'error.frameCrossOrigin': 'The device frame is cross-origin, so its document cannot be read.',
    'error.fetch': 'Could not load {resource}: {error}',
    'error.fetchHttp': 'Could not load {resource}: HTTP {status}',
    'error.appearance': 'Could not apply reading appearance:\n{error}',
    'status.updating': 'Updating…',
}

const ZH_TW_MESSAGES = {
    ...EN_MESSAGES,
    'common.close': '關閉',
    'common.cancel': '取消',
    'common.save': '儲存',
    'common.delete': '刪除',
    'common.edit': '編輯',
    'toolbar.historyBack': '返回上一個閱讀位置（Alt+←）',
    'toolbar.historyForward': '前往下一個閱讀位置（Alt+→）',
    'toolbar.previousPage': '上一頁（← / PageUp）',
    'toolbar.nextPage': '下一頁（→ / PageDown / 空白鍵）',
    'toolbar.chapter': '跳到章節',
    'toolbar.scrubProgress': '拖曳閱讀進度',
    'toolbar.readingProgress': '閱讀進度',
    'toolbar.appearance': '閱讀外觀',
    'toolbar.search': '搜尋全書（Ctrl+F）',
    'toolbar.bookmarks': '書籤',
    'toolbar.notes': '註記',
    'toolbar.device': '裝置框尺寸',
    'toolbar.rotate': '橫向／直向對調',
    'appearance.title': '閱讀外觀',
    'appearance.fontSize': '字級',
    'appearance.font': '字體',
    'appearance.originalBook': '沿用原書',
    'appearance.serif': '襯線',
    'appearance.sansSerif': '無襯線',
    'appearance.monospace': '等寬',
    'appearance.bold': '粗體文字',
    'appearance.lineHeight': '行高',
    'appearance.characterSpacing': '字距',
    'appearance.wordSpacing': '詞距',
    'appearance.pageMargins': '頁邊',
    'appearance.alignment': '對齊',
    'appearance.leftAligned': '靠左',
    'appearance.justified': '左右對齊',
    'appearance.columns': '欄數',
    'appearance.automatic': '自動',
    'appearance.oneColumn': '單欄',
    'appearance.twoColumns': '雙欄',
    'appearance.readingMode': '閱讀方式',
    'appearance.paginated': '分頁',
    'appearance.verticalScrolling': '垂直捲動',
    'appearance.pageTheme': '頁面主題',
    'appearance.system': '跟隨系統',
    'appearance.light': '亮色',
    'appearance.paper': '紙張',
    'appearance.sepia': '棕褐',
    'appearance.gray': '灰色',
    'appearance.dark': '深色',
    'appearance.reset': '清除閱讀器覆寫',
    'bookmark.addCurrent': '加入目前位置的書籤（Ctrl+D）',
    'bookmark.removeCurrent': '移除目前位置的書籤（Ctrl+D）',
    'bookmark.unknownChapter': '章節不明',
    'bookmark.count.one': '{count} 個書籤',
    'bookmark.count.other': '{count} 個書籤',
    'bookmark.empty': '還沒有書籤。按工具列的 ☆ 儲存目前位置。',
    'color.yellow': '黃',
    'color.green': '綠',
    'color.blue': '藍',
    'color.pink': '粉',
    'color.purple': '紫',
    'notes.highlightAndNote': '標記並寫註解',
    'notes.note': '註解',
    'notes.placeholder': '寫下你的意見……給 AI 或給自己',
    'notes.deleteHighlight': '刪除標記',
    'notes.fileFallback': '註記檔',
    'notes.warningCount.one': '{path}：{count} 個問題',
    'notes.warningCount.other': '{path}：{count} 個問題',
    'notes.count.one': '{count} 則註記',
    'notes.count.other': '{count} 則註記',
    'notes.staleCount.one': '{count} 則找不到原始標記',
    'notes.staleCount.other': '{count} 則找不到原始標記',
    'notes.empty': '還沒有註記。在書上選取文字或點選圖片來新增註記。',
    'notes.stale': '找不到原始標記',
    'notes.image': '圖片：{label}',
    'notes.closeStale': '封存／捨棄失效註記…',
    'drawer.tools': '閱讀工具',
    'drawer.search': '搜尋',
    'drawer.bookmarks': '書籤',
    'drawer.notes': '註記',
    'search.placeholder': '搜尋全書……',
    'search.label': '搜尋全書',
    'search.cancel': '取消並清除搜尋',
    'search.prompt': '輸入文字以搜尋全書',
    'search.previous': '上一個結果',
    'search.next': '下一個結果',
    'search.searching': '搜尋中…',
    'search.searchingCount.one': '搜尋中…目前 {count} 個結果',
    'search.searchingCount.other': '搜尋中…目前 {count} 個結果',
    'search.resultCount.one': '{count} 個結果',
    'search.resultCount.other': '{count} 個結果',
    'search.noResults': '找不到結果',
    'search.failed': '搜尋失敗：{error}',
    'search.chapter': '第 {number} 章',
    'device.group.phone': '手機',
    'device.group.tablet': '平板',
    'device.group.ereader': '電子書閱讀器（近似）',
    'device.group.desktop': '桌機視窗',
    'device.group.other': '其他',
    'device.panel': '符合面板',
    'device.custom': '自訂  {width}×{height}',
    'toc.untitled': '（無標題）',
    'progress.chapter': '{current}/{total} 章',
    'error.preview': '預覽失敗：\n{error}',
    'error.stageFailed': '裝置框載入 Foliate 時出錯：\n{error}',
    'error.stageMissing': '裝置框沒有執行 stage.bundle.js——通常是 CSP 的 nonce 對不上。',
    'error.frameMissing': '裝置框沒有載入它的文件。',
    'error.frameCrossOrigin': '裝置框不同源，讀不到它的文件。',
    'error.fetch': '讀不到 {resource}：{error}',
    'error.fetchHttp': '讀不到 {resource}：HTTP {status}',
    'error.appearance': '閱讀外觀套用失敗：\n{error}',
    'status.updating': '更新中…',
}

const CATALOGS = { en: EN_MESSAGES, 'zh-TW': ZH_TW_MESSAGES }
let interfaceLocale = 'en'

function supportedLocale(value) {
    const locale = String(value ?? '').replaceAll('_', '-').toLowerCase()
    return locale === 'zh-tw' || locale === 'zh-hk' || locale === 'zh-mo'
        || locale === 'zh-hant' || locale.startsWith('zh-hant-')
        ? 'zh-TW'
        : 'en'
}

function t(key, values = {}) {
    const template = CATALOGS[interfaceLocale]?.[key] ?? EN_MESSAGES[key] ?? key
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => String(values[name] ?? `{${name}}`))
}

function tCount(key, count, values = {}) {
    return t(`${key}.${count === 1 ? 'one' : 'other'}`, { ...values, count })
}

function applyStaticTranslations(locale) {
    interfaceLocale = supportedLocale(locale)
    document.documentElement.lang = interfaceLocale
    for (const node of document.querySelectorAll('[data-i18n]')) {
        node.textContent = t(node.dataset.i18n)
    }
    for (const node of document.querySelectorAll('[data-i18n-title]')) {
        node.title = t(node.dataset.i18nTitle)
    }
    for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
        node.placeholder = t(node.dataset.i18nPlaceholder)
    }
    for (const node of document.querySelectorAll('[data-i18n-aria-label]')) {
        node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel))
    }
}

const el = {
    toolbar: document.getElementById('toolbar'),
    device: document.getElementById('device'),
    rotate: document.getElementById('rotate'),
    size: document.getElementById('size'),
    status: document.getElementById('status'),
    stage: document.getElementById('stage'),
    outer: document.getElementById('frame-outer'),
    frame: document.getElementById('frame'),
    // Assigned by startStage() once the frame's document has registered and
    // upgraded <foliate-view>. Nothing may touch it before `staged` resolves.
    view: null,
    error: document.getElementById('error'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    historyBack: document.getElementById('history-back'),
    historyForward: document.getElementById('history-forward'),
    toc: document.getElementById('toc'),
    progress: document.getElementById('progress'),
    progressScrubber: document.getElementById('progress-scrubber'),
    appearanceToggle: document.getElementById('appearance-toggle'),
    appearancePanel: document.getElementById('appearance-panel'),
    appearanceClose: document.getElementById('appearance-close'),
    appearanceReset: document.getElementById('appearance-reset'),
    appearanceFontSize: document.getElementById('appearance-font-size'),
    appearanceFontSizeValue: document.getElementById('appearance-font-size-value'),
    appearanceFontFamily: document.getElementById('appearance-font-family'),
    appearanceBold: document.getElementById('appearance-bold'),
    appearanceLineHeight: document.getElementById('appearance-line-height'),
    appearanceLineHeightValue: document.getElementById('appearance-line-height-value'),
    appearanceCharacterSpacing: document.getElementById('appearance-character-spacing'),
    appearanceCharacterSpacingValue: document.getElementById('appearance-character-spacing-value'),
    appearanceWordSpacing: document.getElementById('appearance-word-spacing'),
    appearanceWordSpacingValue: document.getElementById('appearance-word-spacing-value'),
    appearancePageMargin: document.getElementById('appearance-page-margin'),
    appearancePageMarginValue: document.getElementById('appearance-page-margin-value'),
    appearanceTextAlign: document.getElementById('appearance-text-align'),
    appearanceColumns: document.getElementById('appearance-columns'),
    appearanceReadingMode: document.getElementById('appearance-reading-mode'),
    appearanceTheme: document.getElementById('appearance-theme'),
    markBar: document.getElementById('mark-bar'),
    markNote: document.getElementById('mark-note'),
    readerDrawer: document.getElementById('reader-drawer'),
    drawerClose: document.getElementById('drawer-close'),
    drawerTabs: [...document.querySelectorAll('[data-drawer-tab]')],
    searchToggle: document.getElementById('search-toggle'),
    searchPanel: document.getElementById('search-panel'),
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
    searchCancel: document.getElementById('search-cancel'),
    searchSummary: document.getElementById('search-summary'),
    searchProgress: document.getElementById('search-progress'),
    searchResults: document.getElementById('search-results'),
    searchPrev: document.getElementById('search-prev'),
    searchNext: document.getElementById('search-next'),
    bookmarkCurrent: document.getElementById('bookmark-current'),
    bookmarksToggle: document.getElementById('bookmarks-toggle'),
    bookmarksCount: document.getElementById('bookmarks-count'),
    bookmarksPanel: document.getElementById('bookmarks-panel'),
    bookmarksSummary: document.getElementById('bookmarks-summary'),
    bookmarksList: document.getElementById('bookmarks-list'),
    notesToggle: document.getElementById('notes-toggle'),
    notesCount: document.getElementById('notes-count'),
    notesPanel: document.getElementById('notes-panel'),
    notesList: document.getElementById('notes-list'),
    notesSummary: document.getElementById('notes-summary'),
    closeStaleNotes: document.getElementById('close-stale-notes'),
    notesPath: document.getElementById('notes-path'),
    editor: document.getElementById('note-editor'),
    editorQuote: document.getElementById('note-quote'),
    editorColors: document.getElementById('note-colors'),
    editorText: document.getElementById('note-text'),
    editorSave: document.getElementById('note-save'),
    editorCancel: document.getElementById('note-cancel'),
    editorDelete: document.getElementById('note-delete'),
}

const DEFAULT_READER_PROFILE = {
    version: 1,
    fontSize: 100,
    fontFamily: 'publisher',
    bold: false,
    lineHeight: 1.5,
    characterSpacing: 0,
    wordSpacing: 0,
    pageMargin: 48,
    textAlign: 'publisher',
    columns: 'auto',
    readingMode: 'paginated',
    theme: 'publisher',
}

const emptyBookState = () => ({
    version: 1,
    cfi: null,
    fraction: 0,
    bookmarks: [],
    lastUsed: Date.now(),
})

let readerProfile = { ...DEFAULT_READER_PROFILE }
let readerStyles = ''
let profileRequest = 0
let latestProfileEcho = 0
const bookStates = new Map()
let currentBookId = null
let currentBookState = emptyBookState()

// The preset table arrives from the extension host (src/config.ts is the single
// source of truth, spec §6.1). Until it does, fall back to the documented
// default so the frame has a size to lay out at.
let DEVICES = { 'iphone': { group: 'phone', label: 'iPhone', width: 393, height: 852 } }

let state = {
    device: 'iphone',
    custom: { width: 393, height: 852 },
    landscape: false,
}
/**
 * Each chapter's 0-based start line in the `.md`, in chapter order.
 *
 * Sent by the host with every build. It is what turns a note's line into the
 * chapter to navigate to, which is the only way to reach a note in a section
 * foliate has not rendered — those have no CFI yet.
 */
let chapterStartLines = []

let currentBook = null
// Set as soon as a renderer *may* exist, i.e. before view.open() rather than
// after it, so a half-finished open still gets torn down on the next rebuild.
let opened = false

function fillDeviceMenu() {
    const previous = state.device
    el.device.replaceChildren()

    const groups = new Map()
    for (const [key, d] of Object.entries(DEVICES)) {
        if (!groups.has(d.group)) groups.set(d.group, [])
        groups.get(d.group).push([key, d])
    }
    for (const [name, entries] of groups) {
        const g = document.createElement('optgroup')
        g.label = t(`device.group.${name}`)
        for (const [key, d] of entries) {
            const opt = document.createElement('option')
            opt.value = key
            opt.textContent = `${d.label}  ${d.width}×${d.height}`
            g.append(opt)
        }
        el.device.append(g)
    }

    const other = document.createElement('optgroup')
    other.label = t('device.group.other')
    for (const [value, text] of [
        ['panel', t('device.panel')],
        ['custom', t('device.custom', state.custom)],
    ]) {
        const opt = document.createElement('option')
        opt.value = value
        opt.textContent = text
        other.append(opt)
    }
    el.device.append(other)

    el.device.value = previous
    if (!el.device.value) el.device.value = 'iphone'
}

function frameSize() {
    // 'panel' is the one preset that is not a device: it means "lay out at
    // whatever this panel currently is". That is still an honest viewport —
    // layout happens at a real declared size — which is what separates it from
    // the forbidden behaviour of letting a *device* frame shrink to fit (§6.1).
    if (state.device === 'panel') {
        const style = getComputedStyle(el.stage)
        const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        return {
            width: Math.max(200, Math.round(el.stage.clientWidth - padX)),
            height: Math.max(200, Math.round(el.stage.clientHeight - padY)),
        }
    }
    const base = state.device === 'custom'
        ? state.custom
        : DEVICES[state.device] ?? DEVICES['iphone']
    const { width, height } = base
    return state.landscape ? { width: height, height: width } : { width, height }
}

/**
 * Fit by scaling, never by resizing the frame.
 *
 * `transform: scale()` keeps layout happening at the declared CSS px and only
 * shrinks the picture. Letting the frame flex to the panel (width: 100%) makes
 * foliate-js repaginate at panel width — it looks fine and the page breaks are
 * wrong, which defeats the whole tool. This holds at every panel width: when
 * the panel is narrower than even the smallest preset we keep scaling down.
 * Do not add a "just reflow when it gets really narrow" exception (spec §6.1).
 */
function layout() {
    // A panel sitting behind another tab has no layout box at all, and the
    // observer fires with zeroes. Laying out against those gives a sub-pixel
    // scale, and in `panel` mode resizes the frame itself down to the 200px
    // floor — a size foliate would then paginate against. Keep the last good
    // layout; the observer fires again with real numbers when the panel returns.
    if (el.stage.clientWidth < 2 || el.stage.clientHeight < 2) return

    const { width, height } = frameSize()
    const style = getComputedStyle(el.stage)
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const availW = Math.max(1, el.stage.clientWidth - padX)
    const availH = Math.max(1, el.stage.clientHeight - padY)

    const scale = Math.min(1, availW / width, availH / height)

    el.frame.style.width = `${width}px`
    el.frame.style.height = `${height}px`
    el.frame.style.transform = `scale(${scale})`
    el.outer.style.width = `${width * scale}px`
    el.outer.style.height = `${height * scale}px`

    const pct = Math.round(scale * 100)
    el.size.textContent = `${width}×${height}${pct < 100 ? `　${pct}%` : ''}`
    el.appearancePanel.style.top = `${el.toolbar.offsetHeight + 6}px`
}

// --- the device frame ------------------------------------------------------
//
// The frame is an iframe, and everything foliate does happens inside it. That
// is not isolation for its own sake: the paginator sizes its columns from
// `#container.getBoundingClientRect()`, which reports the *transformed* size,
// so a frame scaled down to fit the panel was laying the book out at whatever
// it looked like rather than at the device size it declares. Measured at 56%,
// an iPhone frame paginated the book 204px wide inside a 393px layout box —
// page breaks belonging to a device nobody chose, which is precisely what §6.1
// exists to prevent. Inside an iframe that rect is relative to the iframe's own
// viewport, and a transform on the iframe element cannot reach it: 393 either
// way. It also means a scale change no longer invalidates pagination at all,
// which is why nothing here repaginates on resize any more.
//
// srcdoc keeps the frame same-origin, so this file reaches straight into
// contentDocument and the notes engine, selection handling and CFI code did not
// have to move or grow a message protocol. The one boundary that matters is
// identity: anything foliate will `instanceof` — Blob, File — must be built
// from the frame's own constructors, or zip.js's checks fail silently.
//
// **Nothing inside the frame may load a URL.** VSCode serves webview resources
// through a service worker that works out *which* webview is asking from the
// requesting client's query string — `new URL(client.url).searchParams.get('id')`
// (service-worker.js:677) — and a srcdoc document's URL is `about:srcdoc`, which
// has no query. So every such request is answered "Could not resolve webview id"
// and 404s. That is not just this frame's own script: foliate imports zip.js,
// epub.js and paginator.js *dynamically*, from inside the frame, at the moment a
// book is opened. The frame's whole module graph is therefore bundled into
// media/stage.bundle.js and injected as text by this document, which is a client
// the service worker can resolve. The spike cannot see any of this — a plain HTTP
// server has no service worker and serves whoever asks — so this is one of the
// few things only a real VSCode window can check.

/** The frame's realm: `{ win, makeBook, Overlayer }`. Null until `staged`. */
let stage = null

/** Resolves with the frame's realm once <foliate-view> is registered in it. */
const staged = startStage()
staged.then(
    ready => { stage = ready; bindView(el.view) },
    err => showError(t('error.preview', { error: err?.stack ?? err })),
)

async function startStage() {
    // Fetched here rather than linked in there, because only this document can
    // fetch them at all. The palette has to reach the frame because the
    // highlight is drawn in the frame's document and custom properties do not
    // cross a document boundary; marks.css stays the one place it is written.
    const [code, palette] = await Promise.all([
        fetchText(new URL('stage.bundle.js', import.meta.url), 'stage.bundle.js'),
        fetchText(new URL('marks.css', import.meta.url), 'marks.css'),
    ])

    const doc = await frameDocument()
    const win = doc.defaultView

    const style = doc.createElement('style')
    style.textContent = palette
    doc.head.append(style)

    // An inline script needs the page's nonce — the frame inherits this
    // document's CSP, nonce and all. It is a classic script, not a module, so
    // appending it runs it: by the next line either __mdepub is there or the
    // reason it is not has been caught, with no timeout to wait out.
    let failure = null
    win.addEventListener('error', ev => { failure ??= ev.error ?? ev.message })
    const script = doc.createElement('script')
    script.setAttribute('nonce', pageNonce())
    script.textContent = code
    doc.head.append(script)

    if (!win.__mdepub) {
        throw new Error(failure
            ? t('error.stageFailed', { error: failure.stack ?? failure })
            : t('error.stageMissing'))
    }
    el.view = doc.getElementById('view')
    return { win, ...win.__mdepub }
}

/** The frame's document, once srcdoc has replaced the initial about:blank. */
function frameDocument() {
    return new Promise((resolve, reject) => {
        const onLoad = () => {
            // The frame fires load for its initial about:blank too; the marker
            // element is what says the srcdoc document is the one that arrived.
            const doc = el.frame.contentDocument
            if (!doc?.getElementById('view')) return
            el.frame.removeEventListener('load', onLoad)
            clearTimeout(timer)
            resolve(doc)
        }
        el.frame.addEventListener('load', onLoad)
        const timer = setTimeout(() => {
            el.frame.removeEventListener('load', onLoad)
            reject(new Error(el.frame.contentDocument
                ? t('error.frameMissing')
                : t('error.frameCrossOrigin')))
        }, 10000)

        el.frame.srcdoc = '<!doctype html><meta charset="utf-8">'
            + '<style>html,body{margin:0;height:100%;overflow:hidden}'
            + 'foliate-view{display:block;width:100%;height:100%;overflow:hidden}</style>'
            + '<foliate-view id="view"></foliate-view>'
    })
}

/**
 * This page's CSP nonce, for the script injected into the frame.
 *
 * Our own <script> carries it. The content attribute is blanked once the element
 * is in the document — that is the point of a nonce — but the IDL property keeps
 * the value; the meta tag is the fallback for a host that does it differently.
 */
function pageNonce() {
    const own = document.querySelector('script[type="module"][src]')?.nonce
    if (own) return own
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''
    return csp.match(/'nonce-([^']+)'/)?.[1] ?? ''
}

async function fetchText(url, what) {
    let res
    try {
        res = await fetch(url)
    } catch (err) {
        throw new Error(t('error.fetch', { resource: what, error: err?.message ?? err }))
    }
    if (!res.ok) throw new Error(t('error.fetchHttp', { resource: what, status: res.status }))
    return res.text()
}

/**
 * Everything that listens to the view, bound once the frame's realm exists.
 *
 * These used to run at module scope. They cannot any more: `el.view` does not
 * exist until the frame has loaded and upgraded the element.
 */
function bindView(view) {
    view.addEventListener('load', onSectionLoad)
    view.addEventListener('relocate', onRelocate)
    view.addEventListener('draw-annotation', onDrawAnnotation)
    view.addEventListener('show-annotation', onShowAnnotation)
    view.addEventListener('create-overlay', onCreateOverlay)
    view.history.addEventListener('index-change', updateHistoryButtons)
}

/** Save position, relayout, restore. No rebuild, no round trip (spec §4.4). */
async function applyDeviceChange() {
    const cfi = el.view?.lastLocation?.cfi ?? null
    const fraction = el.view?.lastLocation?.fraction
    layout()
    if (!currentBook || (!cfi && typeof fraction !== 'number')) return
    // Let the paginator's ResizeObserver run before asking for the old spot back.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    await restoreWithFallback(cfi, fraction)
}

el.device.addEventListener('change', () => {
    state.device = el.device.value
    vscode.setState(state)
    void applyDeviceChange()
})

el.rotate.addEventListener('click', () => {
    state.landscape = !state.landscape
    vscode.setState(state)
    void applyDeviceChange()
})

new ResizeObserver(() => layout()).observe(el.stage)

// --- reader appearance ---------------------------------------------------

const appearanceInputs = [
    el.appearanceFontSize,
    el.appearanceFontFamily,
    el.appearanceBold,
    el.appearanceLineHeight,
    el.appearanceCharacterSpacing,
    el.appearanceWordSpacing,
    el.appearancePageMargin,
    el.appearanceTextAlign,
    el.appearanceColumns,
    el.appearanceReadingMode,
    el.appearanceTheme,
]

function profileFromControls() {
    return {
        version: 1,
        fontSize: Number(el.appearanceFontSize.value),
        fontFamily: el.appearanceFontFamily.value,
        bold: el.appearanceBold.checked,
        lineHeight: Number(el.appearanceLineHeight.value),
        characterSpacing: Number(el.appearanceCharacterSpacing.value),
        wordSpacing: Number(el.appearanceWordSpacing.value),
        pageMargin: Number(el.appearancePageMargin.value),
        textAlign: el.appearanceTextAlign.value,
        columns: el.appearanceColumns.value,
        readingMode: el.appearanceReadingMode.value,
        theme: el.appearanceTheme.value,
    }
}

function updateAppearanceOutputs() {
    el.appearanceFontSizeValue.value = `${el.appearanceFontSize.value}%`
    el.appearanceLineHeightValue.value = Number(el.appearanceLineHeight.value).toFixed(1)
    el.appearanceCharacterSpacingValue.value = `${Number(el.appearanceCharacterSpacing.value).toFixed(2)}em`
    el.appearanceWordSpacingValue.value = `${Number(el.appearanceWordSpacing.value).toFixed(2)}em`
    el.appearancePageMarginValue.value = `${el.appearancePageMargin.value}px`
}

function renderProfileControls(profile) {
    el.appearanceFontSize.value = profile.fontSize
    el.appearanceFontFamily.value = profile.fontFamily
    el.appearanceBold.checked = profile.bold
    el.appearanceLineHeight.value = profile.lineHeight
    el.appearanceCharacterSpacing.value = profile.characterSpacing
    el.appearanceWordSpacing.value = profile.wordSpacing
    el.appearancePageMargin.value = profile.pageMargin
    el.appearanceTextAlign.value = profile.textAlign
    el.appearanceColumns.value = profile.columns
    el.appearanceReadingMode.value = profile.readingMode
    el.appearanceTheme.value = profile.theme
    updateAppearanceOutputs()
}

function requestProfileSave(profile = profileFromControls()) {
    updateAppearanceOutputs()
    const requestId = ++profileRequest
    vscode.postMessage({ type: 'reader:profile-save', profile, requestId })
}

for (const input of appearanceInputs) input.addEventListener('input', () => requestProfileSave())

el.appearanceToggle.addEventListener('click', () => {
    el.appearancePanel.hidden = !el.appearancePanel.hidden
    if (!el.appearancePanel.hidden) {
        el.readerDrawer.hidden = true
        layoutAfterChromeChange()
    }
})
el.appearanceClose.addEventListener('click', () => { el.appearancePanel.hidden = true })
el.appearanceReset.addEventListener('click', () => requestProfileSave(DEFAULT_READER_PROFILE))

function setRendererAttribute(renderer, name, value) {
    if (value == null) renderer.removeAttribute(name)
    else renderer.setAttribute(name, value)
}

function configurePaginator(renderer, profile) {
    setRendererAttribute(renderer, 'flow', profile.readingMode === 'scrolled' ? 'scrolled' : null)
    setRendererAttribute(renderer, 'margin',
        profile.pageMargin === DEFAULT_READER_PROFILE.pageMargin ? null : `${profile.pageMargin}px`)

    const count = profile.columns === 'single' ? '1'
        : profile.columns === 'double' ? '2' : null
    setRendererAttribute(renderer, 'max-column-count', count)
    // Foliate normally forces one portrait column. The paired attribute keeps a
    // deliberate two-column choice deliberate in portrait too.
    setRendererAttribute(renderer, 'max-column-count-portrait', count)
}

const paintFrames = () => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)))
const boundedPaint = () => Promise.race([
    paintFrames(),
    new Promise(resolve => setTimeout(resolve, 120)),
])

async function settleReaderLayout(renderer) {
    const docs = renderer?.getContents?.().map(item => item.doc).filter(Boolean) ?? []
    // A malformed or unavailable embedded font can leave FontFaceSet.ready
    // pending indefinitely. Give fonts a chance to settle, but never let one
    // resource freeze all later appearance changes and navigation.
    await Promise.race([
        Promise.all(docs.map(doc => doc.fonts?.ready ?? Promise.resolve())),
        new Promise(resolve => setTimeout(resolve, 250)),
    ])
    await boundedPaint()
    await new Promise(resolve => setTimeout(resolve, 40))
    await boundedPaint()
}

async function navigateWithoutHistory(target) {
    if (!target || !el.view?.renderer) return false
    const resolved = el.view.resolveNavigation(target)
    if (!resolved) return false
    try {
        await el.view.renderer.goTo(resolved)
        return true
    } catch {
        return false
    }
}

async function restoreWithFallback(cfi, fraction) {
    if (cfi && await navigateWithoutHistory(cfi)) return true
    if (typeof fraction === 'number') return navigateWithoutHistory({ fraction })
    return false
}

/** Apply in place: same book, same renderer, then return to the captured CFI. */
async function applyReaderProfileToRenderer(preserveLocation = true) {
    const renderer = el.view?.renderer
    if (!renderer) return
    const identity = renderer
    const location = el.view.lastLocation
    const cfi = preserveLocation ? location?.cfi ?? null : null
    const fraction = preserveLocation ? location?.fraction : null

    renderer.setStyles(readerStyles)
    configurePaginator(renderer, readerProfile)
    if (!preserveLocation) return

    await settleReaderLayout(renderer)
    if (el.view.renderer !== identity) return
    await restoreWithFallback(cfi, fraction)
    await redrawAll()
}

// --- navigation -----------------------------------------------------------
// foliate-js only binds touch gestures itself; keyboard and buttons are the
// host app's job. Keys have to be bound to the paginated iframe's document as
// well as ours, or they do nothing whenever the book has focus — which is most
// of the time. The view's 'load' event hands us that document.

const goLeft = () => el.view?.goLeft?.()
const goRight = () => el.view?.goRight?.()

function updateHistoryButtons() {
    const history = el.view?.history
    el.historyBack.disabled = !history?.canGoBack
    el.historyForward.disabled = !history?.canGoForward
}

function handleKey(ev) {
    const target = ev.target
    if (target?.matches?.('input, textarea, select, button, [contenteditable="true"]')) return
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return
    switch (ev.key) {
        case 'ArrowLeft': case 'PageUp': case 'h': goLeft(); break
        case 'ArrowRight': case 'PageDown': case 'l': goRight(); break
        case ' ': (ev.shiftKey ? goLeft() : goRight()); break
        case 'Home': el.view?.goTo?.(0); break
        default: return
    }
    ev.preventDefault()
}

function handleReaderShortcut(ev) {
    const command = ev.ctrlKey || ev.metaKey
    if (command && ev.key.toLowerCase() === 'f') {
        openDrawer('search')
        ev.preventDefault()
        return
    }
    if (command && ev.key.toLowerCase() === 'd') {
        toggleCurrentBookmark()
        ev.preventDefault()
        return
    }
    if (ev.altKey && ev.key === 'ArrowLeft') {
        el.view?.history?.back()
        ev.preventDefault()
        return
    }
    if (ev.altKey && ev.key === 'ArrowRight') {
        el.view?.history?.forward()
        ev.preventDefault()
    }
}

el.prev.addEventListener('click', goLeft)
el.next.addEventListener('click', goRight)
el.historyBack.addEventListener('click', () => el.view?.history?.back())
el.historyForward.addEventListener('click', () => el.view?.history?.forward())
document.addEventListener('keydown', handleKey)
document.addEventListener('keydown', handleReaderShortcut)
function onSectionLoad(ev) {
    const doc = ev.detail?.doc
    const index = ev.detail?.index
    if (!doc) return
    doc.addEventListener('keydown', handleKey)
    doc.addEventListener('keydown', handleReaderShortcut)
    doc.addEventListener('keydown', handleEscape, true)

    // Selection lives inside the paginated iframe, so the listener has to go on
    // that document. 'mouseup' rather than 'selectionchange': the latter fires
    // on every character as a drag grows, and the bar would chase the cursor.
    doc.addEventListener('mouseup', ev => {
        const described = describeImage(doc, index, ev.target) ?? describeSelection(doc, index)
        if (!described) { hideMarkBar(); return }
        pending = described
        showMarkBar(described.rect)
    })
    doc.addEventListener('mousedown', hideMarkBar)
}

function flattenToc(items, depth = 0, out = []) {
    for (const item of items ?? []) {
        if (item.href) out.push({
            label: `${'\u00a0\u00a0'.repeat(depth)}${item.label?.trim() || t('toc.untitled')}`,
            href: item.href,
        })
        if (item.subitems?.length) flattenToc(item.subitems, depth + 1, out)
    }
    return out
}

function fillToc(book) {
    const items = flattenToc(book?.toc)
    el.toc.replaceChildren()
    el.toc.disabled = items.length === 0
    for (const [i, item] of items.entries()) {
        const opt = document.createElement('option')
        opt.value = String(i)
        opt.textContent = item.label
        el.toc.append(opt)
    }
    el.toc.__items = items
}

el.toc.addEventListener('change', () => {
    const item = el.toc.__items?.[Number(el.toc.value)]
    if (item) void el.view.goTo(item.href)
})

// Without this the panel gives no sign that the book continues past the
// current page, which reads as "it only rendered a fragment".
let scrubbing = false

function postCurrentBookState(immediate = false) {
    if (!currentBookId) return
    bookStates.set(currentBookId, currentBookState)
    vscode.postMessage({
        type: 'reader:book-state-save',
        bookId: currentBookId,
        state: currentBookState,
        immediate,
    })
}

function onRelocate(ev) {
    const loc = ev.detail ?? {}
    const parts = []
    if (loc.section) parts.push(t('progress.chapter', {
        current: loc.section.current + 1,
        total: loc.section.total,
    }))
    if (typeof loc.fraction === 'number') parts.push(`${Math.round(loc.fraction * 100)}%`)
    el.progress.textContent = parts.join('  ')
    if (!scrubbing && typeof loc.fraction === 'number') {
        el.progressScrubber.value = String(loc.fraction * 100)
    }

    if (currentBookId) {
        currentBookState = {
            ...currentBookState,
            cfi: typeof loc.cfi === 'string' ? loc.cfi : currentBookState.cfi,
            fraction: typeof loc.fraction === 'number' ? loc.fraction : currentBookState.fraction,
        }
        if (!scrubbing) postCurrentBookState(false)
        updateCurrentBookmarkButton()
    }

    const label = loc.tocItem?.label?.trim()
    if (label && el.toc.__items) {
        const idx = el.toc.__items.findIndex(i => i.label.trim() === label)
        if (idx >= 0) el.toc.value = String(idx)
    }
}

let scrubFrame = 0
let scrubTarget = 0
el.progressScrubber.addEventListener('input', () => {
    scrubbing = true
    scrubTarget = Number(el.progressScrubber.value) / 100
    el.progress.textContent = `${Math.round(scrubTarget * 100)}%`
    if (scrubFrame) return
    scrubFrame = requestAnimationFrame(async () => {
        scrubFrame = 0
        await navigateWithoutHistory({ fraction: scrubTarget })
    })
})
el.progressScrubber.addEventListener('change', async () => {
    const fraction = Number(el.progressScrubber.value) / 100
    scrubbing = false
    try { await el.view?.goToFraction?.(fraction) } catch { /* no open book yet */ }
})

// --- marking and notes (spec §10) -----------------------------------------
//
// Notes live in `<book>.md.notes.json`, which the extension host owns; the
// webview never touches the filesystem. What travels between them is the note
// list, and what is drawn here is that list painted onto foliate's overlayer.
//
// Two anchors per note, deliberately:
//   · a CFI, which addresses the *rendered* book and is what foliate draws from.
//     It is regenerated on every rebuild and never persisted.
//   · a line/column range into the `.md`, which is what persists and what an
//     agent resolves against. `data-md-line` on each block element is the bridge
//     (see src/epub/render.ts); the host re-anchors and tells us the standing.

const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple']
const ELIDE_OVER = 120
const KEEP_EACH = 45

/** Mirrors elideQuote in src/notes.ts — a long mark is stored head + tail. */
function elideQuote(text) {
    const clean = text.replace(/\s+/g, ' ').trim()
    const chars = [...clean]
    if (chars.length <= ELIDE_OVER) return { quote: clean }
    return {
        quote: `${chars.slice(0, KEEP_EACH).join('')} […${chars.length - KEEP_EACH * 2}…] ${chars.slice(-KEEP_EACH).join('')}`,
        quoteLength: chars.length,
    }
}

/** Notes as the host last sent them, each carrying `status` and `line`. */
let notes = []
/**
 * Section index → the annotation values currently painted on that section.
 *
 * The values, not just the indices: `overlayer.remove()` matches the key string
 * exactly, so removing a drawing requires knowing the string it went in under.
 * Keeping them is what lets a redraw be authoritative — see drawSection.
 */
const drawn = new Map()
/** The selection captured when the mark bar appeared. */
let pending = null
/** The note the editor is currently editing, or null when marking a new one. */
let editing = null
/**
 * The note the reader is looking at, or null.
 *
 * Held by id rather than by CFI, because a CFI is regenerated on every rebuild
 * and the selection has to survive one — a keystroke must not clear it.
 */
let selectedId = null

const colorVar = (color) => `var(--mark-${COLORS.includes(color) ? color : 'yellow'})`

/**
 * The `.md` line a DOM node sits on.
 *
 * Only block elements carry `data-md-line`, so this walks up from wherever the
 * selection actually landed — usually a text node inside a <strong> or <a>.
 */
function lineOf(node) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
    while (el) {
        const v = el.getAttribute?.('data-md-line')
        if (v != null) return Number(v)
        el = el.parentElement
    }
    return null
}

/**
 * Character offset of `node`/`offset` within its block element's text.
 *
 * The stored column is relative to the block, not the line, because that is
 * what survives the round trip: the rendered text of a block is the markdown of
 * that block minus its syntax, and a reviewer marking `**兩者兼備**` selects the
 * words, not the asterisks.
 */
function columnIn(block, node, offset) {
    if (!block) return 0
    // Measured with a range rather than by walking text nodes, because a
    // boundary does not have to land on one: triple-click and select-all both
    // hand back the element with `offset` counting child *nodes*. Walking for an
    // identity match misses that and falls through to the block's full length —
    // which makes startCol and endCol equal, and a note that reconstructs to a
    // collapsed range is never drawn.
    const range = block.ownerDocument.createRange()
    try {
        range.selectNodeContents(block)
        range.setEnd(node, offset)
    } catch {
        return 0
    }
    return range.toString().length
}

const blockOf = (node) => {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
    while (el && el.getAttribute?.('data-md-line') == null) el = el.parentElement
    return el
}

/** Turn the current selection into everything a note needs. */
function describeSelection(doc, index) {
    const sel = doc.defaultView.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    const text = range.toString()
    if (!text.trim()) return null

    const startBlock = blockOf(range.startContainer)
    const endBlock = blockOf(range.endContainer)
    const startLine = lineOf(range.startContainer)
    if (startLine == null) return null

    // No CFI here on purpose. A note gets exactly one, derived by drawSection
    // from the stored line/column range — see markSelection.
    return {
        index,
        chapter: el.view.lastLocation?.tocItem?.label?.trim() ?? '',
        range: {
            startLine,
            startCol: columnIn(startBlock, range.startContainer, range.startOffset),
            endLine: lineOf(range.endContainer) ?? startLine,
            endCol: columnIn(endBlock, range.endContainer, range.endOffset),
        },
        ...elideQuote(text),
        rect: rectInFrame(doc, range),
    }
}

/** Turn a clicked preview image into a persistent Markdown-side anchor. */
function describeImage(doc, index, target) {
    const image = target?.closest?.('img[data-md-image-src]')
    if (!image) return null
    const startLine = lineOf(image)
    const src = image.getAttribute('data-md-image-src') ?? ''
    if (startLine == null || !src) return null
    const alt = image.getAttribute('data-md-image-alt') ?? image.getAttribute('alt') ?? ''
    return {
        index,
        chapter: el.view.lastLocation?.tocItem?.label?.trim() ?? '',
        range: { startLine, startCol: 0, endLine: startLine, endCol: 0 },
        target: { type: 'image', src, alt },
        quote: alt || src,
        rect: rectInFrame(doc, image),
    }
}

/**
 * The selection's rectangle in the device frame's coordinates.
 *
 * A range measures itself against its own document's viewport, and the book sits
 * in an iframe of foliate's that is inset within the frame by the page margin.
 * Ignoring that offset put the mark bar 11px to the side and 47px above the words
 * it was pointing at, and the error grows with the frame's scale because
 * showMarkBar multiplies by it.
 */
function rectInFrame(doc, target) {
    const rect = target.getBoundingClientRect()
    // The book's iframe element, which lives in the frame's document.
    const bookFrame = doc.defaultView.frameElement
    const offset = bookFrame ? bookFrame.getBoundingClientRect() : { left: 0, top: 0 }
    return {
        left: rect.left + offset.left,
        top: rect.top + offset.top,
        width: rect.width,
        height: rect.height,
    }
}

/**
 * Place the mark bar over the selection.
 *
 * The rect comes from inside the paginated iframe, so it is in the frame's own
 * coordinate space — which `transform: scale()` has shrunk. Converting through
 * the frame's on-screen rect is what keeps the bar on the words at every zoom.
 */
function showMarkBar(rect) {
    const frame = el.frame.getBoundingClientRect()
    const stage = el.stage.getBoundingClientRect()
    const scale = frame.width / el.frame.offsetWidth || 1

    el.markBar.hidden = false
    const barW = el.markBar.offsetWidth
    const x = frame.left - stage.left + (rect.left + rect.width / 2) * scale - barW / 2
    const y = frame.top - stage.top + rect.top * scale - el.markBar.offsetHeight - 8

    el.markBar.style.left = `${Math.max(4, Math.min(x, stage.width - barW - 4))}px`
    el.markBar.style.top = `${Math.max(4, y)}px`
}

const hideMarkBar = () => { el.markBar.hidden = true; pending = null }

/**
 * Paint one note.
 *
 * addAnnotation resolves the CFI, finds the section's overlayer and emits
 * 'draw-annotation' — which is where the colour is chosen, below. It removes
 * any previous drawing for the same value first, so calling it twice is safe.
 */
async function drawNote(note) {
    if (!note.cfi) return
    try {
        await el.view.addAnnotation({
            value: note.cfi, color: note.color, selected: note.id === selectedId,
        })
    } catch { /* section not loaded */ }
}

/**
 * The selected note: its own colour, with a hard edge around it.
 *
 * Built by calling the frame's own highlight and adding a stroke to the group it
 * returns, so no SVG element is constructed here — `createSVGElement` closes over
 * its module realm's document, and elements made in this one would belong to the
 * wrong document. `stroke` is inherited, so the group's rects pick it up.
 *
 * The colour is a literal rather than a `var()`. A custom property that failed to
 * arrive would compute to black, which is exactly what this draws — an invisible
 * failure, and the reason assertion 1b checks computed style at all.
 */
const SELECTED_EDGE = '#000'

const drawSelected = (rects, options) => {
    const g = stage.Overlayer.highlight(rects, options)
    g.setAttribute('stroke', SELECTED_EDGE)
    // 1.5 rather than 1: the frame is routinely scaled to 40% to fit the panel,
    // and a hairline at that size is not a signal. A mark that wraps gets one
    // box per line, abutting edges and all — the alternative is a union outline,
    // and per-line boxes read as one selection without the geometry.
    g.setAttribute('stroke-width', '1.5')
    return g
}

function onDrawAnnotation(ev) {
    const { draw, annotation } = ev.detail
    // The frame's Overlayer, not one imported here: its createSVGElement closes
    // over its own module realm's document.
    draw(annotation.selected ? drawSelected : stage.Overlayer.highlight,
        { color: colorVar(annotation.color) })
}

/** Clicking a drawn highlight selects its note and opens it. */
function onShowAnnotation(ev) {
    const note = notes.find(n => n.cfi === ev.detail.value)
    if (!note) return
    selectNote(note.id)
    openEditor(note)
}

/**
 * The block covering `line` — the innermost one, matching `blockOf`.
 *
 * Looking the line up as a *key* was wrong, and wrong in a way that showed
 * nothing: `data-md-line` is a block's first line, while what arrives here is
 * the line the quoted text sits on, which the host found by searching the
 * markdown. Those agree only for a block that is one line long. Mark anything
 * inside a fenced code block — or a hard-wrapped paragraph, where it is just as
 * broken and much less obvious — and the lookup missed, the note was skipped,
 * and the panel went on listing it as perfectly healthy.
 *
 * Containment also has to pick the innermost block, because that is the one the
 * columns were measured against: `blockOf` walks up to the *nearest* stamped
 * ancestor, so for `<blockquote data-md-line="10"><p data-md-line="10">` it
 * returns the `<p>`. Both contain line 10, and the last in document order is the
 * inner one. An exact-match fast path would have handed back the blockquote and
 * measured columns into the wrong text.
 */
function blockForLine(doc, line) {
    let found = null
    for (const block of doc.querySelectorAll('[data-md-line]')) {
        const start = Number(block.getAttribute('data-md-line'))
        if (!Number.isFinite(start) || start > line) continue
        // markdown-it's map is [start, end), and the attribute keeps that. A
        // build without the end attribute degrades to one line, which is what
        // this did before it existed — never to some other block.
        const raw = block.getAttribute('data-md-line-end')
        const end = raw == null || !Number.isFinite(Number(raw)) ? start + 1 : Number(raw)
        if (line < end) found = block
    }
    return found
}

// Mirrors src/notes.ts. Existing sidecars may contain the original localized
// elision marker, while new files use the language-neutral form.
const QUOTE_ELISION = /\s*(?:\[…\d+…\]|〔…\d+ 字…〕)\s*/
const normalizeRendered = text => text.replace(/\s+/g, ' ').trim()

/**
 * Normalize a block's rendered text while retaining DOM offsets.
 *
 * `elideQuote()` collapses selection whitespace before persistence, whereas a
 * table or hard-wrapped paragraph contains tabs/newlines in `textContent`.
 * `starts` and `ends` map each normalized code unit back to its raw block offset
 * so a quote match can become a DOM Range again.
 */
function indexRenderedText(nodes) {
    let text = ''
    const starts = []
    const ends = []
    let raw = 0
    let pendingSpace = null

    const emit = (char, start, end) => {
        text += char
        starts.push(start)
        ends.push(end)
    }

    for (const node of nodes) {
        const value = node.textContent ?? ''
        for (let i = 0; i < value.length; i++, raw++) {
            const char = value[i]
            if (/\s/.test(char)) {
                if (text && pendingSpace === null) pendingSpace = { start: raw, end: raw + 1 }
                else if (pendingSpace) pendingSpace.end = raw + 1
                continue
            }
            if (pendingSpace) {
                emit(' ', pendingSpace.start, pendingSpace.end)
                pendingSpace = null
            }
            emit(char, raw, raw + 1)
        }
    }
    return { text, starts, ends }
}

/** All start offsets for `needle`, including repeated occurrences. */
function occurrences(text, needle) {
    const found = []
    if (!needle) return found
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push(at)
    return found
}

/**
 * Rebuild a text range from the quote visible in the current EPUB.
 *
 * The source host can relocate a quote to another line, but persisted columns
 * describe the old rendered block. Reusing them after a revision highlights an
 * unrelated neighbor—especially in table rows. The quote is authoritative;
 * the old start column only breaks ties when the same quote occurs twice in one
 * block. Cross-block selections still draw through the end of their first block.
 */
function rangeForQuote(doc, nodes, note, locate, sameBlock) {
    const indexed = indexRenderedText(nodes)
    const parts = note.quote.split(QUOTE_ELISION)
    const elided = parts.length === 2
    const head = normalizeRendered(parts[0] ?? '')
    const tail = elided ? normalizeRendered(parts[1] ?? '') : ''
    if (!head) return null

    let candidates = occurrences(indexed.text, head)
    if (!candidates.length && !sameBlock) {
        // A cross-block quote is not wholly present in its first block. Match a
        // prefix instead, longest first, rather than falling back to stale
        // columns that may now point at unrelated prose.
        const minimum = Math.min(8, head.length)
        for (let length = Math.min(32, head.length);
            length >= minimum && !candidates.length; length--) {
            candidates = occurrences(indexed.text, head.slice(0, length))
        }
    }
    if (!candidates.length) return null

    const starts = candidates
        .map(index => ({ index, raw: indexed.starts[index] }))
        .filter(candidate => candidate.raw != null)
    if (!starts.length) return null
    const chosen = starts.reduce((best, candidate) =>
        Math.abs(candidate.raw - note.range.startCol) < Math.abs(best.raw - note.range.startCol)
            ? candidate : best)

    let normalizedEnd
    if (!sameBlock) {
        normalizedEnd = indexed.text.length
    } else if (elided) {
        const tailAt = indexed.text.indexOf(tail, chosen.index + head.length)
        if (!tail || tailAt < 0) return null
        normalizedEnd = tailAt + tail.length
    } else {
        normalizedEnd = chosen.index + head.length
    }
    const rawEnd = indexed.ends[normalizedEnd - 1]
    if (rawEnd == null) return null

    const [startNode, startOffset] = locate(chosen.raw)
    const [endNode, endOffset] = locate(rawEnd)
    const range = doc.createRange()
    try {
        range.setStart(startNode, startOffset)
        range.setEnd(endNode, endOffset)
    } catch {
        return null
    }
    return range.collapsed ? null : range
}

/**
 * Re-derive each note's CFI from its `.md` range and draw it.
 *
 * CFIs address the rendered book, so every rebuild invalidates them — they are
 * never persisted. What persists is the line range, and the way back is the
 * `data-md-line` attribute: find the block for the line, walk its text to the
 * recorded columns, and build a range foliate can turn into a CFI.
 */
function anchorInDocument(doc, index, note) {
    if (note.status === 'stale') return null
    const line = note.line ?? note.range.startLine
    const block = blockForLine(doc, line)
    if (!block) return null

    if (note.target?.type === 'image') {
        const images = [
            ...(block.matches?.('img[data-md-image-src]') ? [block] : []),
            ...block.querySelectorAll('img[data-md-image-src]'),
        ]
        const image = images.find(candidate =>
            candidate.getAttribute('data-md-image-src') === note.target.src)
            ?? images.find(candidate =>
                note.target.alt
                && candidate.getAttribute('data-md-image-alt') === note.target.alt)
        if (!image) return null
        const range = doc.createRange()
        try { range.selectNode(image) } catch { return null }
        return range.collapsed ? null : range
    }

    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    const nodes = []
    let n
    while ((n = walker.nextNode())) nodes.push(n)
    if (!nodes.length) return null

    const total = nodes.reduce((sum, t) => sum + t.textContent.length, 0)
    const locate = (col) => {
        let left = Math.max(0, Math.min(col, total))
        for (const t of nodes) {
            if (left <= t.textContent.length) return [t, left]
            left -= t.textContent.length
        }
        const last = nodes[nodes.length - 1]
        return [last, last.textContent.length]
    }

    // A mark spanning blocks is clamped to the first one: the columns are
    // block-relative, so an end column from a later block is meaningless here.
    const sameBlock = (note.range.endLine ?? line) === note.range.startLine
    return rangeForQuote(doc, nodes, note, locate, sameBlock)
}

/**
 * Repaint one section so that what is on it is exactly the current note list.
 *
 * This has to remove as well as add, and that is the whole point. addAnnotation
 * only clears the drawing sitting under the *same* value string, so anything
 * whose note was deleted — or that went stale, or whose text moved and so
 * resolves to a different CFI — stays painted until the document is torn down.
 * Deleting a note would leave its highlight on the page, and clicking that ghost
 * would hit-test to a value no note carries, so nothing would open.
 *
 * Removing old-minus-new covers every way a note can stop applying, including
 * the file being deleted out from under us, which is a documented feature.
 */
async function drawSection(index) {
    const contents = el.view.renderer?.getContents?.() ?? []
    const entry = contents.find(c => c.index === index)
    if (!entry?.doc) return

    const previous = drawn.get(index) ?? new Set()
    const current = new Set()

    for (const note of notes) {
        const range = anchorInDocument(entry.doc, index, note)
        if (!range) continue
        // Regenerate the CFI from where the text actually is now, so clicking
        // the highlight still resolves to this note after a rebuild.
        try { note.cfi = el.view.getCFI(index, range) } catch { continue }
        current.add(note.cfi)
        await drawNote(note)
    }

    for (const value of previous) {
        if (current.has(value)) continue
        try { await el.view.deleteAnnotation({ value }) } catch { /* section gone */ }
    }
    drawn.set(index, current)
}

/**
 * Redraws are serialized because drawSection awaits and its old-minus-new set
 * arithmetic is only sound against a settled section: two overlapping passes
 * would let the later one read a half-built `current` as its `previous` and
 * erase highlights the earlier one had just painted.
 */
let drawChain = Promise.resolve()
function queueDraw(index) {
    drawChain = drawChain.then(() => drawSection(index)).catch(() => {})
    return drawChain
}

/**
 * Repaint every rendered section — after any change to `notes`.
 *
 * Driven off the renderer's live contents rather than `drawn`, which only knows
 * about sections a draw has already completed for. A section that has notes but
 * has not been through drawSection yet would never be reached, and the removal
 * pass is exactly what does not happen then: the ghost this whole thing exists
 * to prevent would come back on any chapter the first pass missed.
 */
const redrawAll = () => {
    let last = Promise.resolve()
    for (const c of el.view.renderer?.getContents?.() ?? []) {
        // Returned, not discarded: jumping to a note in a chapter that was not
        // rendered has to wait for the draw, because the CFI it then navigates
        // to is assigned by drawSection. Every draw is on one chain, so the last
        // one queued settles after all of them.
        if (c?.index != null) last = queueDraw(c.index)
    }
    return last
}

/**
 * Make `note` the selected one — the mark the reader is looking at.
 *
 * The drawing carries the state, so changing it means repainting: the selected
 * note draws with an edge and the previous one has to lose it. addAnnotation
 * replaces whatever sits under the same CFI, so a redraw is all it takes.
 */
function selectNote(id) {
    if (selectedId === id) return
    selectedId = id
    renderNoteList()
    void redrawAll()
}

// The overlayer is what annotations attach to, and it is created *after* the
// section's 'load' fires — drawing on 'load' silently paints nothing. This is
// the event that means "the overlayer for this section exists".
function onCreateOverlay(ev) {
    const index = ev.detail?.index
    if (index != null) void queueDraw(index)
}

function toBytes(payload) {
    if (payload instanceof Uint8Array) return payload
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
    // Some VSCode versions deliver typed arrays as plain objects after cloning.
    if (Array.isArray(payload)) return new Uint8Array(payload)
    return new Uint8Array(Object.values(payload))
}

/**
 * Tear down whatever book is open.
 *
 * foliate-js's `open()` *appends* a renderer to its shadow root and never
 * removes the previous one (vendor/foliate-js/view.js, `#root.append`). Without
 * this the old render stays on screen, the new one is clipped below it by
 * `#frame { overflow: hidden }`, and `view.renderer` — what goLeft/goRight
 * drive — points at the invisible one. That is exactly what "typing changes
 * nothing and the page buttons are stuck" looks like from the outside.
 *
 * `close()` is foliate-js's own teardown entry point and is what does the work.
 * It is wrapped because it is reachable on a half-open book: a rebuild landing
 * between open() and init() leaves a paginator whose inner view never loaded,
 * and Paginator.destroy() dereferences that view unconditionally. A teardown
 * that throws must not stop the new book from opening, so the renderer is
 * cleared explicitly afterwards — that, rather than close() returning, is what
 * guarantees nothing stays parked in the shadow root. Nulling it also makes a
 * second close() harmless: Paginator.destroy() nulls its own internals and
 * throws if it runs twice.
 */
function closeCurrentBook() {
    if (!opened) return
    opened = false
    try {
        el.view.close()
    } catch (err) {
        console.warn('foliate view.close() did not finish cleanly', err)
    }
    el.view.renderer?.remove()
    el.view.renderer = null

    // Revoking the old book's blob URLs is what stops a typing session from
    // accumulating one decoded copy of the manuscript per keystroke.
    try { currentBook?.destroy?.() } catch { /* best effort */ }
    currentBook = null
}

/**
 * Resolve once the device frame actually has a box.
 *
 * A panel hidden behind another tab keeps running — retainContextWhenHidden —
 * but everything in it measures zero. A book opened in that state is paginated
 * against nothing, and foliate does not fully recover when the box comes back:
 * the section returns as a single column at half the width it should be, so the
 * text is laid out for one width and displayed at another. Switching documents
 * triggers a rebuild, which is exactly how a hidden panel gets asked to open a
 * book, and switching back then shows an unreadable page.
 *
 * Waiting here rather than dropping the build is deliberate: the payload is the
 * newest state of the document and should be what renders when the panel comes
 * back. queueOpen's sequencing already discards anything superseded while it
 * waited, so at most one deferred open survives.
 */
function whenFrameHasSize() {
    // The frame's *content viewport*, not the element's box. An <iframe> with an
    // explicit width and height reports those however useless its inner document
    // is, so asking the element would let an open proceed against nothing.
    const sized = () => (el.frame.contentWindow?.innerWidth ?? 0) > 0
        && (el.frame.contentWindow?.innerHeight ?? 0) > 0
    if (sized()) return Promise.resolve()
    return new Promise(resolve => {
        const observer = new ResizeObserver(() => {
            if (!sized()) return
            observer.disconnect()
            resolve()
        })
        observer.observe(el.frame)
    })
}

async function initializeReaderLocation(cfi, fraction) {
    if (cfi) {
        try {
            await el.view.init({ lastLocation: cfi })
            return
        } catch {
            // A Markdown edit can invalidate a CFI. Overall fraction is the
            // durable fallback stored alongside it for exactly this case.
        }
    }
    if (typeof fraction === 'number' && fraction > 0) {
        try {
            await el.view.init({ lastLocation: { fraction } })
            return
        } catch { /* fall through to the book's start */ }
    }
    await el.view.init({ lastLocation: null })
}

async function openBook(bytes, keepPosition, bookId) {
    // Both gates before anything is torn down, so a hidden panel keeps showing
    // its last good render instead of going blank until it is looked at again.
    // The stage gate is not optional: el.view does not exist until the frame has
    // loaded and upgraded it, and the box gate alone would not notice.
    const stage = await staged
    await whenFrameHasSize()

    // CFI is content-anchored, so it survives repagination — that is the whole
    // reason position restore is cheap enough to do on every keystroke (§4.2).
    // Read it before closing: close() nulls lastLocation.
    const live = keepPosition ? el.view?.lastLocation : null
    const savedState = bookStates.get(bookId) ?? emptyBookState()
    const cfi = live?.cfi ?? savedState.cfi ?? null
    const fraction = typeof live?.fraction === 'number' ? live.fraction : savedState.fraction
    const searchQuery = el.searchInput.value.trim()
    stopSearchWork(false)
    closeCurrentBook()

    // The old render is about to go, taking its overlayers and every drawn
    // highlight with it. The CFIs go stale too; drawSection regenerates them
    // from each note's .md range once the new sections render.
    drawn.clear()
    hideMarkBar()

    // Built from the frame's constructors, not ours. zip.js does instanceof
    // checks on Blob, and a cross-realm one fails them without saying so.
    const file = new stage.win.File(
        [new stage.win.Uint8Array(bytes)], 'preview.epub', { type: 'application/epub+zip' })
    const book = await stage.makeBook(file)
    currentBook = book
    currentBookId = bookId
    currentBookState = savedState
    opened = true
    await el.view.open(book)
    // setStyles stores its value even before a section exists. Paginator
    // attributes likewise land before init, so the very first restored page is
    // laid out with the active profile instead of flashing publisher defaults.
    await applyReaderProfileToRenderer(false)
    fillToc(book)
    await initializeReaderLocation(cfi, fraction)
    renderBookmarks()
    updateCurrentBookmarkButton()
    updateHistoryButtons()
    document.body.classList.remove('has-error')
    layout()
    if (searchQuery) scheduleSearch(searchQuery, 0)
}

/**
 * Rebuilds arrive as fast as the user types, and openBook() awaits in three
 * places. Two of them interleaving would let an older build finish last and
 * overwrite a newer one — and now that each open tears the previous renderer
 * down, one could destroy a renderer the other is still opening. So every open
 * is chained onto a single promise, and anything superseded while it waited is
 * dropped: latest payload wins.
 *
 * @returns true if the book was opened, false if a newer one had already arrived.
 */
let openChain = Promise.resolve()
let latestOpen = 0
let latestProfileApply = 0

function queueOpen(bytes, keepPosition, bookId) {
    const seq = ++latestOpen
    const run = openChain.then(() => {
        if (seq !== latestOpen) return false
        return openBook(bytes, keepPosition, bookId).then(() => true)
    })
    // Swallow here only — the caller still sees the rejection through `run`.
    // Without this one failed build would break the chain for every later one.
    openChain = run.then(() => {}, () => {})
    return run
}

function queueProfileApply() {
    const seq = ++latestProfileApply
    const run = openChain.then(async () => {
        if (seq !== latestProfileApply) return
        await applyReaderProfileToRenderer(true)
    })
    openChain = run.then(() => {}, () => {})
    return run
}

// --- note storage ---------------------------------------------------------
// The host is the only writer. We post the whole list and let it echo back what
// landed on disk, so what is drawn is never ahead of what was saved.

const saveNotes = (next) => {
    notes = next
    // Repaint straight away rather than waiting for the echo. The echo is what
    // makes it authoritative, but a delete that only takes effect a round trip
    // later reads as a delete that did not work.
    renderNoteList()
    redrawAll()
    vscode.postMessage({
        type: 'notes:save',
        // Strip the fields that only mean something in this session: the CFI is
        // regenerated per render, and status/line are the host's own verdict.
        notes: next.map(({ cfi, status, line, ...rest }) => rest),
    })
}

const newId = () => `n${Date.now().toString(36)}${Math.floor(Math.random() * 4096).toString(36)}`

function markSelection(color, thenEdit) {
    if (!pending) return
    const note = {
        id: newId(),
        color,
        chapter: pending.chapter,
        range: pending.range,
        ...(pending.target ? { target: pending.target } : {}),
        quote: pending.quote,
        ...(pending.quoteLength ? { quoteLength: pending.quoteLength } : {}),
        note: '',
        created: new Date().toISOString(),
        status: 'ok',
        line: pending.range.startLine,
    }
    hideMarkBar()
    // No CFI is attached here, and the mark is not drawn from the live selection.
    // Both would come from a range the reconstruction cannot reproduce exactly —
    // a boundary on a text-node edge, or a mark spanning blocks, resolves to a
    // different CFI when drawSection rebuilds it from the stored columns. Two
    // strings for one note means two drawings, and only one of them removable.
    // So the note gets its single CFI from the same path every later redraw uses.
    saveNotes([...notes, note])
    if (thenEdit) openEditor(note)
}

for (const swatch of el.markBar.querySelectorAll('.swatch')) {
    swatch.addEventListener('click', () => markSelection(swatch.dataset.color, true))
}
el.markNote.addEventListener('click', () => markSelection('yellow', true))

// --- the comment editor ---------------------------------------------------

for (const color of COLORS) {
    const b = document.createElement('button')
    b.className = 'swatch'
    b.dataset.color = color
    b.type = 'button'
    b.addEventListener('click', () => {
        for (const s of el.editorColors.children) s.setAttribute('aria-pressed', String(s === b))
    })
    el.editorColors.append(b)
}

function openEditor(note) {
    editing = note
    el.editorQuote.textContent = note.target?.type === 'image'
        ? t('notes.image', { label: note.target.alt || note.target.src })
        : note.quote
    el.editorText.value = note.note ?? ''
    for (const s of el.editorColors.children) {
        s.setAttribute('aria-pressed', String(s.dataset.color === note.color))
    }
    el.editor.hidden = false
    el.editorText.focus()
}

const closeEditor = () => { el.editor.hidden = true; editing = null }

el.editorCancel.addEventListener('click', closeEditor)
el.editor.addEventListener('click', ev => { if (ev.target === el.editor) closeEditor() })

el.editorSave.addEventListener('click', () => {
    if (!editing) return
    const picked = [...el.editorColors.children].find(s => s.getAttribute('aria-pressed') === 'true')
    const color = picked?.dataset.color ?? editing.color
    // saveNotes repaints, which is what picks up a colour change.
    saveNotes(notes.map(n => n.id === editing.id
        ? { ...n, note: el.editorText.value, color }
        : n))
    closeEditor()
})

/** The one way a note goes away, from the editor and from the list alike. */
function deleteNote(id) {
    const note = notes.find(item => item.id === id)
    if (note?.status === 'stale') {
        vscode.postMessage({ type: 'notes:close-stale', ids: [id] })
        return
    }
    // Nothing on screen is that note any more, so nothing should read as selected.
    if (selectedId === id) selectedId = null
    saveNotes(notes.filter(n => n.id !== id))
}

el.editorDelete.addEventListener('click', () => {
    if (!editing) return
    deleteNote(editing.id)
    closeEditor()
})

// Escape closes the editor before it reaches the book's key handler.
function handleEscape(ev) {
    if (ev.key !== 'Escape') return
    if (!el.editor.hidden) { closeEditor(); ev.stopPropagation() }
    else if (!el.markBar.hidden) { hideMarkBar(); ev.stopPropagation() }
    else if (selectedId) { selectNote(null); ev.stopPropagation() }
    else if (!el.appearancePanel.hidden) { el.appearancePanel.hidden = true; ev.stopPropagation() }
    else if (!el.readerDrawer.hidden) { closeDrawer(); ev.stopPropagation() }
}
document.addEventListener('keydown', handleEscape, true)

// --- shared reader drawer -------------------------------------------------

function openDrawer(name) {
    el.readerDrawer.hidden = false
    el.appearancePanel.hidden = true
    for (const tab of el.drawerTabs) {
        tab.setAttribute('aria-selected', String(tab.dataset.drawerTab === name))
    }
    el.searchPanel.hidden = name !== 'search'
    el.bookmarksPanel.hidden = name !== 'bookmarks'
    el.notesPanel.hidden = name !== 'notes'
    layoutAfterChromeChange()
    if (name === 'search') el.searchInput.focus()
}

function closeDrawer() {
    el.readerDrawer.hidden = true
    layoutAfterChromeChange()
}

function layoutAfterChromeChange() {
    // In `panel` mode the chrome changes the declared viewport, not just its
    // visual scale. Treat that exactly like a device resize and restore CFI.
    if (state.device === 'panel' && currentBook) void applyDeviceChange()
    else layout()
}

function toggleDrawer(name) {
    const selected = el.drawerTabs.find(tab => tab.getAttribute('aria-selected') === 'true')
    if (!el.readerDrawer.hidden && selected?.dataset.drawerTab === name) closeDrawer()
    else openDrawer(name)
}

for (const tab of el.drawerTabs) {
    tab.addEventListener('click', () => openDrawer(tab.dataset.drawerTab))
}
el.drawerClose.addEventListener('click', closeDrawer)
el.searchToggle.addEventListener('click', () => toggleDrawer('search'))
el.bookmarksToggle.addEventListener('click', () => toggleDrawer('bookmarks'))
el.notesToggle.addEventListener('click', () => toggleDrawer('notes'))

// --- whole-book search ---------------------------------------------------

let searchTimer = 0
let searchGeneration = 0
let searchIterator = null
let searchChain = Promise.resolve()
let searchItems = []
let selectedSearchIndex = -1

function resetSearchResults(message = t('search.prompt')) {
    searchItems = []
    selectedSearchIndex = -1
    el.searchResults.replaceChildren()
    el.searchSummary.textContent = message
    el.searchProgress.hidden = true
    el.searchProgress.value = 0
    el.searchPrev.disabled = true
    el.searchNext.disabled = true
}

function stopSearchWork(clearInput = false) {
    searchGeneration++
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = 0
    void searchIterator?.return?.()
    searchIterator = null
    try { el.view?.clearSearch?.() } catch { /* renderer may be closing */ }
    if (clearInput) el.searchInput.value = ''
    resetSearchResults()
}

function appendExcerpt(parent, excerpt) {
    parent.append(document.createTextNode(excerpt?.pre ?? ''))
    const match = document.createElement('mark')
    match.textContent = excerpt?.match ?? ''
    parent.append(match, document.createTextNode(excerpt?.post ?? ''))
}

function appendSearchGroup(group) {
    const title = document.createElement('div')
    title.className = 'search-group-title'
    title.textContent = group.label || t('search.chapter', { number: group.index + 1 })
    el.searchResults.append(title)

    for (const item of group.subitems) {
        const index = searchItems.length
        const row = document.createElement('div')
        row.className = 'search-result'
        row.dataset.searchIndex = String(index)
        appendExcerpt(row, item.excerpt)
        row.addEventListener('click', () => { void activateSearchResult(index) })
        searchItems.push({ ...item, chapter: group.label, element: row })
        el.searchResults.append(row)
    }
}

function updateSearchControls(done = false) {
    const count = searchItems.length
    el.searchPrev.disabled = count === 0
    el.searchNext.disabled = count === 0
    if (done) {
        el.searchSummary.textContent = count ? tCount('search.resultCount', count) : t('search.noResults')
        el.searchProgress.hidden = true
    } else {
        el.searchSummary.textContent = tCount('search.searchingCount', count)
    }
}

async function runSearch(query, generation) {
    if (generation !== searchGeneration) return
    try { el.view?.clearSearch?.() } catch { /* no open renderer */ }
    resetSearchResults(query ? t('search.searching') : undefined)
    if (!query || !currentBook || !el.view) return

    el.searchProgress.hidden = false
    const iterator = el.view.search({
        query,
        matchCase: false,
        matchDiacritics: false,
        matchWholeWords: false,
    })
    searchIterator = iterator

    try {
        for await (const result of iterator) {
            if (generation !== searchGeneration) break
            if (result === 'done') {
                updateSearchControls(true)
            } else if (typeof result?.progress === 'number') {
                el.searchProgress.value = result.progress
            } else if (Array.isArray(result?.subitems)) {
                appendSearchGroup(result)
                updateSearchControls(false)
            }
        }
        if (generation === searchGeneration) updateSearchControls(true)
    } catch (err) {
        if (generation === searchGeneration) {
            resetSearchResults(t('search.failed', { error: err?.message ?? err }))
        }
    } finally {
        if (searchIterator === iterator) searchIterator = null
    }
}

function scheduleSearch(query, delay = 180) {
    const generation = ++searchGeneration
    if (searchTimer) clearTimeout(searchTimer)
    void searchIterator?.return?.()
    searchTimer = setTimeout(() => {
        searchTimer = 0
        searchChain = searchChain
            .then(() => runSearch(query.trim(), generation))
            .catch(() => {})
    }, delay)
}

async function activateSearchResult(index) {
    const item = searchItems[index]
    if (!item) return
    selectedSearchIndex = index
    for (const [i, result] of searchItems.entries()) {
        result.element.classList.toggle('selected', i === index)
    }
    item.element.scrollIntoView({ block: 'nearest' })
    try { await el.view.goTo(item.cfi) } catch { /* stale result after rebuild */ }
}

function stepSearch(direction) {
    if (!searchItems.length) return
    const next = selectedSearchIndex < 0
        ? (direction > 0 ? 0 : searchItems.length - 1)
        : (selectedSearchIndex + direction + searchItems.length) % searchItems.length
    void activateSearchResult(next)
}

el.searchInput.addEventListener('input', () => scheduleSearch(el.searchInput.value))
el.searchForm.addEventListener('submit', ev => {
    ev.preventDefault()
    scheduleSearch(el.searchInput.value, 0)
})
el.searchCancel.addEventListener('click', () => {
    stopSearchWork(true)
    el.searchInput.focus()
})
el.searchPrev.addEventListener('click', () => stepSearch(-1))
el.searchNext.addEventListener('click', () => stepSearch(1))

// --- bookmarks -----------------------------------------------------------

const newBookmarkId = () =>
    `b${Date.now().toString(36)}${Math.floor(Math.random() * 0x10000).toString(36)}`

function bookmarkAtCurrentLocation() {
    const loc = el.view?.lastLocation
    if (!loc) return null
    return currentBookState.bookmarks.find(bookmark =>
        bookmark.cfi === loc.cfi
        || typeof loc.fraction === 'number' && Math.abs(bookmark.fraction - loc.fraction) < 0.0015) ?? null
}

function updateCurrentBookmarkButton() {
    const bookmark = bookmarkAtCurrentLocation()
    el.bookmarkCurrent.textContent = bookmark ? '★' : '☆'
    el.bookmarkCurrent.title = bookmark
        ? t('bookmark.removeCurrent')
        : t('bookmark.addCurrent')
    el.bookmarkCurrent.disabled = !currentBook
}

function saveBookmarks(bookmarks) {
    currentBookState = { ...currentBookState, bookmarks }
    renderBookmarks()
    updateCurrentBookmarkButton()
    postCurrentBookState(true)
}

function toggleCurrentBookmark() {
    const loc = el.view?.lastLocation
    if (!loc || !currentBookId) return
    const existing = bookmarkAtCurrentLocation()
    if (existing) {
        saveBookmarks(currentBookState.bookmarks.filter(b => b.id !== existing.id))
        return
    }
    const bookmark = {
        id: newBookmarkId(),
        cfi: typeof loc.cfi === 'string' ? loc.cfi : null,
        fraction: typeof loc.fraction === 'number' ? loc.fraction : currentBookState.fraction,
        // Keep persisted reader state language-neutral. The localized fallback
        // belongs in renderBookmarks(), not in the sidecar-like state itself.
        chapter: loc.tocItem?.label?.trim() || '',
        created: new Date().toISOString(),
    }
    saveBookmarks([...currentBookState.bookmarks, bookmark])
}

async function activateBookmark(bookmark) {
    let moved = false
    if (bookmark.cfi) {
        try { moved = Boolean(await el.view.goTo(bookmark.cfi)) } catch { /* edited manuscript */ }
    }
    if (!moved) {
        try { await el.view.goToFraction(bookmark.fraction) } catch { /* no book */ }
    }
}

function renderBookmarks() {
    const bookmarks = [...(currentBookState.bookmarks ?? [])]
        .sort((a, b) => a.fraction - b.fraction || a.created.localeCompare(b.created))
    el.bookmarksCount.textContent = bookmarks.length ? String(bookmarks.length) : ''
    el.bookmarksSummary.textContent = bookmarks.length ? tCount('bookmark.count', bookmarks.length) : ''
    el.bookmarksList.replaceChildren()
    if (!bookmarks.length) {
        const empty = document.createElement('div')
        empty.className = 'empty-state'
        empty.textContent = t('bookmark.empty')
        el.bookmarksList.append(empty)
        return
    }

    let chapter = null
    for (const bookmark of bookmarks) {
        const label = bookmark.chapter || t('bookmark.unknownChapter')
        if (label !== chapter) {
            chapter = label
            const heading = document.createElement('div')
            heading.className = 'bookmark-group-title'
            heading.textContent = label
            el.bookmarksList.append(heading)
        }
        const row = document.createElement('div')
        row.className = 'bookmark-item'
        const detail = document.createElement('span')
        detail.className = 'bookmark-label'
        detail.textContent = new Date(bookmark.created).toLocaleString(interfaceLocale)
        const percent = document.createElement('span')
        percent.className = 'bookmark-percent'
        percent.textContent = `${Math.round(bookmark.fraction * 100)}%`
        const remove = document.createElement('button')
        remove.textContent = t('common.delete')
        remove.addEventListener('click', ev => {
            ev.stopPropagation()
            saveBookmarks(currentBookState.bookmarks.filter(b => b.id !== bookmark.id))
        })
        row.append(detail, percent, remove)
        row.addEventListener('click', () => { void activateBookmark(bookmark) })
        el.bookmarksList.append(row)
    }
}

el.bookmarkCurrent.addEventListener('click', toggleCurrentBookmark)

// --- the note list --------------------------------------------------------

/**
 * Report a sidecar that would not parse cleanly.
 *
 * Opening the list is what a user does when a note they wrote is not on screen,
 * so the reason belongs there — and the filename with it, since the fix is to
 * go and look at the file.
 */
function showNotesWarnings(warnings, notesPath) {
    el.notesPath.textContent = notesPath ?? ''
    el.notesPath.title = ''
    el.notesPath.classList.remove('warn')
    el.notesToggle.title = t('toolbar.notes')
    if (!warnings.length) return

    el.notesPath.textContent = `⚠ ${tCount('notes.warningCount', warnings.length, {
        path: notesPath ?? t('notes.fileFallback'),
    })}`
    el.notesPath.title = warnings.join('\n')
    el.notesPath.classList.add('warn')
    // The list may be collapsed, so the count badge has to carry the signal too.
    el.notesToggle.title = `${t('toolbar.notes')}  ⚠ ${warnings.join('\n')}`
}

function renderNoteList() {
    el.notesCount.textContent = notes.length ? String(notes.length) : ''
    const stale = notes.filter(n => n.status === 'stale').length
    el.closeStaleNotes.hidden = stale === 0
    el.notesSummary.textContent = notes.length
        ? `${tCount('notes.count', notes.length)}${stale ? `  ⚠ ${tCount('notes.staleCount', stale)}` : ''}`
        : ''

    el.notesList.replaceChildren()
    if (!notes.length) {
        const empty = document.createElement('div')
        empty.className = 'note-item'
        empty.style.opacity = '0.6'
        empty.textContent = t('notes.empty')
        el.notesList.append(empty)
        return
    }

    for (const note of [...notes].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
        const item = document.createElement('div')
        item.className = 'note-item'
            + (note.status === 'stale' ? ' stale' : '')
            + (note.id === selectedId ? ' selected' : '')

        const meta = document.createElement('div')
        meta.className = 'meta'
        const dot = document.createElement('span')
        dot.className = 'dot'
        dot.style.background = colorVar(note.color)
        meta.append(dot)
        const where = document.createElement('span')
        where.textContent = note.status === 'stale'
            ? `${note.chapter || t('bookmark.unknownChapter')}  ⚠ ${t('notes.stale')}`
            : `${note.chapter || ''}  L${(note.line ?? note.range.startLine) + 1}`
        meta.append(where)
        item.append(meta)

        const quote = document.createElement('div')
        quote.className = 'quote'
        quote.textContent = note.target?.type === 'image'
            ? t('notes.image', { label: note.target.alt || note.target.src })
            : note.quote
        item.append(quote)

        if (note.note) {
            const body = document.createElement('div')
            body.className = 'body'
            body.textContent = note.note
            item.append(body)
        }

        // Every note gets 編輯 and 刪除, not just the stale ones. Clicking the
        // body jumps to the mark, which is the frequent action — but that left
        // an anchored note with no way out of the list at all, because the
        // editor only ever opened by clicking the highlight in the book. From
        // the panel it read as a dead click: nothing happened and no way to
        // delete appeared. A stale note has nowhere to jump to, so for those the
        // body opens the editor instead of navigating.
        const actions = document.createElement('div')
        actions.className = 'actions'
        const edit = document.createElement('button')
        edit.textContent = t('common.edit')
        edit.addEventListener('click', ev => { ev.stopPropagation(); openEditor(note) })
        const del = document.createElement('button')
        del.textContent = t('common.delete')
        del.addEventListener('click', ev => { ev.stopPropagation(); deleteNote(note.id) })
        actions.append(edit, del)
        item.append(actions)

        item.addEventListener('click', () => { void activateNote(note) })

        el.notesList.append(item)
    }
}

el.closeStaleNotes.addEventListener('click', () => {
    const ids = notes.filter(note => note.status === 'stale').map(note => note.id)
    if (ids.length) vscode.postMessage({ type: 'notes:close-stale', ids })
})

/**
 * Clicking a note in the list: go to it, and mark it as the one being looked at.
 *
 * A stale note is the exception, and it always has been — its text is gone, so
 * there is no position to go to and the editor is the only useful thing a click
 * can do. It is not selected either: selection means "this is the mark on
 * screen", and a stale note has no mark.
 */
async function activateNote(note) {
    if (note.status === 'stale') { openEditor(note); return }
    // Selected first, so the draw that the jump triggers already has the edge on
    // it and the section is not painted twice.
    selectNote(note.id)
    if (!await jumpToNote(note)) openEditor(note)
}

/**
 * Bring `note`'s mark on screen. Returns false if there was nowhere to go.
 *
 * A CFI only exists for a section foliate has actually rendered — it is assigned
 * by drawSection — so a note in any other chapter has none, and clicking it used
 * to fall through to the editor. That reads as "the list can only edit, it
 * cannot navigate", which is most of the book for a manuscript of any size.
 * Reaching one means going to its chapter first, waiting for the draw that
 * assigns the CFI, and only then jumping to the exact spot.
 */
async function jumpToNote(note) {
    const goTo = async (target) => {
        try { await el.view.goTo(target); return true } catch { return false }
    }
    if (note.cfi) return goTo(note.cfi)

    const href = chapterHrefFor(note.line ?? note.range.startLine)
    if (!href) return false
    if (!await goTo(href)) return false
    // goTo resolves when the renderer has moved, which is not when the section
    // has been drawn — and the CFI comes from the draw.
    await redrawAll()
    return note.cfi ? goTo(note.cfi) : false
}

/**
 * The href of the chapter containing `line`.
 *
 * The start lines come from the host with each build, because only it knows
 * where the chapters were cut. The href is the TOC's own, not one assembled
 * here: that is the string the chapter dropdown already navigates with, so it
 * needs no second guess about how foliate wants a path spelled. Both are in
 * chapter order, one entry each.
 */
function chapterHrefFor(line) {
    let index = -1
    for (let i = 0; i < chapterStartLines.length; i++) {
        if (chapterStartLines[i] <= line) index = i
    }
    // No map yet — an old host, or notes that arrived before the first book.
    // Better to hand the click back than to jump somewhere arbitrary.
    return index < 0 ? null : el.toc.__items?.[index]?.href ?? null
}

function showError(message) {
    el.error.textContent = message
    document.body.classList.add('has-error')
}

window.addEventListener('message', async ev => {
    const msg = ev.data
    if (!msg) return

    if (msg.type === 'config') {
        applyStaticTranslations(msg.locale)
        if (msg.devices) DEVICES = msg.devices
        state.device = msg.device ?? state.device
        state.custom = { width: msg.customWidth, height: msg.customHeight }
        fillDeviceMenu()
        renderProfileControls(readerProfile)
        renderBookmarks()
        renderNoteList()
        updateCurrentBookmarkButton()
        if (!el.searchInput.value.trim()) resetSearchResults()
        vscode.setState(state)
        void applyDeviceChange()
        return
    }

    if (msg.type === 'reader:profile') {
        if (typeof msg.requestId === 'number') {
            if (msg.requestId < latestProfileEcho) return
            latestProfileEcho = msg.requestId
        }
        readerProfile = { ...DEFAULT_READER_PROFILE, ...(msg.profile ?? {}) }
        readerStyles = typeof msg.styles === 'string' ? msg.styles : ''
        renderProfileControls(readerProfile)
        try { await queueProfileApply() } catch (err) {
            showError(t('error.appearance', { error: err?.stack ?? err }))
        }
        return
    }

    if (msg.type === 'reader:book-state' && typeof msg.bookId === 'string') {
        const next = { ...emptyBookState(), ...(msg.state ?? {}) }
        next.bookmarks = Array.isArray(next.bookmarks) ? next.bookmarks : []
        bookStates.set(msg.bookId, next)
        if (currentBookId === msg.bookId) {
            currentBookState = next
            renderBookmarks()
            updateCurrentBookmarkButton()
        }
        return
    }

    if (msg.type === 'book') {
        el.status.textContent = t('status.updating')
        // Where each chapter starts in the .md — the host cut them, so only it
        // knows. Kept in chapter order, one entry per TOC item, and replaced
        // wholesale on every build because an edit moves the cuts.
        if (Array.isArray(msg.chapterStartLines)) chapterStartLines = msg.chapterStartLines
        try {
            // A superseded build must not report its own warnings — they belong
            // to markdown that is already stale. Leave the indicator alone and
            // let the newer build have the last word.
            const bookId = typeof msg.bookId === 'string' ? msg.bookId : 'preview-session'
            if (!bookStates.has(bookId)) bookStates.set(bookId, emptyBookState())
            if (!await queueOpen(toBytes(msg.bytes), Boolean(msg.keepPosition), bookId)) return
            el.status.textContent = msg.warnings?.length ? `⚠ ${msg.warnings.length}` : ''
            el.status.title = (msg.warnings ?? []).join('\n')
        } catch (err) {
            showError(t('error.preview', { error: err?.stack ?? err }))
            el.status.textContent = ''
        }
        return
    }

    if (msg.type === 'notes') {
        // The host is authoritative: it read the file and re-anchored against
        // the markdown, which is the side that knows the source text.
        const byId = new Map(notes.map(n => [n.id, n]))
        notes = (msg.notes ?? []).map(n => ({ ...n, cfi: byId.get(n.id)?.cfi }))
        // A malformed entry drops itself on parse. Saying so matters more here
        // than for build warnings: this file is written by hand and by agents,
        // and a silently vanished note looks identical to one never saved.
        showNotesWarnings(msg.warnings ?? [], msg.path)
        renderNoteList()
        // Repaint whatever is on screen; sections not yet rendered are picked up
        // by 'create-overlay' when they are.
        redrawAll()
        return
    }

    if (msg.type === 'error') {
        showError(msg.message)
        el.status.textContent = ''
    }
})

const saved = vscode.getState()
if (saved) state = { ...state, ...saved }
fillDeviceMenu()
renderProfileControls(readerProfile)
renderBookmarks()
updateCurrentBookmarkButton()
layout()
vscode.postMessage({ type: 'ready' })
