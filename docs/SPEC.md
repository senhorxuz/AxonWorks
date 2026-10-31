# Hub de continuidade entre IAs — especificação de produto

Nome vigente: Axon Works. Diretório: D:\projetos\axon. Documento de 14/09/2026. Primeira versão local e pessoal; acesso remoto pode ser priorizado pelo usuário.

## Problema e promessa

O projeto pertence ao usuário, não à conversa nem ao provedor. Hoje objetivo, decisões, comandos e trabalho pendente ficam espalhados em chats e IDEs. Quando termina quota, contexto ou sessão, recomeçar custa tempo e introduz regressões. O produto deve permitir que outro agente encontre o estado verificável e prossiga dentro da autorização existente.

Não prometer recuperar contexto que nunca foi registrado, ler memória interna de modelos, eliminar limites de uso ou conectar automaticamente chats fechados. A experiência universal possui níveis: (1) pacote Markdown copiável em qualquer chat, (2) API para leitura e escrita de contexto, (3) MCP para clientes compatíveis e (4) conectores que facilitem ao agente devolver checkpoints ao correio. A aplicação web sozinha não concede acesso ao disco local de um usuário.

## Jornada principal

1. Usuário cadastra projeto de qualquer finalidade: software, design, 3D, pesquisa ou operação. Objetivo obrigatório, pasta opcional; artefatos genéricos, sem supor package.json ou Git.
2. Agente lê contrato do projeto, último checkpoint, decisões, tarefas e evidências. Declara o que entendeu e qual tarefa assume.
3. Reivindica tarefa com concessão temporária e versão. Recebe briefing focado; não todo histórico sem filtro.
4. Trabalha fora do AXON em alterações limitadas e registra checkpoints após marcos. O correio guarda o resultado declarado e sua proveniência, sem comandar as ferramentas do agente.
5. Quota ou sessão encerrada: último checkpoint durável permanece. Estado incompleto fica explícito. Outro agente recebe contexto e, após liberação/expiração, assume a tarefa.
6. Implementador solicita revisão com arquivos/artefatos e testes. Orquestrador decide próximo passo; conversa entre agentes vira thread rastreável com orçamento de rodadas.

## Núcleo e invariantes

- Memória estruturada: objetivo, restrições, critérios de aceite, decisões com motivos e datas, tarefas/dependências, checkpoints, evidências e artefatos. Separar fato verificado, relato de agente e hipótese.
- Checkpoints imutáveis e versionados; escrita transacional, idempotência e rejeição de versão antiga. Uma mensagem nunca substitui o estado canônico silenciosamente.
- Propriedade de tarefa por lease com prazo. Lease é cooperação entre agentes declarados nesta versão, não autenticação nem bloqueio físico de arquivos.
- Mensagens persistidas por projeto, autor, destino e finalidade (nota, pergunta, revisão, passagem). No MVP a entrega é caixa postal; envio não invoca um modelo automaticamente.
- Exportação sem dependência de provedor. Conteúdo de agentes/arquivos é dado não confiável e não ganha autoridade ao entrar no contexto.
- Dados do app separados do projeto. Registrar uma pasta não modifica nem envia seu conteúdo. Importação de Git/arquivos será opt-in e terá exclusões/revisão.
- Interface honesta: 'não conectado', 'não medido', 'relatado pelo agente', 'aguardando revisão'. Nunca simular progresso, quota ou presença para preencher a tela.

## Arquitetura escolhida para começar

React + TypeScript + Vite para interface; Node 24 + Express para API local; SQLite transacional para domínio; MCP stdio usando o mesmo serviço. Monólito modular permite começar sem Redis, Kubernetes ou serviços pagos. Persistência via banco embutido evita gravações JSON concorrentes. Toda regra crítica fica fora dos componentes e do transporte.

Fluxo: UI / MCP → WorkspaceStore → transação SQLite. Handoff lê um snapshot consistente. O produto não expõe execução de shell. HTTP vinculado a loopback e protegido contra chamadas de origem estrangeira. Exportação manual permite uso com chats sem ferramentas. Não há integração mágica com uma assinatura de chat; cada conector terá capacidade e disponibilidade verificadas.

MCP foi escolhido por expor ferramentas/recursos a clientes compatíveis; A2A fica como extensão para descoberta e delegação entre serviços independentes, sem afirmar conformidade antes de implementar e testar. Referências oficiais: https://modelcontextprotocol.io/specification/2025-11-25/basic e https://a2a-protocol.org/latest/specification/.

## Primeira entrega, critérios de aceite

Usuário abre aplicação vazia, cria projeto, tarefa, identifica um agente e assume tarefa; grava checkpoint com próximo passo; registra mensagem para outra IA; exporta Markdown; recarrega/reinicia mantendo dados. Segundo agente não assume lease vivo nem sobrescreve checkpoint antigo. Cliente MCP consegue consultar/publicar contexto usando o mesmo contrato. Outro desenvolvedor retoma a construção lendo o README e rodando testes sem depender desta conversa.

Isso é fundação funcional. Leitura Git opt-in, inbox com notificações, sincronização remota, busca semântica e colaboração autenticada só entram quando tiverem implementação e validação próprias. Execução automática e failover de modelos não pertencem ao produto.

## Ideias que tornam o produto mais inteligente

1. **Pré-voo de retomada:** comparar checkpoint com Git/artefatos atuais; avisar sobre diff não observado, branch diferente, teste antigo ou decisão revogada.
2. **Mapa de contexto:** montar briefing pelo objetivo/tarefa, orçamento disponível, relevância e proveniência; fatos prioritários sobrevivem a qualquer resumo. Texto original permanece referenciado.
3. **Retomada após queda:** checkpoints incrementais e rascunhos recuperáveis deixam explícito o último estado durável e o que pode ter ficado incompleto.
4. **Sugestão de continuidade:** apresentar o tipo de capacidade que o próximo trabalho pede, deixando a escolha e a abertura da IA nas mãos do usuário.
5. **Revisão adversarial limitada:** uma IA implementa, outra procura falhas, orquestrador resolve com critérios de aceite. Máximo de rodadas/custo; desacordo não vira loop infinito.
6. **Memória com validade:** cada fato tem fonte, data, confiança e mecanismo de invalidação. Resumos não promovem hipóteses a fatos.
7. **Linha do tempo reproduzível:** tarefa → alterações → comando → resultado → revisão → decisão. Links para arquivos/diffs/render/testes com hashes; evidência invalidada se artefato mudar.
8. **Perfis por projeto:** testes/comandos para código, cena/render para Blender, fontes para pesquisa, identidade visual para design. O núcleo permanece genérico.
9. **Controle do usuário:** escolher qual IA usará fora do AXON, revogar seu token/escopo e exportar tudo em formato aberto.
10. **O app gerencia sua construção:** usar o próprio projeto como primeiro caso real, com decisões e tarefas de implementação registradas, sem inserir dados fictícios na experiência de produção.

## Riscos concretos e resposta

Resumo perde detalhe → preservar fontes e mostrar truncamento. IA afirma que terminou → exigir evidência observada para conclusão verificada. Dois agentes editam juntos → worktrees/escopos + revisão; lease sozinho não protege arquivos. Quota acaba sem aviso → checkpoints incrementais e observador independente. Prompt injection → não executar instruções de conteúdo importado; ferramentas têm escopo separado. Segredo em contexto → não ler credenciais, seleção explícita e mascaramento auxiliar. Serviço local publicado por engano → não ouvir rede; remoto exige arquitetura de identidade e transporte próprios.

## Direção de interface atualizada pelo usuário
Ferramenta de trabalho bonita e agradável, com modo escuro e fontes comuns sem serifa. Priorizar biblioteca de projetos, backlog, tarefas, checkpoints e correio. Remover slogans e heróis promocionais da interface operacional. Feedback visual deve corresponder a ações reais. A rodada do backlog foi implementada pelo Grok sob orquestração/revisão da Astra e validada por build e Playwright.


## Correção de produto vigente — correio inteligente
O AXON não controla, inicia, cancela, monitora ou roteia IAs. Agentes externos usam Markdown, pacote AXON ou MCP para consultar contexto e escrever checkpoints/mensagens. A inteligência do produto está em selecionar, ordenar e apresentar o contexto certo para cada retomada, preservando fonte, validade e estado de leitura. Qualquer texto anterior sobre execução gerenciada ou failover de provedores fica fora da direção atual.

## Passagem estruturada entregue

Um checkpoint salvo pela identidade atual pode ser entregue a outra IA com um recado explícito em **Mensagem para a próxima IA**. A passagem preserva remetente, destinatário, revisão, tarefa vinculada, trabalho concluído e próximo passo. A destinatária a encontra antes das mensagens genéricas e também em sua retomada personalizada, com confirmação de leitura. O contador da aba sinaliza passagens não lidas. Nenhuma dessas ações inicia ou controla o destinatário.

## Backlog e portabilidade v3 entregues

Ideias podem ser capturadas com descrição, prioridade e autoria, preparadas e promovidas atomicamente para tarefas. O `ProjectBundle v3` transporta integralmente o projeto, charter versionado, decisões canônicas com histórico de substituição, bloqueios, contratos de tarefa com dependências acíclicas, biblioteca de documentos com FTS5, passagens estruturadas e recibos. Implementa inserção em duas fases (`two-phase insertion`) para eliminação de deadlocks de chave estrangeira, teto de 1 MB (`MAX_BUNDLE_SERIALIZED_BYTES = 1024 * 1024`), mascaramento rigoroso de segredos (`maskSecrets`) e remapeamento biunívoco de identidades (UUIDs). Pacotes legados v1 e v2 continuam sendo importados com total compatibilidade.
