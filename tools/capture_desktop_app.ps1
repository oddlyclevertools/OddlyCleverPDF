# Clean still of the installed Windows app for the showcase: open it on a sample PDF, grab the window
# with PrintWindow (works even if something covers it), close it.
#   powershell -NoProfile -File tools/capture_desktop_app.ps1 <pdf> <out.png>
param([string]$Pdf, [string]$Out)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
"@
[Win]::SetProcessDPIAware() | Out-Null   # real pixels, not scaled ones
$exe = Join-Path $env:LOCALAPPDATA "Programs\OddlyCleverPDF\OddlyClever PDF.exe"
if (-not (Test-Path $exe)) { throw "The app isn't installed: $exe" }
$p = Start-Process -FilePath $exe -ArgumentList "`"$((Resolve-Path $Pdf).Path)`"" -PassThru
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 40 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); $h = $p.MainWindowHandle }
if ($h -eq [IntPtr]::Zero) { throw "No window appeared" }
[Win]::ShowWindow($h, 1) | Out-Null
[Win]::MoveWindow($h, 40, 40, 1920, 1110, $true) | Out-Null
Start-Sleep -Seconds 6   # let the page open and render the PDF
$r = New-Object Win+RECT; [Win]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[Win]::PrintWindow($h, $dc, 2) | Out-Null   # 2 = PW_RENDERFULLCONTENT (includes WebView2)
$g.ReleaseHdc($dc); $g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
$p.CloseMainWindow() | Out-Null
Start-Sleep -Milliseconds 800
if (-not $p.HasExited) { $p.Kill() }
Write-Output "saved $Out"
