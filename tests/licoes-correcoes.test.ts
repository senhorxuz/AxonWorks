import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../server/mcp-tools.ts'
import { aposentarLicao, ensureLicoesSchema, listarLicoes, registrarLicao } from '../server/store/licoes.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'

test('o dono pode repetir uma regra ativa que foi para a lixeira', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Regras', objective: 'Guardar regras do dono' })
  const regra = { tipo: 'regra', texto: 'Sempre confira o relatório.', fraseDoDono: 'Sempre confira o relatório.', agent: 'Codex' } as const
  const original = store.registrarLicao(id, regra)
  store.excluir(id, { tipo: 'licao', id: original.id, agent: 'Codex', origem: 'mcp', pedidoDoDono: 'Exclua a regra.' })

  const nova = store.registrarLicao(id, regra)
  assert.notEqual(nova.id, original.id)
  assert.deepEqual(store.listarLicoes(id), [nova])
  assert.deepEqual(store.registrarLicao(id, regra), nova)
})

test('recusa substituir ou aposentar uma lição na lixeira, mesmo que já esteja aposentada', t => {
  const store = new WorkspaceStore(':memory:')
  t.after(() => store.close())
  const { id } = store.createProject({ name: 'Regras', objective: 'Guardar regras do dono' })
  const outro = store.createProject({ name: 'Outro projeto', objective: 'Guardar suas próprias lições' }).id
  for (const aposentada of [false, true]) {
    const licao = store.registrarLicao(id, { texto: `Erro ${aposentada}`, agent: 'Codex' })
    const aposentar = () => store.aposentarLicao(licao.id, { agent: 'Codex', motivo: 'Obsoleto.' })
    const estado = aposentada ? aposentar() : licao
    assert.deepEqual(store.getLicaoParaEscrita(id, licao.id), estado)
    store.excluir(id, { tipo: 'licao', id: licao.id, agent: 'Codex', origem: 'mcp', pedidoDoDono: 'Exclua o erro.' })
    assert.throws(() => store.getLicaoParaEscrita(id, licao.id), { status: 409, code: 'ja_na_lixeira' })
    assert.throws(() => store.getLicaoParaEscrita(outro, licao.id), {
      status: 404, code: 'not_found', message: 'Lição não encontrada neste projeto.',
    })
    assert.throws(() => store.registrarLicao(id, { texto: 'Erro corrigido.', agent: 'Codex', substitui: licao.id }),
      { status: 409, code: 'ja_na_lixeira' })
    assert.throws(aposentar, { status: 409, code: 'ja_na_lixeira' })
  }
  assert.deepEqual(store.listarLicoes(id, { incluirAposentadas: true }), [])
})
/**
 * Correções da revisão da frente A: `substitui` não é engolido pela deduplicação, o momento entra na chave
 * da verificação, a linha curta é uma linha só, e regra ou verificação só mudam com o pedido do dono.
 */

const bancos: DatabaseSync[] = []
const stores: WorkspaceStore[] = []

afterEach(() => {
  for (const db of bancos.splice(0)) db.close()
  for (const store of stores.splice(0)) store.close()
})

const P1 = '11111111-1111-4111-8111-111111111111'
const T1 = '2026-11-19T10:00:00.000Z'
const T2 = '2026-11-19T11:00:00.000Z'
const T3 = '2026-11-19T12:00:00.000Z'
const FRASE = 'Nunca suba sem eu mandar.'

function banco(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  bancos.push(db)
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)')
  db.exec(`INSERT INTO projects (id) VALUES ('${P1}')`)
  ensureLicoesSchema(db)
  return db
}

function recusa(fn: () => unknown, status: number, code: string, message?: string | RegExp): void {
  assert.throws(fn, (erro: unknown) => {
    assert.ok(erro instanceof DomainError, `esperado DomainError, recebido ${String(erro)}`)
    assert.equal(erro.status, status)
    assert.equal(erro.code, code)
    if (typeof message === 'string') assert.equal(erro.message, message)
    if (message instanceof RegExp) assert.match(erro.message, message)
    return true
  })
}

function regra(db: DatabaseSync, texto: string, extra: Record<string, unknown> = {}, ts = T1) {
  return registrarLicao(db, P1, { texto, agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE, ...extra }, ts)
}

function verificacao(db: DatabaseSync, texto: string, momento: string, extra: Record<string, unknown> = {}, ts = T1) {
  return registrarLicao(db, P1, { texto, agent: 'Claude', tipo: 'verificacao', fraseDoDono: FRASE, momento: momento as never, ...extra }, ts)
}

function contar(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM licoes').get() as { n: number }).n
}

describe('substitui com o mesmo texto: a deduplicação não engole a correção', () => {
  it('corrigir só a frase do dono: grava a versão nova e aposenta a antiga', () => {
    const db = banco()
    const antiga = regra(db, 'Nunca subir sem OK.', { fraseDoDono: 'frase 1' })
    const id = '33333333-3333-4333-8333-333333333333'
    const nova = registrarLicao(
      db,
      P1,
      { texto: 'nunca subir sem ok.', agent: 'Claude', tipo: 'regra', fraseDoDono: 'frase 2 corrigida', substitui: antiga.id },
      T2,
      id,
    )
    assert.equal(nova.id, id)
    assert.equal(nova.fraseDoDono, 'frase 2 corrigida')
    assert.equal(nova.substituiId, antiga.id)
    const todas = listarLicoes(db, P1, { incluirAposentadas: true })
    assert.deepEqual(todas.map((l) => l.id), [antiga.id, id])
    assert.equal(todas[0].aposentadaEm, T2)
    assert.equal(todas[0].motivoAposentadoria, `substituída por ${id}`)
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [id])
  })

  it('corrigir só a linha curta, com o mesmo texto, também grava e aposenta', () => {
    const db = banco()
    const antiga = regra(db, 'Subir só com OK', { linhaCurta: 'curta antiga' })
    const nova = regra(db, 'Subir só com OK', { linhaCurta: 'curta nova', substitui: antiga.id }, T2)
    assert.notEqual(nova.id, antiga.id)
    assert.equal(nova.linhaCurta, 'curta nova')
    assert.equal(listarLicoes(db, P1).length, 1)
    assert.equal(contar(db), 2)
  })

  it('substitui X com texto igual a outra ativa Y: 409 licao_igual_ja_existe, citando Y, sem aposentar X', () => {
    const db = banco()
    const x = regra(db, 'Regra X')
    const y = regra(db, 'Regra Y', {}, T2)
    recusa(
      () => regra(db, 'regra y', { substitui: x.id }, T3),
      409,
      'licao_igual_ja_existe',
      `Já existe uma lição ativa com este texto (${y.id}); aposente-a ou escolha outro texto.`,
    )
    assert.equal(contar(db), 2)
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [x.id, y.id])
  })

  it('o 409 só vale para a mesma chave: texto igual em outro tipo não impede a substituição', () => {
    const db = banco()
    const x = regra(db, 'Regra X')
    registrarLicao(db, P1, { texto: 'Mesmo texto', agent: 'Claude' }, T2)
    const nova = regra(db, 'Mesmo texto', { substitui: x.id }, T3)
    assert.equal(nova.substituiId, x.id)
    assert.equal(listarLicoes(db, P1).length, 2)
  })
})

describe('o momento entra na chave da verificação', () => {
  it('o mesmo texto em momentos diferentes são duas verificações', () => {
    const db = banco()
    const a = verificacao(db, 'Rodar os testes', 'antes_de_commit')
    const b = verificacao(db, 'Rodar os testes', 'antes_de_subir', {}, T2)
    assert.notEqual(a.id, b.id)
    assert.equal(contar(db), 2)
    assert.equal(b.momento, 'antes_de_subir')
  })

  it('o mesmo texto no mesmo momento continua não duplicando', () => {
    const db = banco()
    const a = verificacao(db, 'Rodar os testes', 'antes_de_commit')
    const b = verificacao(db, '  RODAR os testes ', 'antes_de_commit', {}, T2)
    assert.deepEqual(b, a)
    assert.equal(contar(db), 1)
  })

  it('substituir com o mesmo texto e outro momento não esbarra na outra verificação', () => {
    const db = banco()
    const a = verificacao(db, 'Rodar os testes', 'antes_de_commit')
    const b = verificacao(db, 'Rodar os testes', 'antes_de_subir', {}, T2)
    const nova = verificacao(db, 'Rodar os testes', 'antes_de_pronto', { substitui: a.id }, T3)
    assert.equal(nova.substituiId, a.id)
    assert.deepEqual(listarLicoes(db, P1).map((l) => l.id), [b.id, nova.id])
  })
})

describe('linhaCurta é uma linha só', () => {
  for (const [nome, quebra] of [['\\n', '\n'], ['\\r', '\r'], ['\\r\\n', '\r\n']]) {
    it(`recusa ${nome} no meio da linha curta: 400 invalid_input, sem gravar`, () => {
      const db = banco()
      recusa(() => regra(db, 'Regra', { linhaCurta: `primeira${quebra}segunda` }), 400, 'invalid_input', 'Campo linhaCurta inválido.')
      assert.equal(contar(db), 0)
    })
  }

  it('texto e fraseDoDono continuam aceitando quebra de linha', () => {
    const db = banco()
    const r = regra(db, 'Linha um\nlinha dois', { fraseDoDono: 'frase um\r\nfrase dois', linhaCurta: 'uma linha só' })
    assert.equal(r.texto, 'Linha um\nlinha dois')
    assert.equal(r.fraseDoDono, 'frase um\r\nfrase dois')
  })
})

describe('regra só muda com o dono: substituir', () => {
  it('regra não é substituída por erro nem por verificação: 400 tipo_diferente_na_substituicao', () => {
    const db = banco()
    const r = regra(db, 'Regra do dono')
    const mensagem = 'Regra e verificação só são substituídas por uma lição do mesmo tipo, com a frase do dono.'
    recusa(() => registrarLicao(db, P1, { texto: 'Erro novo', agent: 'Claude', substitui: r.id }, T2), 400, 'tipo_diferente_na_substituicao', mensagem)
    recusa(() => verificacao(db, 'Verificação nova', 'antes_de_pronto', { substitui: r.id }, T2), 400, 'tipo_diferente_na_substituicao')
    assert.equal(contar(db), 1)
    assert.equal(listarLicoes(db, P1)[0].aposentadaEm, null)
  })

  it('verificação não é substituída por erro nem por regra', () => {
    const db = banco()
    const v = verificacao(db, 'Rodar os testes', 'antes_de_commit')
    recusa(() => registrarLicao(db, P1, { texto: 'Erro novo', agent: 'Claude', substitui: v.id }, T2), 400, 'tipo_diferente_na_substituicao')
    recusa(() => regra(db, 'Regra nova', { substitui: v.id }, T2), 400, 'tipo_diferente_na_substituicao')
    assert.equal(contar(db), 1)
  })

  it('regra substitui regra, verificação substitui verificação, e erro pode ser trocado por regra', () => {
    const db = banco()
    const r = regra(db, 'Regra antiga')
    const r2 = regra(db, 'Regra nova', { substitui: r.id }, T2)
    assert.equal(r2.substituiId, r.id)
    const v = verificacao(db, 'Verificação antiga', 'antes_de_commit', {}, T2)
    const v2 = verificacao(db, 'Verificação nova', 'antes_de_commit', { substitui: v.id }, T3)
    assert.equal(v2.substituiId, v.id)
    const erro = registrarLicao(db, P1, { texto: 'Erro velho', agent: 'Claude' }, T1)
    const r3 = regra(db, 'Virou regra', { substitui: erro.id }, T3)
    assert.equal(r3.substituiId, erro.id)
  })

  it('a recusa por tipo vem depois de a lição existir, estar ativa e ser do escopo (404 vem antes)', () => {
    const db = banco()
    recusa(() => regra(db, 'Nova', { substitui: '99999999-9999-4999-8999-999999999999' }), 404, 'not_found')
  })
})

describe('regra só muda com o dono: aposentar', () => {
  it('regra sem pedidoDoDono: 400 pedido_do_dono_obrigatorio, e a regra continua ativa', () => {
    const db = banco()
    const r = regra(db, 'Regra do dono')
    recusa(
      () => aposentarLicao(db, r.id, { agent: 'Claude', motivo: 'Achei velha' }, T2),
      400,
      'pedido_do_dono_obrigatorio',
      'Regra e verificação só se aposentam a pedido do dono: informe pedidoDoDono, com as palavras dele.',
    )
    assert.equal(listarLicoes(db, P1)[0].aposentadaEm, null)
  })

  it('verificação sem pedidoDoDono: 400 pedido_do_dono_obrigatorio', () => {
    const db = banco()
    const v = verificacao(db, 'Rodar os testes', 'antes_de_commit')
    recusa(() => aposentarLicao(db, v.id, { agent: 'Claude', motivo: 'x' }, T2), 400, 'pedido_do_dono_obrigatorio')
  })

  it('com o pedido, aposenta e guarda o pedido no motivo', () => {
    const db = banco()
    const r = regra(db, 'Regra do dono')
    const aposentada = aposentarLicao(db, r.id, { agent: 'Claude', motivo: 'Não vale mais', pedidoDoDono: '  pode largar essa regra  ' }, T2)
    assert.equal(aposentada.aposentadaEm, T2)
    assert.equal(aposentada.motivoAposentadoria, 'Não vale mais (pedido do dono: "pode largar essa regra")')
    assert.equal(listarLicoes(db, P1, { incluirAposentadas: true })[0].motivoAposentadoria, aposentada.motivoAposentadoria)
  })

  it('erro continua como hoje: sem pedido, o motivo fica como veio', () => {
    const db = banco()
    const e = registrarLicao(db, P1, { texto: 'Um erro', agent: 'Claude' }, T1)
    assert.equal(aposentarLicao(db, e.id, { agent: 'Claude', motivo: 'Resolvido' }, T2).motivoAposentadoria, 'Resolvido')
  })

  it('erro com pedido: o pedido também fica no motivo', () => {
    const db = banco()
    const e = registrarLicao(db, P1, { texto: 'Um erro', agent: 'Claude' }, T1)
    const aposentada = aposentarLicao(db, e.id, { agent: 'Claude', motivo: 'Resolvido', pedidoDoDono: 'pode tirar' }, T2)
    assert.equal(aposentada.motivoAposentadoria, 'Resolvido (pedido do dono: "pode tirar")')
  })

  it('pedidoDoDono vazio ou com mais de 500 caracteres: 400 invalid_input; 500 passa', () => {
    const db = banco()
    const r = regra(db, 'Regra do dono')
    for (const pedido of ['', '   ', 'a'.repeat(501), 7]) {
      recusa(
        () => aposentarLicao(db, r.id, { agent: 'Claude', motivo: 'x', pedidoDoDono: pedido as string }, T2),
        400,
        'invalid_input',
        'Campo pedidoDoDono inválido.',
      )
    }
    assert.equal(listarLicoes(db, P1)[0].aposentadaEm, null)
    assert.equal(aposentarLicao(db, r.id, { agent: 'Claude', motivo: 'x', pedidoDoDono: 'a'.repeat(500) }, T2).aposentadaEm, T2)
  })

  it('já aposentada: 409 lesson_already_retired vem antes de pedir o pedido', () => {
    const db = banco()
    const r = regra(db, 'Regra do dono')
    aposentarLicao(db, r.id, { agent: 'Claude', motivo: 'x', pedidoDoDono: 'pode' }, T2)
    recusa(() => aposentarLicao(db, r.id, { agent: 'Claude', motivo: 'y' }, T3), 409, 'lesson_already_retired')
  })
})

describe('as ferramentas do MCP', () => {
  async function conectar() {
    const store = new WorkspaceStore(':memory:')
    stores.push(store)
    const projectId = store.createProject({ name: 'Nata', objective: 'Vender cursos' }).id
    const server = createMcpServer(store)
    const client = new Client({ name: 'licoes-correcoes-test', version: '1.0.0' })
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

  it('retire_lesson recebe pedidoDoDono (opcional) e o descreve em afirmações', async () => {
    const { client, encerrar } = await conectar()
    try {
      const ferramenta = (await client.listTools()).tools.find((f) => f.name === 'retire_lesson')
      assert.deepEqual(Object.keys((ferramenta?.inputSchema.properties ?? {}) as object).sort(), ['agent', 'lessonId', 'motivo', 'pedidoDoDono'])
      assert.deepEqual((ferramenta?.inputSchema.required ?? []).slice().sort(), ['agent', 'lessonId', 'motivo'])
      const descricao = ferramenta?.description ?? ''
      assert.match(descricao, /pedidoDoDono/)
      assert.match(descricao, /regra e a verificacao só se aposentam a pedido do dono/)
      assert.match(descricao, /1 a 500 caracteres/)
      assert.match(descricao, /erro/)
    } finally {
      await encerrar()
    }
  })

  it('record_lesson descreve a substituição, a linha curta e a recusa de texto igual', async () => {
    const { client, encerrar } = await conectar()
    try {
      const descricao = (await client.listTools()).tools.find((f) => f.name === 'record_lesson')?.description ?? ''
      assert.match(descricao, /regra e a verificacao só são substituídas por uma lição do mesmo tipo/)
      assert.match(descricao, /linhaCurta é uma linha só/)
      assert.match(descricao, /momento/)
      assert.match(descricao, /licao_igual_ja_existe/)
    } finally {
      await encerrar()
    }
  })

  it('aposentar regra pelo MCP: sem pedido recusa com o código; com pedido guarda no motivo', async () => {
    const { chamar, encerrar, projectId } = await conectar()
    try {
      const r = await chamar('record_lesson', { projectId, texto: 'Não subir sozinho', agent: 'Claude', tipo: 'regra', fraseDoDono: FRASE })
      const sem = await chamar('retire_lesson', { lessonId: r.dados.id, agent: 'Claude', motivo: 'velha' })
      assert.equal(sem.erro, true)
      assert.equal(sem.dados.error.code, 'pedido_do_dono_obrigatorio')
      const com = await chamar('retire_lesson', { lessonId: r.dados.id, agent: 'Claude', motivo: 'velha', pedidoDoDono: 'pode largar' })
      assert.equal(com.erro, false)
      assert.equal(com.dados.motivoAposentadoria, 'velha (pedido do dono: "pode largar")')
    } finally {
      await encerrar()
    }
  })

  it('record_lesson pelo MCP: a quebra na linha curta e o texto igual recusam com o código estável', async () => {
    const { chamar, encerrar, projectId } = await conectar()
    try {
      const quebra = await chamar('record_lesson', { projectId, texto: 'Erro', agent: 'Claude', linhaCurta: 'a\nb' })
      assert.equal(quebra.erro, true)
      assert.equal(quebra.dados.error.code, 'invalid_input')
      const x = await chamar('record_lesson', { projectId, texto: 'Erro X', agent: 'Claude' })
      await chamar('record_lesson', { projectId, texto: 'Erro Y', agent: 'Claude' })
      const igual = await chamar('record_lesson', { projectId, texto: 'erro y', agent: 'Claude', substitui: x.dados.id })
      assert.equal(igual.dados.error.code, 'licao_igual_ja_existe')
    } finally {
      await encerrar()
    }
  })
})
