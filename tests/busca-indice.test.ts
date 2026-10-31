import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'
import { ensureMemoriaSchema, rebuildMemoriaIndex } from '../server/busca/indice.ts'
import { bancoMigrado, criarProjeto, P1, P2, semear, uuid } from './apoio/busca.ts'

/**
 * Índice da memória (D7): tabela `memoria_itens` (tipo, id de origem, projeto, data, peso) e o FTS5
 * `memoria_fts` (título e corpo), mantidos por gatilhos em cada tabela de origem e reconstruíveis do zero.
 * Banco antigo ganha o índice, com o conteúdo que já tem, na primeira abertura.
 */

const bancos: DatabaseSync[] = []
afterEach(() => {
  for (const db of bancos.splice(0)) db.close()
})

const T1 = '2026-10-01T10:00:00.000Z'
const T2 = '2026-10-02T10:00:00.000Z'
const T3 = '2026-10-03T10:00:00.000Z'

function banco(): DatabaseSync {
  const db = bancoMigrado()
  bancos.push(db)
  criarProjeto(db, P1)
  criarProjeto(db, P2)
  return db
}

interface LinhaDoIndice {
  projectId: string | null
  data: string
  peso: number
  titulo: string
  corpo: string
}

function noIndice(db: DatabaseSync, tipo: string, id: string): LinhaDoIndice | undefined {
  const linha = db
    .prepare(
      `SELECT i.project_id AS projectId, i.data, i.peso, f.titulo, f.corpo
       FROM memoria_itens i JOIN memoria_fts f ON f.rowid = i.id
       WHERE i.tipo = ? AND i.fonte_id = ?`,
    )
    .get(tipo, id) as LinhaDoIndice | undefined
  return linha === undefined ? undefined : { ...linha }
}

function contagem(db: DatabaseSync): { itens: number; fts: number } {
  const itens = (db.prepare('SELECT count(*) AS n FROM memoria_itens').get() as { n: number }).n
  const fts = (db.prepare('SELECT count(*) AS n FROM memoria_fts').get() as { n: number }).n
  return { itens, fts }
}

function nomes(db: DatabaseSync, tipo: 'table' | 'trigger'): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name LIKE 'memoria%' ORDER BY name`).all(tipo) as Array<{
      name: string
    }>
  ).map((linha) => linha.name)
}

const FONTES = ['backlog', 'biblioteca', 'bloqueio', 'cartao', 'checkpoint', 'decisao', 'diretriz', 'licao', 'mensagem']

/** Uma semente de cada fonte, no projeto P1, com o que cada uma indexa. */
function umDeCada(db: DatabaseSync): void {
  semear(
    db,
    { tipo: 'checkpoint', id: uuid(1), projectId: P1, titulo: 'Frase do dono', corpo: 'Resumo técnico', extra: 'Próximo passo', data: T1 },
    { tipo: 'decisao', id: uuid(2), projectId: P1, titulo: 'Decisão do login', corpo: 'Login por e-mail', data: T1 },
    { tipo: 'diretriz', id: uuid(3), projectId: P1, corpo: 'Diretriz do projeto', data: T1 },
    { tipo: 'cartao', id: uuid(4), projectId: P1, titulo: 'Cartão', corpo: 'Descrição do cartão', data: T1 },
    { tipo: 'backlog', id: uuid(5), projectId: P1, titulo: 'Ideia', corpo: 'Descrição da ideia', data: T1 },
    { tipo: 'bloqueio', id: uuid(6), projectId: P1, titulo: 'Travado', corpo: 'Sem acesso', extra: 'Acesso liberado', data: T1 },
    { tipo: 'mensagem', id: uuid(7), projectId: P1, corpo: 'Revisei o checkout', data: T1 },
    { tipo: 'licao', id: uuid(8), projectId: P1, corpo: 'Rodar o Stryker pelo binário local', data: T1 },
    { tipo: 'biblioteca', id: uuid(9), projectId: P1, titulo: 'Guia', corpo: 'Texto do guia', data: T1 },
  )
}

const ESPERADO_DE_CADA: Record<string, LinhaDoIndice> = {
  checkpoint: { projectId: P1, data: T1, peso: 0.9, titulo: 'Frase do dono', corpo: 'Resumo técnico\nPróximo passo' },
  decisao: { projectId: P1, data: T1, peso: 1.4, titulo: 'Decisão do login', corpo: 'Login por e-mail' },
  diretriz: { projectId: P1, data: T1, peso: 1.3, titulo: '', corpo: 'Diretriz do projeto' },
  cartao: { projectId: P1, data: T1, peso: 1, titulo: 'Cartão', corpo: 'Descrição do cartão' },
  backlog: { projectId: P1, data: T1, peso: 1, titulo: 'Ideia', corpo: 'Descrição da ideia' },
  bloqueio: { projectId: P1, data: T1, peso: 1, titulo: 'Travado', corpo: 'Sem acesso\nAcesso liberado' },
  mensagem: { projectId: P1, data: T1, peso: 0.8, titulo: '', corpo: 'Revisei o checkout' },
  licao: { projectId: P1, data: T1, peso: 1.5, titulo: '', corpo: 'Rodar o Stryker pelo binário local' },
  biblioteca: { projectId: P1, data: T1, peso: 1, titulo: 'Guia', corpo: 'Texto do guia' },
}

const ID_DE: Record<string, string> = {
  checkpoint: uuid(1), decisao: uuid(2), diretriz: uuid(3), cartao: uuid(4), backlog: uuid(5), bloqueio: uuid(6), mensagem: uuid(7), licao: uuid(8), biblioteca: uuid(9),
}

function conferirUmDeCada(db: DatabaseSync): void {
  for (const tipo of FONTES) assert.deepEqual(noIndice(db, tipo, ID_DE[tipo]), ESPERADO_DE_CADA[tipo], tipo)
  assert.deepEqual(contagem(db), { itens: 9, fts: 9 })
}

describe('índice da memória: esquema', () => {
  it('banco novo tem as duas tabelas e três gatilhos por fonte, mais o que limpa o texto e o da revisão da biblioteca', () => {
    const db = banco()
    assert.deepEqual(nomes(db, 'table').filter((nome) => !nome.startsWith('memoria_fts_')), ['memoria_fts', 'memoria_itens'])
    const esperados = FONTES.flatMap((tipo) => ['apagar', 'criar', 'editar'].map((acao) => `memoria_v1_${tipo}_${acao}`))
    assert.deepEqual(nomes(db, 'trigger'), [...esperados, 'memoria_v1_itens_apagar', 'memoria_v1_biblioteca_revisar'].sort())
  })

  it('o FTS5 ignora acento e caixa e indexa prefixos de 2 e 3 letras', () => {
    const db = banco()
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'memoria_fts'").get() as { sql: string }).sql
    assert.match(sql, /tokenize = 'unicode61 remove_diacritics 2'/)
    assert.match(sql, /prefix = '2 3'/)
  })
})

describe('índice da memória: gatilhos de criar', () => {
  it('cada fonte entra com projeto, data, peso, título e corpo', () => {
    const db = banco()
    umDeCada(db)
    conferirUmDeCada(db)
  })

  it('checkpoint sem frase do dono: título vazio; salvamento de compactação é checkpoint como outro', () => {
    const db = banco()
    semear(
      db,
      { tipo: 'checkpoint', id: uuid(1), projectId: P1, corpo: 'Resumo', data: T1 },
      { tipo: 'checkpoint', id: uuid(2), projectId: P1, titulo: 'Salvamento', corpo: 'Resumo', data: T2, estado: 'compactacao' },
    )
    assert.deepEqual(noIndice(db, 'checkpoint', uuid(1)), { projectId: P1, data: T1, peso: 0.9, titulo: '', corpo: 'Resumo\n' })
    assert.deepEqual(noIndice(db, 'checkpoint', uuid(2)), { projectId: P1, data: T2, peso: 0.9, titulo: 'Salvamento', corpo: 'Resumo\n' })
  })

  it('decisão: aceita 1,4; proposta 1,0; revogada e substituída 0,5', () => {
    const db = banco()
    const estados = { accepted: 1.4, proposed: 1, revoked: 0.5, superseded: 0.5 }
    Object.keys(estados).forEach((estado, i) => semear(db, { tipo: 'decisao', id: uuid(i + 1), projectId: P1, corpo: estado, data: T1, estado }))
    Object.values(estados).forEach((peso, i) => assert.equal(noIndice(db, 'decisao', uuid(i + 1))?.peso, peso))
  })

  it('bloqueio sem resolução: corpo com o texto e a linha vazia', () => {
    const db = banco()
    semear(db, { tipo: 'bloqueio', id: uuid(1), projectId: P1, titulo: 'T', corpo: 'Sem acesso', data: T1 })
    assert.equal(noIndice(db, 'bloqueio', uuid(1))?.corpo, 'Sem acesso\n')
  })

  it('lição aposentada pesa 0,5 e data na aposentadoria; lição global fica sem projeto', () => {
    const db = banco()
    semear(
      db,
      { tipo: 'licao', id: uuid(1), projectId: P1, corpo: 'Velha', data: T2, estado: 'aposentada' },
      { tipo: 'licao', id: uuid(2), projectId: null, corpo: 'Global', data: T1 },
    )
    assert.deepEqual(noIndice(db, 'licao', uuid(1)), { projectId: P1, data: T2, peso: 0.5, titulo: '', corpo: 'Velha' })
    assert.deepEqual(noIndice(db, 'licao', uuid(2)), { projectId: null, data: T1, peso: 1.5, titulo: '', corpo: 'Global' })
  })

  it('diretriz: só a revisão vigente (a maior) de cada projeto fica no índice', () => {
    const db = banco()
    semear(db, { tipo: 'diretriz', id: uuid(1), projectId: P1, corpo: 'Primeira', data: T1, revisao: 1 })
    semear(db, { tipo: 'diretriz', id: uuid(9), projectId: P2, corpo: 'Outro projeto', data: T1, revisao: 1 })
    semear(db, { tipo: 'diretriz', id: uuid(2), projectId: P1, corpo: 'Segunda', data: T2, revisao: 2 })
    assert.equal(noIndice(db, 'diretriz', uuid(1)), undefined)
    assert.equal(noIndice(db, 'diretriz', uuid(2))?.corpo, 'Segunda')
    // Uma revisão mais antiga que chega depois (importação fora de ordem) não toma o lugar da vigente.
    semear(db, { tipo: 'diretriz', id: uuid(3), projectId: P1, corpo: 'Antiga', data: T3, revisao: 0 })
    assert.equal(noIndice(db, 'diretriz', uuid(3)), undefined)
    assert.equal(noIndice(db, 'diretriz', uuid(2))?.corpo, 'Segunda')
    assert.equal(noIndice(db, 'diretriz', uuid(9))?.corpo, 'Outro projeto')
    assert.deepEqual(contagem(db), { itens: 2, fts: 2 })
  })

  it('gravar a mesma linha de novo (INSERT OR REPLACE) não duplica nem falha', () => {
    const db = banco()
    semear(db, { tipo: 'mensagem', id: uuid(1), projectId: P1, corpo: 'Primeira versão', data: T1 })
    db.prepare(
      `INSERT OR REPLACE INTO messages (id, project_id, from_agent, to_agent, kind, body, created_at)
       VALUES (?, ?, 'claude', 'dono', 'note', 'Segunda versão', ?)`,
    ).run(uuid(1), P1, T2)
    assert.deepEqual(noIndice(db, 'mensagem', uuid(1)), { projectId: P1, data: T2, peso: 0.8, titulo: '', corpo: 'Segunda versão' })
    assert.deepEqual(contagem(db), { itens: 1, fts: 1 })
  })
})

describe('índice da memória: gatilhos de editar', () => {
  it('decisão: título, corpo, situação e data acompanham', () => {
    const db = banco()
    umDeCada(db)
    db.prepare("UPDATE decisions SET title = 'Novo título', body = 'Novo corpo', status = 'revoked', updated_at = ? WHERE id = ?").run(T2, uuid(2))
    assert.deepEqual(noIndice(db, 'decisao', uuid(2)), { projectId: P1, data: T2, peso: 0.5, titulo: 'Novo título', corpo: 'Novo corpo' })
  })

  it('cartão, backlog, bloqueio, mensagem, lição e diretriz acompanham', () => {
    const db = banco()
    umDeCada(db)
    db.prepare("UPDATE board_cards SET title = 'C2', description = 'D2', updated_at = ? WHERE id = ?").run(T2, uuid(4))
    db.prepare("UPDATE backlog_items SET title = 'B2', description = 'E2', updated_at = ? WHERE id = ?").run(T2, uuid(5))
    db.prepare("UPDATE blockers SET title = 'T2', body = 'Corpo 2', resolution = 'Resolvido', updated_at = ? WHERE id = ?").run(T2, uuid(6))
    db.prepare("UPDATE messages SET body = 'Mensagem 2' WHERE id = ?").run(uuid(7))
    db.prepare("UPDATE licoes SET texto = 'Lição 2', aposentada_em = ? WHERE id = ?").run(T3, uuid(8))
    db.prepare("UPDATE charter_revisions SET body = 'Diretriz 2', created_at = ? WHERE id = ?").run(T2, uuid(3))
    assert.deepEqual(noIndice(db, 'cartao', uuid(4)), { projectId: P1, data: T2, peso: 1, titulo: 'C2', corpo: 'D2' })
    assert.deepEqual(noIndice(db, 'backlog', uuid(5)), { projectId: P1, data: T2, peso: 1, titulo: 'B2', corpo: 'E2' })
    assert.deepEqual(noIndice(db, 'bloqueio', uuid(6)), { projectId: P1, data: T2, peso: 1, titulo: 'T2', corpo: 'Corpo 2\nResolvido' })
    assert.deepEqual(noIndice(db, 'mensagem', uuid(7)), { projectId: P1, data: T1, peso: 0.8, titulo: '', corpo: 'Mensagem 2' })
    assert.deepEqual(noIndice(db, 'licao', uuid(8)), { projectId: P1, data: T3, peso: 0.5, titulo: '', corpo: 'Lição 2' })
    assert.deepEqual(noIndice(db, 'diretriz', uuid(3)), { projectId: P1, data: T2, peso: 1.3, titulo: '', corpo: 'Diretriz 2' })
    assert.deepEqual(contagem(db), { itens: 9, fts: 9 })
  })

  it('checkpoint continua imutável e o índice dele não muda', () => {
    const db = banco()
    umDeCada(db)
    assert.throws(() => db.prepare("UPDATE checkpoints SET summary = 'x' WHERE id = ?").run(uuid(1)), /checkpoints are immutable/)
    assert.deepEqual(noIndice(db, 'checkpoint', uuid(1)), ESPERADO_DE_CADA.checkpoint)
  })
})

describe('índice da memória: gatilhos de apagar', () => {
  it('apagar a linha de origem tira o item e o texto do índice, em cada fonte', () => {
    const db = banco()
    umDeCada(db)
    const tabelas: Record<string, string> = {
      checkpoint: 'checkpoints', decisao: 'decisions', diretriz: 'charter_revisions', cartao: 'board_cards',
      backlog: 'backlog_items', bloqueio: 'blockers', mensagem: 'messages', licao: 'licoes', biblioteca: 'content_items',
    }
    FONTES.forEach((tipo, i) => {
      // A biblioteca apaga as revisões antes do item (como o apagar projeto do store): a chave estrangeira pede.
      if (tipo === 'biblioteca') db.prepare('DELETE FROM content_revisions WHERE item_id = ?').run(ID_DE[tipo])
      db.prepare(`DELETE FROM ${tabelas[tipo]} WHERE id = ?`).run(ID_DE[tipo])
      assert.equal(noIndice(db, tipo, ID_DE[tipo]), undefined, tipo)
      assert.deepEqual(contagem(db), { itens: 8 - i, fts: 8 - i }, tipo)
    })
  })
})

describe('índice da memória: biblioteca no mesmo índice', () => {
  /** Uma revisão nova do conteúdo, como o store grava (imutável; o item passa a apontar para ela depois). */
  function revisao(db: DatabaseSync, itemId: string, numero: number, corpo: string, data: string): string {
    const id = `${itemId}-r${numero}`
    db.prepare(
      `INSERT INTO content_revisions (id, item_id, revision, body, format, created_by, created_at, source_kind, declared_validity)
       VALUES (?, ?, ?, ?, 'plain_text', 'claude', ?, 'agent_report', 'current')`,
    ).run(id, itemId, numero, corpo, data)
    return id
  }

  function item(db: DatabaseSync, revisaoVigente: number, versao: number, data: string): void {
    db.prepare(
      `INSERT INTO content_items (id, project_id, title, kind, status, current_revision_id, version, created_at, updated_at)
       VALUES (?, ?, 'Guia', 'note', 'active', ?, ?, ?, ?)`,
    ).run(uuid(1), P1, `${uuid(1)}-r${revisaoVigente}`, versao, T1, data)
  }

  it('criar: o item entra antes da revisão (corpo vazio) e a revisão vigente traz o corpo', () => {
    const db = banco()
    item(db, 1, 0, T1)
    assert.deepEqual(noIndice(db, 'biblioteca', uuid(1)), { projectId: P1, data: T1, peso: 1, titulo: 'Guia', corpo: '' })
    revisao(db, uuid(1), 1, 'Corpo do guia', T1)
    assert.deepEqual(noIndice(db, 'biblioteca', uuid(1)), { projectId: P1, data: T1, peso: 1, titulo: 'Guia', corpo: 'Corpo do guia' })
    assert.deepEqual(contagem(db), { itens: 1, fts: 1 })
  })

  it('importar: o item aponta para a última revisão e as outras, gravadas antes ou depois, não tomam o lugar', () => {
    const db = banco()
    item(db, 2, 2, T2)
    revisao(db, uuid(1), 1, 'Primeira', T1)
    assert.equal(noIndice(db, 'biblioteca', uuid(1))?.corpo, '')
    revisao(db, uuid(1), 2, 'Segunda', T2)
    assert.equal(noIndice(db, 'biblioteca', uuid(1))?.corpo, 'Segunda')
    revisao(db, uuid(1), 3, 'Fora de ordem', T3)
    assert.deepEqual(noIndice(db, 'biblioteca', uuid(1)), { projectId: P1, data: T2, peso: 1, titulo: 'Guia', corpo: 'Segunda' })
    assert.deepEqual(contagem(db), { itens: 1, fts: 1 })
  })

  it('revisar: a revisão nova só vale quando o item passa a apontar para ela; título e data acompanham', () => {
    const db = banco()
    semear(db, { tipo: 'biblioteca', id: uuid(1), projectId: P1, titulo: 'Guia', corpo: 'Primeira', data: T1 })
    const nova = revisao(db, uuid(1), 2, 'Segunda', T2)
    assert.equal(noIndice(db, 'biblioteca', uuid(1))?.corpo, 'Primeira')
    db.prepare("UPDATE content_items SET title = 'Guia 2', current_revision_id = ?, version = 2, updated_at = ? WHERE id = ?").run(nova, T2, uuid(1))
    assert.deepEqual(noIndice(db, 'biblioteca', uuid(1)), { projectId: P1, data: T2, peso: 1, titulo: 'Guia 2', corpo: 'Segunda' })
    assert.deepEqual(contagem(db), { itens: 1, fts: 1 })
  })

  it('arquivar: continua no índice com peso 0,5 e a data do arquivamento; conteúdo já arquivado entra com 0,5', () => {
    const db = banco()
    semear(
      db,
      { tipo: 'biblioteca', id: uuid(1), projectId: P1, titulo: 'Guia', corpo: 'Ativo', data: T1 },
      { tipo: 'biblioteca', id: uuid(2), projectId: P1, titulo: 'Velho', corpo: 'Arquivado', data: T1, estado: 'archived' },
    )
    db.prepare("UPDATE content_items SET status = 'archived', version = 2, updated_at = ? WHERE id = ?").run(T3, uuid(1))
    assert.deepEqual(noIndice(db, 'biblioteca', uuid(1)), { projectId: P1, data: T3, peso: 0.5, titulo: 'Guia', corpo: 'Ativo' })
    assert.deepEqual(noIndice(db, 'biblioteca', uuid(2)), { projectId: P1, data: T1, peso: 0.5, titulo: 'Velho', corpo: 'Arquivado' })
  })

  it('reconstruir: só a revisão vigente de cada conteúdo, com o peso da situação', () => {
    const db = banco()
    semear(db, { tipo: 'biblioteca', id: uuid(1), projectId: P1, titulo: 'Guia', corpo: 'Primeira', data: T1 })
    const nova = revisao(db, uuid(1), 2, 'Segunda', T2)
    db.prepare("UPDATE content_items SET current_revision_id = ?, status = 'archived', updated_at = ? WHERE id = ?").run(nova, T2, uuid(1))
    db.exec('DELETE FROM memoria_itens')
    rebuildMemoriaIndex(db)
    assert.deepEqual(noIndice(db, 'biblioteca', uuid(1)), { projectId: P1, data: T2, peso: 0.5, titulo: 'Guia', corpo: 'Segunda' })
    assert.deepEqual(contagem(db), { itens: 1, fts: 1 })
  })
})

describe('índice da memória: reconstruir', () => {
  it('rebuildMemoriaIndex refaz do zero: o que faltava volta e o que sobrava sai', () => {
    const db = banco()
    umDeCada(db)
    semear(db, { tipo: 'diretriz', id: uuid(30), projectId: P1, corpo: 'Diretriz nova', data: T2, revisao: 2 })
    db.exec("DELETE FROM memoria_itens WHERE tipo IN ('mensagem', 'licao')")
    db.prepare('INSERT INTO memoria_fts (rowid, titulo, corpo) VALUES (999, ?, ?)').run('órfão', 'sem item')
    db.prepare("UPDATE memoria_itens SET peso = 9 WHERE tipo = 'cartao'").run()
    rebuildMemoriaIndex(db)
    for (const tipo of FONTES.filter((t) => t !== 'diretriz')) {
      assert.deepEqual(noIndice(db, tipo, ID_DE[tipo]), ESPERADO_DE_CADA[tipo], tipo)
    }
    assert.equal(noIndice(db, 'diretriz', uuid(3)), undefined)
    assert.equal(noIndice(db, 'diretriz', uuid(30))?.corpo, 'Diretriz nova')
    assert.deepEqual(contagem(db), { itens: 9, fts: 9 })
  })
})

describe('índice da memória: banco antigo e abertura', () => {
  function tirarIndice(db: DatabaseSync): void {
    for (const nome of nomes(db, 'trigger')) db.exec(`DROP TRIGGER ${nome}`)
    db.exec('DROP TABLE memoria_fts; DROP TABLE memoria_itens')
  }

  it('banco sem o índice ganha o índice com o conteúdo que já tinha, na primeira abertura', () => {
    const db = banco()
    umDeCada(db)
    tirarIndice(db)
    assert.deepEqual(nomes(db, 'table'), [])
    assert.deepEqual(nomes(db, 'trigger'), [])
    ensureMemoriaSchema(db)
    conferirUmDeCada(db)
    semear(db, { tipo: 'mensagem', id: uuid(50), projectId: P1, corpo: 'Depois da migração', data: T2 })
    assert.equal(noIndice(db, 'mensagem', uuid(50))?.corpo, 'Depois da migração')
  })

  it('banco com o índice de antes (sem a biblioteca) ganha os gatilhos e a biblioteca que já existia', () => {
    const db = banco()
    umDeCada(db)
    for (const nome of nomes(db, 'trigger').filter((n) => n.includes('_biblioteca_'))) db.exec(`DROP TRIGGER ${nome}`)
    db.exec("DELETE FROM memoria_itens WHERE tipo = 'biblioteca'")
    assert.equal(noIndice(db, 'biblioteca', ID_DE.biblioteca), undefined)
    ensureMemoriaSchema(db)
    conferirUmDeCada(db)
    assert.ok(nomes(db, 'trigger').includes('memoria_v1_biblioteca_revisar'))
    semear(db, { tipo: 'biblioteca', id: uuid(50), projectId: P1, titulo: 'Novo', corpo: 'Depois da migração', data: T2 })
    assert.equal(noIndice(db, 'biblioteca', uuid(50))?.corpo, 'Depois da migração')
  })

  it('abrir de novo não reconstrói (só a primeira abertura faz o trabalho)', () => {
    const db = banco()
    umDeCada(db)
    db.exec("DELETE FROM memoria_itens WHERE tipo = 'mensagem'")
    ensureMemoriaSchema(db)
    assert.equal(noIndice(db, 'mensagem', ID_DE.mensagem), undefined)
  })

  it('falha no meio da criação: nada fica pela metade e o erro aparece', () => {
    const db = new DatabaseSync(':memory:')
    bancos.push(db)
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)')
    assert.throws(() => ensureMemoriaSchema(db), /no such table/)
    assert.deepEqual(nomes(db, 'table'), [])
    assert.deepEqual(nomes(db, 'trigger'), [])
    db.exec('BEGIN')
    db.exec('ROLLBACK')
  })
})
