import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { distServerReal, fotografarPasta, rodarMontagem } from './apoio/montagem.ts'

/**
 * Montagem de verdade (scripts/montar.mjs) com a pasta de saída trocada: grava numa pasta temporária, troca arquivo
 * por arquivo e não deixa a pasta de trabalho para trás. Nenhum teste aqui toca o `dist-server/` do repositório.
 */

const pastas: string[] = []
const antesNoRepositorio = fotografarPasta(distServerReal)

function pastaNova(): string {
  const pasta = mkdtempSync(path.join(os.tmpdir(), 'axon-montar-'))
  pastas.push(pasta)
  return pasta
}

/** Sobras de uma montagem: pastas "<saida>.novo-<pid>" ao lado da saída. */
function sobras(saida: string): string[] {
  return readdirSync(path.dirname(saida)).filter(nome => nome.startsWith(`${path.basename(saida)}.novo-`))
}

before(() => {
  assert.ok(existsSync(path.join(path.dirname(distServerReal), 'server', 'index.ts')), 'o teste roda dentro do projeto')
})

after(() => {
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('scripts/montar.mjs com a saída trocada', () => {
  it('--saida <pasta> grava ali o servidor, o MCP, os mapas de código e (quando o fonte existe) os ganchos', () => {
    const saida = path.join(pastaNova(), 'montado')
    const r = rodarMontagem(['--saida', saida])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^Montado: /)
    for (const nome of ['index.mjs', 'index.mjs.map', 'mcp.mjs', 'mcp.mjs.map']) {
      assert.ok(existsSync(path.join(saida, nome)), nome)
    }
    const temGanchos = existsSync(path.join(path.dirname(distServerReal), 'server', 'ganchos', 'principal.ts'))
    assert.equal(existsSync(path.join(saida, 'ganchos.mjs')), temGanchos)
    assert.ok(readFileSync(path.join(saida, 'index.mjs'), 'utf8').length > 1000, 'o servidor montado não está vazio')
    assert.ok(r.stdout.includes(path.join(saida, 'index.mjs')), 'a mensagem diz onde gravou (caminho inteiro, fora do projeto)')
  })

  it('a variável AXON_SAIDA_MONTADO faz o mesmo', () => {
    const saida = path.join(pastaNova(), 'da-variavel')
    const r = rodarMontagem([], { AXON_SAIDA_MONTADO: saida })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(existsSync(path.join(saida, 'index.mjs')))
  })

  it('a pasta de trabalho "<saida>.novo-<pid>" não sobra, nem a saída leva nada além dos arquivos montados', () => {
    const base = pastaNova()
    const saida = path.join(base, 'montado')
    assert.equal(rodarMontagem(['--saida', saida]).status, 0)
    assert.deepEqual(sobras(saida), [])
    assert.deepEqual(readdirSync(base), ['montado'])
    assert.ok(readdirSync(saida).every(nome => /\.mjs(\.map)?$/.test(nome)), readdirSync(saida).join(', '))
  })

  it('montar sobre uma saída que já existe troca os arquivos montados e deixa em paz o que não é dele', () => {
    const saida = path.join(pastaNova(), 'montado')
    mkdirSync(saida)
    writeFileSync(path.join(saida, 'index.mjs'), '// velho')
    writeFileSync(path.join(saida, 'anotacao.txt'), 'do dono')
    const r = rodarMontagem(['--saida', saida])
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!readFileSync(path.join(saida, 'index.mjs'), 'utf8').startsWith('// velho'), 'index.mjs foi trocado')
    assert.equal(readFileSync(path.join(saida, 'anotacao.txt'), 'utf8'), 'do dono')
    assert.deepEqual(sobras(saida), [])
  })

  it('duas montagens seguidas na mesma saída dão os mesmos arquivos', () => {
    const saida = path.join(pastaNova(), 'montado')
    assert.equal(rodarMontagem(['--saida', saida]).status, 0)
    const primeira = readFileSync(path.join(saida, 'mcp.mjs'), 'utf8')
    assert.equal(rodarMontagem(['--saida', saida]).status, 0)
    assert.equal(readFileSync(path.join(saida, 'mcp.mjs'), 'utf8'), primeira)
  })

  it('se um arquivo não pode ser trocado, sai com erro dizendo qual, sem pasta de trabalho sobrando e sem tocar no que não é arquivo montado', () => {
    // Um diretório com o nome do servidor impede o rename em qualquer sistema (no Windows, o erro é o de "arquivo em uso").
    const base = pastaNova()
    const saida = path.join(base, 'montado')
    mkdirSync(path.join(saida, 'index.mjs'), { recursive: true })
    writeFileSync(path.join(saida, 'index.mjs', 'dentro.txt'), 'não pode sumir')
    const r = rodarMontagem(['--saida', saida])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /^Não foi possível montar: /)
    assert.ok(r.stderr.includes('index.mjs'), r.stderr)
    assert.deepEqual(sobras(saida), [])
    assert.equal(readFileSync(path.join(saida, 'index.mjs', 'dentro.txt'), 'utf8'), 'não pode sumir')
    assert.ok(!r.stdout.includes('Montado:'), 'não anuncia sucesso')
  })

  it('--saida sem pasta é recusada com a frase certa', () => {
    const r = rodarMontagem(['--saida'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /^Não foi possível montar: A opção --saida precisa de uma pasta\./)
  })

  it('o dist-server do repositório não mudou (nem existiu, se não existia) durante estes testes', () => {
    assert.deepEqual(fotografarPasta(distServerReal), antesNoRepositorio)
  })
})
