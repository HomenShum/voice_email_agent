# syntax=docker/dockerfile:1

# Build stage: compile TypeScript to dist/
FROM node:22 AS build
WORKDIR /workspace

# Install deps
COPY package*.json ./
# Prefer ci when lockfile exists; fallback to install
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# Copy sources
COPY tsconfig.json ./
COPY host.json ./
COPY functions ./functions
COPY shared ./shared
COPY smoke ./smoke

# Build
RUN npm run build

# Runtime image: Azure Functions runtime for Node 22
FROM mcr.microsoft.com/azure-functions/node:4-node22

# Recommended env for containerized Functions
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true

WORKDIR /home/site/wwwroot

# App artifacts
COPY --from=build /workspace/package*.json ./
COPY --from=build /workspace/dist ./dist
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/host.json ./host.json
# Include utility scripts for ad-hoc probes (e.g., nylas-probe.mjs)
COPY scripts ./scripts

# Note: local.settings.json is not read by this containerized runtime.
# Use docker-compose to pass environment variables instead.

EXPOSE 80

