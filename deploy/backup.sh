#!/usr/bin/env bash
# Backup criptografado da Axon. Roda direto no banco, sem depender da tela nem de senha.
#
# Uso: sudo -u axon bash /srv/axon/app/deploy/backup.sh "antes-de-atualizar"

set -euo pipefail
cd /srv/axon/app
set -a
. /etc/axon/axon.env
set +a
exec /usr/bin/node --import /srv/axon/app/node_modules/tsx/dist/loader.mjs scripts/vps/fazer-backup.ts "${1:-diario}"
