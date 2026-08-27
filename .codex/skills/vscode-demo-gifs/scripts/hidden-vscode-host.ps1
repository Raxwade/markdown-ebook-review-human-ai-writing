param(
    [Parameter(Mandatory = $true)]
    [string]$CodeExe,
    [Parameter(Mandatory = $true)]
    [string]$UserDataDir,
    [Parameter(Mandatory = $true)]
    [string]$ExtensionsDir,
    [Parameter(Mandatory = $true)]
    [string]$ScratchRoot,
    [Parameter(Mandatory = $true)]
    [string]$WorkspacePath,
    [string[]]$OpenPath = @(),
    [ValidateRange(1024, 65535)]
    [int]$RemoteDebuggingPort = 9222
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ScratchRoot -PathType Container)) {
    throw 'The temporary recording root must exist.'
}
$resolvedScratchRoot = (Resolve-Path -LiteralPath $ScratchRoot).Path.TrimEnd([char[]]@('\', '/'))
$scratchPrefix = $resolvedScratchRoot + '\'

function Assert-PathInsideScratch([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label must exist."
    }
    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    if (-not ($resolvedPath.Equals($script:resolvedScratchRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $resolvedPath.StartsWith($script:scratchPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
        throw "$Label must be inside the temporary recording root."
    }
}

foreach ($path in $CodeExe, $UserDataDir, $ExtensionsDir) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw 'A required isolated-workbench path does not exist.'
    }
}
Assert-PathInsideScratch $WorkspacePath 'The workspace path'
foreach ($path in $OpenPath) {
    Assert-PathInsideScratch $path 'Each file opened in the workbench'
}

$arguments = @(
    '--user-data-dir', $UserDataDir,
    '--extensions-dir', $ExtensionsDir,
    '--new-window',
    '--force-renderer-accessibility',
    '--remote-debugging-address=127.0.0.1',
    "--remote-debugging-port=$RemoteDebuggingPort",
    '--skip-add-to-recently-opened',
    '--skip-welcome',
    '--skip-release-notes',
    $WorkspacePath
)
$arguments += $OpenPath

# This host was created on MdepubRecordingDesktop. The workbench inherits that
# desktop without any foreground, current-desktop, or workspace-trust bypass.
$code = Start-Process -FilePath $CodeExe -ArgumentList $arguments -PassThru
while (-not $code.HasExited) {
    Start-Sleep -Seconds 3
}
