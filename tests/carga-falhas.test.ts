import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TEXTO_SERVIDOR_FORA,
  classificarFalhaDeCarga,
  contagemDaBarra,
  FalhaDeRede,
  ehFalhaDeRede,
  textoDoErroDeRede,
} from '../src/carga/falhas.ts'

const erroDaApi = (status: number, code: string, message = 'texto do servidor') => Object.assign(new Error(message), { status, code })

const semResposta = () => new FalhaDeRede(new TypeError('Failed to fetch'))

describe('ehFalhaDeRede', () => {
  it('só a falha marcada por quem fez o pedido é "a Axon não respondeu"', () => {
    assert.equal(ehFalhaDeRede(semResposta()), true)
    assert.equal(ehFalhaDeRede(new FalhaDeRede()), true)
  })
  it('guarda a causa original', () => {
    const causa = new TypeError('Load failed')
    assert.equal(new FalhaDeRede(causa).causa, causa)
  })
  it('um TypeError ou SyntaxError solto é defeito da tela, não servidor fora do ar', () => {
    assert.equal(ehFalhaDeRede(new TypeError('Cannot read properties of undefined')), false)
    assert.equal(ehFalhaDeRede(new TypeError('Failed to fetch')), false)
    assert.equal(ehFalhaDeRede(new SyntaxError('Unexpected token')), false)
  })
  it('erro vindo do servidor e qualquer outra coisa não são', () => {
    assert.equal(ehFalhaDeRede(erroDaApi(500, 'x')), false)
    assert.equal(ehFalhaDeRede('Failed to fetch'), false)
    assert.equal(ehFalhaDeRede(null), false)
    assert.equal(ehFalhaDeRede(undefined), false)
  })
})

describe('textoDoErroDeRede', () => {
  it('devolve o texto de produto só para falha de rede', () => {
    assert.equal(textoDoErroDeRede(semResposta()), TEXTO_SERVIDOR_FORA)
    assert.equal(textoDoErroDeRede(new Error('outro')), null)
    assert.equal(textoDoErroDeRede(new TypeError('Failed to fetch')), null)
  })
  it('o texto fala com o dono e tranquiliza sobre os dados', () => {
    assert.equal(TEXTO_SERVIDOR_FORA, 'Não consegui falar com a Axon neste computador. Seus dados continuam guardados.')
  })
})

describe('classificarFalhaDeCarga', () => {
  it('servidor fora do ar, na lista', () => {
    assert.deepEqual(classificarFalhaDeCarga(semResposta(), 'lista'), { tipo: 'servidor-fora', mensagem: TEXTO_SERVIDOR_FORA })
  })
  it('servidor fora do ar, no projeto', () => {
    assert.deepEqual(classificarFalhaDeCarga(semResposta(), 'projeto'), { tipo: 'servidor-fora', mensagem: TEXTO_SERVIDOR_FORA })
  })
  it('projeto inexistente (404) e endereço inválido (400) viram a mesma mensagem, sem jargão', () => {
    const esperado = { tipo: 'projeto-inexistente', mensagem: 'Este projeto não existe mais ou o link está errado.' }
    assert.deepEqual(classificarFalhaDeCarga(erroDaApi(404, 'not_found'), 'projeto'), esperado)
    assert.deepEqual(classificarFalhaDeCarga(erroDaApi(400, 'invalid_input', 'Campo projectId inválido.'), 'projeto'), esperado)
  })
  it('outras falhas ao abrir o projeto falam em abrir, nunca em salvar', () => {
    const falha = classificarFalhaDeCarga(erroDaApi(500, 'x', 'Não foi possível salvar. Tente novamente.'), 'projeto')
    assert.deepEqual(falha, { tipo: 'abrir-projeto', mensagem: 'Não consegui abrir este projeto.' })
  })
  it('na lista, 404 e 400 não viram "projeto inexistente"', () => {
    assert.equal(classificarFalhaDeCarga(erroDaApi(404, 'not_found'), 'lista').tipo, 'abrir-lista')
    assert.equal(classificarFalhaDeCarga(erroDaApi(400, 'invalid_input'), 'lista').tipo, 'abrir-lista')
  })
  it('outras falhas da lista falam em carregar os projetos', () => {
    assert.deepEqual(classificarFalhaDeCarga(new Error('boom'), 'lista'), { tipo: 'abrir-lista', mensagem: 'Não consegui carregar a lista de projetos.' })
  })
  it('erro que não é Error também é tratado', () => {
    assert.equal(classificarFalhaDeCarga('x', 'projeto').tipo, 'abrir-projeto')
    assert.equal(classificarFalhaDeCarga(undefined, 'lista').tipo, 'abrir-lista')
  })
})

describe('contagemDaBarra', () => {
  it('traço enquanto carrega ou quando falhou: nunca "00", que parece que sumiu tudo', () => {
    assert.equal(contagemDaBarra(0, { carregando: true, falhou: false }), '–')
    assert.equal(contagemDaBarra(0, { carregando: false, falhou: true }), '–')
    assert.equal(contagemDaBarra(7, { carregando: true, falhou: true }), '–')
  })
  it('com dados, dois dígitos', () => {
    assert.equal(contagemDaBarra(0, { carregando: false, falhou: false }), '00')
    assert.equal(contagemDaBarra(9, { carregando: false, falhou: false }), '09')
    assert.equal(contagemDaBarra(12, { carregando: false, falhou: false }), '12')
  })
})

describe('falha vinda de um valor sem forma de erro', () => {
  it('null, undefined e texto não derrubam a classificação: viram "não consegui abrir"', () => {
    for (const estranho of [null, undefined, 'texto', 42, {}, { status: '404' }]) {
      assert.deepEqual(classificarFalhaDeCarga(estranho, 'projeto'), { tipo: 'abrir-projeto', mensagem: 'Não consegui abrir este projeto.' })
    }
  })
  it('a falha de rede traz a frase própria', () => {
    assert.equal(new FalhaDeRede().message, 'A Axon não respondeu.')
  })
})
