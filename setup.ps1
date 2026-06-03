# setup.ps1 — One-time setup for the Monash Assignment Pipeline
# Run as: PowerShell -ExecutionPolicy Bypass -File setup.ps1

Write-Host "`n=== Monash Assignment Pipeline Setup ===" -ForegroundColor Cyan

# ── 1. Check prerequisites ────────────────────────────────────────────────
Write-Host "`n[1/6] Checking prerequisites..." -ForegroundColor Yellow

$missing = @()
foreach ($tool in @('docker','node','npm')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    $missing += $tool
  }
}
if ($missing) {
  Write-Host "MISSING: $($missing -join ', ')" -ForegroundColor Red
  Write-Host "Please install the missing tools and re-run setup."
  exit 1
}
Write-Host "  docker, node, npm — all found" -ForegroundColor Green

# ── 2. Create .env from example ───────────────────────────────────────────
Write-Host "`n[2/6] Setting up environment config..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "  Created .env from .env.example" -ForegroundColor Green
  Write-Host "  ** IMPORTANT: Edit .env and fill in your Moodle credentials + Anthropic API key **" -ForegroundColor Red
} else {
  Write-Host "  .env already exists — skipping" -ForegroundColor Green
}

# ── 3. Create output directories ─────────────────────────────────────────
Write-Host "`n[3/6] Creating output directories..." -ForegroundColor Yellow
$dirs = @(
  "workspace",
  "C:\Users\$env:USERNAME\Desktop\Monash\Assignments"
)
foreach ($d in $dirs) {
  if (-not (Test-Path $d)) {
    New-Item -ItemType Directory -Force $d | Out-Null
    Write-Host "  Created: $d" -ForegroundColor Green
  } else {
    Write-Host "  Exists:  $d" -ForegroundColor Gray
  }
}

# ── 4. Install Playwright deps ────────────────────────────────────────────
Write-Host "`n[4/6] Installing Playwright dependencies..." -ForegroundColor Yellow
Push-Location playwright
npm install
if ($LASTEXITCODE -eq 0) {
  npx playwright install chromium
  Write-Host "  Playwright ready" -ForegroundColor Green
} else {
  Write-Host "  npm install failed — check Node.js" -ForegroundColor Red
}
Pop-Location

# ── 5. Install scripts deps ────────────────────────────────────────────
Write-Host "`n[5/6] Installing scripts dependencies..." -ForegroundColor Yellow
# fs-extra needed by package-submission.js
Push-Location scripts
if (-not (Test-Path "package.json")) {
  '{"name":"pipeline-scripts","version":"1.0.0","dependencies":{"fs-extra":"^11.2.0","dotenv":"^16.4.5"}}' | Out-File package.json -Encoding utf8
}
npm install
Pop-Location

# ── 6. Build Docker image ─────────────────────────────────────────────────
Write-Host "`n[6/6] Building Docker container..." -ForegroundColor Yellow
Write-Host "  This may take 5-10 minutes (first time, downloads LaTeX)..." -ForegroundColor Gray

# Copy run-tests.sh to expected location for Docker build
if (-not (Test-Path "docker\scripts")) {
  New-Item -ItemType Directory -Force "docker\scripts" | Out-Null
}

docker build -t monash-assignment-runner ./docker
if ($LASTEXITCODE -eq 0) {
  Write-Host "  Docker image built successfully" -ForegroundColor Green
} else {
  Write-Host "  Docker build failed — check Docker Desktop is running" -ForegroundColor Red
  exit 1
}

# ── Done ──────────────────────────────────────────────────────────────────
Write-Host "`n=== Setup Complete! ===" -ForegroundColor Cyan
Write-Host @"

Next steps:
  1. Edit .env with your credentials:
       MOODLE_USERNAME = your.name@student.monash.edu
       MOODLE_PASSWORD = yourPassword
       ANTHROPIC_API_KEY = sk-ant-...

  2. Start n8n:
       cd docker && docker-compose up -d

  3. Open n8n: http://localhost:5678

  4. Import workflow.json:
       n8n UI → Workflows → Import from File → select workflow.json

  5. Add your Anthropic API credentials in n8n:
       Settings → Credentials → Add → Anthropic API

  6. Update credential IDs in workflow nodes (search for REPLACE_WITH_ANTHROPIC_CRED_ID)

  7. Click "Execute Workflow" and watch the pipeline run!
     - A browser window will open for Moodle SSO login
     - When Duo shows a number, enter it in your Duo app
     - The pipeline handles everything else automatically

"@ -ForegroundColor White
