#!/usr/bin/env bash
# Instala a Axon Works numa VPS Ubuntu 24.04 VAZIA (só a Axon nela). Numa VPS que já tem outro site,
# confira antes se as portas 80 e 443 estão livres: o passo do domínio disputa essas portas.
#
# Uso (como root, na VPS):
#   sudo bash instalar.sh git@github.com:senhorxuz/AxonWorks.git
#
# Pode rodar mais de uma vez: cada etapa confere o que já está feito.
# Na primeira vez ele para e mostra a chave que você precisa colar no GitHub.

set -euo pipefail

REPO="${1:-}"
if [ -z "$REPO" ]; then
  echo "Uso: sudo bash instalar.sh <endereço SSH do repositório, ex.: git@github.com:senhorxuz/AxonWorks.git>"
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root: sudo bash instalar.sh $REPO"
  exit 1
fi

BASE=/srv/axon
APP="$BASE/app"
PROJETOS="$BASE/projetos"
ENV_DIR=/etc/axon
ENV_FILE="$ENV_DIR/axon.env"
CHAVE_GITHUB="$BASE/.ssh/github_axon"

passo() { printf '\n==> %s\n' "$1"; }
como_axon() { sudo -u axon -H bash -lc "$1"; }

passo "Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git jq ufw openssl

passo "Node.js 24"
versao_node=0
if command -v node >/dev/null 2>&1; then versao_node="$(node -p 'process.versions.node.split(".")[0]')"; fi
if [ "$versao_node" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

passo "Usuário e pastas da Axon"
if ! id axon >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$BASE" --shell /bin/bash axon
fi
install -d -o axon -g axon -m 750 "$BASE" "$BASE/dados" "$BASE/backups" "$PROJETOS"
install -d -o axon -g axon -m 700 "$BASE/.ssh"

passo "Chave de leitura do GitHub (o repositório é privado)"
if [ ! -f "$CHAVE_GITHUB" ]; then
  como_axon "ssh-keygen -t ed25519 -N '' -C 'axon-vps (somente leitura)' -f '$CHAVE_GITHUB' >/dev/null"
  como_axon "printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' '$CHAVE_GITHUB' > '$BASE/.ssh/config' && chmod 600 '$BASE/.ssh/config'"
  como_axon "ssh-keyscan -t ed25519 github.com >> '$BASE/.ssh/known_hosts' 2>/dev/null"
fi
if ! como_axon "git ls-remote '$REPO' >/dev/null 2>&1"; then
  echo
  echo "A VPS ainda não consegue ler o repositório. Cole esta chave PÚBLICA no GitHub:"
  echo "  Repositório > Settings > Deploy keys > Add deploy key (deixe 'Allow write access' DESMARCADO)"
  echo
  cat "$CHAVE_GITHUB.pub"
  echo
  echo "Depois rode de novo: sudo bash instalar.sh $REPO"
  exit 2
fi

passo "Código da Axon"
if [ ! -d "$APP/.git" ]; then como_axon "git clone '$REPO' '$APP'"; fi
como_axon "cd '$APP' && git pull --ff-only && npm ci && npm run build"

passo "Cópia do código para a conferência de arquivos"
if [ ! -d "$PROJETOS/axon/.git" ]; then como_axon "git clone '$REPO' '$PROJETOS/axon'"; fi

passo "Configuração"
install -d -o root -g axon -m 750 "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  umask 027
  cat > "$ENV_FILE" <<EOF
AXON_MODE=servidor
AXON_PORT=4317
AXON_DB_PATH=$BASE/dados/workspace.sqlite
AXON_BACKUP_DIR=$BASE/backups
AXON_BACKUP_KEY=$(openssl rand -hex 32)
AXON_BACKUP_MAX_COPIES=14
AXON_ALLOWED_HOSTS=
AXON_SSH_HOST=
EOF
  chown root:axon "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "Criado $ENV_FILE (a chave do backup foi gerada aqui e não sai da VPS)."
fi

passo "Serviços (sobe sozinho, reinicia se cair, sincroniza o código e faz backup diário)"
install -m 644 "$APP"/deploy/systemd/*.service "$APP"/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now axon.service axon-sincronizar.timer axon-backup.timer

passo "Firewall: só SSH aberto para a internet"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

passo "SSH: entrada só por chave"
# O SSH é a única porta aberta para a internet. Só desativa a senha se já houver
# chave autorizada, para ninguém ficar de fora da própria VPS.
if [ -s /root/.ssh/authorized_keys ]; then
  printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/60-axon.conf
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  echo "Entrada por senha desativada. Continue entrando com a sua chave."
else
  echo "Nenhuma chave encontrada em /root/.ssh/authorized_keys: a entrada por senha continua ligada."
fi

echo
echo "Instalação concluída."
echo "Agora coloque a Axon no ar com endereço, cadeado e login:"
echo
echo "    sudo bash $APP/deploy/ligar-dominio.sh meu-axon.duckdns.org SEU-TOKEN-DUCKDNS"
echo "    (endereço próprio, sem DuckDNS: sudo bash $APP/deploy/ligar-dominio.sh axon.seudominio.com)"
echo
echo "Outras formas, se um dia quiser trocar quem fica na frente:"
echo "  Cloudflare com login por e-mail:  $APP/deploy/ligar-cloudflare.sh"
echo "  Rede privada Tailscale:           $APP/deploy/ligar-rede-privada.sh"
