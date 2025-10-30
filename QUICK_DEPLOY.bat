@echo off
echo ========================================
echo Azure Deployment - Quick Start
echo ========================================
echo.
echo This batch file will guide you through the deployment process.
echo.

REM Check if Azure CLI is installed
az --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Azure CLI not found. Please install it first.
    echo Download from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
    pause
    exit /b 1
)

echo ✓ Azure CLI found
echo.

REM Check if logged in
echo Checking Azure login...
az account show >nul 2>&1
if %errorlevel% neq 0 (
    echo Please log in to Azure:
    az login
    if %errorlevel% neq 0 (
        echo ERROR: Azure login failed
        pause
        exit /b 1
    )
)

echo ✓ Logged in to Azure
echo.

echo ========================================
echo STEP 1: Deploy Azure Infrastructure
echo ========================================
echo.
echo This will create Resource Group, Storage, Service Bus, Functions, and Key Vault.
echo.
pause

powershell -ExecutionPolicy Bypass -File "deploy-azure.ps1"
if %errorlevel% neq 0 (
    echo ERROR: Infrastructure deployment failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo STEP 2: Configure Application Settings
echo ========================================
echo.
echo This will configure environment variables and Key Vault integration.
echo.
pause

powershell -ExecutionPolicy Bypass -File "configure-app-settings.ps1"
if %errorlevel% neq 0 (
    echo ERROR: App settings configuration failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo STEP 3: Deploy Azure Functions
echo ========================================
echo.
echo This will build and deploy the backend Functions.
echo.
pause

cd apps/functions
func azure functionapp publish func-email-agent-???? --build remote
if %errorlevel% neq 0 (
    echo ERROR: Functions deployment failed
    cd ../..
    pause
    exit /b 1
)

cd ../..
echo.
echo ========================================
echo STEP 4: Deploy Frontend
echo ========================================
echo.
echo This will build and deploy the frontend to Static Web App.
echo.
pause

powershell -ExecutionPolicy Bypass -File "deploy-frontend-azure.ps1"
if %errorlevel% neq 0 (
    echo ERROR: Frontend deployment failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo STEP 5: Register Nylas Webhook
echo ========================================
echo.
echo This will register the webhook with Nylas.
echo.
pause

powershell -ExecutionPolicy Bypass -File "scripts\register-nylas-webhook.ps1" -FuncAppName "func-email-agent-????" -ResourceGroup "rg-email-agent"
if %errorlevel% neq 0 (
    echo WARNING: Webhook registration may need manual configuration
)

echo.
echo ========================================
echo DEPLOYMENT COMPLETE!
echo ========================================
echo.
echo Next steps:
echo 1. Test your deployment by visiting the Static Web App URL
echo 2. Set up GitHub secrets using: setup-github-secrets.ps1
echo 3. Configure CI/CD pipeline in GitHub Actions
echo.
echo For troubleshooting, see: AZURE_DEPLOYMENT_GUIDE.md
echo.
pause
