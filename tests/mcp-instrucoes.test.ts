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

/** O salvamento de compactação (D5) está nas instruções: a ferramenta, a skill e o que o salvamento leva. */
test('as instruções dizem para onde vai o salvamento antes da compactação e que cabem em 4.096 caracteres', () => {
  const t = INSTRUCOES_DO_SERVIDOR
  assert.match(t, /save_compaction_snapshot/)
  assert.match(t, /axon-salvar-antes-de-compactar/)
  assert.match(
    t,
    /Antes de a conversa compactar, a pedido do dono, o salvamento completo vai para save_compaction_snapshot: um checkpoint imutável com o estado, os pedidos do dono, as pendências e o próximo passo; a skill axon-salvar-antes-de-compactar conduz o passo a passo\./,
  )
  assert.ok(t.length <= 4096, `tem ${t.length} caracteres`)
})
