// Panel lifecycle, debounce, and the webview message protocol (spec §4).
// The only module besides extension.ts that touches the vscode API.
import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Config } from './config'
import { DEVICES } from './config'
import { buildForPreview } from './epub/build'
import { anchorAll, type NotesFile, type Note } from './notes'
import {
    ReaderStateStore,
    manuscriptId,
    readerProfileStyles,
} from './reader-state'
import { hostText, uiLocale } from './i18n'

const currentLocale = () => uiLocale(vscode.env.language)

interface Host {
    readConfig(scope?: vscode.Uri): Config
    makeAssetReader(baseDir: string): (ref: string) => Uint8Array | null
    readCustomCss(config: Config, baseDir: string, scope?: vscode.Uri): string | undefined
    sourcePathFor(uri: vscode.Uri): string | undefined
    readNotes(docPath: string): { file: NotesFile; warnings: string[] }
    writeNotes(docPath: string, file: NotesFile): void
    readerStore: ReaderStateStore
}

/**
 * A CSP nonce is what stops injected markup from executing, so it has to be
 * unpredictable. Math.random() is not a CSPRNG and would make it guessable.
 */
function nonce(): string {
    return randomBytes(24).toString('base64url').slice(0, 32)
}

export class Preview {
    private static current: Preview | null = null

    private timer: NodeJS.Timeout | undefined
    private bookStateTimer: NodeJS.Timeout | undefined
    private bookPersistChain: Promise<void> = Promise.resolve()
    private ready = false
    private notesWatcher: vscode.FileSystemWatcher | undefined
    /**
     * A rebuild that arrived while the panel was hidden, waiting to be shown.
     *
     * `keepPosition` accumulates with AND: if any deferred build was a document
     * switch, the one that finally runs must not restore a position belonging to
     * a different book.
     */
    private deferred: { keepPosition: boolean } | undefined
    private readonly disposables: vscode.Disposable[] = []

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private doc: vscode.TextDocument,
        private readonly extensionUri: vscode.Uri,
        private readonly host: Host,
    ) {
        this.panel.webview.html = this.html()

        this.disposables.push(
            this.panel.webview.onDidReceiveMessage(msg => {
                if (msg?.type === 'ready') {
                    this.ready = true
                    this.postConfig()
                    this.postReaderProfile()
                    this.postBookReaderState()
                    void this.rebuild(false)
                    return
                }
                // The webview has no filesystem; every write comes through here.
                if (msg?.type === 'notes:save' && Array.isArray(msg.notes)) {
                    this.saveNotes(msg.notes as Note[])
                    return
                }
                if (msg?.type === 'reader:profile-save') {
                    this.saveReaderProfile(msg.profile, msg.requestId)
                    return
                }
                if (msg?.type === 'reader:book-state-save') {
                    this.saveBookReaderState(msg.bookId, msg.state, Boolean(msg.immediate))
                }
            }),

            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.toString() !== this.doc.uri.toString()) return
                this.schedule()
            }),

            // Nothing in a hidden panel has a layout box, so a book opened there
            // is paginated against zero and comes back unreadable. The webview
            // defends itself too, but there is no reason to build a book for a
            // panel nobody is looking at — this also stops a background panel
            // rebuilding on every keystroke.
            this.panel.onDidChangeViewState(() => {
                if (!this.panel.visible || !this.deferred) return
                const { keepPosition } = this.deferred
                this.deferred = undefined
                void this.rebuild(keepPosition)
            }),

            // Following the active editor keeps one panel useful across files;
            // switching documents resets the position rather than restoring a
            // CFI that belongs to a different book.
            vscode.window.onDidChangeActiveTextEditor(editor => {
                const next = editor?.document
                if (!next || next.uri.toString() === this.doc.uri.toString()) return
                if (next.languageId !== 'markdown' && !next.fileName.toLowerCase().endsWith('.md')) return
                this.switchDocument(next)
            }),

            vscode.workspace.onDidChangeConfiguration(e => {
                if (!e.affectsConfiguration('mdepub')) return
                this.postConfig()
                // Frame size is handled entirely in the webview; only the build
                // inputs justify a rebuild here.
                if (
                    e.affectsConfiguration('mdepub.splitLevel') ||
                    e.affectsConfiguration('mdepub.lang') ||
                    e.affectsConfiguration('mdepub.author') ||
                    e.affectsConfiguration('mdepub.cover') ||
                    e.affectsConfiguration('mdepub.css')
                ) void this.rebuild(true)
            }),
        )

        this.watchNotes()
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    }

    static show(doc: vscode.TextDocument, extensionUri: vscode.Uri, host: Host): Preview {
        if (Preview.current) {
            Preview.current.panel.reveal(vscode.ViewColumn.Beside, true)
            if (doc.uri.toString() === Preview.current.doc.uri.toString()) {
                void Preview.current.rebuild(false)
            } else {
                Preview.current.switchDocument(doc)
            }
            return Preview.current
        }

        const panel = vscode.window.createWebviewPanel(
            'mdepub.preview',
            `Ebook Review: ${path.basename(doc.uri.fsPath)}`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.file(path.dirname(doc.uri.fsPath)),
                ],
            },
        )
        Preview.current = new Preview(panel, doc, extensionUri, host)
        return Preview.current
    }

    private schedule(): void {
        const { debounce } = this.host.readConfig(this.doc.uri)
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.rebuild(true), Math.max(0, debounce))
    }

    /** Follow a manuscript without ever carrying its location into another. */
    private switchDocument(next: vscode.TextDocument): void {
        if (next.uri.toString() === this.doc.uri.toString()) return
        // Relocations are staged as soon as the webview reports them. Persisting
        // that cache here flushes the 500 ms debounce before `doc` changes.
        void this.flushBookState()
        this.doc = next
        this.panel.title = `Ebook Review: ${path.basename(next.uri.fsPath)}`
        this.watchNotes()
        this.postBookReaderState()
        void this.rebuild(false)
    }

    /**
     * Watch the sidecar so the panel reflects it however it changed.
     *
     * "Delete the file and the markers go" is a live requirement, not a
     * description of the data — the user may well delete it in the explorer, or
     * an agent may rewrite it after acting on the notes, and the panel has to
     * notice either way. The watcher is rebuilt whenever the panel follows a
     * different document, since the glob is per-file.
     */
    private watchNotes(): void {
        this.notesWatcher?.dispose()
        const target = `${this.doc.uri.fsPath}.notes.json`
        const watcher = vscode.workspace.createFileSystemWatcher(target)
        const refresh = () => this.postNotes()
        watcher.onDidCreate(refresh)
        watcher.onDidChange(refresh)
        watcher.onDidDelete(refresh)
        this.notesWatcher = watcher
        // Deliberately not pushed onto `disposables`: this runs again on every
        // document switch, and appending each one would grow that array for the
        // life of the panel. The previous watcher is disposed above and the last
        // one in dispose().
    }

    /**
     * Send the notes with each one's current standing against the document.
     *
     * Re-anchoring happens here rather than in the webview because the markdown
     * source lives on this side — the webview only ever sees rendered HTML.
     */
    private postNotes(): void {
        if (!this.ready) return
        const { file, warnings } = this.host.readNotes(this.doc.uri.fsPath)
        const anchored = anchorAll(file.notes, this.doc.getText())
        void this.panel.webview.postMessage({
            type: 'notes',
            notes: anchored.map(a => ({ ...a.note, status: a.status, line: a.line })),
            warnings,
            // Named so the panel can show it: this filename is exactly what the
            // user hands to an agent alongside the manuscript.
            path: `${path.basename(this.doc.uri.fsPath)}.notes.json`,
        })
    }

    private saveNotes(notes: Note[]): void {
        try {
            this.host.writeNotes(this.doc.uri.fsPath, {
                version: 1,
                source: path.basename(this.doc.uri.fsPath),
                notes,
            })
        } catch (err) {
            void vscode.window.showErrorMessage(hostText(currentLocale(), 'notesSaveFailed', {
                error: (err as Error).message,
            }))
        }
        // Echo the saved state back rather than trusting the panel's copy, so
        // what is drawn is always what is on disk.
        this.postNotes()
    }

    private postConfig(): void {
        if (!this.ready) return
        const config = this.host.readConfig(this.doc.uri)
        // The preset table travels with the message so src/config.ts stays the
        // only place the device list is written down (spec §6.1).
        void this.panel.webview.postMessage({
            type: 'config',
            locale: currentLocale(),
            devices: DEVICES,
            device: config.device,
            customWidth: config.customWidth,
            customHeight: config.customHeight,
        })
    }

    private currentBookId(): string {
        // Uri.toString()'s encoded form is VSCode's canonical URI spelling;
        // hashing an fsPath would collapse schemes and vary by platform.
        return manuscriptId(this.doc.uri.toString())
    }

    private postReaderProfile(requestId?: number): void {
        if (!this.ready) return
        const profile = this.host.readerStore.getProfile()
        void this.panel.webview.postMessage({
            type: 'reader:profile',
            profile,
            styles: readerProfileStyles(profile),
            ...(typeof requestId === 'number' ? { requestId } : {}),
        })
    }

    /** Save immediately and echo the normalized profile back to the panel. */
    private saveReaderProfile(value: unknown, requestId?: number): void {
        // saveProfile normalizes and updates its in-memory value before its first
        // await, so the echo below is authoritative without waiting on disk I/O.
        void this.host.readerStore.saveProfile(value).catch(err => {
            void vscode.window.showErrorMessage(hostText(currentLocale(), 'profileSaveFailed', {
                error: (err as Error).message,
            }))
        })
        this.postReaderProfile(requestId)
    }

    private postBookReaderState(): void {
        if (!this.ready) return
        const bookId = this.currentBookId()
        const state = this.host.readerStore.touchBook(bookId)
        void this.panel.webview.postMessage({ type: 'reader:book-state', bookId, state })
        // Opening a manuscript updates its LRU timestamp even if the reader does
        // not turn a page, so make that touch durable through the same debounce.
        this.scheduleBookStatePersistence()
    }

    private saveBookReaderState(bookId: unknown, value: unknown, immediate: boolean): void {
        if (typeof bookId !== 'string' || !/^[a-f0-9]{64}$/i.test(bookId)) return
        const state = this.host.readerStore.stageBook(bookId, value)
        if (this.ready) {
            void this.panel.webview.postMessage({ type: 'reader:book-state', bookId, state })
        }
        if (immediate) void this.flushBookState()
        else this.scheduleBookStatePersistence()
    }

    private scheduleBookStatePersistence(): void {
        if (this.bookStateTimer) clearTimeout(this.bookStateTimer)
        this.bookStateTimer = setTimeout(() => {
            this.bookStateTimer = undefined
            void this.persistBookStates()
        }, 500)
    }

    private persistBookStates(): Promise<void> {
        this.bookPersistChain = this.bookPersistChain
            .then(() => this.host.readerStore.persistBooks())
            .catch(err => {
                void vscode.window.showErrorMessage(hostText(currentLocale(), 'locationSaveFailed', {
                    error: (err as Error).message,
                }))
            })
        return this.bookPersistChain
    }

    private flushBookState(): Promise<void> {
        if (this.bookStateTimer) clearTimeout(this.bookStateTimer)
        this.bookStateTimer = undefined
        return this.persistBookStates()
    }

    /** @param keepPosition restore the reading position afterwards (spec §4.2). */
    private async rebuild(keepPosition: boolean): Promise<void> {
        // Before 'ready' there is nothing to post to; the handler kicks off the
        // first build itself, so dropping this call loses nothing.
        if (!this.ready) return

        // Hold it until the panel is looked at again. Deferring rather than
        // dropping keeps the newest state of the document as what renders.
        if (!this.panel.visible) {
            this.deferred = { keepPosition: (this.deferred?.keepPosition ?? true) && keepPosition }
            return
        }

        const baseDir = path.dirname(this.doc.uri.fsPath)
        const config = this.host.readConfig(this.doc.uri)
        try {
            const result = buildForPreview({
                markdown: this.doc.getText(),
                config,
                interfaceLocale: currentLocale(),
                basename: path.basename(this.doc.uri.fsPath, path.extname(this.doc.uri.fsPath)),
                sourcePath: this.host.sourcePathFor(this.doc.uri),
                readAsset: this.host.makeAssetReader(baseDir),
                css: this.host.readCustomCss(config, baseDir, this.doc.uri),
            })
            await this.panel.webview.postMessage({
                type: 'book',
                bytes: result.bytes,
                bookId: this.currentBookId(),
                keepPosition,
                warnings: result.warnings,
                // Where the chapters were cut. The panel turns a note's line into
                // a chapter with it, which is how a note is reached in a section
                // foliate has not rendered — until it renders, there is no CFI to
                // navigate to. Sent with the book because an edit moves the cuts.
                chapterStartLines: result.chapterStartLines,
            })
            // Every rebuild replaces the rendered document, taking the drawn
            // highlights with it — same shape of problem as the CFI restore. The
            // re-anchoring also has to run again, because the edit that caused
            // this rebuild is exactly what moves a note or makes it stale.
            this.postNotes()
        } catch (err) {
            // A malformed document must leave the last good render on screen
            // rather than blanking the panel mid-keystroke.
            await this.panel.webview.postMessage({
                type: 'error',
                message: hostText(currentLocale(), 'previewBuildFailed', {
                    error: (err as Error).stack ?? String(err),
                }),
            })
        }
    }

    private html(): string {
        const { webview } = this.panel
        const media = (...parts: string[]) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', ...parts)).toString()

        const template = fs.readFileSync(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'reader.html').fsPath, 'utf8')

        return template
            .replaceAll('{{nonce}}', nonce())
            .replaceAll('{{cspSource}}', webview.cspSource)
            .replaceAll('{{cssUri}}', media('reader.css'))
            .replaceAll('{{jsUri}}', media('reader.js'))
    }

    dispose(): void {
        if (this.timer) clearTimeout(this.timer)
        void this.flushBookState()
        this.notesWatcher?.dispose()
        this.notesWatcher = undefined
        for (const d of this.disposables) d.dispose()
        this.disposables.length = 0
        if (Preview.current === this) Preview.current = null
    }
}
