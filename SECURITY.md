# Política de segurança

## Versões suportadas

Damos suporte à **última versão da branch `main`**. Correções de segurança entram nela. Versões antigas não recebem correção separada: atualize para a mais recente.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública** para falar de vulnerabilidade. Issue pública expõe o problema antes de existir correção.

Use o reporte privado do GitHub:

1. Abra a aba **Security** do repositório.
2. Clique em **Report a vulnerability**.
3. Ou vá direto para: https://github.com/senhorxuz/AxonWorks/security/advisories/new

Conte o que você achou, o que dá para fazer com isso e como reproduzir. Quanto mais claro o passo a passo, mais rápido a gente corrige.

**Importante:** não coloque chaves, tokens, senhas nem dados pessoais reais no relatório. Se precisar mostrar um exemplo, troque o segredo por um valor falso.

## O que esperar

- **Resposta inicial em até 7 dias.** É uma meta de boa-fé, não uma promessa jurídica nem um prazo contratual.
- Vamos confirmar o problema, dizer se entra no escopo e avisar o andamento da correção.
- Quando houver correção, publicamos o aviso e damos o crédito a quem reportou, se a pessoa quiser.
- Pedimos que você espere a correção sair antes de divulgar o problema em público.

## O que está no escopo

Nos interessam falhas em:

- o **servidor HTTP** da Axon;
- o **servidor MCP** usado pelas IAs;
- o **login do modo servidor**;
- o **backup** e a restauração;
- a **importação de pacotes** de projeto.

Também interessa qualquer caminho em que conteúdo vindo de IA seja tratado como comando. Na Axon, esse conteúdo é sempre dado.

## O que está fora do escopo

- Problemas em dependências de terceiros que já tenham aviso público (reporte para quem mantém a dependência; o Dependabot cuida de atualizar as nossas).
- Ataques que exigem acesso físico ao computador da pessoa ou que ela já esteja com o sistema comprometido.
- Falhas que só aparecem quando a pessoa desliga de propósito uma proteção documentada.
- Relatórios automáticos sem prova de que o problema existe na Axon.

## Boas práticas para quem usa a Axon

- **Rode em loopback.** Por padrão, a Axon escuta só no próprio computador (`127.0.0.1`). Mantenha assim, a menos que você precise de acesso remoto.
- **O modo servidor exige login.** Se for expor a Axon numa VPS ou na rede, use o modo servidor, com senha forte, e coloque HTTPS na frente.
- **Não guarde segredos nos registros.** Chaves, tokens e senhas não devem entrar em tarefas, decisões, checkpoints, evidências ou issues.
- **Faça backup** e teste a restauração de vez em quando.
- **Importe só pacotes de projeto em que você confia.**
- **Mantenha o Node e as dependências atualizados.**
