# Ligar o Claude Code à Axon

Este documento descreve a ligação do Claude Code à Axon: o que o instalador acrescenta na configuração do dono, como ver antes de gravar, como desligar e o que já foi (e o que ainda não foi) conferido.

## Em uma frase

Depois de ligado, toda sessão do Claude Code numa pasta cadastrada na Axon recebe a retomada do projeto sozinha, e o Claude sabe que os registros de trabalho vão para a Axon. Em pasta não cadastrada, nada chega e nada é gravado.

## O que muda no PC

| Onde | O que a Axon acrescenta | Como sai |
|---|---|---|
| `~/.claude/settings.json` | Quatro ganchos no nível do usuário: `SessionStart` (matcher `startup\|resume\|clear\|compact`, limite 5 s), `PostCompact` (10 s), `Stop` (5 s) e `SessionEnd` (30 s). Cada um chama `node.exe` com `dist-server/ganchos.mjs`, só com os campos que a documentação do Claude Code descreve (`type`, `command`, `args`, `timeout`). | `npm run claude:desligar` tira só os da Axon (ver "Como a Axon reconhece os ganchos dela"). |
| Servidor MCP, escopo do usuário (`~/.claude.json`, gravado pelo próprio `claude`) | A entrada `axon`: `node.exe dist-server/mcp.mjs`. Fica disponível em todas as pastas e entrega as instruções da Axon à sessão. | `npm run claude:desligar` roda `claude mcp remove axon --scope user`. |
| `~/.claude/skills/axon-ligar-projeto/SKILL.md` | A skill que atende o pedido "manda este projeto para a Axon". | `npm run claude:desligar` apaga o arquivo (e a pasta, se ficar vazia). |

Nada é escrito dentro do repositório de cada projeto.

## Regras que o instalador segue

- **Só acrescenta.** Ganchos de outras ferramentas, permissões e qualquer outro campo do `settings.json` ficam como estão. Mesclar duas vezes não duplica: os ganchos da Axon são trocados, não somados.
- **Mostra antes de gravar.** O texto impresso lista cada gancho, o comando do MCP e o estado da skill. `--simular` mostra tudo e não grava nada.
- **Cópia de segurança.** Antes da primeira gravação, o `settings.json` original é copiado para `settings.json.antes-da-axon`. A cópia é feita uma vez e nunca é sobrescrita.
- **Recusa em vez de adivinhar.** Se o `settings.json` não for um JSON válido, ou se `hooks` tiver um formato que a Axon não reconhece, o instalador explica e não grava nada.
- **Exige os arquivos montados.** Sem `dist-server/mcp.mjs` e `dist-server/ganchos.mjs`, ele para com "Rode npm run montar antes." e não grava nada.
- **Caminhos absolutos.** O `node` é o que roda o instalador (`process.execPath`), e os scripts são resolvidos a partir da raiz do repositório. No Windows, um gancho com `args` exige um executável de verdade, por isso o `command` é o `node.exe` e o script vai em `args`. Se o Node mudar de lugar, rode `npm run claude:ligar` de novo: os ganchos são atualizados.

## Como a Axon reconhece os ganchos dela

Um gancho é da Axon quando o `command` é um executável do node (`node` ou `node.exe`, em qualquer pasta) e o primeiro item de `args` termina em `dist-server/ganchos.mjs` (a pasta `dist-server` inteira, não `meu-dist-server`). A comparação ignora a diferença entre `\` e `/`; no Windows, ignora também maiúsculas e minúsculas. Ganchos de outras ferramentas, mesmo os que usam o node, não batem nessa regra e ficam como estão.

Não existe mais campo próprio. A primeira versão do instalador marcava cada gancho com `"axon": true`, mas a documentação do Claude Code não garante que um campo desconhecido num gancho é aceito, e um `settings.json` recusado poderia desligar a configuração inteira do dono. Quem rodou aquela versão não precisa fazer nada: os ganchos antigos também rodam `dist-server/ganchos.mjs`, então `npm run claude:ligar` os troca pelos novos (sem duplicar) e `npm run claude:desligar` os tira.

## Comandos

```
npm run claude:ligar                  mostra o que muda e grava
npm run claude:ligar -- --simular     só mostra
npm run claude:desligar               tira tudo o que a Axon acrescentou
npm run claude:desligar -- --simular  só mostra o que sairia
```

O registro do servidor MCP usa `claude mcp add --scope user axon -- <node> <dist-server/mcp.mjs>`. Se o comando `claude` não estiver no PATH, o instalador imprime o comando para o dono rodar à mão. Se o `claude` recusar (por exemplo, a entrada `axon` já existe), o instalador mostra a resposta dele e o comando manual, e termina com erro; os ganchos e a skill já gravados continuam e o desligar sabe desfazê-los. Para trocar um registro antigo: `npm run claude:desligar` e depois `npm run claude:ligar`.

Para ensaiar sem tocar na configuração real: `npm run claude:ligar -- --pasta-claude <pasta temporária>`. Com outra pasta, o instalador não chama o `claude` (o `claude mcp` escreve em `~/.claude.json`, que uma pasta de ensaio não substitui) e imprime o comando.

## Ligar um projeto (pedido do dono)

Com tudo instalado, o dono diz ao Claude, na pasta do projeto, algo como "manda este projeto para a Axon". A skill `axon-ligar-projeto`:

1. Lê `CLAUDE.md`, `AGENTS.md`, README, roadmap e `docs/` da pasta (lendo, sem inventar).
2. Procura na Axon um projeto cuja pasta seja esta, ou com nome parecido, ou com pasta vazia, e **pergunta ao dono** antes de criar; nunca cria duplicado em silêncio.
3. Mostra o plano e espera o "sim".
4. Cria o projeto com `workspacePath` = pasta atual, envia a diretriz (que vira proposta, aplicada pelo dono na tela) e grava o primeiro checkpoint com `humanSummary`.

Limite conhecido: as ferramentas da Axon só definem a pasta de um projeto ao criá-lo. Não existe ferramenta para trocar a pasta de um projeto que já existe com outra pasta ou sem pasta; a skill diz isso ao dono em vez de contornar.

## Instruções do servidor MCP

O servidor entrega ao cliente um texto de instruções (`server/mcp-instrucoes.ts`, no máximo 4.096 caracteres, que é onde o Claude Code corta). Ele está em afirmações, não em ordens, como a documentação do Claude Code recomenda: diz o que é a Axon, que os registros de trabalho vão para `save_checkpoint` e `finalize_work` com `humanSummary` escrito para o dono ler meses depois, e que ligar um projeto é pedido do dono. O teste `tests/claude-configuracao.test.ts` confere o tamanho e o tom.

## O que foi conferido e o que não foi

Conferido na documentação oficial do Claude Code (25/10/2026): o gancho de tipo `command` aceita `args` (forma sem shell, que no Windows exige um executável real), `timeout` é em segundos, `SessionStart` e `PostCompact` aceitam `matcher`, `Stop` não, e `claude mcp add --scope user <nome> -- <comando> <args>` e `claude mcp remove <nome> --scope user` existem (conferido também com `claude mcp add --help`).

Conferido por teste, em pastas temporárias: mesclar sem apagar ganchos de outras ferramentas, não duplicar, tirar só os da Axon, reconhecer o gancho pelo caminho (barras e maiúsculas no Windows, pasta de nome parecido, outro gancho que também usa node), trocar os ganchos antigos com `"axon": true`, recusas, cópia `.antes-da-axon`, `--simular`, desligar e a passagem de argumentos com espaço pelo `cmd` do Windows.

**Ainda não conferido:** (1) o registro real do MCP (`claude mcp add`) e a leitura real dos ganchos pelo Claude Code só são exercitados quando o dono rodar `npm run claude:ligar` de verdade; (2) a abertura de uma sessão real com a retomada chegando é a "prova real" da Task 10.
