import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../server/mcp-tools.ts'
import { WorkspaceStore } from '../server/store.ts'

/**
 * Pente fino 1.5 (22/11/2026): a tela de Retomar mostrou "D:Trabalho<barra sumida>agenda-de-posts" no lugar de
 * "D:\Trabalho\agenda-de-posts". Este teste leva o caminho pelo mesmo caminho das IAs (a ferramenta MCP
 * send_message) e lê de volta no briefing de retomada: o servidor guarda e devolve o texto sem mexer nas barras.
 *
 * Causa achada: o texto já chegou torto. Uma barra invertida sem escapar num texto de código ou de linha de
 * comando vira outra coisa antes de chegar à Axon ("\P" perde a barra e "\t" vira tabulação). O caminho abaixo
 * é escrito com String.raw justamente para isso não acontecer neste arquivo.
 */
const CAMINHO = String.raw`D:\Trabalho\agenda-de-posts`

describe('caminho de pasta com barras invertidas, de ponta a ponta no servidor', () => {
  it('o caminho do teste tem mesmo as barras (e nenhuma tabulação)', () => {
    assert.equal(CAMINHO.length, 'D:/Trabalho/agenda-de-posts'.length)
    assert.ok(!CAMINHO.includes('\t'))
  })

  it('a passagem enviada pelo MCP volta inteira na atenção da retomada', async () => {
    const store = new WorkspaceStore(':memory:')
    const projeto = store.createProject({ name: 'Nata', objective: 'Vender cursos pela internet' }).id
    const server = createMcpServer(store)
    const client = new Client({ name: 'barras-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const enviada = await client.callTool({ name: 'send_message', arguments: { projectId: projeto, from: 'Claude', to: 'Pente', kind: 'handoff', body: `Comece pelo repositório ${CAMINHO}. Depois leia o roteiro.` } })
      assert.notEqual(enviada.isError, true)
      const brief = store.getResumeBrief(projeto, 'Pente')
      const atencao = brief.attention.map(item => item.text).join('\n')
      assert.ok(atencao.includes(`repositório ${CAMINHO}.`), atencao)
      assert.ok(!atencao.includes('D:Trabalho'), atencao)
      assert.ok(brief.markdown.includes(CAMINHO), 'o markdown da retomada também guarda o caminho')
    } finally {
      await client.close()
      await server.close()
      store.close()
    }
  })
})
