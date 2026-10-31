import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'
import { buscarNaMemoria } from '../server/busca/buscar.ts'
import type { ResultadoDaBusca } from '../server/busca/consultar.ts'
import { bancoMigrado, criarProjeto, P1, P2, semear, uuid, type Semente } from './apoio/busca.ts'

/**
 * Busca na memória (D7) contra um FTS5 de verdade: a consulta nunca vira sintaxe crua, acento e caixa
 * não contam, prefixo e todas as palavras (E), peso por tipo com desempate pelo mais recente, escopo do
 * projeto (lição global em qualquer projeto) e a biblioteca no mesmo índice, pelo mesmo critério.
 */

const bancos: DatabaseSync[] = []
afterEach(() => {
  for (const db of bancos.splice(0)) db.close()
})

const T1 = '2026-10-01T10:00:00.000Z'
const T2 = '2026-10-02T10:00:00.000Z'
const T3 = '2026-10-03T10:00:00.000Z'
const T4 = '2026-10-04T10:00:00.000Z'

function banco(...sementes: Semente[]): DatabaseSync {
  const db = bancoMigrado()
  bancos.push(db)
  criarProjeto(db, P1)
  criarProjeto(db, P2)
  semear(db, ...sementes)
  return db
}

function ids(resultados: ResultadoDaBusca[]): string[] {
  return resultados.map((r) => r.id)
}

function buscar(db: DatabaseSync, query: string, extra: Record<string, unknown> = {}, projeto = P1): ResultadoDaBusca[] {
  return buscarNaMemoria(db, projeto, { query, ...extra })
}

describe('consulta é texto, nunca sintaxe FTS', () => {
  const MSG = uuid(1)
  const base = (): DatabaseSync =>
    banco({ tipo: 'mensagem', id: MSG, projectId: P1, corpo: 'O login e o deploy ficaram prontos.', data: T1 })

  for (const query of ['"login"', 'login*', '-login', '(login', 'login)', '^login', '{login}', 'login🚀deploy', '"login', 'LOGIN:']) {
    it(`${JSON.stringify(query)} acha a mensagem, sem erro`, () => {
      assert.deepEqual(ids(buscar(base(), query)), [MSG])
    })
  }

  for (const query of [
    '"', '""', '*', '-', '(', ')', ':', '^', '🚀', '🚀🔥✅', '', '   ', '\t\n',
    'AND', 'OR', 'NOT', 'NEAR', 'login AND', 'OR deploy', 'NOT login', 'NEAR(login deploy)', 'login OR xyz',
    'titulo:login', 'corpo:login', 'login NEAR/2 deploy', "login'; DROP TABLE messages; --",
  ]) {
    it(`${JSON.stringify(query)} devolve vazio, sem erro`, () => {
      const db = base()
      assert.deepEqual(buscar(db, query), [])
      assert.equal((db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n, 1)
    })
  }
})

describe('acento, caixa, prefixo e todas as palavras', () => {
  it('"decisao", "DECISÃO" e "Decisão" acham "decisão"; "decisão" acha "DECISAO"', () => {
    const db = banco(
      { tipo: 'mensagem', id: uuid(1), projectId: P1, corpo: 'Registrei a decisão do frete.', data: T1 },
      { tipo: 'mensagem', id: uuid(2), projectId: P1, corpo: 'NOVA DECISAO SOBRE O CUPOM', data: T2 },
    )
    for (const query of ['decisao', 'DECISÃO', 'Decisão']) assert.deepEqual(ids(buscar(db, query)), [uuid(2), uuid(1)], query)
    assert.deepEqual(ids(buscar(db, 'decisão cupom')), [uuid(2)])
  })

  it('prefixo: "compact" acha "compactação"; plural acha singular e vice-versa', () => {
    const db = banco(
      { tipo: 'mensagem', id: uuid(1), projectId: P1, corpo: 'Antes da compactação, salvar tudo.', data: T1 },
      { tipo: 'mensagem', id: uuid(2), projectId: P1, corpo: 'Uma mensagem de teste.', data: T2 },
      { tipo: 'mensagem', id: uuid(3), projectId: P1, corpo: 'Duas decisões sobre testes.', data: T3 },
    )
    assert.deepEqual(ids(buscar(db, 'compact')), [uuid(1)])
    assert.deepEqual(ids(buscar(db, 'compactações')), [uuid(1)])
    assert.deepEqual(ids(buscar(db, 'mensagens')), [uuid(2)])
    assert.deepEqual(ids(buscar(db, 'decisão')), [uuid(3)])
    assert.deepEqual(ids(buscar(db, 'testes')), [uuid(3), uuid(2)])
  })

  it('várias palavras: todas precisam aparecer, em qualquer ordem e em qualquer campo', () => {
    const db = banco(
      { tipo: 'cartao', id: uuid(1), projectId: P1, titulo: 'Deploy', corpo: 'Depois do login novo.', data: T1 },
      { tipo: 'cartao', id: uuid(2), projectId: P1, titulo: 'Login', corpo: 'Só o login.', data: T2 },
    )
    assert.deepEqual(ids(buscar(db, 'login deploy')), [uuid(1)])
    assert.deepEqual(ids(buscar(db, 'deploy login')), [uuid(1)])
    assert.deepEqual(ids(buscar(db, 'login')).sort(), [uuid(1), uuid(2)])
  })

  it('termo que não existe: vazio', () => {
    assert.deepEqual(buscar(banco({ tipo: 'mensagem', id: uuid(1), projectId: P1, corpo: 'login', data: T1 }), 'kubernetes'), [])
  })
})

describe('peso por tipo e desempate pelo mais recente', () => {
  // Mesmo texto, sem título, em todas as fontes: o BM25 é igual e só o peso e a data decidem.
  const ITENS: Semente[] = [
    { tipo: 'licao', id: uuid(1), projectId: P1, corpo: 'alfa', data: T1 },
    { tipo: 'decisao', id: uuid(2), projectId: P1, corpo: 'alfa', data: T1, estado: 'accepted' },
    { tipo: 'diretriz', id: uuid(3), projectId: P1, corpo: 'alfa', data: T1 },
    { tipo: 'cartao', id: uuid(4), projectId: P1, corpo: 'alfa', data: T3 },
    { tipo: 'backlog', id: uuid(5), projectId: P1, corpo: 'alfa', data: T2 },
    { tipo: 'bloqueio', id: uuid(6), projectId: P1, corpo: 'alfa', data: T4 },
    { tipo: 'decisao', id: uuid(7), projectId: P1, corpo: 'alfa', data: T1, estado: 'proposed' },
    { tipo: 'checkpoint', id: uuid(8), projectId: P1, corpo: 'alfa', data: T1 },
    { tipo: 'checkpoint', id: uuid(9), projectId: P1, corpo: 'alfa', data: T2, estado: 'compactacao' },
    { tipo: 'mensagem', id: uuid(10), projectId: P1, corpo: 'alfa', data: T1 },
    { tipo: 'decisao', id: uuid(11), projectId: P1, corpo: 'alfa', data: T2, estado: 'revoked' },
    { tipo: 'decisao', id: uuid(12), projectId: P1, corpo: 'alfa', data: T1, estado: 'superseded' },
    { tipo: 'licao', id: uuid(13), projectId: P1, corpo: 'alfa', data: T3, estado: 'aposentada' },
    { tipo: 'biblioteca', id: uuid(14), projectId: P1, corpo: 'alfa', data: T1 },
    { tipo: 'biblioteca', id: uuid(15), projectId: P1, corpo: 'alfa', data: T2, estado: 'archived' },
  ]
  const ENCHIMENTO: Semente[] = Array.from({ length: 20 }, (_, i) => ({
    tipo: 'mensagem' as const, id: uuid(100 + i), projectId: P1, corpo: 'outro assunto', data: T1,
  }))

  it('lição > decisão aceita > diretriz > neutros > checkpoint > mensagem > encerrados; empate: mais recente', () => {
    const r = buscar(banco(...ITENS, ...ENCHIMENTO), 'alfa', { limit: 50 })
    assert.deepEqual(ids(r), [1, 2, 3, 6, 4, 5, 7, 14, 9, 8, 10, 13, 11, 15, 12].map(uuid))
    assert.deepEqual(r.map((x) => x.tipo), [
      'licao', 'decisao', 'diretriz', 'bloqueio', 'cartao', 'backlog', 'decisao', 'biblioteca', 'checkpoint', 'checkpoint',
      'mensagem', 'licao', 'decisao', 'biblioteca', 'decisao',
    ])
  })

  it('a pontuação é BM25 vezes o peso: as razões batem com a tabela do D7', () => {
    const r = new Map(buscar(banco(...ITENS, ...ENCHIMENTO), 'alfa', { limit: 50 }).map((x) => [x.id, x.pontuacao]))
    const base = r.get(uuid(4)) as number
    assert.ok(base > 0)
    for (const [n, peso] of [[1, 1.5], [2, 1.4], [3, 1.3], [5, 1], [6, 1], [7, 1], [14, 1], [8, 0.9], [10, 0.8], [11, 0.5], [15, 0.5]] as const) {
      assert.ok(Math.abs((r.get(uuid(n)) as number) / base - peso) < 0.002, `${n}: ${r.get(uuid(n))} / ${base}`)
    }
    // Salvamento de compactação pesa como checkpoint; lição aposentada, como decisão revogada.
    assert.equal(r.get(uuid(9)), r.get(uuid(8)))
    assert.equal(r.get(uuid(13)), r.get(uuid(11)))
    assert.equal(r.get(uuid(12)), r.get(uuid(11)))
  })

  it('empate na pontuação e na data: a ordem é estável (a primeira gravada primeiro)', () => {
    const db = banco(
      { tipo: 'mensagem', id: uuid(2), projectId: P1, corpo: 'beta', data: T1 },
      { tipo: 'mensagem', id: uuid(1), projectId: P1, corpo: 'beta', data: T1 },
      { tipo: 'mensagem', id: uuid(3), projectId: P1, corpo: 'beta', data: T2 },
    )
    assert.deepEqual(ids(buscar(db, 'beta')), [uuid(3), uuid(2), uuid(1)])
  })
})

describe('escopo, tipos e limite', () => {
  it('só o projeto pedido; lição global aparece em qualquer projeto', () => {
    const db = banco(
      { tipo: 'licao', id: uuid(1), projectId: null, corpo: 'Stryker pelo binário local', data: T1 },
      { tipo: 'licao', id: uuid(2), projectId: P1, corpo: 'Stryker no projeto um', data: T2 },
      { tipo: 'mensagem', id: uuid(3), projectId: P2, corpo: 'Stryker no projeto dois', data: T3 },
    )
    assert.deepEqual(ids(buscar(db, 'stryker')), [uuid(2), uuid(1)])
    assert.deepEqual(ids(buscar(db, 'stryker', {}, P2)), [uuid(1), uuid(3)])
  })

  it('tipos filtra; limit corta depois de ordenar', () => {
    const db = banco(
      { tipo: 'licao', id: uuid(1), projectId: P1, corpo: 'gama', data: T1 },
      { tipo: 'mensagem', id: uuid(2), projectId: P1, corpo: 'gama', data: T1 },
      { tipo: 'cartao', id: uuid(3), projectId: P1, corpo: 'gama', data: T1 },
      { tipo: 'biblioteca', id: uuid(4), projectId: P1, titulo: 'Guia', corpo: 'gama', data: T1 },
    )
    assert.deepEqual(ids(buscar(db, 'gama', { tipos: ['mensagem', 'cartao'] })), [uuid(3), uuid(2)])
    assert.deepEqual(ids(buscar(db, 'gama', { tipos: ['biblioteca'] })), [uuid(4)])
    assert.deepEqual(ids(buscar(db, 'gama', { tipos: ['licao', 'cartao'], limit: 1 })), [uuid(1)])
    assert.equal(buscar(db, 'gama', { limit: 3 }).length, 3)
    assert.equal(buscar(db, 'gama').length, 4)
  })
})

describe('biblioteca: no mesmo índice da memória, pelo mesmo critério', () => {
  function comBiblioteca(): DatabaseSync {
    return banco(
      { tipo: 'biblioteca', id: uuid(1), projectId: P1, titulo: 'Guia do checkout', corpo: 'Passo a passo do pagamento.', data: T2 },
      { tipo: 'biblioteca', id: uuid(2), projectId: P1, titulo: 'Checkout antigo', corpo: 'Arquivado.', data: T3, estado: 'archived' },
      { tipo: 'biblioteca', id: uuid(3), projectId: P2, titulo: 'Checkout do outro', corpo: 'Outro projeto.', data: T3 },
      { tipo: 'mensagem', id: uuid(4), projectId: P1, corpo: 'O checkout ficou pronto.', data: T1 },
      ...Array.from({ length: 6 }, (_, i) => ({
        tipo: 'biblioteca' as const, id: uuid(10 + i), projectId: P1, titulo: `Nota ${i}`, corpo: 'Outro assunto.', data: T1,
      })),
    )
  }

  it('acha o conteúdo do projeto, com título, data e trecho; arquivado vem com metade do peso; de outro projeto fica de fora', () => {
    const r = buscar(comBiblioteca(), 'checkout')
    assert.deepEqual(ids(r).sort(), [uuid(1), uuid(2), uuid(4)])
    const guia = r.find((x) => x.id === uuid(1)) as ResultadoDaBusca
    assert.deepEqual(Object.keys(guia), ['tipo', 'id', 'titulo', 'data', 'trecho', 'pontuacao'])
    assert.equal(guia.tipo, 'biblioteca')
    assert.equal(guia.titulo, 'Guia do checkout')
    assert.equal(guia.data, T2)
    assert.equal(guia.trecho, 'Guia do checkout — Passo a passo do pagamento.')
    assert.ok(guia.pontuacao > 0)
  })

  it('o mesmo texto arquivado pontua a metade do ativo', () => {
    const r = buscar(
      banco(
        { tipo: 'biblioteca', id: uuid(1), projectId: P1, titulo: 'Guia', corpo: 'delta', data: T1 },
        { tipo: 'biblioteca', id: uuid(2), projectId: P1, titulo: 'Guia', corpo: 'delta', data: T2, estado: 'archived' },
        { tipo: 'mensagem', id: uuid(3), projectId: P1, corpo: 'outro assunto', data: T1 },
      ),
      'delta',
    )
    assert.deepEqual(ids(r), [uuid(1), uuid(2)])
    assert.ok(Math.abs(r[1].pontuacao / r[0].pontuacao - 0.5) < 0.002, `${r[1].pontuacao} / ${r[0].pontuacao}`)
  })

  it('poucos documentos: a biblioteca relevante pontua como a diretriz e fica acima do item que só cita o termo', () => {
    const r = buscar(
      banco(
        { tipo: 'diretriz', id: uuid(1), projectId: P1, corpo: 'Loja de bolos com entrega na cidade.', data: T1 },
        { tipo: 'biblioteca', id: uuid(2), projectId: P1, titulo: 'Guia de atendimento', corpo: 'Dúvidas sobre entrega e trocas.', data: T1 },
        {
          tipo: 'mensagem', id: uuid(3), projectId: P1, data: T1,
          corpo: `Resumo da semana: ${'fotos novas, preço revisto, cardápio de festa, '.repeat(8)}e a entrega.`,
        },
      ),
      'entrega',
    )
    const ponto = new Map(r.map((x) => [x.id, x.pontuacao]))
    assert.deepEqual([...ponto.keys()].sort(), [uuid(1), uuid(2), uuid(3)])
    const [diretriz, biblioteca, mensagem] = [1, 2, 3].map((n) => ponto.get(uuid(n)) as number)
    assert.ok(biblioteca >= diretriz / 2, `biblioteca ${biblioteca}, diretriz ${diretriz}`)
    assert.ok(biblioteca > mensagem, `biblioteca ${biblioteca}, mensagem ${mensagem}`)
  })

  it('a pontuação manda, maior primeiro, e o limite vale para o total', () => {
    const r = buscar(comBiblioteca(), 'checkout')
    for (let i = 1; i < r.length; i += 1) assert.ok(r[i - 1].pontuacao >= r[i].pontuacao)
    const primeiro = r[0].id
    assert.deepEqual(ids(buscar(comBiblioteca(), 'checkout', { limit: 1 })), [primeiro])
  })
})

describe('resultado: título curto, data e trecho com o termo', () => {
  it('mensagem longa: título da primeira linha e trecho de até 200 caracteres com o termo', () => {
    const corpo = `Resumo da semana\n${'Texto de contexto sem nada demais. '.repeat(12)}O cupom de frete grátis entrou. ${'Mais contexto depois do ponto. '.repeat(12)}`
    const [r] = buscar(banco({ tipo: 'mensagem', id: uuid(1), projectId: P1, corpo, data: T1 }), 'cupom frete')
    assert.equal(r.titulo, 'Resumo da semana')
    assert.equal(r.data, T1)
    assert.ok(r.trecho.length <= 200, `${r.trecho.length}`)
    assert.match(r.trecho, /^….*O cupom de frete grátis entrou\..*…$/)
  })

  it('checkpoint: título é a frase do dono; termo só no título vem no trecho com o corpo', () => {
    const [r] = buscar(
      banco({ tipo: 'checkpoint', id: uuid(1), projectId: P1, titulo: 'Loja pronta para o Natal', corpo: 'Resumo técnico.', extra: 'Publicar.', data: T1 }),
      'natal',
    )
    assert.equal(r.titulo, 'Loja pronta para o Natal')
    assert.equal(r.trecho, 'Loja pronta para o Natal — Resumo técnico. Publicar.')
  })

  it('lição aposentada: a data é a da aposentadoria', () => {
    const [r] = buscar(banco({ tipo: 'licao', id: uuid(1), projectId: P1, corpo: 'Velha lição', data: T3, estado: 'aposentada' }), 'velha')
    assert.equal(r.data, T3)
    assert.equal(r.titulo, 'Velha lição')
  })
})
