import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  FRASE_DO_DONO_MAXIMA,
  LINHA_CURTA_MAXIMA,
  MOMENTOS_DA_VERIFICACAO,
  TIPOS_DE_LICAO,
} from '../shared/licoes.ts'
import { createMcpServer } from '../server/mcp-tools.ts'
import { ensureLicoesSchema, listarLicoes, registrarLicao } from '../server/store/licoes.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'

/**
 * Tipos de memória (etapa 1, frente A): erro, regra e verificação. Regra e verificação vêm da fala do
 * dono, são sempre do projeto e levam a frase dele; verificação tem momento; uma lição pode substituir
 * outra, numa transação; a listagem filtra por tipo e momento. Banco antigo abre e lê tudo como erro.
 */

const stores: WorkspaceStore[] = []
const bancos: DatabaseSync[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const db of bancos.splice(0)) db.close()
})

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const INEXISTENTE = '99999999-9999-4999-8999-999999999999'
const T1 = '2026-11-19T10:00:00.000Z'
const T2 = '2026-11-19T11:00:00.000Z'
const T3 = '2026-11-19T12:00:00.000Z'
const FRASE = 'Nunca suba sem eu mandar.'

function bancoCru(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  bancos.push(db)
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)')
  db.exec(`INSERT INTO projects (id) VALUES ('${P1}'), ('${P2}')`)
  ensureLicoesSchema(db)
  return db
}

function contar(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM licoes').get() as { n: number }).n
}

function colunas(db: DatabaseSync): string[] {
  return (db.prepare('PRAGMA table_info(licoes)').all() as Array<{ name: string }>).map((c) => c.name)
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

function regra(db: DatabaseSync, texto: string, extra: Record<string, unknown> = {}, ts = T1, projeto: string | null = P1) {
  return registrarLicao(db, projeto, { texto, agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE, ...extra }, ts)
}

describe('constantes dos tipos', () => {
  it('têm os valores do contrato', () => {
    assert.deepEqual([...TIPOS_DE_LICAO], ['erro', 'regra', 'verificacao'])
    assert.deepEqual([...MOMENTOS_DA_VERIFICACAO], ['antes_de_subir', 'antes_de_pronto', 'antes_de_commit'])
    assert.equal(LINHA_CURTA_MAXIMA, 120)
    assert.equal(FRASE_DO_DONO_MAXIMA, 1000)
  })
})

describe('registrarLicao com tipo', () => {
  it('sem tipo grava erro, com os campos novos vazios', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, P1, { texto: 'Conferir o fuso', agent: 'Claude' }, T1)
    assert.equal(licao.tipo, 'erro')
    assert.equal(licao.fraseDoDono, null)
    assert.equal(licao.momento, null)
    assert.equal(licao.linhaCurta, null)
    assert.equal(licao.substituiId, null)
    const linha = db.prepare('SELECT tipo, frase_do_dono, momento, linha_curta, substitui_id FROM licoes').get()
    assert.deepEqual({ ...linha }, { tipo: 'erro', frase_do_dono: null, momento: null, linha_curta: null, substitui_id: null })
  })

  it('erro explícito, com linha curta e global, é aceito', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, null, { texto: 'Windows: binário local', agent: 'Claude', tipo: 'erro', linhaCurta: 'Binário local' }, T1)
    assert.equal(licao.tipo, 'erro')
    assert.equal(licao.projectId, null)
    assert.equal(licao.linhaCurta, 'Binário local')
  })

  it('regra do projeto guarda a frase do dono e a linha curta, aparadas', () => {
    const db = bancoCru()
    const licao = regra(db, 'Não subir sem ordem do dono', { fraseDoDono: `  ${FRASE}  `, linhaCurta: ' Sem subir sozinho ' })
    assert.equal(licao.tipo, 'regra')
    assert.equal(licao.fraseDoDono, FRASE)
    assert.equal(licao.linhaCurta, 'Sem subir sozinho')
    assert.equal(licao.momento, null)
    const linha = db.prepare('SELECT tipo, frase_do_dono, linha_curta FROM licoes').get()
    assert.deepEqual({ ...linha }, { tipo: 'regra', frase_do_dono: FRASE, linha_curta: 'Sem subir sozinho' })
  })

  it('verificação com momento é gravada e volta na listagem', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, P1, { texto: 'Rodar a suíte', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: 'antes_de_subir' }, T1)
    assert.equal(licao.tipo, 'verificacao')
    assert.equal(licao.momento, 'antes_de_subir')
    assert.deepEqual(listarLicoes(db, P1), [licao])
  })

  it('cada momento da lista é aceito', () => {
    const db = bancoCru()
    for (const momento of MOMENTOS_DA_VERIFICACAO) {
      const licao = registrarLicao(db, P1, { texto: `Conferir ${momento}`, agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento }, T1)
      assert.equal(licao.momento, momento)
    }
  })

  it('os limites exatos de linha curta (120) e frase do dono (1000) passam', () => {
    const db = bancoCru()
    const licao = regra(db, 'No limite', { linhaCurta: 'l'.repeat(120), fraseDoDono: 'f'.repeat(1000) })
    assert.equal(licao.linhaCurta?.length, 120)
    assert.equal(licao.fraseDoDono?.length, 1000)
  })

  it('regra ou verificação global: 400 regra_precisa_de_projeto, sem gravar', () => {
    const db = bancoCru()
    const msg = 'Regra e verificação do dono valem para um projeto: informe projectId, sem global.'
    recusa(() => regra(db, 'Global', {}, T1, null), 400, 'regra_precisa_de_projeto', msg)
    recusa(
      () => registrarLicao(db, null, { texto: 'Global', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: 'antes_de_pronto' }, T1),
      400,
      'regra_precisa_de_projeto',
    )
    assert.equal(contar(db), 0)
  })

  it('regra ou verificação sem a frase do dono: 400 frase_do_dono_obrigatoria', () => {
    const db = bancoCru()
    const msg = 'Regra e verificação precisam da frase do dono, escrita como ele disse.'
    recusa(() => registrarLicao(db, P1, { texto: 'Sem frase', agent: 'Claude', tipo: 'regra' }, T1), 400, 'frase_do_dono_obrigatoria', msg)
    recusa(
      () => registrarLicao(db, P1, { texto: 'Sem frase', agent: 'Claude', tipo: 'verificacao', momento: 'antes_de_pronto' }, T1),
      400,
      'frase_do_dono_obrigatoria',
    )
    assert.equal(contar(db), 0)
  })

  it('verificação sem momento: 400 momento_obrigatorio', () => {
    const db = bancoCru()
    recusa(
      () => registrarLicao(db, P1, { texto: 'Sem momento', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE }, T1),
      400,
      'momento_obrigatorio',
      'Verificação precisa do momento: antes_de_subir, antes_de_pronto ou antes_de_commit.',
    )
    assert.equal(contar(db), 0)
  })

  it('momento em erro ou em regra: 400 momento_so_em_verificacao', () => {
    const db = bancoCru()
    const msg = 'O momento só existe em verificação.'
    recusa(() => registrarLicao(db, P1, { texto: 'Erro com momento', agent: 'Claude', momento: 'antes_de_pronto' }, T1), 400, 'momento_so_em_verificacao', msg)
    recusa(() => registrarLicao(db, P1, { texto: 'Erro com momento', agent: 'Claude', tipo: 'erro', momento: 'antes_de_pronto' }, T1), 400, 'momento_so_em_verificacao')
    recusa(() => regra(db, 'Regra com momento', { momento: 'antes_de_pronto' }), 400, 'momento_so_em_verificacao')
    assert.equal(contar(db), 0)
  })

  it('tipo ou momento fora da lista: 400 invalid_input', () => {
    const db = bancoCru()
    recusa(() => registrarLicao(db, P1, { texto: 'X', agent: 'Claude', tipo: 'dica' as never }, T1), 400, 'invalid_input', 'Campo tipo inválido.')
    recusa(() => registrarLicao(db, P1, { texto: 'X', agent: 'Claude', tipo: null as never }, T1), 400, 'invalid_input')
    recusa(
      () => registrarLicao(db, P1, { texto: 'X', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: 'sempre' as never }, T1),
      400,
      'invalid_input',
      'Campo momento inválido.',
    )
    recusa(() => registrarLicao(db, P1, { texto: 'X', agent: 'Claude', momento: null as never }, T1), 400, 'invalid_input')
    assert.equal(contar(db), 0)
  })

  it('linhaCurta com mais de 120 ou vazia e fraseDoDono com mais de 1000 ou vazia: 400 invalid_input', () => {
    const db = bancoCru()
    recusa(() => regra(db, 'A', { linhaCurta: 'l'.repeat(121) }), 400, 'invalid_input', 'Campo linhaCurta inválido.')
    recusa(() => regra(db, 'A', { linhaCurta: '   ' }), 400, 'invalid_input')
    recusa(() => regra(db, 'A', { fraseDoDono: 'f'.repeat(1001) }), 400, 'invalid_input', 'Campo fraseDoDono inválido.')
    recusa(() => regra(db, 'A', { fraseDoDono: '   ' }), 400, 'invalid_input')
    recusa(() => registrarLicao(db, P1, { texto: 'A', agent: 'Claude', fraseDoDono: 7 as never }, T1), 400, 'invalid_input')
    assert.equal(contar(db), 0)
  })

  it('erro pode levar a frase do dono (campo opcional fora de regra e verificação)', () => {
    const db = bancoCru()
    const licao = registrarLicao(db, P1, { texto: 'Erro citado', agent: 'Claude', fraseDoDono: 'Isso quebrou ontem' }, T1)
    assert.equal(licao.tipo, 'erro')
    assert.equal(licao.fraseDoDono, 'Isso quebrou ontem')
  })
})

describe('deduplicação por tipo, escopo e texto', () => {
  it('mesmo tipo, escopo e texto: devolve a existente, sem gravar', () => {
    const db = bancoCru()
    const a = regra(db, 'Não subir sozinho')
    const b = regra(db, '  NÃO subir   sozinho ', {}, T2)
    assert.deepEqual(b, a)
    assert.equal(contar(db), 1)
  })

  it('texto igual em outro tipo grava (erro, regra e verificação convivem)', () => {
    const db = bancoCru()
    const erro = registrarLicao(db, P1, { texto: 'Rodar a suíte', agent: 'Claude' }, T1)
    const r = regra(db, 'Rodar a suíte', {}, T2)
    const v = registrarLicao(db, P1, { texto: 'Rodar a suíte', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: 'antes_de_pronto' }, T3)
    assert.equal(new Set([erro.id, r.id, v.id]).size, 3)
    assert.equal(contar(db), 3)
  })

  it('mesmo tipo em outro escopo grava', () => {
    const db = bancoCru()
    const a = regra(db, 'Não subir sozinho')
    const b = regra(db, 'Não subir sozinho', {}, T2, P2)
    assert.notEqual(a.id, b.id)
    const g1 = registrarLicao(db, null, { texto: 'Global igual', agent: 'Claude' }, T1)
    const g2 = registrarLicao(db, null, { texto: 'global IGUAL', agent: 'Claude' }, T2)
    assert.equal(g2.id, g1.id)
  })

  it('a existente aposentada não conta: grava outra', () => {
    const db = bancoCru()
    const a = regra(db, 'Não subir sozinho')
    db.prepare('UPDATE licoes SET aposentada_em = ? WHERE id = ?').run(T2, a.id)
    const b = regra(db, 'Não subir sozinho', {}, T3)
    assert.notEqual(a.id, b.id)
  })

  it('erro igual a erro continua não duplicando (comportamento de hoje)', () => {
    const db = bancoCru()
    const a = registrarLicao(db, P1, { texto: 'Mesmo erro', agent: 'Claude' }, T1)
    const b = registrarLicao(db, P1, { texto: 'mesmo ERRO', agent: 'Codex', tipo: 'erro' }, T2)
    assert.equal(b.id, a.id)
  })
})

describe('substitui', () => {
  it('grava a nova com substituiId e aposenta a antiga com o motivo, no mesmo ato', () => {
    const db = bancoCru()
    const antiga = regra(db, 'Subir às sextas')
    const id = randomUUID()
    const nova = registrarLicao(db, P1, { texto: 'Não subir às sextas', agent: 'Codex', tipo: 'regra', fraseDoDono: FRASE, substitui: antiga.id }, T2, id)
    assert.equal(nova.id, id)
    assert.equal(nova.substituiId, antiga.id)
    assert.equal(nova.aposentadaEm, null)
    const lista = listarLicoes(db, P1, { incluirAposentadas: true })
    assert.deepEqual(lista.map((l) => l.id), [antiga.id, id])
    assert.equal(lista[0].aposentadaEm, T2)
    assert.equal(lista[0].motivoAposentadoria, `substituída por ${id}`)
    assert.equal(lista[1].substituiId, antiga.id)
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [id])
  })

  it('uma lição pode substituir outra de tipo diferente no mesmo escopo, e a global substitui global', () => {
    const db = bancoCru()
    const erro = registrarLicao(db, P1, { texto: 'Erro antigo', agent: 'Claude' }, T1)
    const nova = regra(db, 'Regra que corrige', { substitui: erro.id }, T2)
    assert.equal(nova.substituiId, erro.id)
    const g = registrarLicao(db, null, { texto: 'Global antiga', agent: 'Claude' }, T1)
    const g2 = registrarLicao(db, null, { texto: 'Global nova', agent: 'Claude', substitui: g.id }, T2)
    assert.equal(g2.substituiId, g.id)
    assert.equal(listarLicoes(db, P1, { incluirAposentadas: true }).find((l) => l.id === g.id)?.aposentadaEm, T2)
  })

  it('inexistente: 404 not_found; id que não é uuid: 400 invalid_input', () => {
    const db = bancoCru()
    recusa(() => regra(db, 'Nova', { substitui: INEXISTENTE }), 404, 'not_found', 'Lição a substituir não encontrada.')
    recusa(() => regra(db, 'Nova', { substitui: 'nao-e-uuid' }), 400, 'invalid_input', 'Campo substitui inválido.')
    assert.equal(contar(db), 0)
  })

  it('já aposentada: 409 lesson_already_retired, e nada muda', () => {
    const db = bancoCru()
    const antiga = regra(db, 'Antiga')
    db.prepare('UPDATE licoes SET aposentada_em = ?, motivo_aposentadoria = ? WHERE id = ?').run(T2, 'Mudou', antiga.id)
    recusa(() => regra(db, 'Nova', { substitui: antiga.id }, T3), 409, 'lesson_already_retired', 'Esta lição já está aposentada.')
    assert.equal(contar(db), 1)
    assert.equal(listarLicoes(db, P1, { incluirAposentadas: true })[0].motivoAposentadoria, 'Mudou')
  })

  it('de outro escopo: 400 escopo_diferente (projeto, global e outro projeto)', () => {
    const db = bancoCru()
    const doP1 = regra(db, 'Do P1')
    const global = registrarLicao(db, null, { texto: 'Global', agent: 'Claude' }, T1)
    const msg = 'A lição a substituir é de outro escopo (outro projeto ou global).'
    recusa(() => regra(db, 'No P2', { substitui: doP1.id }, T2, P2), 400, 'escopo_diferente', msg)
    recusa(() => regra(db, 'No P1', { substitui: global.id }, T2), 400, 'escopo_diferente')
    recusa(() => registrarLicao(db, null, { texto: 'Global nova', agent: 'Claude', substitui: doP1.id }, T2), 400, 'escopo_diferente')
    assert.equal(contar(db), 2)
    assert.equal(listarLicoes(db, P1)[0].aposentadaEm, null)
  })

  it('se aposentar a antiga falha, a nova não fica gravada (transação)', () => {
    const db = bancoCru()
    const antiga = regra(db, 'Antiga')
    db.exec(`CREATE TRIGGER trava BEFORE UPDATE ON licoes BEGIN SELECT RAISE(ABORT, 'trava'); END`)
    assert.throws(() => regra(db, 'Nova', { substitui: antiga.id }, T2), /trava/)
    assert.equal(contar(db), 1)
    assert.equal(db.isTransaction, false)
  })

  it('se gravar a nova falha, a antiga continua ativa', () => {
    const db = bancoCru()
    const antiga = regra(db, 'Antiga')
    assert.throws(() =>
      registrarLicao(db, P1, { texto: 'Nova', agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE, substitui: antiga.id }, T2, antiga.id),
    )
    assert.equal(listarLicoes(db, P1)[0].aposentadaEm, null)
    assert.equal(contar(db), 1)
    assert.equal(db.isTransaction, false)
  })

  it('gravar com sucesso não deixa transação aberta', () => {
    const db = bancoCru()
    const antiga = regra(db, 'Antiga')
    assert.equal(db.isTransaction, false)
    regra(db, 'Nova', { substitui: antiga.id }, T2)
    assert.equal(db.isTransaction, false)
  })

  it('dentro de uma transação já aberta, a substituição também vale (e desfaz junto com ela)', () => {
    const db = bancoCru()
    const antiga = regra(db, 'Antiga')
    db.exec('BEGIN')
    const nova = regra(db, 'Nova', { substitui: antiga.id }, T2)
    assert.equal(listarLicoes(db, P1).length, 1)
    db.exec('ROLLBACK')
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [antiga.id])
    assert.equal(contar(db), 1)
    assert.notEqual(nova.id, antiga.id)
  })

  it('texto igual a outra ativa: recusa com 409 licao_igual_ja_existe e não aposenta a substituída', () => {
    const db = bancoCru()
    const a = regra(db, 'Igual')
    const b = regra(db, 'Outra')
    recusa(
      () => regra(db, 'igual', { substitui: b.id }, T3),
      409,
      'licao_igual_ja_existe',
      `Já existe uma lição ativa com este texto (${a.id}); aposente-a ou escolha outro texto.`,
    )
    assert.equal(listarLicoes(db, P1).length, 2)
  })
})

describe('listarLicoes com filtros', () => {
  function montar() {
    const db = bancoCru()
    const erro = registrarLicao(db, P1, { texto: 'E', agent: 'Claude' }, T1)
    const r = regra(db, 'R', {}, T1)
    const vs = registrarLicao(db, P1, { texto: 'VS', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: 'antes_de_subir' }, T2)
    const vp = registrarLicao(db, P1, { texto: 'VP', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: 'antes_de_pronto' }, T3)
    const ge = registrarLicao(db, null, { texto: 'GE', agent: 'Claude' }, T3)
    return { db, erro, r, vs, vp, ge }
  }

  it('sem filtro traz todos os tipos, na mesma ordem de hoje', () => {
    const { db, erro, r, vs, vp, ge } = montar()
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [erro.id, r.id, vs.id, vp.id, ge.id])
    assert.deepEqual(listarLicoes(db, P1, {}).map((l) => l.id), [erro.id, r.id, vs.id, vp.id, ge.id])
  })

  it('filtra por tipo', () => {
    const { db, erro, r, vs, vp, ge } = montar()
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'erro' }).map((l) => l.id), [erro.id, ge.id])
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'regra' }).map((l) => l.id), [r.id])
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'verificacao' }).map((l) => l.id), [vs.id, vp.id])
  })

  it('filtra por momento, sozinho ou junto com o tipo', () => {
    const { db, vs, vp } = montar()
    assert.deepEqual(listarLicoes(db, P1, { momento: 'antes_de_subir' }).map((l) => l.id), [vs.id])
    assert.deepEqual(listarLicoes(db, P1, { momento: 'antes_de_pronto', tipo: 'verificacao' }).map((l) => l.id), [vp.id])
    assert.deepEqual(listarLicoes(db, P1, { momento: 'antes_de_commit' }), [])
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'regra', momento: 'antes_de_subir' }), [])
  })

  it('o filtro convive com incluirAposentadas', () => {
    const { db, r } = montar()
    db.prepare('UPDATE licoes SET aposentada_em = ? WHERE id = ?').run(T3, r.id)
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'regra' }), [])
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'regra', incluirAposentadas: true }).map((l) => l.id), [r.id])
  })

  it('o filtro não deixa vazar lição de outro projeto', () => {
    const { db } = montar()
    regra(db, 'R do P2', {}, T3, P2)
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'regra' }).map((l) => l.texto), ['R'])
  })

  it('tipo ou momento fora da lista: 400 invalid_input', () => {
    const { db } = montar()
    recusa(() => listarLicoes(db, P1, { tipo: 'dica' as never }), 400, 'invalid_input', 'Campo tipo inválido.')
    recusa(() => listarLicoes(db, P1, { momento: 'sempre' as never }), 400, 'invalid_input', 'Campo momento inválido.')
  })
})

describe('migração do banco antigo', () => {
  const TABELA_ANTIGA = `
    CREATE TABLE licoes (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      texto TEXT NOT NULL,
      origem TEXT NOT NULL,
      criada_em TEXT NOT NULL,
      aposentada_em TEXT,
      motivo_aposentadoria TEXT
    );`

  function bancoAntigo(): DatabaseSync {
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
    bancos.push(db)
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)')
    db.exec(`INSERT INTO projects (id) VALUES ('${P1}')`)
    db.exec(TABELA_ANTIGA)
    db.prepare('INSERT INTO licoes (id, project_id, texto, origem, criada_em) VALUES (?, ?, ?, ?, ?)').run('antiga-1', P1, 'Lição de antes', 'Claude', T1)
    return db
  }

  it('acrescenta as cinco colunas e a lição antiga volta como erro', () => {
    const db = bancoAntigo()
    assert.ok(!colunas(db).includes('tipo'))
    ensureLicoesSchema(db)
    for (const coluna of ['tipo', 'frase_do_dono', 'momento', 'linha_curta', 'substitui_id']) {
      assert.equal(colunas(db).filter((c) => c === coluna).length, 1, coluna)
    }
    assert.deepEqual(listarLicoes(db, P1), [
      {
        id: 'antiga-1',
        projectId: P1,
        texto: 'Lição de antes',
        origem: 'Claude',
        criadaEm: T1,
        aposentadaEm: null,
        motivoAposentadoria: null,
        tipo: 'erro',
        fraseDoDono: null,
        momento: null,
        linhaCurta: null,
        substituiId: null,
      },
    ])
  })

  it('rodar duas vezes não quebra nem duplica colunas, e a lição antiga continua deduplicando', () => {
    const db = bancoAntigo()
    ensureLicoesSchema(db)
    const antes = colunas(db)
    ensureLicoesSchema(db)
    assert.deepEqual(colunas(db), antes)
    const igual = registrarLicao(db, P1, { texto: 'lição DE antes', agent: 'Codex' }, T2)
    assert.equal(igual.id, 'antiga-1')
    assert.equal(contar(db), 1)
  })

  it('o tipo novo grava e lê depois da migração', () => {
    const db = bancoAntigo()
    ensureLicoesSchema(db)
    const r = regra(db, 'Nova regra', {}, T2)
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'regra' }).map((l) => l.id), [r.id])
    assert.deepEqual(listarLicoes(db, P1, { tipo: 'erro' }).map((l) => l.id), ['antiga-1'])
  })

  it('banco novo já nasce com as colunas, e abrir de novo não muda nada', () => {
    const db = bancoCru()
    const antes = colunas(db)
    for (const coluna of ['tipo', 'frase_do_dono', 'momento', 'linha_curta', 'substitui_id']) assert.ok(antes.includes(coluna), coluna)
    ensureLicoesSchema(db)
    assert.deepEqual(colunas(db), antes)
  })
})

describe('tipos pelo WorkspaceStore', () => {
  function novaAxon() {
    const store = new WorkspaceStore(':memory:')
    stores.push(store)
    const projectId = store.createProject({ name: 'Nata', objective: 'Vender cursos' }).id
    return { store, projectId }
  }

  it('repassa os campos novos, substitui dentro da transação do store e filtra na listagem', () => {
    const { store, projectId } = novaAxon()
    const antiga = store.registrarLicao(projectId, { texto: 'Subir às sextas', agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE, linhaCurta: 'Sextas' })
    assert.equal(antiga.linhaCurta, 'Sextas')
    const nova = store.registrarLicao(projectId, { texto: 'Não subir às sextas', agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE, substitui: antiga.id })
    assert.equal(nova.substituiId, antiga.id)
    assert.deepEqual(store.listarLicoes(projectId, { tipo: 'regra' }).map((l) => l.id), [nova.id])
    assert.equal(store.listarLicoes(projectId, { incluirAposentadas: true, tipo: 'regra' }).length, 2)
    store.registrarLicao(projectId, { texto: 'Rodar a suíte', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: 'antes_de_commit' })
    assert.equal(store.listarLicoes(projectId, { momento: 'antes_de_commit' }).length, 1)
  })

  it('global com regra: 400 regra_precisa_de_projeto; substituição que falha desfaz tudo', () => {
    const { store, projectId } = novaAxon()
    recusa(() => store.registrarLicao(null, { texto: 'Global', agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE }), 400, 'regra_precisa_de_projeto')
    const antiga = store.registrarLicao(projectId, { texto: 'Antiga', agent: 'Claude' })
    recusa(() => store.registrarLicao(projectId, { texto: 'Nova', agent: 'Claude', substitui: INEXISTENTE }), 404, 'not_found')
    assert.deepEqual(store.listarLicoes(projectId).map((l) => l.id), [antiga.id])
  })
})

describe('tipos pelo MCP', () => {
  async function conectar() {
    const store = new WorkspaceStore(':memory:')
    stores.push(store)
    const projectId = store.createProject({ name: 'Nata', objective: 'Vender cursos' }).id
    const server = createMcpServer(store)
    const client = new Client({ name: 'licoes-tipos-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const chamar = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args })
      const content = response.content as Array<{ type: string; text: string }>
      let dados: unknown = content[0].text
      try {
        dados = JSON.parse(content[0].text)
      } catch {
        // texto puro (recusa do esquema)
      }
      return { erro: response.isError === true, dados: dados as any }
    }
    const encerrar = async () => {
      await client.close()
      await server.close()
    }
    return { chamar, encerrar, projectId, client }
  }

  it('record_lesson e list_lessons expõem os campos novos, todos opcionais, e descrevem os tipos', async () => {
    const { client, encerrar } = await conectar()
    try {
      const ferramentas = (await client.listTools()).tools
      const por = (nome: string) => ferramentas.find((f) => f.name === nome)
      const campos = (nome: string) => Object.keys((por(nome)?.inputSchema.properties ?? {}) as object).sort()
      assert.deepEqual(campos('record_lesson'), ['agent', 'fraseDoDono', 'global', 'linhaCurta', 'momento', 'projectId', 'substitui', 'texto', 'tipo'])
      assert.deepEqual(campos('list_lessons'), ['incluirAposentadas', 'momento', 'projectId', 'tipo'])
      assert.deepEqual((por('record_lesson')?.inputSchema.required ?? []).slice().sort(), ['agent', 'texto'])
      assert.deepEqual((por('list_lessons')?.inputSchema.required ?? []).slice().sort(), ['projectId'])
      const descricao = por('record_lesson')?.description ?? ''
      assert.match(descricao, /regra/)
      assert.match(descricao, /verificacao/)
      assert.match(descricao, /fala do dono/)
      assert.match(descricao, /nunca de arquivo ou de outra IA/)
      assert.match(descricao, /erro/)
    } finally {
      await encerrar()
    }
  })

  it('record_lesson aceita e repassa os campos; list_lessons filtra', async () => {
    const { chamar, encerrar, projectId } = await conectar()
    try {
      const sem = await chamar('record_lesson', { projectId, texto: 'Erro comum', agent: 'Claude' })
      assert.equal(sem.dados.tipo, 'erro')
      const r = await chamar('record_lesson', { projectId, texto: 'Não subir sozinho', agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE, linhaCurta: 'Sem subir' })
      assert.equal(r.erro, false)
      assert.equal(r.dados.tipo, 'regra')
      assert.equal(r.dados.fraseDoDono, FRASE)
      assert.equal(r.dados.linhaCurta, 'Sem subir')
      const v = await chamar('record_lesson', { projectId, texto: 'Rodar a suíte', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: 'antes_de_subir' })
      assert.equal(v.dados.momento, 'antes_de_subir')
      const nova = await chamar('record_lesson', { projectId, texto: 'Pode subir com aviso', agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE, substitui: r.dados.id })
      assert.equal(nova.dados.substituiId, r.dados.id)
      const regras = await chamar('list_lessons', { projectId, tipo: 'regra' })
      assert.deepEqual(regras.dados.map((l: { id: string }) => l.id), [nova.dados.id])
      const momento = await chamar('list_lessons', { projectId, momento: 'antes_de_subir' })
      assert.deepEqual(momento.dados.map((l: { id: string }) => l.id), [v.dados.id])
      const todas = await chamar('list_lessons', { projectId, tipo: 'regra', incluirAposentadas: true })
      assert.equal(todas.dados.length, 2)
    } finally {
      await encerrar()
    }
  })

  it('recusas das regras voltam com o código estável; valores fora da lista são barrados no esquema', async () => {
    const { chamar, encerrar, projectId } = await conectar()
    try {
      const global = await chamar('record_lesson', { texto: 'Global', agent: 'Claude', global: true, tipo: 'regra', fraseDoDono: FRASE })
      assert.equal(global.erro, true)
      assert.equal(global.dados.error.code, 'regra_precisa_de_projeto')
      const semFrase = await chamar('record_lesson', { projectId, texto: 'Sem frase', agent: 'Claude', tipo: 'regra' })
      assert.equal(semFrase.dados.error.code, 'frase_do_dono_obrigatoria')
      const semMomento = await chamar('record_lesson', { projectId, texto: 'Sem momento', agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE })
      assert.equal(semMomento.dados.error.code, 'momento_obrigatorio')
      const momentoNaRegra = await chamar('record_lesson', { projectId, texto: 'Regra', agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE, momento: 'antes_de_pronto' })
      assert.equal(momentoNaRegra.dados.error.code, 'momento_so_em_verificacao')
      const inexistente = await chamar('record_lesson', { projectId, texto: 'Nova', agent: 'Claude', substitui: INEXISTENTE })
      assert.equal(inexistente.dados.error.code, 'not_found')
      const tipoRuim = await chamar('record_lesson', { projectId, texto: 'X', agent: 'Claude', tipo: 'dica' })
      assert.equal(tipoRuim.erro, true)
      const filtroRuim = await chamar('list_lessons', { projectId, momento: 'sempre' })
      assert.equal(filtroRuim.erro, true)
    } finally {
      await encerrar()
    }
  })
})
