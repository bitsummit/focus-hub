#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077
export FOCUS_DEV="${FOCUS_DEV:-true}"
export PORT="${PORT:-3000}"
if [[ "${CODESPACES:-false}" == true ]]; then
  if [[ ! "${CODESPACE_NAME:-}" =~ ^[a-z0-9-]+$ || ! "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" =~ ^[a-z0-9.-]+$ ]]; then
    echo 'Faltan las variables oficiales de forwarding de Codespaces. No se inicia con un origen inventado.' >&2
    exit 1
  fi
  export FOCUS_PUBLIC_ORIGIN="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  export COOKIE_SECURE=true
fi
node --import tsx .devcontainer/postgres.mjs start
