# Novidades da Axon

## 22 de novembro de 2026 · Onde paramos, mais fácil de ler

**A frase do estado agora é a manchete.** A primeira coisa que você lê em **Onde paramos** é a frase simples do estado do projeto, no alto, em letras grandes.

**O fio mostra quem fez o quê.** Cada coisa feita é um símbolo no fio, com um trilho para cada IA que trabalhou no projeto. Quando a IA muda, o fio desce de um trilho para o outro; quando o projeto ficou parado, aparece quantos dias. Passe o mouse (ou use as setas do teclado) para ver quando, quem e o quê. Clicar num símbolo leva você direto à linha dele em **O que foi feito**.

**O que foi feito virou uma lista por dia.** Só o dia de onde paramos começa aberto; os outros são uma linha com a primeira afirmação do dia, e cada coisa abre ao clicar. Meses antigos ficam recolhidos.

**O que falta e o que foi feito ficam lado a lado, da mesma altura.** Em monitores grandes, cada lista rola por dentro, e um aviso no pé diz se ainda há mais embaixo. Em telas menores, ficam uma embaixo da outra, como antes.

**Todo clique que leva a outro lugar mostra onde você chegou.** O destino acende por um instante e recebe o foco. Para quem prefere sem movimento, ele ganha um contorno em vez da animação.

**"Daqui em diante".** Abaixo do fio, um botão por grupo de pendência leva você ao grupo certo em **O que falta**.

## Novembro de 2026 · Etapas 3 e 4

### O que muda para você

**A aprovação pode ser no chat.** Quando você diz “gostei das artes” ou “pode publicar no staging”, a IA registra sua frase e a aprovação vale na hora. A Axon mostra quem fez o registro e permite desfazer pela tela. A autorização para publicar vale para o ambiente que você indicou.

**O cartão mostra em que pé está a entrega.** Dá para ver separadamente o que você aprovou, se os testes rodaram, se o código está local ou foi enviado e em quais ambientes a entrega foi publicada. O resumo também fica em **Onde paramos** e na leitura curta da IA.

**O resultado vem com o que se esperava.** Um teste que falhou de propósito, antes da correção, aparece como “Falhou como esperado (fase vermelha)”. Quando a IA registra a versão e o ambiente, o resultado também diz onde ela testou.

**A próxima IA pode ler só o que mudou.** A leitura curta traz uma marca para a próxima consulta. A partir dela, a IA vê novidades como uma decisão aceita, um bloqueio resolvido ou um item que voltou da lixeira. Na passagem de bastão, ela encontra primeiro o ponto de partida e como conferir, quando quem passou o trabalho preencheu esse ponto.

### Como atualizar

Depois que as etapas 3 e 4 chegarem ao seu ramo, atualize na pasta da Axon:

```bash
git pull
npm install
npm run build
```

Feche e abra a Axon e a IA que a usa. Na primeira abertura, a Axon acrescenta ao banco local o que a versão nova precisa.

### O que continua igual

- A Axon guarda a memória no seu computador. As IAs fazem o trabalho e conferem as verificações.
- O resultado de um teste é relato de quem o registrou até outra identidade conferir.
- Decisões de produto continuam aguardando seu aceite na tela. A aprovação no chat vale para o visual ou para a publicação da entrega.

## Novembro de 2026 · Etapa 2

### O que muda para você

**Aba Regras.** Suas regras, os erros a não repetir e as verificações ficam numa só aba. Ali você pode criar ou corrigir orientações e ver o que falhou antes de subir, de dizer pronto ou de fazer um commit.

**Lixeira.** Na aba Regras, você pode mandar uma orientação do projeto para a lixeira. Os itens excluídos somem das listas e das leituras das IAs. A lixeira permite restaurar ou apagar de vez, com confirmação na tela. A exportação padrão do projeto (v3) e a cópia de segurança guardam os itens junto com a marca de exclusão.

**Verificações com falha.** Quando a IA liga uma falha à verificação, você vê quantas vezes ela falhou, quando foi a última vez e o detalhe registrado. A leitura curta também mostra a contagem e a data.

**Objetivo atualizado pela IA.** Se um fato venceu, por exemplo, uma versão nova entrou no ar, a IA pode atualizar o objetivo e guardar o seu texto anterior. O aviso em **Onde paramos** mostra quem fez a mudança, a data e o motivo. Na aba **Diretriz**, você pode marcar **Está certo** ou escolher **Voltar ao meu texto**.

### Como atualizar

Na pasta da Axon, depois de a etapa 2 chegar ao seu ramo, rode:

```bash
git pull
npm install
npm run build
```

Feche e abra a Axon e a IA que a usa para carregar a atualização. A Axon acrescenta ao banco local os campos novos na primeira abertura.

### O que continua igual

- A Axon guarda a memória no seu computador. As IAs fazem o trabalho e conferem as verificações.
- O registro de um teste é relato de quem o fez até outra identidade conferir.
- As regras vêm da sua fala, e as decisões de produto aguardam o seu aceite na tela.

## Novembro de 2026 · Regras, erros a não repetir e uma leitura que basta

### O que muda para você

Agora você fala com a IA e ela guarda na Axon do jeito certo.

**"Isso é regra, não faça mais."**
A IA anota como **regra deste projeto**, com a sua frase exatamente como você disse. A regra vale na hora, para qualquer IA que ler a Axon depois. Se ela entendeu errado, peça para desfazer.

**"Antes de subir, confira X."**
A IA anota como **verificação** de um destes momentos: antes de subir, antes de dizer que está pronto, antes de commit ou junção. Quando chega a hora, a IA confere. Se falhar, ela registra a falha, tenta consertar e confere de novo; se continuar falhando, para e te chama.

**Erros que não podem se repetir.**
Quando a IA tropeça em algo (um comando que estraga acentos no Windows, por exemplo), ela anota sozinha como **erro**. Erro de máquina ou de ferramenta vale para todos os projetos; erro do produto vale só no projeto.

**"Vai na Axon e lê."**
Uma leitura só traz o que importa, nesta ordem:
- as suas regras;
- as verificações;
- o estado em uma frase;
- o próximo passo, com o registro de onde ele veio;
- o que depende de você;
- os erros a não repetir.

Cada item vem com o identificador do registro, para a IA abrir o detalhe sem chutar. Quando nenhum registro sustenta um próximo passo, a leitura diz isso com todas as letras, em vez de inventar.

**O que você decidiu aparece.**
Se você aprovou ou recusou algo depois do último registro de trabalho (por exemplo, "pode publicar no staging"), a leitura mostra a sua decisão, com a data e a sua nota, e avisa que o resumo anterior pode estar desatualizado. Antes, a aprovação simplesmente sumia da lista de pendências, e uma IA nova concluía que ainda faltava o seu OK. Só conta como decisão sua o que você aprovou ou recusou na tela da Axon. Uma decisão aceita por uma IA aparece à parte, com o nome que ela declarou, sem valer como ordem sua.

**Uma regra sua só muda com o seu pedido.**
A IA não consegue trocar nem aposentar uma regra ou verificação sua sem registrar a sua frase pedindo. Um texto com quebra de linha também não consegue mais se passar por regra sua na leitura, e senhas ou chaves guardadas por engano aparecem escondidas.

**Quando falta espaço, o importante entra primeiro.**
O resumo que a Axon monta para as IAs dava espaço a quem coubesse, e uma passagem de bastão podia ficar de fora enquanto um cartão comum entrava. Agora regras, verificações, perguntas para você, passagens e bloqueios vêm antes. Um registro longo entra resumido, em vez de sumir. Se as regras não couberem inteiras, elas e as verificações entram resumidas juntas, e nenhuma some sem aviso.

### O que a IA faz sozinha, e o que só faz se você pedir

| Sozinha | Só com o seu pedido |
|---|---|
| Anotar um erro que ela cometeu | Registrar uma regra ou verificação (é a sua fala) |
| Criar e mover cartões | Desfazer uma regra |
| Juntar repetidos e corrigir texto, guardando a versão anterior | Excluir qualquer coisa |
| Aposentar o que ficou velho, com o motivo | Apagar um registro |
| Anotar uma ideia sua como cartão em Ideias | Aceitar uma decisão (ela continua proposta até você aceitar na tela) |
| Marcar um cartão como Completo quando foi publicado e conferido | Copiar uma regra para o CLAUDE.md |

### Como atualizar

A sua memória (o banco em `.axon/workspace.sqlite`) não vai para o GitHub e não é tocada pela atualização. Na primeira vez que a Axon nova abrir, ela acrescenta sozinha o que o banco precisa. As lições que você já tinha continuam lá, como "erros".

1. Na pasta da Axon:
   ```bash
   git pull
   npm install
   npm run build
   ```
2. Feche e abra de novo o Claude Code, o Codex ou a IA que usa a Axon, para ela carregar a versão nova.
3. Opcional: `npm run axon:diagnostico` confere se está tudo ligado.

Se você não mudou nenhum arquivo da Axon por conta própria, o `git pull` não dá conflito. Se mudou, o git mostra quais arquivos precisam de atenção.

### O que continua igual

- Todas as ferramentas que já existiam funcionam como antes; elas só ganharam opções novas. Uma IA que usa a Axon do jeito antigo não quebra.
- A Axon não liga, não pausa e não vigia IA. Ela guarda e entrega; quem confere antes de subir é a IA.
- O que uma IA diz que testou continua sendo relato até outra identidade conferir.
- O nome de cada IA é declarado por ela mesma.

### Vem depois

- **Estado da entrega separado em partes:** visual aprovado, testes passando, código guardado e publicado.
- **O que mudou desde a última leitura**, e passagens de bastão com um ponto de conferência.
