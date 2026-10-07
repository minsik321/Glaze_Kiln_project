# Restart the Kiln dev servers (frontend + backend).
# 1) stop old uvicorn / vite processes of this project  2) pick a free API port  3) start both.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "[1/3] Stopping old dev servers..."

$rootPattern = [regex]::Escape($root)
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -match '^python' -and $_.CommandLine -match 'uvicorn|multiprocessing\.spawn|backend\.app\.main') -or
  ($_.Name -match '^node' -and $_.CommandLine -match $rootPattern)
} | ForEach-Object {
  Write-Host ("  stop PID {0} ({1})" -f $_.ProcessId, $_.Name)
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

Write-Host "[2/3] Checking API port..."
$port = 8000
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
  $port = 8001
  Write-Host "  port 8000 is still held by a dead process -> using 8001 for this session"
  Write-Host "  (reboot Windows once to release 8000)"
}
$env:VITE_API_URL = "http://127.0.0.1:$port"

Write-Host "[3/3] Starting servers (two new windows will open)..."
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$backendCmd = "cd /d `"$root`" && set PYTHONPATH=src&& `"$py`" -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port $port"
Start-Process cmd.exe -ArgumentList '/k', $backendCmd -WorkingDirectory $root
Start-Process cmd.exe -ArgumentList '/k', 'npm run dev:ui' -WorkingDirectory $root

Write-Host ""
Write-Host "Done. Frontend: http://127.0.0.1:5173   Backend: http://127.0.0.1:$port"
