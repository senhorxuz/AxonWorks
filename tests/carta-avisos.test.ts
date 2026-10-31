import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Avisos curtos da retomada e da carta (lote 2): trabalho não registrado (D1) e diretriz velha (D2).
 * As frases estão escritas por extenso de propósito: o teste confere o texto exato.
 *
 * O processo roda no fuso de Tóquio, longe do de São Paulo: a data da diretriz tem de sair no fuso do
 * dono mesmo quando a máquina está em outro (o servidor pode estar numa VPS em UTC).
 */
process.env.TZ = 'Asia/Tokyo'
const { CHECKPOINTS_PARA_DIRETRIZ_VELHA, DIAS_PARA_DIRETRIZ_VELHA, avisosDaDiretrizVelha, fraseDoTrabalhoNaoRegistrado } = await import(
  '../server/carta/avisos.ts'
)

const commit = (i: number) => ({ hash: `abc${i}`, titulo: `Título ${i}` })

describe('fraseDoTrabalhoNaoRegistrado (D1)', () => {
  it('sem commits e sem arquivos alterados: nada', () => {
    assert.equal(fraseDoTrabalhoNaoRegistrado({ commits: [], alterados: 0 }), null)
  })

  it('um commit e um arquivo: singular, com o hash e o título', () => {
    assert.equal(
      fraseDoTrabalhoNaoRegistrado({ commits: [commit(1)], alterados: 1 }),
      'Trabalho não registrado na Axon: 1 commit depois do registro mais recente (abc1 Título 1) e 1 arquivo alterado sem commit.',
    )
  })

  it('vários commits e arquivos: plural, na ordem que o git deu, separados por ponto e vírgula', () => {
    assert.equal(
      fraseDoTrabalhoNaoRegistrado({ commits: [commit(1), commit(2), commit(3)], alterados: 4 }),
      'Trabalho não registrado na Axon: 3 commits depois do registro mais recente (abc1 Título 1; abc2 Título 2; abc3 Título 3) e 4 arquivos alterados sem commit.',
    )
  })

  it('cinco commits: os cinco, contados', () => {
    const frase = fraseDoTrabalhoNaoRegistrado({ commits: [1, 2, 3, 4, 5].map(commit), alterados: 0 })
    assert.equal(
      frase,
      'Trabalho não registrado na Axon: 5 commits depois do registro mais recente (abc1 Título 1; abc2 Título 2; abc3 Título 3; abc4 Título 4; abc5 Título 5).',
    )
  })

  it('seis commits (o git lê até seis): "mais de 5" e só os cinco mais novos', () => {
    const frase = fraseDoTrabalhoNaoRegistrado({ commits: [1, 2, 3, 4, 5, 6].map(commit), alterados: 0 })
    assert.equal(
      frase,
      'Trabalho não registrado na Axon: mais de 5 commits depois do registro mais recente (os 5 mais novos: abc1 Título 1; abc2 Título 2; abc3 Título 3; abc4 Título 4; abc5 Título 5).',
    )
  })

  it('só arquivos alterados; commit sem título mostra só o hash', () => {
    assert.equal(
      fraseDoTrabalhoNaoRegistrado({ commits: [], alterados: 2 }),
      'Trabalho não registrado na Axon: 2 arquivos alterados sem commit.',
    )
    assert.equal(
      fraseDoTrabalhoNaoRegistrado({ commits: [{ hash: 'abc9', titulo: '' }], alterados: 0 }),
      'Trabalho não registrado na Axon: 1 commit depois do registro mais recente (abc9).',
    )
  })
})

describe('avisosDaDiretrizVelha (D2)', () => {
  const diretriz = { createdAt: '2026-10-01T15:00:00.000Z' }
  const depois = (n: number) => Array.from({ length: n }, (_, i) => ({ createdAt: `2026-10-${String(2 + i).padStart(2, '0')}T10:00:00.000Z` }))
  const agora = new Date('2026-10-15T15:00:00.000Z')
  /** A frase da tela: para o dono, sem nome de ferramenta. */
  const PARA_O_DONO =
    'A diretriz deste projeto não muda desde 01/10/2026, e desde então houve 5 registros. Se o projeto mudou, o Claude pode propor a atualização, e você aprova aqui na Axon.'
  /** A frase da retomada: para o Claude, com a ferramenta. */
  const PARA_O_CLAUDE =
    'A diretriz deste projeto não muda desde 01/10/2026; depois dela houve 5 registros. Quando o estado mudou (por exemplo, a versão no ar), a atualização é proposta com save_charter e o dono aprova na tela.'
  const AMBAS = { paraODono: PARA_O_DONO, paraOClaude: PARA_O_CLAUDE }

  it('14 dias ou mais e 5 registros ou mais depois dela: as duas frases, com a data no fuso do dono', () => {
    assert.equal(DIAS_PARA_DIRETRIZ_VELHA, 14)
    assert.equal(CHECKPOINTS_PARA_DIRETRIZ_VELHA, 5)
    assert.deepEqual(avisosDaDiretrizVelha(diretriz, depois(5), agora), AMBAS)
  })

  it('a frase do dono não cita ferramenta nem "save_charter"', () => {
    const { paraODono } = avisosDaDiretrizVelha(diretriz, depois(5), agora)!
    assert.doesNotMatch(paraODono, /save_|_charter|checkpoint/i)
  })

  it('a contagem é a de registros depois da diretriz; os de antes ou no mesmo instante não contam', () => {
    const antes = [{ createdAt: '2026-09-30T10:00:00.000Z' }, { createdAt: diretriz.createdAt }]
    assert.equal(avisosDaDiretrizVelha(diretriz, [...antes, ...depois(4)], agora), null)
    const sete = avisosDaDiretrizVelha(diretriz, [...antes, ...depois(7)], agora)!
    assert.match(sete.paraOClaude, /houve 7 registros\./)
    assert.match(sete.paraODono, /desde então houve 7 registros\./)
  })

  it('um instante antes dos 14 dias: nada; nos 14 dias exatos: as frases', () => {
    assert.equal(avisosDaDiretrizVelha(diretriz, depois(5), new Date(Date.parse('2026-10-15T15:00:00.000Z') - 1)), null)
    assert.deepEqual(avisosDaDiretrizVelha(diretriz, depois(5), agora), AMBAS)
  })

  it('sem diretriz: nada', () => {
    assert.equal(avisosDaDiretrizVelha(null, depois(9), agora), null)
    assert.equal(avisosDaDiretrizVelha(undefined, depois(9), agora), null)
  })

  it('a data é a do fuso de São Paulo: 02/10 01h UTC ainda é 01/10 para o dono', () => {
    const tarde = { createdAt: '2026-10-02T01:00:00.000Z' }
    const registros = Array.from({ length: 5 }, () => ({ createdAt: '2026-10-05T10:00:00.000Z' }))
    const frases = avisosDaDiretrizVelha(tarde, registros, new Date('2026-11-01T00:00:00.000Z'))!
    assert.match(frases.paraOClaude, /desde 01\/10\/2026;/)
    assert.match(frases.paraODono, /desde 01\/10\/2026,/)
  })
})
