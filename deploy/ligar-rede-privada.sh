#!/usr/bin/env bash
# Publica a Axon SOMENTE na rede privada Tailscale, com HTTPS, e libera o nome da máquina.
# Rode depois de "sudo tailscale up".
#
# Uso: sudo bash /srv/axon/app/deploy/ligar-rede-privada.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root: sudo bash $0"; exit 1; fi

ENV_FILE=/etc/axon/axon.env
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
  ufw allow in on tailscale0
  echo "Tailscale instalado. Agora rode 'sudo tailscale up', entre na sua conta e rode este script de novo."
  exit 0
fi
NOME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
if [ -z "$NOME" ] || [ "$NOME" = "null" ]; then
  echo "A VPS ainda não entrou na rede privada. Rode antes: sudo tailscale up"
  exit 1
fi

echo "Nome na rede privada: $NOME"
sed -i "s|^AXON_ALLOWED_HOSTS=.*|AXON_ALLOWED_HOSTS=$NOME|" "$ENV_FILE"
sed -i "s|^AXON_SSH_HOST=.*|AXON_SSH_HOST=$NOME|" "$ENV_FILE"
systemctl restart axon

# HTTPS da própria Tailscale apontando para a Axon, que continua escutando só 127.0.0.1.
# Se aparecer erro de certificado, ative HTTPS em: https://login.tailscale.com/admin/dns
tailscale serve --bg 4317

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4317/api/health >/dev/null 2>&1; then
    echo
    echo "Pronto. Abra no PC ou no celular (com Tailscale ligado):"
    echo "  https://$NOME"
    exit 0
  fi
  sleep 1
done
echo "A Axon não respondeu. Veja o que houve com: journalctl -u axon -n 50"
exit 1
