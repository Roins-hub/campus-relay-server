#!/usr/bin/env bash
set -euo pipefail

APP_NAME="campus-relay-server"
APP_DIR="/www/wwwroot/${APP_NAME}"

cd "${APP_DIR}"
git pull --ff-only
bash scripts/deploy.sh
