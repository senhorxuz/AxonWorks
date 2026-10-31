#!/usr/bin/env bash
# Coloca a Axon no ar com endereço próprio e cadeado (HTTPS), protegida pelo login.
#
# O certificado é pedido e renovado sozinho pelo Caddy. A Axon continua escutando
# só dentro da VPS: quem fala com a internet é o Caddy.
#
# Uso (como root, na VPS):
#   sudo bash /srv/axon/app/deploy/ligar-dominio.sh meu-axon.duckdns.org SEU-TOKEN-DUCKDNS
#   sudo bash /srv/axon/app/deploy/ligar-dominio.sh axon.seudominio.com
#
# O token do DuckDNS só é necessário para endereços .duckdns.org: com ele a VPS
# mantém o endereço apontando para o IP certo sozinha.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root: sudo bash $0 <endereço> [token do DuckDNS]"; exit 1; fi

ENDERECO="${1:-}"
TOKEN="${2:-}"
ENV_FILE=/etc/axon/axon.env

if [ -z "$ENDERECO" ]; then
  echo "Informe o endereço. Exemplo: sudo bash $0 meu-axon.duckdns.org SEU-TOKEN"
  exit 1
fi
case "$ENDERECO" in
  *[[:space:]]*|*/*|http*|*:*) echo "Informe só o endereço, assim: meu-axon.duckdns.org"; exit 1 ;;
  *.*) ;;
  *) echo "Isso não parece um endereço completo. Exemplo: meu-axon.duckdns.org"; exit 1 ;;
esac

passo() { printf '\n==> %s\n' "$1"; }

case "$ENDERECO" in
  *.duckdns.org)
    if [ -z "$TOKEN" ]; then
      echo "Endereço do DuckDNS precisa do token: sudo bash $0 $ENDERECO SEU-TOKEN"
      exit 1
    fi
    passo "DuckDNS: apontando o endereço para esta VPS"
    SUB="${ENDERECO%.duckdns.org}"
    umask 077
    printf 'DUCKDNS_SUB=%s\nDUCKDNS_TOKEN=%s\n' "$SUB" "$TOKEN" > /etc/axon/duckdns.env
    chmod 600 /etc/axon/duckdns.env
    if ! bash /srv/axon/app/deploy/atualizar-duckdns.sh; then
      echo "O DuckDNS não aceitou. Confira o endereço e o token no site duckdns.org."
      exit 1
    fi
    install -m 644 /srv/axon/app/deploy/systemd/axon-duckdns.service /srv/axon/app/deploy/systemd/axon-duckdns.timer /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable --now axon-duckdns.timer
    ;;
  *)
    echo "Confira antes: o endereço $ENDERECO precisa apontar para o IP desta VPS."
    ;;
esac

passo "Instalando o Caddy (é ele que cuida do cadeado)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

passo "Abrindo as portas do site no firewall"
ufw allow 80/tcp
ufw allow 443/tcp

passo "Apontando o endereço para a Axon"
cat > /etc/caddy/Caddyfile <<EOF
$ENDERECO {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
	}
	reverse_proxy 127.0.0.1:4317
}
EOF
systemctl reload caddy 2>/dev/null || systemctl restart caddy

passo "Avisando a Axon qual é o endereço dela"
sed -i "s|^AXON_ALLOWED_HOSTS=.*|AXON_ALLOWED_HOSTS=$ENDERECO|" "$ENV_FILE"
sed -i "s|^AXON_SSH_HOST=.*|AXON_SSH_HOST=$ENDERECO|" "$ENV_FILE"
systemctl restart axon

for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:4317/api/health >/dev/null 2>&1 && break
  sleep 1
done

echo
echo "Esperando o certificado (pode levar até um minuto na primeira vez)..."
for _ in $(seq 1 60); do
  if curl -fsS "https://$ENDERECO/api/health" >/dev/null 2>&1; then
    echo
    echo "No ar: https://$ENDERECO"
    echo "A primeira tela pede para criar a sua conta. Depois dela, o cadastro fecha."
    echo "Se você ainda vai trazer o banco do seu computador, faça isso ANTES de criar a conta."
    exit 0
  fi
  sleep 2
done

echo "O endereço ainda não respondeu com cadeado."
echo "Veja o que houve: journalctl -u caddy -n 40"
exit 1
