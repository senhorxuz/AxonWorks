#!/usr/bin/env bash
# Porta de entrada das IAs pelo SSH: abre o MCP da Axon na VPS.
# A saída deste script é o próprio protocolo MCP, por isso nada mais pode ser impresso.
#
# A chave de cada IA é autorizada com deploy/autorizar-ia.sh, que força este script:
# essa chave não abre terminal nem redireciona portas. A configuração pronta para colar
# na IA aparece na tela Conexões da Axon (e em docs/VPS.md).

set -euo pipefail
cd /srv/axon/app
set -a
. /etc/axon/axon.env
set +a
# dist-server/mcp.mjs é gerado por `npm run build` (ou `npm run montar`); atualizar.sh e instalar.sh já rodam o build.
exec /usr/bin/node /srv/axon/app/dist-server/mcp.mjs
