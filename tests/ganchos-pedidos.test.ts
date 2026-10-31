import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LIMITE_POR_PEDIDO,
  MAXIMO_DE_PEDIDOS,
  TITULO_DOS_PEDIDOS,
  juntarComPedidos,
  secaoDosPedidos,
} from '../server/ganchos/pedidos-do-dono.ts'
import { cortarFimSemPartir, cortarInicioSemPartir } from '../server/ganchos/transcricao.ts'

/**
 * D6: o rascunho automático (PostCompact e SessionEnd) termina com a seção "Pedidos do dono nesta
 * sessão:", os 15 últimos pedidos, cada um em até 300 caracteres sem partir palavra. O resumo cede
 * espaço; os pedidos não somem. Textos esperados escritos por extenso de propósito.
 */

describe('secaoDosPedidos', () => {
  it('sem pedido: nada', () => {
    assert.equal(secaoDosPedidos([]), '')
  })

  it('um pedido por linha, depois do título', () => {
    assert.equal(TITULO_DOS_PEDIDOS, 'Pedidos do dono nesta sessão:')
    assert.equal(secaoDosPedidos(['Arruma o login', 'Agora o cadastro']), 'Pedidos do dono nesta sessão:\n- Arruma o login\n- Agora o cadastro')
  })

  it('quebras de linha e espaços repetidos viram um espaço; pedido só de espaço sai', () => {
    assert.equal(secaoDosPedidos(['  Arruma\n\no   login  ', ' \n ']), 'Pedidos do dono nesta sessão:\n- Arruma o login')
    assert.equal(secaoDosPedidos(['\t']), '')
  })

  it('só os 15 últimos, na ordem em que foram feitos', () => {
    assert.equal(MAXIMO_DE_PEDIDOS, 15)
    const pedidos = Array.from({ length: 17 }, (_, i) => `pedido ${i + 1}`)
    const linhas = secaoDosPedidos(pedidos).split('\n')
    assert.equal(linhas.length, 16)
    assert.equal(linhas[1], '- pedido 3')
    assert.equal(linhas[15], '- pedido 17')
  })

  it('pedido longo é cortado em 300 caracteres sem partir palavra', () => {
    assert.equal(LIMITE_POR_PEDIDO, 300)
    const longo = 'palavra '.repeat(60).trim()
    const linha = secaoDosPedidos([longo]).split('\n')[1]!
    assert.equal(linha, `- ${cortarInicioSemPartir(longo, 300)}`)
    assert.ok(linha.length <= 302)
    assert.ok(linha.endsWith('palavra'))
    const exato = 'a'.repeat(300)
    assert.equal(secaoDosPedidos([exato]).split('\n')[1], `- ${exato}`)
  })
})

describe('juntarComPedidos', () => {
  it('sem pedidos: o resumo de sempre, cortado no limite', () => {
    assert.equal(juntarComPedidos('Resumo da sessão', [], 8000, cortarInicioSemPartir), 'Resumo da sessão')
    assert.equal(juntarComPedidos('um dois três', [], 8, cortarInicioSemPartir), 'um dois')
  })

  it('com pedidos: resumo, linha em branco e a seção no fim', () => {
    assert.equal(
      juntarComPedidos('Resumo da sessão', ['Arruma o login'], 8000, cortarInicioSemPartir),
      'Resumo da sessão\n\nPedidos do dono nesta sessão:\n- Arruma o login',
    )
  })

  it('resumo vazio: nada (sem resumo não há rascunho, como antes)', () => {
    assert.equal(juntarComPedidos('   ', ['Arruma o login'], 8000, cortarInicioSemPartir), '')
  })

  it('o resumo cede espaço: o total cabe no limite e a seção chega inteira', () => {
    const secao = secaoDosPedidos(['Arruma o login'])
    const limite = 'Resumo longo'.length + 2 + secao.length
    assert.equal(juntarComPedidos('Resumo longo', ['Arruma o login'], limite, cortarInicioSemPartir), `Resumo longo\n\n${secao}`)
    assert.equal(juntarComPedidos('Resumo longo demais', ['Arruma o login'], limite, cortarInicioSemPartir), `Resumo longo\n\n${secao}`)
    assert.equal(juntarComPedidos('Resumo longo', ['Arruma o login'], limite - 1, cortarInicioSemPartir), `Resumo\n\n${secao}`)
  })

  it('quem chama escolhe de que lado o resumo é cortado', () => {
    const secao = secaoDosPedidos(['x'])
    const limite = 'três quatro'.length + 2 + secao.length
    assert.equal(juntarComPedidos('um dois três quatro', ['x'], limite, cortarFimSemPartir), `três quatro\n\n${secao}`)
  })

  it('limite em que só a seção cabe: a seção sozinha', () => {
    const secao = secaoDosPedidos(['Arruma o login'])
    assert.equal(juntarComPedidos('Resumo', ['Arruma o login'], secao.length + 2, cortarInicioSemPartir), secao)
    assert.equal(juntarComPedidos('Resumo', ['Arruma o login'], secao.length, cortarInicioSemPartir), secao)
  })

  it('no limite de 8.000, com 15 pedidos de 300 caracteres e um resumo enorme, nada passa e nenhum pedido some', () => {
    const pedidos = Array.from({ length: 15 }, (_, i) => `${i + 1} ${'pedido '.repeat(60)}`)
    const resumo = 'resumo '.repeat(2000)
    const texto = juntarComPedidos(resumo, pedidos, 8000, cortarFimSemPartir)
    assert.ok(texto.length <= 8000, String(texto.length))
    assert.ok(texto.endsWith(secaoDosPedidos(pedidos)))
    for (let i = 1; i <= 15; i += 1) assert.ok(texto.includes(`\n- ${i} pedido`), `pedido ${i}`)
    assert.ok(texto.startsWith('resumo'))
  })
})
