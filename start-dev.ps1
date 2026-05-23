# start-dev.ps1 — Starts Redis, FastAPI backend, and Celery worker in separate windows

$BackendDir = Join-Path $PSScriptRoot "backend"

Write-Host "Starting Redis..." -ForegroundColor Cyan
docker run -d --name alfresco-redis -p 6379:6379 redis:7-alpine 2>$null
if ($LASTEXITCODE -ne 0) {
    # Already running — just start it if stopped
    docker start alfresco-redis 2>$null
}
Write-Host "Redis ready on port 6379" -ForegroundColor Green

Write-Host "Starting FastAPI backend (http://localhost:8000)..." -ForegroundColor Cyan
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$BackendDir'; python -m uvicorn app.main:app --reload --port 8000" -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host "Starting Celery worker..." -ForegroundColor Cyan
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$BackendDir'; python -m celery -A worker.celery_app worker --loglevel=info --pool=solo" -WindowStyle Normal

Write-Host ""
Write-Host "All services started!" -ForegroundColor Green
Write-Host "  UI:     http://localhost:8000" -ForegroundColor Yellow
Write-Host "  API:    http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host "  Redis:  localhost:6379" -ForegroundColor Yellow
Write-Host ""
Write-Host "Close the opened terminal windows to stop the backend and worker." -ForegroundColor Gray

