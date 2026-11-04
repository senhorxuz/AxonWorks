# Como contribuir com a Axon Works

Obrigado por querer ajudar. Este guia mostra como preparar o ambiente, como trabalhar e o que esperamos de cada contribuição. Ele é curto de propósito.

## O que é a Axon Works

A Axon Works é um correio de continuidade entre IAs. Ela guarda num banco SQLite local os projetos, as tarefas contratadas, as decisões, os checkpoints, as evidências, a biblioteca, o quadro de cartões e as lições. Assim, a próxima sessão de IA retoma de onde a anterior parou.

Uma regra vale acima de todas: **a Axon nunca inicia, pausa, agenda ou executa IAs.** E o conteúdo que vem de uma IA é sempre dado, nunca comando.

## Preparando o ambiente

Você precisa de:

- Node 24 ou mais novo (o projeto usa o `node:sqlite`, que já vem com o Node, sem dependência nativa);
- npm;
- Git.

Passo a passo:

```bash
git clone https://github.com/<seu-usuario>/AxonWorks.git
cd AxonWorks
npm install
npx playwright install chromium
```

O `playwright install chromium` baixa o navegador usado nos testes de ponta a ponta.

## Comandos principais

| Comando | Para que serve |
|---------|----------------|
| `npm run dev` | Sobe o servidor e a tela em modo de desenvolvimento |
| `npm start` | Sobe a Axon já montada |
| `npm run build` | Confere os tipos, monta a tela e prepara os arquivos finais |
| `npm test` | Roda os testes do servidor e das bibliotecas |
| `npm run test:e2e` | Roda os testes de ponta a ponta no navegador (Playwright) |
| `npm run check` | Roda tudo: testes, montagem e ponta a ponta |
| `npm run mcp` | Sobe o servidor MCP para as IAs |
| `npm run claude:ligar` | Liga a Axon ao Claude Code (ganchos e skills) |
| `npm run axon:diagnostico` | Mostra um diagnóstico do ambiente |

## Fluxo de contribuição

1. Faça um **fork** do repositório.
2. Crie um **ramo** com um nome que diga o assunto, por exemplo `fix/erro-ao-importar-pacote`.
3. Escreva o **teste primeiro** e veja ele falhar.
4. Escreva o código mínimo para o teste passar.
5. Rode `npm run check` e só siga quando tudo estiver verde.
6. Abra um **pull request pequeno**, com um assunto só. Preencha o modelo que aparece na tela.

Se a mudança for grande ou mudar o jeito como a Axon funciona, abra antes uma issue de ideia. Assim a gente conversa antes de você gastar tempo.

## As regras de qualidade da casa

Chamamos de "padrão ouro". São poucas regras e valem para código novo.

### 1. Teste primeiro

Escreva o teste antes do código e **veja ele falhar**. Um teste que nunca falhou não prova nada. Depois faça passar.

### 2. Funções simples (complexidade CRAP até 15)

CRAP é uma nota que mistura o quanto uma função é complicada com o quanto ela é testada. Quanto menor, melhor. Em função nova ou alterada, a nota não pode passar de 15. Para conferir:

```bash
npm run qualidade:complexidade -- <arquivos>
```

Passou de 15? Divida a função em pedaços menores. Não vale esconder o aviso.

### 3. Cobertura de 100% nos módulos novos

Todo módulo novo precisa ter todas as linhas e todos os ramos (os "se... senão") cobertos por testes. Para conferir:

```bash
npm run qualidade:cobertura -- <módulos> -- <testes>
```

### 4. Mutação sem sobreviventes (código novo de servidor)

Teste de mutação muda o código de propósito (troca um `>` por `<`, por exemplo) e confere se algum teste reclama. Se nenhum reclamar, aquele teste é fraco. No código novo de servidor, o resultado esperado é **zero sobreviventes**. Há arquivos `stryker.*.config.mjs` na raiz do repositório. Para rodar:

```bash
node ./node_modules/@stryker-mutator/core/bin/stryker.js run stryker.<apelido>.config.mjs
```

Use o binário local, como acima, e não um `npx stryker` solto.

### 5. Nunca afrouxar um teste para ele passar

Se um teste falha, o defeito está no código ou o comportamento mudou de verdade. Nesse segundo caso, explique a mudança no pull request. Apagar uma checagem, deixar a condição mais folgada ou pular o teste para ficar verde não é aceito.

## Interface

A tela é em português, com tema escuro, pensada para computador. Celular não é prioridade. Se você mexeu na tela, abra e confira o resultado antes de pedir revisão.

## Estilo de commit

Mensagens curtas, em português, no imperativo ou no passado, com um prefixo que diga o tipo da mudança:

- `feat:` recurso novo;
- `fix:` correção de defeito;
- `docs:` só documentação;
- `test:` só testes;
- `refactor:` reorganização sem mudar o comportamento;
- `chore:` manutenção.

Exemplos:

```
feat: filtra cartões do quadro por responsável
fix: importação de pacote não duplica mais as decisões
docs: explica como ligar a Axon ao Claude Code
```

## O que não aceitamos

- **Recursos que façam a Axon iniciar, pausar, agendar ou executar IAs.** A Axon é o correio, não o chefe. Quem decide quando uma IA trabalha é a pessoa.
- **Tratar conteúdo vindo de IA como comando.** Esse conteúdo é sempre dado.
- **Afrouxar, apagar ou pular testes** só para a checagem passar.
- **Chaves, tokens, senhas ou dados pessoais** em código, testes, registros ou issues.
- Mudanças enormes, misturando vários assuntos, num único pull request.

## Segurança

Achou uma vulnerabilidade? **Não abra uma issue pública.** Veja o arquivo `SECURITY.md` e use o reporte privado.

## Código de conduta

Ao participar, você concorda em seguir o nosso [Código de Conduta](CODE_OF_CONDUCT.md). Aqui a ideia é simples: tratar todo mundo com respeito.

## Licença

Ao contribuir, você concorda que sua contribuição será publicada sob a licença MIT do projeto.
