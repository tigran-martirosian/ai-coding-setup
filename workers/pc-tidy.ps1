# What is holding this computer's memory, and what finished sessions left behind.
#   powershell -NoProfile -File pc-tidy.ps1        report only, changes nothing
#   powershell -NoProfile -File pc-tidy.ps1 -Go    also stops the leftovers it lists
# Leftovers are only: shells of a closed Claude session and Gradle daemons, older than 3 hours.
# It stops nothing else, so run -Go when no build or test is running.
param([switch]$Go)
$hours = 3
$now = Get-Date
$all = Get-CimInstance Win32_Process
$ids = @{}; $all | ForEach-Object { $ids[[int]$_.ProcessId] = $true }
$hasChild = @{}; $all | ForEach-Object { $hasChild[[int]$_.ParentProcessId] = $true }
$ram = { param($list) [math]::Round(($list | Measure-Object WorkingSetSize -Sum).Sum / 1GB, 1) }
$old = { param($p) ($now - $p.CreationDate).TotalHours -gt $hours }

$os = Get-CimInstance Win32_OperatingSystem
$free = [math]::Round((Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue / 1024, 1)
"MEMORY  {0} GB free of {1:N1} GB, {2} programs running" -f $free, ($os.TotalVisibleMemorySize / 1MB), $all.Count
""
"BIGGEST"
$all | Group-Object { $_.Name -replace '\.exe$', '' } | ForEach-Object { [pscustomobject]@{ GB = (& $ram $_.Group); N = $_.Count; Name = $_.Name } } | Sort-Object GB -Descending | Select-Object -First 8 | ForEach-Object { "  {0,5:N1} GB  {1}  ({2})" -f $_.GB, $_.Name, $_.N }
""
$main = $all | Where-Object { $_.Name -eq 'Nimbalyst.exe' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
if ($main) {
  $app = $all | Where-Object { $_.Name -in 'Nimbalyst.exe', 'msedgewebview2.exe', 'claude.exe' }
  $age = [math]::Round(($now - $main.CreationDate).TotalHours)
  "NIMBALYST  open {0} hours, {1} GB with its sessions and panels{2}" -f $age, (& $ram $app), $(if ($age -gt 24) { ': restart it once no session is working' } else { '' })
  ""
}
$shells = $all | Where-Object { $_.Name -in 'bash.exe', 'sh.exe' -and $_.CommandLine -match 'shell-snapshots' -and -not $ids.ContainsKey([int]$_.ParentProcessId) -and -not $hasChild.ContainsKey([int]$_.ProcessId) }
$gradle = $all | Where-Object { $_.Name -like 'java*' -and $_.CommandLine -match 'GradleDaemon|GradleWorkerMain' }
$left = @(@($shells) + @($gradle) | Where-Object { $_ -and (& $old $_) })
"LEFTOVERS  {0}, {1} GB" -f $left.Count, (& $ram $left)
foreach ($p in $left) {
  $line = "  {0,6}  {1,5} MB  started {2:MM-dd HH:mm}  {3}" -f $p.ProcessId, [int]($p.WorkingSetSize / 1MB), $p.CreationDate, $p.Name
  if ($Go) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $line += '  stopped' } catch { $line += "  NOT STOPPED: $($_.Exception.Message)" }
  }
  $line
}
