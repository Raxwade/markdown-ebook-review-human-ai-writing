---
name: vscode-demo-gifs
description: Record, refresh, or review real VS Code screenshots and GIF demos for this extension's README or Marketplace media. Use for `images/demos/` assets, not generic product illustration.
metadata:
  short-description: Safely record real VS Code demos
---

# Real VS Code demo media

Create concise, trustworthy documentation media for Markdown Ebook Review —
Human–AI Writing. Final media must show the shipped extension in a real VS Code
workbench, rather than a browser harness or a mock UI.

For a command-level replay of the session that created the current six GIFs,
read [the recorded-session runbook](references/recorded-session.md) before
launching VS Code. It links to the reusable helpers instead of asking an agent
to recreate the hidden-desktop setup from memory.

## Scope

- Final README assets live in `images/demos/`; keep their descriptions and
  references in `README.md` aligned.
- Use `images/human-ai-workflow.png` for the high-level handoff diagram. Do not
  recreate it unless the requested product workflow changes.
- Keep the README product-focused. Do not reintroduce internal development,
  CI, deployment, or project-policy detail just to explain a demo.

## Protect the user's desktop

The user may be working on another Windows desktop while recording happens.
Treat their existing VS Code windows as off limits.

- Never open, foreground, move, or operate a normal VS Code window to record
  media. Use an isolated test profile on a hidden Win32 desktop. If that cannot
  be established, stop and explain the blocker instead of falling back to a
  visible window.
- Give the test process a distinctive `--user-data-dir` / `--extensions-dir`
  marker. When cleaning up, locate processes by that marker and close only
  those processes. Never close arbitrary `Code.exe` processes.
- Do not use `CopyFromScreen`, `SetForegroundWindow`, `ShowWindow`, `SendKeys`,
  or UI Automation actions against a visible desktop. Capture with DevTools
  `Page.captureScreenshot` or `PrintWindow` on the isolated target only.
- Put scratch manuscripts, raw captures, and temporary VSIX files under `/tmp`.
  Do not add them to the repository. Close every isolated Code process once
  recording and inspection finish.

## Privacy and network preflight

- Start from the checked-in test fixture or a fictional scratch manuscript.
  Never open a real manuscript, a personal workspace, browser tab, terminal,
  account, or sidecar containing private revision notes in a public demo.
- The isolated profile must remain signed out and unsynced. Do not copy the
  user's VS Code profile, settings, extensions, recents, or account state.
- Keep every input, capture, and output beneath one temporary scratch root.
  Before moving a GIF into `images/demos/`, inspect its first and final frames
  for names, absolute paths, email addresses, secrets, and account indicators.
- CDP is permitted only on a loopback endpoint owned by the isolated workbench.
  Bind it to `127.0.0.1`, do not expose or relay its port, and close the
  workbench immediately after capture. CDP evaluation and input remain
  privileged operations even on loopback.

## Proven helpers

The following helpers are the parameterized versions of the scripts used for
the README recording session:

- `scripts/hidden-vscode-desktop.ps1` creates and operates the hidden Win32
  desktop, installs the VSIX into a marked profile, and can safely list,
  capture, and close only that profile's Code processes.
- `scripts/hidden-vscode-host.ps1` is the child launcher that inherits the
  hidden desktop and starts the actual VS Code workbench with CDP enabled.
- `scripts/cdp.mjs` sends one Chrome DevTools Protocol request at a time; it
  accepts only loopback targets and supports evaluation, text insertion,
  allowlisted input commands, and screenshots inside the scratch root.
- `scripts/render-gifs.sh` encodes the six standard README stories from named
  PNG keyframes using the exact fast, 10 fps palette workflow.

Use the runbook's commands as a starting point. They deliberately use
parameters and `wslpath -w` instead of the recorder's machine-specific paths.

## Record genuine extension behaviour

1. Package the current extension into a temporary VSIX and install it only in
   the isolated extension directory.
2. Launch real VS Code on the hidden desktop with its remote-debugging endpoint
   enabled. Use its test driver or Chrome DevTools Protocol to operate the
   hidden workbench without changing OS focus.
3. Open a representative scratch Markdown manuscript and, for note demos,
   generate its `<book>.md.notes.json` sidecar in that scratch directory. Use
   real reader controls and actual source edits; do not substitute a browser
   fixture for user-facing media.
4. Let the UI settle before each capture. A dark, readable VS Code side drawer
   is expected. A black/unreadable drawer in a bare browser harness is not
   evidence of an extension styling bug.

For a note-to-AI handoff demo, show both the Notes drawer and the corresponding
sidecar open as JSON in VS Code. The visible sidecar should make the source
range, quote, and revision instruction easy to identify.

## Asset expectations

Use only the files relevant to the requested change. Existing asset names map
to these user-visible stories:

| Asset | Story |
|---|---|
| `live-preview.gif` | A real Markdown edit rebuilds the EPUB while the reader stays at its location. |
| `device-preview.gif` | Device preset and orientation affect the real reader viewport. |
| `appearance.gif` | Reader appearance controls update the existing renderer. |
| `search-bookmarks.gif` | Whole-book search jumps to a result and a bookmark is saved. |
| `notes.gif` | A source-linked quote and revision instruction appear in Notes. |
| `notes-json.gif` | A reader note maps to its portable `.md.notes.json` handoff. |

## Motion and export

- Prefer 2–3 second sequences of purposeful keyframes. Use roughly 10 fps and
  brief holds; avoid a slow synthetic mouse cursor.
- Keep all frames in one GIF at the same dimensions. For README readability,
  export around 1080 px wide and inspect a representative late frame as well as
  the first frame.
- Use an indexed palette when encoding with `ffmpeg` to keep media small. A
  typical filter is `concat`, `scale`, `fps`, `palettegen`, then `paletteuse`.
- Verify the GIF actually shows the intended final state, not a loading panel,
  stale overlay, or search picker.

## Finish cleanly

- Update concise README captions and verify every referenced asset exists.
- Run `git diff --check`, `npm test`, and package a temporary VSIX when README
  media changes. Inspect the package contents for the updated README and GIFs.
- Installing or reloading the user's real extension is a separate action; do
  it only when the user explicitly asks.
- If the recording uncovers a reader or webview defect that requires code
  changes, read [`docs/architecture.md`](../../../docs/architecture.md) before
  modifying that behaviour.
