import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDoDestinatario } from '../src/mensagens/destinatario.ts'

describe('rotuloDoDestinatario', () => {
  it('"*" é a mensagem para todo mundo e se lê "Todas as IAs"', () => {
    assert.equal(rotuloDoDestinatario('*'), 'Todas as IAs')
  })
  it('espaços em volta do asterisco não enganam', () => {
    assert.equal(rotuloDoDestinatario(' * '), 'Todas as IAs')
  })
  it('um nome fica como está', () => {
    assert.equal(rotuloDoDestinatario('Claude-orquestrador'), 'Claude-orquestrador')
  })
  it('asterisco dentro de um nome não é "todas"', () => {
    assert.equal(rotuloDoDestinatario('a*b'), 'a*b')
  })
})
