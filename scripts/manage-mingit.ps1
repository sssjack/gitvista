param([Parameter(Mandatory = $true)][string]$StagingDirectory, [switch]$Publish)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'storage-utils.ps1')
$project = Split-Path -Parent $PSScriptRoot
$vendorRoot = Get-GitVistaChildPath $project (Join-Path $project 'vendor')
$stage = Get-GitVistaChildPath $vendorRoot $StagingDirectory
if ((Split-Path -Leaf $stage) -notmatch '^\.mingit-[a-f0-9-]{36}$') { throw '未知下载目录。' }
if (-not (Test-Path -LiteralPath $stage)) { exit 0 }
$record = Get-Content -LiteralPath (Get-GitVistaChildPath $stage (Join-Path $stage '.gitvista-download.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
if ($record.owner -ne 'cn.gitvista.mingit' -or $record.schema -ne 1) { throw '缺少下载目录归属标记。' }
$previous = Get-GitVistaChildPath $stage (Join-Path $stage 'previous')
if (-not $Publish) {
    if (Test-Path -LiteralPath $previous) { throw '包含此前内置 Git，保留下载事务以便恢复。' }
    $result = Remove-GitVistaGeneratedPath $vendorRoot $stage '清理下载临时文件'
    if ($result.Status -ne 'Removed') { throw $result.Reason }
    exit 0
}
$target = Get-GitVistaChildPath $vendorRoot (Join-Path $vendorRoot 'mingit')
$expanded = Get-GitVistaChildPath $stage (Join-Path $stage 'expanded')
[void]@(Get-GitVistaTreeFiles $stage $expanded)
if (Test-Path -LiteralPath $target) { [void]@(Get-GitVistaTreeFiles $vendorRoot $target); Move-Item -LiteralPath $target -Destination $previous }
try { Move-Item -LiteralPath $expanded -Destination $target }
catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath (Get-GitVistaChildPath $stage $previous) -Destination $target }; throw }
$stamp = Get-GitVistaChildPath $vendorRoot (Join-Path $vendorRoot '.mingit-version')
Copy-Item -LiteralPath (Get-GitVistaChildPath $stage (Join-Path $stage '.mingit-version')) -Destination $stamp -Force
if (Test-Path -LiteralPath $previous) {
    $result = Remove-GitVistaGeneratedPath $stage $previous '清理已替换的内置 Git'
    if ($result.Status -ne 'Removed') { throw $result.Reason }
}
