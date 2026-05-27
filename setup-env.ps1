# =====================================================
# Environment variables + .env.local setup
# Usage: .\setup-env.ps1   (interactive)
# =====================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== VLVD Trend Environment Setup ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Get these values from Supabase Dashboard -> Project Settings -> API:" -ForegroundColor White
Write-Host "  * Project URL   (https://xxxxx.supabase.co)" -ForegroundColor Gray
Write-Host "  * anon public   (eyJh... format)" -ForegroundColor Gray
Write-Host "  * service_role  (eyJh... format, NEVER share publicly)" -ForegroundColor Gray
Write-Host ""
Write-Host "Get Anthropic key from https://console.anthropic.com (sk-ant-... format)" -ForegroundColor White
Write-Host ""

$SUPABASE_URL = Read-Host "Project URL"
if ($SUPABASE_URL -notmatch "^https://.*\.supabase\.co") {
    Write-Host "[!] URL format looks unusual. Continuing anyway." -ForegroundColor Yellow
}

$ANON_KEY = Read-Host "anon public key"
$SERVICE_KEY = Read-Host "service_role key"
$ANTHROPIC_KEY = Read-Host "Anthropic API key (sk-ant-...)"

# .env.local (for frontend)
$envContent = "VITE_SUPABASE_URL=$SUPABASE_URL`nVITE_SUPABASE_ANON_KEY=$ANON_KEY"
$envContent | Out-File -FilePath .\.env.local -Encoding utf8 -NoNewline

Write-Host ""
Write-Host "[OK] .env.local created (for frontend)" -ForegroundColor Green

# Session env vars (for Python scripts)
$env:SUPABASE_URL = $SUPABASE_URL
$env:SUPABASE_SERVICE_KEY = $SERVICE_KEY
$env:ANTHROPIC_API_KEY = $ANTHROPIC_KEY

Write-Host "[OK] Environment variables set for current PowerShell session" -ForegroundColor Green
Write-Host ""

$saveForever = Read-Host "Save to user environment variables? (y/n)"
if ($saveForever -eq "y") {
    [Environment]::SetEnvironmentVariable("SUPABASE_URL", $SUPABASE_URL, "User")
    [Environment]::SetEnvironmentVariable("SUPABASE_SERVICE_KEY", $SERVICE_KEY, "User")
    [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $ANTHROPIC_KEY, "User")
    Write-Host "[OK] Saved permanently (available in new PowerShell windows)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Next steps ===" -ForegroundColor Cyan
Write-Host "  npm run dev               (start frontend)" -ForegroundColor White
Write-Host "  cd scripts                (go to scripts folder)" -ForegroundColor White
Write-Host "  python crawl_musinsa.py   (test crawler)" -ForegroundColor White
Write-Host ""
