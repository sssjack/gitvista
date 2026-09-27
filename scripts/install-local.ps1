param(
    [string]$InstallRoot = 'D:\LenovoSoftstore\GitVista',
    [string]$DesktopDirectory = [Environment]::GetFolderPath('Desktop'),
    [string]$ProjectDirectory = '',
    [switch]$KeepOldVersions,
    [switch]$SkipArtifactCleanup
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectDirectory) { $ProjectDirectory = Split-Path -Parent $PSScriptRoot }
. (Join-Path $PSScriptRoot 'storage-utils.ps1')
$projectRoot = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$manifest.version
if ($manifest.name -ne 'gitvista' -or $version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') { throw 'GitVista 项目或版本号格式不正确。' }
[void](Compare-GitVistaVersion $version $version)
$numericVersion = [version]($version -replace '-.*$', '')
$sourceDirectory = Get-GitVistaChildPath $projectRoot (Join-Path $projectRoot 'release\win-unpacked')
$sourceExecutable = Join-Path $sourceDirectory 'GitVista.exe'
$sourceArchive = Join-Path $sourceDirectory 'resources\app.asar'
if (-not (Test-Path -LiteralPath $sourceExecutable) -or -not (Test-Path -LiteralPath $sourceArchive)) {
    throw '请先执行 npm run package:dir，生成完整桌面程序。'
}

if ((Get-GitVistaExecutableVersion $sourceExecutable) -ne $numericVersion) { throw '构建版本与项目版本不一致，请重新打包。' }
$sourceFiles = @(Get-GitVistaTreeFiles $projectRoot $sourceDirectory | Where-Object Name -ne '.gitvista-installation.json')
$sourceRecords = @($sourceFiles | ForEach-Object {
    [pscustomobject]@{ path = $_.FullName.Substring($sourceDirectory.Length + 1); sha256 = Get-GitVistaFileSha256 $_.FullName }
})
$installBase = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\', '/')
$installDirectory = Get-GitVistaChildPath $installBase (Join-Path $installBase $version)
if ($installDirectory.Equals($sourceDirectory, [StringComparison]::OrdinalIgnoreCase) -or $installDirectory.StartsWith($sourceDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '安装目录不能放在构建产物内部。' }
$desktopRoot = (Resolve-Path -LiteralPath $DesktopDirectory).Path
$shortcutPath = Get-GitVistaChildPath $desktopRoot (Join-Path $desktopRoot 'GitVista.lnk')
$shellObject = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = $shellObject.CreateShortcut($shortcutPath)
    $existingTarget = Get-GitVistaChildPath $installBase $existing.TargetPath
    if ([IO.Path]::GetFileName($existingTarget) -ne 'GitVista.exe' -or $existing.Arguments) { throw '同名桌面快捷方式不是本安装脚本的标准入口，请先重命名该快捷方式。' }
}
New-Item -ItemType Directory -Path $installBase -Force | Out-Null
# Recover only abandoned transactions carrying our ownership and exact file list.
foreach ($directory in @(Get-ChildItem -LiteralPath $installBase -Directory -Force)) {
    if ($directory.Name -notmatch '^\.install-[0-9A-Za-z.-]+-[a-f0-9]{32}$') { continue }
    try {
        $stage = Get-GitVistaChildPath $installBase $directory.FullName
        if (-not (Test-Path -LiteralPath (Join-Path $stage '.gitvista-staging.json'))) {
            [void](Test-GitVistaOwnedInstall $stage)
            if (Test-GitVistaPathRunning $stage @(Get-GitVistaRunningPaths)) { continue }
            Remove-GitVistaGeneratedPath $installBase $stage '回收切换前中断的完整安装事务' | Out-Null
            continue
        }
        $marker = Get-Content -LiteralPath (Get-GitVistaChildPath $stage (Join-Path $stage '.gitvista-staging.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($marker.owner -ne 'cn.gitvista.desktop' -or $marker.schema -ne 1) { continue }
        $process = Get-Process -Id $marker.pid -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $marker.started) { continue }
        $allowed = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        foreach ($relative in @($marker.files) + @('.gitvista-staging.json', '.gitvista-installation.json')) { [void]$allowed.Add((Get-GitVistaChildPath $stage (Join-Path $stage $relative))) }
        foreach ($file in @(Get-GitVistaTreeFiles $installBase $stage)) { if (-not $allowed.Contains($file.FullName)) { throw '暂存安装中存在未知文件，保留。' } }
        Remove-GitVistaGeneratedPath $installBase $stage '回收已中断的安装事务' | Out-Null
    } catch { Write-Warning "保留安装事务 $($directory.Name)：$($_.Exception.Message)" }
}
$stageDirectory = $null
try {
    $verifyDirectory = $installDirectory
    if (-not (Test-Path -LiteralPath $installDirectory)) {
        $stageDirectory = Get-GitVistaChildPath $installBase (Join-Path $installBase ".install-$version-$([guid]::NewGuid().ToString('N'))")
        New-Item -ItemType Directory -Path $stageDirectory | Out-Null
        [pscustomobject]@{ owner = 'cn.gitvista.desktop'; schema = 1; pid = $PID; started = (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks.ToString(); files = @($sourceRecords.path) } |
            ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stageDirectory '.gitvista-staging.json') -Encoding UTF8
        foreach ($sourceFile in $sourceFiles) {
            $destination = Get-GitVistaChildPath $stageDirectory (Join-Path $stageDirectory $sourceFile.FullName.Substring($sourceDirectory.Length + 1))
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath $sourceFile.FullName -Destination $destination
        }
        $verifyDirectory = $stageDirectory
    }
    foreach ($entry in $sourceRecords) {
        $installedFile = Get-GitVistaChildPath $verifyDirectory (Join-Path $verifyDirectory $entry.path)
        if ((Get-GitVistaFileSha256 $installedFile) -ne $entry.sha256) { throw "安装校验失败，旧版本及快捷方式保持可用：$($entry.path)" }
    }
    [pscustomobject]@{ owner = 'cn.gitvista.desktop'; schema = 1; version = $version; files = $sourceRecords } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Get-GitVistaChildPath $verifyDirectory (Join-Path $verifyDirectory '.gitvista-installation.json')) -Encoding UTF8
    if ($stageDirectory) {
        Remove-Item -LiteralPath (Get-GitVistaChildPath $stageDirectory (Join-Path $stageDirectory '.gitvista-staging.json')) -Force
        $stageDirectory = Get-GitVistaChildPath $installBase $stageDirectory
        $installDirectory = Get-GitVistaChildPath $installBase $installDirectory
        if (Test-Path -LiteralPath $installDirectory) { throw '另一个安装进程已创建目标版本，请重试。' }
        Move-Item -LiteralPath $stageDirectory -Destination $installDirectory
        $stageDirectory = $null
    }
} finally {
    if ($stageDirectory -and (Test-Path -LiteralPath $stageDirectory)) { Remove-GitVistaGeneratedPath $installBase $stageDirectory '清理失败安装的暂存产物' | Out-Null }
}
$installedExecutable = Join-Path $installDirectory 'GitVista.exe'
$temporaryLink = Get-GitVistaChildPath $desktopRoot (Join-Path $desktopRoot ".gitvista-$([guid]::NewGuid().ToString('N')).lnk")
try {
    $shortcut = $shellObject.CreateShortcut($temporaryLink)
    $shortcut.TargetPath = $installedExecutable
    $shortcut.WorkingDirectory = $installDirectory
    $shortcut.IconLocation = "$installedExecutable,0"
    $shortcut.Description = "GitVista $version：直接启动已安装的最新版本。"
    $shortcut.Save()
    if ($shellObject.CreateShortcut($temporaryLink).TargetPath -ne $installedExecutable) { throw '快捷方式校验失败，保留旧版本。' }
    if (Test-Path -LiteralPath $shortcutPath) { [IO.File]::Replace($temporaryLink, $shortcutPath, [NullString]::Value) }
    else { [IO.File]::Move($temporaryLink, $shortcutPath) }
} finally { if (Test-Path -LiteralPath $temporaryLink) { Remove-Item -LiteralPath $temporaryLink -Force } }

$removedVersions = @()
$retainedVersions = @()
$freedInstallBytes = [long]0
if (-not $KeepOldVersions) {
    foreach ($directory in @(Get-ChildItem -LiteralPath $installBase -Directory)) {
        if ($directory.Name -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or (Compare-GitVistaVersion $directory.Name $version) -ge 0) { continue }
        try {
            $candidate = Get-GitVistaChildPath $installBase $directory.FullName
            if (Test-GitVistaPathRunning $candidate @(Get-GitVistaRunningPaths)) { throw '旧版仍在运行，下次安装时重试。' }
            if ((Get-GitVistaExecutableVersion (Join-Path $candidate 'GitVista.exe')) -ne [version]($directory.Name -replace '-.*$', '')) { throw '目录名与程序版本不匹配。' }
            [void](Test-GitVistaOwnedInstall $candidate $directory.Name)
            if (Test-GitVistaPathRunning $candidate @(Get-GitVistaRunningPaths)) { throw '旧版已启动，下次安装时重试。' }
            $result = Remove-GitVistaGeneratedPath $installBase $candidate '清理已被新版替代的 GitVista 安装'
            if ($result.Status -eq 'Removed') { $removedVersions += $directory.Name; $freedInstallBytes += $result.Bytes }
            else { throw $result.Reason }
        } catch { $retainedVersions += [pscustomobject]@{ Version = $directory.Name; Reason = $_.Exception.Message } }
    }
    foreach ($file in @(Get-ChildItem -LiteralPath $desktopRoot -Filter 'GitVista*.lnk' -File)) {
        if ($file.Name -notmatch '^GitVista (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) 快速启动\.lnk$') { continue }
        $linkVersion = $Matches[1]
        if ((Compare-GitVistaVersion $linkVersion $version) -gt 0) { continue }
        try {
            $linkPath = Get-GitVistaChildPath $desktopRoot $file.FullName
            $link = $shellObject.CreateShortcut($linkPath)
            $expected = Join-Path (Join-Path $installBase $linkVersion) 'GitVista.exe'
            if ($link.TargetPath -eq $expected -and -not $link.Arguments) { Remove-Item -LiteralPath $linkPath -Force }
        } catch { Write-Warning "保留快捷方式：$($file.FullName)，$($_.Exception.Message)" }
    }
}
# Overwritten receipt makes deferred cleanup visible without accumulating logs.
[pscustomobject]@{ version = $version; deferred = $retainedVersions } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Get-GitVistaChildPath $installBase (Join-Path $installBase '.gitvista-maintenance.json')) -Encoding UTF8
$artifactCleanup = $null
if (-not $SkipArtifactCleanup) {
    try { $artifactCleanup = & (Join-Path $PSScriptRoot 'cleanup-artifacts.ps1') -ProjectDirectory $projectRoot }
    catch { Write-Warning "安装已完成，产物清理暂未完成：$($_.Exception.Message)" }
}
[pscustomobject]@{
    Version = $version; Executable = $installedExecutable; Shortcut = $shortcutPath
    RemovedVersions = $removedVersions; RetainedVersions = $retainedVersions
    FreedInstallBytes = $freedInstallBytes; ArtifactCleanup = $artifactCleanup
}
