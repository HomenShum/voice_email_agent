# Comprehensive Test and Monitoring Script
# Tests Azure Functions, Pinecone connectivity, and E2E test suite

param(
    [switch]$SkipFunctionCheck = $false,
    [switch]$SkipPineconeCheck = $false,
    [switch]$SkipTests = $false,
    [switch]$FullVerification = $false,
    [switch]$GenerateReport = $true
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$reportFile = "test-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').md"

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     E2E Test Suite - Monitoring & Testing                  ║" -ForegroundColor Cyan
Write-Host "║     $timestamp                          ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# Load environment
Write-Host "`n[1/5] Loading environment..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Write-Host "❌ .env file not found" -ForegroundColor Red
    exit 1
}

$env:JUDGE_DISABLE_LLM = "1"
if ($FullVerification) {
    $env:E2E_AGENT_VERIFY = "1"
    $env:E2E_PINECONE_VERIFY = "1"
}

Write-Host "✅ Environment loaded" -ForegroundColor Green

# Step 1: Check Azure Functions
if (-not $SkipFunctionCheck) {
    Write-Host "`n[2/5] Checking Azure Functions..." -ForegroundColor Yellow
    
    $functionsBase = $env:FUNCTIONS_BASE -or "http://localhost:7071"
    Write-Host "  Functions Base: $functionsBase" -ForegroundColor Gray
    
    try {
        $healthResponse = Invoke-RestMethod -Uri "$functionsBase/api/health" -Method GET -ErrorAction Stop
        Write-Host "  ✅ Health endpoint: OK" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️  Health endpoint: Not responding" -ForegroundColor Yellow
        Write-Host "     Make sure dev host is running: node tests/dev-host.cjs" -ForegroundColor Gray
    }
    
    try {
        $statsResponse = Invoke-RestMethod -Uri "$functionsBase/api/index/stats" -Method GET -ErrorAction Stop
        $recordCount = $statsResponse.session.dense.byNamespace.PSObject.Properties.Value[0].records
        Write-Host "  ✅ Index stats: $recordCount records" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️  Index stats: Not responding" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n[2/5] Skipping Azure Functions check" -ForegroundColor Gray
}

# Step 2: Check Pinecone
if (-not $SkipPineconeCheck) {
    Write-Host "`n[3/5] Checking Pinecone connectivity..." -ForegroundColor Yellow
    
    if (-not $env:PINECONE_API_KEY) {
        Write-Host "  ⚠️  PINECONE_API_KEY not set" -ForegroundColor Yellow
    } else {
        Write-Host "  ✅ PINECONE_API_KEY configured" -ForegroundColor Green
    }
    
    if (-not $env:PINECONE_INDEX_HOST) {
        Write-Host "  ⚠️  PINECONE_INDEX_HOST not set" -ForegroundColor Yellow
    } else {
        Write-Host "  ✅ PINECONE_INDEX_HOST configured" -ForegroundColor Green
    }
    
    if (-not $env:NYLAS_GRANT_ID) {
        Write-Host "  ⚠️  NYLAS_GRANT_ID not set" -ForegroundColor Yellow
    } else {
        Write-Host "  ✅ NYLAS_GRANT_ID configured: $($env:NYLAS_GRANT_ID.Substring(0, 8))..." -ForegroundColor Green
    }
} else {
    Write-Host "`n[3/5] Skipping Pinecone check" -ForegroundColor Gray
}

# Step 3: Run E2E Tests
if (-not $SkipTests) {
    Write-Host "`n[4/5] Running E2E test suite..." -ForegroundColor Yellow
    Write-Host "  Mode: $(if ($FullVerification) { 'Full Verification' } else { 'Fast Mode' })" -ForegroundColor Gray
    
    try {
        npm run test:e2e
        Write-Host "`n✅ E2E tests completed" -ForegroundColor Green
    } catch {
        Write-Host "`n❌ E2E tests failed" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor Red
    }
} else {
    Write-Host "`n[4/5] Skipping E2E tests" -ForegroundColor Gray
}

# Step 4: Analyze Results
Write-Host "`n[5/5] Analyzing test results..." -ForegroundColor Yellow

$latestSummary = Get-ChildItem "tests/results/summary-*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($latestSummary) {
    $summary = Get-Content $latestSummary | ConvertFrom-Json
    
    Write-Host "`n  Test Summary:" -ForegroundColor Cyan
    Write-Host "  ├─ Total Tests: $($summary.results.Count)" -ForegroundColor Gray
    
    $passed = @($summary.results | Where-Object { $_.judge.pass -eq $true }).Count
    $failed = @($summary.results | Where-Object { $_.judge.pass -ne $true }).Count
    
    Write-Host "  ├─ Passed: $passed" -ForegroundColor Green
    if ($failed -gt 0) {
        Write-Host "  ├─ Failed: $failed" -ForegroundColor Red
    }
    
    # Tool verification
    $toolVerified = @($summary.results | Where-Object { $_.agent.tool_verification.passed -eq $true }).Count
    Write-Host "  ├─ Tool Verification: $toolVerified/$($summary.results.Count)" -ForegroundColor Green
    
    # Pinecone verification
    $pineconeTests = @($summary.results | Where-Object { $_.index_increase -ne $null })
    if ($pineconeTests.Count -gt 0) {
        $totalDelta = ($pineconeTests | Measure-Object -Property index_increase.delta -Sum).Sum
        Write-Host "  ├─ Pinecone Delta: +$totalDelta records" -ForegroundColor Green
    }
    
    Write-Host "  └─ Snapshot: $($latestSummary.Name)" -ForegroundColor Gray
} else {
    Write-Host "  ⚠️  No test results found" -ForegroundColor Yellow
}

# Generate Report
if ($GenerateReport) {
    Write-Host "`n📝 Generating report..." -ForegroundColor Yellow
    
    $report = @"
# E2E Test Report
**Generated**: $timestamp

## Environment
- Functions Base: $($env:FUNCTIONS_BASE -or 'http://localhost:7071')
- Pinecone Index: $($env:PINECONE_INDEX_NAME -or 'emails')
- Nylas Grant: $($env:NYLAS_GRANT_ID.Substring(0, 8))...

## Test Configuration
- Full Verification: $FullVerification
- Tool Verification: $($env:E2E_AGENT_VERIFY -eq '1')
- Pinecone Verification: $($env:E2E_PINECONE_VERIFY -eq '1')
- LLM Judge: Disabled

## Results
"@
    
    if ($latestSummary) {
        $report += "`n- Total Tests: $($summary.results.Count)`n"
        $report += "- Passed: $passed`n"
        if ($failed -gt 0) {
            $report += "- Failed: $failed`n"
        }
        $report += "- Tool Verification: $toolVerified/$($summary.results.Count)`n"
        
        if ($pineconeTests.Count -gt 0) {
            $report += "- Pinecone Records Added: +$totalDelta`n"
        }
    }
    
    $report += "`n## Test Cases`n"
    if ($latestSummary) {
        foreach ($result in $summary.results) {
            $status = if ($result.judge.pass) { "✅" } else { "❌" }
            $report += "- $status $($result.id)`n"
        }
    }
    
    $report += "`n## Snapshot Location`n"
    if ($latestSummary) {
        $report += "- Summary: $($latestSummary.FullName)`n"
    }
    
    $report | Out-File $reportFile -Encoding UTF8
    Write-Host "✅ Report saved: $reportFile" -ForegroundColor Green
}

Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     Testing Complete                                       ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host "`n📊 Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Review test results: tests/results/" -ForegroundColor Gray
Write-Host "  2. Check tool invocations: cat tests/results/security-alert-*.json | jq '.agent.tool_events'" -ForegroundColor Gray
Write-Host "  3. Monitor Pinecone: cat tests/results/unread-delta-*.json | jq '.index_increase'" -ForegroundColor Gray
Write-Host "  4. Read guide: tests/MONITORING_GUIDE.md" -ForegroundColor Gray

