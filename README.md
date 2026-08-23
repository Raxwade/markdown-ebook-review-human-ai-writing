# Markdown Ebook Review — Human–AI Writing

[![CI](https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/actions/workflows/ci.yml/badge.svg)](https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/actions/workflows/ci.yml)

Preview your Markdown manuscript as an ebook, leave structured notes, and guide the next AI revision.

Markdown Ebook Review — Human–AI Writing is a VS Code extension for authors who write books in Markdown, especially authors who draft and revise with AI. It renders the active manuscript as a real EPUB in a panel beside the source. Every edit rebuilds the in-memory preview automatically, so you can inspect the book's pagination, chapter boundaries, image breaks, and reading experience without manually exporting and reopening an EPUB after every change.

While reviewing, you can search the whole book, save bookmarks, highlight passages, and attach revision notes. Highlights and notes are written to a JSON sidecar—a separate review file next to the manuscript. You can give that file to an AI assistant as a precise, source-linked revision brief, then see the revised Markdown re-rendered immediately in the preview.

The preview is powered by [foliate-js](https://github.com/johnfactotum/foliate-js), the same engine used by the Foliate desktop reader, rather than a scrolling HTML approximation. The conversion pipeline is pure JavaScript and requires neither pandoc nor calibre.

## Author and AI workflow

1. Draft or revise the book with an AI assistant while keeping Markdown as the source of truth.
2. Open the live EPUB preview beside the Markdown editor.
3. Read in a representative phone, tablet, e-reader, or desktop layout. Search the manuscript and add bookmarks as you review.
4. Highlight passages and record revision instructions in context.
5. Give the manuscript and its `<book>.md.notes.json` sidecar to your AI assistant for the next revision pass.
6. Review the changes immediately in the live preview, and export an `.epub` only when you need a distributable file.

The extension does not send your manuscript to an AI provider or revise it automatically. The JSON sidecar is a portable handoff format that you can use with the model and workflow of your choice.

## Features

- Open any `.md` file with no project setup.
- Rebuild automatically after edits while preserving the reading location.
- Preview phone, tablet, e-reader, desktop, panel-sized, and custom viewports in portrait or landscape.
- Adjust font size and family, bold text, line height, character and word spacing, margins, alignment, columns, reading mode, and page theme from the `Aa` panel.
- Search the whole book, save bookmarks, navigate location history, and scrub overall progress.
- Add highlights and notes without changing the Markdown source. Notes are stored in a JSON sidecar beside the manuscript.
- Export a standards-based `.epub` beside the Markdown file.
- Follow the VS Code display language. English is the fallback; Traditional Chinese is also included.

## Non-goals

- Kindle KF8 or MOBI conversion
- Editing an existing `.epub`
- Full EPUB validation; use EPUBCheck for release validation
- Brightness controls, page-curl animation, dictionary or translation tools, read-aloud, line guides, or reading statistics

## Installation

The extension is currently distributed as a local VSIX.

### From source

```bash
npm install
npm run package
code --install-extension markdown-ebook-review-human-ai-writing-*.vsix --force
```

Reload VS Code after installation: open the Command Palette and run `Developer: Reload Window`.

### From an existing VSIX

Run `Extensions: Install from VSIX...` from the Command Palette and select the package.

### Remote WSL

Install the extension on the WSL side, not the Windows side. Running the command from a WSL terminal should report:

```text
Installing extensions on WSL: Ubuntu...
```

Verify the installed version with:

```bash
code --list-extensions --show-versions | rg epub
# raxwade.markdown-ebook-review-human-ai-writing@0.6.1
```

Rebuild before reinstalling after a code change. `--force` permits overwriting an installed version; it does not rebuild the VSIX.

## Usage

| Command | Action |
|---|---|
| `Markdown Ebook Review: Open EPUB Preview` | Open the live preview beside the editor. The book icon in the editor title runs the same command. |
| `Markdown Ebook Review: Export EPUB` | Write an EPUB beside the active Markdown file. |

Open a `.md` file, then type `Markdown Ebook Review` or `EPUB` in the Command Palette to find both commands.

### Reader toolbar

`‹` and `›` turn pages. The chapter menu jumps directly to a chapter, and the progress slider jumps anywhere in the book. The chapter and percentage display remains visible beside it.

`↶` and `↷` navigate location history, including TOC jumps, internal links, search results, bookmarks, and progress jumps.

`Aa` opens reading appearance. `⌕`, `🔖`, and `✎` open Search, Bookmarks, and Notes in one mutually exclusive drawer. The drawer overlays the reader in a narrow panel so it cannot change the declared device viewport.

The device menu, rotate button, current dimensions, and scale remain on the second toolbar row.

### Keyboard

| Key | Action |
|---|---|
| `Left` / `PageUp` / `h` | Previous page |
| `Right` / `PageDown` / `l` / `Space` | Next page; `Shift+Space` goes back |
| `Home` | Start of book |
| `Ctrl+F` (`Cmd+F` on macOS) | Open whole-book search |
| `Ctrl+D` (`Cmd+D` on macOS) | Add or remove a bookmark at the current location |
| `Alt+Left` / `Alt+Right` | Back or forward in location history |
| `Escape` | Close the editor sheet, floating tools, appearance panel, or drawer |

## Interface language

The reader receives the normalized `vscode.env.language` value from the extension host. English is the source language and the fallback for every unsupported locale; the extension never falls back to Chinese. Traditional Chinese is selected for `zh-TW`, `zh-Hant`, `zh-HK`, and `zh-MO`.

The Command Palette and Settings descriptions use VS Code `package.nls` bundles. Static reader HTML starts in English, while dynamic search, bookmark, note, warning, and status messages use the same runtime locale catalog.

`mdepub.lang` controls the language of the book itself, which is separate from the interface language. Leave it empty to follow the VS Code display language, set it explicitly for a workspace, or declare `lang` in frontmatter for a specific manuscript.

## Reading appearance

The `Aa` panel provides:

- Font size from `80%` to `200%` in `10%` steps
- Original book, serif, sans serif, and monospace font families, plus bold text
- Line height from `1.2` to `2.0`
- Character spacing from `−0.02em` to `0.12em`
- Word spacing from `0` to `0.30em`
- Page margins from `16` to `96` CSS px
- Original-book, left-aligned, and justified text
- Automatic, one-column, and two-column layouts
- Paginated and vertically scrolling modes
- Original-book, system, light, paper, sepia, gray, and dark themes

Every adjustment applies to the existing Foliate renderer. It does not rebuild the EPUB, reopen the book, or require an Apply button. Layout changes capture the current CFI, wait for fonts and pagination to settle, restore the location, and redraw annotations.

`Reset reader overrides` removes all reader-level styles and paginator overrides, restoring the EPUB's original presentation.

Appearance settings affect preview only. Exported EPUB styling still comes from the manuscript and `mdepub.css`.

The appearance profile is stored in VS Code global storage and shared by books on the same extension installation. It is not cloud-synchronized.

## Search, bookmarks, and reading state

Whole-book search is case-insensitive and uses Foliate's bundled search implementation. Results appear progressively, grouped by chapter, with excerpts, match highlighting, result counts, progress, and previous/next navigation. A new query cancels the old iterator so stale results cannot reappear.

Use `☆` to bookmark the current location. It changes to `★` while the location is bookmarked. The bookmark list is grouped by chapter and navigates with CFI first, falling back to overall book progress if editing invalidates the CFI.

Each manuscript stores its last CFI, progress fallback, and bookmarks independently. Location writes are debounced by 500 ms and flushed when switching manuscripts or disposing the panel. The 100 most recently used manuscript states are retained.

Reader state is local to VS Code. It is never written into the Markdown file or exported EPUB.

## Chapter splitting and blank space

Every generated EPUB chapter begins on a new page. If a top-level section contains only a heading and a short introduction, the rest of that page is intentionally blank.

For technical documents with one `#` title and many `##` sections, use `mdepub.splitLevel: 1` when the document should read continuously. For books whose chapters are `##` headings, keep the default value of `2`.

Choose `Fit current panel` in the device menu when you explicitly want pagination based on the current panel rather than a device preset.

## Device viewport

The viewport fixes both width and height in logical CSS pixels. Pagination depends on both dimensions; resizing only the width would produce page breaks that match no real device.

When a viewport is larger than the panel, the extension scales the complete frame visually without changing its declared layout dimensions. E-reader presets are approximate because those devices do not publish browser-style CSS viewports; use `custom` when a particular target matters.

## Highlights and notes

Select text or click an image in the book, then choose yellow, green, blue, pink, purple, or `Note`. Every choice opens the note editor so you can immediately add an instruction; saving an empty comment still creates a color-only highlight. Clicking an existing highlight opens it for editing. The Notes drawer can navigate to, edit, or delete any note.

The Markdown source is not modified. Notes are stored in `<book>.md.notes.json`, where both people and AI assistants can connect each instruction to its chapter, source range, and quoted text:

```jsonc
{
  "version": 1,
  "source": "book.md",
  "notes": [
    {
      "id": "nmselvuzn1e4",
      "color": "yellow",
      "chapter": "Introduction",
      "range": { "startLine": 142, "startCol": 0, "endLine": 142, "endCol": 62 },
      "quote": "A marked passage",
      "note": "Move this argument to the start of the chapter.",
      "created": "2026-08-04T01:20:00Z"
    }
  ]
}
```

Image notes use the same schema with an additional stable target:

```jsonc
"target": { "type": "image", "src": "images/map.png", "alt": "Route map" }
```

For example, you can attach the Markdown file and its sidecar to an AI conversation with an instruction such as:

> Revise `book.md` according to `book.md.notes.json`. Use each note's `range` and `quote`, plus `target` when present, to locate the passage or image. Treat the `note` field as the revision instruction, preserve unrelated content, and report any note you cannot resolve safely.

`range` uses zero-based Markdown line and column coordinates. Marks longer than 120 characters retain their head and tail with a language-neutral `[…N…]` marker and a `quoteLength` field.

Deleting the sidecar removes every highlight immediately. If revision makes a text or image target impossible to re-anchor, the note remains in the list with a warning. Deleting a stale note always asks whether to archive it, discard it, or cancel. Archive opens a Save dialog whose default is `<markdown-name>_closed_notes.<YYYY-MM-DD-HH-mm>.json`; the filename can be changed. The Notes drawer also provides a bulk Archive / Discard action for all stale notes.

## Settings

| Setting | Default | Description |
|---|---|---|
| `mdepub.splitLevel` | `2` | Chapter heading level: `2` splits at `##`; `1` splits only at `#` |
| `mdepub.device` | `iphone` | Initial phone, tablet, e-reader, desktop, panel, or custom viewport |
| `mdepub.customWidth` / `customHeight` | `393` / `852` | Custom viewport dimensions in CSS px |
| `mdepub.css` | unset | Custom stylesheet path relative to the Markdown file |
| `mdepub.lang` | auto | Book language; follows VS Code when empty |
| `mdepub.author` | unset | Book author |
| `mdepub.cover` | unset | Cover image path |
| `mdepub.debounce` | `120` | Milliseconds after editing before rebuilding |

### Frontmatter

Metadata precedence is **YAML frontmatter > VS Code settings > inferred heading and filename**:

```markdown
---
title: Example Book
author: Example Author
lang: en
cover: cover.jpg
---

# Chapter One
```

### Images

Relative paths resolve from the Markdown file's directory. SVG, PNG, JPEG, WebP, and GIF are supported.

Assets are flattened under `assets/` inside the EPUB. An unreadable image is removed while its alt text is retained, and a warning appears in the preview.

## Development

```bash
npm ci
npm test
npm run bundle
npm run package
```

Development and CI use Node.js 20. Before opening a pull request, run `npm test`
and `npm run package`. See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture,
localization, testing, and pull-request guidance.

`src/epub/*` contains pure functions and does not import `vscode` or access the filesystem. Asset bytes enter through `readAsset`, which keeps chapter splitting, path handling, XHTML escaping, and packaging directly testable with `node --test`.

`npm run spike` starts a local server at `http://127.0.0.1:7331`. `npm run spike:reader` creates the automated reader fixture; `/reader-experience.html` exercises the real `media/reader.html` and bundled Foliate stage, including localization, renderer identity, computed appearance, CFI restoration, viewport dimensions, annotations, search cancellation, bookmarks, progress, and history.

The browser harness cannot reproduce VS Code's `srcdoc` and service-worker boundary. Test each packaged VSIX once in a real VS Code webview before release.

Architecture details and measured tradeoffs are documented in [`docs/architecture.md`](docs/architecture.md).

## Community and support

- Report reproducible bugs and propose features through [GitHub Issues](https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/issues).
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting a substantial change.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Project changes are recorded in [CHANGELOG.md](CHANGELOG.md).
- Everyone participating in the project must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

The project is ISC licensed. Bundled components retain their upstream licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
