#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077
node -e "if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Se requiere Node.js 24 o superior')"
npm ci --no-audit --no-fund
npm run build
node --import tsx .devcontainer/postgres.mjs setup
