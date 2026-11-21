@echo off
REM pi-loop (github.com/AfroPK/pi-loop, cloned to %USERPROFILE%\pi-loop; update: git -C %USERPROFILE%\pi-loop pull).
REM Forwards to the repo's windows\pi-loop.cmd (Git Bash + python3/systemctl shims). Settings: %USERPROFILE%\.config\pi-local\env
REM Usage in a project folder: pi-loop TASK.md, pi-loop "task", pi-loop (resume), pi-loop --tui ..., pi-loop --run pi-code-review -p
REM Installed 2026-11-02; backups of the Pi config: *.bak-20261102-piloop and %USERPROFILE%\.pi\backup-20261102-piloop
set "PI_BASH=__PI_HOME__\scoop\apps\git\current\bin\bash.exe"
"%USERPROFILE%\pi-loop\windows\pi-loop.cmd" %*
