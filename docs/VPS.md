# Axon Works na VPS: guia passo a passo

> O endereço `meu-axon.duckdns.org` usado abaixo é um exemplo e não existe.

Ao final deste guia você terá:

- A Axon rodando 24 horas numa VPS da Hostinger, com Ubuntu 24.04.
- Acesso em `https://seunome.duckdns.org` de qualquer aparelho, com **usuário e senha seus**. Sem aplicativo, sem VPN, sem intermediário.
- Cadeado (HTTPS) pedido e renovado sozinho.
- A Axon escutando **só dentro da VPS**. Quem conversa com a internet é o porteiro (Caddy), e quem passa pela porta é quem tem a sua senha.
- As IAs (Claude Code, Gemini, Cursor) conectadas ao MCP pelo SSH.
- Uma cópia do código atualizada a cada 2 minutos, para a conferência de arquivos comparar com o que está no GitHub.
- Backup criptografado todo dia às 00:30 (horário de Brasília), guardando os últimos 14.
- Atualização com um comando, que volta sozinha para a versão anterior se a nova não responder.

Tempo estimado: 1 hora na primeira vez.

---

## 0. Antes de começar

| O quê | Onde | Observação |
|---|---|---|
| Código da Axon no GitHub | `senhorxuz/AxonWorks` | Os arquivos `deploy/` e `scripts/vps/` precisam estar enviados. |
| VPS | Hostinger, plano KVM 1 | **Ubuntu 24.04**, sem painel de controle. Anote o IP. |
| Endereço grátis | https://www.duckdns.org | Entre com Google ou GitHub. |
| Sua chave SSH | No seu PC | Instruções abaixo. |

### Sua chave SSH (feita uma vez, no PC)

No PowerShell:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

- **Apareceu uma linha** começando com `ssh-ed25519`? Você já tem, pode usar.
- **Deu erro?** Crie com `ssh-keygen -t ed25519` e aperte Enter em tudo. Se ele perguntar sobre sobrescrever, responda **n**.

O arquivo terminado em `.pub` é o público: pode colar onde pedirem. O outro é o segredo e nunca sai do seu PC.

---

## 1. Criar seu endereço no DuckDNS

1. Abra https://www.duckdns.org e entre com Google ou GitHub.
2. No campo de domínio, escolha um nome (ex.: `meu-axon`) e clique em **add domain**. Seu endereço será `meu-axon.duckdns.org`.
3. No alto da página, **copie o token**. É uma sequência tipo `a1b2c3d4-...`. Guarde no gerenciador de senhas.

Não precisa preencher o IP: a VPS mesmo avisa o DuckDNS sozinha, a cada 30 minutos.

---

## 2. Instalar a Axon

Do PC, envie o instalador (o repositório é privado, então ele vai por aqui):

```powershell
scp D:\projetos\axon\deploy\instalar.sh root@IP-DA-VPS:/root/
```

Entre na VPS e rode:

```bash
ssh root@IP-DA-VPS
bash /root/instalar.sh git@github.com:senhorxuz/AxonWorks.git
```

**Na primeira vez ele para de propósito** e mostra uma chave que começa com `ssh-ed25519`. É a chave de leitura da VPS:

1. GitHub > repositório AxonWorks > **Settings** > **Deploy keys** > **Add deploy key**.
2. Título: `axon-vps`. Cole a chave. **Deixe "Allow write access" desmarcado.**
3. Rode o mesmo comando de novo:

```bash
bash /root/instalar.sh git@github.com:senhorxuz/AxonWorks.git
```

Ele instala o Node 24, cria o usuário `axon`, baixa o código, gera a chave do backup, liga os serviços e o firewall. Se você já entra com chave, ele também desliga a entrada por senha no SSH. No fim aparece **Instalação concluída**.

---

## 3. Ligar o endereço e o cadeado

Na VPS, com o seu endereço e o token do DuckDNS:

```bash
bash /srv/axon/app/deploy/ligar-dominio.sh meu-axon.duckdns.org SEU-TOKEN-DUCKDNS
```

Ele aponta o endereço para a VPS, instala o porteiro, pede o certificado, abre as portas do site no firewall e avisa a Axon qual é o endereço dela. No fim aparece **No ar: https://meu-axon.duckdns.org**.

Abra o endereço no navegador. Deve aparecer a tela **Crie sua conta**.

> **Ainda não crie a conta.** Traga seus dados primeiro (passo 4), porque o banco que vem do seu PC substitui o da VPS, e a conta criada agora se perderia. Se você não tem nada para trazer, pule direto para o passo 5.

---

## 4. Levar seus dados do PC para a VPS

No PC, na pasta do projeto:

```powershell
cd D:\projetos\axon
npx tsx scripts/vps/copiar-banco.ts axon-para-vps.sqlite
scp axon-para-vps.sqlite root@meu-axon.duckdns.org:/root/
```

Na VPS:

```bash
systemctl stop axon
rm -f /srv/axon/dados/workspace.sqlite /srv/axon/dados/workspace.sqlite-wal /srv/axon/dados/workspace.sqlite-shm
mv /root/axon-para-vps.sqlite /srv/axon/dados/workspace.sqlite
chown axon:axon /srv/axon/dados/workspace.sqlite
```

Agora aponte o projeto para a cópia do código que fica na VPS (a pasta antiga precisa ser escrita **exatamente** como aparece na tela do projeto):

```bash
sudo -u axon bash -c 'cd /srv/axon/app && set -a && . /etc/axon/axon.env && set +a && npx tsx scripts/vps/trocar-pasta.ts "D:\projetos\axon" /srv/axon/projetos/axon'
systemctl start axon
```

Deve aparecer `1 projeto(s) agora usam /srv/axon/projetos/axon`. Se aparecer `0`, confira a pasta na tela do projeto e rode de novo.

Apague a cópia do PC depois de conferir que tudo abriu: `Remove-Item axon-para-vps.sqlite`.

> **Uma Axon só.** A partir daqui, a memória oficial é a da VPS. Pare de usar a Axon local para não ter duas memórias diferentes.

---

## 5. Criar sua conta

Abra `https://meu-axon.duckdns.org` e preencha **Crie sua conta**:

- **Usuário:** letras minúsculas, números, traço ou sublinhado (ex.: `seu-usuario`).
- **Senha:** pelo menos 12 caracteres. Use o gerador do seu gerenciador de senhas e salve lá.

Essa é a conta dona. **Depois dela, o cadastro fecha**: ninguém mais consegue criar conta nessa Axon, nem você. Para criar outra, seria preciso mexer no servidor.

Como funciona a porta:

- A sessão dura **12 horas** em cada aparelho. Depois disso ele pede a senha de novo.
- Errar a senha 5 vezes seguidas tranca aquele usuário por 15 minutos.
- O botão **Sair** fica no rodapé da barra lateral, embaixo do nome da IA.

---

## 6. Conectar as IAs

### Autorizar o computador (uma vez por computador)

Na VPS, cole o conteúdo da sua chave **pública** entre aspas:

```bash
bash /srv/axon/app/deploy/autorizar-ia.sh "ssh-ed25519 AAAA... seu-pc"
```

Essa chave, usada com o usuário `axon`, **só abre o MCP da Axon**: não abre terminal nem redireciona portas.

### Configurar cada IA

O jeito mais fácil: abra a Axon > **Conexões** > **Gerador de Conectores**. No servidor, a configuração já vem pronta com o SSH. Copie e cole.

Na mão, trocando o endereço pelo seu:

**Claude Code** (no PowerShell):

```powershell
claude mcp add axon -- ssh -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new axon@meu-axon.duckdns.org /srv/axon/app/deploy/mcp.sh
```

**Gemini CLI**, **Cursor** e outras (arquivo de configuração MCP):

```json
{
  "mcpServers": {
    "axon": {
      "command": "ssh",
      "args": ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
               "axon@meu-axon.duckdns.org", "/srv/axon/app/deploy/mcp.sh"]
    }
  }
}
```

No projeto da Axon no PC, o arquivo `.mcp.json` ainda aponta para a Axon local. Troque pelo bloco acima quando a VPS estiver no ar.

---

## 7. Backup: guardar a chave e ensaiar a restauração

**Guarde a chave do backup.** Sem ela, nenhum backup abre. Na VPS:

```bash
grep AXON_BACKUP_KEY /etc/axon/axon.env
```

Copie o valor para o seu gerenciador de senhas. Não cole em chat nem em IA.

**Primeiro backup e ensaio** (na VPS):

```bash
systemctl start axon-backup.service
ls -lh /srv/axon/backups
sudo -u axon bash -c 'cd /srv/axon/app && set -a && . /etc/axon/axon.env && set +a && npx tsx scripts/vps/ensaio-de-backup.ts'
```

O ensaio abre o backup mais recente numa cópia separada e confere se está íntegro, sem tocar nos dados reais. O esperado é `Ensaio passou`.

**Cópia fora da VPS** (recomendado): ative os snapshots semanais no painel da Hostinger. De vez em quando, baixe os backups para o PC:

```powershell
scp -r root@meu-axon.duckdns.org:/srv/axon/backups D:\backups-axon
```

---

## Esqueci a senha

Você tem a chave do servidor, então sempre tem como voltar. Na VPS:

```bash
sudo -u axon bash -c 'cd /srv/axon/app && set -a && . /etc/axon/axon.env && set +a && npx tsx scripts/vps/trocar-senha.ts seu-usuario'
```

Ele pede a nova senha duas vezes, troca, e derruba as sessões abertas daquela conta.

---

## Dia a dia

| Para | Comando na VPS |
|---|---|
| Atualizar para a versão do GitHub | `bash /srv/axon/app/deploy/atualizar.sh` |
| Ver se está rodando | `systemctl status axon` |
| Ver os últimos erros | `journalctl -u axon -n 50` |
| Reiniciar | `systemctl restart axon` |
| Ver o porteiro e o cadeado | `systemctl status caddy` |
| Ver a última sincronização do código | `journalctl -u axon-sincronizar -n 20` |
| Ver os backups | `ls -lh /srv/axon/backups` |
| Fazer um backup agora | `systemctl start axon-backup.service` |

A atualização faz backup antes, reconstrói e reinicia. Se a versão nova não responder em 40 segundos, ela volta sozinha para a anterior.

---

## Quem tem acesso

- **Tela e API:** só quem tem a sua senha. Toda página e todo dado exigem sessão; sem entrar, a Axon não conta nem quantos projetos existem.
- **MCP:** só os computadores cuja chave pública você autorizou com `autorizar-ia.sh`.
- **SSH:** só com a sua chave. A entrada por senha fica desligada.
- **A Axon em si** não fica exposta: ela escuta apenas dentro da VPS, e só o porteiro conversa com a internet.

O que proteger com carinho: a sua senha da Axon, a chave privada do seu PC (`id_ed25519`, sem `.pub`) e a chave do backup. Ative a verificação em duas etapas na conta que você usa no DuckDNS e no GitHub.

---

## Outras formas de ficar na frente

Os scripts continuam no projeto, caso você mude de ideia:

- **Cloudflare com login por e-mail:** `deploy/ligar-cloudflare.sh` (precisa de domínio próprio; a Cloudflare passa a ver o tráfego).
- **Rede privada Tailscale:** `deploy/ligar-rede-privada.sh` (nada exposto, mas exige o aplicativo em cada aparelho).

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Instalador para mostrando uma chave | Esperado na primeira vez | Cole como Deploy key no GitHub e rode de novo. |
| O endereço não abre e o cadeado não vem | O DuckDNS ainda não apontou | Espere 2 minutos e rode `bash /srv/axon/app/deploy/atualizar-duckdns.sh`, depois `systemctl restart caddy`. |
| Navegador reclama do certificado | Certificado ainda sendo emitido | Espere um minuto e recarregue. Persistindo: `journalctl -u caddy -n 40`. |
| "Muitas tentativas. Tente de novo em 15 minutos." | 5 senhas erradas seguidas | Espere os 15 minutos, ou troque a senha pelo servidor (seção acima). |
| A tela pede para criar conta de novo | O banco foi substituído depois | Crie a conta de novo: agora ela fica. |
| Página diz "O AXON aceita somente acesso local" | Endereço não liberado na Axon | Rode o `ligar-dominio.sh` de novo com o endereço certo. |
| IA diz que o MCP falhou | Chave não autorizada | Rode `autorizar-ia.sh` com a chave pública desse PC. |
| Conferência de arquivos diz que mudou | A cópia ainda não puxou o último push | Espere 2 minutos ou rode `systemctl start axon-sincronizar.service`. |
| `trocar-pasta` mostra 0 projetos | Pasta antiga escrita diferente | Copie a pasta exatamente como aparece na tela do projeto. |
