@echo off
echo Starting Azure deployment...
powershell -ExecutionPolicy Bypass -File "deploy-azure.ps1"
pause
