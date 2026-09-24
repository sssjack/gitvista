Add-Type -AssemblyName System.Drawing
$taskBitmap = [System.Drawing.Bitmap]::new(256, 256)
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskGraphics.Clear([System.Drawing.Color]::FromArgb(255, 18, 22, 31))
$taskPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 173, 157, 247), 15)
$taskPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$taskPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$taskGraphics.DrawLine($taskPen, 78, 63, 78, 197)
$taskGraphics.DrawBezier($taskPen, 78, 157, 78, 114, 178, 145, 178, 61)
$taskBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 137, 226, 194))
$taskGraphics.FillEllipse($taskBrush, 55, 40, 46, 46)
$taskGraphics.FillEllipse($taskBrush, 55, 174, 46, 46)
$taskGraphics.FillEllipse($taskBrush, 155, 38, 46, 46)
$taskInner = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 18, 22, 31))
foreach ($taskPoint in @(@(68,53), @(68,187), @(168,51))) { $taskGraphics.FillEllipse($taskInner, $taskPoint[0], $taskPoint[1], 20, 20) }
$taskIconDir = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Path $taskIconDir -Force | Out-Null
$taskBitmap.Save((Join-Path $taskIconDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$taskStream = [System.IO.MemoryStream]::new()
$taskBitmap.Save($taskStream, [System.Drawing.Imaging.ImageFormat]::Png)
$taskBytes = $taskStream.ToArray()
$taskIconFile = [System.IO.File]::Create((Join-Path $taskIconDir 'icon.ico'))
$taskWriter = [System.IO.BinaryWriter]::new($taskIconFile)
$taskWriter.Write([UInt16]0); $taskWriter.Write([UInt16]1); $taskWriter.Write([UInt16]1)
$taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0)
$taskWriter.Write([UInt16]1); $taskWriter.Write([UInt16]32); $taskWriter.Write([UInt32]$taskBytes.Length); $taskWriter.Write([UInt32]22)
$taskWriter.Write($taskBytes)
$taskWriter.Dispose(); $taskStream.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose(); $taskPen.Dispose(); $taskBrush.Dispose(); $taskInner.Dispose()
