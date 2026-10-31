#!/usr/bin/env bash
# Liga a Axon à Cloudflare: o site passa a abrir com login por e-mail,
# e a VPS não precisa de nenhuma porta do site aberta para a internet.
#
# Antes de rodar, no painel da Cloudflare (Zero Trust > Networks > Tunnels):
#   1. Crie um túnel e copie o token que aparece.
#   2. Em Public Hostname, aponte o endereço do site para http://localhost:4317.
#   3. Em Access > Applications, proteja esse endereço com o seu e-mail.
#
# Uso (como root, na VPS):
#   sudo bash /srv/axon/app/deploy/ligar-cloudflare.sh "<token do túnel>" axon.seudominio.com vps.seudominio.com
#
# O terceiro endereço é opcional: é o nome que aponta direto para o IP da VPS,
# usado pelas IAs no SSH. Sem ele, as IAs usam o IP da VPS.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root: sudo bash $0 \"<token>\" <endereço do site> [endereço do SSH]"; exit 1; fi

TOKEN="${1:-}"
SITE="${2:-}"
SSH_HOST="${3:-}"
ENV_FILE=/etc/axon/axon.env

if [ -z "$TOKEN" ] || [ -z "$SITE" ]; then
  echo "Faltou informação."
  echo "Uso: sudo bash $0 \"<token do túnel>\" axon.seudominio.com [vps.seudominio.com]"
  exit 1
fi
case "$TOKEN" in *[[:space:]]*) echo "O token não pode ter espaços. Copie ele inteiro, entre aspas."; exit 1 ;; esac
case "$SITE" in *[[:space:]]*|*/*|http*) echo "Informe só o endereço, assim: axon.seudominio.com"; exit 1 ;; esac

echo "==> Instalando o cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg > /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -y
  apt-get install -y cloudflared
fi

echo "==> Conectando a VPS ao seu túnel"
if systemctl is-enabled --quiet cloudflared 2>/dev/null; then
  cloudflared service uninstall >/dev/null 2>&1 || true
fi
cloudflared service install "$TOKEN"

echo "==> Liberando o endereço do site na Axon"
sed -i "s|^AXON_ALLOWED_HOSTS=.*|AXON_ALLOWED_HOSTS=$SITE|" "$ENV_FILE"
if grep -q '^AXON_SSH_HOST=' "$ENV_FILE"; then
  sed -i "s|^AXON_SSH_HOST=.*|AXON_SSH_HOST=$SSH_HOST|" "$ENV_FILE"
else
  printf 'AXON_SSH_HOST=%s\n' "$SSH_HOST" >> "$ENV_FILE"
fi
systemctl restart axon

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4317/api/health >/dev/null 2>&1; then
    echo
    echo "Pronto. Abra em qualquer aparelho:"
    echo "  https://$SITE"
    echo "A Cloudflare vai pedir seu e-mail e mandar um código antes de mostrar a Axon."
    echo
    echo "Estado do túnel: systemctl status cloudflared"
    exit 0
  fi
  sleep 1
done
echo "A Axon não respondeu. Veja o que houve com: journalctl -u axon -n 50"
exit 1
