#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fullparty-discord-bot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-fullparty-discord-bot}"

cd "$APP_DIR"

git fetch --prune origin
git checkout -B "$DEPLOY_BRANCH" "origin/$DEPLOY_BRANCH"
git reset --hard "origin/$DEPLOY_BRANCH"

npm ci
npm run build

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl is-active --quiet "$SERVICE_NAME"

echo "Deployed $SERVICE_NAME from origin/$DEPLOY_BRANCH."
