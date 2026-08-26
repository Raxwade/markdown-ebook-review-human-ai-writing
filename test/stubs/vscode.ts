// Minimal stand-in for the `vscode` module, enough to exercise activate(),
// the export command and panel construction outside an editor.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const messages: { kind: string; text: string }[] = []
export const writtenFiles = new Map<string, Uint8Array>()
export const commands_: Map<string, (...args: any[]) => any> = new Map()
export const watchers: any[] = []
export const globalValues = new Map<string, unknown>()
export const globalUpdates: { key: string; value: unknown }[] = []
export const warningResponses: Array<string | undefined> = []
export const saveDialogResponses: Array<string | undefined> = []
export const saveDialogOptions: unknown[] = []
export let lastPanel: any = null
export const env = { language: 'en' }

export function setLanguage(language: string): void { env.language = language }

export function reset(): void {
    // Preview keeps a static `current` panel, so a test that leaves one open
    // makes the next one reveal instead of create. Close it like the user would.
    lastPanel?.disposeListener?.()
    messages.length = 0
    writtenFiles.clear()
    commands_.clear()
    watchers.length = 0
    globalValues.clear()
    globalUpdates.length = 0
    warningResponses.length = 0
    saveDialogResponses.length = 0
    saveDialogOptions.length = 0
    lastPanel = null
    settings.clear()
    settingScopes.clear()
    folders = undefined
    activeDocument = null
    activeEditorListener = null
    env.language = 'en'
}

export function setGlobalValue(key: string, value: unknown): void { globalValues.set(key, value) }

export const globalState = {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
        (globalValues.has(key) ? globalValues.get(key) : defaultValue) as T | undefined,
    update: (key: string, value: unknown) => {
        globalValues.set(key, structuredClone(value))
        globalUpdates.push({ key, value: structuredClone(value) })
        return Promise.resolve()
    },
}

const settings = new Map<string, unknown>()
export function setSetting(key: string, value: unknown): void { settings.set(key, value) }

// Which scope a setting came from decides how far extension.ts trusts it, so
// the stub has to be able to say. Default is user scope — the trusted one.
const settingScopes = new Map<string, 'global' | 'workspace'>()
export function setSettingScope(key: string, scope: 'global' | 'workspace'): void {
    settingScopes.set(key, scope)
}

// `name` is what VSCode shows for a root and what a .code-workspace can pin; it
// defaults to the folder's own directory name. sourcePathFor uses it to tell
// multi-root folders apart, so the stub has to carry it.
let folders: { name: string; uri: { fsPath: string } }[] | undefined
export function setWorkspaceFolders(paths: string[] | undefined, names?: string[]): void {
    folders = paths?.map((p, i) => ({
        name: names?.[i] ?? p.split('/').filter(Boolean).pop() ?? p,
        uri: Uri.file(p),
    }))
}

export let activeDocument: any = null
export function setActiveDocument(doc: any): void { activeDocument = doc }

let activeEditorListener: ((editor: any) => void) | null = null
export function fireDidChangeActiveTextEditor(document: any): void {
    activeDocument = document
    activeEditorListener?.(document ? { document } : undefined)
}

/** Registered by preview.ts; `fireDidChangeTextDocument` stands in for typing. */
let docChangeListener: ((e: any) => void) | null = null
export function fireDidChangeTextDocument(document: any): void {
    docChangeListener?.({ document })
}

export const Uri = {
    file: (p: string) => ({
        fsPath: p,
        scheme: 'file',
        path: p,
        toString: () => `file://${p}`,
    }),
    joinPath: (base: any, ...parts: string[]) => Uri.file([base.fsPath, ...parts].join('/')),
}

export const ViewColumn = { Beside: -2, One: 1 }

export const window = {
    get activeTextEditor() {
        return activeDocument ? { document: activeDocument } : undefined
    },
    showErrorMessage: (text: string) => { messages.push({ kind: 'error', text }); return Promise.resolve(undefined) },
    showWarningMessage: (text: string, ..._items: unknown[]) => {
        messages.push({ kind: 'warning', text })
        return Promise.resolve(warningResponses.shift())
    },
    showInformationMessage: (text: string) => { messages.push({ kind: 'info', text }); return Promise.resolve(undefined) },
    showSaveDialog: (options: unknown) => {
        saveDialogOptions.push(options)
        const response = saveDialogResponses.shift()
        return Promise.resolve(response ? Uri.file(response) : undefined)
    },
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    onDidChangeActiveTextEditor: (fn: (editor: any) => void) => {
        activeEditorListener = fn
        return { dispose() { activeEditorListener = null } }
    },
    createWebviewPanel: (_type: string, title: string, _col: unknown, options: any) => {
        const posted: any[] = []
        lastPanel = {
            title,
            options,
            posted,
            webview: {
                html: '',
                cspSource: 'vscode-resource://test',
                asWebviewUri: (u: any) => ({ toString: () => `https://webview.test${u.fsPath}` }),
                postMessage: (m: any) => { posted.push(m); return Promise.resolve(true) },
                onDidReceiveMessage: (fn: any) => { lastPanel.receive = fn; return { dispose() {} } },
            },
            reveal() {},
            // A real panel starts visible. Rebuilds are deferred while hidden —
            // a book laid out in a panel with no box comes back unreadable — so
            // tests that exercise a build need this to be true.
            visible: true,
            viewStateListener: null as null | (() => void),
            onDidChangeViewState: (fn: () => void) => {
                lastPanel.viewStateListener = fn
                return { dispose() {} }
            },
            /** Flip visibility and fire the listener, the way VSCode does. */
            setVisible(v: boolean) { lastPanel.visible = v; lastPanel.viewStateListener?.() },
            disposeListener: null as null | (() => void),
            onDidDispose: (fn: () => void) => { lastPanel.disposeListener = fn; return { dispose() {} } },
            dispose() { lastPanel.disposeListener?.() },
        }
        return lastPanel
    },
}

export const workspace = {
    get workspaceFolders() { return folders },
    getWorkspaceFolder: (uri: any) =>
        folders?.find(f => uri.fsPath === f.uri.fsPath || uri.fsPath.startsWith(f.uri.fsPath + '/')),
    getConfiguration: () => ({
        get: (key: string) => settings.get(key),
        inspect: (key: string) => {
            const value = settings.get(key)
            if (value === undefined) return undefined
            return settingScopes.get(key) === 'workspace'
                ? { key, workspaceValue: value }
                : { key, globalValue: value }
        },
    }),
    onDidChangeTextDocument: (fn: (e: any) => void) => {
        docChangeListener = fn
        return { dispose() { docChangeListener = null } }
    },
    onDidChangeConfiguration: () => ({ dispose() {} }),
    // Records the glob and the handlers so a test can fire a change or a delete
    // the way the editor would, without touching a real watcher.
    createFileSystemWatcher: (glob: string) => {
        const w = {
            glob,
            handlers: { create: [] as (() => void)[], change: [] as (() => void)[], delete: [] as (() => void)[] },
            onDidCreate: (fn: () => void) => { w.handlers.create.push(fn); return { dispose() {} } },
            onDidChange: (fn: () => void) => { w.handlers.change.push(fn); return { dispose() {} } },
            onDidDelete: (fn: () => void) => { w.handlers.delete.push(fn); return { dispose() {} } },
            fire: (kind: 'create' | 'change' | 'delete') => w.handlers[kind].forEach(fn => fn()),
            dispose() {},
        }
        watchers.push(w)
        return w
    },
    fs: {
        writeFile: (uri: any, bytes: Uint8Array) => {
            writtenFiles.set(uri.fsPath, bytes)
            return Promise.resolve()
        },
    },
}

export const commands = {
    registerCommand: (id: string, fn: (...args: any[]) => any) => {
        commands_.set(id, fn)
        return { dispose() {} }
    },
    executeCommand: (id: string, ...args: any[]) => commands_.get(id)?.(...args),
}

export class Disposable {
    dispose(): void { /* noop */ }
}
