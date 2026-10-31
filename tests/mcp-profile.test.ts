import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../server/mcp-tools.ts'
import { parseMcpProfile } from '../server/mcp-profile.ts'
import { WorkspaceStore } from '../server/store.ts'

// Especificação independente: escrita à mão, não importada do código.
const ESSENCIAL = [
  'list_projects', 'search_projects', 'get_project', 'get_resume_brief', 'get_charter',
  'acknowledge_handoff_delivery', 'acknowledge_message', 'resolve_message_attention',
  'claim_task', 'send_message', 'save_work_draft', 'save_checkpoint', 'finalize_work',
  'open_blocker', 'resolve_blocker', 'create_backlog_item',
  'propose_approval', 'propose_decision', 'get_project_insights',
  'search_content', 'list_evidence', 'cross_check_evidence',
  'get_board', 'create_board_card', 'update_board_card', 'move_board_card',
].sort()

// Pedido do dono: nenhuma tool pode sumir. Esta lista protege as 89 tools do perfil completo.
// Ao criar uma tool nova, acrescente o nome aqui; nunca apague um nome para o teste passar.
const TODAS = (
  'list_projects create_project get_project get_handoff create_task update_task_contract claim_task release_task ' +
  'reopen_task get_task_events finalize_work save_checkpoint send_message search_projects get_inbox get_resume_brief ' +
  'compile_context acknowledge_message resolve_message_attention create_handoff_delivery get_handoff_deliveries ' +
  'save_work_draft get_work_drafts discard_work_draft acknowledge_handoff_delivery create_backlog_item get_backlog ' +
  'update_backlog_item promote_backlog_item archive_backlog_item delete_project delete_backlog_item ' +
  'export_project_bundle import_project_bundle propose_decision accept_decision revoke_decision supersede_decision ' +
  'get_decisions get_decision_timeline list_evidence get_evidence register_evidence_artifacts cross_check_evidence ' +
  'get_charter save_charter propose_approval list_approvals withdraw_approval open_blocker list_blockers ' +
  'resolve_blocker reopen_blocker get_blocker_timeline create_content list_content get_content revise_content ' +
  'search_content archive_content add_content_relation create_backup list_backups run_recovery_drill ' +
  'get_backup_drills restore_backup create_auth_token list_auth_tokens revoke_auth_token list_project_members ' +
  'list_audit_logs get_project_graph detect_decision_conflicts detect_stale_content analyze_graph_impact ' +
  'get_project_insights get_board create_board_card update_board_card move_board_card get_board_card_events ' +
  'get_where_we_stopped record_lesson list_lessons retire_lesson save_compaction_snapshot search_memory ' +
  'redact_checkpoint_excerpt redact_checkpoint'
).split(' ').sort()

const raiz = path.resolve(import.meta.dirname, '..')

async function nomesDasTools(opcoes?: Parameters<typeof createMcpServer>[1]) {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store, opcoes)
  const client = new Client({ name: 'perfil-mcp', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    return (await client.listTools()).tools.map((tool) => tool.name).sort()
  } finally {
    await client.close()
    await server.close()
    store.close()
  }
}

describe('perfil do MCP', () => {
  test('parseMcpProfile: sem variável é completo; aceita só essential e full', () => {
    assert.equal(parseMcpProfile(undefined), 'full')
    assert.equal(parseMcpProfile('essential'), 'essential')
    assert.equal(parseMcpProfile('full'), 'full')
    for (const invalido of ['', 'completo', 'FULL', ' full']) {
      assert.throws(() => parseMcpProfile(invalido), /AXON_MCP_PROFILE deve ser "essential" ou "full"/)
    }
  })

  test('perfil completo mantém todas as 89 tools, sem perder nenhuma', async () => {
    assert.equal(TODAS.length, 89)
    assert.deepEqual(await nomesDasTools({ profile: 'full' }), TODAS)
    for (const nome of ESSENCIAL) assert.ok(TODAS.includes(nome), `o essencial cita ${nome}, que não existe`)
  })

  test('sem opção, createMcpServer usa o perfil completo', async () => {
    assert.deepEqual(await nomesDasTools(), TODAS)
  })

  test('perfil essencial, quando ligado, expõe exatamente o ciclo de trabalho de uma IA', async () => {
    assert.deepEqual(await nomesDasTools({ profile: 'essential' }), ESSENCIAL)
  })

  for (const caso of [
    { nome: 'sem a variável, sobe no perfil completo', perfil: undefined, esperado: TODAS },
    { nome: 'com AXON_MCP_PROFILE=essential, sobe no perfil essencial', perfil: 'essential', esperado: ESSENCIAL },
  ]) {
    test(`o processo real (server/mcp.ts): ${caso.nome}`, async () => {
      const pasta = mkdtempSync(path.join(tmpdir(), 'axon-perfil-mcp-'))
      const env: Record<string, string> = {}
      for (const [chave, valor] of Object.entries(process.env)) if (valor !== undefined && chave !== 'AXON_MCP_PROFILE') env[chave] = valor
      env.AXON_DB_PATH = path.join(pasta, 'perfil.sqlite')
      if (caso.perfil) env.AXON_MCP_PROFILE = caso.perfil
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', './node_modules/tsx/dist/loader.mjs', 'server/mcp.ts'],
        cwd: raiz,
        env,
        stderr: 'ignore',
      })
      const client = new Client({ name: 'perfil-mcp-processo', version: '1.0.0' })
      try {
        await client.connect(transport)
        const nomes = (await client.listTools()).tools.map((tool) => tool.name).sort()
        assert.deepEqual(nomes, caso.esperado)
      } finally {
        await client.close()
        rmSync(pasta, { recursive: true, force: true })
      }
    })
  }

  test('o processo real recusa um perfil inválido em vez de subir com um padrão silencioso', () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'axon-perfil-mcp-'))
    try {
      const saida = spawnSync(process.execPath, ['--import', './node_modules/tsx/dist/loader.mjs', 'server/mcp.ts'], {
        cwd: raiz,
        env: { ...process.env, AXON_DB_PATH: path.join(pasta, 'perfil.sqlite'), AXON_MCP_PROFILE: 'completo' },
        input: '',
        encoding: 'utf8',
        timeout: 30000,
      })
      assert.notEqual(saida.status, 0)
      assert.match(saida.stderr, /AXON_MCP_PROFILE deve ser "essential" ou "full"/)
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
