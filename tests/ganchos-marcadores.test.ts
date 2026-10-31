import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  apagarMarcador,
  gravarMarcador,
  listarMarcadores,
  type MarcadorDeSessao,
} from '../server/ganchos/marcadores.ts'

/** Spec 13.4: o gancho `Stop` só grava um marcador pequeno em arquivo local, nunca no banco. */

const pastas: string[] = []

afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function dirTemporario(): string {
  const raiz = mkdtempSync(join(tmpdir(), 'axon-marcadores-'))
  pastas.push(raiz)
  return join(raiz, 'ganchos', 'sessoes')
}

function marcador(sessionId: string, over: Partial<MarcadorDeSessao> = {}): MarcadorDeSessao {
  return {
    sessionId,
    transcriptPath: `C:\\conversas\\${sessionId}.jsonl`,
    pasta: 'D:\\Projetos\\projeto-exemplo',
    atualizadoEm: '2026-10-25T10:00:00.000Z',
    ...over,
  }
}

const ordenar = (lista: MarcadorDeSessao[]) => [...lista].sort((a, b) => a.sessionId.localeCompare(b.sessionId))

describe('marcadores de sessão', () => {
  it('grava, lista e apaga; o diretório inexistente é criado', () => {
    const dir = dirTemporario()
    assert.equal(existsSync(dir), false)
    gravarMarcador(dir, marcador('s-1'))
    gravarMarcador(dir, marcador('s-2', { pasta: 'D:\\Outra' }))
    assert.deepEqual(ordenar(listarMarcadores(dir)), [marcador('s-1'), marcador('s-2', { pasta: 'D:\\Outra' })])
    assert.deepEqual(readdirSync(dir).sort(), ['s-1.json', 's-2.json'])

    apagarMarcador(dir, 's-1')
    assert.deepEqual(listarMarcadores(dir), [marcador('s-2', { pasta: 'D:\\Outra' })])
  })

  it('gravar de novo a mesma sessão substitui o marcador (sem arquivo temporário sobrando)', () => {
    const dir = dirTemporario()
    gravarMarcador(dir, marcador('s-1'))
    gravarMarcador(dir, marcador('s-1', { atualizadoEm: '2026-10-25T11:00:00.000Z' }))
    assert.deepEqual(listarMarcadores(dir), [marcador('s-1', { atualizadoEm: '2026-10-25T11:00:00.000Z' })])
    assert.deepEqual(readdirSync(dir), ['s-1.json'])
  })

  it('o arquivo guarda só os quatro campos', () => {
    const dir = dirTemporario()
    gravarMarcador(dir, { ...marcador('s-1'), extra: 'não vai' } as MarcadorDeSessao)
    assert.deepEqual(Object.keys(listarMarcadores(dir)[0]!), ['sessionId', 'transcriptPath', 'pasta', 'atualizadoEm'])
  })

  it('diretório inexistente lista vazio e apagar não reclama', () => {
    const dir = dirTemporario()
    assert.deepEqual(listarMarcadores(dir), [])
    apagarMarcador(dir, 's-nunca')
    assert.equal(existsSync(dir), false)
  })

  it('arquivo corrompido, de outro formato ou que não é .json é ignorado na listagem', () => {
    const dir = dirTemporario()
    mkdirSync(dir, { recursive: true })
    gravarMarcador(dir, marcador('s-ok'))
    writeFileSync(join(dir, 'cortado.json'), '{"sessionId": "s-cort')
    writeFileSync(join(dir, 'nulo.json'), 'null')
    writeFileSync(join(dir, 'texto.json'), '"só um texto"')
    writeFileSync(join(dir, 'faltando.json'), JSON.stringify({ sessionId: 's', transcriptPath: 't', pasta: 'p' }))
    writeFileSync(join(dir, 'numero.json'), JSON.stringify({ ...marcador('s-n'), pasta: 3 }))
    writeFileSync(join(dir, 'sessao.json'), JSON.stringify({ ...marcador('s-x'), sessionId: 7 }))
    writeFileSync(join(dir, 'conversa.json'), JSON.stringify({ ...marcador('s-y'), transcriptPath: null }))
    writeFileSync(join(dir, 'hora.json'), JSON.stringify({ ...marcador('s-z'), atualizadoEm: false }))
    writeFileSync(join(dir, 'leia-me.txt'), JSON.stringify(marcador('s-txt')))
    mkdirSync(join(dir, 'pasta.json'))
    assert.deepEqual(listarMarcadores(dir), [marcador('s-ok')])
  })

  it('id de sessão que poderia sair da pasta é recusado ao gravar e ao apagar', () => {
    const dir = dirTemporario()
    for (const ruim of ['../fora', 'a/b', 'a\\b', '', 'x'.repeat(129), 'com espaço', 'ponto.json']) {
      assert.throws(() => gravarMarcador(dir, marcador(ruim)), /sessão inválido/, ruim)
      assert.throws(() => apagarMarcador(dir, ruim), /sessão inválido/, ruim)
    }
    assert.equal(existsSync(dir), false)
    gravarMarcador(dir, marcador('A_b-9'.padEnd(128, 'x')))
    assert.equal(listarMarcadores(dir).length, 1)
  })
})
