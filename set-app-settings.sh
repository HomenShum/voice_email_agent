#!/bin/bash

# Configure Azure Functions App Settings

FUNC_APP_NAME="func-email-agent-1426"
RESOURCE_GROUP="rg-email-agent"
SB_NAMESPACE="sb-email-agent-3512"
QUEUE_NAME="nylas-backfill"

echo "Configuring app settings for: $FUNC_APP_NAME"

# Load .env file
source .env

# Get Service Bus connection string
echo "Getting Service Bus connection string..."
SB_CONN_STR=$(az servicebus namespace authorization-rule keys list \
  --name RootManageSharedAccessKey \
  --namespace-name $SB_NAMESPACE \
  --resource-group $RESOURCE_GROUP \
  --query primaryConnectionString -o tsv)

echo "✓ Service Bus connection string retrieved"

# Configure app settings
echo "Configuring app settings..."

az functionapp config appsettings set \
  --name $FUNC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings \
    SERVICEBUS_CONNECTION="$SB_CONN_STR" \
    SB_QUEUE_BACKFILL="$QUEUE_NAME" \
    NYLAS_API_KEY="$NYLAS_API_KEY" \
    NYLAS_GRANT_ID="$NYLAS_GRANT_ID" \
    NYLAS_BASE="https://api.us.nylas.com/v3" \
    OPENAI_API_KEY="$OPENAI_API_KEY" \
    OPENAI_EMBED_MODEL="text-embedding-3-small" \
    OPENAI_TEXT_MODEL="gpt-5-mini" \
    PINECONE_API_KEY="$PINECONE_API_KEY" \
    PINECONE_INDEX_NAME="emails" \
    PINECONE_INDEX_HOST="$PINECONE_INDEX_HOST" \
    NYLAS_WEBHOOK_SECRET="dev" \
    DELTA_DEFAULT_MONTHS="1" \
    DELTA_MAX="100000"

echo "✓ App settings configured"
echo ""
echo "Next step: Deploy Functions code"
echo "cd apps/functions && func azure functionapp publish $FUNC_APP_NAME --build remote"

