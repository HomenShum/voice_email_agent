# Test email search endpoint with metrics

$uri = "http://localhost:8791/email/search"
$body = @{
    queries = @(@{ text = "test" })
    top_k = 10
} | ConvertTo-Json

Write-Host "Testing email search endpoint..." -ForegroundColor Cyan
Write-Host "URL: $uri"
Write-Host "Body: $body"
Write-Host ""

try {
    $response = Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $body
    Write-Host "Response:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5 | Write-Host
    
    Write-Host ""
    Write-Host "Metrics:" -ForegroundColor Yellow
    Write-Host "Total emails found: $($response.total)"
    Write-Host "Results returned: $($response.results.Count)"
    
    if ($response.results.Count -gt 0) {
        Write-Host ""
        Write-Host "Top result:" -ForegroundColor Cyan
        $top = $response.results[0]
        Write-Host "  Title: $($top.title)"
        Write-Host "  From: $($top.from)"
        Write-Host "  Date: $($top.date)"
        Write-Host "  Score: $($top.score)"
    }
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

