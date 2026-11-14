<#
  Bigback autopilot — re-prompts a headless Claude Code session to continue the build.
  Started hourly by the "BigbackAutopilot" scheduled task (see install.ps1).
  Independent of any interactive session: if the account is out of tokens the run
  simply fails fast and the next hour tries again.

  Stop switches:  autopilot\STOP  (manual halt)   autopilot\DONE  (build finished)
#>
$ErrorActionPreference = 'Continue'
$repo    = Split-Path -Parent $PSScriptRoot
$pilot   = $PSScriptRoot
$logDir  = Join-Path $pilot 'logs'
$lock    = Join-Path $pilot '.lock'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$log     = Join-Path $logDir "run-$stamp.log"
$timeoutMin = 55

New-Item -ItemType Directory -Force $logDir | Out-Null
function Log($m) { "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m | Add-Content -Path $log -Encoding utf8 }

if (Test-Path (Join-Path $pilot 'STOP')) { Log 'STOP file present - exiting.'; exit 0 }
if (Test-Path (Join-Path $pilot 'DONE')) { Log 'DONE file present - exiting.'; exit 0 }

# Single-instance lock (stale after 75 min, or if the owning PID is gone).
if (Test-Path $lock) {
  $info  = Get-Content $lock -ErrorAction SilentlyContinue
  $age   = (Get-Date) - (Get-Item $lock).LastWriteTime
  $alive = $false
  if ($info -match '^\d+$') { $alive = [bool](Get-Process -Id ([int]$info) -ErrorAction SilentlyContinue) }
  if ($alive -and $age.TotalMinutes -lt 75) { Log "Another run is active (pid $info) - exiting."; exit 0 }
  Log "Removing stale lock ($info, $([int]$age.TotalMinutes) min old)."
}
$PID | Set-Content -Path $lock -Encoding ascii

try {
  Set-Location $repo
  # Pick up commits pushed from the phone (uploads, notes, ratings) before working.
  git pull --rebase --autostash origin main *>> $log

  $claude = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
  if (-not (Test-Path $claude)) { $claude = (Get-Command claude -ErrorAction SilentlyContinue).Source }
  if (-not $claude) { Log 'claude CLI not found.'; exit 1 }

  $prompt = 'Follow autopilot/PROMPT.md exactly. Use the Bash tool for shell commands.'
  # Scoped allow-list for unattended runs only (edits auto-accepted; anything else is denied).
  $tools = @('Read','Edit','Write','Glob','Grep','WebFetch','WebSearch','Agent','TodoWrite',
             'Bash(git *)','Bash(python *)','Bash(py *)','Bash(gh *)','Bash(ls *)','Bash(mkdir *)',
             'Bash(cat *)','Bash(head *)','Bash(tail *)','Bash(wc *)','Bash(grep *)','Bash(yt-dlp *)') -join ','
  $cliArgs = @('-p', "`"$prompt`"", '--permission-mode', 'acceptEdits',
               '--allowedTools', "`"$tools`"",
               '--disallowedTools', '"Bash(git push --force*),Bash(git push -f*),Bash(git reset --hard*)"',
               '--output-format', 'text')
  Log "Starting: $claude $($cliArgs -join ' ')"

  $out = Join-Path $logDir "claude-$stamp.out.log"
  $err = Join-Path $logDir "claude-$stamp.err.log"
  $p = Start-Process -FilePath $claude -ArgumentList $cliArgs -WorkingDirectory $repo `
        -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -PassThru
  $null = $p.Handle   # cache handle so ExitCode is available on PS 5.1
  if (-not $p.WaitForExit($timeoutMin * 60 * 1000)) {
    Log "Timed out after $timeoutMin min - killing process tree."
    taskkill /PID $p.Id /T /F *>> $log
  } else {
    Log "claude exited with code $($p.ExitCode)."
  }

  # Safety net: push anything committed but not yet pushed.
  git push origin main *>> $log
} finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  # Keep the last 48 runs of logs.
  Get-ChildItem $logDir -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 144 |
    Remove-Item -Force -ErrorAction SilentlyContinue
}
