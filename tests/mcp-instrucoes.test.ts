import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'
import { INSTRUCOES_DO_SERVIDOR } from '../server/mcp-instrucoes.ts'

/** O servidor MCP entrega as instruções da Axon no handshake (o Claude Code as carrega no começo da sessão). */
for (const profile of ['full', 'essential'] as const) {
  test(`o servidor MCP (perfil ${profile}) entrega as instruções da Axon ao cliente`, async (t) => {
    const store = new WorkspaceStore(':memory:')
    const server = createMcpServer(store, { profile })
    const client = new Client({ name: 'instrucoes-test', version: '1.0.0' })
    t.after(async () => {
      await client.close()
      await server.close()
      store.close()
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    assert.equal(client.getInstructions(), INSTRUCOES_DO_SERVIDOR)
  })
}

/** Frente D (19/11/2026): os ganchos estão desligados; a leitura de entrada, as regras e as verificações vêm da fala do dono. */
test('as instruções não prometem retomada automática: sem os ganchos, o histórico só entra quando a IA o busca', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.doesNotMatch(t, /recebe a retomada do projeto ao abrir a sessão/)
  assert.doesNotMatch(t, /ao abrir a sessão/)
  // O texto vai para toda instalação: quem liga os ganchos (npm run claude:ligar) recebe a retomada; quem não liga, não.
  assert.doesNotMatch(t, /Nenhuma retomada chega sozinha/)
  assert.match(t, /Sem os ganchos do Claude Code ligados, o histórico entra na conversa quando uma IA o busca\./)
})

test('as instruções dizem qual é a leitura de entrada: get_resume_brief com pasta e modo curto', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /get_resume_brief com pasta \(a pasta da conversa\) e modo: 'curto'/)
  assert.match(t, /frase livre, sem comando/)
  assert.match(t, /list_lessons/)
})

test('as instruções dizem os três tipos de lição e que regra e verificação vêm da fala do dono', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /erro/)
  assert.match(t, /regra/)
  assert.match(t, /verificação/)
  assert.match(t, /fraseDoDono/)
  assert.match(t, /antes_de_subir/)
  assert.match(t, /antes_de_pronto/)
  assert.match(t, /antes_de_commit/)
  assert.match(t, /substitui/)
  assert.match(t, /retire_lesson/)
  assert.match(t, /fala do dono na conversa/)
  // Aposentar regra ou verificação sem as palavras do dono dá 400 pedido_do_dono_obrigatorio.
  assert.match(t, /retire_lesson com o motivo e o pedidoDoDono/)
})

test('as instruções separam regra de decisão e dizem que a Axon não bloqueia nada', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /propose_decision/)
  assert.match(t, /A Axon não bloqueia nada/)
  assert.match(t, /evidência failed/)
})

test('as instruções dizem o que a IA faz sem pedido do dono e o que só faz com pedido', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /Sem pedido do dono:/)
  assert.match(t, /Só com pedido do dono:/)
  assert.match(t, /excluir qualquer coisa/)
  assert.match(t, /redact_checkpoint/)
  assert.match(t, /copiar regra para o CLAUDE\.md/)
})

test('as instruções ficam folgadas dentro do teto de 4.096 caracteres', () => {
  assert.ok(INSTRUCOES_DO_SERVIDOR.length <= 3900, `tem ${INSTRUCOES_DO_SERVIDOR.length} caracteres`)
})

/** O salvamento de compactação (D5) está nas instruções: a ferramenta, a skill e o que o salvamento leva. */
test('as instruções dizem para onde vai o salvamento antes da compactação e que cabem em 4.096 caracteres', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /save_compaction_snapshot/)
  assert.match(t, /axon-salvar-antes-de-compactar/)
  assert.match(
    t,
    /Antes de a conversa compactar, a pedido do dono, save_compaction_snapshot guarda um checkpoint imutável com o estado, os pedidos do dono, as pendências e o próximo passo\. A skill axon-salvar-antes-de-compactar conduz o passo a passo\./,
  )
  assert.ok(t.length <= 4096, `tem ${t.length} caracteres`)
})

test('as instruções vinculam a lixeira ao pedido do dono e limitam a atualização de objetivo a fatos vencidos', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /trash_record, restore_record e purge_record só a pedido do dono/)
  assert.match(t, /purge_record só quando ele diz "apaga de vez"/)
  assert.match(t, /update_project_objective só para fato vencido, guardando o anterior/)
  assert.match(t, /evidência failed com verificacaoId/)
})

test('as instruções explicam a autoridade e o estado da entrega', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /A aprovação dita pelo dono no chat vale na hora\. record_owner_approval registra fraseDoDono literal e o nome declarado da IA\./)
  assert.match(t, /Publicar exige autorização vigente para o mesmo ambiente\./)
  assert.match(t, /undo_owner_approval desfaz a aprovação com pedidoDoDono literal\./)
  assert.match(t, /update_delivery mantém o estado da entrega \(testes, código e publicação\)\. get_delivery abre o detalhe\./)
})

test('as instruções explicam o delta, a evidência contextualizada e o ponto de conferência', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /No modo curto, get_resume_brief com desde=<marca da leitura anterior> traz só o que mudou\./)
  assert.match(t, /Evidências aceitam esperado \(passar ou falhar\), versao \(commit\) e ambiente\./)
  assert.match(t, /A passagem aceita pontoDeConferencia opcional com comoConferir e o ponto de partida antes da narrativa\./)
})
