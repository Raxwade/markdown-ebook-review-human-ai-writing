# Contributing

Thank you for helping improve Markdown Ebook Review — Human–AI Writing. Bug
reports, documentation, tests, translations, accessibility improvements, and
code changes are all useful contributions.

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For a substantial feature or architecture change, open an issue first and
  describe the user problem and proposed approach.
- Never include private manuscripts, real customer content, credentials, local
  settings, or identifying metadata in an issue, fixture, screenshot, or commit.
  Use small synthetic examples.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues using
  [SECURITY.md](SECURITY.md), not a public issue.

## Development setup

Prerequisites: Git, Node.js 20, npm, and VS Code 1.85 or newer.

```bash
git clone https://github.com/Raxwade/markdown-ebook-review-human-ai-writing.git
cd markdown-ebook-review-human-ai-writing
npm ci
npm test
```

Useful commands:

| Command | Purpose |
|---|---|
| `npm test` | Type-check and run the complete Node test suite. |
| `npm run bundle` | Rebuild the webview stage and extension bundles. |
| `npm run package` | Create a locally installable VSIX. |
| `npm run spike` | Start the browser-based reader harness. |

To run one test file, compile first and then run its emitted JavaScript:

```bash
npm run compile
node --test out/test/split.test.js
```

## Architecture rules

- `src/epub/` contains pure transformations. It must not import `vscode` or use
  the filesystem; asset bytes enter through callbacks.
- Preserve the EPUB ZIP invariants tested in `test/zip.test.ts`: `mimetype` is
  the first entry and is stored without compression.
- A preview rebuild must preserve the reader location and serialize overlapping
  opens.
- The webview frame cannot fetch its module graph in VS Code. Keep the stage
  bundled and injected, and preserve the CSP nonce.
- Keep English as the source and fallback interface language. Add or update the
  Traditional Chinese string whenever changing user-visible interface text.
- Read [docs/architecture.md](docs/architecture.md) before changing the rendering,
  iframe, annotation, or rebuild design; it records measured constraints.

## Tests and manual checks

Every pull request should:

1. Add or update a focused regression test when behavior changes.
2. Run `npm test`.
3. Run `npm run package` to prove a clean bundle can be created.
4. For webview, pagination, CSP, or annotation changes, install the VSIX in a
   real VS Code window and describe the manual result in the pull request.
5. Use a synthetic Markdown document and synthetic screenshots only.

The browser spike cannot reproduce VS Code's `srcdoc` and service-worker
boundary, so it does not replace the real VS Code check.

## Pull requests

- Keep each pull request focused and explain the user-visible effect.
- Link the relevant issue when one exists.
- Describe tests and manual checks; do not mark a check complete if it was not run.
- Update README, localization, architecture notes, and changelog when applicable.
- Do not commit `dist/`, `out/`, VSIX files, generated EPUBs, logs, note sidecars,
  or tool-specific local settings.

By contributing, you agree that your contribution is licensed under the project's
[ISC license](LICENSE).
