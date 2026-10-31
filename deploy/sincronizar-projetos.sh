#!/usr/bin/env bash
# Mantém as cópias do código em /srv/axon/projetos iguais ao GitHub,
# para a conferência de arquivos comparar com a versão enviada mais recente.
# Roda a cada 2 minutos pelo timer axon-sincronizar.

set -uo pipefail

for pasta in /srv/axon/projetos/*/; do
  [ -d "${pasta}.git" ] || continue
  if ! git -C "$pasta" pull --ff-only --quiet; then
    echo "Não foi possível atualizar $pasta (mudança local ou conflito)." >&2
  fi
done
