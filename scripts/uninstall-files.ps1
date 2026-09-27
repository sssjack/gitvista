param([Parameter(Mandatory = $true)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'storage-utils.ps1')
try {
    $directory = Get-GitVistaChildPath (Split-Path -Parent ([IO.Path]::GetFullPath($InstallDirectory))) $InstallDirectory
    $record = Get-GitVistaInstallManifest $directory
    # Validate every path and hash before deleting anything. User additions never enter this list.
    $owned = @(); $emptyCandidates = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $record.files) {
        $target = Get-GitVistaChildPath $directory (Join-Path $directory $entry.path)
        if (-not (Test-Path -LiteralPath $target)) { continue }
        if ((Get-GitVistaFileSha256 $target) -ne $entry.sha256) { throw "程序文件被修改，已保留：$($entry.path)" }
        $owned += $target
        $parent = Split-Path -Parent $target
        while ($parent -ne $directory) { [void]$emptyCandidates.Add($parent); $parent = Split-Path -Parent $parent }
    }
    foreach ($target in $owned) { Remove-Item -LiteralPath (Get-GitVistaChildPath $directory $target) -Force }
    Remove-Item -LiteralPath (Get-GitVistaChildPath $directory (Join-Path $directory '.gitvista-installation.json')) -Force
    foreach ($parent in @($emptyCandidates | Sort-Object Length -Descending)) {
        $parent = Get-GitVistaChildPath $directory $parent
        if ((Test-Path -LiteralPath $parent) -and @(Get-ChildItem -LiteralPath $parent -Force).Count -eq 0) { Remove-Item -LiteralPath $parent -Force }
    }
    exit 0
} catch { Write-Error $_ -ErrorAction Continue; exit 2 }
