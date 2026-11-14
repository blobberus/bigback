# Removes the hourly BigbackAutopilot scheduled task.
Unregister-ScheduledTask -TaskName 'BigbackAutopilot' -Confirm:$false -ErrorAction SilentlyContinue
Write-Output 'BigbackAutopilot removed.'
