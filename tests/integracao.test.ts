import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'
import {
  DETALHE_MAXIMO,
  ERRO_SEM_DETALHE,
  apagarEventosDoProjeto,
  ensureIntegracaoSchema,
  registrarEvento,
  ultimoEvento,
} from '../server/store/integracao.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'

/**
 * Registro de saúde dos ganchos do Claude Code (spec 7.2 "o erro vai para um registro da Axon que a
 * tela mostra" e 7.5 "linha de saúde da conexão"). A tabela é `integration_events`.
 */

const stores: WorkspaceStore[] = []
const bancos: DatabaseSync[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const db of bancos.splice(0)) db.close()
})

function novaAxon(): { store: WorkspaceStore; projectId: string } {
  let instante = Date.parse('2026-10-25T10:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => new Date((instante += 60_000)) })
  stores.push(store)
  const projectId = store.createProject({ name: 'Alfa', objective: 'Vender cursos' }).id
  return { store, projectId }
}

/** Banco cru, só com `projects` e a tabela nova: testa o módulo sem o store. */
function bancoCru(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  bancos.push(db)
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)')
  db.exec("INSERT INTO projects (id) VALUES ('p1'), ('p2')")
  ensureIntegracaoSchema(db)
  return db
}

function linhas(db: DatabaseSync): Array<Record<string, unknown>> {
  return db
    .prepare('SELECT id, project_id, kind, ok, detail, created_at FROM integration_events ORDER BY rowid')
    .all()
    .map((linha) => ({ ...linha }))
}

function recusa(fn: () => unknown, campo: string): void {
  assert.throws(fn, (erro: unknown) => {
    assert.ok(erro instanceof DomainError, `esperado DomainError, recebido ${String(erro)}`)
    assert.equal(erro.status, 400)
    assert.equal(erro.code, 'invalid_input')
    assert.equal(erro.message, `Campo ${campo} inválido no evento de integração.`)
    return true
  })
}

describe('integracao: módulo', () => {
  it('cria a tabela com as colunas do contrato e pode rodar duas vezes', () => {
    const db = bancoCru()
    ensureIntegracaoSchema(db)
    const colunas = (db.prepare('PRAGMA table_info(integration_events)').all() as Array<{ name: string; notnull: number; pk: number }>).map(
      (c) => [c.name, c.notnull, c.pk],
    )
    assert.deepEqual(colunas, [
      ['id', 0, 1],
      ['project_id', 1, 0],
      ['kind', 1, 0],
      ['ok', 1, 0],
      ['detail', 0, 0],
      ['created_at', 1, 0],
    ])
  })

  it('grava o evento como veio, com id e hora', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'compactar', ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z', 'e1')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'banco ocupado' }, '2026-10-25T11:00:00.000Z', 'e2')
    assert.deepEqual(linhas(db), [
      { id: 'e1', project_id: 'p1', kind: 'compactar', ok: 1, detail: null, created_at: '2026-10-25T10:00:00.000Z' },
      { id: 'e2', project_id: 'p1', kind: 'fechar', ok: 0, detail: 'banco ocupado', created_at: '2026-10-25T11:00:00.000Z' },
    ])
  })

  it('sem id informado, gera um UUID diferente a cada evento', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z')
    const ids = linhas(db).map((l) => l.id as string)
    assert.equal(ids.length, 2)
    assert.notEqual(ids[0], ids[1])
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('aceita os quatro tipos', () => {
    const db = bancoCru()
    for (const tipo of ['abrir', 'compactar', 'fechar', 'recuperar'] as const) {
      registrarEvento(db, 'p1', { tipo, ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z')
    }
    assert.deepEqual(linhas(db).map((l) => l.kind), ['abrir', 'compactar', 'fechar', 'recuperar'])
  })

  it('detalhe longo é cortado no máximo; o tamanho exato do máximo passa inteiro', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'x'.repeat(DETALHE_MAXIMO + 50) }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'y'.repeat(DETALHE_MAXIMO) }, '2026-10-25T10:00:00.000Z')
    const detalhes = linhas(db).map((l) => l.detail as string)
    assert.equal(DETALHE_MAXIMO, 2000)
    assert.equal(detalhes[0], 'x'.repeat(DETALHE_MAXIMO))
    assert.equal(detalhes[1], 'y'.repeat(DETALHE_MAXIMO))
  })

  it('recusa tipo desconhecido, ok que não é booleano e detalhe que não é texto', () => {
    const db = bancoCru()
    const ts = '2026-10-25T10:00:00.000Z'
    recusa(() => registrarEvento(db, 'p1', { tipo: 'outro' as 'abrir', ok: true, detalhe: null }, ts), 'tipo')
    recusa(() => registrarEvento(db, 'p1', { tipo: 'abrir', ok: 1 as unknown as boolean, detalhe: null }, ts), 'ok')
    recusa(() => registrarEvento(db, 'p1', { tipo: 'abrir', ok: true, detalhe: 3 as unknown as string }, ts), 'detalhe')
    recusa(() => registrarEvento(db, 'p1', null as unknown as { tipo: 'abrir'; ok: boolean; detalhe: null }, ts), 'evento')
    recusa(() => registrarEvento(db, 'p1', 'abrir' as unknown as { tipo: 'abrir'; ok: boolean; detalhe: null }, ts), 'evento')
    recusa(() => registrarEvento(db, 'p1', { tipo: 7 as unknown as 'abrir', ok: true, detalhe: null }, ts), 'tipo')
    assert.equal(linhas(db).length, 0)
  })

  it('sem evento: tudo null', () => {
    assert.deepEqual(ultimoEvento(bancoCru(), 'p1'), { ultimoRegistroAutomatico: null, ultimoErro: null })
  })

  it('último registro automático é a hora do sucesso mais novo, de qualquer tipo', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'compactar', ok: true, detalhe: null }, '2026-10-25T12:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p2', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-26T10:00:00.000Z')
    assert.deepEqual(ultimoEvento(db, 'p1'), { ultimoRegistroAutomatico: '2026-10-25T12:00:00.000Z', ultimoErro: null })
  })

  it('erro de gravação aparece; sucesso do mesmo tipo depois dele o supera', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'compactar', ok: false, detalhe: 'banco ocupado' }, '2026-10-25T11:00:00.000Z')
    assert.deepEqual(ultimoEvento(db, 'p1'), {
      ultimoRegistroAutomatico: '2026-10-25T10:00:00.000Z',
      ultimoErro: 'banco ocupado',
    })
    registrarEvento(db, 'p1', { tipo: 'compactar', ok: true, detalhe: null }, '2026-10-25T12:00:00.000Z')
    assert.deepEqual(ultimoEvento(db, 'p1'), { ultimoRegistroAutomatico: '2026-10-25T12:00:00.000Z', ultimoErro: null })
  })

  it('abertura bem-sucedida não apaga da tela uma falha de gravação', () => {
    const db = bancoCru()
    for (const [i, tipo] of (['compactar', 'fechar', 'recuperar'] as const).entries()) {
      registrarEvento(db, 'p1', { tipo, ok: false, detalhe: `falhou ${tipo}` }, `2026-10-25T1${i}:00:00.000Z`)
      registrarEvento(db, 'p1', { tipo: 'abrir', ok: true, detalhe: null }, `2026-10-25T1${i}:30:00.000Z`)
      assert.deepEqual(ultimoEvento(db, 'p1'), {
        ultimoRegistroAutomatico: `2026-10-25T1${i}:30:00.000Z`,
        ultimoErro: `falhou ${tipo}`,
      })
    }
  })

  it('fechar e recuperar gravam o mesmo rascunho: o sucesso de um supera a falha do outro', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'fechar falhou' }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'recuperar', ok: true, detalhe: null }, '2026-10-25T11:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, null)
    registrarEvento(db, 'p1', { tipo: 'recuperar', ok: false, detalhe: 'recuperar falhou' }, '2026-10-25T12:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'recuperar falhou')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: true, detalhe: null }, '2026-10-25T13:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, null)
  })

  it('sucesso de outro tipo de gravação não supera a falha', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'compactar', ok: false, detalhe: 'compactar falhou' }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: true, detalhe: null }, '2026-10-25T11:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'recuperar', ok: true, detalhe: null }, '2026-10-25T12:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'compactar falhou')

    const outro = bancoCru()
    registrarEvento(outro, 'p1', { tipo: 'fechar', ok: false, detalhe: 'fechar falhou' }, '2026-10-25T10:00:00.000Z')
    registrarEvento(outro, 'p1', { tipo: 'compactar', ok: true, detalhe: null }, '2026-10-25T11:00:00.000Z')
    assert.equal(ultimoEvento(outro, 'p1').ultimoErro, 'fechar falhou')
  })

  it('erro mais novo superado e erro mais velho de outro tipo ainda de pé: aparece o mais velho', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'compactar', ok: false, detalhe: 'compactar falhou' }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'fechar falhou' }, '2026-10-25T11:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'fechar falhou')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: true, detalhe: null }, '2026-10-25T12:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'compactar falhou')
  })

  it('falha ao abrir aparece até a próxima abertura bem-sucedida, que não limpa gravação', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'abrir', ok: false, detalhe: 'abrir falhou' }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: true, detalhe: null }, '2026-10-25T11:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'abrir falhou')
    registrarEvento(db, 'p1', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-25T12:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, null)
  })

  it('o sucesso e o erro de outro projeto não contam', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'p1 falhou' }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p2', { tipo: 'fechar', ok: true, detalhe: null }, '2026-10-25T11:00:00.000Z')
    registrarEvento(db, 'p2', { tipo: 'compactar', ok: false, detalhe: 'p2 falhou' }, '2026-10-25T12:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'p1 falhou')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: true, detalhe: null }, '2026-10-25T13:00:00.000Z')
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, null)
  })

  it('sucesso com hora anterior à do erro não o supera, mesmo gravado depois', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'erro das 12h' }, '2026-10-25T12:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: true, detalhe: null }, '2026-10-25T11:00:00.000Z')
    assert.deepEqual(ultimoEvento(db, 'p1'), { ultimoRegistroAutomatico: '2026-10-25T11:00:00.000Z', ultimoErro: 'erro das 12h' })
  })

  it('erro e sucesso do mesmo tipo na mesma hora: vale o que foi gravado por último', () => {
    const db = bancoCru()
    const ts = '2026-10-25T10:00:00.000Z'
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: true, detalhe: null }, ts)
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'depois' }, ts)
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'depois')
    registrarEvento(db, 'p1', { tipo: 'compactar', ok: false, detalhe: 'mesma hora, gravado depois' }, ts)
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'mesma hora, gravado depois')
    registrarEvento(db, 'p1', { tipo: 'compactar', ok: true, detalhe: null }, ts)
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, 'depois')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: true, detalhe: null }, ts)
    assert.equal(ultimoEvento(db, 'p1').ultimoErro, null)
  })

  it('só erros: o mais novo aparece; erro sem detalhe tem frase própria', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: 'velho' }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p1', { tipo: 'fechar', ok: false, detalhe: null }, '2026-10-25T11:00:00.000Z')
    assert.deepEqual(ultimoEvento(db, 'p1'), { ultimoRegistroAutomatico: null, ultimoErro: ERRO_SEM_DETALHE })
    assert.equal(ERRO_SEM_DETALHE, 'O gancho do Claude Code falhou sem deixar detalhe.')
  })

  it('apagar eventos do projeto não toca os de outro projeto', () => {
    const db = bancoCru()
    registrarEvento(db, 'p1', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z')
    registrarEvento(db, 'p2', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z')
    apagarEventosDoProjeto(db, 'p1')
    assert.deepEqual(linhas(db).map((l) => l.project_id), ['p2'])
  })

  it('a tabela exige projeto existente', () => {
    const db = bancoCru()
    db.exec('PRAGMA foreign_keys = ON')
    assert.throws(() => registrarEvento(db, 'nao-existe', { tipo: 'abrir', ok: true, detalhe: null }, '2026-10-25T10:00:00.000Z'), /FOREIGN KEY/)
  })
})

describe('integracao: ligação no store', () => {
  it('registra e lê pelo store, com a hora do relógio do store', () => {
    const { store, projectId } = novaAxon()
    assert.deepEqual(store.ultimoEventoDeIntegracao(projectId), { ultimoRegistroAutomatico: null, ultimoErro: null })
    store.registrarEventoDeIntegracao(projectId, { tipo: 'compactar', ok: true, detalhe: null })
    store.registrarEventoDeIntegracao(projectId, { tipo: 'fechar', ok: false, detalhe: 'falhou' })
    assert.deepEqual(store.ultimoEventoDeIntegracao(projectId), {
      ultimoRegistroAutomatico: '2026-10-25T10:02:00.000Z',
      ultimoErro: 'falhou',
    })
  })

  it('projeto inexistente ou id inválido: erro do store, nada gravado', () => {
    const { store } = novaAxon()
    assert.throws(
      () => store.registrarEventoDeIntegracao('00000000-0000-4000-8000-000000000000', { tipo: 'abrir', ok: true, detalhe: null }),
      (erro: unknown) => erro instanceof DomainError && erro.status === 404,
    )
    assert.throws(
      () => store.ultimoEventoDeIntegracao('00000000-0000-4000-8000-000000000000'),
      (erro: unknown) => erro instanceof DomainError && erro.status === 404,
    )
    assert.throws(
      () => store.registrarEventoDeIntegracao('x', { tipo: 'abrir', ok: true, detalhe: null }),
      (erro: unknown) => erro instanceof DomainError && erro.status === 400,
    )
    assert.throws(() => store.ultimoEventoDeIntegracao('x'), (erro: unknown) => erro instanceof DomainError && erro.status === 400)
  })

  it('apagar o projeto apaga os eventos dele (filhos antes do pai)', () => {
    const { store, projectId } = novaAxon()
    const outro = store.createProject({ name: 'Outro', objective: 'Ficar' }).id
    store.registrarEventoDeIntegracao(projectId, { tipo: 'abrir', ok: true, detalhe: null })
    store.registrarEventoDeIntegracao(outro, { tipo: 'abrir', ok: true, detalhe: null })
    store.deleteProject(projectId, 'Alfa')
    assert.notEqual(store.ultimoEventoDeIntegracao(outro).ultimoRegistroAutomatico, null)
  })

  it('espera de trava configurável no store (o gancho usa uma curta)', () => {
    const store = new WorkspaceStore(':memory:', { busyTimeoutMs: 120 })
    stores.push(store)
    const valor = (store as unknown as { db: DatabaseSync }).db.prepare('PRAGMA busy_timeout').get() as Record<string, number>
    assert.equal(Object.values(valor)[0], 120)
  })
})
