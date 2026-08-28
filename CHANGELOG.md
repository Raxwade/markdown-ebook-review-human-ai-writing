# Changelog

Notable project changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add an Archive action to each stale note, with the newest matching
  closed-notes JSON file preselected and later stale notes appended to it.

### Changed

- Clarify the boundary between the extension's human–AI review loop and the
  author's separate production build, validation, and deployment pipeline, with
  a new workflow diagram in the README.
- Make the stale-note Delete action discard immediately instead of opening the
  archive/discard choice.

### Fixed

- Keep the bulk stale-note action in its own Notes-panel row so it cannot
  overlap the first note.
- Package README media links against the `main` branch instead of the remote's
  ambiguous `HEAD` reference, so extension-details media resolves after the
  branch is published.

## [0.6.3] - 2026-08-25

### Added

- Add a colorful open-ebook icon for the VS Code Extensions view and packaged
  extension metadata.

## [0.6.2] - 2026-08-25

### Added

- Add image annotations with source-linked targets in the JSON notes sidecar.
- Add archive, discard, and cancel handling for stale notes, including a
  user-selectable archive filename and bulk stale-note action.
- Define a normative Markdown compatibility profile with regression coverage
  for every CommonMark/GFM syntax family and the raw HTML exception.
- Add static GFM task items, one-tilde strikethrough, extended autolinks, and
  Setext heading chapter splits.

### Security

- Constrain workspace-provided custom CSS to the Markdown document's owning root.

### Changed

- Open the note editor after every highlight color choice.
- Re-anchor revised notes from their saved quote within the original chapter
  instead of reusing stale rendered columns.
- Rename the extension and package identity to **Markdown Ebook Review —
  Human–AI Writing** (`raxwade.markdown-ebook-review-human-ai-writing`) and
  describe its structured-note handoff for AI-assisted revision.
- Replace private manuscript references with synthetic fixtures.
- Add community health files, CI, dependency automation, release guidance, and
  third-party license notices.

### Fixed

- Keep wide Markdown tables inside phone-sized preview pages by using bounded
  columns and wrapping long cell content instead of letting Foliate crop it.

## [0.6.1] - 2026-08-16

### Added

- English-first runtime and VS Code localization with Traditional Chinese support.

## [0.6.0] - 2026-08-16

### Added

- Reader appearance controls, search, bookmarks, progress navigation, and
  persistent per-book reading state.

## [0.5.1] - 2026-08-07

### Fixed

- Note anchoring and navigation across Markdown syntax, tables, and chapter loads.

[Unreleased]: https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/compare/v0.6.3...HEAD
[0.6.3]: https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/releases/tag/v0.6.1
[0.6.0]: https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/releases/tag/v0.6.0
[0.5.1]: https://github.com/Raxwade/markdown-ebook-review-human-ai-writing/releases/tag/v0.5.1
