# =====================================================
# VLVD Trend Module - One-click Setup (ASCII-safe)
# Usage:
#   1) Place this file in vlvd-dashboard folder
#   2) PowerShell: .\setup-vlvd-trend.ps1
# =====================================================

param(
    [string]$DownloadFolder = "$env:USERPROFILE\Downloads",
    [string]$ZipV1 = "vlvd_trend_module.zip",
    [string]$ZipV2 = "vlvd_trend_v2_patch.zip"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "  [!] $msg" -ForegroundColor Yellow
}

# ----- 0. precheck -----
Write-Step "Precheck"

if (-not (Test-Path ".\package.json")) {
    Write-Host "ERROR: not an npm project. Run from vlvd-dashboard root." -ForegroundColor Red
    exit 1
}
Write-OK "vlvd-dashboard folder OK"

$v1 = Join-Path $DownloadFolder $ZipV1
$v2 = Join-Path $DownloadFolder $ZipV2

if (-not (Test-Path $v1)) { Write-Host "ERROR: $v1 not found" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $v2)) { Write-Host "ERROR: $v2 not found" -ForegroundColor Red; exit 1 }
Write-OK "Both zip files found"

# ----- 1. Git branch -----
Write-Step "Git branch"

$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -ne "feature/trend-module") {
    git checkout -b feature/trend-module
    Write-OK "Created feature/trend-module"
} else {
    Write-OK "Already on feature/trend-module"
}

# ----- 2. unzip -----
Write-Step "Extract zip files"

$tmp = "C:\temp\vlvd_unzip"
if (Test-Path $tmp) { Remove-Item -Path $tmp -Recurse -Force }
New-Item -Path $tmp -ItemType Directory -Force | Out-Null

Expand-Archive -Path $v1 -DestinationPath $tmp -Force
Expand-Archive -Path $v2 -DestinationPath $tmp -Force
Write-OK "Extracted to $tmp"

# ----- 3. copy files (v1 base) -----
Write-Step "Copy files (v1 base)"

Copy-Item -Path "$tmp\vlvd_trend\src\*"      -Destination ".\src\"     -Recurse -Force
Copy-Item -Path "$tmp\vlvd_trend\scripts"    -Destination "."          -Recurse -Force
Copy-Item -Path "$tmp\vlvd_trend\supabase"   -Destination "."          -Recurse -Force
Copy-Item -Path "$tmp\vlvd_trend\.github"    -Destination "."          -Recurse -Force
Write-OK "v1 base copied"

# ----- 4. copy v2 patch (overwrite) -----
Write-Step "Copy files (v2 patch overwrite)"
Copy-Item -Path "$tmp\vlvd_trend_v2\src\*"                 -Destination ".\src\"      -Recurse -Force
Copy-Item -Path "$tmp\vlvd_trend_v2\scripts\*"             -Destination ".\scripts\"  -Force
Copy-Item -Path "$tmp\vlvd_trend_v2\supabase\migrations\*" -Destination ".\supabase\migrations\" -Force
Write-OK "v2 patch applied"

# ----- 5. verify -----
Write-Step "Verify required files"

$required = @(
    ".\src\pages\TrendDashboard.jsx",
    ".\src\components\trend\KpiBar.jsx",
    ".\src\components\trend\TrendGraph.jsx",
    ".\src\components\trend\TrendItemCard.jsx",
    ".\src\components\trend\MasonryGrid.jsx",
    ".\src\lib\taxonomy.js",
    ".\src\lib\supabaseClient.js",
    ".\src\lib\useTrendData.js",
    ".\src\lib\mockData.js",
    ".\scripts\crawl_musinsa.py",
    ".\scripts\analyze_with_claude_v2.py",
    ".\scripts\requirements.txt",
    ".\supabase\migrations\20260527_create_trend_tables.sql",
    ".\supabase\migrations\20260527_create_rpc_functions.sql",
    ".\supabase\migrations\20260528_add_7axis_tagging.sql"
)

$missing = $required | Where-Object { -not (Test-Path $_) }
if ($missing.Count -gt 0) {
    Write-Host "ERROR: missing files:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    exit 1
}
Write-OK ("All " + $required.Count + " required files exist")

# ----- 6. npm install -----
Write-Step "npm install"
npm install recharts lucide-react @supabase/supabase-js
Write-OK "npm install done"

# ----- 7. gitignore -----
Write-Step "Update .gitignore"

$gitignore = ".\.gitignore"
$lines = @(".env.local", ".venv/", "scripts/.venv/", "C:/temp/vlvd_unzip/")
$existing = if (Test-Path $gitignore) { Get-Content $gitignore } else { @() }
$added = 0
foreach ($l in $lines) {
    if ($existing -notcontains $l) {
        Add-Content -Path $gitignore -Value $l
        $added++
    }
}
Write-OK ".gitignore updated ($added lines added)"

# ----- 8. App.jsx check -----
Write-Step "App.jsx check"

$appJsx = ".\src\App.jsx"
if (Test-Path $appJsx) {
    $content = Get-Content $appJsx -Raw

    if ($content -match "TrendDashboard") {
        Write-OK "App.jsx already has TrendDashboard import"
    } else {
        Write-Warn "App.jsx auto-patch skipped (manual edit required)"
        Write-Host "    Open App.jsx in notepad and add 2 lines:" -ForegroundColor Yellow
        Write-Host "      1) import TrendDashboard from './pages/TrendDashboard'" -ForegroundColor Yellow
        Write-Host "      2) <Route path='/trend' element={<TrendDashboard />} />" -ForegroundColor Yellow
        Write-Host "    Command: notepad .\src\App.jsx" -ForegroundColor Yellow
    }
} else {
    Write-Warn "src\App.jsx not found"
}

# ----- done -----
Write-Step "Setup complete"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1) notepad .\src\App.jsx     (add the 2 lines above)" -ForegroundColor White
Write-Host "  2) npm run dev" -ForegroundColor White
Write-Host "  3) Open browser: http://localhost:5173/trend" -ForegroundColor White
Write-Host ""
