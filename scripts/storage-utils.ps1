# Shared path checks for installation and generated-file cleanup. Never follow links.
# Bind built-in modules to the current engine when npm/NSIS inherits PowerShell 7 paths.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    $nativeModules = [IO.Path]::Combine($PSHOME, 'Modules')
    $env:PSModulePath = $nativeModules + [IO.Path]::PathSeparator + $env:PSModulePath
    Import-Module ([IO.Path]::Combine($nativeModules, 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
    Import-Module ([IO.Path]::Combine($nativeModules, 'Microsoft.PowerShell.Management', 'Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
}

function Get-GitVistaFileSha256 {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $digest = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($digest.ComputeHash($stream)).Replace('-', '') }
    finally { $digest.Dispose(); $stream.Dispose() }
}

function Get-GitVistaChildPath {
    param([string]$Root, [string]$Candidate)
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $target = [IO.Path]::GetFullPath($Candidate).TrimEnd('\', '/')
    if (-not $target.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "路径不在允许的目录内：$target"
    }
    $ancestor = $target
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "跳过链接或目录联接：$ancestor" }
        }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
    return $target
}

function Get-GitVistaTreeFiles {
    param([string]$Root, [string]$Candidate)
    $target = Get-GitVistaChildPath $Root $Candidate
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($target)
    while ($pending.Count -gt 0) {
        $item = Get-Item -LiteralPath $pending.Pop() -Force -ErrorAction Stop
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "目录内包含链接，保留整个目录：$($item.FullName)" }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop) { $pending.Push($child.FullName) }
        } else { $item }
    }
}

function Get-GitVistaRunningPaths {
    $paths = @()
    foreach ($process in @(Get-Process -Name GitVista -ErrorAction SilentlyContinue)) {
        try { $executable = $process.Path } catch { throw '无法确认正在运行的 GitVista 路径，暂不清理安装版本。' }
        if (-not $executable) { throw '无法确认正在运行的 GitVista 路径，暂不清理安装版本。' }
        $paths += [IO.Path]::GetFullPath($executable)
    }
    return $paths
}

function Test-GitVistaPathRunning {
    param([string]$Candidate, [string[]]$RunningPaths)
    $target = [IO.Path]::GetFullPath($Candidate).TrimEnd('\', '/')
    foreach ($running in $RunningPaths) {
        if ($running.Equals($target, [StringComparison]::OrdinalIgnoreCase) -or $running.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function Get-GitVistaExecutableVersion {
    param([string]$Executable)
    $info = (Get-Item -LiteralPath $Executable -ErrorAction Stop).VersionInfo
    if ($info.ProductName -ne 'GitVista' -or $info.FileVersion -notmatch '^(\d+\.\d+\.\d+)(?:\.0)?$') { throw "不是可识别的 GitVista 程序：$Executable" }
    return [version]$Matches[1]
}

function Compare-GitVistaVersion {
    param([string]$Left, [string]$Right)
    $pattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
    if ($Left -notmatch $pattern -or $Right -notmatch $pattern) { throw '版本号不是受支持的 SemVer 格式。' }
    $a = $Left.Split('-', 2); $b = $Right.Split('-', 2)
    $comparison = ([version]$a[0]).CompareTo([version]$b[0])
    if ($comparison -ne 0) { return $comparison }
    if ($a.Count -eq 1 -and $b.Count -eq 1) { return 0 }
    if ($a.Count -eq 1) { return 1 }
    if ($b.Count -eq 1) { return -1 }
    $aParts = $a[1].Split('.'); $bParts = $b[1].Split('.')
    for ($index = 0; $index -lt [Math]::Min($aParts.Count, $bParts.Count); $index++) {
        $x = $aParts[$index]; $y = $bParts[$index]
        if ($x -ceq $y) { continue }
        if ($x -match '^\d+$' -and $y -match '^\d+$') {
            if ($x.Length -ne $y.Length) { return $x.Length.CompareTo($y.Length) }
            return [string]::CompareOrdinal($x, $y)
        }
        if ($x -match '^\d+$') { return -1 }
        if ($y -match '^\d+$') { return 1 }
        return [string]::CompareOrdinal($x, $y)
    }
    return $aParts.Count.CompareTo($bParts.Count)
}

function Get-GitVistaInstallManifest {
    param([string]$Directory, [string]$ExpectedVersion)
    $marker = Get-GitVistaChildPath $Directory (Join-Path $Directory '.gitvista-installation.json')
    $record = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($record.owner -ne 'cn.gitvista.desktop' -or $record.schema -ne 1 -or ($ExpectedVersion -and $record.version -ne $ExpectedVersion)) { throw '安装文件清单的归属或版本不匹配。' }
    [void](Compare-GitVistaVersion $record.version $record.version)
    $paths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($record.files)) {
        if (-not $entry.path -or [IO.Path]::IsPathRooted($entry.path) -or $entry.path -match '(^|[\\/])\.\.([\\/]|$)' -or $entry.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw '安装文件清单包含无效条目。' }
        $target = Get-GitVistaChildPath $Directory (Join-Path $Directory $entry.path)
        if (-not $paths.Add($target)) { throw '安装文件清单包含重复路径。' }
    }
    if (@($record.files | Where-Object path -eq 'GitVista.exe').Count -ne 1 -or @($record.files | Where-Object { ($_.path -replace '/', '\') -eq 'resources\app.asar' }).Count -ne 1) { throw '安装文件清单不完整。' }
    return $record
}

function Test-GitVistaOwnedInstall {
    param([string]$Directory, [string]$Version)
    $record = Get-GitVistaInstallManifest $Directory $Version
    $owned = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $record.files) {
        $target = Get-GitVistaChildPath $Directory (Join-Path $Directory $entry.path)
        [void]$owned.Add($target)
        if ((Get-GitVistaFileSha256 $target) -ne $entry.sha256) { throw "程序文件已被修改，保留目录：$($entry.path)" }
    }
    [void]$owned.Add((Join-Path $Directory '.gitvista-installation.json'))
    foreach ($file in @(Get-GitVistaTreeFiles (Split-Path -Parent $Directory) $Directory)) {
        if (-not $owned.Contains($file.FullName)) { throw "包含非程序文件，保留目录以保护用户数据：$($file.FullName.Substring($Directory.TrimEnd('\', '/').Length + 1))" }
    }
    return $record
}

function Remove-GitVistaGeneratedPath {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([string]$Root, [string]$Candidate, [string]$Reason)
    try {
        $target = Get-GitVistaChildPath $Root $Candidate
        $files = @(Get-GitVistaTreeFiles $Root $target)
        $bytes = [long](($files | Measure-Object -Property Length -Sum).Sum)
        if ($PSCmdlet.ShouldProcess($target, $Reason)) {
            # Recheck the resolved absolute path immediately before recursive deletion.
            $target = Get-GitVistaChildPath $Root $target
            Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
            [pscustomobject]@{ Path = $target; Status = 'Removed'; Bytes = $bytes; Reason = $Reason }
        } else { [pscustomobject]@{ Path = $target; Status = 'Planned'; Bytes = $bytes; Reason = $Reason } }
    } catch {
        Write-Warning $_.Exception.Message
        [pscustomobject]@{ Path = $Candidate; Status = 'Skipped'; Bytes = 0; Reason = $_.Exception.Message }
    }
}
