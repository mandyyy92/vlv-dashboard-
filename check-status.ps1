# =====================================================
# VLVD Trend setup status check
# Usage: .\check-status.ps1
# =====================================================

Write-Host ""
Write-Host "=== VLVD Trend Setup Status ===" -ForegroundColor Cyan
Write-Host ""

function Check($desc, $test) {
    if (& $test) {
        Write-Host "  [OK] $desc" -ForegroundColor Green
        return 1
    } else {
        Write-Host "  [--] $desc" -ForegroundColor Red
        return 0
    }
}

$score = 0
$total = 0

Write-Host "[1] Files" -ForegroundColor White
$total++; $score += (Check "TrendDashboard.jsx exists"  { Test-Path ".\src\pages\TrendDashboard.jsx" })
$total++; $score += (Check "taxonomy.js exists"         { Test-Path ".\src\lib\taxonomy.js" })
$total++; $score += (Check "TrendItemCard.jsx exists"   { Test-Path ".\src\components\trend\TrendItemCard.jsx" })
$total++; $score += (Check "MasonryGrid.jsx exists"     { Test-Path ".\src\components\trend\MasonryGrid.jsx" })
$total++; $score += (Check "crawl_musinsa.py exists"    { Test-Path ".\scripts\crawl_musinsa.py" })
$total++; $score += (Check "analyze_with_claude_v2.py exists" { Test-Path ".\scripts\analyze_with_claude_v2.py" })
$total++; $score += (Check "3 SQL migrations exist"     { (Get-ChildItem ".\supabase\migrations\*.sql" -ErrorAction SilentlyContinue).Count -ge 3 })

Write-Host ""
Write-Host "[2] npm packages" -ForegroundColor White
$pkg = if (Test-Path ".\package.json") { Get-Content ".\package.json" -Raw } else { "" }
$total++; $score += (Check "recharts installed"             { $pkg -match '"recharts"' })
$total++; $score += (Check "lucide-react installed"         { $pkg -match '"lucide-react"' })
$total++; $score += (Check "@supabase/supabase-js installed" { $pkg -match '"@supabase/supabase-js"' })

Write-Host ""
Write-Host "[3] Router" -ForegroundColor White
$total++; $score += (Check "App.jsx imports TrendDashboard" {
    (Test-Path ".\src\App.jsx") -and ((Get-Content ".\src\App.jsx" -Raw) -match "TrendDashboard")
})

Write-Host ""
Write-Host "[4] Env vars / keys" -ForegroundColor White
$total++; $score += (Check ".env.local exists"           { Test-Path ".\.env.local" })
$total++; $score += (Check "SUPABASE_URL set"            { [bool]$env:SUPABASE_URL })
$total++; $score += (Check "SUPABASE_SERVICE_KEY set"    { [bool]$env:SUPABASE_SERVICE_KEY })
$total++; $score += (Check "ANTHROPIC_API_KEY set"       { [bool]$env:ANTHROPIC_API_KEY })

Write-Host ""
Write-Host "[5] Python" -ForegroundColor White
$total++; $score += (Check "scripts\.venv exists"        { Test-Path ".\scripts\.venv" })

Write-Host ""
Write-Host "[6] Git" -ForegroundColor White
$branch = git rev-parse --abbrev-ref HEAD 2>$null
$total++; $score += (Check "On feature/trend-module branch" { $branch -eq "feature/trend-module" })
$total++; $score += (Check ".env.local in .gitignore"    {
    (Test-Path ".\.gitignore") -and ((Get-Content ".\.gitignore" -Raw) -match "\.env\.local")
})

Write-Host ""
Write-Host "=== Result: $score / $total ===" -ForegroundColor Cyan

$pct = [math]::Round($score * 100 / $total)
if ($pct -eq 100)      { Write-Host "All set!" -ForegroundColor Green }
elseif ($pct -ge 80)   { Write-Host "Almost there." -ForegroundColor Green }
elseif ($pct -ge 50)   { Write-Host "Halfway. Address [--] items above." -ForegroundColor Yellow }
else                   { Write-Host "Just starting. Run setup-vlvd-trend.ps1 first." -ForegroundColor Yellow }
Write-Host ""
