import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { coisasDaCarta, diaDe, diasEntre } from '../src/fio/coisas.ts'
import type { ItemFeito } from '../shared/carta.ts'

type Item = ItemFeito & { quem?: string; peloDono?: true }
const item = (origem: ItemFeito['origem'], id: string, quando: string, extra: Partial<Item> = {}): Item =>
  ({ origem, id, quando, texto: `feito ${origem} ${id}`, ...extra })
const carta = (recente: Item[], meses: Item[][] = []) =>
  ({ feitoRecente: recente, feitoPorMes: meses.map((itens, i) => ({ mes: `2026-0${i + 1}`, itens })) }) as Parameters<typeof coisasDaCarta>[0]

describe('coisasDaCarta', () => {
  it('junta feitoRecente e feitoPorMes, com chave origem:id, em ordem de tempo', () => {
    const { validas, semData } = coisasDaCarta(carta(
      [item('tarefa', '2', '2026-11-20T12:00:00Z')],
      [[item('registro', '1', '2026-11-10T12:00:00Z')], [item('cartao', '9', '2026-11-15T12:00:00Z')]],
    ))
    assert.deepEqual(validas.map(c => c.chave), ['registro:1', 'cartao:9', 'tarefa:2'])
    assert.deepEqual(validas.map(c => c.tipo), ['registro', 'cartao', 'tarefa'])
    assert.equal(validas[0]!.texto, 'feito registro 1')
    assert.equal(validas[0]!.quando, '2026-11-10T12:00:00Z')
    assert.deepEqual(semData, [])
  })

  it('não repete a mesma chave (vale a primeira vista); mesmo id em origens diferentes são duas coisas', () => {
    const { validas } = coisasDaCarta(carta(
      [item('tarefa', '1', '2026-11-20T12:00:00Z', { texto: 'primeira' })],
      [[item('tarefa', '1', '2026-11-20T12:00:00Z', { texto: 'repetida' }), item('cartao', '1', '2026-11-21T12:00:00Z')]],
    ))
    assert.deepEqual(validas.map(c => c.chave), ['tarefa:1', 'cartao:1'])
    assert.equal(validas[0]!.texto, 'primeira')
  })

  it('empate no mesmo instante: tarefa, cartão, registro (e a ordem recebida desempata o resto)', () => {
    const t = '2026-11-20T12:00:00Z'
    const { validas } = coisasDaCarta(carta([
      item('registro', 'r', t), item('cartao', 'c1', t), item('tarefa', 't', t), item('cartao', 'c0', t),
    ]))
    assert.deepEqual(validas.map(c => c.chave), ['tarefa:t', 'cartao:c1', 'cartao:c0', 'registro:r'])
  })

  it('leva quem e peloDono quando vêm, e só quando vêm', () => {
    const { validas } = coisasDaCarta(carta([
      item('registro', '1', '2026-11-01T12:00:00Z', { quem: 'Claude Opus 5.5' }),
      item('cartao', '2', '2026-11-02T12:00:00Z', { peloDono: true }),
      item('tarefa', '3', '2026-11-03T12:00:00Z'),
    ]))
    assert.equal(validas[0]!.quem, 'Claude Opus 5.5')
    assert.equal('peloDono' in validas[0]!, false)
    assert.equal(validas[1]!.peloDono, true)
    assert.equal('quem' in validas[1]!, false)
    assert.equal('quem' in validas[2]!, false)
    assert.equal('peloDono' in validas[2]!, false)
  })

  it('data inválida vai para semData, fora de validas, na ordem recebida', () => {
    const { validas, semData } = coisasDaCarta(carta([
      item('registro', 'a', 'ontem'), item('tarefa', 'b', '2026-11-20T12:00:00Z'), item('cartao', 'c', ''),
    ]))
    assert.deepEqual(validas.map(c => c.chave), ['tarefa:b'])
    assert.deepEqual(semData.map(c => c.chave), ['registro:a', 'cartao:c'])
  })

  it('carta sem nada: listas vazias', () => {
    assert.deepEqual(coisasDaCarta(carta([])), { validas: [], semData: [] })
  })
})

describe('diaDe e diasEntre', () => {
  it('diaDe usa o dia de São Paulo (AAAA-MM-DD)', () => {
    assert.equal(diaDe('2026-11-21T02:30:00Z'), '2026-11-20')
    assert.equal(diaDe('2026-11-21T03:00:00Z'), '2026-11-21')
    assert.equal(diaDe('2026-11-22T02:29:00.000Z'), '2026-11-21')
    assert.equal(diaDe('2026-11-22T03:00:00.000Z'), '2026-11-22')
  })

  it('diaDe devolve vazio para data que não se lê', () => {
    assert.equal(diaDe('ontem'), '')
    assert.equal(diaDe(''), '')
    assert.equal(diaDe('ontem'), '', 'a segunda vez, vinda da memória, também')
  })

  it('diaDe continua certo depois de a memória encher e esvaziar', () => {
    const dia = (n: number) => new Date(Date.UTC(2020, 0, 1, 12) + n * 60_000).toISOString()
    for (let n = 0; n < 5200; n++) assert.equal(diaDe(dia(n)), new Date(Date.UTC(2020, 0, 1, 12) + n * 60_000 - 3 * 3_600_000).toISOString().slice(0, 10))
    assert.equal(diaDe(dia(0)), '2020-01-01')
    assert.equal(diaDe('2026-11-21T02:30:00Z'), '2026-11-20')
  })

  it('diasEntre é a diferença de datas, com sinal e atravessando mês e ano', () => {
    assert.equal(diasEntre('2026-11-01', '2026-11-08'), 7)
    assert.equal(diasEntre('2026-12-30', '2027-01-02'), 3)
    assert.equal(diasEntre('2026-11-08', '2026-11-01'), -7)
    assert.equal(diasEntre('2026-11-01', '2026-11-01'), 0)
  })
})
