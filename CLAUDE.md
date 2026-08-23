# Repository Agent Guide

This file is the source for both `CLAUDE.md` and the `AGENTS.md` symlink. It
provides current guidance for coding agents working in this repository.

## Product identity and purpose

- Display name: **Markdown Ebook Review — Human–AI Writing**
- Package name: `markdown-ebook-review-human-ai-writing`
- VS Code extension ID: `raxwade.markdown-ebook-review-human-ai-writing`
- Repository: `https://github.com/Raxwade/markdown-ebook-review-human-ai-writing`
- Stable command and setting namespace: `mdepub.*`

The extension helps authors review Markdown manuscripts as real ebooks without
exporting an EPUB after every edit. It renders the active manuscript with
foliate-js in a VS Code side panel, supports search, bookmarks, highlights, and
notes, and writes review notes to `<book>.md.notes.json`.

The JSON sidecar is the human-to-AI handoff: an author reviews the rendered book,
records source-linked revision instructions, and gives the Markdown and sidecar
to an AI assistant for the next revision. The extension does not call an AI
provider, upload the manuscript, or revise the source automatically.

`docs/architecture.md` is the technical spec of record. Read the relevant
section before changing rendering, packaging, webview, annotation, rebuild, or
reader-state behavior; it records measured constraints and rejected approaches.

## Current capabilities

- Live real-EPUB preview for any open Markdown file.
- Automatic full-book rebuilds that preserve reading location.
- Phone, tablet, e-reader, desktop, panel, and custom viewports.
- Reader appearance controls, whole-book search, bookmarks, progress, and
  navigation history.
- Text and image highlights with structured notes stored outside the Markdown
  source, plus explicit archive/discard handling for stale notes.
- Standards-based EPUB export with frontmatter, images, covers, custom CSS, and
  configurable chapter splitting.
- English source/fallback UI and Traditional Chinese localization.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Type-check and run the complete Node test suite. |
| `npm run compile` | Type-check and emit JavaScript to `out/`. |
| `npm run bundle` | Build `media/stage.bundle.js` and `dist/extension.js`. |
| `npm run bundle:stage` | Rebuild only the injected foliate stage. |
| `npm run package` | Bundle and create the installable VSIX. |
| `npm run spike` | Build the base fixture and start the browser harness on port 7331. |
| `npm run spike:fixture` | Generate the base EPUB fixture. |
| `npm run spike:reader` | Generate the automated reader-experience fixture. |
| `npm run spike:notes` | Generate the manual annotation-loop fixture and console checks. |
| `npm run spike:rebuild` | Generate the manual live-rebuild fixtures and console checks. |

Compile before running a generated fixture directly. To run one test file:

```bash
npm run compile
node --test out/test/split.test.js
```

## Architecture constraints

### EPUB build boundary

- `src/epub/*` must not import `vscode` or access the filesystem. It accepts
  strings and bytes; `extension.ts` owns I/O and supplies assets through
  `readAsset`.
- Rebuild the complete preview after each edit. Incremental rendering was
  measured and rejected; do not add its complexity without new evidence.
- Preserve the current CFI across rebuilds. Serialize overlapping opens and
  close the previous foliate book before opening the next one.
- Keep the unused per-chapter content hashes returned by `build()`. They reserve
  the documented optimization path.
- Preview ZIPs use STORE; exported ZIPs use DEFLATE. EPUB `mimetype` must remain
  the first entry and uncompressed. `test/zip.test.ts` protects this invariant.
- Metadata precedence is frontmatter, VS Code settings, the first `#` heading,
  then filename.
- A derived EPUB identifier must remain stable across edits and include the
  workspace-relative source identity. Do not derive it from manuscript text.
- `mdepub.css` trust depends on configuration scope: workspace values stay
  inside the workspace, while user-scoped values may point elsewhere.

### Webview and reader

- The device frame must remain an `<iframe>` with no border. Its independent
  viewport prevents visual scaling from changing foliate pagination.
- Code inside the `srcdoc` frame cannot fetch its module graph in a VS Code
  webview. Bundle `media/stage.js` and its foliate dependencies into
  `media/stage.bundle.js`, then inject the bundle with the page nonce.
- CSP must allow `blob:` styles for EPUB stylesheets. Do not weaken other CSP
  boundaries without a concrete requirement.
- Create `Blob`, `File`, and overlay values from the frame's realm when foliate
  performs `instanceof` checks. Custom elements and overlay helpers are also
  document-realm specific.
- Keep foliate-js vendored under `media/vendor/`; the browser harness and shipped
  extension must exercise the same reader sources.
- Device, orientation, and appearance changes resize or repaginate the existing
  renderer; they must not rebuild the EPUB.

### Notes and annotations

- Never modify the Markdown source when highlighting or taking notes. The
  sidecar is a portable data contract and must remain understandable without the
  extension.
- Draw annotations on `create-overlay`, not `load`; the overlayer does not exist
  earlier.
- Load `media/marks.css` in both documents because CSS custom properties do not
  cross the iframe boundary. Assert computed styles rather than SVG attributes.
- A note receives exactly one CFI, derived by `anchorInDocument()`. Persist the
  Markdown range and quote, not the transient CFI.
- Image notes add an optional `target` containing the original Markdown image
  destination and alt text; keep older text-only sidecars compatible.
- Stale-note removal must be confirmed. Archive before mutating the active
  sidecar, and leave it unchanged when the archive is cancelled or fails.
- `data-md-line` describes a source span, not a unique key. Multi-line blocks
  require containment lookup using `data-md-line-end`.
- The sidecar range for a multi-line block can use the block's start line and a
  block-relative column. AI consumers should use `range` together with `quote`;
  do not claim that coordinates alone always round-trip exactly.
- Redraws must remove obsolete drawings as well as add current ones. Deleted,
  stale, or relocated notes must not leave ghost highlights.

### Compatibility and localization

- Keep `mdepub.*` command IDs, settings, storage keys, and sidecar schema stable
  unless a migration is implemented and documented.
- English is the source and fallback interface language. Update
  `package.nls.json`, `package.nls.zh-tw.json`, and the runtime catalogs together
  whenever user-visible text changes.

## Verification expectations

For routine changes:

```bash
npm test
npm run package
```

For reader, pagination, search, bookmark, appearance, annotation, or rebuild
changes, also run the relevant browser fixture. The browser harness cannot
reproduce the VS Code webview service-worker boundary, so install and open a
packaged VSIX in a real VS Code window after changing CSP, resource loading,
iframe construction, or stage bundling.

Use `npx vsce ls --no-dependencies` to inspect package contents. Verify required
artifacts such as `dist/extension.js`, localization bundles, and reader assets;
do not rely on a fixed file count. Do not commit `dist/`, `out/`, VSIX files,
generated EPUBs, logs, note sidecars, private manuscripts, or credentials.

## Out of scope

- Pandoc or calibre dependencies
- MOBI or Kindle KF8 conversion
- Editing existing EPUB files
- Built-in EPUBCheck validation
- An embedded AI provider or automatic manuscript revision
