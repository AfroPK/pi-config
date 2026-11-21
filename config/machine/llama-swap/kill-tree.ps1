# llama-swap cmdStop for the Strata / XeStrata python wrappers: taskkill /T is refused on their trees
# (python > python > strata.exe), so stop every descendant of $Id with Stop-Process, deepest first.
param([Parameter(Mandatory)][int]$Id)
$all = Get-CimInstance Win32_Process
$ids = [System.Collections.Generic.List[int]]::new(); $ids.Add($Id)
for ($i = 0; $i -lt $ids.Count; $i++) { $all | ? { $_.ParentProcessId -eq $ids[$i] } | % { $ids.Add([int]$_.ProcessId) } }
$ids.Reverse()
$ids | % { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
