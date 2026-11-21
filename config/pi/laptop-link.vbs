' laptop-link at login - runs invisibly: forwards this PC's model servers to the Omarchy laptop.
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File __PI_HOME__\.pi\laptop-link.ps1 silent", 0, False
