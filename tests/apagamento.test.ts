import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  contarNoRegistro,
  contarOcorrencias,
  dataDoDono,
  ensureApagamentoSchema,
  entradaDeAuditoria,
  exigirConfirmacao,
  marcaDoRegistro,
  marcaDoTrecho,
  quemApaga,
  trocaDoRegistroInteiro,
  trocaDoTrecho,
  trocarNaCarga,
  trocarNosTextos,
  validarTrecho,
  type TextosDoRegistro,
} from '../server/store/apagamento.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import { createApp } from '../server/app.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { lerDadosDaCarta } from '../server/carta/ler.ts'
import { montarCarta } from '../server/carta/montar.ts'

/**
 * O dono apaga de verdade um trecho de um registro (checkpoint) ou o registro inteiro, só pela tela.
 * Regra em server/store/apagamento.ts; store.ts e app.ts só ligam.
 */

const pastas: string[] = []
const stores: WorkspaceStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.close() } catch { /* já fechado */ }
  }
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

// 27/10/2026 02:30 UTC = 26/10/2026 23:30 em São Paulo: a data da marca é a do dono.
const AGORA = new Date('2026-10-27T02:30:00.000Z')
const MARCA_TRECHO = '[trecho apagado pelo dono em 26/10/2026]'
const MARCA_REGISTRO = '[registro apagado pelo dono em 26/10/2026]'
const SEGREDO = 'senha-do-banco-123'
const DONO = { actorType: 'anonymous' as const, actorId: 'local-operator' }

function novoStore(): WorkspaceStore {
  const pasta = mkdtempSync(path.join(tmpdir(), 'axon-apagar-'))
  pastas.push(pasta)
  const store = new WorkspaceStore(path.join(pasta, 'workspace.sqlite'), { now: () => AGORA })
  stores.push(store)
  return store
}

function erroDeDominio(fn: () => unknown, status: number, code: string, mensagem?: string): void {
  assert.throws(fn, (erro: unknown) => {
    assert.ok(erro instanceof DomainError, `esperado DomainError, veio ${String(erro)}`)
    assert.equal(erro.status, status)
    assert.equal(erro.code, code)
    if (mensagem !== undefined) assert.equal(erro.message, mensagem)
    return true
  })
}

function textos(parcial: Partial<TextosDoRegistro> = {}): TextosDoRegistro {
  return {
    summary: 'resumo',
    humanSummary: null,
    nextStep: 'passo',
    decisions: [],
    blockers: [],
    detalhes: [],
    extras: null,
    ...parcial,
  }
}

/** Projeto com um checkpoint comum (com evidência) e um salvamento de compactação, os dois com o segredo. */
function cenario() {
  const store = novoStore()
  const projeto = store.createProject({ name: 'Projeto Apagar', objective: 'Testar o apagamento' })
  const comum = store.saveCheckpoint(projeto.id, {
    expectedRevision: 0,
    idempotencyKey: 'cp-1',
    agent: 'Claude',
    summary: `Resumo com ${SEGREDO} e de novo ${SEGREDO}`,
    humanSummary: `Frase com ${SEGREDO}`,
    nextStep: `Passo com ${SEGREDO}`,
    decisions: [`Decisão ${SEGREDO}`, 'Decisão limpa'],
    blockers: [`Bloqueio ${SEGREDO}`],
    evidence: [{ command: 'npm test', outcome: 'passed', details: `Saída ${SEGREDO}` }],
  })
  const salvamento = store.saveCompactionSnapshot(projeto.id, {
    expectedRevision: 1,
    idempotencyKey: 'cp-2',
    agent: 'Claude',
    summary: 'Estado limpo',
    humanSummary: 'Frase limpa',
    nextStep: 'Passo limpo',
    decisions: [],
    pedidosDoDono: [`Pedido ${SEGREDO}`],
    pendencias: [`Pendência ${SEGREDO}`],
    perguntasAbertas: [`Pergunta ${SEGREDO}`],
    arquivosMexidos: [`arquivo-${SEGREDO}.ts`],
  })
  return { store, projeto, comum, salvamento }
}

function linhaCrua(store: WorkspaceStore, id: string): Record<string, unknown> {
  const db = new DatabaseSync((store as unknown as { dbPath: string }).dbPath)
  try {
    return { ...(db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as Record<string, unknown>) }
  } finally {
    db.close()
  }
}

function lerTabela(store: WorkspaceStore, sql: string, ...params: string[]): Array<Record<string, unknown>> {
  const db = new DatabaseSync((store as unknown as { dbPath: string }).dbPath)
  try {
    return db.prepare(sql).all(...params).map((linha) => ({ ...linha }))
  } finally {
    db.close()
  }
}

describe('apagamento: regras puras', () => {
  it('a data da marca é a de São Paulo (dd/mm/aaaa)', () => {
    assert.equal(dataDoDono(AGORA), '26/10/2026')
    assert.equal(dataDoDono(new Date('2026-01-05T15:00:00.000Z')), '05/01/2026')
    assert.equal(marcaDoTrecho(AGORA), MARCA_TRECHO)
    assert.equal(marcaDoRegistro(AGORA), MARCA_REGISTRO)
  })

  it('trecho vazio, só espaços, não texto ou longo demais é recusado com 400', () => {
    for (const valor of ['', '   ', '\n\t', undefined, null, 5]) {
      erroDeDominio(() => validarTrecho(valor), 400, 'trecho_vazio', 'Cole o trecho que você quer apagar.')
    }
    erroDeDominio(() => validarTrecho('x'.repeat(8001)), 400, 'trecho_longo', 'O trecho passa de 8000 caracteres.')
    assert.equal(validarTrecho('x'.repeat(8000)).length, 8000)
    assert.equal(validarTrecho(' com espaço '), ' com espaço ')
  })

  it('apagar o registro inteiro exige confirmar: true', () => {
    for (const valor of [undefined, false, 'true', 1, null]) {
      erroDeDominio(
        () => exigirConfirmacao(valor),
        400,
        'confirmacao_obrigatoria',
        'Para apagar o registro inteiro, confirme o pedido.',
      )
    }
    assert.doesNotThrow(() => exigirConfirmacao(true))
  })

  it('conta ocorrências exatas e sem sobreposição', () => {
    assert.equal(contarOcorrencias('abc abc', 'abc'), 2)
    assert.equal(contarOcorrencias('aaaa', 'aa'), 2)
    assert.equal(contarOcorrencias('ABC', 'abc'), 0)
    assert.equal(contarOcorrencias('', 'abc'), 0)
  })

  it('conta em todos os campos de texto do registro', () => {
    const t = textos({
      summary: 'x x',
      humanSummary: 'x',
      nextStep: 'x',
      decisions: ['x', 'y'],
      blockers: ['x'],
      detalhes: ['x'],
      extras: { pedidosDoDono: ['x'], pendencias: ['x'], perguntasAbertas: ['x'], arquivosMexidos: ['x'] },
    })
    assert.equal(contarNoRegistro(t, 'x'), 11)
    assert.equal(contarNoRegistro(textos(), 'x'), 0)
    assert.equal(contarNoRegistro(textos({ humanSummary: null }), 'null'), 0)
  })

  it('troca o trecho em todos os campos; humanSummary ausente continua ausente', () => {
    const troca = trocaDoTrecho('x', 'M')
    const t = textos({
      summary: 'ax x',
      humanSummary: 'x',
      nextStep: 'x',
      decisions: ['x', 'y'],
      blockers: ['bx'],
      detalhes: ['x', 'z'],
      extras: { pedidosDoDono: ['x'], pendencias: ['px'], perguntasAbertas: [], arquivosMexidos: ['x.ts'] },
    })
    assert.deepEqual(trocarNosTextos(t, troca), {
      summary: 'aM M',
      humanSummary: 'M',
      nextStep: 'M',
      decisions: ['M', 'y'],
      blockers: ['bM'],
      detalhes: ['M', 'z'],
      extras: { pedidosDoDono: ['M'], pendencias: ['pM'], perguntasAbertas: [], arquivosMexidos: ['M.ts'] },
    })
    assert.deepEqual(trocarNosTextos(textos(), troca), textos())
  })

  it('o registro inteiro vira a marca: listas cheias viram uma marca só, vazias ficam vazias, detalhes um por evidência', () => {
    const troca = trocaDoRegistroInteiro('R')
    const t = textos({
      summary: 'a',
      nextStep: 'b',
      decisions: ['c', 'd'],
      blockers: [],
      detalhes: ['e', 'f'],
      extras: { pedidosDoDono: ['g', 'h'], pendencias: [], perguntasAbertas: ['i'], arquivosMexidos: [] },
    })
    assert.deepEqual(trocarNosTextos(t, troca), {
      summary: 'R',
      humanSummary: 'R',
      nextStep: 'R',
      decisions: ['R'],
      blockers: [],
      detalhes: ['R', 'R'],
      extras: { pedidosDoDono: ['R'], pendencias: [], perguntasAbertas: ['R'], arquivosMexidos: [] },
    })
  })

  it('a carga canônica é recalculada sem o trecho e mantém a ordem das chaves', () => {
    const carga = JSON.stringify({
      agent: 'x-agente',
      blockers: ['bx'],
      decisions: ['dx'],
      delivery: { message: 'x fica' },
      evidence: [{ artifacts: [], command: 'x cmd', details: 'det x', outcome: 'passed' }],
      extras: { arquivosMexidos: ['ax'], pedidosDoDono: ['px'], pendencias: [], perguntasAbertas: ['qx'] },
      humanSummary: 'hx',
      kind: 'compactacao',
      nextStep: 'nx',
      summary: 'sx',
      taskId: null,
    })
    assert.equal(
      trocarNaCarga(carga, trocaDoTrecho('x', 'M')),
      JSON.stringify({
        agent: 'x-agente',
        blockers: ['bM'],
        decisions: ['dM'],
        delivery: { message: 'x fica' },
        evidence: [{ artifacts: [], command: 'x cmd', details: 'det M', outcome: 'passed' }],
        extras: { arquivosMexidos: ['aM'], pedidosDoDono: ['pM'], pendencias: [], perguntasAbertas: ['qM'] },
        humanSummary: 'hM',
        kind: 'compactacao',
        nextStep: 'nM',
        summary: 'sM',
        taskId: null,
      }),
    )
  })

  it('carga sem humanSummary nem extras não ganha essas chaves, nem no registro inteiro', () => {
    const carga = JSON.stringify({ agent: 'A', blockers: [], decisions: ['d'], evidence: [], nextStep: 'n', summary: 's', taskId: null })
    assert.equal(
      trocarNaCarga(carga, trocaDoRegistroInteiro('R')),
      JSON.stringify({ agent: 'A', blockers: [], decisions: ['R'], evidence: [], nextStep: 'R', summary: 'R', taskId: null }),
    )
  })

  it('só o dono apaga: agente, colaborador ou ninguém recebem 403', () => {
    const mensagem = 'Só o dono pode apagar registros, e só pela tela.'
    erroDeDominio(() => quemApaga(undefined), 403, 'so_o_dono', mensagem)
    erroDeDominio(() => quemApaga({ actorType: 'agent', actorId: 'Astra', role: 'owner', projectId: null }), 403, 'so_o_dono', mensagem)
    erroDeDominio(() => quemApaga({ actorType: 'user', actorId: 'u', role: 'collaborator', projectId: null }), 403, 'so_o_dono', mensagem)
    assert.deepEqual(quemApaga({ actorType: 'user', actorId: 'conta-1', role: 'owner', projectId: null }), {
      actorType: 'user',
      actorId: 'conta-1',
    })
  })

  it('a entrada de auditoria não leva o texto apagado', () => {
    assert.deepEqual(
      entradaDeAuditoria({ checkpointId: 'c1', modo: 'trecho', ocorrencias: 3, marca: 'M' }, 'p1', DONO),
      {
        actorType: 'anonymous',
        actorId: 'local-operator',
        action: 'checkpoint.apagar_trecho',
        resourceType: 'checkpoint',
        resourceId: 'c1',
        projectId: 'p1',
        details: { modo: 'trecho', ocorrencias: 3 },
      },
    )
    assert.equal(
      entradaDeAuditoria({ checkpointId: 'c1', modo: 'inteiro', ocorrencias: 1, marca: 'M' }, 'p1', DONO).action,
      'checkpoint.apagar_inteiro',
    )
  })
})

describe('apagamento: banco e gatilhos', () => {
  function bancoComCheckpoint(): DatabaseSync {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE checkpoints (id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, agent TEXT, summary TEXT,
        revision INTEGER, created_at TEXT, idempotency_key TEXT, kind TEXT);
      CREATE TABLE evidence_records (id TEXT PRIMARY KEY, project_id TEXT, checkpoint_id TEXT, position INTEGER,
        command TEXT, outcome TEXT, details TEXT, reported_by TEXT, created_at TEXT);
      CREATE TRIGGER trg_checkpoints_immutable BEFORE UPDATE ON checkpoints
      BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;
      CREATE TRIGGER trg_evidence_records_immutable BEFORE UPDATE ON evidence_records
      BEGIN SELECT RAISE(ABORT, 'evidence records are immutable'); END;
      INSERT INTO checkpoints VALUES ('c1', 'p1', NULL, 'A', 's', 1, 't', 'k', 'normal');
      INSERT INTO evidence_records VALUES ('e1', 'p1', 'c1', 0, 'cmd', 'passed', 'd', 'A', 't');
    `)
    ensureApagamentoSchema(db)
    return db
  }

  it('sem licença, qualquer UPDATE de checkpoint ou evidência continua abortando', () => {
    const db = bancoComCheckpoint()
    assert.throws(() => db.prepare("UPDATE checkpoints SET summary = 'x' WHERE id = 'c1'").run(), /checkpoints are immutable/)
    assert.throws(() => db.prepare("UPDATE evidence_records SET details = 'x' WHERE id = 'e1'").run(), /evidence records are immutable/)
    db.close()
  })

  it('com licença, só o texto muda; id, projeto, tarefa, agente, revisão, data, chave e tipo continuam travados', () => {
    const db = bancoComCheckpoint()
    db.exec("INSERT INTO licencas_de_apagamento (checkpoint_id) VALUES ('c1')")
    db.prepare("UPDATE checkpoints SET summary = 'novo' WHERE id = 'c1'").run()
    db.prepare("UPDATE evidence_records SET details = 'novo' WHERE id = 'e1'").run()
    for (const mudanca of ["id = 'c2'", "project_id = 'p2'", "task_id = 't'", "agent = 'B'", 'revision = 2', "created_at = 'u'", "idempotency_key = 'k2'", "kind = 'compactacao'"]) {
      assert.throws(() => db.prepare(`UPDATE checkpoints SET ${mudanca} WHERE id = 'c1'`).run(), /checkpoints are immutable/, mudanca)
    }
    for (const mudanca of ["id = 'e2'", "project_id = 'p2'", "checkpoint_id = 'c2'", 'position = 1', "command = 'x'", "outcome = 'failed'", "reported_by = 'B'", "created_at = 'u'"]) {
      assert.throws(() => db.prepare(`UPDATE evidence_records SET ${mudanca} WHERE id = 'e1'`).run(), /evidence records are immutable/, mudanca)
    }
    assert.equal((db.prepare("SELECT summary FROM checkpoints WHERE id = 'c1'").get() as { summary: string }).summary, 'novo')
    db.close()
  })

  it('a licença de um registro não libera outro', () => {
    const db = bancoComCheckpoint()
    db.exec("INSERT INTO checkpoints VALUES ('c2', 'p1', NULL, 'A', 's', 2, 't', 'k2', 'normal')")
    db.exec("INSERT INTO licencas_de_apagamento (checkpoint_id) VALUES ('c1')")
    assert.throws(() => db.prepare("UPDATE checkpoints SET summary = 'x' WHERE id = 'c2'").run(), /checkpoints are immutable/)
    db.close()
  })

  it('abrir de novo não mexe no esquema (sem escrita a cada abertura)', () => {
    const db = bancoComCheckpoint()
    const antes = (db.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version
    ensureApagamentoSchema(db)
    const depois = (db.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version
    assert.equal(depois, antes)
    db.close()
  })

  it('se a troca dos gatilhos falha, nada fica pela metade', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE checkpoints (id TEXT PRIMARY KEY);
      CREATE TRIGGER trg_checkpoints_immutable BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;`)
    // Sem a tabela evidence_records, o segundo gatilho não pode ser criado.
    assert.throws(() => ensureApagamentoSchema(db))
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'trg_checkpoints_immutable'").get() as { sql: string }).sql
    assert.doesNotMatch(sql, /licencas_de_apagamento/)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'licencas_de_apagamento'").get(), undefined)
    db.close()
  })
})

describe('apagamento: pelo store', () => {
  it('conta as ocorrências do trecho em todos os campos daquele registro', () => {
    const { store, projeto, comum, salvamento } = cenario()
    assert.deepEqual(store.contarTrechoNoRegistro(projeto.id, comum.id, { trecho: SEGREDO }), { ocorrencias: 7 })
    assert.deepEqual(store.contarTrechoNoRegistro(projeto.id, salvamento.id, { trecho: SEGREDO }), { ocorrencias: 4 })
    assert.deepEqual(store.contarTrechoNoRegistro(projeto.id, comum.id, { trecho: 'nada disso' }), { ocorrencias: 0 })
    erroDeDominio(() => store.contarTrechoNoRegistro(projeto.id, comum.id, { trecho: '  ' }), 400, 'trecho_vazio')
    erroDeDominio(() => store.contarTrechoNoRegistro(projeto.id, comum.id, null), 400, 'invalid_input')
  })

  it('apaga o trecho de todos os campos, da carga canônica, das evidências e da finalização', () => {
    const { store, projeto, comum } = cenario()
    const resultado = store.apagarTrechoDoRegistro(projeto.id, comum.id, { trecho: SEGREDO }, DONO)
    assert.deepEqual(resultado, { checkpointId: comum.id, modo: 'trecho', ocorrencias: 7, marca: MARCA_TRECHO })
    const cp = store.getProject(projeto.id).checkpoints.find((c) => c.id === comum.id)!
    assert.equal(cp.summary, `Resumo com ${MARCA_TRECHO} e de novo ${MARCA_TRECHO}`)
    assert.equal(cp.humanSummary, `Frase com ${MARCA_TRECHO}`)
    assert.equal(cp.nextStep, `Passo com ${MARCA_TRECHO}`)
    assert.deepEqual(cp.decisions, [`Decisão ${MARCA_TRECHO}`, 'Decisão limpa'])
    assert.deepEqual(cp.blockers, [`Bloqueio ${MARCA_TRECHO}`])
    assert.equal(cp.evidence[0]!.details, `Saída ${MARCA_TRECHO}`)
    assert.equal(cp.evidence[0]!.command, 'npm test')
    assert.equal(cp.agent, 'Claude')
    assert.equal(cp.revision, 1)
    assert.equal(cp.createdAt, comum.createdAt)
    const crua = linhaCrua(store, comum.id)
    assert.doesNotMatch(JSON.stringify(crua), new RegExp(SEGREDO))
    assert.match(String(crua.payload_canonical), /trecho apagado pelo dono/)
    const evidencias = lerTabela(store, 'SELECT details FROM evidence_records WHERE checkpoint_id = ?', comum.id)
    assert.deepEqual(evidencias, [{ details: `Saída ${MARCA_TRECHO}` }])
    assert.deepEqual(lerTabela(store, 'SELECT * FROM licencas_de_apagamento'), [])
  })

  it('apaga o trecho dos extras do salvamento de compactação', () => {
    const { store, projeto, salvamento } = cenario()
    store.apagarTrechoDoRegistro(projeto.id, salvamento.id, { trecho: SEGREDO }, DONO)
    const cp = store.getProject(projeto.id).checkpoints.find((c) => c.id === salvamento.id)!
    assert.deepEqual(cp.extras, {
      pedidosDoDono: [`Pedido ${MARCA_TRECHO}`],
      pendencias: [`Pendência ${MARCA_TRECHO}`],
      perguntasAbertas: [`Pergunta ${MARCA_TRECHO}`],
      arquivosMexidos: [`arquivo-${MARCA_TRECHO}.ts`],
    })
    assert.equal(cp.kind, 'compactacao')
    assert.doesNotMatch(JSON.stringify(linhaCrua(store, salvamento.id)), new RegExp(SEGREDO))
  })

  it('trecho não encontrado: 404 com frase em português, e nada muda', () => {
    const { store, projeto, comum } = cenario()
    const antes = linhaCrua(store, comum.id)
    erroDeDominio(
      () => store.apagarTrechoDoRegistro(projeto.id, comum.id, { trecho: 'não existe aqui' }, DONO),
      404,
      'trecho_nao_encontrado',
      'Esse trecho não aparece neste registro. Confira se colou o texto exatamente igual.',
    )
    assert.deepEqual(linhaCrua(store, comum.id), antes)
    assert.deepEqual(store.listAuditLogs({ projectId: projeto.id }).filter((l) => l.action.startsWith('checkpoint.apagar')), [])
  })

  it('registro de outro projeto ou inexistente: 404', () => {
    const { store, comum } = cenario()
    const outro = store.createProject({ name: 'Outro', objective: 'x' })
    erroDeDominio(
      () => store.apagarTrechoDoRegistro(outro.id, comum.id, { trecho: SEGREDO }, DONO),
      404,
      'not_found',
      'Registro não encontrado neste projeto.',
    )
    erroDeDominio(() => store.contarTrechoNoRegistro(outro.id, comum.id, { trecho: SEGREDO }), 404, 'not_found')
    erroDeDominio(() => store.apagarRegistroInteiro(outro.id, comum.id, { confirmar: true }, DONO), 404, 'not_found')
  })

  it('registra auditoria sem o texto apagado', () => {
    const { store, projeto, comum } = cenario()
    store.apagarTrechoDoRegistro(projeto.id, comum.id, { trecho: SEGREDO }, DONO)
    const logs = store.listAuditLogs({ projectId: projeto.id, action: 'checkpoint.apagar_trecho' })
    assert.equal(logs.length, 1)
    assert.equal(logs[0]!.actorId, 'local-operator')
    assert.equal(logs[0]!.resourceId, comum.id)
    assert.deepEqual(logs[0]!.details, { modo: 'trecho', ocorrencias: 7 })
    assert.doesNotMatch(JSON.stringify(logs), new RegExp(SEGREDO))
  })

  it('a busca na memória deixa de achar o trecho apagado', () => {
    const { store, projeto, comum } = cenario()
    assert.ok(store.searchMemory(projeto.id, { query: SEGREDO }).some((r) => r.id === comum.id))
    store.apagarTrechoDoRegistro(projeto.id, comum.id, { trecho: SEGREDO }, DONO)
    assert.deepEqual(store.searchMemory(projeto.id, { query: SEGREDO }).filter((r) => r.id === comum.id), [])
    assert.ok(store.searchMemory(projeto.id, { query: 'apagado pelo dono' }).some((r) => r.id === comum.id))
  })

  it('apagar o registro inteiro exige confirmação e deixa só id, data, agente, revisão e tipo', () => {
    const { store, projeto, comum, salvamento } = cenario()
    erroDeDominio(() => store.apagarRegistroInteiro(projeto.id, comum.id, {}, DONO), 400, 'confirmacao_obrigatoria')
    const resultado = store.apagarRegistroInteiro(projeto.id, salvamento.id, { confirmar: true }, DONO)
    assert.deepEqual(resultado, { checkpointId: salvamento.id, modo: 'inteiro', ocorrencias: 7, marca: MARCA_REGISTRO })
    const cp = store.getProject(projeto.id).checkpoints.find((c) => c.id === salvamento.id)!
    assert.deepEqual(
      { ...cp },
      {
        id: salvamento.id,
        projectId: projeto.id,
        taskId: null,
        agent: 'Claude',
        summary: MARCA_REGISTRO,
        humanSummary: MARCA_REGISTRO,
        nextStep: MARCA_REGISTRO,
        blockers: [],
        decisions: [],
        evidence: [],
        revision: 2,
        createdAt: salvamento.createdAt,
        kind: 'compactacao',
        extras: { pedidosDoDono: [MARCA_REGISTRO], pendencias: [MARCA_REGISTRO], perguntasAbertas: [MARCA_REGISTRO], arquivosMexidos: [MARCA_REGISTRO] },
      },
    )
    assert.doesNotMatch(JSON.stringify(linhaCrua(store, salvamento.id)), new RegExp(SEGREDO))
    const logs = store.listAuditLogs({ projectId: projeto.id, action: 'checkpoint.apagar_inteiro' })
    assert.deepEqual(logs.map((l) => l.details), [{ modo: 'inteiro', ocorrencias: 7 }])
  })

  it('registro inteiro sem frase para o dono ganha a marca também na frase', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'P', objective: 'o' })
    const cp = store.saveCheckpoint(projeto.id, { expectedRevision: 0, idempotencyKey: 'k', agent: 'A', summary: 's', nextStep: 'n' })
    const r = store.apagarRegistroInteiro(projeto.id, cp.id, { confirmar: true }, DONO)
    assert.equal(r.ocorrencias, 3)
    assert.equal(store.getProject(projeto.id).checkpoints[0]!.humanSummary, MARCA_REGISTRO)
  })

  it('apaga também a carga da finalização de trabalho que gravou o registro', () => {
    const store = novoStore()
    const projeto = store.createProject({ name: 'P', objective: 'o' })
    const fim = store.finalizeWork(projeto.id, {
      expectedRevision: 0,
      idempotencyKey: 'fim-1',
      agent: 'Claude',
      summary: `Feito ${SEGREDO}`,
      nextStep: 'Seguir',
      evidence: [{ command: 'npm test', outcome: 'passed', details: `log ${SEGREDO}` }],
      taskTransition: { kind: 'keep_claimed' },
    })
    store.apagarTrechoDoRegistro(projeto.id, fim.checkpoint.id, { trecho: SEGREDO }, DONO)
    const cargas = lerTabela(store, 'SELECT payload_canonical FROM finalize_work WHERE checkpoint_id = ?', fim.checkpoint.id)
    assert.equal(cargas.length, 1)
    assert.doesNotMatch(String(cargas[0]!.payload_canonical), new RegExp(SEGREDO))
    assert.match(String(cargas[0]!.payload_canonical), /Feito \[trecho apagado/)
  })

  it('a carta "Onde paramos", a retomada e a exportação passam a mostrar a marca', () => {
    const { store, projeto, comum, salvamento } = cenario()
    store.apagarTrechoDoRegistro(projeto.id, comum.id, { trecho: SEGREDO }, DONO)
    store.apagarRegistroInteiro(projeto.id, salvamento.id, { confirmar: true }, DONO)
    const carta = montarCarta(lerDadosDaCarta(store, projeto.id), AGORA)
    assert.equal(carta.salvamentos[0]!.resumo, MARCA_REGISTRO)
    assert.deepEqual(carta.salvamentos[0]!.pedidosDoDono, [MARCA_REGISTRO])
    const retomada = store.getResumeBrief(projeto.id, 'Claude')
    assert.doesNotMatch(JSON.stringify(retomada), new RegExp(SEGREDO))
    assert.match(JSON.stringify(retomada), /registro apagado pelo dono/)
    const exportado = JSON.stringify(store.exportProjectBundleData(projeto.id))
    assert.doesNotMatch(exportado, new RegExp(SEGREDO))
    assert.match(exportado, /trecho apagado pelo dono/)
  })
})

describe('apagamento: pela tela (HTTP) e, às IAs, só pelas duas ferramentas redact_*', () => {
  async function servidor(t: { after: (fn: () => unknown) => void }, store: WorkspaceStore) {
    const server = createServer(createApp(store))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('endereço inválido')
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const host = `127.0.0.1:${address.port}`
    return (caminho: string, corpo: unknown, extras: Record<string, string> = {}) =>
      fetch(`http://${host}${caminho}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local', Host: host, Origin: `http://${host}`, ...extras },
        body: JSON.stringify(corpo),
      })
  }

  it('conta, apaga trecho e apaga registro inteiro pelas rotas', async (t) => {
    const { store, projeto, comum, salvamento } = cenario()
    const post = await servidor(t, store)
    const base = `/api/projects/${projeto.id}/checkpoints`
    const contar = await post(`${base}/${comum.id}/apagar-trecho/contar`, { trecho: SEGREDO })
    assert.equal(contar.status, 200)
    assert.deepEqual(await contar.json(), { ocorrencias: 7 })
    const vazio = await post(`${base}/${comum.id}/apagar-trecho`, { trecho: '   ' })
    assert.equal(vazio.status, 400)
    assert.equal((await vazio.json()).error.code, 'trecho_vazio')
    const ausente = await post(`${base}/${comum.id}/apagar-trecho`, { trecho: 'inexistente' })
    assert.equal(ausente.status, 404)
    assert.match((await ausente.json()).error.message, /não aparece neste registro/)
    const apagou = await post(`${base}/${comum.id}/apagar-trecho`, { trecho: SEGREDO })
    assert.equal(apagou.status, 200)
    assert.equal((await apagou.json()).ocorrencias, 7)
    const semConfirmar = await post(`${base}/${salvamento.id}/apagar-registro`, {})
    assert.equal(semConfirmar.status, 400)
    const inteiro = await post(`${base}/${salvamento.id}/apagar-registro`, { confirmar: true })
    assert.equal(inteiro.status, 200)
    assert.equal((await inteiro.json()).modo, 'inteiro')
  })

  it('token de agente não apaga (403) e nada muda', async (t) => {
    const { store, projeto, comum } = cenario()
    const post = await servidor(t, store)
    const { token } = store.createAuthToken({ name: 'IA', tokenType: 'agent', role: 'owner', agentName: 'Astra', expiresInHours: 1 })
    const antes = linhaCrua(store, comum.id)
    for (const rota of ['apagar-trecho', 'apagar-trecho/contar', 'apagar-registro']) {
      const resposta = await post(
        `/api/projects/${projeto.id}/checkpoints/${comum.id}/${rota}`,
        { trecho: SEGREDO, confirmar: true },
        { Authorization: `Bearer ${token}` },
      )
      assert.equal(resposta.status, 403, rota)
      assert.equal((await resposta.json()).error.code, 'so_o_dono')
    }
    assert.deepEqual(linhaCrua(store, comum.id), antes)
  })

  it('só as duas ferramentas redact_* apagam registro pelo MCP (a pedido do dono)', async () => {
    const store = novoStore()
    const server = createMcpServer(store)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'teste', version: '1.0.0' })
    await client.connect(clientTransport)
    const { tools } = await client.listTools()
    const suspeitas = tools.map((tool) => tool.name).filter((nome) => /apagar|erase|redact|scrub|delete_checkpoint|checkpoint.*(delete|remove)/i.test(nome))
    assert.deepEqual(suspeitas.sort(), ['redact_checkpoint', 'redact_checkpoint_excerpt'])
    await client.close()
  })
})
