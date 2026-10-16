#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077
node -e "if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Se requiere Node.js 24 o superior')"
npm ci --no-audit --no-fund
npm run build
if [[ ! -e .data/demo.sqlite && ! -e .data/demo-access.json ]]; then
  npm run demo
elif [[ ! -f .data/demo.sqlite || ! -f .data/demo-access.json ]]; then
  echo 'La demo está incompleta. Se conserva sin sobrescribirla: revisa .data antes de continuar.' >&2
  exit 1
fi
printf '%s\n' 'Demo preparada. Credenciales privadas: abre .data/demo-access.json en el editor; no las subas a Git.'
