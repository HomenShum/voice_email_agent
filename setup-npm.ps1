# Add Node and npm to PATH for current PowerShell session
$env:PATH = "C:\Users\hshum\AppData\Local\nvm\v23.10.0;C:\Users\hshum\AppData\Roaming\npm;" + $env:PATH
Write-Host "npm PATH configured. npm version:" -ForegroundColor Green
npm -v

