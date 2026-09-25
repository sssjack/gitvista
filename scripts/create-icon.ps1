Add-Type -AssemblyName System.Drawing

$bgColor   = [System.Drawing.Color]::FromArgb(255, 22, 24, 29)
$lineColor = [System.Drawing.Color]::FromArgb(255, 125, 149, 245)

function New-RoundRectPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# small = true renders a simplified mark tuned for 16-32px rather than a
# downscale of the 512px master, which turns to mush at taskbar size.
function Render-Icon([int]$size, [bool]$small) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode   = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $f = $size / 512.0
  $inset  = [int](20 * $f)
  $radius = [int](110 * $f)
  $tile = New-RoundRectPath $inset $inset ($size - 2*$inset) ($size - 2*$inset) $radius
  $g.FillPath((New-Object System.Drawing.SolidBrush($bgColor)), $tile)

  function X([double]$v) { return [float]($v * $f) }
  function Y([double]$v) { return [float]($v * $f) }

  # Small sizes get a heavier stroke so it survives at 16px; the ring nodes
  # become solid discs whose radius is clamped to a whole pixel minimum.
  $stroke = [float](($(if ($small) { 40 } else { 26 })) * $f)
  $pen = New-Object System.Drawing.Pen($lineColor, $stroke)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $g.DrawLine($pen, (X 176), (Y 152), (X 176), (Y 360))
  $g.DrawBezier($pen, (X 176), (Y 296), (X 176), (Y 234), (X 336), (Y 254), (X 336), (Y 152))

  $nodes = @(@(176,152), @(176,360), @(336,152))
  if ($small) {
    # Solid discs, no hole. At 16px a hole is sub-pixel and reads as noise.
    $r = [Math]::Max(1.35, 30 * $f)
    $brush = New-Object System.Drawing.SolidBrush($lineColor)
    foreach ($n in $nodes) {
      $cx = X $n[0]; $cy = Y $n[1]
      $g.FillEllipse($brush, ($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
    }
    $brush.Dispose()
  } else {
    $ring = New-Object System.Drawing.SolidBrush($lineColor)
    $hole = New-Object System.Drawing.SolidBrush($bgColor)
    $outer = [float](29 * $f); $inner = [float](13 * $f)
    foreach ($n in $nodes) {
      $cx = X $n[0]; $cy = Y $n[1]
      $g.FillEllipse($ring, ($cx - $outer), ($cy - $outer), ($outer * 2), ($outer * 2))
      $g.FillEllipse($hole, ($cx - $inner), ($cy - $inner), ($inner * 2), ($inner * 2))
    }
    $ring.Dispose(); $hole.Dispose()
  }

  $g.Dispose()
  return $bmp
}

$master = Render-Icon 512 $false
$master.Save("icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)

# 16/24/32 use the simplified mark; 48+ use the detailed one.
$plan = @(@(16,$true), @(24,$true), @(32,$true), @(48,$false), @(64,$false), @(128,$false), @(256,$false))
$frames = @()
foreach ($p in $plan) {
  $b = Render-Icon $p[0] $p[1]
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames += ,@{ size = $p[0]; bytes = $ms.ToArray() }
  $b.Dispose(); $ms.Dispose()
}

$fs = [System.IO.File]::Create("icon-multi.ico")
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$frames.Count)
$offset = 6 + (16 * $frames.Count)
foreach ($fr in $frames) {
  $dim = if ($fr.size -ge 256) { 0 } else { $fr.size }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$fr.bytes.Length); $bw.Write([UInt32]$offset)
  $offset += $fr.bytes.Length
}
foreach ($fr in $frames) { $bw.Write($fr.bytes) }
$bw.Dispose(); $fs.Dispose(); $master.Dispose()
Write-Host "OK ($($frames.Count) frames; 16/24/32 simplified)"
