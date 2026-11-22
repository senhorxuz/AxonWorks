import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CHAVE_NOME_DONO, EXPLICACAO_DOS_NOMES, ID_CAMPO_NOME_DA_IA, NOME_DO_DONO_PADRAO, autoriaDaTela, nomeDoDonoDe } from '../src/identidade/identidade.ts'

describe('nomeDoDonoDe', () => {
  it('lê o nome da chave "axon-nome-do-dono" (o texto da chave não pode mudar sem migrar o que já está salvo)', () => {
    assert.equal(CHAVE_NOME_DONO, 'axon-nome-do-dono')
    assert.equal(nomeDoDonoDe({ getItem: (chave) => (chave === 'axon-nome-do-dono' ? 'Marina' : null) }), 'Marina')
  })
  it('sem nome salvo, assina com o texto que a carta reconhece como o dono', () => {
    assert.equal(nomeDoDonoDe({ getItem: () => null }), 'Dono do projeto')
    assert.equal(NOME_DO_DONO_PADRAO.toLowerCase(), 'dono do projeto')
  })
  it('nome salvo só com espaços vale como vazio', () => {
    assert.equal(nomeDoDonoDe({ getItem: () => '   ' }), 'Dono do projeto')
  })
  it('usa o nome salvo, sem espaços nas pontas, lido da chave certa', () => {
    const lidas: string[] = []
    const nome = nomeDoDonoDe({ getItem: (chave) => { lidas.push(chave); return '  Marina ' } })
    assert.equal(nome, 'Marina')
    assert.deepEqual(lidas, [CHAVE_NOME_DONO])
  })
  it('sem armazenamento ou com armazenamento que falha, volta ao padrão', () => {
    assert.equal(nomeDoDonoDe(undefined), 'Dono do projeto')
    assert.equal(nomeDoDonoDe({ getItem: () => { throw new Error('bloqueado') } }), 'Dono do projeto')
  })
})

describe('autoriaDaTela', () => {
  it('com nome na barra, assina a IA e a origem nasce como relato de agente', () => {
    assert.deepEqual(autoriaDaTela('Astra', 'Dono do projeto'), { autor: 'Astra', origem: 'agent_report' })
  })
  it('tira os espaços das pontas do nome da IA', () => {
    assert.deepEqual(autoriaDaTela('  Astra ', 'Marina'), { autor: 'Astra', origem: 'agent_report' })
  })
  it('sem nome na barra, assina o dono e a origem nasce como diretriz humana', () => {
    assert.deepEqual(autoriaDaTela('', 'Dono do projeto'), { autor: 'Dono do projeto', origem: 'human_directive' })
    assert.deepEqual(autoriaDaTela('   ', 'Marina'), { autor: 'Marina', origem: 'human_directive' })
  })
  it('com nome na barra, a origem é sempre relato de agente, mesmo revendo um texto do dono ou externo', () => {
    assert.deepEqual(autoriaDaTela('Astra', 'Dono do projeto', 'human_directive'), { autor: 'Astra', origem: 'agent_report' })
    assert.deepEqual(autoriaDaTela('Astra', 'Dono do projeto', 'external_reference'), { autor: 'Astra', origem: 'agent_report' })
  })
  it('sem nome na barra, revendo um texto, a origem é a da versão vigente', () => {
    assert.deepEqual(autoriaDaTela('', 'Dono do projeto', 'agent_report'), { autor: 'Dono do projeto', origem: 'agent_report' })
    assert.deepEqual(autoriaDaTela('  ', 'Dono do projeto', 'external_reference'), { autor: 'Dono do projeto', origem: 'external_reference' })
    assert.deepEqual(autoriaDaTela('', 'Dono do projeto', 'human_directive'), { autor: 'Dono do projeto', origem: 'human_directive' })
  })
  it('sem o nome do dono salvo, assina com o texto padrão', () => {
    assert.deepEqual(autoriaDaTela('', undefined), { autor: NOME_DO_DONO_PADRAO, origem: 'human_directive' })
  })
})

describe('textos fixos', () => {
  it('o id do campo continuam os que as telas e os testes usam', () => {
    assert.equal(ID_CAMPO_NOME_DA_IA, 'agent-name')
    assert.match(EXPLICACAO_DOS_NOMES, /Dono do projeto/)
  })
})

import { ehAvisoDeNome } from '../src/identidade/identidade.ts'
describe('ehAvisoDeNome', () => {
  it('reconhece as frases que as telas mostram quando falta o nome da IA', () => {
    assert.equal(ehAvisoDeNome('Informe o nome do agente na barra lateral antes de salvar.'), true)
    assert.equal(ehAvisoDeNome('Preencha o nome do agente na barra lateral.'), true)
    assert.equal(ehAvisoDeNome('Informe seu nome de agente na barra lateral.'), true)
    assert.equal(ehAvisoDeNome('Informe o nome na barra lateral.'), true)
  })
  it('não confunde outros erros', () => {
    assert.equal(ehAvisoDeNome('Não consegui salvar.'), false)
    assert.equal(ehAvisoDeNome(''), false)
  })
})
