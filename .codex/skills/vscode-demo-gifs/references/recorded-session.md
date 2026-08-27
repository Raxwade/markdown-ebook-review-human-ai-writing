# Sanitized VS Code GIF recording session

This is the reusable command-level pattern behind the six current README GIFs.
It records the technique, not the original recording environment: it contains
no account name, home directory, WSL distribution name, manuscript, note, or
captured frame from the original session.

Read this reference only when recording or refreshing actual demo media. The
main [SKILL.md](../SKILL.md) defines the scope and non-negotiable safety rules.

## Privacy boundary

- Use only the checked-in sample or a newly written fictional fixture. Never
  copy a real manuscript, a real sidecar, a user profile, or an existing
  workspace into the recording directory.
- The helpers accept source, output, VSIX, settings, and open-file paths only
  under one temporary scratch root. This prevents accidental reads from a home
  directory or another workspace.
- The hidden profile is new and unsigned. Keep sync, telemetry, extension
  updates, and experiments off for the recording settings.
- The CDP endpoint is explicitly bound to `127.0.0.1`; the CDP helper rejects
  non-loopback endpoints, credentials, paths outside the scratch root, and
  non-input raw commands.
- `-ExecutionPolicy Bypass` below applies only to the launched PowerShell
  process. It does not change a system policy. Use it only for these reviewed,
  checked-in helpers; never point it at downloaded scripts.

## Prerequisites

- Run the shell commands from WSL in this repository.
- The recording host has Windows VS Code, `powershell.exe`, and WSL interop.
- WSL has `bun`, `curl`, `jq`, `ffmpeg`, `vsce`, and `wslpath`.
- The extension packages successfully. The recording installs that local VSIX
  into a new, isolated extensions directory only.

## 1. Create a clean scratch fixture and VSIX

The session always begins with a new temporary root and a public test fixture.
Do not substitute a private manuscript or sidecar.

```bash
repo_root="$(git rev-parse --show-toplevel)"
skill_root="$repo_root/.codex/skills/vscode-demo-gifs"
demo_root="$(mktemp -d /tmp/mdepub-hidden-demo.XXXXXX)"
export MDEPUB_DEMO_ROOT="$demo_root"

cp "$repo_root/test/fixtures/sample.md" "$demo_root/manuscript.md"

# Prevent account/sync/telemetry state from appearing in captured UI or leaving
# the isolated profile. These settings affect only the temporary user-data dir.
printf '%s\n' '{"mdepub.preview.followEditor":false,"telemetry.telemetryLevel":"off","workbench.enableExperiments":false,"extensions.autoUpdate":false,"extensions.autoCheckUpdates":false}' >"$demo_root/settings.json"

# `npm run package` invokes vsce and its prepublish bundle. --out keeps the
# generated VSIX outside the repository.
npm run package -- --out "$demo_root/mdepub-demo.vsix"
unzip -l "$demo_root/mdepub-demo.vsix" | rg 'readme.md|images/demos/'
```

For a notes-to-JSON demo, create an illustrative note in this temporary
manuscript with the real extension. Open the generated sidecar only after it
exists; never copy a real `.notes.json` file into the scratch root.

Resolve the installation paths from Windows environment variables instead of
embedding a Windows account name in the runbook. If these candidates do not
exist, pass a locally verified VS Code installation path at execution time; do
not write that machine-specific path back into the skill.

```bash
win_demo_root="$(wslpath -w "$demo_root")"
win_skill_root="$(wslpath -w "$skill_root")"
code_exe="$(powershell.exe -NoProfile -Command '[System.IO.Path]::Combine($env:LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe")' | tr -d '\r')"
code_cli="$(powershell.exe -NoProfile -Command '[System.IO.Path]::Combine($env:LOCALAPPDATA, "Programs", "Microsoft VS Code", "bin", "code.cmd")' | tr -d '\r')"

# This port is short-lived and bound to 127.0.0.1 by the host script. Choose a
# different value if it is already in use; never bind or forward it publicly.
remote_debug_port=$((30000 + RANDOM % 10000))
```

## 2. Launch the isolated workbench on a hidden desktop

In a Codex task, invoke this through `tools.exec_command` with
`sandbox_permissions: "require_escalated"`: it starts a Windows GUI process,
but the helper places it on a hidden Win32 desktop and never switches desktop
or sets foreground focus.

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$win_skill_root\scripts\hidden-vscode-desktop.ps1" \
  -Mode Launch \
  -CodeExe "$code_exe" \
  -CodeCli "$code_cli" \
  -ScratchRoot "$win_demo_root" \
  -WorkspacePath "$win_demo_root" \
  -VsixPath "$win_demo_root\mdepub-demo.vsix" \
  -SettingsPath "$win_demo_root\settings.json" \
  -OpenPath "$win_demo_root\manuscript.md" \
  -RemoteDebuggingPort "$remote_debug_port"
```

The helper's concrete safety controls are:

1. It creates `WinSta0\MdepubRecordingDesktop` but never calls
   `SwitchDesktop`.
2. It creates fresh `user-data` and `extensions` directories under a marked
   temporary profile; no user profile is read or reused.
3. It installs only the locally built VSIX into that isolated extensions
   directory.
4. It starts `Code.exe` with `--remote-debugging-address=127.0.0.1`, a
   short-lived port, no workspace-trust bypass, and no recent-workspace entry.
5. It uses WMI predicates to identify only processes bearing the isolated
   marker. It never reads unrelated Code or PowerShell command lines.

Prove isolation before interacting with the workbench. These commands emit
only recording PIDs, visibility, and dimensions—never window titles or paths.

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$win_skill_root\scripts\hidden-vscode-desktop.ps1" -Mode List

powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$win_skill_root\scripts\hidden-vscode-desktop.ps1" \
  -Mode VerifyCurrentDesktop
```

`List` should show a `MdepubRecordingDesktop` window. `VerifyCurrentDesktop`
must print `NO_ISOLATED_WINDOWS_ON_CURRENT_DESKTOP`. Treat any other outcome
as a safety failure: run the close step, do not retry on the visible desktop.

## 3. Connect to the hidden workbench without changing OS focus

The session uses CDP only against the loopback workbench page. The helper
refuses remote hosts and keeps file reads/writes under `MDEPUB_DEMO_ROOT`.

```bash
target_json="$(curl -fsS "http://127.0.0.1:${remote_debug_port}/json/list")"
ws_url="$(printf '%s' "$target_json" | jq -r \
  '.[] | select(.type == "page") | .webSocketDebuggerUrl' | head -n 1)"
test -n "$ws_url" && test "$ws_url" != null

# Only query a known-safe UI value. Do not evaluate source text, account state,
# settings, or file paths and print them to a terminal/log.
bun "$skill_root/scripts/cdp.mjs" "$ws_url" eval 'document.title'

# Capture a real workbench frame directly into the temporary root.
bun "$skill_root/scripts/cdp.mjs" "$ws_url" screenshot \
  "$demo_root/preview-open.png"
```

The CDP helper preserves the session's useful operations while narrowing raw
access to input events:

```bash
# Insert only a prepared scratch file into the focused editor.
bun "$skill_root/scripts/cdp.mjs" "$ws_url" insert-file \
  "$demo_root/updated-manuscript.txt"

# Evaluate in a known execution context when the isolated workbench requires it.
bun "$skill_root/scripts/cdp.mjs" "$ws_url" eval-context 7 'document.title'

# The only raw-style interface is allowlisted CDP input on the isolated target.
bun "$skill_root/scripts/cdp.mjs" "$ws_url" input Input.dispatchKeyEvent \
  '{"type":"keyDown","windowsVirtualKeyCode":13,"nativeVirtualKeyCode":13}'
```

Use real reader controls and a real edit to the temporary fixture. Wait for the
renderer to settle, then capture meaningful before/after states. Do not add a
slow synthetic pointer path or reveal the operating system outside the hidden
workbench frame.

## 4. Keyframe plan for the six current GIFs

Capture PNG keyframes below `$demo_root` with the following names. The provided
renderer uses exactly this map.

| GIF | Ordered PNG keyframes | Real isolated-workbench action |
|---|---|---|
| `live-preview.gif` | `preview-open.png`, `live-after-real-edit.png` | Edit the temporary Markdown; wait for its live EPUB rebuild. |
| `device-preview.gif` | `preview-open.png`, `device-ipad.png`, `device-ipad-landscape.png` | Choose an iPad-like preset, then rotate it. |
| `appearance.gif` | `preview-open.png`, `appearance-open.png`, `appearance-sepia.png`, `appearance-final.png` | Open appearance controls, choose a warm theme, then show the reader. |
| `search-bookmarks.gif` | `search-open.png`, `search-results.png`, `search-jump.png`, `bookmarks-open.png` | Search the fixture, jump to a result, then save/show a bookmark. |
| `notes.gif` | `preview-open.png`, `notes-open.png`, `notes-jump.png` | Create or reveal a fictional source-linked revision note. |
| `notes-json.gif` | `notes-to-json-notes.png`, `notes-to-json-json.png` | Show that fictional note, then the generated temporary sidecar. |

Use `Page.captureScreenshot` first. If it cannot capture the desired native
surface, `-Mode Capture` uses `PrintWindow` on the largest Code window in the
hidden desktop only. The output path remains constrained to the scratch root.

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$win_skill_root\scripts\hidden-vscode-desktop.ps1" \
  -Mode Capture \
  -ScratchRoot "$win_demo_root" \
  -CapturePath "$win_demo_root\notes-to-json-json.png"
```

## 5. Encode fast, inspect, then publish

The session builds deliberate short sequences from still keyframes instead of
recording a slow pointer. The helper holds the validated states, scales to
1080 px wide, uses 10 fps, and produces an indexed palette.

```bash
encoded_root="$demo_root/encoded"
bash "$skill_root/scripts/render-gifs.sh" \
  "$demo_root" "$encoded_root"

for gif in "$encoded_root"/*.gif; do
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,avg_frame_rate \
    -of default=noprint_wrappers=1 "$gif"
done
```

Visually inspect the first and final frame of every GIF before adding it to the
repository. Reject and recapture any frame that shows a person, account,
absolute path, private text, terminal output, browser UI, secret, or unexpected
desktop content. Only after that explicit inspection, opt in to replacement of
the tracked assets:

```bash
(
  cd "$repo_root"
  MDEPUB_REPLACE_DEMOS=1 bash "$skill_root/scripts/render-gifs.sh" \
    "$demo_root" images/demos
)
```

## 6. Close only the recording processes

The final command filters Windows process records by the isolated marker and
the checked-in helper host. It does not close arbitrary `Code.exe` windows.

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$win_skill_root\scripts\hidden-vscode-desktop.ps1" -Mode Close

powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$win_skill_root\scripts\hidden-vscode-desktop.ps1" -Mode List
```

The final `List` must return `NO_ISOLATED_WINDOWS`. Retain no raw captures,
temporary VSIX files, or temporary sidecars in the repository; commit only
inspected documentation assets and the intended source changes.
