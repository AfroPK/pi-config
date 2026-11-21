# Visual QA for a LOVE game, using a local vision model (set up 2026-10-30).
# 1. Runs <Project>\love2d\lovec.exe <Project>, waits, optionally clicks/types, screenshots the game window's client area.
# 2. Asks a vision model to judge the shot against -Criteria:
#    default (quick): Gemma 4 E2B on the HomeLab (192.168.0.117:8095, always on, ~7 s, no model swap) - safe to run
#      from inside a pi-exec session. Reliable for blank/white screens, error screens, missing digits, text; NOT for
#      whether grid lines are drawn or which cell a digit is in.
#    -Deep: Qwen3.5-9B + mmproj on this PC (swaps :8080 away from Swift, so never from inside pi-exec).
# 3. Writes <Project>\VISION.md (verdict, console errors, screenshot path) and prints it. Exit 0 = PASS, 1 = FAIL.
# Usage: vision-check.ps1 -Project __PI_HOME__\sudoku3d -Criteria "a 9x9 grid with visible lines; ..." [-Wait 4] [-Click "125,75"] [-Keys "5"] [-Deep]
param(
  [Parameter(Mandatory)][string]$Project,
  [Parameter(Mandatory)][string]$Criteria,
  [int]$Wait = 4,
  [string]$Click = "",   # x,y in screenshot pixels to left-click before the shot (semicolon-separate several)
  [string]$Keys = "",    # plain characters to type after the click(s)
  [switch]$Deep          # use the PC's Qwen3.5-9B (better detail, costs a model swap) instead of the HomeLab E2B
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class VC {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, int e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
}
"@
[VC]::SetProcessDPIAware() | Out-Null

$shots = Join-Path $Project 'screens'; New-Item -ItemType Directory -Force $shots | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$png = Join-Path $shots "shot-$stamp.png"
$log = Join-Path $env:TEMP "vision-check-$stamp.log"

# --- run the game and take the screenshot ---
$p = Start-Process (Join-Path $Project 'love2d\lovec.exe') -ArgumentList "`"$Project`"" -WorkingDirectory $Project `
       -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Normal -PassThru
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 40 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); if ($p.HasExited) { break }; $h = $p.MainWindowHandle }
Start-Sleep $Wait
$console = ""
if ($h -ne [IntPtr]::Zero -and -not $p.HasExited) {
  # Input goes to the game window as window messages, and the shot uses PrintWindow, so nothing depends on the game
  # being the foreground window (Windows often refuses to give a background script focus).
  # love.window.setMode() in main.lua recreates the window, so the handle seen at startup can be stale: look it up again
  $p.Refresh(); if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $h = $p.MainWindowHandle }
  if ($Click -or $Keys) { [VC]::PostMessage($h, 0x0007, [IntPtr]0, [IntPtr]0) | Out-Null; Start-Sleep -Milliseconds 300 }  # WM_SETFOCUS
  # -Click is in screenshot pixels, which are the game's own (DPI-unaware LOVE 11.4) coordinates because the shot is
  # taken with PrintWindow at the unscaled size. SDL sometimes reads the real cursor instead of lParam, so also put
  # the cursor there, scaled up to physical screen pixels (125% here) (probe-verified 2026-10-30).
  $scale = [VC]::GetDpiForSystem() / 96.0
  $o = New-Object VC+POINT; [VC]::ClientToScreen($h, [ref]$o) | Out-Null
  foreach ($c in ($Click -split ';' | Where-Object { $_ })) {
    $xy = $c -split ','; $lx = [int]$xy[0]; $ly = [int]$xy[1]
    [VC]::SetCursorPos($o.X + [int]($lx * $scale), $o.Y + [int]($ly * $scale)) | Out-Null
    $lp = [IntPtr](($ly -shl 16) -bor $lx)
    [VC]::PostMessage($h, 0x200, [IntPtr]0, $lp) | Out-Null          # WM_MOUSEMOVE
    Start-Sleep -Milliseconds 150
    [VC]::PostMessage($h, 0x201, [IntPtr]1, $lp) | Out-Null          # WM_LBUTTONDOWN
    Start-Sleep -Milliseconds 80
    [VC]::PostMessage($h, 0x202, [IntPtr]0, $lp) | Out-Null          # WM_LBUTTONUP
    Start-Sleep -Milliseconds 300
  }
  # SDL only raises love.keypressed when lParam carries the hardware scan code (without it LOVE sees just
  # textinput), and it wants WM_SETFOCUS first; verified with a probe script 2026-10-30.
  foreach ($ch in $Keys.ToCharArray()) {
    $vkc = [uint32]([VC]::VkKeyScan($ch) -band 0xFF); $vk = [IntPtr][int]$vkc
    $sc = [int64][VC]::MapVirtualKey($vkc, 0)
    [VC]::PostMessage($h, 0x100, $vk, [IntPtr](($sc -shl 16) -bor 1)) | Out-Null               # WM_KEYDOWN
    Start-Sleep -Milliseconds 80
    [VC]::PostMessage($h, 0x101, $vk, [IntPtr](0xC0000001L -bor ($sc -shl 16))) | Out-Null    # WM_KEYUP
    Start-Sleep -Milliseconds 300
  }
  Start-Sleep -Milliseconds 500
  # a Lua error makes LOVE replace the game window with its error screen, so look the window up again
  $p.Refresh(); if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $h = $p.MainWindowHandle }
  $r = New-Object VC+RECT; [VC]::GetClientRect($h, [ref]$r) | Out-Null
  if (($r.R - $r.L) -lt 10 -or ($r.B - $r.T) -lt 10) { throw "game window has no client area (minimized or closed?)" }
  # PrintWindow draws a DPI-unaware window (LOVE 11.4) at its unscaled size, so size the bitmap to match
  $bmp = New-Object System.Drawing.Bitmap ([int](($r.R - $r.L) / $scale)), ([int](($r.B - $r.T) / $scale))
  $g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
  [VC]::PrintWindow($h, $hdc, 3) | Out-Null                          # PW_CLIENTONLY | PW_RENDERFULLCONTENT
  $g.ReleaseHdc($hdc); $g.Dispose(); $bmp.Save($png)
}
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Start-Sleep -Milliseconds 300
$console = ((Get-Content $log, "$log.err" -ErrorAction SilentlyContinue) -join "`n").Trim()

if (-not (Test-Path $png)) {
  $verdict = "The game window never appeared or the game exited at once, so there is no screenshot.`n`nVERDICT: FAIL"
} else {
  # --- ask the vision model ---
  if ($Deep) {
    # The local Qwen3.5-9B vision model was removed 2026-11-19 (models trimmed to 3); -Deep now uses the HomeLab model too.
    Write-Warning '-Deep: the local Qwen3.5-9B vision model was removed on 2026-11-19; using the HomeLab Gemma model.'
    $url = 'http://192.168.0.117:8095/v1/chat/completions'; $model = 'gemma4-e2b-vision'
  } else {
    $url = 'http://192.168.0.117:8095/v1/chat/completions'; $model = 'gemma4-e2b-vision'
  }
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($png))
  $prompt = "You are a strict visual QA reviewer for a video game. This is a screenshot of the game window.`n" +
            "Expected on screen:`n$Criteria`n`n" +
            "First describe exactly what you see: layout, colors, any text and numbers you can actually read, anything broken (blank areas, overlapping or unreadable text, error screens). " +
            "Do not assume anything you cannot see. Then go through each expected item and write PASS or FAIL with a short reason. " +
            "Finish with one line: VERDICT: PASS or VERDICT: FAIL."
  $body = @{ model = $model; max_tokens = 1200; temperature = 0.2
             chat_template_kwargs = @{ enable_thinking = $false }
             messages = @(@{ role = 'user'; content = @(
               @{ type = 'text'; text = $prompt },
               @{ type = 'image_url'; image_url = @{ url = "data:image/png;base64,$b64" } }) }) } | ConvertTo-Json -Depth 8
  $resp = Invoke-RestMethod $url -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 300
  $verdict = $resp.choices[0].message.content.Trim()
  if ($Deep) {
    # Unload the vision model so its VRAM is free for the next pi session. :8080 is llama-swap since 2026-10-30,
    # so ask it to unload rather than killing the listener (that would kill llama-swap itself).
    try { Invoke-RestMethod http://127.0.0.1:8080/api/models/unload -Method Post -TimeoutSec 60 | Out-Null } catch {}
    Start-Sleep 2
  }
}

$report = @"
# Visual check ($stamp, $(if ($Deep) { 'deep: Qwen3.5-9B on this PC' } else { 'quick: Gemma 4 E2B on the HomeLab' }))
Screenshot: screens/shot-$stamp.png
Criteria: $Criteria

## Console output from lovec.exe
$(if ($console) { '```' + "`n$console`n" + '```' } else { "(none)" })

## Vision model review
$verdict
"@
Set-Content (Join-Path $Project 'VISION.md') $report -Encoding utf8
$report
if ($verdict -match 'VERDICT:\s*PASS' -and $console -notmatch 'Error') { exit 0 } else { exit 1 }
