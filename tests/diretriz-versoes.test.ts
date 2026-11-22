import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  aguardaConferencia, avisoDeAtualizacao, avisoDeVersaoAntiga, dataPorExtenso, estadoDaDiretriz,
  legendaDoSelo, quandoEPor, quemEscreveu, registrosDesde, resumoDaVersao, rotuloDoSalvar, tituloDaVersao,
} from '../src/diretriz/versoes.ts'

const humana = { revision: 1, createdBy: 'Dono', createdAt: '2026-10-25T15:00:00.000Z', sourceKind: 'human_directive' as const, body: 'OBJETIVO\nUm.\n\nRISCOS\nDois.' }
const ia = { revision: 2, createdBy: 'Claude', createdAt: '2026-11-05T15:00:00.000Z', sourceKind: 'agent_update' as const, body: 'X', motivo: 'a versão mudou.' }

describe('dataPorExtenso', () => {
  it('dia, mês curto e ano, no fuso de Brasília', () => {
    assert.equal(dataPorExtenso('2026-10-25T15:00:00.000Z'), '25 de out. de 2026')
    assert.equal(dataPorExtenso('2026-11-01T01:00:00.000Z'), '31 de out. de 2026')
  })
})

describe('quem escreveu e conferência', () => {
  it('texto do dono é "você"; de IA leva o nome declarado e (IA)', () => {
    assert.equal(quemEscreveu(humana), 'você')
    assert.equal(quemEscreveu(ia), 'Claude (IA)')
    assert.equal(quemEscreveu({ sourceKind: 'agent_proposal', createdBy: 'Codex' }), 'Codex (IA)')
  })
  it('só atualização de IA ainda não vista aguarda conferência', () => {
    assert.equal(aguardaConferencia(ia), true)
    assert.equal(aguardaConferencia({ ...ia, vistoPeloDonoEm: '2026-11-06T10:00:00Z' }), false)
    assert.equal(aguardaConferencia(humana), false)
    assert.equal(aguardaConferencia({ sourceKind: 'agent_proposal' }), false)
  })
  it('o estado diz o que falta fazer', () => {
    assert.deepEqual(estadoDaDiretriz(ia), { pendente: true, texto: 'Uma IA atualizou: confira' })
    assert.deepEqual(estadoDaDiretriz(humana), { pendente: false, texto: 'Escrita ou conferida por você' })
  })
})

describe('linha do tempo', () => {
  it('título da versão marca a vigente', () => {
    assert.equal(tituloDaVersao(humana, ia), 'Versão 1')
    assert.equal(tituloDaVersao(ia, ia), 'Versão 2 · vigente')
  })
  it('data e autor', () => assert.equal(quandoEPor(humana), '25 de out. de 2026 · por você'))
  it('resumo conta seções e caracteres, com singular', () => {
    assert.equal(resumoDaVersao(humana), `2 seções · ${humana.body.length} caracteres`)
    assert.equal(resumoDaVersao({ body: 'Só isto.' }), '1 seção · 8 caracteres')
    assert.equal(resumoDaVersao({ body: '' }), '0 seções · 0 caracteres')
    assert.equal(resumoDaVersao({ body: 'a' }), '1 seção · 1 caractere')
  })
})

describe('registrosDesde', () => {
  const registros = [{ createdAt: '2026-10-24T10:00:00Z' }, { createdAt: '2026-10-26T10:00:00Z' }, { createdAt: '2026-11-01T10:00:00Z' }]
  it('conta só os criados depois da versão', () => assert.equal(registrosDesde(registros, '2026-10-25T15:00:00.000Z'), 2))
  it('o do mesmo instante não conta', () => assert.equal(registrosDesde(registros, '2026-10-26T10:00:00Z'), 1))
  it('sem registros, zero', () => assert.equal(registrosDesde([], '2026-10-25T15:00:00.000Z'), 0))
})

describe('legendaDoSelo', () => {
  it('sem registros depois, só a data e o autor', () => {
    const texto = legendaDoSelo(humana, 0)
    assert.equal(texto.map(t => t.texto).join(''), 'Um anel por versão. Vigente desde 25 de out. de 2026, escrita por você.')
    assert.deepEqual(texto.filter(t => t.forte).map(t => t.texto), ['25 de out. de 2026', 'você'])
  })
  it('com registros depois, a contagem em destaque', () => {
    const texto = legendaDoSelo(ia, 12)
    assert.equal(texto.map(t => t.texto).join(''), 'Um anel por versão. Vigente desde 5 de nov. de 2026, escrita por Claude (IA). Desde então, 12 registros no projeto.')
    assert.deepEqual(texto.filter(t => t.forte).map(t => t.texto), ['5 de nov. de 2026', 'Claude (IA)', '12 registros'])
  })
  it('um registro só: singular', () => assert.ok(legendaDoSelo(humana, 1).some(t => t.texto === '1 registro')))
})

describe('avisos', () => {
  it('atualização de IA com motivo, sem ponto duplicado', () => {
    assert.equal(avisoDeAtualizacao(ia), 'Claude (nome declarado) atualizou esta diretriz em 5 de nov. de 2026: a versão mudou. Confira e diga se está certo.')
    assert.equal(avisoDeAtualizacao({ ...ia, motivo: '  trocou o foco  ' }), 'Claude (nome declarado) atualizou esta diretriz em 5 de nov. de 2026: trocou o foco. Confira e diga se está certo.')
  })
  it('só o ponto final do motivo cai; os de dentro ficam', () => {
    assert.ok(avisoDeAtualizacao({ ...ia, motivo: 'subiu a v1.2.0...' }).includes(': subiu a v1.2.0. Confira'))
  })
  it('sem motivo, o aviso fecha a data', () => {
    assert.equal(avisoDeAtualizacao({ ...ia, motivo: undefined }), 'Claude (nome declarado) atualizou esta diretriz em 5 de nov. de 2026. Confira e diga se está certo.')
    assert.equal(avisoDeAtualizacao({ ...ia, motivo: '  ' }), 'Claude (nome declarado) atualizou esta diretriz em 5 de nov. de 2026. Confira e diga se está certo.')
  })
  it('versão antiga avisa que não vale mais', () => {
    assert.equal(avisoDeVersaoAntiga(humana), 'Você está vendo a versão 1, de 25 de out. de 2026. Ela não vale mais.')
  })
})

describe('salvar', () => {
  it('o rótulo é a versão seguinte', () => {
    assert.equal(rotuloDoSalvar(ia), 'Salvar versão 3')
    assert.equal(rotuloDoSalvar(null), 'Salvar versão 1')
  })
})
