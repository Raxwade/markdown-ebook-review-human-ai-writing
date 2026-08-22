// Runs inside the device-frame iframe, and does almost nothing on purpose.
//
// **This file is not loaded at runtime — media/stage.bundle.js is.** It is the
// source esbuild bundles (`npm run bundle:stage`), and the bundle is what
// reader.js fetches and injects into the frame.
//
// The frame is an <iframe> rather than a <div> for one reason: foliate's
// paginator sizes its columns from `#container.getBoundingClientRect()`, which
// is the *transformed* size, so a frame scaled to fit the panel was paginating
// the book at whatever it happened to look like rather than at the device size
// it declares. Inside an iframe, getBoundingClientRect is relative to that
// iframe's own viewport, and a transform on the iframe element cannot reach it —
// measured 393 against the 197 a scaled <div> reports (spec §6.1).
//
// This file exists because that iframe needs its own module realm. Custom
// elements are registered per document, so <foliate-view> has to be defined in
// here; and anything foliate will `instanceof` — Blob, File — has to be built
// from this realm's constructors or the check silently fails. Everything else
// stays in reader.js, which reaches in through contentDocument: the frame is
// srcdoc, so it is same-origin and no message protocol is needed.
//
// It is bundled rather than loaded by URL because nothing inside the frame can
// load a URL at all: VSCode's service worker resolves the asking webview from
// the client URL's `?id=`, and a srcdoc document is `about:srcdoc`, so its
// requests 404. That applies to foliate's own dynamic imports — zip.js, epub.js,
// paginator.js are all fetched from in here when a book opens — which is why the
// whole graph has to be in one file. See reader.js's startStage().
//
// Bundling leaves four dynamic imports unresolved: comic-book.js, fb2.js,
// mobi.js and tts.js, none of which are vendored. They are unreachable — the
// first three are format branches for files that are not zipped EPUBs, and this
// extension only ever opens an EPUB it built itself.
import { makeBook } from './vendor/foliate-js/view.js'
import { Overlayer } from './vendor/foliate-js/overlayer.js'

// The handles reader.js needs from this realm. It reads them straight off the
// frame's window the moment the bundle has run — a classic script, so appending
// it is enough and there is nothing to wait for.
window.__mdepub = { makeBook, Overlayer }
