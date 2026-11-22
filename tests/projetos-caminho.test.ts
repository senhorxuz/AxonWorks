import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { caminhoParaExibir } from '../src/projetos/caminho.ts'

describe('caminhoParaExibir', () => {
  it('barras dobradas viram barras simples', () => {
    assert.equal(caminhoParaExibir(String.raw`C:\\Users\\Ana\\Projetos`), String.raw`C:\Users\Ana\Projetos`)
  })
  it('caminho já normal fica como está', () => {
    assert.equal(caminhoParaExibir(String.raw`D:\Trabalho\axon`), String.raw`D:\Trabalho\axon`)
    assert.equal(caminhoParaExibir('/home/ana/axon'), '/home/ana/axon')
  })
  it('caminho de rede de verdade (duas barras só no começo) não é mexido', () => {
    assert.equal(caminhoParaExibir(String.raw`\\servidor\pasta\axon`), String.raw`\\servidor\pasta\axon`)
  })
  it('caminho de rede com tudo dobrado volta a duas barras no começo', () => {
    assert.equal(caminhoParaExibir(String.raw`\\\\servidor\\pasta`), String.raw`\\servidor\pasta`)
  })
  it('mistura de barras simples e dobradas não é adivinhada', () => {
    assert.equal(caminhoParaExibir(String.raw`C:\\Users\Ana`), String.raw`C:\\Users\Ana`)
  })
  it('vazio continua vazio', () => assert.equal(caminhoParaExibir(''), ''))
})
