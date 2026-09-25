param(
    [string]$InstallRoot = 'D:\LenovoSoftstore\GitVista',
    [string]$DesktopDirectory = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') { throw '版本号格式不正确。' }
$sourceDirectory = (Resolve-Path -LiteralPath (Join-Path $projectDirectory 'release\win-unpacked')).Path
$sourceExecutable = Join-Path $sourceDirectory 'GitVista.exe'
$sourceArchive = Join-Path $sourceDirectory 'resources\app.asar'
if (-not (Test-Path -LiteralPath $sourceExecutable) -or -not (Test-Path -LiteralPath $sourceArchive)) {
    throw '请先执行 npm run package:dir，生成完整桌面程序。'
}

$installDirectory = [IO.Path]::GetFullPath((Join-Path $InstallRoot $version))
$installBase = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if (-not $installDirectory.StartsWith($installBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '安装路径无效。' }
if (Test-Path -LiteralPath $installDirectory) { throw "版本目录已存在，保留现有文件：$installDirectory" }
$shortcutPath = Join-Path $DesktopDirectory "GitVista $version 快速启动.lnk"
if (Test-Path -LiteralPath $shortcutPath) { throw "快捷方式已存在，保留现有文件：$shortcutPath" }

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $sourceDirectory -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $installDirectory -Recurse
}
$installedExecutable = Join-Path $installDirectory 'GitVista.exe'
foreach ($relativePath in @('GitVista.exe', 'resources\app.asar')) {
    $sourceHash = (Get-FileHash -LiteralPath (Join-Path $sourceDirectory $relativePath) -Algorithm SHA256).Hash
    $installedHash = (Get-FileHash -LiteralPath (Join-Path $installDirectory $relativePath) -Algorithm SHA256).Hash
    if ($sourceHash -ne $installedHash) { throw "安装校验失败：$relativePath" }
}
$shellObject = New-Object -ComObject WScript.Shell
$shortcut = $shellObject.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $installedExecutable
$shortcut.WorkingDirectory = $installDirectory
$shortcut.IconLocation = "$installedExecutable,0"
$shortcut.Description = 'GitVista：直接启动已解压的程序，保留现有仓库与设置。'
$shortcut.Save()
[pscustomobject]@{ Version = $version; Executable = $installedExecutable; Shortcut = $shortcutPath }
