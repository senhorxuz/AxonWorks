#!/usr/bin/env bash
# Atualiza a Axon na VPS para a versão mais nova do GitHub.
# Faz backup antes e, se a versão nova não responder, volta sozinha para a anterior.
#
# Uso: sudo bash /srv/axon/app/deploy/atualizar.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root: sudo bash $0"; exit 1; fi

APP=/srv/axon/app
como_axon() { sudo -u axon -H bash -lc "$1"; }

saudavel() {
  for _ in $(seq 1 40); do
    if curl -fsS http://127.0.0.1:4317/api/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

construir_e_reiniciar() {
  como_axon "cd '$APP' && npm ci && npm run build" || return 1
  # Os serviços acompanham a versão do código.
  install -m 644 "$APP"/deploy/systemd/*.service "$APP"/deploy/systemd/*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl restart axon && saudavel
}

ANTES="$(como_axon "git -C '$APP' rev-parse HEAD")"
como_axon "git -C '$APP' fetch --quiet origin"
DEPOIS="$(como_axon "git -C '$APP' rev-parse '@{u}'")"
if [ "$ANTES" = "$DEPOIS" ]; then
  echo "A Axon já está na versão mais nova."
  exit 0
fi

echo "Backup antes de atualizar..."
sudo -u axon bash "$APP/deploy/backup.sh" antes-de-atualizar

echo "Atualizando de ${ANTES:0:7} para ${DEPOIS:0:7}..."
como_axon "git -C '$APP' merge --ff-only '@{u}'"

if construir_e_reiniciar; then
  echo "Atualizada e respondendo."
  exit 0
fi

echo "A versão nova não respondeu. Voltando para ${ANTES:0:7}..."
como_axon "git -C '$APP' reset --hard '$ANTES'"
if construir_e_reiniciar; then
  echo "Voltou para a versão anterior e está respondendo. Nada foi perdido."
else
  echo "Também não respondeu na versão anterior. Veja: journalctl -u axon -n 80"
fi
exit 1
