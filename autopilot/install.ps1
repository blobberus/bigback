<#
  Registers the hourly "BigbackAutopilot" scheduled task for the current user.
    powershell -ExecutionPolicy Bypass -File autopilot\install.ps1 [-Start "08:05"] [-Days 3]
  Remove with autopilot\uninstall.ps1, or pause with:  New-Item autopilot\STOP
#>
param(
  [string]$Start = '08:05',   # first run (today, or tomorrow if already past)
  [int]$Days = 3              # stop repeating after this many days
)
$runner = Join-Path $PSScriptRoot 'run.ps1'
$first  = [datetime]::ParseExact($Start, 'HH:mm', $null)
if ($first -lt (Get-Date)) { $first = (Get-Date).AddMinutes(2) }

$action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
              -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger  = New-ScheduledTaskTrigger -Once -At $first `
              -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days $Days)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries -WakeToRun -MultipleInstances IgnoreNew `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 59)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'BigbackAutopilot' -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force `
  -Description 'Hourly headless Claude Code run that continues the Bigback build (autopilot/TASKS.md).' | Out-Null
Write-Output "BigbackAutopilot registered. First run: $first, then hourly for $Days day(s)."
