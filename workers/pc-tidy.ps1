# What is holding this computer's memory, and what finished sessions left behind.
#   powershell -NoProfile -File pc-tidy.ps1        report only, changes nothing
#   powershell -NoProfile -File pc-tidy.ps1 -Go    also stops the leftovers it lists, each with what it started
# Leftovers, all older than 3 hours:
#   - Gradle daemons
#   - orphans (the program that started them has closed) of the kinds Claude's work leaves behind:
#     shells of a closed Claude session, Git's command-line tools (tail, grep, sleep ... from a watcher),
#     headless browsers, and node or python run from .claude, Temp or npx.
#   Other orphaned node or python (a bot, a global tool's daemon) is listed as MAYBE WANTED and never stopped.
# It never stops Nimbalyst, the setup's Nimbalyst delivery (anything run from tools/nimbalyst-patch), a terminal window, ssh or gpg agents, a browser you see, or anything whose
# starter is still running, so run -Go when no build or test is running.
# It also names listening ports still held by a program that has closed (they block a restart on that port).
# Tests: -ProcessFile <json> and -PortFile <json> read a made-up process and port list instead of the real ones.
param([switch]$Go, [string]$ProcessFile, [string]$PortFile)
$hours = 3
$now = Get-Date
if ($ProcessFile) {
  if ($Go) { throw '-Go cannot be used with -ProcessFile' }
  $all = (Get-Content -Raw $ProcessFile | ConvertFrom-Json) | ForEach-Object { $_.CreationDate = [datetime]$_.CreationDate; $_ }
} else {
  $all = Get-CimInstance Win32_Process
}
$byId = @{}; $all | ForEach-Object { $byId[[int]$_.ProcessId] = $_ }
$ram = { param($list) [math]::Round(($list | Measure-Object WorkingSetSize -Sum).Sum / 1GB, 1) }
$old = { param($p) ($now - $p.CreationDate).TotalHours -gt $hours }
# Orphan: its starter is gone (or the starter's number now belongs to a newer program)
$orphan = { param($p) $parent = $byId[[int]$p.ParentProcessId]; -not $parent -or $parent.CreationDate -gt $p.CreationDate }

if (-not $ProcessFile) {
  $os = Get-CimInstance Win32_OperatingSystem
  $free = [math]::Round((Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue / 1024, 1)
  "MEMORY  {0} GB free of {1:N1} GB, {2} programs running" -f $free, ($os.TotalVisibleMemorySize / 1MB), $all.Count
  ""
}
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

$kinds = @(
  @{ Why = 'shell of a closed session'; Test = { param($p) $p.Name -in 'bash.exe', 'sh.exe' -and $p.CommandLine -match 'shell-snapshots' } },
  @{ Why = 'command-line tool';         Test = { param($p) "$($p.ExecutablePath)" -match '\\Git\\(usr\\)?bin\\' -and $p.Name -notin 'mintty.exe', 'ssh-agent.exe', 'gpg-agent.exe', 'git-bash.exe' } },
  @{ Why = 'headless browser';          Test = { param($p) $p.Name -in 'chrome.exe', 'msedge.exe', 'chromium.exe', 'chrome-headless-shell.exe' -and $p.CommandLine -match '--headless' -and $p.CommandLine -notmatch '--type=' } },
  @{ Why = 'script from Claude or Temp'; Test = { param($p) $p.Name -in $scripts -and $p.CommandLine -match '\\\.claude\\|/\.claude/|npm-cache|_npx|\\Temp\\' } }
)
$scripts = 'node.exe', 'python.exe', 'pythonw.exe', 'bun.exe', 'deno.exe'
# The Nimbalyst delivery waits for Nimbalyst to close, then swaps its files: stopping it leaves a half-done update
$delivery = 'tools[\\/]nimbalyst-patch[\\/]'
$left = [System.Collections.Generic.List[object]]::new()
$maybe = [System.Collections.Generic.List[object]]::new()
foreach ($p in $all) {
  if ($p.Name -eq 'Nimbalyst.exe' -or "$($p.CommandLine)" -match $delivery -or -not (& $old $p)) { continue }
  if ($p.Name -like 'java*' -and $p.CommandLine -match 'GradleDaemon|GradleWorkerMain') { $left.Add([pscustomobject]@{ P = $p; Why = 'Gradle daemon' }); continue }
  if (-not (& $orphan $p)) { continue }
  $hit = $null; foreach ($k in $kinds) { if (& $k.Test $p) { $hit = $k.Why; break } }
  if ($hit) { $left.Add([pscustomobject]@{ P = $p; Why = $hit }) }
  elseif ($p.Name -in $scripts) { $maybe.Add($p) }  # a bot or daemon run from a project or a global tool may be wanted
}
"LEFTOVERS  {0}, {1} GB" -f $left.Count, (& $ram @($left | ForEach-Object { $_.P }))
foreach ($l in $left) {
  $p = $l.P
  $line = "  {0,6}  {1,5} MB  started {2:MM-dd HH:mm}  {3}  ({4})" -f $p.ProcessId, [int]($p.WorkingSetSize / 1MB), $p.CreationDate, $p.Name, $l.Why
  if ($Go) {
    # /T also stops what it started (a watcher's tail, a shell's browser)
    $out = & taskkill.exe /F /T /PID $p.ProcessId 2>&1
    $line += $(if ($LASTEXITCODE -eq 0) { '  stopped' } elseif (-not (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue)) { '  stopped (with its starter)' } else { "  NOT STOPPED: $out" })
  }
  $line
}
if ($maybe.Count) {
  ""
  "MAYBE WANTED  never stopped: their starter closed, but a bot or daemon can be meant to run on; ask the user"
  foreach ($p in $maybe) { "  {0,6}  {1,5} MB  started {2:MM-dd HH:mm}  {3}  {4}" -f $p.ProcessId, [int]($p.WorkingSetSize / 1MB), $p.CreationDate, $p.Name, (($p.CommandLine -replace '^"[^"]*"\s*|^\S+\s*', '') -replace '^(.{90}).+', '$1...') }
}

# Ports a closed program still holds: Windows keeps them while a leftover holds a handle to it
if ($PortFile) { $ports = (Get-Content -Raw $PortFile | ConvertFrom-Json) | ForEach-Object { $_ } }
else {
  if ($Go) { $byId = @{}; Get-CimInstance Win32_Process | ForEach-Object { $byId[[int]$_.ProcessId] = $_ } }
  $ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Port = $_.LocalPort; Pid = $_.OwningProcess } }
}
$ghost = @($ports | Where-Object { $_.Pid -gt 4 -and -not $byId[[int]$_.Pid] } | Sort-Object Port -Unique)
if ($ghost.Count) {
  ""
  "PORTS HELD BY A CLOSED PROGRAM"
  foreach ($g in $ghost) { "  port {0}  (program {1}, closed)" -f $g.Port, $g.Pid }
  "  Stopping the leftovers above usually frees them; if one stays, a leftover outside these kinds holds it."
}
