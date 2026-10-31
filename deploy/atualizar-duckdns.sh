#!/usr/bin/env bash
# Mantém o endereço do DuckDNS apontando para o IP desta VPS.
# Roda a cada 30 minutos pelo timer axon-duckdns.

set -euo pipefail

. /etc/axon/duckdns.env

RESPOSTA="$(curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUB}&token=${DUCKDNS_TOKEN}&ip=")"
if [ "$RESPOSTA" != "OK" ]; then
  echo "DuckDNS recusou a atualização (resposta: ${RESPOSTA:-vazia})." >&2
  exit 1
fi
