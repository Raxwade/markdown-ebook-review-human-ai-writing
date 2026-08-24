# Markdown Ebook Review — Human–AI Writing Architecture

A VS Code extension that turns any Markdown file into an EPUB and previews it live in a panel beside the editor. Changes should appear within one second. The extension is independent of project-specific build scripts and does not require Pandoc or Calibre.

Authors can search, highlight, bookmark, and leave revision notes directly on the rendered ebook. Notes are stored in a structured JSON sidecar so a human author can give an AI precise, reviewable instructions for the next revision.

The package name is `markdown-ebook-review-human-ai-writing`, and the full VS Code extension ID is `raxwade.markdown-ebook-review-human-ai-writing`. Settings and commands retain the shorter `mdepub.*` namespace to keep workspace configuration and automation stable.

---

## 1. Scope

**Goals**

- Preview any `.md` file with zero configuration.
- Render the book with a real EPUB engine so pagination, chapter boundaries, widows, orphans, and image page breaks are visible.
- Rebuild after a debounced edit while preserving the reading position.
- Export an `.epub` beside the source file.
- Switch live among phone, tablet, desktop, and e-reader viewports, including custom dimensions.
- Apply reader appearance, whole-book search, bookmarks, navigation history, and progress controls directly to the existing renderer.
- Store review notes without modifying the Markdown source.

**Non-goals**

- Kindle KF8/MOBI conversion, which requires Amazon's Kindle tooling.
- Editing existing `.epub` files.
- Full EPUB specification validation; use EPUBCheck separately.
- Installing Pandoc or Calibre. The pipeline is pure JavaScript.

---

## 2. Three key decisions, backed by measurements

### 2.1 Generate a real EPUB, not an EPUB-like HTML preview

Converting Markdown to HTML inside a panel would show a scrolling webpage, not an ebook. Pagination, chapter boundaries, and image page breaks are the details authors need to inspect. The preview path therefore builds a real EPUB container and passes it to a real reading engine.

### 2.2 Rebuild the entire book after every edit

Measurements with markdown-it 15, fflate, and Node.js 20:

| Manuscript | Size | Chapters | Split | Render all | Package, level 0 | Total |
|---|---:|---:|---:|---:|---:|---:|
| `short-sample.md` | 78 KB | 53 | 0.2 ms | 12.0 ms | 0.6 ms | **26 ms** |
| `long-sample.md` | 321 KB | 62 | 1.7 ms | 47.6 ms | 2.3 ms | **101 ms** |

A full rebuild is within budget, so incremental building would add unnecessary complexity.

`build()` still returns a content hash for each chapter. The hashes are reserved for the optimization described in §4.3.

### 2.3 Use STORE for preview and DEFLATE for export

Preview data stays in local memory, so speed matters more than size:

- Level 0, STORE: 2.3 ms → 914 KB
- Level 6, DEFLATE: 51.9 ms → 442 KB

Preview uses level 0; export uses level 6. The saved 50 ms is roughly half the total preview budget.

---

## 3. Components

```text
src/
  extension.ts       Activation, command registration, panel lifecycle
  preview.ts         WebviewPanel, debounce, and host/webview protocol
  config.ts          Configuration loading and defaults
  reader-state.ts    ReaderProfile, per-book state, CSS, globalState/LRU
  epub/
    frontmatter.ts   YAML frontmatter → book metadata
    split.ts         Chapter splitting by heading level
    render.ts        markdown-it → XHTML
    assets.ts        Local image and CSS discovery/loading
    package.ts       container.xml / content.opf / nav.xhtml / toc.ncx
    zip.ts           fflate packaging
    build.ts         EPUB pipeline orchestration
media/
  reader.html        Webview shell, including CSP
  reader.js          Device frame, appearance, search, bookmarks, history,
                    notes, and book replacement
  reader.css
  vendor/foliate-js/ Vendored foliate-js, MIT licensed
test/                Pure module tests using node:test
```

Everything under `src/epub/` is a pure function: it accepts strings or buffers and returns strings or buffers, with no `vscode` import. It can therefore run under `node --test` without opening the editor. Error-prone logic such as chapter splitting, path resolution, and XHTML escaping remains in this testable layer.

`preview.ts` is the only component that touches both the VS Code API and the build pipeline.

---

## 4. Data flow

### 4.1 Open the preview

```text
command mdepub.preview
  → create WebviewPanel(ViewColumn.Beside)
  → localResourceRoots = [media/, directory containing the Markdown file]
  → load reader.html with a script nonce
  → build(document) → Uint8Array
  → panel.webview.postMessage({ type: 'book', bytes })
  → webview: new File([bytes]) → makeBook() → view.open()
```

### 4.2 Edit the manuscript

```text
onDidChangeTextDocument
  → debounce 120 ms
  → build() → bytes
  → postMessage
  → webview: save view.lastLocation.cfi
           → open the rebuilt book
           → view.init({ lastLocation: cfi }) to restore the position
```

Position restoration is mandatory. Without it, every keystroke returns the reader to the cover.

### 4.3 Reserved optimization switch

If measurement ever shows that full reload plus CFI restoration exceeds the budget, compare chapter hashes and replace the current iframe only when the visible chapter changes. This would bypass the full reload. The hashes returned by `build()` keep that option open; it should not be implemented without evidence that it is needed.

### 4.4 Switch device viewport

```text
device selector in the webview
  → save view.lastLocation.cfi
  → change the device-frame dimensions and recalculate scale if needed
  → repaginate
  → goTo(cfi) to restore the position
```

This happens entirely inside the webview. It does not return to the extension host, rerun `build()`, or send new book bytes. Only the viewport changes. See §6.1.

---

## 5. Rendering engine

The reader uses **foliate-js 1.0.1**, the MIT-licensed engine also used by the Foliate desktop application. It is vendored under `media/vendor/`.

Used APIs:

- `makeBook(file)` accepts a `File` or `Blob` and opens its EPUB ZIP.
- The `<foliate-view>` custom element provides `open()`, `init({ lastLocation })`, and `goTo()`.
- `view.lastLocation.cfi` preserves the reading position.

epub.js was not selected because it has a similar architecture but is older and less actively maintained.

### 5.1 Markdown parsing compatibility

`docs/markdown-compatibility.md` is the normative syntax profile. `render.ts` creates both preview and export parsers through `markdown.ts`, which configures safe CommonMark, GFM tables, static task items, one- and two-tilde strikethrough, and extended autolinks. Raw HTML remains disabled.

A shared, line-preserving normalization pass additionally accepts two frequent manuscript errors from human and AI drafting: an ATX heading without separating whitespace (`##Heading`) and padded strong delimiters (`** text **` or `__ text __`). It skips inline code and fenced code. `split.ts`, `render.ts`, and note chapter detection consume the same parsed heading model, including Setext headings, so chapter boundaries, XHTML, and anchors cannot disagree about them.

The normalization does not add or remove newlines. Therefore markdown-it's `token.map`, preview `data-md-line` attributes, and persisted note line numbers continue to refer to the original Markdown document. A marker-only line such as `##` remains an empty heading under CommonMark and intentionally renders no label.

The built-in stylesheet allows long table-cell values to wrap anywhere. This
lowers automatic table layout's minimum content width while preserving natural
column proportions, so a wide table stays inside Foliate's paginated column. It
must not depend on a viewport media query: a chapter iframe can span multiple
pagination columns and be wider than the device frame. A nested horizontal
scroller is also unreliable because the paginator clips page overflow. A
user-supplied `mdepub.css` replaces these defaults and is responsible for its
own narrow-table behavior.

---

## 6. Configuration

All `mdepub.*` settings have defaults, so the extension works without configuration:

| Setting | Default | Description |
|---|---|---|
| `splitLevel` | `2` | Split through `##`; `1` splits only on `#`. |
| `device` | `iphone` | Initial device viewport; see §6.1. |
| `customWidth` | `393` | Frame width in CSS px when `device: custom`. |
| `customHeight` | `852` | Frame height in CSS px when `device: custom`. |
| `css` | none | Custom CSS path replacing the built-in book stylesheet. |
| `lang` | automatic | Book language derived from the VS Code display language when not set explicitly. |
| `author` / `cover` | none | Optional book metadata. |
| `debounce` | `120` | Rebuild delay in milliseconds. |

Book metadata precedence is **YAML frontmatter > VS Code settings > values inferred from the first `#` heading and filename**.

Image paths are resolved relative to the Markdown file. The renderer collects referenced files and packages SVG, PNG, JPEG, WebP, and GIF images. Three rules matter:

- **Flatten packaged paths to `assets/<filename>`.** A Markdown path such as `../../pics/a.png` is valid in the source but would point outside the EPUB container. Duplicate filenames receive a numeric suffix.
- **Remove an unreadable `<img>` and keep its alt text** in `<span class="missing-image">`. Leaving the original `src` produces a broken image that may escape path-rewrite tests.
- **Leave external URLs unchanged.** Resources beginning with `https://` are neither packaged nor removed.

File I/O belongs in `extension.ts`, not `src/epub/`. The EPUB layer reports relative resources referenced by XHTML, and the caller supplies their bytes. This preserves the pure-module boundary described in §3.

### 6.1 Pagination, navigation, and device viewports

foliate-js binds touch gestures only; keyboard and toolbar navigation belong to the host. Keyboard listeners must be attached both to the outer document and to each paginated iframe document obtained from the view's `load` event. Once the book has focus, an outer listener alone will not receive the keypress.

The panel provides previous/next buttons, a chapter selector, and chapter/progress text. Progress is functional feedback: an early spine item may contain only a title and a paragraph, which can otherwise be mistaken for an incomplete render.

The reader is placed inside a fixed-size device viewport so the author can inspect real pagination at different dimensions.

**A viewport is width × height, not width alone.** Pagination, chapter boundaries, and image breaks depend on both. The dimensions use CSS pixels, or logical points, rather than physical display pixels. For example, an iPhone 15 viewport is 393 × 852, not 1179 × 2556.

The presets are representative layout targets, not device certification. Use `custom` for exact targets:

| Group | Preset | Width × height |
|---|---|---:|
| Phone | `iphone-se` | 375 × 667 |
| | `iphone` | 393 × 852 |
| | `iphone-max` | 430 × 932 |
| | `pixel` | 412 × 915 |
| | `galaxy` | 360 × 800 |
| Tablet | `ipad-mini` | 744 × 1133 |
| | `ipad` | 820 × 1180 |
| | `ipad-pro-11` | 834 × 1194 |
| | `ipad-pro-13` | 1024 × 1366 |
| E-reader | `kindle` | 620 × 830 |
| | `kindle-oasis` | 675 × 900 |
| | `kobo-clara` | 600 × 800 |
| | `remarkable` | 830 × 1100 |
| Desktop | `desktop` | 1280 × 800 |
| | `desktop-wide` | 1440 × 900 |
| Other | `panel` | Current panel dimensions |
| | `custom` | `customWidth` × `customHeight` |

E-reader values are deliberately approximate because e-ink devices do not usually publish a CSS-pixel viewport. They are sufficient for layout review; use `custom` for a specific model. Desktop presets represent typical window sizes rather than fixed hardware viewports.

`panel` is the only preset that intentionally reflows with the panel. This is valid because the user explicitly chose the panel as the declared layout viewport. Other device presets must never silently reflow to the panel width. A landscape button swaps width and height.

The selector lives in the webview because authors switch it frequently. `mdepub.device` determines only the initial value. Presets have one runtime source in `src/config.ts` and are sent with the configuration message. The unavoidable `package.json` enum is checked against that source by tests.

When a frame is wider than the panel, its visual presentation is scaled with `transform: scale(k)` without changing its declared layout dimensions. A border would consume layout space under `box-sizing: border-box`, so the frame outline uses `box-shadow`.

A plain transformed `<div>` is not sufficient. foliate-js calculates columns from `getBoundingClientRect()`, which reports transformed dimensions. It would therefore paginate for the scaled visual width instead of the declared device width. The device frame is an `<iframe>`: measurements inside it remain relative to its own viewport. The invariant is:

```js
frame.contentWindow.innerWidth === declaredWidth
```

This must hold at every scale. A narrow panel may make text difficult to read, but it must not trigger a special reflow mode; scrolling is also acceptable.

The iframe gives Foliate its own module realm because custom elements are registered per document. `media/stage.js` owns that realm. The frame uses `srcdoc` and is same-origin, allowing `reader.js` to access `contentDocument` directly. Cross-realm identity still matters: `Blob` and `File` must be constructed inside the frame because `zip.js` uses `instanceof`.

**The frame must not load resources by URL.** VS Code webview resources pass through a service worker that identifies the webview from the requesting client's query string. An `about:srcdoc` client has no webview ID, so requests fail with `Could not resolve webview id`. This also affects Foliate's dynamic imports.

The full module graph is therefore bundled with `npm run bundle:stage` into `media/stage.bundle.js`. `reader.js`, whose document is recognized by the service worker, fetches the bundle as text and injects it into the frame with the page nonce. It is a classic script and executes synchronously when appended. `media/vendor/` remains packaged in the VSIX so the repository layout exercised by the spike continues to match the shipped layout.

The static-server spike cannot reproduce this service-worker behavior. Product validation must include a real packaged VS Code webview. In Remote WSL, the relevant service worker lives in the Windows-side VS Code installation, not under `~/.vscode-server`.

Measured at a fixed 520 px panel width with the same chapter and manuscript:

| Device viewport | Visual scale | Pages in chapter |
|---|---:|---:|
| iPhone SE 375 × 667 | 100% | 7 |
| iPhone 393 × 852 | 90% | 4 |
| iPad Pro 834 × 1194 | 60% | 2 |
| Desktop 1280 × 800 | 39% | 3 |

Different page counts alone do not prove that declared dimensions were preserved because the scaled visual sizes also differ. The `contentWindow.innerWidth` invariant is the decisive check; it is assertion 0 in `spike/notes-loop.mjs`.

The same chapter position was preserved after device switching, orientation changes, and book replacement during the edit cycle.

---

## 7. Risks and validation

### 7.1 CSP and nested iframes

foliate-js creates a paginator iframe like this:

```js
#iframe = document.createElement('iframe')
this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
this.#iframe.src = src // blob: URL
```

Its demo CSP uses `frame-src blob: data:; default-src 'self' blob:`. The original blocking question was whether the outer VS Code webview sandbox allowed a same-origin nested blob iframe.

**Validated in M0 on 2026-08-01.** `npm run spike` exercises a static server, VS Code-equivalent CSP, and three outer sandbox variants. The inspected VS Code webview sandbox included `allow-same-origin`, `allow-pointer-lock`, and `allow-scripts`.

| Outer sandbox | Result |
|---|---|
| None | Render, pagination, and CFI restoration work. |
| `allow-scripts allow-same-origin`, matching VS Code | Same result. |
| `allow-scripts` only | Fails earlier because the opaque origin causes a CORS error loading `view.js`. |

The risk is closed. The fallback plan—custom XHTML pagination using CSS `column-width`—is retained only as historical context.

Two additional constraints emerged:

1. **`style-src` must include `blob:`.** Foliate converts book stylesheets to blob URLs. Without this directive the book renders without styles and only logs a CSP message.
2. **The device frame must use `overflow: hidden`.** `<foliate-view>` has no host style and its internal content can double the container's height. Foliate's three shadow roots are closed, so this must be checked visually rather than through DOM inspection.

A working policy is:

```text
default-src 'none';
script-src 'nonce-…' ${cspSource};
style-src 'unsafe-inline' ${cspSource} blob:;
img-src blob: data: ${cspSource};
font-src ${cspSource};
frame-src blob: data:; child-src blob:; worker-src blob:;
connect-src blob: ${cspSource};
```

### 7.2 CFI restoration latency

Measurements for a 60-chapter, 38 KB fixture in Chromium:

| Stage | Time |
|---|---:|
| `makeBook` | 59 ms |
| `view.open` | 5 ms |
| First `view.init`, including render | 155 ms |
| **Reopen plus CFI restoration, the §4.2 edit cycle** | **50 ms** |

The measured edit totals are 26 + 50 = 76 ms for the 78 KB manuscript and 101 + 50 = 151 ms for the 321 KB manuscript, well below the one-second target. The §4.3 optimization remains unnecessary.

CFI restoration was verified exactly: after `goTo(40)`, reopening the book and restoring `epubcfi(/6/82!/4/2,/2,/8/1:180)` returned the same string.

### 7.3 Remote WSL boundary

Under Remote WSL, the extension host runs in WSL while the webview UI runs in Windows Electron. This boundary is where `asWebviewUri` path errors surface, so packaging and installation alone are insufficient.

The packaged VSIX has been installed under Remote WSL, and the panel/resource path has been exercised in a real VS Code webview. The remaining rule is procedural: every release that changes media loading or bundling must repeat that packaged-webview smoke test.

---

## 8. Delivery

```text
esbuild bundle
  → @vscode/vsce package
  → .vsix
  → code --install-extension
```

The extension is currently distributed as a local VSIX rather than through the Marketplace. Marketplace publication can be added later.

---

## 9. Milestones and current status

| Milestone | Scope | Status |
|---|---|---|
| **M0** | CSP/iframe spike and CFI restoration timing | Complete; rerun with `npm run spike`. |
| **M1** | EPUB build pipeline, tests, and `Export EPUB` | Complete. Generated EPUBs load, render, paginate, and restore CFI in the Foliate harness. |
| **M2** | Preview panel, live reload, and device viewports | Complete. Device switching, rotation, pagination, and position preservation are covered by the browser harness. |
| **M3** | Configuration, errors, documentation, and VSIX/Remote WSL delivery | Complete. The packaged extension and a real VS Code panel have been exercised. |
| **M4** | Highlights, notes, and AI-readable JSON sidecar | Complete. |
| **M5** | Reader appearance, search, bookmarks, history, progress, and localization | Complete. |

M1 already provides a general Markdown-to-EPUB exporter. M2 through M5 deliver the complete human–AI ebook review workflow.

---

## 10. Notes and highlights

Reviewers can select rendered text or click an image, choose a color, and write a comment. Every color choice opens the comment editor; an empty comment remains a valid color-only highlight. The extension stores the result beside the Markdown file so an AI agent can read the source and review instructions together. **The Markdown file itself is never modified.**

### 10.1 Why anchors have two layers

| Anchor | Purpose | Persisted? |
|---|---|---|
| CFI | Highlight location in Foliate | **No.** It belongs to one rendered EPUB build and becomes invalid after rebuilding. |
| `{startLine, startCol, endLine, endCol}` | Storage and AI-agent interpretation | Yes. It refers to the edited Markdown source. |

`data-md-line` bridges the two. markdown-it block tokens carry `token.map`, relative to the chapter. `render.ts` adds the chapter's source offset and writes absolute source lines into each block element. These attributes exist only in preview builds, not exported EPUBs.

Image notes add an optional `target: { type: "image", src, alt }`. Preview rendering preserves the original Markdown destination in `data-md-image-src` before EPUB asset rewriting changes the live `src`. Re-anchoring searches image syntax outward from the stored line, preferring the destination and using alt text for reference-style images. The webview then locates the matching preview image and derives a fresh CFI from a DOM range around the element.

An anchor is an interval, not a key. A fenced code block or hard-wrapped paragraph may span several source lines, so rendering also writes the exclusive `data-md-line-end`. The webview finds elements that contain a line rather than querying an exact start line. When nested elements cover the same line, it chooses the last match in document order, which is the innermost block used when measuring columns.

The original exact selector silently failed whenever a quote was not on a block's first line: the note remained in the sidecar and list but no highlight appeared. The webview records the containing block's start line, while source re-anchoring finds the actual line containing the quote.

Consequently, a multi-line block range currently means “block start line plus offset within the block,” not “physical quote line plus offset within that line.” A sidecar consumer must reconstruct the block context. This limitation is documented rather than hidden.

Rendered text and Markdown source are not identical. A rendered quote such as `both strengths` may originate from `**both strengths**`, so raw substring matching can fail. Line numbers also move after earlier edits; they are hints, not absolute answers. `anchorNote()` searches outward from the recorded line and prefers the nearest match inside the note's recorded chapter. If that chapter heading still exists but the quote does not, the note becomes stale instead of jumping to identical words in a later chapter.

If a single-line search fails, re-anchoring joins subsequent non-empty lines into a window and checks whether the quote starts on the current line. The window grows according to quote length, not a fixed number of lines. A fixed line count fails for short paragraphs separated by blank lines. Normalization removes whitespace, so empty lines add no matching information and are skipped efficiently.

### 10.2 Sidecar file

Notes are stored in `<book>.md.notes.json` beside the manuscript. Deleting the file removes all notes by design, so `preview.ts` watches it. Deleting the final note removes the empty sidecar.

Long selections are abbreviated in storage: when a quote exceeds 120 characters, the first and last 45 characters are kept along with `quoteLength`. This avoids copying large portions of the manuscript into the review file while retaining enough text for re-anchoring.

Removing a stale note crosses a filesystem boundary and therefore belongs to the extension host, not the webview. The host revalidates that the requested note is still stale, then presents Archive, Discard, and Cancel. Archive opens a Save dialog at `<markdown-name>_closed_notes.<YYYY-MM-DD-HH-mm>.json` by default and writes `{version, source, closedAt, reason: "source-target-not-found", notes}` before changing the active sidecar. A failed or cancelled archive leaves the note untouched. The drawer can submit all stale IDs for the same bulk workflow.

### 10.3 Navigate from the note list

Selecting a note must both navigate to its highlight and mark it as the active note. The book draws a dark outline while the corresponding list row is selected. Selecting another note transfers the state; Escape clears it. Comment editing remains a separate action because its full-page dialog conflicts with direct navigation.

`chapterStartLines` is required because a CFI does not exist until its chapter has rendered. Most notes in a large book therefore initially have no CFI. Navigation first maps the note's source line to a chapter, opens that chapter using the href from Foliate's TOC, waits for `redrawAll()`, and then moves to the newly created exact CFI.

Selection state stores the **note ID, not the CFI**, because rebuilding regenerates CFIs. The active outline is added to the SVG group produced by `Overlayer.highlight`; the webview does not construct cross-realm SVG nodes itself. Multi-line selections deliberately render as adjacent per-line boxes.

Persisted columns are also hints after revision. Once the host finds the quote's current line, the webview indexes the normalized rendered text in the containing block and reconstructs the DOM range from the saved quote. It uses the old column only to choose between duplicate occurrences. Reusing the old column as the range boundary can highlight a neighboring table cell after text earlier in the row changes.

### 10.4 Quotes are rendered text; the source is Markdown

Both sides pass through `matchable()` before re-anchoring. It removes whitespace, link destinations, and Markdown punctuation consumed by markdown-it.

Simple emphasis often appeared to work because rendered text remained a source substring. Failures arise when syntax occurs inside the selection. For example, the rendered table text `321 KB 62 1.7 ms` is not a substring of `| 321 KB | 62 | 1.7 ms |`. Selections crossing emphasis or links have the same problem.

Whitespace removal is also semantic: a hard-wrapped source paragraph renders as a single line joined by a space, but that space does not meaningfully belong to the original newline. Normalizing both sides lets the multi-line window search concatenate text without inventing separators.

This is character filtering, not a second Markdown render. Re-anchoring runs for every note across every source line; calling `plainText()` for each line is orders of magnitude slower. The looser match is controlled by choosing the occurrence nearest the stored line, and tests ensure genuinely deleted quotes still become stale.

A stale note draws no highlight because `anchorInDocument` returns `null`. A gray selection still visible after focus leaves the frame may be the browser's native selection, not an extension highlight.

### 10.5 When the original source target cannot be found

The note is preserved and marked stale rather than deleted. Review comments are more valuable than perfect anchors, and an unrelated edit must not silently erase them. Deletion requires an explicit archive or discard choice as described in §10.2.

### 10.6 Three silent failure modes

- **Draw on `create-overlayer`, not `load`.** The paginator creates the overlayer only after `await view.load()`. Drawing during `load` finds no overlayer and fails without an exception.
- **Set `--overlayer-highlight-opacity` to `1`.** Foliate's default 0.3 multiplies the color's own alpha and makes highlights too faint.
- **Load highlight custom properties in both documents.** CSS variables do not cross the device iframe boundary. Colors live in `media/marks.css`, imported by the webview and linked inside the device frame. Browser assertions inspect computed `fill` and `opacity`, not only SVG attributes.

---

## 11. Reader experience

M5 adds ways to read and inspect the already rendered book; it does not add another build pipeline. Appearance changes operate on the existing Foliate renderer. Search, bookmarks, history, and progress use Foliate CFI/fraction coordinates. The appearance panel cannot change the device dimensions defined by §6.1.

### 11.1 `ReaderProfile`

`src/reader-state.ts` defines version 1:

```ts
interface ReaderProfile {
  version: 1
  fontSize: number
  fontFamily: 'publisher' | 'serif' | 'sans-serif' | 'monospace'
  bold: boolean
  lineHeight: number
  characterSpacing: number
  wordSpacing: number
  pageMargin: number
  textAlign: 'publisher' | 'left' | 'justify'
  columns: 'auto' | 'single' | 'double'
  readingMode: 'paginated' | 'scrolled'
  theme: 'publisher' | 'system' | 'light' | 'paper' | 'sepia' | 'gray' | 'dark'
}
```

The host is the validation boundary. On every `reader:profile-save`, it validates enums, clamps numeric ranges, quantizes font size to 10% increments, and returns the normalized profile and CSS through `reader:profile`. The webview does not trust its submitted values. Data lives in `globalState['mdepub.readerProfile']`, shared by all books but not synchronized across machines.

The default profile generates an empty CSS string and leaves no paginator override attributes. Reset must remove reader overrides rather than write a guessed copy of publisher defaults.

Fonts use system stacks and are never fetched from the network. Themes also set `--theme-bg-color` so the paginator surround matches the chapter document. `publisher` leaves foreground and background untouched; `system` uses CSS system colors; other themes define fixed foreground, background, and link colors.

### 11.2 Appearance update sequence

Whenever the profile changes:

1. Save `view.lastLocation.cfi` and the fraction fallback.
2. Call `setStyles()` on the existing `view.renderer`.
3. Set or remove `flow`, `margin`, `max-column-count`, and `max-column-count-portrait` on the same paginator.
4. Wait for `FontFaceSet.ready`, two paint cycles, and paginator layout. Every wait has a timeout so a broken font or background pagination cannot freeze later operations.
5. Restore the position through `renderer.goTo(resolveNavigation(cfi))`. This deliberately bypasses `view.goTo()` because an appearance restoration is not user navigation and must not pollute history. Fall back to fraction if the CFI is invalid.
6. Call `redrawAll()` so highlights follow the new geometry.

Appearance updates and book replacement share a promise chain. Rapid slider changes apply only the latest profile and cannot dismantle a renderer while `open()` is using it. Book and renderer identities remain unchanged, and the webview does not request new `book` bytes from the host.

Markdown rebuilding is the exception because it necessarily replaces the book. The profile is applied after `view.open(book)` and before `init()` restores position, preventing a publisher-style layout from flashing before the reader style applies. Notes regenerate CFIs from Markdown ranges as described in §10.

Foliate normally forces a single column in portrait orientation. The vendored paginator adds `max-column-count-portrait` so an explicit double-column choice can override that behavior. `auto` removes both column attributes and restores upstream portrait/spread behavior.

### 11.3 Per-book reading state

```ts
interface BookReaderState {
  version: 1
  cfi: string | null
  fraction: number
  bookmarks: Array<{
    id: string
    cfi: string | null
    fraction: number
    chapter: string
    created: string
  }>
  lastUsed: number
}
```

The key is a SHA-256 hash of the canonical URI, so full paths do not appear in global-state keys. CFI is preferred; overall fraction is the fallback after manuscript changes invalidate it. `lastUsed` updates when a book opens, the page changes, or bookmarks change. The collection uses a 100-entry least-recently-used limit.

On every `relocate`, the webview sends state to the host's memory cache. The host debounces `globalState.update()` by 500 ms. This makes the cache flushable: on manuscript switch or panel disposal, the host already owns the latest location and can immediately persist it. Bookmarks and profile changes save immediately.

The protocol has four authoritative messages:

| Host → webview | Webview → host | Purpose |
|---|---|---|
| `reader:profile` | `reader:profile-save` | Global appearance; the host returns normalized profile and CSS. |
| `reader:book-state` | `reader:book-state-save` | Per-book position and bookmarks; `bookId` prevents switch races. |

Appearance and reading-state messages must never call `buildForPreview()`. Extension tests enforce this boundary by checking the number of `book` messages.

### 11.4 Search, bookmarks, history, and progress

Search uses `view.search()`, Foliate's whole-book async generator, with `matchCase: false`. Results stream by chapter so the UI can show scan progress while building chapter groups, snippets, and counts. A new query increments a generation, calls `return()` on the old iterator, and enters the same search chain. Results from a stale generator cannot write into the new query. `clearSearch()` also removes old search overlays.

Bookmarks store both CFI and fraction, sort by fraction, and group by chapter. Navigation tries CFI first and then fraction. The current-page star compares either equal CFIs or a very small fraction distance so minor layout changes do not prevent bookmark removal.

Navigation history uses Foliate's `view.history`. TOC links, internal links, search results, bookmarks, and `goToFraction()` push entries. Page and scroll relocation replace the current entry. Appearance and device restoration use the renderer directly and do not push. The toolbar exposes `canGoBack` and `canGoForward`.

While the progress slider is moving, navigation goes directly through the renderer so every `input` event does not create history. The final `change` calls `view.goToFraction()` to record one deliberate navigation. Intermediate drag positions are not persisted; the final `relocate` saves the result.

Search, bookmarks, and notes share one drawer with one active page. On wide panels it occupies the right column; below 700 px it overlays the stage without changing the declared device viewport.

### 11.5 Validation boundary

`test/reader-state.test.ts` covers numeric and enum validation, migration, CSS generation, global profiles, per-book isolation, and the 100-entry LRU. `test/extension.test.ts` covers save/echo behavior for the four protocol messages and confirms they do not produce a new `book` message.

`spike/reader-experience.html` loads the real `media/reader.html` and bundled stage in Chromium. It checks book/renderer identity, computed fonts and colors, CFI restoration, columns and flow, device viewports, highlights, search including stale-query cancellation, bookmarks, progress, and history. This harness can use Foliate's remaining public handles around closed shadow roots, but it cannot reproduce VS Code's service-worker resource resolution. A real packaged VS Code webview remains the final release check.

### 11.6 Deferred work

Brightness belongs to the operating system or editor. Page-turn animation, dictionary/translation, read-aloud, line guidance, and reading statistics require broader platform or accessibility design and should not be represented by incomplete controls.

### 11.7 Interface locale is not book language

English is the source language and unconditional UI fallback. The host normalizes `vscode.env.language` into `config.locale`. Traditional Chinese locales use the Traditional Chinese catalog; all unsupported locales fall back to English.

`reader.html` contains English fallback text and marks static strings with `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, and `data-i18n-aria-label`. Search counts, bookmarks, notes, errors, and status messages use the same runtime catalog in `reader.js`, avoiding mixed-language UI or a localization flash.

Device groups use language-neutral keys such as `phone`, `tablet`, `ereader`, and `desktop`; translation occurs only in the webview. The Command Palette and Settings page use VS Code's `package.nls.json` and `package.nls.zh-tw.json`. The distributed README is English.

`mdepub.lang` controls EPUB metadata and content language independently of the interface locale. Frontmatter or an explicit setting takes precedence. When the setting is empty, the canonical BCP 47 tag of the VS Code display language is used even if the UI has no matching catalog. Generated book text such as the table of contents follows the book language, not the current UI language.

`test/i18n.test.ts` covers English fallback, locale normalization, manifest-key completeness, and localized parser warnings. The browser harness switches among English, Traditional Chinese, and an unsupported locale and confirms the appearance panel contains no hard-coded Chinese text.
