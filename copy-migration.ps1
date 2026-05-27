# =====================================================
# Supabase Migration Helper
# Copy a migration SQL to clipboard
# Usage: .\copy-migration.ps1 -Step 1   (or 2, 3)
# =====================================================

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet(1, 2, 3)]
    [int]$Step
)

$files = @{
    1 = ".\supabase\migrations\20260527_create_trend_tables.sql"
    2 = ".\supabase\migrations\20260527_create_rpc_functions.sql"
    3 = ".\supabase\migrations\20260528_add_7axis_tagging.sql"
}

$names = @{
    1 = "Step 1 - Create tables (trend_products, metrics_daily, analysis, planning_board)"
    2 = "Step 2 - RPC functions (hot_items_this_week, top_brands_this_week, refresh_trend_summary)"
    3 = "Step 3 - 7-axis tagging columns (mood, graphic, save_count, view_count, ai_notes)"
}

$file = $files[$Step]

if (-not (Test-Path $file)) {
    Write-Host "ERROR: $file not found" -ForegroundColor Red
    exit 1
}

Get-Content $file -Raw | Set-Clipboard

Write-Host ""
Write-Host "[OK] Step $Step copied to clipboard" -ForegroundColor Green
Write-Host "  $($names[$Step])" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next:" -ForegroundColor White
Write-Host "  1) Open https://supabase.com/dashboard" -ForegroundColor White
Write-Host "  2) Your project -> SQL Editor -> New query" -ForegroundColor White
Write-Host "  3) Paste (Ctrl+V) -> Run" -ForegroundColor White
Write-Host "  4) After Success message, run next:" -ForegroundColor White
if ($Step -lt 3) {
    $next = $Step + 1
    Write-Host "     .\copy-migration.ps1 -Step $next" -ForegroundColor Yellow
} else {
    Write-Host "     Last step. Check Supabase Table Editor for 5 tables:" -ForegroundColor Yellow
    Write-Host "     trend_products / trend_metrics_daily / trend_analysis" -ForegroundColor Yellow
    Write-Host "     planning_board / trend_analysis_revisions" -ForegroundColor Yellow
}
