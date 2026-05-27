# =====================================================
# Local pipeline runner (venv -> crawler -> analyzer)
# Usage:
#   .\run-pipeline.ps1                 # full run
#   .\run-pipeline.ps1 -SkipCrawl      # only analyzer
#   .\run-pipeline.ps1 -SkipAnalyze    # only crawler
# =====================================================

param(
    [switch]$SkipCrawl,
    [switch]$SkipAnalyze
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

# ----- env var check -----
$missing = @()
if (-not $env:SUPABASE_URL)         { $missing += "SUPABASE_URL" }
if (-not $env:SUPABASE_SERVICE_KEY) { $missing += "SUPABASE_SERVICE_KEY" }
if (-not $env:ANTHROPIC_API_KEY -and -not $SkipAnalyze) { $missing += "ANTHROPIC_API_KEY" }

if ($missing.Count -gt 0) {
    Write-Host "ERROR: missing env vars: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "  Run .\setup-env.ps1 first" -ForegroundColor Yellow
    exit 1
}

# ----- check location -----
if (-not (Test-Path ".\scripts\crawl_musinsa.py")) {
    Write-Host "ERROR: scripts\crawl_musinsa.py not found. Run from vlvd-dashboard root." -ForegroundColor Red
    exit 1
}
Set-Location .\scripts

# ----- venv -----
Write-Step "Python venv"

if (-not (Test-Path ".\.venv")) {
    Write-Host "  Creating venv..."
    python -m venv .venv
}

$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -eq "Restricted") {
    Write-Host "  Setting ExecutionPolicy to RemoteSigned..."
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
}

. .\.venv\Scripts\Activate.ps1
Write-Host "  [OK] venv activated" -ForegroundColor Green

Write-Host "  Checking pip dependencies..."
pip install -q -r requirements.txt
Write-Host "  [OK] dependencies ready" -ForegroundColor Green

# ----- crawler -----
if (-not $SkipCrawl) {
    Write-Step "Crawler (Musinsa rankings)"
    python crawl_musinsa.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: crawler failed. Check log above." -ForegroundColor Red
        Set-Location ..
        exit 1
    }
}

# ----- analyzer -----
if (-not $SkipAnalyze) {
    Write-Step "AI Analyzer (Claude Sonnet 7-axis tagging)"
    Write-Host "  Cost: ~10 KRW/item. Ctrl+C to stop anytime." -ForegroundColor Yellow
    python analyze_with_claude_v2.py
}

Set-Location ..
Write-Step "Pipeline complete"
Write-Host "  Check Supabase Table Editor:" -ForegroundColor White
Write-Host "    * trend_products       (crawled products)" -ForegroundColor Gray
Write-Host "    * trend_metrics_daily  (today's snapshot)" -ForegroundColor Gray
Write-Host "    * trend_analysis       (AI-extracted 7-axis tags)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Then: npm run dev -> http://localhost:5173/trend" -ForegroundColor White
