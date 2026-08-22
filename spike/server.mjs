// Static server for the M0 spike. Serves spike/ plus media/vendor/ under /vendor/.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, normalize } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.epub': 'application/epub+zip',
    '.json': 'application/json',
}

const resolve = urlPath => {
    const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
    if (clean === '/' || clean === '/index.html') return join(here, 'outer.html')
    if (clean.startsWith('/vendor/')) return join(root, 'media', clean)
    if (clean.startsWith('/media/')) return join(root, clean)
    return join(here, clean)
}

// Serves the REAL media/reader.html with preview.ts's substitutions applied, so
// the M2 harness exercises the shipped artifact rather than a copy that can
// drift. The only addition is a stub for the VSCode API the webview expects.
const SHIM = `<script nonce="SPIKENONCE">
let __state = null
window.acquireVsCodeApi = () => ({
    postMessage: m => { window.__toExtension = (window.__toExtension || []).concat([m]) },
    setState: s => { __state = s },
    getState: () => __state,
})
</script>
`

async function previewPage() {
    const html = await readFile(join(root, 'media', 'reader.html'), 'utf8')
    return html
        .replaceAll('{{nonce}}', 'SPIKENONCE')
        .replaceAll('{{cspSource}}', "'self'")
        .replaceAll('{{cssUri}}', '/media/reader.css')
        .replaceAll('{{jsUri}}', '/media/reader.js')
        .replace('<div id="toolbar">', SHIM + '<div id="toolbar">')
}

createServer(async (req, res) => {
    if (req.url.split('?')[0] === '/preview.html') {
        res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' })
        res.end(await previewPage())
        return
    }
    const file = resolve(req.url)
    try {
        const buf = await readFile(file)
        res.writeHead(200, {
            'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
            // No CSP header here — the spike asserts the *meta* CSP, which is what a
            // VSCode webview actually carries.
            'cache-control': 'no-store',
        })
        res.end(buf)
    } catch (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' })
        res.end(String(err.message))
    }
}).listen(7331, '127.0.0.1', () => console.log('spike server on http://127.0.0.1:7331'))
