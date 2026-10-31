import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { LICAO_MOTIVO_MAXIMO, LICAO_TEXTO_MAXIMO, type Licao } from '../shared/licoes.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { INSTRUCOES_DO_SERVIDOR } from '../server/mcp-instrucoes.ts'
import {
  apagarLicoesDoProjeto,
  aposentarLicao,
  ensureLicoesSchema,
  escopoDaLicao,
  listarLicoes,
  registrarLicao,
} from '../server/store/licoes.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'

/**
 * Lições que o Claude não repete (D4 do lote 2). Tabela `licoes`: `project_id` NULL = vale para todos
 * os projetos. Texto igual (sem diferenciar maiúsculas, espaços nem forma do acento) no mesmo escopo
 * não duplica; aposentar guarda o motivo e nunca apaga.
 */

const stores: WorkspaceStore[] = []
const bancos: DatabaseSync[] = []
const pastas: string[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const db of bancos.splice(0)) db.close()
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const INEXISTENTE = '99999999-9999-4999-8999-999999999999'
const T1 = '2026-10-25T10:00:00.000Z'
const T2 = '2026-10-25T11:00:00.000Z'
const T3 = '2026-10-25T12:00:00.000Z'

/** Banco cru, só com `projects` e a tabela nova: testa o módulo sem o store. */
function bancoCru(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  bancos.push(db)
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)')
  db.exec(`INSERT INTO projects (id) VALUES ('${P1}'), ('${P2}')`)
  ensureLicoesSchema(db)
  return db
}

function linhas(db: DatabaseSync): Array<Record<string, unknown>> {
  return db
    .prepare('SELECT id, project_id, texto, origem, criada_em, aposentada_em, motivo_aposentadoria FROM licoes ORDER BY rowid')
    .all()
    .map((linha) => ({ ...linha }))
}

function recusa(fn: () => unknown, status: number, code: string, message?: string): void {
  assert.throws(fn, (erro: unknown) => {
    assert.ok(erro instanceof DomainError, `esperado DomainError, recebido ${String(erro)}`)
    assert.equal(erro.status, status)
    assert.equal(erro.code, code)
    if (message !== undefined) assert.equal(erro.message, message)
    return true
  })
}

function novaAxon(): { store: WorkspaceStore; projectId: string; outroId: string } {
  let instante = Date.parse('2026-10-25T10:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => new Date((instante += 60_000)) })
  stores.push(store)
  const projectId = store.createProject({ name: 'Alfa', objective: 'Vender cursos' }).id
  const outroId = store.createProject({ name: 'Axon', objective: 'Correio de continuidade' }).id
  return { store, projectId, outroId }
}

describe('registrarLicao (módulo)', () => {
  it('guarda a lição do projeto e devolve todos os campos', () => {
    const db = bancoCru()
    const id = randomUUID()
    const licao = registrarLicao(db, P1, { texto: 'No Windows, rodar o Stryker pelo binário local.', agent: 'Claude' }, T1, id)
    assert.deepEqual(licao, {
      id,
      projectId: P1,
      texto: 'No Windows, rodar o Stryker pelo binário local.',
      origem: 'Claude',
      criadaEm: T1,
      aposentadaEm: null,
      motivoAposentadoria: null,
    })
    assert.deepEqual(linhas(db), [
      {
        id,
        project_id: P1,
        texto: 'No Windows, rodar o Stryker pelo binário local.',
        origem: 'Claude',
        criada_em: T1,
        aposentada_em: null,
        motivo_aposentadoria: null,
      },
    ])
  })

  it('gera um id novo (uuid) quando não recebe um', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'Primeira', agent: 'Claude' }, T1)
    const b = registrarLicao(db, P1, { texto: 'Segunda', agent: 'Claude' }, T1)
    assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.notEqual(a.id, b.id)
  })

  it('lição global (projeto nulo) fica com project_id NULL', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, null, { texto: 'No Git Bash, o cd persiste entre chamadas.', agent: 'Codex' }, T1)
    assert.equal(licao.projectId, null)
    assert.equal(linhas(db)[0].project_id, null)
  })

  it('apara o texto e o agente nas pontas e guarda o texto como veio no meio', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, P1, { texto: '  Rodar   o teste\n antes.  ', agent: '  Claude ' }, T1)
    assert.equal(licao.texto, 'Rodar   o teste\n antes.')
    assert.equal(licao.origem, 'Claude')
  })

  it('aceita exatamente 500 caracteres e recusa 501', () => {
    const db = bancoCru()
    assert.equal(LICAO_TEXTO_MAXIMO, 500)
    assert.equal(registrarLicao(db, P1, { texto: 'a'.repeat(500), agent: 'Claude' }, T1).texto.length, 500)
    recusa(() => registrarLicao(db, P1, { texto: 'a'.repeat(501), agent: 'Claude' }, T1), 400, 'invalid_input', 'Campo texto inválido.')
    assert.equal(linhas(db).length, 1)
  })

  it('recusa texto vazio, só espaços, que não é texto e com acento destruído', () => {
    const db = bancoCru()
    for (const texto of ['', '   \n\t ', 42, null, undefined, {}]) {
      recusa(() => registrarLicao(db, P1, { texto: texto as string, agent: 'Claude' }, T1), 400, 'invalid_input', 'Campo texto inválido.')
    }
    recusa(() => registrarLicao(db, P1, { texto: 'a�b', agent: 'Claude' }, T1), 400, 'corrupted_text')
    assert.equal(linhas(db).length, 0)
  })

  it('recusa agente vazio, longo demais ou que não é texto', () => {
    const db = bancoCru()
    for (const agent of ['', '  ', 'a'.repeat(81), 7, null, undefined]) {
      recusa(() => registrarLicao(db, P1, { texto: 'Algo', agent: agent as string }, T1), 400, 'invalid_input', 'Campo agent inválido.')
    }
    assert.equal(registrarLicao(db, P1, { texto: 'Algo', agent: 'a'.repeat(80) }, T1).origem.length, 80)
  })

  it('recusa entrada que não é um objeto', () => {
    const db = bancoCru()
    for (const entrada of [null, 'texto', 5, [], undefined]) {
      recusa(() => registrarLicao(db, P1, entrada as never, T1), 400, 'invalid_input', 'Dados de lição inválidos.')
    }
  })

  it('o banco recusa lição de projeto que não existe (chave estrangeira)', () => {
    const db = bancoCru()
    assert.throws(() => registrarLicao(db, INEXISTENTE, { texto: 'Algo', agent: 'Claude' }, T1))
    assert.equal(linhas(db).length, 0)
  })
})

describe('dedupe de lições (dois agentes, mesma lição)', () => {
  it('maiúsculas e espaços diferentes no mesmo projeto: uma só, a primeira', () => {
    const db = bancoCru()
    const primeira = registrarLicao(db, P1, { texto: 'Rodar o Stryker pelo binário local', agent: 'Claude' }, T1)
    const segunda = registrarLicao(db, P1, { texto: '  RODAR  o   stryker pelo\tbinário LOCAL ', agent: 'Codex' }, T2)
    assert.deepEqual(segunda, primeira)
    assert.equal(segunda.origem, 'Claude')
    assert.equal(segunda.criadaEm, T1)
    assert.equal(linhas(db).length, 1)
  })

  it('quebra de linha e espaço no meio contam como o mesmo espaço', () => {
    const db = bancoCru()
    const primeira = registrarLicao(db, P1, { texto: 'a b c', agent: 'Claude' }, T1)
    const segunda = registrarLicao(db, P1, { texto: 'a\n\nb \t c', agent: 'Codex' }, T2)
    assert.equal(segunda.id, primeira.id)
    assert.equal(linhas(db).length, 1)
  })

  it('acento composto e decomposto (macOS, Windows) são o mesmo texto', () => {
    const db = bancoCru()
    const composto = registrarLicao(db, P1, { texto: 'Atenção à lição', agent: 'Claude' }, T1)
    const decomposto = registrarLicao(db, P1, { texto: 'Atenção à lição', agent: 'Codex' }, T2)
    assert.equal(decomposto.id, composto.id)
    assert.equal(linhas(db).length, 1)
  })

  it('maiúscula acentuada também é igual à minúscula', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'ÁGUA é preciso', agent: 'Claude' }, T1)
    const b = registrarLicao(db, P1, { texto: 'água É PRECISO', agent: 'Codex' }, T2)
    assert.equal(b.id, a.id)
  })

  it('texto parecido mas diferente não duplica nem se confunde', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'Rodar o teste', agent: 'Claude' }, T1)
    const b = registrarLicao(db, P1, { texto: 'Rodar o teste.', agent: 'Claude' }, T2)
    assert.notEqual(a.id, b.id)
    assert.equal(linhas(db).length, 2)
  })

  it('espaço colapsa mas não some: "rodar o teste" e "rodaroteste" são lições diferentes', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'rodar o teste', agent: 'Claude' }, T1)
    const b = registrarLicao(db, P1, { texto: 'rodaroteste', agent: 'Claude' }, T2)
    assert.notEqual(a.id, b.id)
    assert.equal(linhas(db).length, 2)
  })

  it('só a caixa é ignorada: o ß alemão não vira "ss"', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'Straße', agent: 'Claude' }, T1)
    const b = registrarLicao(db, P1, { texto: 'STRASSE', agent: 'Claude' }, T2)
    assert.notEqual(a.id, b.id)
    assert.equal(registrarLicao(db, P1, { texto: 'STRAßE', agent: 'Codex' }, T3).id, a.id)
  })

  it('o mesmo texto em projetos diferentes é uma lição em cada', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'Conferir o fuso', agent: 'Claude' }, T1)
    const b = registrarLicao(db, P2, { texto: 'conferir o fuso', agent: 'Claude' }, T2)
    assert.notEqual(a.id, b.id)
    assert.equal(b.projectId, P2)
  })

  it('o mesmo texto no projeto e no global são duas lições', () => {
    const db = bancoCru()
    const global = registrarLicao(db, null, { texto: 'Conferir o fuso', agent: 'Claude' }, T1)
    const doProjeto = registrarLicao(db, P1, { texto: 'conferir o fuso', agent: 'Claude' }, T2)
    assert.notEqual(global.id, doProjeto.id)
    assert.equal(global.projectId, null)
    assert.equal(doProjeto.projectId, P1)
  })

  it('o mesmo texto global duas vezes é uma lição só', () => {
    const db = bancoCru()
    const a = registrarLicao(db, null, { texto: 'No Windows use barras normais', agent: 'Claude' }, T1)
    const b = registrarLicao(db, null, { texto: 'NO WINDOWS USE BARRAS NORMAIS', agent: 'Codex' }, T2)
    assert.equal(b.id, a.id)
    assert.equal(linhas(db).length, 1)
  })

  it('depois de aposentada, registrar o mesmo texto cria uma lição nova e ativa', () => {
    const db = bancoCru()
    const velha = registrarLicao(db, P1, { texto: 'Usar a porta 4317', agent: 'Claude' }, T1)
    aposentarLicao(db, velha.id, { agent: 'Claude', motivo: 'A porta mudou' }, T2)
    const nova = registrarLicao(db, P1, { texto: 'usar a porta 4317', agent: 'Codex' }, T3)
    assert.notEqual(nova.id, velha.id)
    assert.equal(nova.aposentadaEm, null)
    assert.equal(linhas(db).length, 2)
  })

  it('havendo duas ativas iguais por dados antigos, devolve a mais antiga', () => {
    const db = bancoCru()
    const insere = db.prepare(
      'INSERT INTO licoes (id, project_id, texto, origem, criada_em) VALUES (?, ?, ?, ?, ?)',
    )
    const antiga = randomUUID()
    insere.run(randomUUID(), P1, 'repetida', 'A', T2)
    insere.run(antiga, P1, 'repetida', 'B', T1)
    assert.equal(registrarLicao(db, P1, { texto: 'REPETIDA', agent: 'C' }, T3).id, antiga)
  })
})

describe('listarLicoes (módulo)', () => {
  it('traz as do projeto e as globais, da mais antiga para a mais nova, sem as de outro projeto', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'A do projeto 1', agent: 'Claude' }, T1)
    const g = registrarLicao(db, null, { texto: 'G global', agent: 'Claude' }, T2)
    registrarLicao(db, P2, { texto: 'X do projeto 2', agent: 'Claude' }, T2)
    const b = registrarLicao(db, P1, { texto: 'B do projeto 1', agent: 'Claude' }, T3)
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [a.id, g.id, b.id])
    assert.deepEqual(listarLicoes(db, P2).map((l) => l.texto), ['G global', 'X do projeto 2'])
  })

  it('na mesma hora, mantém a ordem em que foram gravadas', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'z primeira', agent: 'Claude' }, T1, 'ffffffff-ffff-4fff-8fff-ffffffffffff')
    const b = registrarLicao(db, P1, { texto: 'a segunda', agent: 'Claude' }, T1, '00000000-0000-4000-8000-000000000000')
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [a.id, b.id])
  })

  it('por padrão esconde as aposentadas; com incluirAposentadas mostra todas', () => {
    const db = bancoCru()
    const viva = registrarLicao(db, P1, { texto: 'Viva', agent: 'Claude' }, T1)
    const morta = registrarLicao(db, null, { texto: 'Morta', agent: 'Claude' }, T2)
    aposentarLicao(db, morta.id, { agent: 'Claude', motivo: 'Não vale mais' }, T3)
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [viva.id])
    assert.deepEqual(listarLicoes(db, P1, {}).map((l) => l.id), [viva.id])
    assert.deepEqual(listarLicoes(db, P1, { incluirAposentadas: false }).map((l) => l.id), [viva.id])
    const todas = listarLicoes(db, P1, { incluirAposentadas: true })
    assert.deepEqual(todas.map((l) => l.id), [viva.id, morta.id])
    assert.deepEqual(todas[1], { ...morta, aposentadaEm: T3, motivoAposentadoria: 'Não vale mais' })
  })

  it('sem lições, devolve lista vazia', () => {
    assert.deepEqual(listarLicoes(bancoCru(), P1), [])
  })
})

describe('aposentarLicao (módulo)', () => {
  it('marca a hora e o motivo, devolve a lição e não apaga a linha', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, P1, { texto: 'Usar a porta 4317', agent: 'Claude' }, T1)
    const aposentada = aposentarLicao(db, licao.id, { agent: 'Codex', motivo: '  A porta mudou para 4318  ' }, T2)
    assert.deepEqual(aposentada, {
      ...licao,
      aposentadaEm: T2,
      motivoAposentadoria: 'A porta mudou para 4318',
    })
    const guardada = linhas(db)
    assert.equal(guardada.length, 1)
    assert.equal(guardada[0].aposentada_em, T2)
    assert.equal(guardada[0].motivo_aposentadoria, 'A porta mudou para 4318')
    assert.equal(guardada[0].texto, 'Usar a porta 4317')
  })

  it('lição inexistente: 404; id que não é uuid: 400', () => {
    const db = bancoCru()
    recusa(() => aposentarLicao(db, INEXISTENTE, { agent: 'Claude', motivo: 'x' }, T1), 404, 'not_found', 'Lição não encontrada.')
    for (const id of ['abc', '', 5, null, undefined]) {
      recusa(() => aposentarLicao(db, id as string, { agent: 'Claude', motivo: 'x' }, T1), 400, 'invalid_input', 'Campo lessonId inválido.')
    }
  })

  it('já aposentada: 409 e o motivo original continua', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, P1, { texto: 'Algo', agent: 'Claude' }, T1)
    aposentarLicao(db, licao.id, { agent: 'Claude', motivo: 'Primeiro motivo' }, T2)
    recusa(
      () => aposentarLicao(db, licao.id, { agent: 'Codex', motivo: 'Segundo motivo' }, T3),
      409,
      'lesson_already_retired',
      'Esta lição já está aposentada.',
    )
    const guardada = linhas(db)[0]
    assert.equal(guardada.aposentada_em, T2)
    assert.equal(guardada.motivo_aposentadoria, 'Primeiro motivo')
  })

  it('exige motivo (1 a 500 caracteres) e agente', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, P1, { texto: 'Algo', agent: 'Claude' }, T1)
    assert.equal(LICAO_MOTIVO_MAXIMO, 500)
    for (const motivo of ['', '   ', 'm'.repeat(501), 3, null, undefined]) {
      recusa(() => aposentarLicao(db, licao.id, { agent: 'Claude', motivo: motivo as string }, T2), 400, 'invalid_input', 'Campo motivo inválido.')
    }
    for (const agent of ['', ' ', 'a'.repeat(81), 3, null, undefined]) {
      recusa(() => aposentarLicao(db, licao.id, { agent: agent as string, motivo: 'ok' }, T2), 400, 'invalid_input', 'Campo agent inválido.')
    }
    recusa(() => aposentarLicao(db, licao.id, null as never, T2), 400, 'invalid_input', 'Dados de lição inválidos.')
    assert.equal(linhas(db)[0].aposentada_em, null)
    assert.equal(aposentarLicao(db, licao.id, { agent: 'a'.repeat(80), motivo: 'm'.repeat(500) }, T2).motivoAposentadoria?.length, 500)
  })

  it('aposenta também a lição global', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, null, { texto: 'Global', agent: 'Claude' }, T1)
    assert.equal(aposentarLicao(db, licao.id, { agent: 'Claude', motivo: 'Obsoleta' }, T2).aposentadaEm, T2)
  })
})

describe('apagarLicoesDoProjeto e o esquema', () => {
  it('apaga as lições do projeto e mantém as globais e as de outros projetos', () => {
    const db = bancoCru()
    registrarLicao(db, P1, { texto: 'Do 1', agent: 'Claude' }, T1)
    const global = registrarLicao(db, null, { texto: 'Global', agent: 'Claude' }, T1)
    const doDois = registrarLicao(db, P2, { texto: 'Do 2', agent: 'Claude' }, T1)
    apagarLicoesDoProjeto(db, P1)
    assert.deepEqual(linhas(db).map((l) => l.id), [global.id, doDois.id])
  })

  it('criar o esquema duas vezes não apaga nem falha', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, P1, { texto: 'Fica', agent: 'Claude' }, T1)
    ensureLicoesSchema(db)
    assert.deepEqual(listarLicoes(db, P1), [licao])
  })

  it('as colunas e as chaves são as do desenho (D4)', () => {
    const db = bancoCru()
    const colunas = db.prepare('PRAGMA table_info(licoes)').all() as Array<{ name: string; type: string; notnull: number; pk: number }>
    assert.deepEqual(
      colunas.map((c) => [c.name, c.type, c.notnull, c.pk]),
      [
        ['id', 'TEXT', 0, 1],
        ['project_id', 'TEXT', 0, 0],
        ['texto', 'TEXT', 1, 0],
        ['origem', 'TEXT', 1, 0],
        ['criada_em', 'TEXT', 1, 0],
        ['aposentada_em', 'TEXT', 0, 0],
        ['motivo_aposentadoria', 'TEXT', 0, 0],
      ],
    )
    const chaves = db.prepare('PRAGMA foreign_key_list(licoes)').all() as Array<{ table: string; from: string; to: string }>
    assert.deepEqual(chaves.map((c) => [c.table, c.from, c.to]), [['projects', 'project_id', 'id']])
  })
})

describe('escopoDaLicao (projeto ou global)', () => {
  it('global verdadeiro vale para todos os projetos, com ou sem projeto informado', () => {
    assert.equal(escopoDaLicao(undefined, true), null)
    assert.equal(escopoDaLicao(P1, true), null)
  })

  it('sem global, o projeto é obrigatório e vira o escopo', () => {
    assert.equal(escopoDaLicao(P1, undefined), P1)
    assert.equal(escopoDaLicao(P1, false), P1)
    recusa(
      () => escopoDaLicao(undefined, undefined),
      400,
      'invalid_input',
      'Informe projectId, ou global: true para uma lição que vale para todos os projetos.',
    )
    recusa(() => escopoDaLicao(undefined, false), 400, 'invalid_input')
    recusa(() => escopoDaLicao('', false), 400, 'invalid_input')
  })
})

describe('lições no WorkspaceStore', () => {
  it('registra, lista e aposenta com a hora do relógio do store', () => {
    const { store, projectId, outroId } = novaAxon()
    const doProjeto = store.registrarLicao(projectId, { texto: 'Conferir o fuso', agent: 'Claude' })
    const global = store.registrarLicao(null, { texto: 'No Windows use o binário local', agent: 'Claude' })
    store.registrarLicao(outroId, { texto: 'Só da Axon', agent: 'Claude' })
    assert.equal(doProjeto.projectId, projectId)
    assert.match(doProjeto.criadaEm, /^2026-10-25T10:0[1-9]:00\.000Z$/)
    assert.deepEqual(store.listarLicoes(projectId).map((l) => l.id), [doProjeto.id, global.id])
    const aposentada = store.aposentarLicao(global.id, { agent: 'Codex', motivo: 'Mudou' })
    assert.equal(aposentada.motivoAposentadoria, 'Mudou')
    assert.match(String(aposentada.aposentadaEm), /^2026-10-25T10:/)
    assert.deepEqual(store.listarLicoes(projectId).map((l) => l.id), [doProjeto.id])
    assert.deepEqual(store.listarLicoes(projectId, { incluirAposentadas: true }).map((l) => l.id), [doProjeto.id, global.id])
  })

  it('dedupe pelo store: dois agentes, caixa e espaços diferentes, uma só lição', () => {
    const { store, projectId } = novaAxon()
    const a = store.registrarLicao(projectId, { texto: 'Rodar o teste antes', agent: 'Claude' })
    const b = store.registrarLicao(projectId, { texto: ' rodar  O TESTE antes ', agent: 'Codex' })
    assert.equal(b.id, a.id)
    assert.equal(store.listarLicoes(projectId).length, 1)
  })

  it('projeto inexistente: 404; projectId que não é uuid: 400; lista de projeto inexistente: 404', () => {
    const { store } = novaAxon()
    recusa(() => store.registrarLicao(INEXISTENTE, { texto: 'x', agent: 'Claude' }), 404, 'not_found', 'Projeto não encontrado.')
    recusa(() => store.registrarLicao('nao-e-uuid', { texto: 'x', agent: 'Claude' }), 400, 'invalid_input', 'Campo projectId inválido.')
    recusa(() => store.listarLicoes(INEXISTENTE), 404, 'not_found', 'Projeto não encontrado.')
    recusa(() => store.listarLicoes('nao-e-uuid'), 400, 'invalid_input', 'Campo projectId inválido.')
  })

  it('lição global não exige projeto algum', () => {
    const store = new WorkspaceStore(':memory:')
    stores.push(store)
    assert.equal(store.registrarLicao(null, { texto: 'Vale em qualquer lugar', agent: 'Claude' }).projectId, null)
  })

  it('aposentar: id inexistente 404, id inválido 400, já aposentada 409', () => {
    const { store, projectId } = novaAxon()
    const licao = store.registrarLicao(projectId, { texto: 'Algo', agent: 'Claude' })
    recusa(() => store.aposentarLicao(INEXISTENTE, { agent: 'Claude', motivo: 'x' }), 404, 'not_found')
    recusa(() => store.aposentarLicao('abc', { agent: 'Claude', motivo: 'x' }), 400, 'invalid_input')
    store.aposentarLicao(licao.id, { agent: 'Claude', motivo: 'x' })
    recusa(() => store.aposentarLicao(licao.id, { agent: 'Claude', motivo: 'y' }), 409, 'lesson_already_retired')
  })

  it('apagar o projeto leva as lições dele e deixa as globais e as dos outros', () => {
    const { store, projectId, outroId } = novaAxon()
    store.registrarLicao(projectId, { texto: 'Do projeto', agent: 'Claude' })
    const global = store.registrarLicao(null, { texto: 'Global', agent: 'Claude' })
    const doOutro = store.registrarLicao(outroId, { texto: 'Do outro', agent: 'Claude' })
    store.deleteProject(projectId, 'Alfa')
    assert.deepEqual(store.listarLicoes(outroId).map((l) => l.id), [global.id, doOutro.id])
  })

  it('banco antigo (sem a tabela licoes) migra na abertura e continua com os dados de antes', () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'axon-licoes-'))
    pastas.push(pasta)
    const arquivo = path.join(pasta, 'antigo.sqlite')
    const primeiro = new WorkspaceStore(arquivo)
    const projectId = primeiro.createProject({ name: 'Antigo', objective: 'Já existia' }).id
    primeiro.registrarLicao(projectId, { texto: 'Vai sumir com a tabela', agent: 'Claude' })
    primeiro.close()
    const cru = new DatabaseSync(arquivo)
    cru.exec('DROP TABLE licoes')
    cru.close()
    const reaberto = new WorkspaceStore(arquivo)
    stores.push(reaberto)
    assert.deepEqual(reaberto.listarLicoes(projectId), [])
    const nova = reaberto.registrarLicao(projectId, { texto: 'Agora existe', agent: 'Claude' })
    assert.deepEqual(reaberto.listarLicoes(projectId).map((l) => l.id), [nova.id])
    assert.equal(reaberto.getProject(projectId).project.name, 'Antigo')
  })
})

describe('lições pelo MCP', () => {
  async function conectar() {
    const { store, projectId, outroId } = novaAxon()
    const server = createMcpServer(store)
    const client = new Client({ name: 'licoes-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const chamar = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args })
      const content = response.content as Array<{ type: string; text: string }>
      return { erro: response.isError === true, dados: JSON.parse(content[0].text) }
    }
    const encerrar = async () => {
      await client.close()
      await server.close()
    }
    return { chamar, encerrar, projectId, outroId, client }
  }

  it('as três ferramentas existem, com a descrição e os campos do desenho', async () => {
    const { client, encerrar } = await conectar()
    try {
      const ferramentas = (await client.listTools()).tools
      const por = (nome: string) => ferramentas.find((f) => f.name === nome)
      for (const nome of ['record_lesson', 'list_lessons', 'retire_lesson']) assert.ok(por(nome), `falta ${nome}`)
      const campos = (nome: string) => Object.keys((por(nome)?.inputSchema.properties ?? {}) as object).sort()
      assert.deepEqual(campos('record_lesson'), ['agent', 'global', 'projectId', 'texto'])
      assert.deepEqual(campos('list_lessons'), ['incluirAposentadas', 'projectId'])
      assert.deepEqual(campos('retire_lesson'), ['agent', 'lessonId', 'motivo'])
      assert.deepEqual((por('record_lesson')?.inputSchema.required ?? []).slice().sort(), ['agent', 'texto'])
      assert.deepEqual((por('list_lessons')?.inputSchema.required ?? []).slice().sort(), ['projectId'])
      assert.deepEqual((por('retire_lesson')?.inputSchema.required ?? []).slice().sort(), ['agent', 'lessonId', 'motivo'])
      assert.equal(por('list_lessons')?.annotations?.readOnlyHint, true)
      assert.equal(por('record_lesson')?.annotations?.readOnlyHint, false)
      assert.equal(por('retire_lesson')?.annotations?.destructiveHint, false)
    } finally {
      await encerrar()
    }
  })

  it('registra no projeto, repete sem duplicar, lista e aposenta', async () => {
    const { chamar, encerrar, projectId } = await conectar()
    try {
      const nova = await chamar('record_lesson', { projectId, texto: 'Conferir o fuso', agent: 'Claude' })
      assert.equal(nova.erro, false)
      assert.equal(nova.dados.projectId, projectId)
      assert.equal(nova.dados.origem, 'Claude')
      assert.equal(nova.dados.aposentadaEm, null)
      const repetida = await chamar('record_lesson', { projectId, texto: '  CONFERIR o  fuso ', agent: 'Codex' })
      assert.equal(repetida.dados.id, nova.dados.id)
      const lista = await chamar('list_lessons', { projectId })
      assert.deepEqual(lista.dados.map((l: Licao) => l.id), [nova.dados.id])
      const aposentada = await chamar('retire_lesson', { lessonId: nova.dados.id, agent: 'Claude', motivo: 'Já está no código' })
      assert.equal(aposentada.erro, false)
      assert.equal(aposentada.dados.motivoAposentadoria, 'Já está no código')
      assert.deepEqual((await chamar('list_lessons', { projectId })).dados, [])
      const todas = await chamar('list_lessons', { projectId, incluirAposentadas: true })
      assert.deepEqual(todas.dados.map((l: Licao) => l.id), [nova.dados.id])
    } finally {
      await encerrar()
    }
  })

  it('global: true grava para todos os projetos, mesmo se projectId vier junto', async () => {
    const { chamar, encerrar, projectId, outroId } = await conectar()
    try {
      const global = await chamar('record_lesson', { texto: 'No Windows use o binário local', agent: 'Claude', global: true })
      assert.equal(global.dados.projectId, null)
      const comProjeto = await chamar('record_lesson', { projectId, texto: 'Outra coisa de ambiente', agent: 'Claude', global: true })
      assert.equal(comProjeto.dados.projectId, null)
      const naLista = (id: string) => chamar('list_lessons', { projectId: id })
      assert.deepEqual((await naLista(projectId)).dados.map((l: Licao) => l.id), [global.dados.id, comProjeto.dados.id])
      assert.deepEqual((await naLista(outroId)).dados.map((l: Licao) => l.id), [global.dados.id, comProjeto.dados.id])
    } finally {
      await encerrar()
    }
  })

  it('recusas voltam com o código estável', async () => {
    const { chamar, encerrar, projectId } = await conectar()
    try {
      const semEscopo = await chamar('record_lesson', { texto: 'Sem projeto', agent: 'Claude' })
      assert.equal(semEscopo.erro, true)
      assert.equal(semEscopo.dados.error.code, 'invalid_input')
      const semProjeto = await chamar('record_lesson', { projectId: INEXISTENTE, texto: 'Algo', agent: 'Claude' })
      assert.equal(semProjeto.dados.error.code, 'not_found')
      const longa = await chamar('record_lesson', { projectId, texto: 'a'.repeat(501), agent: 'Claude' })
      assert.equal(longa.dados.error.code, 'invalid_input')
      const listaSemProjeto = await chamar('list_lessons', { projectId: INEXISTENTE })
      assert.equal(listaSemProjeto.dados.error.code, 'not_found')
      const aposentarInexistente = await chamar('retire_lesson', { lessonId: INEXISTENTE, agent: 'Claude', motivo: 'x' })
      assert.equal(aposentarInexistente.dados.error.code, 'not_found')
      const licao = await chamar('record_lesson', { projectId, texto: 'Algo', agent: 'Claude' })
      await chamar('retire_lesson', { lessonId: licao.dados.id, agent: 'Claude', motivo: 'x' })
      const dupla = await chamar('retire_lesson', { lessonId: licao.dados.id, agent: 'Claude', motivo: 'y' })
      assert.equal(dupla.dados.error.code, 'lesson_already_retired')
    } finally {
      await encerrar()
    }
  })
})

describe('instruções do servidor MCP sobre lições', () => {
  it('dizem como registrar, o que é global e que a retomada traz as lições, sem passar de 4.096 caracteres', () => {
    const t = INSTRUCOES_DO_SERVIDOR
    assert.ok(t.length <= 4096, `tem ${t.length} caracteres`)
    assert.match(t, /record_lesson/)
    assert.match(t, /retire_lesson/)
    assert.match(t, /global/)
    assert.match(t, /ambiente e ferramenta/)
    assert.match(t, /retomada/)
  })
})
