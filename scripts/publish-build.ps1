param([Parameter(Mandatory = $true)][string]$StagingDirectory, [switch]$CleanupOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'storage-utils.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = Get-GitVistaChildPath $projectRoot (Join-Path $projectRoot 'release')
$stage = Get-GitVistaChildPath $release $StagingDirectory
if ((Split-Path -Leaf $stage) -notmatch '^\.build-[a-f0-9-]{36}$') { throw '未知构建目录。' }
if (-not (Test-Path -LiteralPath $stage)) { exit 0 }
$marker = Get-Content -LiteralPath (Get-GitVistaChildPath $stage (Join-Path $stage '.gitvista-build.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
if ($marker.owner -ne 'cn.gitvista.desktop' -or $marker.schema -ne 1) { throw '构建目录缺少归属标记。' }
if ($CleanupOnly) {
    # If a previous build could not be restored, retain the transaction for recovery.
    if (Test-Path -LiteralPath (Join-Path $stage '.previous-unpacked')) { throw '暂存目录含上一份产物，保留以便恢复。' }
    $result = Remove-GitVistaGeneratedPath $release $stage '清理本次构建临时文件'
    if ($result.Status -ne 'Removed') { throw $result.Reason }
    exit 0
}
$source = Get-GitVistaChildPath $stage (Join-Path $stage 'win-unpacked')
$record = Test-GitVistaOwnedInstall $source
$executableNames = @("GitVista-$($record.version)-Setup-x64.exe", "GitVista-$($record.version)-Windows-x64.exe")
$artifactNames = $executableNames + @($executableNames | ForEach-Object { "$_.blockmap" }) + @('latest.yml', 'builder-debug.yml', 'builder-effective-config.yaml')
$artifacts = @(Get-ChildItem -LiteralPath $stage -File | Where-Object { $_.Name -in $artifactNames })
$executableHashes = @{}
$obsoleteBlockmaps = @()
# A same-version rebuild may stop producing a blockmap. Only recognize a bounded,
# valid builder map beside the previous verified EXE; arbitrary similarly named files stay.
foreach ($file in @($artifacts | Where-Object { $_.Name -in $executableNames })) {
    $newExecutable = Get-GitVistaChildPath $stage $file.FullName
    $numericVersion = [version]($record.version -replace '-.*$', '')
    if ((Get-GitVistaExecutableVersion $newExecutable) -ne $numericVersion) { throw "构建安装包版本不匹配：$($file.Name)" }
    $executableHashes[$file.Name] = Get-GitVistaFileSha256 $newExecutable
    $oldExecutable = Get-GitVistaChildPath $release (Join-Path $release $file.Name)
    if (-not (Test-Path -LiteralPath $oldExecutable)) { continue }
    if ((Get-GitVistaExecutableVersion $oldExecutable) -ne $numericVersion) { throw "同名旧文件不是对应版本的安装包，保留：$($file.Name)" }
    $mapPath = Get-GitVistaChildPath $release "$oldExecutable.blockmap"
    if (-not (Test-Path -LiteralPath $mapPath) -or (Test-Path -LiteralPath "$newExecutable.blockmap")) { continue }
    try {
        $mapFile = Get-Item -LiteralPath $mapPath -Force
        if ($mapFile.PSIsContainer -or $mapFile.Length -gt 4MB) { throw '不是受支持的差量清单文件。' }
        $stream = [IO.File]::OpenRead($mapPath)
        $gzip = $null; $reader = $null
        try {
            $gzip = New-Object IO.Compression.GZipStream($stream, [IO.Compression.CompressionMode]::Decompress)
            $reader = New-Object IO.StreamReader($gzip)
            $buffer = New-Object char[] 8192
            $json = New-Object Text.StringBuilder
            while (($count = $reader.Read($buffer, 0, $buffer.Length)) -gt 0) {
                if ($json.Length + $count -gt 8MB) { throw '差量清单超出解析预算。' }
                [void]$json.Append($buffer, 0, $count)
            }
            $blockmap = $json.ToString() | ConvertFrom-Json
        } finally { if ($reader) { $reader.Dispose() }; if ($gzip) { $gzip.Dispose() }; $stream.Dispose() }
        $parts = @($blockmap.files)
        if ($blockmap.version -ne '2' -or $parts.Count -ne 1 -or $parts[0].name -ne 'file' -or $parts[0].offset -ne 0 -or @($parts[0].sizes).Count -eq 0 -or @($parts[0].sizes).Count -ne @($parts[0].checksums).Count) { throw '差量清单结构不匹配。' }
        $length = [long]0
        foreach ($size in $parts[0].sizes) { if ($size -isnot [ValueType] -or $size -le 0) { throw '差量清单块大小无效。' }; $length += [long]$size }
        if ($length -ne (Get-Item -LiteralPath $oldExecutable).Length) { throw '差量清单与旧安装包大小不匹配。' }
        $obsoleteBlockmaps += [pscustomobject]@{ Path = $mapPath; Hash = Get-GitVistaFileSha256 $mapPath; Executable = $oldExecutable; ExecutableHash = $executableHashes[$file.Name] }
    } catch { Write-Warning "保留不能确认归属的差量清单 $mapPath：$($_.Exception.Message)" }
}
$target = Get-GitVistaChildPath $release (Join-Path $release 'win-unpacked')
$previous = Get-GitVistaChildPath $stage (Join-Path $stage '.previous-unpacked')
if (Test-GitVistaPathRunning $target @(Get-GitVistaRunningPaths)) { throw '上一份解压程序仍在运行，暂不覆盖。' }
if (Test-Path -LiteralPath $target) {
    if (Test-Path -LiteralPath (Join-Path $target '.gitvista-installation.json')) { [void](Test-GitVistaOwnedInstall $target) }
    else {
        # One-time compatibility for unmarked releases; preserve unknown additions.
        [void](Get-GitVistaExecutableVersion (Join-Path $target 'GitVista.exe'))
        $allowed = @($record.files | ForEach-Object { $_.path -replace '/', '\' }) + @('version', 'resources\default_app.asar')
        foreach ($file in @(Get-GitVistaTreeFiles $release $target)) {
            if ($file.FullName.Substring($target.Length + 1) -notin $allowed) { throw "旧构建目录包含未知文件，请先另行保存：$($file.FullName.Substring($target.Length + 1))" }
        }
    }
    $target = Get-GitVistaChildPath $release $target
    Move-Item -LiteralPath $target -Destination $previous
}
try { Move-Item -LiteralPath (Get-GitVistaChildPath $stage $source) -Destination $target }
catch {
    if ((Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $target)) { Move-Item -LiteralPath (Get-GitVistaChildPath $stage $previous) -Destination $target }
    throw
}
foreach ($file in $artifacts) {
    $destination = Get-GitVistaChildPath $release (Join-Path $release $file.Name)
    if (Test-Path -LiteralPath $destination) { [IO.File]::Replace((Get-GitVistaChildPath $stage $file.FullName), $destination, [NullString]::Value) }
    else { [IO.File]::Move((Get-GitVistaChildPath $stage $file.FullName), $destination) }
    if ($executableHashes.ContainsKey($file.Name) -and (Get-GitVistaFileSha256 $destination) -ne $executableHashes[$file.Name]) { throw "发布后的安装包校验失败：$($file.Name)" }
}
if (Test-Path -LiteralPath $previous) {
    $result = Remove-GitVistaGeneratedPath $stage $previous '移除已被成功构建替代的解压产物'
    if ($result.Status -ne 'Removed') { throw $result.Reason }
}
foreach ($map in $obsoleteBlockmaps) {
    try {
        $mapPath = Get-GitVistaChildPath $release $map.Path
        if ((Get-GitVistaFileSha256 $mapPath) -ne $map.Hash -or (Get-GitVistaFileSha256 (Get-GitVistaChildPath $release $map.Executable)) -ne $map.ExecutableHash) { throw '发布期间文件发生变化，保留差量清单。' }
        Remove-Item -LiteralPath $mapPath -Force -ErrorAction Stop
    } catch { Write-Warning "旧差量清单暂未清理：$($_.Exception.Message)" }
}
Write-Output "构建已发布到 $release"
