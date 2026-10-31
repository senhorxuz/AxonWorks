#!/usr/bin/env bash
# Autoriza o computador de uma IA a abrir o MCP da Axon pelo SSH.
# A chave autorizada serve SOMENTE para o MCP: não abre terminal, não redireciona portas.
#
# Uso (como root, na VPS), colando a chave PÚBLICA (o arquivo .pub, nunca a chave privada):
#   sudo bash /srv/axon/app/deploy/autorizar-ia.sh "ssh-ed25519 AAAA... nome-do-computador"

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root: sudo bash $0 \"<chave pública>\""; exit 1; fi

CHAVE="${1:-}"
if printf '%s' "$CHAVE" | grep -q 'PRIVATE KEY'; then
  echo "Isso é uma chave PRIVADA. Use o arquivo que termina em .pub."
  exit 1
fi
case "$CHAVE" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;;
  *) echo "Isso não parece uma chave pública SSH. Ela começa com ssh-ed25519, ssh-rsa ou ecdsa-sha2."; exit 1 ;;
esac

ARQUIVO=/srv/axon/.ssh/authorized_keys
install -d -o axon -g axon -m 700 /srv/axon/.ssh
touch "$ARQUIVO"
chown axon:axon "$ARQUIVO"
chmod 600 "$ARQUIVO"

CORPO="$(printf '%s' "$CHAVE" | awk '{print $2}')"
if grep -qF "$CORPO" "$ARQUIVO"; then
  echo "Essa chave já estava autorizada."
  exit 0
fi

printf 'command="/bin/bash /srv/axon/app/deploy/mcp.sh",restrict %s\n' "$CHAVE" >> "$ARQUIVO"
echo "Chave autorizada. Esse computador agora abre só o MCP da Axon."
