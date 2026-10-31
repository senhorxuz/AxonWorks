import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../server/mcp-tools.ts'
import { createProjectBundleV2, createProjectBundleV3, parseProjectBundle } from '../server/portability/index.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import {
  KIND_COMPACTACAO,
  camposDoSalvamento,
  canonicoDoSalvamento,
  colunasDoSalvamento,
  extrasImportados,
  validarSalvamento,
} from '../server/store/salvamento.ts'
import type { CompactionSnapshotInput } from '../shared/types.ts'

/**
 * Salvamento de compactação (D5): um checkpoint com `kind = 'compactacao'` e os extras (pedidos do dono,
 * pendências, perguntas abertas, arquivos mexidos), gravado pelo mesmo caminho transacional do
 * `saveCheckpoint`. Tudo em banco de memória ou em pasta temporária; nunca no banco real.
 */

const limpezas: Array<() => void> = []
afterEach(() => {
  for (const limpar of limpezas.splice(0).reverse()) limpar()
})

function novoStore(caminho = ':memory:'): WorkspaceStore {
  const store = new WorkspaceStore(caminho)
  limpezas.push(() => store.close())
  return store
}

function entrada(over: Partial<CompactionSnapshotInput> = {}): CompactionSnapshotInput {
  return {
    expectedRevision: 0,
    idempotencyKey: 'salvar-1',
    agent: 'Claude',
    summary: 'Login refeito com sessão no servidor; falta o cadastro.',
    humanSummary: 'O login novo está pronto; falta o cadastro.',
    nextStep: 'Fazer a tela de cadastro.',
    pedidosDoDono: ['Arruma o login', 'Depois o cadastro'],
    pendencias: ['Tela de cadastro'],
    ...over,
  }
}

function erroDe(fazer: () => unknown): DomainError {
  try {
    fazer()
  } catch (erro) {
    assert.ok(erro instanceof DomainError, `esperava DomainError, veio ${String(erro)}`)
    return erro
  }
  assert.fail('esperava uma recusa')
}

function banco(store: WorkspaceStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db
}

// ---------------------------------------------------------------------------------------------
// Regra pura
// ---------------------------------------------------------------------------------------------

describe('validarSalvamento', () => {
  it('separa o checkpoint comum dos extras; listas opcionais viram vazias', () => {
    const v = validarSalvamento({ ...entrada(), decisions: ['Sessão no servidor'] })
    assert.deepEqual(v.extras, {
      pedidosDoDono: ['Arruma o login', 'Depois o cadastro'],
      pendencias: ['Tela de cadastro'],
      perguntasAbertas: [],
      arquivosMexidos: [],
    })
    assert.deepEqual(v.checkpoint, {
      expectedRevision: 0,
      idempotencyKey: 'salvar-1',
      agent: 'Claude',
      summary: 'Login refeito com sessão no servidor; falta o cadastro.',
      humanSummary: 'O login novo está pronto; falta o cadastro.',
      nextStep: 'Fazer a tela de cadastro.',
      decisions: ['Sessão no servidor'],
    })
  })

  it('perguntas e arquivos, quando vêm, são guardados aparados', () => {
    const v = validarSalvamento(entrada({ perguntasAbertas: [' Qual banco? '], arquivosMexidos: ['src/login.ts'] }))
    assert.deepEqual(v.extras.perguntasAbertas, ['Qual banco?'])
    assert.deepEqual(v.extras.arquivosMexidos, ['src/login.ts'])
  })

  it('bloqueios, evidências e tarefa não fazem parte do salvamento e ficam de fora', () => {
    const v = validarSalvamento({ ...entrada(), blockers: ['x'], evidence: [], taskId: randomUUID() })
    assert.deepEqual(Object.keys(v.checkpoint).sort(), [
      'agent',
      'decisions',
      'expectedRevision',
      'humanSummary',
      'idempotencyKey',
      'nextStep',
      'summary',
    ])
  })

  it('listas vazias de pedidos e pendências são aceitas (nada a guardar é honesto)', () => {
    const v = validarSalvamento(entrada({ pedidosDoDono: [], pendencias: [] }))
    assert.deepEqual(v.extras.pedidosDoDono, [])
    assert.deepEqual(v.extras.pendencias, [])
  })

  for (const campo of ['pedidosDoDono', 'pendencias'] as const) {
    it(`sem ${campo}: recusa com o nome do campo`, () => {
      const { [campo]: _tirado, ...sem } = entrada()
      const erro = erroDe(() => validarSalvamento(sem))
      assert.equal(erro.status, 400)
      assert.equal(erro.code, 'invalid_input')
      assert.equal(erro.message, `Campo ${campo} inválido.`)
    })
  }

  it('lista com item vazio ou não texto: recusa com a posição do item', () => {
    assert.equal(erroDe(() => validarSalvamento(entrada({ pendencias: ['ok', '  '] }))).message, 'Campo pendencias[1] inválido.')
    assert.equal(
      erroDe(() => validarSalvamento({ ...entrada(), arquivosMexidos: [3] })).message,
      'Campo arquivosMexidos[0] inválido.',
    )
    assert.equal(erroDe(() => validarSalvamento({ ...entrada(), perguntasAbertas: 'x' })).message, 'Campo perguntasAbertas inválido.')
  })

  it('sem humanSummary (ou vazio, ou acima de 280): recusa', () => {
    const { humanSummary: _tirado, ...sem } = entrada()
    assert.equal(erroDe(() => validarSalvamento(sem)).message, 'Campo humanSummary inválido.')
    assert.equal(erroDe(() => validarSalvamento(entrada({ humanSummary: '   ' }))).message, 'Campo humanSummary inválido.')
    assert.equal(erroDe(() => validarSalvamento(entrada({ humanSummary: 'a'.repeat(281) }))).message, 'Campo humanSummary inválido.')
    assert.equal(validarSalvamento(entrada({ humanSummary: 'a'.repeat(280) })).checkpoint.humanSummary, 'a'.repeat(280))
  })

  it('entrada que não é objeto: recusa dizendo que são os dados do salvamento', () => {
    const erro = erroDe(() => validarSalvamento(null))
    assert.equal(erro.code, 'invalid_input')
    assert.equal(erro.message, 'Dados de salvamento inválidos.')
  })
})

describe('gravação e leitura das colunas', () => {
  const extras = { pedidosDoDono: ['a'], pendencias: ['b'], perguntasAbertas: ['c'], arquivosMexidos: ['d'] }

  it('checkpoint normal: kind normal, sem extras e nada a mais na carga canônica', () => {
    assert.deepEqual(colunasDoSalvamento(null), { kind: 'normal', extrasJson: null })
    assert.deepEqual(canonicoDoSalvamento(null), {})
  })

  it('salvamento: kind compactacao, extras em JSON e os dois na carga canônica', () => {
    assert.equal(KIND_COMPACTACAO, 'compactacao')
    assert.deepEqual(colunasDoSalvamento(extras), { kind: 'compactacao', extrasJson: JSON.stringify(extras) })
    assert.deepEqual(canonicoDoSalvamento(extras), { kind: 'compactacao', extras })
  })

  it('linha normal, antiga (sem a coluna) ou de outro tipo: nenhum campo novo', () => {
    assert.deepEqual(camposDoSalvamento({ kind: 'normal', extras_json: null }), {})
    assert.deepEqual(camposDoSalvamento({}), {})
    assert.deepEqual(camposDoSalvamento({ kind: 'outro', extras_json: JSON.stringify(extras) }), {})
  })

  it('linha de salvamento: devolve kind e extras', () => {
    assert.deepEqual(camposDoSalvamento({ kind: 'compactacao', extras_json: JSON.stringify(extras) }), {
      kind: 'compactacao',
      extras,
    })
  })

  it('extras ausentes, ilegíveis ou fora do formato: listas vazias, só os textos ficam', () => {
    const vazio = { pedidosDoDono: [], pendencias: [], perguntasAbertas: [], arquivosMexidos: [] }
    assert.deepEqual(camposDoSalvamento({ kind: 'compactacao', extras_json: null }), { kind: 'compactacao', extras: vazio })
    assert.deepEqual(camposDoSalvamento({ kind: 'compactacao', extras_json: '{quebrado' }), { kind: 'compactacao', extras: vazio })
    assert.deepEqual(camposDoSalvamento({ kind: 'compactacao', extras_json: 'null' }), { kind: 'compactacao', extras: vazio })
    assert.deepEqual(camposDoSalvamento({ kind: 'compactacao' }), { kind: 'compactacao', extras: vazio })
    assert.deepEqual(camposDoSalvamento({ kind: 'compactacao', extras_json: 7 }), { kind: 'compactacao', extras: vazio })
    assert.deepEqual(
      camposDoSalvamento({
        kind: 'compactacao',
        extras_json: JSON.stringify({ pedidosDoDono: ['a', 2, null], pendencias: 'b', perguntasAbertas: [{}], arquivosMexidos: ['d'] }),
      }),
      { kind: 'compactacao', extras: { pedidosDoDono: ['a'], pendencias: [], perguntasAbertas: [], arquivosMexidos: ['d'] } },
    )
  })
})

describe('extrasImportados', () => {
  const lista = ['a', 'b']

  it('sem kind, ou kind normal: checkpoint comum, e extras soltos não valem', () => {
    assert.equal(extrasImportados({}, 'checkpoints[0]'), null)
    assert.equal(extrasImportados({ kind: 'normal' }, 'checkpoints[0]'), null)
    assert.equal(extrasImportados({ extras: { pendencias: lista } }, 'checkpoints[0]'), null)
  })

  it('kind compactacao: lê as quatro listas, aparadas; as que faltam vêm vazias', () => {
    assert.deepEqual(
      extrasImportados({ kind: 'compactacao', extras: { pedidosDoDono: [' a '], arquivosMexidos: lista } }, 'checkpoints[0]'),
      { pedidosDoDono: ['a'], pendencias: [], perguntasAbertas: [], arquivosMexidos: lista },
    )
    assert.deepEqual(extrasImportados({ kind: 'compactacao' }, 'checkpoints[0]'), {
      pedidosDoDono: [],
      pendencias: [],
      perguntasAbertas: [],
      arquivosMexidos: [],
    })
  })

  it('kind de outro tipo (texto desconhecido, null, número): recusa com o lugar do registro', () => {
    for (const kind of ['outro', null, 7, '']) {
      const erro = erroDe(() => extrasImportados({ kind }, 'checkpoints[3]'))
      assert.equal(erro.status, 400)
      assert.equal(erro.code, 'invalid_input')
      assert.equal(erro.message, 'Campo checkpoints[3].kind inválido.')
    }
  })

  it('extras que não é objeto, ou lista fora do formato: recusa nomeando o campo', () => {
    for (const extras of [null, 'solto', [], 4]) {
      assert.equal(erroDe(() => extrasImportados({ kind: 'compactacao', extras }, 'checkpoints[0]')).message, 'Dados de checkpoints[0].extras inválidos.')
    }
    assert.equal(
      erroDe(() => extrasImportados({ kind: 'compactacao', extras: { perguntasAbertas: [' '] } }, 'checkpoints[0]')).message,
      'Campo checkpoints[0].extras.perguntasAbertas[0] inválido.',
    )
    assert.equal(
      erroDe(() => extrasImportados({ kind: 'compactacao', extras: { pendencias: 'x' } }, 'checkpoints[0]')).message,
      'Campo checkpoints[0].extras.pendencias inválido.',
    )
  })
})

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

describe('saveCompactionSnapshot', () => {
  it('grava um checkpoint de compactação, sobe a revisão e devolve kind e extras', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    const salvo = store.saveCompactionSnapshot(projeto.id, entrada({ arquivosMexidos: ['src/login.ts'] }))
    assert.equal(salvo.kind, 'compactacao')
    assert.deepEqual(salvo.extras, {
      pedidosDoDono: ['Arruma o login', 'Depois o cadastro'],
      pendencias: ['Tela de cadastro'],
      perguntasAbertas: [],
      arquivosMexidos: ['src/login.ts'],
    })
    assert.equal(salvo.revision, 1)
    assert.equal(salvo.humanSummary, 'O login novo está pronto; falta o cadastro.')
    assert.deepEqual(salvo.blockers, [])
    assert.deepEqual(salvo.evidence, [])
    const detalhe = store.getProject(projeto.id)
    assert.equal(detalhe.project.revision, 1)
    assert.deepEqual(detalhe.checkpoints, [salvo])
    const linha = banco(store).prepare('SELECT kind, extras_json FROM checkpoints WHERE id = ?').get(salvo.id) as Record<string, unknown>
    assert.equal(linha.kind, 'compactacao')
    assert.deepEqual(JSON.parse(linha.extras_json as string), salvo.extras)
  })

  it('checkpoint comum continua sem kind nem extras, e a coluna guarda "normal"', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    const comum = store.saveCheckpoint(projeto.id, { expectedRevision: 0, idempotencyKey: 'n-1', agent: 'Claude', summary: 'S', nextStep: 'N' })
    assert.equal('kind' in comum, false)
    assert.equal('extras' in comum, false)
    const linha = banco(store).prepare('SELECT kind, extras_json FROM checkpoints WHERE id = ?').get(comum.id) as Record<string, unknown>
    assert.deepEqual({ ...linha }, { kind: 'normal', extras_json: null })
  })

  it('repetir com a mesma chave e o mesmo conteúdo devolve o mesmo registro, sem subir a revisão', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    const primeiro = store.saveCompactionSnapshot(projeto.id, entrada())
    const repetido = store.saveCompactionSnapshot(projeto.id, entrada())
    assert.deepEqual(repetido, primeiro)
    assert.equal(store.getProject(projeto.id).project.revision, 1)
    assert.equal(store.getProject(projeto.id).checkpoints.length, 1)
  })

  it('mesma chave com outros extras: conflito de idempotência', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    store.saveCompactionSnapshot(projeto.id, entrada())
    const erro = erroDe(() => store.saveCompactionSnapshot(projeto.id, entrada({ pendencias: ['Outra coisa'] })))
    assert.equal(erro.status, 409)
    assert.equal(erro.code, 'idempotency_conflict')
  })

  it('mesma chave e mesmo texto de um checkpoint comum: conflito (o tipo faz parte do conteúdo)', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    const { checkpoint } = validarSalvamento(entrada())
    const comum = store.saveCheckpoint(projeto.id, checkpoint)
    const erro = erroDe(() => store.saveCompactionSnapshot(projeto.id, entrada()))
    assert.equal(erro.code, 'idempotency_conflict')
    assert.deepEqual(store.saveCheckpoint(projeto.id, checkpoint), comum, 'o replay do comum continua devolvendo o mesmo')
  })

  it('revisão desatualizada: recusa como o save_checkpoint', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    store.saveCompactionSnapshot(projeto.id, entrada())
    const erro = erroDe(() => store.saveCompactionSnapshot(projeto.id, entrada({ idempotencyKey: 'salvar-2' })))
    assert.equal(erro.code, 'revision_conflict')
  })

  it('entrada inválida não grava nada', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    const { pedidosDoDono: _tirado, ...sem } = entrada()
    assert.equal(erroDe(() => store.saveCompactionSnapshot(projeto.id, sem as CompactionSnapshotInput)).code, 'invalid_input')
    assert.equal(erroDe(() => store.saveCompactionSnapshot(projeto.id, entrada({ summary: '' }))).message, 'Campo summary inválido.')
    assert.equal(store.getProject(projeto.id).checkpoints.length, 0)
  })

  it('o salvamento é achado pelas leituras por id do checkpoint (evidências dele: nenhuma)', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    const salvo = store.saveCompactionSnapshot(projeto.id, entrada())
    assert.deepEqual(store.listEvidence(projeto.id, { checkpointId: salvo.id }), [])
  })

  it('o salvamento é imutável como qualquer checkpoint', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    const salvo = store.saveCompactionSnapshot(projeto.id, entrada())
    assert.throws(() => banco(store).prepare(`UPDATE checkpoints SET kind = 'normal' WHERE id = ?`).run(salvo.id), /immutable/)
  })
})

describe('banco antigo (Review Focus 3)', () => {
  it('abre um banco sem as colunas kind e extras_json, mantém o registro antigo e grava salvamentos', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'axon-salvamento-legado-'))
    limpezas.push(() => rmSync(pasta, { recursive: true, force: true }))
    const caminho = join(pasta, 'legado.sqlite')
    const cru = new DatabaseSync(caminho)
    cru.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, objective TEXT NOT NULL,
        workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL
      );
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT,
        agent TEXT NOT NULL, summary TEXT NOT NULL, human_summary TEXT, next_step TEXT NOT NULL,
        blockers_json TEXT NOT NULL, decisions_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
        revision INTEGER NOT NULL, created_at TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        payload_canonical TEXT NOT NULL, UNIQUE (project_id, idempotency_key)
      );
      CREATE TRIGGER trg_checkpoints_immutable BEFORE UPDATE ON checkpoints
      BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;
    `)
    const pid = randomUUID()
    const quando = '2026-01-01T00:00:00.000Z'
    cru.prepare(`INSERT INTO projects VALUES (?, 'Legado', 'Objetivo antigo', '', ?, ?, 1)`).run(pid, quando, quando)
    cru
      .prepare(
        `INSERT INTO checkpoints (id, project_id, task_id, agent, summary, next_step, blockers_json, decisions_json,
           evidence_json, revision, created_at, idempotency_key, payload_canonical)
         VALUES (?, ?, NULL, 'alfa', 'Resumo antigo', 'Passo antigo', '[]', '[]', '[]', 1, ?, 'legado-1', '{}')`,
      )
      .run(randomUUID(), pid, quando)
    cru.close()

    const store = novoStore(caminho)
    const [antigo] = store.getProject(pid).checkpoints
    assert.equal(antigo!.summary, 'Resumo antigo')
    assert.equal('kind' in antigo!, false)
    const coluna = banco(store).prepare('SELECT kind, extras_json FROM checkpoints WHERE id = ?').get(antigo!.id) as Record<string, unknown>
    assert.deepEqual({ ...coluna }, { kind: 'normal', extras_json: null })
    const colunas = (banco(store).prepare('PRAGMA table_info(checkpoints)').all() as Array<Record<string, unknown>>)
      .filter((c) => c.name === 'kind' || c.name === 'extras_json')
      .map((c) => [c.name, c.type, c.notnull, c.dflt_value])
    assert.deepEqual(colunas, [
      ['kind', 'TEXT', 1, "'normal'"],
      ['extras_json', 'TEXT', 0, null],
    ])

    const salvo = store.saveCompactionSnapshot(pid, entrada({ expectedRevision: 1 }))
    assert.equal(salvo.kind, 'compactacao')
    assert.equal(salvo.revision, 2)
  })
})

// ---------------------------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------------------------

test('MCP: save_compaction_snapshot grava, repete sem duplicar e recusa sem os pedidos do dono', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createMcpServer(store)
  const client = new Client({ name: 'salvamento-mcp-test', version: '1.0.0' })
  t.after(async () => {
    await client.close()
    await server.close()
    store.close()
  })
  const [lado, outro] = InMemoryTransport.createLinkedPair()
  await server.connect(outro)
  await client.connect(lado)

  const ferramenta = (await client.listTools()).tools.find((tool) => tool.name === 'save_compaction_snapshot')
  assert.ok(ferramenta, 'a ferramenta existe')
  assert.deepEqual([...(ferramenta.inputSchema.required ?? [])].sort(), [
    'agent',
    'expectedRevision',
    'humanSummary',
    'idempotencyKey',
    'nextStep',
    'pedidosDoDono',
    'pendencias',
    'projectId',
    'summary',
  ])

  const projeto = store.createProject({ name: 'Alfa', objective: 'Vender cursos' })
  const chamar = async (args: Record<string, unknown>) => {
    const resposta = await client.callTool({ name: 'save_compaction_snapshot', arguments: args })
    const conteudo = resposta.content as Array<{ type: string; text: string }>
    return { erro: resposta.isError === true, texto: conteudo[0]!.text }
  }
  const args = { projectId: projeto.id, ...entrada({ perguntasAbertas: ['Qual banco?'] }) }
  const primeiro = await chamar(args)
  assert.equal(primeiro.erro, false, primeiro.texto)
  const salvo = JSON.parse(primeiro.texto)
  assert.equal(salvo.kind, 'compactacao')
  assert.deepEqual(salvo.extras.perguntasAbertas, ['Qual banco?'])

  const repetido = await chamar(args)
  assert.equal(JSON.parse(repetido.texto).id, salvo.id)
  assert.equal(store.getProject(projeto.id).checkpoints.length, 1)

  const { pedidosDoDono: _tirado, ...sem } = args
  const recusa = await chamar({ ...sem, idempotencyKey: 'salvar-2', expectedRevision: 1 })
  assert.equal(recusa.erro, true)
  assert.match(recusa.texto, /pedidosDoDono/)
  assert.equal(store.getProject(projeto.id).checkpoints.length, 1)
})

// ---------------------------------------------------------------------------------------------
// Pacote de portabilidade (revisão da onda 1): o salvamento viaja na v3; a v2 declara que não o leva
// ---------------------------------------------------------------------------------------------

const EXTRAS_COMPLETOS = {
  pedidosDoDono: ['Arruma o login', 'Depois o cadastro'],
  pendencias: ['Tela de cadastro'],
  perguntasAbertas: ['Qual banco?'],
  arquivosMexidos: ['src/login.ts'],
}

/** O que o pacote faz na estrada: vira texto e volta. */
function pelaEstrada<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T
}

function linhaDoCheckpoint(store: WorkspaceStore, id: string): Record<string, unknown> {
  const linha = banco(store)
    .prepare('SELECT kind, extras_json, payload_canonical FROM checkpoints WHERE id = ?')
    .get(id) as Record<string, unknown>
  return { ...linha }
}

function projetoComSalvamento(over: Partial<CompactionSnapshotInput> = {}) {
  const origem = novoStore()
  const projeto = origem.createProject({ name: 'Alfa', objective: 'Vender cursos' })
  const salvo = origem.saveCompactionSnapshot(projeto.id, entrada({ ...EXTRAS_COMPLETOS, ...over }))
  return { origem, projeto, salvo }
}

describe('pacote v3: o salvamento viaja', () => {
  it('ida e volta: salvamento, exportar v3, importar: kind e extras chegam iguais, na coluna também', () => {
    const { origem, projeto, salvo } = projetoComSalvamento()
    const pacote = pelaEstrada(createProjectBundleV3(origem.exportProjectBundleData(projeto.id)))
    assert.equal(pacote.project.checkpoints[0]!.kind, 'compactacao')
    assert.deepEqual(pacote.project.checkpoints[0]!.extras, EXTRAS_COMPLETOS)

    const destino = novoStore()
    const importado = destino.importProjectBundleData(parseProjectBundle(pacote))
    const [copia] = destino.getProject(importado.project.id).checkpoints
    assert.equal(copia!.kind, 'compactacao')
    assert.deepEqual(copia!.extras, EXTRAS_COMPLETOS)
    assert.equal(copia!.humanSummary, salvo.humanSummary)
    // A coluna e a carga canônica (a base da idempotência) saem iguais às da origem.
    assert.deepEqual(linhaDoCheckpoint(destino, copia!.id), linhaDoCheckpoint(origem, salvo.id))
  })

  it('o checkpoint comum viaja sem as chaves kind e extras, e a cópia dele continua comum', () => {
    const origem = novoStore()
    const projeto = origem.createProject({ name: 'Alfa', objective: 'Vender cursos' })
    const comum = origem.saveCheckpoint(projeto.id, { expectedRevision: 0, idempotencyKey: 'n-1', agent: 'Claude', summary: 'S', nextStep: 'N' })
    const pacoteVivo = createProjectBundleV3(origem.exportProjectBundleData(projeto.id))
    // As chaves não existem nem no objeto que sai da exportação (JSON esconderia uma chave com valor undefined).
    assert.equal('kind' in pacoteVivo.project.checkpoints[0]!, false)
    assert.equal('extras' in pacoteVivo.project.checkpoints[0]!, false)
    const pacote = pelaEstrada(pacoteVivo)

    const destino = novoStore()
    const importado = destino.importProjectBundleData(parseProjectBundle(pacote))
    const [copia] = destino.getProject(importado.project.id).checkpoints
    assert.equal('kind' in copia!, false)
    assert.equal('extras' in copia!, false)
    assert.deepEqual(linhaDoCheckpoint(destino, copia!.id), linhaDoCheckpoint(origem, comum.id))
    assert.equal(linhaDoCheckpoint(destino, copia!.id).kind, 'normal')
  })

  it('segredos nos quatro campos dos extras são mascarados na exportação', () => {
    const { origem, projeto } = projetoComSalvamento({
      pedidosDoDono: ['Use API_KEY=segredo-pedido'],
      pendencias: ['Trocar TOKEN=segredo-pendencia'],
      perguntasAbertas: ['A senha PASSWORD=segredo-pergunta vale?'],
      arquivosMexidos: ['config com SECRET=segredo-arquivo'],
    })
    const pacote = pelaEstrada(createProjectBundleV3(origem.exportProjectBundleData(projeto.id)))
    assert.deepEqual(pacote.project.checkpoints[0]!.extras, {
      pedidosDoDono: ['Use API_KEY=***'],
      pendencias: ['Trocar TOKEN=***'],
      perguntasAbertas: ['A senha PASSWORD=*** vale?'],
      arquivosMexidos: ['config com SECRET=***'],
    })
    assert.doesNotMatch(JSON.stringify(pacote), /segredo-/)
  })

  it('o pacote v3 não declara o salvamento como omitido', () => {
    const { origem, projeto } = projetoComSalvamento()
    const entidades = (createProjectBundleV3(origem.exportProjectBundleData(projeto.id)).omissions ?? []).map((o) => o.entity)
    assert.equal(entidades.includes('checkpoints[].kind'), false)
    assert.equal(entidades.includes('checkpoints[].extras'), false)
  })

  it('pacote v3 antigo (sem as chaves) continua importando como checkpoint comum', () => {
    const { origem, projeto } = projetoComSalvamento()
    const pacote = pelaEstrada(createProjectBundleV3(origem.exportProjectBundleData(projeto.id)))
    const { kind: _kind, extras: _extras, ...antigo } = pacote.project.checkpoints[0]!
    pacote.project.checkpoints[0] = antigo
    const destino = novoStore()
    const importado = destino.importProjectBundleData(parseProjectBundle(pacote))
    const [copia] = destino.getProject(importado.project.id).checkpoints
    assert.equal('kind' in copia!, false)
    assert.equal('extras' in copia!, false)
  })
})

describe('pacote v2: declara que não leva o salvamento', () => {
  it('omissions nomeia checkpoints[].kind e checkpoints[].extras, e o checkpoint v2 sai sem as duas chaves', () => {
    const { origem, projeto } = projetoComSalvamento()
    const v2 = createProjectBundleV2(origem.exportProjectBundleData(projeto.id))
    const entidades = (v2.omissions ?? []).map((o) => o.entity)
    assert.ok(entidades.includes('checkpoints[].kind'), 'omissions da v2 declara checkpoints[].kind')
    assert.ok(entidades.includes('checkpoints[].extras'), 'omissions da v2 declara checkpoints[].extras')
    // Cada omissão diz o porquê: o que não viaja e que só a v3 leva.
    for (const entidade of ['checkpoints[].kind', 'checkpoints[].extras']) {
      const motivo = v2.omissions!.find((o) => o.entity === entidade)!.reason
      assert.match(motivo, /salvamento de compactacao/, entidade)
      assert.match(motivo, /so viajam? na v3\b/, entidade)
    }
    assert.equal('kind' in v2.project.checkpoints[0]!, false)
    assert.equal('extras' in v2.project.checkpoints[0]!, false)
  })
})

describe('importação do salvamento', () => {
  it('snapshot direto (importProject) também leva kind e extras', () => {
    const { origem, projeto } = projetoComSalvamento()
    const destino = novoStore()
    const importado = destino.importProject(pelaEstrada(origem.getProject(projeto.id)))
    const [copia] = destino.getProject(importado.project.id).checkpoints
    assert.equal(copia!.kind, 'compactacao')
    assert.deepEqual(copia!.extras, EXTRAS_COMPLETOS)
  })

  it('kind compactacao sem extras: importa com as quatro listas vazias', () => {
    const { origem, projeto } = projetoComSalvamento()
    const detalhe = pelaEstrada(origem.getProject(projeto.id))
    delete detalhe.checkpoints[0]!.extras
    const destino = novoStore()
    const [copia] = destino.getProject(destino.importProject(detalhe).project.id).checkpoints
    assert.equal(copia!.kind, 'compactacao')
    assert.deepEqual(copia!.extras, { pedidosDoDono: [], pendencias: [], perguntasAbertas: [], arquivosMexidos: [] })
  })

  it('kind normal explícito, ou extras sem kind: é checkpoint comum, sem extras', () => {
    const { origem, projeto } = projetoComSalvamento()
    for (const kind of ['normal', undefined] as const) {
      const detalhe = pelaEstrada(origem.getProject(projeto.id))
      if (kind === undefined) delete detalhe.checkpoints[0]!.kind
      else detalhe.checkpoints[0]!.kind = kind
      const destino = novoStore()
      const [copia] = destino.getProject(destino.importProject(detalhe).project.id).checkpoints
      assert.equal('kind' in copia!, false, `kind ${String(kind)}`)
      assert.equal('extras' in copia!, false, `kind ${String(kind)}`)
      assert.equal(linhaDoCheckpoint(destino, copia!.id).kind, 'normal')
      assert.equal(linhaDoCheckpoint(destino, copia!.id).extras_json, null)
    }
  })

  it('kind desconhecido: recusa nomeando o campo', () => {
    const { origem, projeto } = projetoComSalvamento()
    const detalhe = pelaEstrada(origem.getProject(projeto.id))
    ;(detalhe.checkpoints[0] as unknown as Record<string, unknown>).kind = 'outro'
    const erro = erroDe(() => novoStore().importProject(detalhe))
    assert.equal(erro.status, 400)
    assert.equal(erro.code, 'invalid_input')
    assert.equal(erro.message, 'Campo checkpoints[0].kind inválido.')
  })

  it('extras fora do formato: recusa dizendo qual campo', () => {
    const { origem, projeto } = projetoComSalvamento()
    const tentar = (mexer: (extras: Record<string, unknown>) => void): string => {
      const detalhe = pelaEstrada(origem.getProject(projeto.id))
      mexer(detalhe.checkpoints[0]!.extras as unknown as Record<string, unknown>)
      return erroDe(() => novoStore().importProject(detalhe)).message
    }
    assert.equal(tentar((e) => (e.pendencias = ['ok', '  '])), 'Campo checkpoints[0].extras.pendencias[1] inválido.')
    assert.equal(tentar((e) => (e.pedidosDoDono = 'solto')), 'Campo checkpoints[0].extras.pedidosDoDono inválido.')
    assert.equal(
      tentar((e) => (e.arquivosMexidos = Array.from({ length: 51 }, (_, i) => `a${i}`))),
      'Campo checkpoints[0].extras.arquivosMexidos inválido.',
    )
    const detalhe = pelaEstrada(origem.getProject(projeto.id))
    ;(detalhe.checkpoints[0] as unknown as Record<string, unknown>).extras = 'solto'
    assert.equal(erroDe(() => novoStore().importProject(detalhe)).message, 'Dados de checkpoints[0].extras inválidos.')
  })

  it('o pacote recusa kind desconhecido e extras acima de 50 itens ou 2.000 caracteres', () => {
    const { origem, projeto } = projetoComSalvamento()
    const pacote = pelaEstrada(createProjectBundleV3(origem.exportProjectBundleData(projeto.id)))
    const alterar = (mexer: (cp: Record<string, unknown>) => void): unknown => {
      const copia = pelaEstrada(pacote)
      mexer(copia.project.checkpoints[0] as unknown as Record<string, unknown>)
      return copia
    }
    const recusa = (pacoteRuim: unknown): { status: number; code: string; message: string } => {
      try {
        parseProjectBundle(pacoteRuim)
      } catch (erro) {
        return erro as { status: number; code: string; message: string }
      }
      return assert.fail('esperava uma recusa do pacote')
    }
    for (const kind of ['normal', 'compactacao']) {
      const aceito = parseProjectBundle(alterar((cp) => (cp.kind = kind)))
      assert.equal(aceito.project.checkpoints[0]!.kind, kind)
    }
    assert.equal(recusa(alterar((cp) => (cp.kind = ''))).code, 'invalid_bundle')
    const kindRuim = recusa(alterar((cp) => (cp.kind = 'outro')))
    assert.equal(kindRuim.code, 'invalid_bundle')
    assert.match(kindRuim.message, /kind/)
    const muitos = recusa(alterar((cp) => ((cp.extras as Record<string, unknown>).pendencias = Array.from({ length: 51 }, () => 'x'))))
    assert.match(muitos.message, /extras\.pendencias/)
    const longo = recusa(alterar((cp) => ((cp.extras as Record<string, unknown>).perguntasAbertas = ['x'.repeat(2001)])))
    assert.match(longo.message, /extras\.perguntasAbertas/)
    // No limite, passa.
    parseProjectBundle(
      alterar((cp) => {
        ;(cp.extras as Record<string, unknown>).pendencias = Array.from({ length: 50 }, () => 'x'.repeat(2000))
      }),
    )
  })
})
