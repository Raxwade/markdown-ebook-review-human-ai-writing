// Activation and commands (spec §3). The only place besides preview.ts that
// touches the vscode API; everything under src/epub/ stays free of it.
import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DEFAULTS, type Config, type DeviceName } from './config'
import { buildForExport } from './epub/build'
import { parseNotes, serializeNotes, type NotesFile } from './notes'
import { Preview } from './preview'
import { ReaderStateStore } from './reader-state'
import { bookLocale, hostCount, hostText, uiLocale } from './i18n'

const currentLocale = () => uiLocale(vscode.env.language)

function configuredBookLanguage(c: vscode.WorkspaceConfiguration): string {
    const info = c.inspect<string>('lang')
    const explicit = info?.workspaceFolderLanguageValue
        ?? info?.workspaceLanguageValue
        ?? info?.globalLanguageValue
        ?? info?.workspaceFolderValue
        ?? info?.workspaceValue
        ?? info?.globalValue
    return explicit?.trim() || bookLocale(vscode.env.language)
}

export function readConfig(scope?: vscode.Uri): Config {
    const c = vscode.workspace.getConfiguration('mdepub', scope)
    const get = <T>(key: keyof Config, fallback: T): T => c.get<T>(key) ?? fallback
    return {
        splitLevel: get<1 | 2>('splitLevel', DEFAULTS.splitLevel),
        device: get<DeviceName>('device', DEFAULTS.device),
        customWidth: get('customWidth', DEFAULTS.customWidth),
        customHeight: get('customHeight', DEFAULTS.customHeight),
        css: get<string | null>('css', DEFAULTS.css) || null,
        // A manuscript can pin its language in frontmatter or settings. Without
        // either, follow VS Code's display locale instead of assuming Chinese.
        lang: configuredBookLanguage(c),
        author: get<string | null>('author', DEFAULTS.author) || null,
        cover: get<string | null>('cover', DEFAULTS.cover) || null,
        debounce: get('debounce', DEFAULTS.debounce),
    }
}

/**
 * Is `realFile` inside one of `roots`?
 *
 * Both sides are realpath'd before comparing: path.resolve does not follow
 * symlinks, so a link inside an allowed folder pointing outside it would
 * otherwise pass. A root that does not resolve simply contains nothing.
 */
function isInside(realFile: string, roots: string[]): boolean {
    return roots.some(root => {
        try {
            const rel = path.relative(fs.realpathSync(root), realFile)
            return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
        } catch {
            return false
        }
    })
}

/**
 * Reads assets relative to the document's own folder (spec §6), refusing paths
 * that escape it — a preview should never be a way to pull `../../../.ssh/id_rsa`
 * into a file the user then shares.
 */
export function makeAssetReader(baseDir: string): (ref: string) => Uint8Array | null {
    return (ref: string): Uint8Array | null => {
        try {
            const full = fs.realpathSync(path.resolve(baseDir, ref))
            if (!isInside(full, [baseDir])) return null
            if (!fs.statSync(full).isFile()) return null
            return new Uint8Array(fs.readFileSync(full))
        } catch {
            return null
        }
    }
}

/**
 * Where a `mdepub.css` value came from decides how far it is trusted.
 *
 * A workspace or folder setting travels inside the repository, so opening
 * someone else's project is enough to make it apply — `css: "../../../.ssh/id_rsa"`
 * would then be read and embedded as style.css in whatever the user exports and
 * shares. Those values get the same containment the image reader applies. A
 * value the user typed into their own settings is theirs, so `~/mystyles.css`
 * and other paths outside the project keep working.
 */
function cssIsWorkspaceScoped(scope?: vscode.Uri): boolean {
    try {
        const info = vscode.workspace.getConfiguration('mdepub', scope).inspect<string>('css')
        return Boolean(info?.workspaceFolderValue ?? info?.workspaceValue)
    } catch {
        // inspect() is the only API here a host might not implement; assume the
        // safer of the two readings when the answer is unavailable.
        return true
    }
}

/**
 * Expand a leading `~` to the home directory.
 *
 * Node does not do this — `path.resolve(baseDir, '~/mystyles.css')` yields
 * `<baseDir>/~/mystyles.css`, a path that cannot exist — so a setting written the
 * way people write paths in a shell would just report the file as missing.
 * Expansion happens before resolution, which is also what makes a workspace
 * setting of `~/…` resolve to somewhere outside the workspace and get refused.
 * `~user` is deliberately not handled: resolving another account's home needs
 * the password database, and guessing at it would be worse than leaving it be.
 */
export function expandHome(p: string): string {
    if (p !== '~' && !p.startsWith('~/') && !p.startsWith('~\\')) return p
    return path.join(os.homedir(), p.slice(1))
}

export function readCustomCss(config: Config, baseDir: string, scope?: vscode.Uri): string | undefined {
    if (!config.css) return undefined

    const missing = () => {
        void vscode.window.showWarningMessage(hostText(currentLocale(), 'customCssUnreadable', {
            path: config.css,
        }))
        return undefined
    }

    let full: string
    try {
        full = fs.realpathSync(path.resolve(baseDir, expandHome(config.css)))
    } catch {
        return missing()
    }

    if (cssIsWorkspaceScoped(scope)) {
        // A setting supplied by one repository must not be able to extract a
        // file from another root in the same multi-root window. The document's
        // owning root is the widest repository-controlled boundary we accept.
        const owner = scope ? vscode.workspace.getWorkspaceFolder?.(scope) : undefined
        const roots = [owner?.uri.fsPath ?? baseDir]
        if (!isInside(full, roots)) {
            // Distinct from "cannot read it": the file is right there, and being
            // told it is missing would send the user looking in the wrong place.
            void vscode.window.showWarningMessage(hostText(currentLocale(), 'customCssOutsideWorkspace', {
                path: config.css,
            }))
            return undefined
        }
    }

    try {
        return fs.readFileSync(full, 'utf8')
    } catch {
        return missing()
    }
}

/**
 * A stable identity for a document, for `dc:identifier` only (see build.ts).
 *
 * Workspace-relative, so the same manuscript keeps one identifier across
 * machines and clones, but **prefixed with the workspace folder's name** — a
 * multi-root workspace holding both `project-alpha/index.md` and
 * `project-beta/index.md` reduces both to `index.md` otherwise, and two files
 * with matching metadata land back on the same UUID. The prefix is applied in
 * single-root workspaces too, so that adding a second folder later does not
 * silently renumber every book in the first one.
 *
 * `folder.name` rather than the folder's absolute path: it is what a checked-in
 * `.code-workspace` carries, so two people cloning the same workspace agree,
 * whereas their absolute paths never would. It is not guaranteed unique — VSCode
 * permits two roots with the same display name — so that narrow case still
 * collides, and frontmatter `identifier:` is the way out of it.
 *
 * Separators are normalised because a repository checked out on Windows and on
 * Linux has to agree. Outside any workspace folder there is nothing to be
 * relative to, so the absolute path stands in: unique on this machine, not
 * portable off it. A document with no real path — an unsaved buffer — has no
 * stable identity to offer at all, so it returns undefined and the derivation
 * falls back to the filename.
 */
export function sourcePathFor(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== 'file') return undefined
    const slashes = (p: string) => p.split(path.sep).join('/')

    const folder = vscode.workspace.getWorkspaceFolder?.(uri)
    if (!folder) return slashes(uri.fsPath)

    const relative = path.relative(folder.uri.fsPath, uri.fsPath)
    // getWorkspaceFolder only ever returns a folder containing the URI, so this
    // is a guard against a misbehaving host rather than a reachable branch.
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return slashes(uri.fsPath)

    const label = folder.name || path.basename(folder.uri.fsPath)
    return `${label}/${slashes(relative)}`
}

/**
 * The annotation sidecar for a document: `<book>.md.notes.json` beside it.
 *
 * Appending rather than replacing the extension keeps the pairing obvious in the
 * explorer and leaves `book.md` and `book.notes.md` free to mean other things.
 */
export function notesPathFor(docPath: string): string {
    return `${docPath}.notes.json`
}

export function readNotes(docPath: string): { file: NotesFile; warnings: string[] } {
    const source = path.basename(docPath)
    try {
        return parseNotes(fs.readFileSync(notesPathFor(docPath), 'utf8'), source, currentLocale())
    } catch {
        // No sidecar is the normal state, not an error: a book with no notes and
        // a book whose notes were deleted are the same thing.
        return { file: { version: 1, source, notes: [] }, warnings: [] }
    }
}

/**
 * Write the sidecar, or delete it once the last note is gone.
 *
 * Leaving an empty `{"notes": []}` behind would be litter, and would also make
 * "delete the file to drop every marker" a half-truth — the user would delete
 * it, add one note, and get the husk back forever.
 */
export function writeNotes(docPath: string, file: NotesFile): void {
    const target = notesPathFor(docPath)
    if (!file.notes.length) {
        try { fs.unlinkSync(target) } catch { /* already gone is the desired state */ }
        return
    }
    fs.writeFileSync(target, serializeNotes(file), 'utf8')
}

function activeMarkdown(): vscode.TextDocument | null {
    const doc = vscode.window.activeTextEditor?.document
    if (!doc) return null
    const isMarkdown = doc.languageId === 'markdown' || doc.fileName.toLowerCase().endsWith('.md')
    return isMarkdown ? doc : null
}

async function exportEpub(): Promise<void> {
    const doc = activeMarkdown()
    if (!doc) {
        void vscode.window.showErrorMessage(hostText(currentLocale(), 'openMarkdownToExport'))
        return
    }

    const baseDir = path.dirname(doc.uri.fsPath)
    const basename = path.basename(doc.uri.fsPath, path.extname(doc.uri.fsPath))
    const config = readConfig(doc.uri)

    let result
    try {
        result = buildForExport({
            markdown: doc.getText(),
            config,
            interfaceLocale: currentLocale(),
            basename,
            sourcePath: sourcePathFor(doc.uri),
            readAsset: makeAssetReader(baseDir),
            css: readCustomCss(config, baseDir, doc.uri),
        })
    } catch (err) {
        void vscode.window.showErrorMessage(hostText(currentLocale(), 'exportBuildFailed', {
            error: (err as Error).message,
        }))
        return
    }

    const target = vscode.Uri.file(path.join(baseDir, `${basename}.epub`))
    try {
        await vscode.workspace.fs.writeFile(target, result.bytes)
    } catch (err) {
        void vscode.window.showErrorMessage(hostText(currentLocale(), 'exportWriteFailed', {
            error: (err as Error).message,
        }))
        return
    }

    // Warnings are real (missing images, bad frontmatter) but must not block a
    // successful export, so they ride along with the success message.
    const locale = currentLocale()
    const summary = hostCount(locale, 'exportSummary', result.chapters.length, {
        file: path.basename(target.fsPath),
    })
    if (result.warnings.length) {
        const details = hostText(locale, 'showDetails')
        void vscode.window.showWarningMessage(
            hostCount(locale, 'exportIssues', result.warnings.length, { summary }),
            details,
        )
            .then(pick => {
                if (pick !== details) return
                const channel = vscode.window.createOutputChannel('Markdown EPUB')
                channel.appendLine(summary)
                for (const w of result.warnings) channel.appendLine(`  · ${w}`)
                channel.show()
            })
    } else {
        void vscode.window.showInformationMessage(summary)
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const host = {
        readConfig,
        makeAssetReader,
        readCustomCss,
        sourcePathFor,
        readNotes,
        writeNotes,
        readerStore: new ReaderStateStore(context.globalState),
    }
    context.subscriptions.push(
        vscode.commands.registerCommand('mdepub.export', exportEpub),
        vscode.commands.registerCommand('mdepub.preview', () => {
            const doc = activeMarkdown()
            if (!doc) {
                void vscode.window.showErrorMessage(hostText(currentLocale(), 'openMarkdownToPreview'))
                return
            }
            Preview.show(doc, context.extensionUri, host)
        }),
    )
}

export function deactivate(): void { /* nothing to tear down yet */ }
