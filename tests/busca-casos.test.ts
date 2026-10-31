import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { after, describe, it } from 'node:test'
import { buscarNaMemoria } from '../server/busca/buscar.ts'
import { bancoMigrado, criarProjeto, P1, P2, semear, uuid, type TipoSemente } from './apoio/busca.ts'

/**
 * Precisão da busca (D7): um projeto de loja com itens em todas as fontes e casos em português com a
 * ordem fixa dos 3 primeiros. Os casos e o resultado esperado ficam em `tests/apoio/busca-casos.json`.
 */

interface Item {
  n: number
  tipo: TipoSemente
  projeto: 'P1' | 'P2' | null
  titulo?: string
  corpo: string
  extra?: string
  data: string
  estado?: string
}

interface Caso {
  nome: string
  consulta: string
  esperado: string[]
}

const FIXTURE = JSON.parse(readFileSync(path.join(import.meta.dirname, 'apoio', 'busca-casos.json'), 'utf8')) as {
  itens: Item[]
  casos: Caso[]
}

const PROJETOS = { P1, P2 }
const db: DatabaseSync = bancoMigrado()
criarProjeto(db, P1, 'Loja da Alfa')
criarProjeto(db, P2, 'Outro')
for (const item of FIXTURE.itens) {
  semear(db, {
    tipo: item.tipo,
    id: uuid(item.n),
    projectId: item.projeto === null ? null : PROJETOS[item.projeto],
    titulo: item.titulo,
    corpo: item.corpo,
    extra: item.extra,
    data: item.data,
    estado: item.estado,
  })
}
after(() => db.close())

const NUMERO = new Map(FIXTURE.itens.map((item) => [uuid(item.n), item.n]))

describe('busca na memória: casos de português com resultado fixo', () => {
  it('o conjunto tem casos de acento, prefixo, plural, várias tabelas, peso, escopo e termo inexistente', () => {
    assert.ok(FIXTURE.casos.length >= 12)
  })

  for (const caso of FIXTURE.casos) {
    it(`${caso.nome}: "${caso.consulta}"`, () => {
      const primeiros = buscarNaMemoria(db, P1, { query: caso.consulta, limit: 3 }).map((r) => `${r.tipo}:${NUMERO.get(r.id)}`)
      assert.deepEqual(primeiros, caso.esperado)
    })
  }
})
