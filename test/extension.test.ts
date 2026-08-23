// Covers the extension-host half, which has no other automated coverage: the
// commands, the panel's generated HTML, and the asset reader's path guard.
// A stub stands in for the `vscode` module so this runs headlessly.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import * as fs from 'node:fs'
import Module from 'node:module'
import { unzipSync, strFromU8 } from 'fflate'
import * as stub from './stubs/vscode'
import { DEVICES } from '../src/config'
import {
    BOOK_READER_STATES_KEY,
    READER_PROFILE_KEY,
    manuscriptId,
} from '../src/reader-state'

// Redirect `require('vscode')` to the stub before the extension is loaded.
const realLoad = (Module as any)._load
;(Module as any)._load = function (request: string, ...rest: unknown[]) {
    if (request === 'vscode') return stub
    return realLoad.call(this, request, ...rest)
}

/* eslint-disable @typescript-eslint/no-var-requires */
const extension = require('../src/extension') as typeof import('../src/extension')

const REPO_ROOT = path.resolve(__dirname, '../..')
const extensionUri = stub.Uri.file(REPO_ROOT)

function fakeDoc(text: string, fsPath: string) {
    return {
        uri: stub.Uri.file(fsPath),
        fileName: fsPath,
        languageId: 'markdown',
        getText: () => text,
    }
}

function activate() {
    const subscriptions: unknown[] = []
    extension.activate({ subscriptions, extensionUri, globalState: stub.globalState } as never)
    return subscriptions
}

beforeEach(() => stub.reset())

test('activate registers both contributed commands', () => {
    activate()
    // These ids must match package.json's contributes.commands, or the palette
    // entries resolve to nothing.
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    const declared = manifest.contributes.commands.map((c: { command: string }) => c.command).sort()
    assert.deepEqual([...stub.commands_.keys()].sort(), declared)
})

test('export with no markdown open reports an error instead of throwing', async () => {
    activate()
    await stub.commands.executeCommand('mdepub.export')
    assert.equal(stub.messages.filter(m => m.kind === 'error').length, 1)
    assert.equal(stub.writtenFiles.size, 0)
})

test('export writes a valid EPUB beside the document', async () => {
    activate()
    const mdPath = path.join(REPO_ROOT, 'test/fixtures/sample.md')
    stub.setActiveDocument(fakeDoc(fs.readFileSync(mdPath, 'utf8'), mdPath))

    await stub.commands.executeCommand('mdepub.export')

    const target = path.join(REPO_ROOT, 'test/fixtures/sample.epub')
    const bytes = stub.writtenFiles.get(target)
    assert.ok(bytes, `expected a write to ${target}, got ${[...stub.writtenFiles.keys()].join(', ')}`)

    const files = unzipSync(bytes!)
    assert.equal(strFromU8(files['mimetype']!), 'application/epub+zip')
    assert.ok(files['OEBPS/content.opf'], 'no package document')
    // sample.md references a missing image, so the warning path must be taken.
    assert.equal(stub.messages.filter(m => m.kind === 'warning').length, 1)
})

test('preview builds panel HTML with every placeholder substituted', () => {
    activate()
    const mdPath = path.join(REPO_ROOT, 'test/fixtures/sample.md')
    stub.setActiveDocument(fakeDoc('# hi\n', mdPath))

    stub.commands.executeCommand('mdepub.preview')
    const panel = stub.lastPanel
    assert.ok(panel, 'no webview panel created')

    const html: string = panel.webview.html
    assert.ok(!html.includes('{{'), `unsubstituted placeholder left in html: ${html.match(/\{\{\w+\}\}/)?.[0]}`)
    assert.ok(html.includes('vscode-resource://test'), 'cspSource not injected')
    assert.match(html, /nonce-[A-Za-z0-9_-]{32}/)

    // The M0 finding: without blob: in style-src the book renders unstyled and
    // nothing throws. Guard it here so a CSP edit cannot quietly drop it.
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? ''
    assert.match(csp, /style-src[^;]*blob:/, 'style-src must allow blob:')
    assert.match(csp, /frame-src[^;]*blob:/, 'frame-src must allow blob:')
})

test('preview scopes localResourceRoots to media and the document folder', () => {
    activate()
    const mdPath = path.join(REPO_ROOT, 'test/fixtures/sample.md')
    stub.setActiveDocument(fakeDoc('# hi\n', mdPath))
    stub.commands.executeCommand('mdepub.preview')

    const roots = stub.lastPanel.options.localResourceRoots.map((r: { fsPath: string }) => r.fsPath)
    assert.ok(roots.some((r: string) => r.endsWith('/media')), `media root missing: ${roots.join(', ')}`)
    assert.ok(roots.includes(path.dirname(mdPath)), `document folder missing: ${roots.join(', ')}`)
})

test('the asset reader refuses paths that escape the document folder', () => {
    const read = extension.makeAssetReader(path.join(REPO_ROOT, 'test/fixtures'))
    assert.equal(read('../../package.json'), null, 'must not read outside the base dir')
    assert.equal(read('/etc/hostname'), null, 'must not read absolute paths')
    assert.equal(read('nope.png'), null, 'missing file should be null, not a throw')
    assert.equal(read('.'), null, 'a directory is not an asset')

    const ok = read('sample.md')
    assert.ok(ok instanceof Uint8Array, 'a file inside the base dir should read')
})

test('a symlink pointing outside the document folder is refused', () => {
    // path.resolve does not follow symlinks, so containment has to be checked
    // against the real path or a link inside the folder escapes it.
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-'))
    const outside = path.join(dir, 'secret.png')
    fs.writeFileSync(outside, 'sensitive')
    const docDir = path.join(dir, 'doc')
    fs.mkdirSync(docDir)
    fs.writeFileSync(path.join(docDir, 'real.png'), 'fine')
    fs.symlinkSync(outside, path.join(docDir, 'link.png'))

    const read = extension.makeAssetReader(docDir)
    assert.ok(read('real.png') instanceof Uint8Array, 'a real file inside should still read')
    assert.equal(read('link.png'), null, 'symlink escaping the folder must be refused')

    fs.rmSync(dir, { recursive: true, force: true })
})

test('a workspace-scoped css path may not escape the workspace', () => {
    // Settings in .vscode/settings.json travel with a cloned repo, so opening
    // someone else's project is enough to make this apply. The file would then
    // be embedded as style.css in whatever the user exports and shares.
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-css-'))
    const docDir = path.join(dir, 'book')
    fs.mkdirSync(docDir)
    fs.writeFileSync(path.join(dir, 'secret.css'), '/* not the workspace */')
    fs.writeFileSync(path.join(docDir, 'ok.css'), 'p { color: red }')

    stub.setWorkspaceFolders([docDir])
    stub.setSettingScope('css', 'workspace')
    const read = (css: string) => {
        stub.setSetting('css', css)
        return extension.readCustomCss(extension.readConfig(), docDir, stub.Uri.file(docDir) as never)
    }

    assert.equal(read('ok.css'), 'p { color: red }', 'a css file inside the workspace should load')

    const outside = read('../secret.css')
    assert.equal(outside, undefined, 'a workspace setting must not reach outside the workspace')
    assert.equal(stub.messages.filter(m => m.kind === 'warning').length, 1)
    assert.match(stub.messages.at(-1)!.text, /blocked/, 'refused must not be reported as "cannot read"')

    fs.rmSync(dir, { recursive: true, force: true })
})

test('workspace css cannot cross into another root in a multi-root window', () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-css-roots-'))
    const publicRoot = path.join(dir, 'public-book')
    const privateRoot = path.join(dir, 'private-notes')
    fs.mkdirSync(publicRoot)
    fs.mkdirSync(privateRoot)
    fs.writeFileSync(path.join(privateRoot, 'secret.css'), '/* private */')

    stub.setWorkspaceFolders([publicRoot, privateRoot])
    stub.setSettingScope('css', 'workspace')
    stub.setSetting('css', '../private-notes/secret.css')

    const css = extension.readCustomCss(
        extension.readConfig(), publicRoot, stub.Uri.file(path.join(publicRoot, 'book.md')) as never)
    assert.equal(css, undefined, 'a repository setting crossed into another workspace root')
    assert.match(stub.messages.at(-1)!.text, /blocked/)

    fs.rmSync(dir, { recursive: true, force: true })
})

test('a user-scoped css path outside the workspace still loads', () => {
    // The threat is a setting that arrives with someone else's repo, not one the
    // user typed themselves — ~/mystyles.css has to keep working.
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-css-'))
    const docDir = path.join(dir, 'book')
    fs.mkdirSync(docDir)
    fs.writeFileSync(path.join(dir, 'mine.css'), 'p { color: blue }')

    stub.setWorkspaceFolders([docDir])
    stub.setSettingScope('css', 'global')
    stub.setSetting('css', '../mine.css')

    const css = extension.readCustomCss(extension.readConfig(), docDir, stub.Uri.file(docDir) as never)
    assert.equal(css, 'p { color: blue }')
    assert.equal(stub.messages.length, 0, 'the user\'s own setting should not warn')

    fs.rmSync(dir, { recursive: true, force: true })
})

test('a leading ~ expands to the home directory', () => {
    const os = require('node:os') as typeof import('node:os')
    assert.equal(extension.expandHome('~/mystyles.css'), path.join(os.homedir(), 'mystyles.css'))
    assert.equal(extension.expandHome('~'), os.homedir())
    assert.equal(extension.expandHome('./a.css'), './a.css')
    assert.equal(extension.expandHome('/abs/a.css'), '/abs/a.css')
    // ~user needs the password database to resolve; guessing would be worse than
    // leaving it alone.
    assert.equal(extension.expandHome('~someone/a.css'), '~someone/a.css')
})

test('~/x.css is not read from a directory literally named ~', () => {
    // Without expansion, path.resolve(baseDir, '~/x.css') is <baseDir>/~/x.css.
    // Planting that file is how "did it expand?" gets answered without writing
    // into the real home directory: if expansion works, the trap is not read.
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-tilde-'))
    fs.mkdirSync(path.join(dir, '~'))
    fs.writeFileSync(path.join(dir, '~', 'trap.css'), 'p { color: trap }')

    stub.setSettingScope('css', 'global')
    stub.setSetting('css', '~/trap.css')
    const css = extension.readCustomCss(extension.readConfig(), dir, stub.Uri.file(dir) as never)
    assert.notEqual(css, 'p { color: trap }', 'the literal ~ directory was read instead of $HOME')

    fs.rmSync(dir, { recursive: true, force: true })
})

test('sourcePathFor is workspace-relative, named, with forward slashes', () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-src-'))
    const nested = path.join(dir, 'chapters', 'one.md')
    stub.setWorkspaceFolders([dir], ['book'])

    // Relative and slash-normalised so a repository checked out on Windows and
    // on Linux derives the same identifier for the same manuscript.
    assert.equal(extension.sourcePathFor(stub.Uri.file(nested) as never), 'book/chapters/one.md')

    // Outside any workspace folder there is nothing to be relative to.
    const outside = path.join(require('node:os').tmpdir(), 'elsewhere', 'two.md')
    assert.equal(extension.sourcePathFor(stub.Uri.file(outside) as never), outside.split(path.sep).join('/'))

    // An unsaved buffer has no stable identity to offer.
    assert.equal(extension.sourcePathFor({ scheme: 'untitled', fsPath: 'Untitled-1' } as never), undefined)

    fs.rmSync(dir, { recursive: true, force: true })
})

test('sourcePathFor tells multi-root workspace folders apart', () => {
    // Relative-to-its-own-root reduces both of these to 'index.md', and two
    // files with matching metadata then derive the same UUID.
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-multi-'))
    const alpha = path.join(root, 'project-alpha')
    const beta = path.join(root, 'project-beta')
    fs.mkdirSync(alpha)
    fs.mkdirSync(beta)
    stub.setWorkspaceFolders([alpha, beta])

    const a = extension.sourcePathFor(stub.Uri.file(path.join(alpha, 'index.md')) as never)
    const b = extension.sourcePathFor(stub.Uri.file(path.join(beta, 'index.md')) as never)
    assert.equal(a, 'project-alpha/index.md')
    assert.equal(b, 'project-beta/index.md')
    assert.notEqual(a, b)

    fs.rmSync(root, { recursive: true, force: true })
})

test('identical documents in two workspace roots get different identifiers', () => {
    // The end-to-end shape of the same gap: same heading, same language, no
    // author, same filename, different root.
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-multi-'))
    const roots = ['project-alpha', 'project-beta'].map(name => {
        const dir = path.join(root, name)
        fs.mkdirSync(dir)
        fs.writeFileSync(path.join(dir, 'index.md'), '# Notes\n\nunrelated content\n')
        return dir
    })
    stub.setWorkspaceFolders(roots)
    activate()

    const identifiers = roots.map(dir => {
        const mdPath = path.join(dir, 'index.md')
        stub.setActiveDocument(fakeDoc(fs.readFileSync(mdPath, 'utf8'), mdPath))
        stub.commands.executeCommand('mdepub.export')
        const bytes = stub.writtenFiles.get(path.join(dir, 'index.epub'))
        assert.ok(bytes, `no export for ${mdPath}`)
        const opf = strFromU8(unzipSync(bytes!)['OEBPS/content.opf']!)
        return /<dc:identifier id="pub-id">([^<]+)</.exec(opf)?.[1]
    })

    assert.ok(identifiers.every(Boolean), `missing identifier: ${identifiers.join(', ')}`)
    assert.notEqual(identifiers[0], identifiers[1])

    fs.rmSync(root, { recursive: true, force: true })
})

test('the sidecar sits beside the book and round-trips', () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-notes-'))
    const mdPath = path.join(dir, 'book.md')
    fs.writeFileSync(mdPath, '# A\n\n兩者兼備，才是能喝進腦子裡的東西。\n')

    assert.equal(extension.notesPathFor(mdPath), path.join(dir, 'book.md.notes.json'))
    assert.deepEqual(extension.readNotes(mdPath).file.notes, [], 'no sidecar means no notes, not an error')

    const note = {
        id: 'n1', color: 'yellow' as const, chapter: 'A',
        range: { startLine: 2, startCol: 0, endLine: 2, endCol: 17 },
        quote: '兩者兼備，才是能喝進腦子裡的東西。', note: '這句是全書論點。',
        created: '2026-08-04T01:20:00Z',
    }
    extension.writeNotes(mdPath, { version: 1, source: 'book.md', notes: [note] })

    const onDisk = JSON.parse(fs.readFileSync(extension.notesPathFor(mdPath), 'utf8'))
    assert.equal(onDisk.source, 'book.md')
    assert.deepEqual(onDisk.notes, [note])
    assert.deepEqual(extension.readNotes(mdPath).file.notes, [note])

    fs.rmSync(dir, { recursive: true, force: true })
})

test('removing the last note removes the sidecar rather than leaving a husk', () => {
    // "Delete the file and the markers are gone" has to stay true in both
    // directions, or the user deletes it, adds one note, and the empty shell
    // comes back for good.
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-notes-'))
    const mdPath = path.join(dir, 'book.md')
    fs.writeFileSync(mdPath, '# A\n\ntext\n')

    extension.writeNotes(mdPath, {
        version: 1, source: 'book.md', notes: [{
            id: 'n1', color: 'yellow', chapter: 'A',
            range: { startLine: 2, startCol: 0, endLine: 2, endCol: 4 },
            quote: 'text', note: '', created: '2026-08-04T01:20:00Z',
        }],
    })
    assert.ok(fs.existsSync(extension.notesPathFor(mdPath)))

    extension.writeNotes(mdPath, { version: 1, source: 'book.md', notes: [] })
    assert.equal(fs.existsSync(extension.notesPathFor(mdPath)), false)

    fs.rmSync(dir, { recursive: true, force: true })
})

test('closed-note archives use the requested default name and preserve records', () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-closed-'))
    const mdPath = path.join(dir, 'my-book.md')
    const at = new Date(2026, 7, 23, 14, 5)
    const target = extension.closedNotesPathFor(mdPath, at)
    assert.equal(target, path.join(dir, 'my-book_closed_notes.2026-08-23-14-05.json'))

    const note = {
        id: 'stale-1', color: 'purple' as const, chapter: 'A',
        range: { startLine: 2, startCol: 0, endLine: 2, endCol: 4 },
        quote: 'old text', note: 'Rewrite this.', created: '2026-08-23T05:00:00Z',
    }
    extension.writeClosedNotes(mdPath, target, [note], '2026-08-23T06:05:00.000Z')
    const archive = JSON.parse(fs.readFileSync(target, 'utf8'))
    assert.equal(archive.source, 'my-book.md')
    assert.equal(archive.closedAt, '2026-08-23T06:05:00.000Z')
    assert.equal(archive.reason, 'source-target-not-found')
    assert.deepEqual(archive.notes, [note])
    fs.rmSync(dir, { recursive: true, force: true })
})

test('discarding a stale note requires the host dialog and removes it without an archive', async () => {
    activate()
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-stale-'))
    const mdPath = path.join(dir, 'book.md')
    const body = '# A\n\nreplacement text\n'
    fs.writeFileSync(mdPath, body)
    extension.writeNotes(mdPath, {
        version: 1,
        source: 'book.md',
        notes: [{
            id: 'stale-1', color: 'yellow', chapter: 'A',
            range: { startLine: 2, startCol: 0, endLine: 2, endCol: 8 },
            quote: 'old text', note: 'Rewrite this.', created: '2026-08-23T05:00:00Z',
        }],
    })
    stub.setActiveDocument(fakeDoc(body, mdPath))
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })
    stub.warningResponses.push('Discard')
    stub.lastPanel.receive({ type: 'notes:close-stale', ids: ['stale-1'] })
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(fs.existsSync(extension.notesPathFor(mdPath)), false)
    assert.ok(stub.messages.some(message =>
        message.kind === 'warning' && /Remove 1 stale note/.test(message.text)))
    assert.equal(fs.readdirSync(dir).some(name => name.includes('_closed_notes.')), false)
    fs.rmSync(dir, { recursive: true, force: true })
})

test('archiving a stale note writes the chosen file before removing it', async () => {
    activate()
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-archive-'))
    const mdPath = path.join(dir, 'book.md')
    const archivePath = path.join(dir, 'my-reviewed-notes.json')
    const body = '# A\n\nreplacement text\n'
    fs.writeFileSync(mdPath, body)
    extension.writeNotes(mdPath, {
        version: 1,
        source: 'book.md',
        notes: [{
            id: 'stale-1', color: 'green', chapter: 'A',
            range: { startLine: 2, startCol: 0, endLine: 2, endCol: 8 },
            quote: 'old text', note: 'Rewrite this.', created: '2026-08-23T05:00:00Z',
        }],
    })
    stub.setActiveDocument(fakeDoc(body, mdPath))
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })
    stub.warningResponses.push('Archive…')
    stub.saveDialogResponses.push(archivePath)
    stub.lastPanel.receive({ type: 'notes:close-stale', ids: ['stale-1'] })
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(fs.existsSync(extension.notesPathFor(mdPath)), false)
    const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'))
    assert.deepEqual(archive.notes.map((note: { id: string }) => note.id), ['stale-1'])
    assert.equal(typeof archive.closedAt, 'string')
    fs.rmSync(dir, { recursive: true, force: true })
})

test('a stale-note archive cannot overwrite the manuscript or active sidecar', async () => {
    activate()
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-safe-archive-'))
    const mdPath = path.join(dir, 'book.md')
    const body = '# A\n\nreplacement text\n'
    fs.writeFileSync(mdPath, body)
    extension.writeNotes(mdPath, {
        version: 1,
        source: 'book.md',
        notes: [{
            id: 'stale-1', color: 'green', chapter: 'A',
            range: { startLine: 2, startCol: 0, endLine: 2, endCol: 8 },
            quote: 'old text', note: 'Keep me.', created: '2026-08-23T05:00:00Z',
        }],
    })
    stub.setActiveDocument(fakeDoc(body, mdPath))
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })
    stub.warningResponses.push('Archive…')
    stub.saveDialogResponses.push(mdPath)
    stub.lastPanel.receive({ type: 'notes:close-stale', ids: ['stale-1'] })
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(fs.readFileSync(mdPath, 'utf8'), body)
    assert.equal(extension.readNotes(mdPath).file.notes.length, 1)
    assert.ok(stub.messages.some(message =>
        message.kind === 'error' && /cannot be overwritten/.test(message.text)))
    fs.rmSync(dir, { recursive: true, force: true })
})

test('the panel watches the sidecar and re-sends notes when it changes', () => {
    activate()
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mdepub-notes-'))
    const mdPath = path.join(dir, 'book.md')
    const body = '# A\n\n兩者兼備，才是能喝進腦子裡的東西。\n'
    fs.writeFileSync(mdPath, body)
    stub.setActiveDocument(fakeDoc(body, mdPath))
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })

    const watcher = stub.watchers.find((w: { glob: string }) => w.glob.endsWith('book.md.notes.json'))
    assert.ok(watcher, `no watcher on the sidecar: ${stub.watchers.map((w: any) => w.glob).join(', ')}`)

    // Write the file the way an agent or the explorer would, then fire the event.
    extension.writeNotes(mdPath, {
        version: 1, source: 'book.md', notes: [{
            id: 'n1', color: 'green', chapter: 'A',
            range: { startLine: 2, startCol: 0, endLine: 2, endCol: 17 },
            quote: '兩者兼備，才是能喝進腦子裡的東西。', note: '想法', created: '2026-08-04T01:20:00Z',
        }],
    })
    watcher.fire('change')

    const posted = stub.lastPanel.posted.filter((m: { type: string }) => m.type === 'notes')
    assert.ok(posted.length, 'no notes message was posted')
    const latest = posted.at(-1)
    assert.equal(latest.notes.length, 1)
    assert.equal(latest.notes[0].status, 'ok', 'an unedited quote should anchor cleanly')
    assert.equal(latest.notes[0].line, 2)

    // And deleting it must empty the panel, not leave stale markers drawn.
    fs.rmSync(extension.notesPathFor(mdPath))
    watcher.fire('delete')
    assert.deepEqual(stub.lastPanel.posted.at(-1).notes, [])

    fs.rmSync(dir, { recursive: true, force: true })
})

test('a hidden panel defers its rebuild until it is looked at again', async () => {
    // Nothing in a hidden panel has a layout box, and foliate paginates a book
    // opened there against zero — it comes back as a single column at half
    // width, which is unreadable. Switching to another document in the same
    // group is exactly this: it hides the panel and triggers a rebuild.
    activate()
    const mdPath = path.join(REPO_ROOT, 'test/fixtures/sample.md')
    stub.setActiveDocument(fakeDoc('# hi\n\n第一版。\n', mdPath))
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })

    const books = () => stub.lastPanel.posted.filter((m: { type: string }) => m.type === 'book')
    const openedWhileVisible = books().length
    assert.ok(openedWhileVisible > 0, 'the first build should run: the panel is visible')

    // Behind another tab now. Two edits land while it is not being looked at.
    stub.lastPanel.setVisible(false)
    const edited = fakeDoc('# hi\n\n第二版。\n', mdPath)
    stub.setActiveDocument(edited)
    stub.fireDidChangeTextDocument(edited)
    stub.fireDidChangeTextDocument(edited)
    await new Promise(r => setTimeout(r, 300))   // past the 120 ms debounce
    assert.equal(books().length, openedWhileVisible, 'nothing may be posted to a hidden panel')

    stub.lastPanel.setVisible(true)
    assert.equal(books().length, openedWhileVisible + 1, 'exactly one build on return, not one per edit')
})

test('the config message carries the device table so the webview needs no copy', () => {
    activate()
    const mdPath = path.join(REPO_ROOT, 'test/fixtures/sample.md')
    stub.setActiveDocument(fakeDoc('# hi\n', mdPath))
    stub.commands.executeCommand('mdepub.preview')

    // preview.ts only posts once the webview reports ready.
    stub.lastPanel.receive({ type: 'ready' })
    const config = stub.lastPanel.posted.find((m: { type: string }) => m.type === 'config')
    assert.ok(config, `no config message: ${JSON.stringify(stub.lastPanel.posted.map((m: any) => m.type))}`)
    assert.deepEqual(Object.keys(config.devices), Object.keys(DEVICES))
    assert.equal(config.devices['iphone'].width, DEVICES['iphone'].width)
    assert.equal(config.locale, 'en')
})

test('the panel and default book language follow the supported VS Code locale', () => {
    stub.setLanguage('zh-tw')
    activate()
    const mdPath = path.join(REPO_ROOT, 'test/fixtures/sample.md')
    stub.setActiveDocument(fakeDoc('# hi\n', mdPath))
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })

    const config = stub.lastPanel.posted.find((m: { type: string }) => m.type === 'config')
    assert.equal(config.locale, 'zh-TW')
    assert.equal(extension.readConfig().lang, 'zh-TW')
})

test('reader profile saves are normalized, echoed, and never rebuild the EPUB', async () => {
    activate()
    const mdPath = path.join(REPO_ROOT, 'test/fixtures/sample.md')
    stub.setActiveDocument(fakeDoc('# Reader\n\nText.\n', mdPath))
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })

    const booksBefore = stub.lastPanel.posted.filter((m: any) => m.type === 'book').length
    const initial = stub.lastPanel.posted.find((m: any) => m.type === 'reader:profile')
    assert.deepEqual(initial.profile, {
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
    })
    assert.equal(initial.styles, '', 'reset profile must leave publisher CSS unmodified')

    stub.lastPanel.receive({
        type: 'reader:profile-save',
        requestId: 7,
        profile: { fontSize: 999, fontFamily: 'serif', theme: 'sepia' },
    })
    await Promise.resolve()

    const profiles = stub.lastPanel.posted.filter((m: any) => m.type === 'reader:profile')
    const echoed = profiles.at(-1)
    assert.equal(echoed.requestId, 7)
    assert.equal(echoed.profile.fontSize, 200)
    assert.equal(echoed.profile.fontFamily, 'serif')
    assert.equal(echoed.profile.theme, 'sepia')
    assert.match(echoed.styles, /ui-serif/)
    assert.match(echoed.styles, /--theme-bg-color/)
    assert.equal((stub.globalValues.get(READER_PROFILE_KEY) as any).fontSize, 200)
    assert.equal(
        stub.lastPanel.posted.filter((m: any) => m.type === 'book').length,
        booksBefore,
        'appearance changes must not invoke buildForPreview',
    )
})

test('book reader state saves and echoes without rebuilding', async () => {
    activate()
    const mdPath = path.join(REPO_ROOT, 'test/fixtures/sample.md')
    stub.setActiveDocument(fakeDoc('# Reader\n\nText.\n', mdPath))
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })

    const initial = stub.lastPanel.posted.find((m: any) => m.type === 'reader:book-state')
    assert.equal(initial.bookId, manuscriptId(stub.Uri.file(mdPath).toString()))
    const booksBefore = stub.lastPanel.posted.filter((m: any) => m.type === 'book').length
    stub.lastPanel.receive({
        type: 'reader:book-state-save',
        bookId: initial.bookId,
        immediate: true,
        state: {
            cfi: 'epubcfi(/6/4)',
            fraction: 0.63,
            bookmarks: [{
                id: 'b1', cfi: 'epubcfi(/6/4)', fraction: 0.63,
                chapter: 'Reader', created: '2026-08-16T03:00:00Z',
            }],
        },
    })
    await new Promise(resolve => setImmediate(resolve))

    const echoed = stub.lastPanel.posted.filter((m: any) =>
        m.type === 'reader:book-state' && m.bookId === initial.bookId).at(-1)
    assert.equal(echoed.state.cfi, 'epubcfi(/6/4)')
    assert.equal(echoed.state.fraction, 0.63)
    assert.equal(echoed.state.bookmarks.length, 1)
    const stored = stub.globalValues.get(BOOK_READER_STATES_KEY) as any
    assert.equal(stored.books[initial.bookId].fraction, 0.63)
    assert.equal(stub.lastPanel.posted.filter((m: any) => m.type === 'book').length, booksBefore)
})

test('switching manuscripts shares appearance but isolates locations and bookmarks', () => {
    stub.setGlobalValue(READER_PROFILE_KEY, { version: 1, fontSize: 130, theme: 'paper' })
    activate()
    const aPath = path.join(REPO_ROOT, 'test/fixtures/a.md')
    const bPath = path.join(REPO_ROOT, 'test/fixtures/b.md')
    const a = fakeDoc('# A\n\nAlpha.\n', aPath)
    const b = fakeDoc('# B\n\nBeta.\n', bPath)
    stub.setActiveDocument(a)
    stub.commands.executeCommand('mdepub.preview')
    stub.lastPanel.receive({ type: 'ready' })

    const aId = manuscriptId(a.uri.toString())
    const bId = manuscriptId(b.uri.toString())
    const profile = stub.lastPanel.posted.find((m: any) => m.type === 'reader:profile')
    assert.equal(profile.profile.fontSize, 130)
    assert.equal(profile.profile.theme, 'paper')

    stub.lastPanel.receive({
        type: 'reader:book-state-save', bookId: aId, immediate: true,
        state: {
            cfi: 'epubcfi(/6/2)', fraction: 0.2,
            bookmarks: [{ id: 'a-mark', cfi: null, fraction: 0.2, chapter: 'A', created: '2026-08-16' }],
        },
    })
    stub.fireDidChangeActiveTextEditor(b)
    let latest = stub.lastPanel.posted.filter((m: any) => m.type === 'reader:book-state').at(-1)
    assert.equal(latest.bookId, bId)
    assert.equal(latest.state.fraction, 0)
    assert.deepEqual(latest.state.bookmarks, [])

    stub.lastPanel.receive({
        type: 'reader:book-state-save', bookId: bId, immediate: true,
        state: { cfi: 'epubcfi(/6/8)', fraction: 0.8, bookmarks: [] },
    })
    stub.fireDidChangeActiveTextEditor(a)
    latest = stub.lastPanel.posted.filter((m: any) => m.type === 'reader:book-state').at(-1)
    assert.equal(latest.bookId, aId)
    assert.equal(latest.state.fraction, 0.2)
    assert.equal(latest.state.bookmarks[0].id, 'a-mark')
    assert.equal(
        stub.lastPanel.posted.filter((m: any) => m.type === 'reader:profile').at(-1).profile.fontSize,
        130,
    )
})
