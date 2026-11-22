import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DomainError } from '../server/store/errors.js'
import {
  anteporPontoDeConferencia,
  campoDoPontoDeConferencia,
  gravarPontoDeConferencia,
  lerPontoDeConferencia,
  normalizarPontoDeConferencia,
  passagemParaLeitura,
} from '../server/store/ponto-de-conferencia.js'

function recusa(executar: () => unknown, code: string, message: string): void {
  assert.throws(executar, (erro: unknown) => {
    assert.ok(erro instanceof DomainError)
    assert.equal(erro.status, 400)
    assert.equal(erro.code, code)
    assert.equal(erro.message, message)
    return true
  })
}

test('normaliza o texto, preserva opcionais informados e omite os ausentes', () => {
  assert.equal(normalizarPontoDeConferencia(undefined), undefined)
  assert.deepEqual(normalizarPontoDeConferencia({ comoConferir: ' A ' }), { comoConferir: 'A' })
  assert.deepEqual(normalizarPontoDeConferencia({
    commit: ' 123 ', ambiente: ' prévia ', onde: ' #citações ', comoConferir: ' Conferência ', seNaoBater: ' Revisar ',
  }), {
    commit: '123', ambiente: 'prévia', onde: '#citações', comoConferir: 'Conferência', seNaoBater: 'Revisar',
  })
  const limite = 'x'.repeat(8000)
  assert.deepEqual(normalizarPontoDeConferencia({ comoConferir: limite, onde: limite }), {
    comoConferir: limite, onde: limite,
  })
})

test('recusa a falta de comoConferir e campos inválidos com status e código de domínio', () => {
  for (const entrada of [{}, { comoConferir: '' }, { comoConferir: ' \n\t' }]) {
    recusa(() => normalizarPontoDeConferencia(entrada), 'como_conferir_obrigatorio',
      'O ponto de conferência exige o campo comoConferir.')
  }
  recusa(() => normalizarPontoDeConferencia(null), 'invalid_input', 'Dados de pontoDeConferencia inválidos.')
  for (const comoConferir of [123, 'x'.repeat(8001)]) {
    recusa(() => normalizarPontoDeConferencia({ comoConferir }), 'invalid_input',
      'Campo pontoDeConferencia.comoConferir inválido.')
  }
  for (const campo of ['commit', 'ambiente', 'onde', 'seNaoBater']) {
    recusa(() => normalizarPontoDeConferencia({ comoConferir: 'A', [campo]: ' ' }), 'invalid_input',
      `Campo pontoDeConferencia.${campo} inválido.`)
  }
})

test('converte o ponto em coluna opcional e o recupera sem preencher registro antigo', () => {
  const ponto = { comoConferir: 'Conferência.' }
  assert.deepEqual(campoDoPontoDeConferencia(undefined), {})
  assert.deepEqual(campoDoPontoDeConferencia(ponto), { pontoDeConferencia: ponto })
  assert.equal(gravarPontoDeConferencia(undefined), null)
  const json = gravarPontoDeConferencia(ponto)
  assert.equal(json, '{"comoConferir":"Conferência."}')
  assert.deepEqual(lerPontoDeConferencia(json), { pontoDeConferencia: ponto })
  assert.deepEqual(lerPontoDeConferencia(null), {})
})

test('formata as linhas disponíveis antes da narrativa sem separadores soltos', () => {
  const ponto = { comoConferir: 'Verificar a navegação.' }
  assert.equal(anteporPontoDeConferencia(undefined, 'Narrativa.'), 'Narrativa.')
  assert.equal(anteporPontoDeConferencia(ponto, ''), 'Para conferir: Verificar a navegação.')
  assert.equal(anteporPontoDeConferencia({ ...ponto, onde: '#citações' }, 'Narrativa.'),
    'Ponto de partida: #citações.\nPara conferir: Verificar a navegação.\n\nNarrativa.')
  assert.equal(anteporPontoDeConferencia({
    ...ponto, commit: 'a1b2c3d', ambiente: 'prévia', onde: '#citações', seNaoBater: 'Registrar a divergência.',
  }, 'Narrativa.'),
  'Ponto de partida: commit a1b2c3d · prévia · #citações.\nPara conferir: Verificar a navegação.\nSe não bater: Registrar a divergência.\n\nNarrativa.')
})

test('lista a passagem antiga intacta e usa o próximo passo quando o recado está vazio', () => {
  const antiga = { id: 'antiga', message: '', checkpoint: { nextStep: 'Retomar a revisão.' } }
  assert.equal(passagemParaLeitura(antiga), antiga)
  const passagem = { ...antiga, pontoDeConferencia: { comoConferir: 'Conferência.' } }
  assert.deepEqual(passagemParaLeitura(passagem), { ...passagem, message: 'Para conferir: Conferência.\n\nRetomar a revisão.' })
  const comRecado = { ...passagem, message: 'Recado.' }
  assert.deepEqual(passagemParaLeitura(comRecado), { ...comRecado, message: 'Para conferir: Conferência.\n\nRecado.' })
})
