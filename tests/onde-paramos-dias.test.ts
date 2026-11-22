process.env.TZ = 'UTC'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ItemFeito } from '../shared/carta.ts'
import { tecer } from '../src/fio/tecer.ts'
import { coisasDaCarta } from '../src/fio/coisas.ts'
import { diasDoFeito } from '../src/onde-paramos/dias.ts'

type Item = ItemFeito & { quem?: string; peloDono?: true }

let contador = 0
function item(quando: string, extra: Partial<Item> = {}): Item {
  contador += 1
  return { origem: 'registro', id: `i${contador}`, texto: `Texto ${contador}`, quando, ...extra }
}
const carta = (feitoRecente: Item[], feitoPorMes: { mes: string; itens: Item[] }[] = []) => ({ feitoRecente, feitoPorMes })

describe('diasDoFeito: o desempate é o mesmo do fio', () => {
  it('duas tarefas no mesmo instante: o "Onde paramos" da lista é o ◉ do fio (a última recebida)', () => {
    const a = item('2026-11-22T12:00:00.000Z', { origem: 'tarefa', quem: 'Claude' })
    const b = item('2026-11-22T12:00:00.000Z', { origem: 'tarefa', quem: 'Claude' })
    const lista = carta([a, b])
    const fio = tecer(coisasDaCarta(lista).validas, 40)!
    const chaveDoFim = fio.casas.find((c) => c.classe === 'agora')!.coisa!.chave
    assert.equal(diasDoFeito(lista).chaveDeOndeParamos, chaveDoFim)
    assert.equal(chaveDoFim, `tarefa:${b.id}`)
  })

  it('o mesmo vale quando as duas vêm de meses diferentes na ordem recebida', () => {
    const a = item('2026-11-22T12:00:00.000Z', { origem: 'cartao' })
    const b = item('2026-11-22T12:00:00.000Z', { origem: 'cartao' })
    const lista = carta([], [{ mes: '2026-11', itens: [a, b] }])
    const fio = tecer(coisasDaCarta(lista).validas, 40)!
    assert.equal(diasDoFeito(lista).chaveDeOndeParamos, fio.casas.find((c) => c.classe === 'agora')!.coisa!.chave)
  })
})

describe('diasDoFeito: agrupamento', () => {
  it('carta vazia devolve listas vazias e null', () => {
    assert.deepEqual(diasDoFeito(carta([])), { recentes: [], meses: [], diaAberto: null, chaveDeOndeParamos: null })
  })

  it('agrupa por dia no fuso de São Paulo e põe o mais novo primeiro', () => {
    const a = item('2026-11-21T02:00:00.000Z') // 20/11 23h em SP
    const b = item('2026-11-20T15:00:00.000Z') // 20/11
    const c = item('2026-11-22T12:00:00.000Z') // 22/11
    const { recentes } = diasDoFeito(carta([a, b, c]))
    assert.deepEqual(recentes.map((d) => d.dia), ['2026-11-22', '2026-11-20'])
    assert.deepEqual(recentes[1]!.linhas.map((l) => l.chave), [`registro:${a.id}`, `registro:${b.id}`])
  })

  it('a linha carrega chave, quando, tipo, quem, texto e semData falso', () => {
    const a = item('2026-11-20T15:00:00.000Z', { origem: 'tarefa', quem: 'Claude', texto: 'Fiz a tela' })
    const { recentes } = diasDoFeito(carta([a]))
    assert.deepEqual(recentes[0]!.linhas[0], {
      chave: `tarefa:${a.id}`,
      quando: a.quando,
      tipo: 'tarefa',
      quem: 'Claude',
      texto: 'Fiz a tela',
      semData: false,
    })
  })

  it('peloDono só aparece na linha quando verdadeiro', () => {
    const a = item('2026-11-20T15:00:00.000Z', { peloDono: true })
    const b = item('2026-11-20T14:00:00.000Z')
    const linhas = diasDoFeito(carta([a, b])).recentes[0]!.linhas
    assert.equal(linhas[0]!.peloDono, true)
    assert.equal('peloDono' in linhas[1]!, false)
    assert.equal('quem' in linhas[1]!, false)
  })

  it('mesmo instante: registro, depois cartão, depois tarefa (de cima para baixo)', () => {
    const quando = '2026-11-20T15:00:00.000Z'
    const t = item(quando, { origem: 'tarefa' })
    const c = item(quando, { origem: 'cartao' })
    const r = item(quando, { origem: 'registro' })
    const { recentes, chaveDeOndeParamos } = diasDoFeito(carta([t, r, c]))
    assert.deepEqual(recentes[0]!.linhas.map((l) => l.tipo), ['registro', 'cartao', 'tarefa'])
    assert.equal(chaveDeOndeParamos, `registro:${r.id}`)
  })

  it('mesmo instante sem registro: o cartão vence a tarefa', () => {
    const quando = '2026-11-20T15:00:00.000Z'
    const t = item(quando, { origem: 'tarefa' })
    const c = item(quando, { origem: 'cartao' })
    assert.equal(diasDoFeito(carta([t, c])).chaveDeOndeParamos, `cartao:${c.id}`)
  })

  it('repetido (mesma origem e id) entra uma vez só, e o recente vale', () => {
    const a = item('2026-11-20T15:00:00.000Z')
    const copia = { ...a, texto: 'copia' }
    const { recentes, meses } = diasDoFeito(carta([a], [{ mes: '2026-11', itens: [copia] }]))
    assert.equal(recentes[0]!.linhas.length, 1)
    assert.equal(recentes[0]!.linhas[0]!.texto, a.texto)
    assert.deepEqual(meses, [])
  })
})

describe('diasDoFeito: famílias e fecho', () => {
  it('familias na ordem em que aparecem, sem repetir, sem peloDono', () => {
    const a = item('2026-11-20T18:00:00.000Z', { quem: 'Codex 5' })
    const b = item('2026-11-20T17:00:00.000Z', { quem: 'Claude Opus' })
    const c = item('2026-11-20T16:00:00.000Z', { quem: 'claude-code' })
    const d = item('2026-11-20T15:00:00.000Z', { quem: 'Dono', peloDono: true })
    const e = item('2026-11-20T14:00:00.000Z')
    assert.deepEqual(diasDoFeito(carta([e, d, c, b, a])).recentes[0]!.familias, ['Codex', 'Claude', 'Sem nome'])
  })

  it('dia só com itens do dono fica sem famílias', () => {
    const d = item('2026-11-20T15:00:00.000Z', { peloDono: true, quem: 'Dono' })
    assert.deepEqual(diasDoFeito(carta([d])).recentes[0]!.familias, [])
  })

  it('fecho vem da linha mais recente, sem ":" no fim', () => {
    const velho = item('2026-11-20T10:00:00.000Z', { texto: 'Texto velho que não importa aqui' })
    const novo = item('2026-11-20T20:00:00.000Z', { texto: 'Entreguei o painel novo: falta so ajustar o resto' })
    assert.equal(diasDoFeito(carta([velho, novo])).recentes[0]!.fecho, 'Entreguei o painel novo')
  })
})

describe('diasDoFeito: recentes e meses', () => {
  it('dia dividido entre recente e mês aparece inteiro em recentes e sai do mês', () => {
    const r = item('2026-11-20T20:00:00.000Z')
    const m1 = item('2026-11-20T10:00:00.000Z')
    const m2 = item('2026-11-02T10:00:00.000Z')
    const m3 = item('2026-11-02T11:00:00.000Z')
    const { recentes, meses } = diasDoFeito(carta([r], [{ mes: '2026-11', itens: [m1, m3, m2] }]))
    assert.equal(recentes.length, 1)
    assert.deepEqual(recentes[0]!.linhas.map((l) => l.chave), [`registro:${r.id}`, `registro:${m1.id}`])
    assert.equal(meses.length, 1)
    assert.equal(meses[0]!.mes, '2026-11')
    assert.equal(meses[0]!.quantidade, 2)
    assert.deepEqual(meses[0]!.dias.map((d) => d.dia), ['2026-11-02'])
    assert.deepEqual(meses[0]!.dias[0]!.linhas.map((l) => l.chave), [`registro:${m3.id}`, `registro:${m2.id}`])
  })

  it('mês que fica sem nada some', () => {
    const r = item('2026-11-20T20:00:00.000Z')
    const m = item('2026-11-20T10:00:00.000Z')
    const { meses } = diasDoFeito(carta([r], [{ mes: '2026-11', itens: [m] }]))
    assert.deepEqual(meses, [])
  })

  it('meses mantêm a ordem recebida e cada um agrupa os dias, mais novo primeiro', () => {
    const o1 = item('2026-10-30T10:00:00.000Z')
    const o2 = item('2026-10-05T10:00:00.000Z')
    const s1 = item('2026-09-12T10:00:00.000Z')
    const { meses } = diasDoFeito(
      carta([], [
        { mes: '2026-10', itens: [o2, o1] },
        { mes: '2026-09', itens: [s1] },
      ]),
    )
    assert.deepEqual(meses.map((m) => [m.mes, m.quantidade]), [['2026-10', 2], ['2026-09', 1]])
    assert.deepEqual(meses[0]!.dias.map((d) => d.dia), ['2026-10-30', '2026-10-05'])
    assert.equal(meses[0]!.dias[0]!.fecho, o1.texto)
  })

  it('só meses: os dias vão para os meses e recentes fica vazio', () => {
    const m = item('2026-10-05T10:00:00.000Z')
    const { recentes } = diasDoFeito(carta([], [{ mes: '2026-10', itens: [m] }]))
    assert.deepEqual(recentes, [])
  })
})

describe('diasDoFeito: onde paramos', () => {
  it('diaAberto e chaveDeOndeParamos vêm da coisa mais recente, mesmo ela estando num mês', () => {
    const velho = item('2026-10-05T10:00:00.000Z')
    const novo = item('2026-10-30T10:00:00.000Z', { origem: 'tarefa' })
    const r = item('2026-11-20T10:00:00.000Z')
    const base = diasDoFeito(carta([r]))
    assert.equal(base.diaAberto, '2026-11-20')
    assert.equal(base.chaveDeOndeParamos, `registro:${r.id}`)
    const soMeses = diasDoFeito(carta([], [{ mes: '2026-10', itens: [novo, velho] }]))
    assert.equal(soMeses.diaAberto, '2026-10-30')
    assert.equal(soMeses.chaveDeOndeParamos, `tarefa:${novo.id}`)
  })

  it('mês mais novo que o recente (dados fora de ordem) ainda vence', () => {
    const r = item('2026-11-20T10:00:00.000Z')
    const m = item('2026-11-25T10:00:00.000Z')
    const resultado = diasDoFeito(carta([r], [{ mes: '2026-11', itens: [m] }]))
    assert.equal(resultado.diaAberto, '2026-11-25')
    assert.equal(resultado.chaveDeOndeParamos, `registro:${m.id}`)
  })
})

describe('diasDoFeito: data inválida', () => {
  it('vai para o fim, num grupo sem dia, com semData, e nunca é "onde paramos"', () => {
    const ruim = item('quando?')
    const bom = item('2026-11-20T10:00:00.000Z')
    const r = diasDoFeito(carta([ruim, bom]))
    assert.deepEqual(r.recentes.map((d) => d.dia), ['2026-11-20', ''])
    assert.equal(r.recentes[1]!.linhas[0]!.semData, true)
    assert.equal(r.recentes[1]!.fecho, ruim.texto)
    assert.equal(r.diaAberto, '2026-11-20')
    assert.equal(r.chaveDeOndeParamos, `registro:${bom.id}`)
  })

  it('só itens inválidos: diaAberto e chave são null', () => {
    const ruim = item('')
    const r = diasDoFeito(carta([ruim]))
    assert.equal(r.recentes.length, 1)
    assert.equal(r.diaAberto, null)
    assert.equal(r.chaveDeOndeParamos, null)
  })

  it('inválido que veio de um mês também vai para o grupo sem dia e sai do mês', () => {
    const ruim = item('x')
    const m = item('2026-10-05T10:00:00.000Z')
    const r = diasDoFeito(carta([], [{ mes: '2026-10', itens: [ruim, m] }]))
    assert.equal(r.recentes.length, 1)
    assert.equal(r.recentes[0]!.dia, '')
    assert.equal(r.meses[0]!.quantidade, 1)
  })

  it('inválidos mantêm a ordem em que chegaram', () => {
    const a = item('a')
    const b = item('b')
    assert.deepEqual(diasDoFeito(carta([a, b])).recentes[0]!.linhas.map((l) => l.chave), [`registro:${a.id}`, `registro:${b.id}`])
  })
})
