import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PALAVRA_DE_CONFIRMACAO,
  confirmouApagarRegistro,
  fraseDasOcorrencias,
  fraseDoApagado,
  trechoPreenchido,
} from '../src/apagar/apagar.ts'

/** Helpers puros das caixas "Apagar trecho" e "Apagar registro inteiro" da tela. */
describe('tela: apagar trecho ou registro', () => {
  it('a confirmação do registro inteiro é a palavra APAGAR, sem diferença de espaços nas pontas', () => {
    assert.equal(PALAVRA_DE_CONFIRMACAO, 'APAGAR')
    assert.equal(confirmouApagarRegistro('APAGAR'), true)
    assert.equal(confirmouApagarRegistro('  APAGAR '), true)
    assert.equal(confirmouApagarRegistro('apagar'), false)
    assert.equal(confirmouApagarRegistro('APAGA'), false)
    assert.equal(confirmouApagarRegistro(''), false)
  })

  it('trecho só com espaços não conta como preenchido', () => {
    assert.equal(trechoPreenchido(''), false)
    assert.equal(trechoPreenchido('  \n'), false)
    assert.equal(trechoPreenchido(' a '), true)
  })

  it('diz quantas vezes o trecho aparece', () => {
    assert.equal(fraseDasOcorrencias(0), 'Esse trecho não aparece neste registro. Confira se colou o texto exatamente igual.')
    assert.equal(fraseDasOcorrencias(1), 'Esse trecho aparece 1 vez neste registro.')
    assert.equal(fraseDasOcorrencias(5), 'Esse trecho aparece 5 vezes neste registro.')
  })

  it('o aviso depois de apagar', () => {
    assert.equal(fraseDoApagado({ modo: 'trecho', ocorrencias: 1 }), 'O trecho foi apagado 1 vez.')
    assert.equal(fraseDoApagado({ modo: 'trecho', ocorrencias: 3 }), 'O trecho foi apagado 3 vezes.')
    assert.equal(fraseDoApagado({ modo: 'inteiro', ocorrencias: 7 }), 'O registro foi apagado. Ficaram só a data e quem gravou.')
  })
})
