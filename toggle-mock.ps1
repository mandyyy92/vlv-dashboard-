# =====================================================
# Toggle mock / real data mode
# Usage:
#   .\toggle-mock.ps1 -Mode mock    # mock ON
#   .\toggle-mock.ps1 -Mode real    # mock OFF (real data)
# =====================================================

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("mock", "real")]
    [string]$Mode
)

$file = ".\src\pages\TrendDashboard.jsx"

if (-not (Test-Path $file)) {
    Write-Host "ERROR: $file not found" -ForegroundColor Red
    exit 1
}

$content = Get-Content $file -Raw
$pattern = "useState\((true|false)\)"

if ($Mode -eq "mock") {
    $newContent = $content -replace $pattern, "useState(true)"
    $label = "MOCK data mode"
} else {
    $newContent = $content -replace $pattern, "useState(false)"
    $label = "REAL data mode"
}

$newContent | Out-File $file -Encoding utf8 -NoNewline

Write-Host ""
Write-Host "[OK] Switched to $label" -ForegroundColor Green
Write-Host "  Dev server will hot-reload automatically." -ForegroundColor Gray
