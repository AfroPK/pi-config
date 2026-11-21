---
name: apple-emoji-windows
description: Replace the Windows system emoji font seguiemj.ttf with Apple's colour emoji using ibrokhimel/apple-emoji-windows (245 MB CBDT rebuild, boot-time swap, tiny-size optimiser), or roll it back to Segoe UI Emoji. Use when Freddy wants Apple/iOS emoji system-wide on Windows, asks about his emoji font, reports tofu boxes or rough emoji at 12-16px, or wants Segoe restored.
---

# Apple emoji on Windows

System-wide emoji font swap: `C:\Windows\Fonts\seguiemj.ttf` → CBDT/CBLC rebuild
of Apple Color Emoji. Windows' DirectWrite cannot read Apple's own `sbix`
font, which is why the samuelngs rebuild is used instead.

Everything below was verified on this PC (Windows 11, PowerShell 5.1). Read it
before touching the font again — the two failure modes are non-obvious.

## Installed state on Freddy's PC (as of the setup run)

| Thing | Path / value |
|---|---|
| Checkout | `__PI_HOME__/projects/apple-emoji-windows` |
| Upstream font | `AppleColorEmoji-Windows.ttf` (244.5 MB, SHA256 `18E48F17…E48EC0B`) |
| Optimised build | `AppleColorEmoji-Windows-optimized.ttf` (262.9 MB, 16 strikes) |
| Stock backup | `seguiemj-ORIGINAL.ttf` (12.9 MB) — copy of the original `C:\Windows\Fonts\seguiemj.ttf` |
| Python | `.venv` in the checkout with fonttools + Pillow |
| Wrapper | this skill's `scripts/apply-apple-emoji-elevated.ps1` (runs `Apply-AppleEmoji.ps1` / `Restore-SegoeEmoji.ps1` elevated) |
| Log | `apply-log.txt` / `restore-log.txt` in the checkout (UTF-8, written by the wrapper) |

Status as of the setup run: the swap is **staged and queued**
(`C:\Windows\Fonts\seguiemj.ttf.new` → `seguiemj.ttf` in
`PendingFileRenameOperations`), live font still stock. Check that registry value
before assuming anything about the current state.

The optimised build is what gets installed: it adds native **12/14/16/18 px**
strikes (upstream's smallest is 20 px, and Windows draws UI emoji at 11–16 px,
so it downscales at draw time and shreds fine detail) and widens the advance to
**1.373 em** so emoji stop sitting edge-to-edge. Verified: 6397 glyphs, family
name `Segoe UI Emoji`, cmap format 12 present, and every strike renders clean.

## Set up from scratch

1. Clone and build the optimiser env:

   ```bash
   mkdir -p __PI_HOME__/projects && cd __PI_HOME__/projects
   git clone https://github.com/ibrokhimel/apple-emoji-windows.git
   cd apple-emoji-windows
   python -m venv .venv && ./.venv/Scripts/python.exe -m pip install --quiet fonttools pillow
   ```

2. Fetch the font yourself so the elevated run does no network I/O (and so a
   bad download fails before UAC). **Take the URL and SHA from the current
   `Apply-AppleEmoji.ps1` (`$FontUrl`, `$AppleSha`)** — upstream tags rotate;
   never reuse a hash copied into this skill.

   ```bash
   timeout 900 curl -L -o AppleColorEmoji-Windows.ttf.partial "<$FontUrl>"
   sha256sum AppleColorEmoji-Windows.ttf.partial   # must equal $AppleSha
   mv AppleColorEmoji-Windows.ttf.partial AppleColorEmoji-Windows.ttf
   ```

3. Build the optimised font (≈15 s, +18 MB). The applier reuses it automatically
   if it is present, so no Python is needed inside the elevated process:

   ```bash
   ./.venv/Scripts/python.exe scripts/optimize-emoji-font.py \
       AppleColorEmoji-Windows.ttf AppleColorEmoji-Windows-optimized.ttf
   ```

   Expect the strike ladder to print as
   `[12, 14, 16, 18, 20, 26, 32, 40, 48, 52, 56, 64, 72, 80, 88, 96]`.

4. Run the wrapper — it prints the whole applier log back when it finishes:

   ```bash
   timeout 900 powershell -NoProfile -ExecutionPolicy Bypass \
       -File "__PI_HOME__/.pi/agent/skills/apple-emoji-windows/scripts/apply-apple-emoji-elevated.ps1" \
       [-Mode Apply|Restore] [-Base <checkout>] 2>&1 | tail -40
   ```

   It resets `PSModulePath` to the machine value, relaunches itself elevated
   (`Start-Process -Verb RunAs -Wait`), runs the chosen script, buffers every
   line and writes a UTF-8 log in the checkout — so a mid-run failure keeps the
   steps that already passed. This bash shell is normally already elevated, in
   which case no UAC dialog appears. Exit code `-1073741510` (0xC000013A) only
   means the elevated window was closed at the end; read the log, not the code.
   Re-running apply is safe and idempotent: it re-stages and re-queues.

5. Verify independently (no elevation needed):

   ```bash
   PSModulePath="C:\Program Files\WindowsPowerShell\Modules;C:\WINDOWS\system32\WindowsPowerShell\v1.0\Modules" \
   powershell -NoProfile -Command "
     (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations).PendingFileRenameOperations
     Get-ChildItem 'C:\Windows\Fonts\seguiemj.ttf*' | Select-Object Name,Length
     'staged: ' + (Get-FileHash 'C:\Windows\Fonts\seguiemj.ttf.new' -Algorithm SHA256).Hash
     'local : ' + (Get-FileHash 'AppleColorEmoji-Windows-optimized.ttf' -Algorithm SHA256).Hash"
   ```

   Good = `seguiemj.ttf.new` then `!??\C:\Windows\Fonts\seguiemj.ttf` in the
   pending list, both hashes identical, and the live `seguiemj.ttf` still the
   small stock file (12.9 MB). Nothing changes until reboot.

6. **Never reboot for him.** Report "staged, nothing changed yet" and let him
   reboot. The swap is performed by Session Manager during early boot.

## Optional visual check before the swap

FreeType (Pillow) can only open a bitmap-only font at an exact strike size —
`ImageFont.truetype(font, 24)` raises `OSError: invalid pixel size`. Open the
font at 12/14/16/18/32/64 only, draw a row per size with
`embedded_color=True`, save a PNG and check it with `look`. That is how the
optimised build was confirmed (clean at every size, no tofu or speckle).

## Roll back to Segoe UI Emoji

Same wrapper, `-Mode Restore`:

```bash
powershell -NoProfile -ExecutionPolicy Bypass \
    -File "__PI_HOME__/.pi/agent/skills/apple-emoji-windows/scripts/apply-apple-emoji-elevated.ps1" \
    -Mode Restore
```

Before rebooting it just cancels the queued swap (no reboot needed); after, it
queues the stock font to return on the next boot. Its source is
`seguiemj-ORIGINAL.ttf` in the checkout; if that is lost, `sfc /scannow`
restores the Microsoft original.

## Gotchas that cost real time

- **`Get-FileHash` disappears** when a PowerShell 7 module path leaks into
  Windows PowerShell 5.1 from this bash shell: 5.1 then loads PS7's
  `Microsoft.PowerShell.Utility`, which does not export it, and the apply script
  dies at step 2 with `The term 'Get-FileHash' is not recognized`. Fix: set
  `$env:PSModulePath` to the **Machine** value before launching (the wrapper
  does this). This is the single most likely failure on a re-run.
- **`Tee-Object` writes UTF-16LE**, which looks like spaced-out letters in bash.
  Use `Out-File`/`Set-Content -Encoding UTF8` for the log.
- The current font's SHA256 is usually **not** one of the script's known stock
  hashes (Windows Update replaces it) — that is a warning, not a failure.
- Restore-point creation may be skipped by Windows' 1440-minute throttle; the
  verified file backup is the real safety net.
- `FontCache3.0.0.0` does not exist on this build; only `FontCache` is stopped
  and restarted.
- **Windows Update and `sfc /scannow` silently revert it** back to Segoe. When
  emoji change overnight, that is why: re-run apply + reboot.
- Apps that ship their own emoji (Discord desktop, Slack) are unaffected.
- **Licensing:** Apple Color Emoji is licensed for Apple hardware only.
  Installing it here is very likely a licence breach — say so once, plainly,
  and let Freddy decide. The repo ships no font data.
- Keep `seguiemj-ORIGINAL.ttf` and the checkout: 245 MB font + 263 MB optimised
  build + 13 MB backup ≈ 520 MB of disk.
