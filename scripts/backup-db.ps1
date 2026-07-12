# ============================================================
# Full database backup — OX-Dashboard Supabase project
#
# Dumps the entire public schema (tables + data + functions/triggers/
# policies) to backups/ox_dashboard_<date>.sql using the Supabase CLI
# (fetched via npx — no install needed). Run from the repo root:
#
#   powershell -File scripts/backup-db.ps1
#
# You'll be asked for the DATABASE PASSWORD once — find it in
# Supabase Dashboard → Project Settings → Database → Database password
# (or reset it there). It is NOT the anon/service key.
#
# backups/ is gitignored — the dump contains member data. Copy the
# file somewhere safe (external drive / private cloud) after running.
# ============================================================

$ErrorActionPreference = "Stop"

$projectRef = "brkbgabkhoamzmuyyjns"
$backupDir  = Join-Path $PSScriptRoot "..\backups"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Force $backupDir | Out-Null }

$stamp   = Get-Date -Format "yyyy-MM-dd_HHmm"
$roles   = Join-Path $backupDir "ox_dashboard_${stamp}_roles.sql"
$schema  = Join-Path $backupDir "ox_dashboard_${stamp}_schema.sql"
$data    = Join-Path $backupDir "ox_dashboard_${stamp}_data.sql"

$pw = Read-Host "Database password (Dashboard -> Project Settings -> Database)" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))

# Session pooler host works from any network (direct db host is often
# blocked on IPv4-only connections).
$dbUrl = "postgresql://postgres.${projectRef}:${plain}@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"

Write-Host "Dumping schema (tables, functions, triggers, policies)..." -ForegroundColor Cyan
npx --yes supabase@latest db dump --db-url $dbUrl -f $schema
if ($LASTEXITCODE -ne 0) { throw "Schema dump failed" }

Write-Host "Dumping data (all rows)..." -ForegroundColor Cyan
npx --yes supabase@latest db dump --db-url $dbUrl --data-only -f $data
if ($LASTEXITCODE -ne 0) { throw "Data dump failed" }

Write-Host "Dumping roles..." -ForegroundColor Cyan
npx --yes supabase@latest db dump --db-url $dbUrl --role-only -f $roles
if ($LASTEXITCODE -ne 0) { Write-Warning "Roles dump failed (non-fatal)" }

Write-Host ""
Write-Host "Backup complete:" -ForegroundColor Green
Get-ChildItem $backupDir -Filter "ox_dashboard_${stamp}*" | ForEach-Object {
  Write-Host ("  {0}  ({1:N0} KB)" -f $_.Name, ($_.Length / 1KB))
}
Write-Host ""
Write-Host "Copy these files off this machine (external drive / private cloud)." -ForegroundColor Yellow
