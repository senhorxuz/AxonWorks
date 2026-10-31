import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { buscarNaMemoria } from '../server/busca/buscar.ts'
import { bancoMigrado, criarProjeto, P1, P2, semear, uuid, type TipoSemente } from './apoio/busca.ts'

/**
 * Desempenho da busca na memória (D7), num arquivo à parte: a mutação (Stryker) instrumenta o código e
 * o deixa várias vezes mais lento, então este teste não entra na fatia de mutação, só no `npm test`.
 * O comportamento é conferido em `busca-buscar.test.ts` e `busca-casos.test.ts`.
 */

const PALAVRAS = (
  'projeto loja checkout pagamento cliente decisão compactação servidor banco índice busca memória lição ' +
  'cartão quadro mensagem bloqueio diretriz retomada sessão entrega frete cupom pedido produto estoque'
).split(' ')

/** Texto de `n` palavras sorteadas com semente fixa (o mesmo em toda rodada), mais o número do item. */
function texto(k: number, n: number): string {
  let semente = k
  return (
    Array.from({ length: n }, () => {
      semente = (Math.imul(semente, 1_103_515_245) + 12_345) >>> 0
      return PALAVRAS[(semente >>> 16) % PALAVRAS.length]
    }).join(' ') + ` número ${k}`
  )
}

const FATIAS: Array<[TipoSemente, number]> = [
  ['mensagem', 2000],
  ['cartao', 2000],
  ['checkpoint', 2000],
  ['backlog', 1500],
  ['decisao', 1000],
  ['bloqueio', 500],
  ['licao', 500],
  ['biblioteca', 500],
]

const pasta = mkdtempSync(path.join(tmpdir(), 'axon-busca-desempenho-'))
const db = bancoMigrado(path.join(pasta, 'busca.sqlite'))
after(() => {
  db.close()
  rmSync(pasta, { recursive: true, force: true })
})

function mediana(valores: number[]): number {
  const ordem = [...valores].sort((a, b) => a - b)
  return ordem[Math.floor(ordem.length / 2)]
}

describe('busca na memória: desempenho', () => {
  it('10 mil itens indexados: cada consulta em menos de 50 ms', () => {
    criarProjeto(db, P1)
    criarProjeto(db, P2)
    let k = 0
    db.exec('BEGIN')
    for (const [tipo, quantos] of FATIAS) {
      for (let i = 0; i < quantos; i += 1) {
        k += 1
        const data = new Date(Date.UTC(2026, 0, 1) + k * 60_000).toISOString()
        semear(db, { tipo, id: uuid(k), projectId: k % 10 === 0 ? P2 : P1, titulo: `Item ${k}`, corpo: texto(k, 40), data })
      }
    }
    db.exec('COMMIT')
    assert.equal((db.prepare('SELECT count(*) AS n FROM memoria_itens').get() as { n: number }).n, 10_000)

    // Medido em 25/10/2026 nesta máquina: ~10 ms quando o termo está em milhares de itens (o BM25 é
    // calculado para todas as linhas achadas) e ~2 ms para um termo raro; folga de quatro vezes ou mais
    // até o teto de 50 ms do desenho. A mediana de 5 rodadas, depois de uma de aquecimento, tira o
    // ruído da máquina ocupada.
    for (const consulta of ['projeto', 'checkout pagamento', 'decisao compact', 'numero 9999', 'cliente pedido frete']) {
      buscarNaMemoria(db, P1, { query: consulta })
      const tempos = Array.from({ length: 5 }, () => {
        const inicio = performance.now()
        const resultados = buscarNaMemoria(db, P1, { query: consulta })
        const ms = performance.now() - inicio
        assert.ok(resultados.length > 0, consulta)
        return ms
      })
      assert.ok(mediana(tempos) < 50, `${consulta}: ${tempos.map((t) => t.toFixed(1)).join(', ')} ms`)
    }
  })
})
