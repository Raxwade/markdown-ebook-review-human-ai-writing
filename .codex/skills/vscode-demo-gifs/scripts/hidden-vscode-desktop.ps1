param(
    [ValidateSet('Launch', 'List', 'Capture', 'Close', 'VerifyCurrentDesktop')]
    [string]$Mode = 'List',
    [string]$CodeExe,
    [string]$CodeCli,
    [string]$WorkspacePath,
    [string]$VsixPath,
    [string]$SettingsPath,
    [string]$ScratchRoot,
    [string[]]$OpenPath = @(),
    [string]$CapturePath,
    [ValidateRange(1024, 65535)]
    [int]$RemoteDebuggingPort = 9222,
    [string]$ProfileRoot = (Join-Path (Join-Path $env:LOCALAPPDATA 'Temp') ('mdepub-vscode-hidden-recording-' + [Guid]::NewGuid().ToString('N')))
)

$ErrorActionPreference = 'Stop'
$processMarker = 'mdepub-vscode-hidden-recording'
$desktopName = 'MdepubRecordingDesktop'
$hostScript = Join-Path $PSScriptRoot 'hidden-vscode-host.ps1'

if ($ProfileRoot -notlike "*$processMarker*") {
    throw "ProfileRoot must retain the isolated-process marker '$processMarker'."
}
$profileTempRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Temp')).TrimEnd([char[]]@('\', '/'))
$profileRootPath = [System.IO.Path]::GetFullPath($ProfileRoot)
if (-not $profileRootPath.StartsWith($profileTempRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'ProfileRoot must remain below the local temporary directory.'
}

try {
Add-Type -ErrorAction Stop -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class MdepubHiddenDesktop {
    private const uint DESKTOP_READOBJECTS = 0x0001;
    private const uint DESKTOP_CREATEWINDOW = 0x0002;
    private const uint DESKTOP_ENUMERATE = 0x0040;
    private const uint DESKTOP_WRITEOBJECTS = 0x0080;
    private const uint DESKTOP_ACCESS = DESKTOP_READOBJECTS | DESKTOP_CREATEWINDOW | DESKTOP_ENUMERATE | DESKTOP_WRITEOBJECTS;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public sealed class WindowInfo {
        public IntPtr Handle { get; set; }
        public uint ProcessId { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public bool Visible { get; set; }
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktop(string lpszDesktop, IntPtr lpszDevice, IntPtr pDevmode, int dwFlags, uint dwDesiredAccess, IntPtr lpsa);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    private static IntPtr GetDesktop(bool create) {
        IntPtr desktop = OpenDesktop("MdepubRecordingDesktop", 0, false,
            DESKTOP_ACCESS);
        if (desktop == IntPtr.Zero && create) {
            desktop = CreateDesktop("MdepubRecordingDesktop", IntPtr.Zero, IntPtr.Zero, 0, DESKTOP_ACCESS, IntPtr.Zero);
        }
        if (desktop == IntPtr.Zero && create) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        return desktop;
    }

    private static WindowInfo ReadWindow(IntPtr hWnd) {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        RECT rect;
        GetWindowRect(hWnd, out rect);
        return new WindowInfo {
            Handle = hWnd,
            ProcessId = pid,
            Width = Math.Max(0, rect.Right - rect.Left),
            Height = Math.Max(0, rect.Bottom - rect.Top),
            Visible = IsWindowVisible(hWnd)
        };
    }

    public static uint Launch(string applicationName, string commandLine, string currentDirectory) {
        IntPtr desktop = GetDesktop(true);
        try {
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.lpDesktop = "WinSta0\\MdepubRecordingDesktop";
            PROCESS_INFORMATION process;
            StringBuilder command = new StringBuilder(commandLine);
            if (!CreateProcess(applicationName, command, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero,
                    currentDirectory, ref startup, out process)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            Thread.Sleep(3000);
            return process.dwProcessId;
        } finally {
            CloseDesktop(desktop);
        }
    }

    public static WindowInfo[] ListHiddenDesktopWindows() {
        IntPtr desktop = GetDesktop(false);
        if (desktop == IntPtr.Zero) return new WindowInfo[0];
        try {
            List<WindowInfo> windows = new List<WindowInfo>();
            EnumWindowsProc callback = delegate(IntPtr hWnd, IntPtr lParam) {
                windows.Add(ReadWindow(hWnd));
                return true;
            };
            if (!EnumDesktopWindows(desktop, callback, IntPtr.Zero)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            return windows.ToArray();
        } finally {
            CloseDesktop(desktop);
        }
    }

    public static WindowInfo[] ListCurrentDesktopWindows(uint[] allowedProcessIds) {
        List<WindowInfo> windows = new List<WindowInfo>();
        HashSet<uint> allowed = new HashSet<uint>(allowedProcessIds ?? new uint[0]);
        EnumWindowsProc callback = delegate(IntPtr hWnd, IntPtr lParam) {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (!allowed.Contains(pid)) return true;
            windows.Add(ReadWindow(hWnd));
            return true;
        };
        if (!EnumWindows(callback, IntPtr.Zero)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        return windows.ToArray();
    }

    public static void Capture(IntPtr hWnd, string path) {
        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        int width = Math.Max(1, rect.Right - rect.Left);
        int height = Math.Max(1, rect.Bottom - rect.Top);
        using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        using (Graphics graphics = Graphics.FromImage(bitmap)) {
            IntPtr hdc = graphics.GetHdc();
            bool printed;
            try {
                // PW_RENDERFULLCONTENT captures only the supplied hidden window.
                printed = PrintWindow(hWnd, hdc, 2);
            } finally {
                graphics.ReleaseHdc(hdc);
            }
            if (!printed) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            string directory = Path.GetDirectoryName(path);
            if (!String.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            bitmap.Save(path, ImageFormat.Png);
        }
    }
}
'@
} catch {
    throw 'Could not initialize the isolated desktop helper.'
}

function Get-IsolatedCodeProcesses {
    # Filter in WMI so unrelated Code command lines are never read into memory.
    @(Get-CimInstance Win32_Process -Filter "Name = 'Code.exe' AND CommandLine LIKE '%mdepub-vscode-hidden-recording%'")
}

function Get-IsolatedHostProcesses {
    # The same narrow filter prevents inspecting other PowerShell sessions.
    @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' AND CommandLine LIKE '%mdepub-vscode-hidden-recording%' AND CommandLine LIKE '%hidden-vscode-host.ps1%'")
}

function Quote-Argument([string]$value) {
    '"' + ($value -replace '"', '\\"') + '"'
}

function Assert-PathInsideScratch([string]$Path, [string]$Label, [switch]$AllowMissing) {
    if ([string]::IsNullOrWhiteSpace($ScratchRoot) -or -not (Test-Path -LiteralPath $ScratchRoot -PathType Container)) {
        throw 'ScratchRoot must be an existing temporary recording directory.'
    }
    if (-not (Test-Path -LiteralPath $Path) -and -not $AllowMissing) {
        throw "$Label must exist."
    }
    $scratchRootPath = (Resolve-Path -LiteralPath $ScratchRoot).Path.TrimEnd([char[]]@('\', '/'))
    $scratchPrefix = $scratchRootPath + '\'
    $resolvedPath = if (Test-Path -LiteralPath $Path) {
        (Resolve-Path -LiteralPath $Path).Path
    } else {
        $parent = Split-Path -LiteralPath $Path -Parent
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            throw "$Label must have an existing parent directory inside ScratchRoot."
        }
        [System.IO.Path]::GetFullPath($Path)
    }
    if (-not ($resolvedPath.Equals($scratchRootPath, [System.StringComparison]::OrdinalIgnoreCase) -or
        $resolvedPath.StartsWith($scratchPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
        throw "$Label must be inside ScratchRoot."
    }
}

function Assert-TemporaryScratchRoot {
    if ([string]::IsNullOrWhiteSpace($ScratchRoot) -or -not (Test-Path -LiteralPath $ScratchRoot -PathType Container)) {
        throw 'ScratchRoot must be an existing temporary recording directory.'
    }
    $scratchRootPath = [System.IO.Path]::GetFullPath($ScratchRoot)
    if ($scratchRootPath.StartsWith($profileTempRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return
    }
    $wslScratchPath = $ScratchRoot -replace '/', '\'
    if ($wslScratchPath -match '^(\\\\wsl(?:\.localhost|\$)\\[^\\]+\\tmp\\)') {
        return
    }
    throw 'ScratchRoot must be below the local temporary directory or WSL /tmp.'
}

if ($Mode -eq 'Close') {
    $processes = Get-IsolatedCodeProcesses
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output "CLOSED_ISOLATED_CODE_PID=$($process.ProcessId)"
    }
    foreach ($hostProcess in Get-IsolatedHostProcesses) {
        Stop-Process -Id $hostProcess.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output "CLOSED_ISOLATED_HOST_PID=$($hostProcess.ProcessId)"
    }
    if ($processes.Count -eq 0) {
        Write-Output 'NO_ISOLATED_CODE_PROCESS'
    }
    exit 0
}

if ($Mode -eq 'Launch') {
    foreach ($name in 'CodeExe', 'CodeCli', 'WorkspacePath', 'VsixPath', 'ScratchRoot') {
        if ([string]::IsNullOrWhiteSpace((Get-Variable -Name $name -ValueOnly))) {
            throw "$name is required for Launch."
        }
    }
    foreach ($path in $CodeExe, $CodeCli, $hostScript) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw 'A required recording executable or helper does not exist.'
        }
    }
    Assert-TemporaryScratchRoot
    Assert-PathInsideScratch $WorkspacePath 'WorkspacePath'
    Assert-PathInsideScratch $VsixPath 'VsixPath'
    if ($SettingsPath) {
        Assert-PathInsideScratch $SettingsPath 'SettingsPath'
    }
    foreach ($path in $OpenPath) {
        Assert-PathInsideScratch $path 'Each OpenPath value'
    }

    foreach ($process in Get-IsolatedCodeProcesses) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    foreach ($hostProcess in Get-IsolatedHostProcesses) {
        Stop-Process -Id $hostProcess.ProcessId -Force -ErrorAction SilentlyContinue
    }

    $userData = Join-Path $ProfileRoot 'user-data'
    $extensions = Join-Path $ProfileRoot 'extensions'
    New-Item -ItemType Directory -Force -Path (Join-Path $userData 'User'), $extensions | Out-Null
    if ($SettingsPath) {
        Copy-Item -LiteralPath $SettingsPath -Destination (Join-Path $userData 'User\settings.json') -Force
    }

    # This CLI call only installs into the isolated extensions directory.
    & $CodeCli '--user-data-dir' $userData '--extensions-dir' $extensions '--install-extension' $VsixPath '--force'
    if ($LASTEXITCODE -ne 0) {
        throw "VS Code CLI extension installation failed with exit code $LASTEXITCODE."
    }

    $powershellExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
    $hostArguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $hostScript,
        '-CodeExe', $CodeExe,
        '-UserDataDir', $userData,
        '-ExtensionsDir', $extensions,
        '-ScratchRoot', $ScratchRoot,
        '-WorkspacePath', $WorkspacePath,
        '-RemoteDebuggingPort', $RemoteDebuggingPort
    )
    if ($OpenPath.Count -gt 0) {
        $hostArguments += '-OpenPath'
        $hostArguments += $OpenPath
    }
    $commandLine = (Quote-Argument $powershellExe) + ' ' + (($hostArguments | ForEach-Object { Quote-Argument $_ }) -join ' ')
    $launchedHostPid = [MdepubHiddenDesktop]::Launch($powershellExe, $commandLine, $WorkspacePath)
    Write-Output "LAUNCHED_ISOLATED_HOST_PID=$launchedHostPid DESKTOP=$desktopName"
    exit 0
}

$isolatedPids = @(Get-IsolatedCodeProcesses | ForEach-Object { [uint32]$_.ProcessId })
if ($Mode -eq 'VerifyCurrentDesktop') {
    $visibleOnCurrentDesktop = @([MdepubHiddenDesktop]::ListCurrentDesktopWindows([uint32[]]$isolatedPids))
    if ($visibleOnCurrentDesktop.Count -eq 0) {
        Write-Output 'NO_ISOLATED_WINDOWS_ON_CURRENT_DESKTOP'
        exit 0
    }
    foreach ($window in $visibleOnCurrentDesktop) {
        Write-Output ("UNSAFE_CURRENT_DESKTOP_WINDOW PID={0} HANDLE=0x{1:X} VISIBLE={2}" -f $window.ProcessId, $window.Handle.ToInt64(), $window.Visible)
    }
    throw 'An isolated recording window appeared on the current desktop. Close it before continuing.'
}

$windows = @([MdepubHiddenDesktop]::ListHiddenDesktopWindows() |
    Where-Object { $_.ProcessId -in $isolatedPids })

if ($Mode -eq 'List') {
    if ($windows.Count -eq 0) {
        Write-Output 'NO_ISOLATED_WINDOWS'
    } else {
        foreach ($window in $windows) {
            Write-Output ("WINDOW DESKTOP={0} PID={1} HANDLE=0x{2:X} VISIBLE={3} SIZE={4}x{5}" -f $desktopName, $window.ProcessId, $window.Handle.ToInt64(), $window.Visible, $window.Width, $window.Height)
        }
    }
    exit 0
}

if ($windows.Count -eq 0) {
    throw 'No isolated VS Code window is available to capture.'
}
if ([string]::IsNullOrWhiteSpace($CapturePath)) {
    throw 'CapturePath is required for Capture.'
}
Assert-TemporaryScratchRoot
Assert-PathInsideScratch $CapturePath 'CapturePath' -AllowMissing

$windowToCapture = $windows |
    Sort-Object -Property @{ Expression = { $_.Width * $_.Height }; Descending = $true } |
    Select-Object -First 1
[MdepubHiddenDesktop]::Capture($windowToCapture.Handle, $CapturePath)
Write-Output "CAPTURED_HANDLE=0x{0:X}" -f $windowToCapture.Handle.ToInt64()
