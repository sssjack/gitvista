[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ProjectDirectory = '',
    [ValidateRange(1, 10)][int]$KeepPackages = 1,
    [ValidateRange(1, 10)][int]$KeepValidationRuns = 1,
    [ValidateRange(1, 168)][int]$MinimumAgeHours = 2,
    [ValidateRange(1, 365)][int]$ValidationMaxAgeDays = 14,
    [ValidateRange(1, 10240)][int]$ValidationBudgetMB = 512,
    [switch]$SkipValidation
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectDirectory) { $ProjectDirectory = Split-Path -Parent $PSScriptRoot }
. (Join-Path $PSScriptRoot 'storage-utils.ps1')
$projectRoot = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne 'gitvista') { throw '只能清理 GitVista 项目的构建产物。' }
$currentVersion = [string]$manifest.version
[void](Compare-GitVistaVersion $currentVersion $currentVersion)
$results = New-Object 'System.Collections.Generic.List[object]'
$releaseRoot = Get-GitVistaChildPath $projectRoot (Join-Path $projectRoot 'release')
if (Test-Path -LiteralPath $releaseRoot) {
    $packages = @(Get-ChildItem -LiteralPath $releaseRoot -File | ForEach-Object {
        if ($_.Name -match '^GitVista-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(Windows|Setup)-x64\.exe$') {
            $packageVersion = $Matches[1]; $packageKind = $Matches[2]; $packageFile = $_
            try {
                $candidate = Get-GitVistaChildPath $releaseRoot $packageFile.FullName
                if ((Get-GitVistaExecutableVersion $candidate) -ne [version]($packageVersion -replace '-.*$', '')) { throw '文件名与程序版本不一致。' }
                [pscustomobject]@{ File = $packageFile; Version = $packageVersion; Kind = $packageKind }
            } catch { $results.Add([pscustomobject]@{ Path = $packageFile.FullName; Status = 'Skipped'; Bytes = 0; Reason = $_.Exception.Message }) }
        }
    })
    [Array]::Sort($packages, [Comparison[object]]{ param($a, $b) -(Compare-GitVistaVersion $a.Version $b.Version) })
    $kept = @($packages | Group-Object Kind | ForEach-Object { $_.Group | Select-Object -First $KeepPackages | ForEach-Object { $_.File.FullName } })
    foreach ($package in $packages) {
        # Never remove a newer build or the package matching the current source.
        if ($package.File.FullName -in $kept -or (Compare-GitVistaVersion $package.Version $currentVersion) -ge 0) { continue }
        try {
            $target = Get-GitVistaChildPath $releaseRoot $package.File.FullName
            if ((Get-GitVistaExecutableVersion $target) -ne [version]($package.Version -replace '-.*$', '')) { throw "文件名与版本不一致，保留：$target" }
            if (Test-GitVistaPathRunning $target @(Get-GitVistaRunningPaths)) { throw "安装包正在运行，保留：$target" }
            $result = Remove-GitVistaGeneratedPath $releaseRoot $target '清理旧版本安装包或便携包' -WhatIf:$WhatIfPreference
            $results.Add($result)
            if ($result.Status -in @('Removed', 'Planned') -and (Test-Path -LiteralPath "$target.blockmap")) { $results.Add((Remove-GitVistaGeneratedPath $releaseRoot "$target.blockmap" '清理旧包对应的差量清单' -WhatIf:$WhatIfPreference)) }
        } catch { $results.Add([pscustomobject]@{ Path = $package.File.FullName; Status = 'Skipped'; Bytes = 0; Reason = $_.Exception.Message }) }
    }
    foreach ($directory in @(Get-ChildItem -LiteralPath $releaseRoot -Directory -Force)) {
        if ($directory.Name -notmatch '^\.build-[a-f0-9-]{36}$') { continue }
        try {
            $candidate = Get-GitVistaChildPath $releaseRoot $directory.FullName
            $record = Get-Content -LiteralPath (Get-GitVistaChildPath $candidate (Join-Path $candidate '.gitvista-build.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($record.owner -ne 'cn.gitvista.desktop' -or $record.schema -ne 1 -or [datetime]$record.created -gt (Get-Date).ToUniversalTime().AddHours(-$MinimumAgeHours)) { continue }
            if ((Get-Process -Id $record.pid -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $candidate '.previous-unpacked'))) { continue }
            $results.Add((Remove-GitVistaGeneratedPath $releaseRoot $candidate '回收已中断构建的临时文件' -WhatIf:$WhatIfPreference))
        } catch { $results.Add([pscustomobject]@{ Path = $directory.FullName; Status = 'Skipped'; Bytes = 0; Reason = $_.Exception.Message }) }
    }
}

$vendorRoot = Get-GitVistaChildPath $projectRoot (Join-Path $projectRoot 'vendor')
if (Test-Path -LiteralPath $vendorRoot) {
    foreach ($directory in @(Get-ChildItem -LiteralPath $vendorRoot -Directory -Force)) {
        if ($directory.Name -notmatch '^\.mingit-[a-f0-9-]{36}$') { continue }
        try {
            $candidate = Get-GitVistaChildPath $vendorRoot $directory.FullName
            $record = Get-Content -LiteralPath (Get-GitVistaChildPath $candidate (Join-Path $candidate '.gitvista-download.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($record.owner -ne 'cn.gitvista.mingit' -or $record.schema -ne 1 -or [datetime]$record.created -gt (Get-Date).ToUniversalTime().AddHours(-$MinimumAgeHours)) { continue }
            if ((Get-Process -Id $record.pid -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $candidate 'previous'))) { continue }
            $results.Add((Remove-GitVistaGeneratedPath $vendorRoot $candidate '回收已中断下载的临时文件' -WhatIf:$WhatIfPreference))
        } catch { $results.Add([pscustomobject]@{ Path = $directory.FullName; Status = 'Skipped'; Bytes = 0; Reason = $_.Exception.Message }) }
    }
}

$localRoot = Get-GitVistaChildPath $projectRoot (Join-Path $projectRoot '.local')
if (-not $SkipValidation -and (Test-Path -LiteralPath $localRoot)) {
    # Active test renderers may pass their profile via an environment variable.
    # Conservatively defer validation cleanup while a project Electron/test run exists.
    $activeValidation = $false
    try {
        $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe' OR Name = 'GitVista.exe' OR Name = 'node.exe'" -ErrorAction Stop)
        foreach ($process in $processes) {
            if (($process.Name -eq 'electron.exe' -and (!$process.ExecutablePath -or $process.ExecutablePath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase))) -or
                ($process.CommandLine -and ($process.CommandLine.IndexOf($localRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $process.CommandLine -match '(?:^|\s|[\\/])(?:tests|\.local)[\\/]'))) { $activeValidation = $true }
        }
    } catch { $activeValidation = $true; Write-Warning '无法检查测试进程，本次保留本地验证目录。' }
    if ($activeValidation) { Write-Warning '检测到验证进程，本次保留 .local，下一次构建或安装时重试。' }
    else {
        $cutoff = (Get-Date).ToUniversalTime().AddHours(-$MinimumAgeHours)
        # Only established generated-run names are eligible; scripts and unknown folders stay.
        $pattern = '^(?<group>log-docs|log-ui|portable-profile|settings-ui-profile|desktop\d*|mini\d+|columns\d+|compact\d+|workspace\d+(?:-docs|-final)?|push\d+|package-\d+-smoke|close-ui|ui-font-preferences|mini-stage-ui|mini-quick-ui|light-themes|commit-source(?:-ui)?|push-index-guard|native\d+|window-sync-ui|window-close|mini-stage-integration|mini-quick-commit-integration|preview\d+|packaged-auth|ws\d+-(?:depth|limit)|repack-validation)-(?<run>\d{13}|[A-Za-z0-9]{6})$'
        $runs = @(Get-ChildItem -LiteralPath $localRoot -Directory | ForEach-Object {
            if ($_.Name -match $pattern) { [pscustomobject]@{ Directory = $_; Group = ($Matches['group'] -replace '\d+', ''); Modified = $_.LastWriteTimeUtc } }
        })
        $managedRoot = Get-GitVistaChildPath $localRoot (Join-Path $localRoot 'runs')
        if (Test-Path -LiteralPath $managedRoot) {
            foreach ($directory in @(Get-ChildItem -LiteralPath $managedRoot -Directory -Force)) {
                try {
                    $candidate = Get-GitVistaChildPath $managedRoot $directory.FullName
                    $record = Get-Content -LiteralPath (Get-GitVistaChildPath $candidate (Join-Path $candidate '.gitvista-run.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
                    if ($record.owner -ne 'cn.gitvista.validation' -or $record.schema -ne 1 -or $record.group -notmatch '^[a-z0-9-]{1,60}$') { continue }
                    if (-not $record.completed -and (Get-Process -Id $record.pid -ErrorAction SilentlyContinue)) { continue }
                    $modified = if ($record.completed) { ([datetime]$record.completed).ToUniversalTime() } else { ([datetime]$record.created).ToUniversalTime() }
                    $runs += [pscustomobject]@{ Directory = $directory; Group = $record.group; Modified = $modified }
                } catch { Write-Warning "保留未知或链接验证目录 $($directory.Name)：$($_.Exception.Message)" }
            }
        }
        $scheduledRuns = @()
        foreach ($group in @($runs | Group-Object Group)) {
            $ordered = @($group.Group | Sort-Object Modified -Descending)
            for ($index = $KeepValidationRuns; $index -lt $ordered.Count; $index++) {
                $run = $ordered[$index]
                if ($run.Modified -gt $cutoff) { continue }
                $scheduledRuns += $run.Directory.FullName
                $results.Add((Remove-GitVistaGeneratedPath $localRoot $run.Directory.FullName '清理旧验证运行，保留最近记录' -WhatIf:$WhatIfPreference))
            }
        }
        # Age and total byte budgets also bound one-off groups. Recent/active runs remain protected.
        $retainedBytes = [long]0
        foreach ($run in @($runs | Where-Object { $_.Directory.FullName -notin $scheduledRuns } | Sort-Object Modified -Descending)) {
            try {
                $bytes = [long]((@(Get-GitVistaTreeFiles $localRoot $run.Directory.FullName) | Measure-Object Length -Sum).Sum)
                $overBudget = $retainedBytes + $bytes -gt $ValidationBudgetMB * 1MB
                $expired = $run.Modified -lt (Get-Date).ToUniversalTime().AddDays(-$ValidationMaxAgeDays)
                if ($run.Modified -le $cutoff -and ($overBudget -or $expired)) {
                    $result = Remove-GitVistaGeneratedPath $localRoot $run.Directory.FullName '执行验证产物年龄和容量预算' -WhatIf:$WhatIfPreference
                    $results.Add($result)
                    if ($result.Status -in @('Removed', 'Planned')) { $scheduledRuns += $run.Directory.FullName; continue }
                }
                $retainedBytes += $bytes
            } catch { Write-Warning $_.Exception.Message }
        }
        # Retained runs keep settings, reports, screenshots and fixtures; shader/HTTP caches are reproducible.
        $cacheNames = @('Cache', 'Code Cache', 'GPUCache', 'GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache')
        foreach ($run in $runs) {
            if ($run.Modified -gt $cutoff -or $run.Directory.FullName -in $scheduledRuns -or -not (Test-Path -LiteralPath $run.Directory.FullName)) { continue }
            try {
                $files = @(Get-GitVistaTreeFiles $localRoot $run.Directory.FullName)
                foreach ($state in @($files | Where-Object Name -eq 'Local State')) {
                    $profile = $state.DirectoryName
                    if (-not (Test-Path -LiteralPath (Join-Path $profile 'Preferences'))) { continue }
                    foreach ($cache in $cacheNames) {
                        $target = Join-Path $profile $cache
                        if (Test-Path -LiteralPath $target) { $results.Add((Remove-GitVistaGeneratedPath $localRoot $target '清理可重建的测试浏览器缓存' -WhatIf:$WhatIfPreference)) }
                    }
                }
            } catch { Write-Warning $_.Exception.Message }
        }
    }
}

$removed = @($results | Where-Object Status -eq 'Removed')
$planned = @($results | Where-Object Status -eq 'Planned')
$skipped = @($results | Where-Object Status -eq 'Skipped')
[pscustomobject]@{
    RemovedItems = $removed.Count; FreedBytes = [long](($removed | Measure-Object Bytes -Sum).Sum)
    PlannedItems = $planned.Count; PlannedBytes = [long](($planned | Measure-Object Bytes -Sum).Sum)
    SkippedItems = $skipped.Count; Details = @($results.ToArray())
}
