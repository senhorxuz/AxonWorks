import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  agenteDaLeitura,
  AGENTE_PADRAO_DA_LEITURA,
  limiteDaLeitura,
  projetoDoPedido,
} from '../server/carta/leitura-curta-entrada.ts'
import { DomainError } from '../server/store/errors.ts'
import type { Project } from '../shared/types.ts'

const projeto = (id: string, workspacePath: string) => ({ id, name: id, workspacePath }) as unknown as Project

const PROJETOS = [projeto('agenda', 'D:\\Trabalho\\agenda-de-posts'), projeto('axon', 'D:/Trabalho/axon')]

function recusa(acao: () => unknown): DomainError {
  try {
    acao()
  } catch (erro) {
    assert.ok(erro instanceof DomainError)
    return erro
  }
  throw new assert.AssertionError({ message: 'devia ter recusado' })
}

describe('projetoDoPedido', () => {
  it('com projectId, devolve o projectId (sem espaços nas pontas) e nem lê a lista de projetos', () => {
    const lista = () => {
      throw new Error('não devia ler')
    }
    assert.equal(projetoDoPedido(lista, { projectId: '  abc  ' }), 'abc')
  })

  it('projectId e pasta que discordam: vale o projectId', () => {
    assert.equal(projetoDoPedido(() => PROJETOS, { projectId: 'outro', pasta: 'D:\\Trabalho\\axon' }), 'outro')
  })

  it('pasta igual ou contida acha o projeto (barras de Windows, maiúsculas e espaços não atrapalham)', () => {
    assert.equal(projetoDoPedido(() => PROJETOS, { pasta: 'd:/trabalho/AXON' }), 'axon')
    assert.equal(projetoDoPedido(() => PROJETOS, { pasta: '  D:\\Trabalho\\agenda-de-posts\\web\\src  ' }), 'agenda')
  })

  it('projectId só com espaços conta como ausente e cai na pasta', () => {
    assert.equal(projetoDoPedido(() => PROJETOS, { projectId: '   ', pasta: 'D:\\Trabalho\\axon' }), 'axon')
  })

  it('sem projectId e sem pasta: 400 informe_projeto_ou_pasta', () => {
    for (const pedido of [{}, { projectId: '', pasta: '' }, { projectId: '  ', pasta: '   ' }]) {
      const erro = recusa(() => projetoDoPedido(() => PROJETOS, pedido))
      assert.equal(erro.status, 400)
      assert.equal(erro.code, 'informe_projeto_ou_pasta')
      assert.equal(erro.message, 'Informe o projeto (projectId) ou a pasta da conversa (pasta).')
    }
  })

  it('pasta sem projeto ligado: 404 projeto_nao_encontrado_para_pasta', () => {
    const erro = recusa(() => projetoDoPedido(() => PROJETOS, { pasta: 'D:\\Trabalho\\outro' }))
    assert.equal(erro.status, 404)
    assert.equal(erro.code, 'projeto_nao_encontrado_para_pasta')
    assert.equal(erro.message, 'Nenhum projeto da Axon está ligado a esta pasta.')
    const semProjetos = recusa(() => projetoDoPedido(() => [], { pasta: 'D:\\Trabalho\\axon' }))
    assert.equal(semProjetos.code, 'projeto_nao_encontrado_para_pasta')
  })
})

describe('limiteDaLeitura', () => {
  it('sem valor, o padrão de 6.000', () => {
    assert.equal(limiteDaLeitura(undefined), 6000)
  })

  it('aceita de 2.000 a 20.000, número ou texto de número (rota HTTP)', () => {
    assert.equal(limiteDaLeitura(2000), 2000)
    assert.equal(limiteDaLeitura(20_000), 20_000)
    assert.equal(limiteDaLeitura(7500), 7500)
    assert.equal(limiteDaLeitura('2000'), 2000)
    assert.equal(limiteDaLeitura('20000'), 20_000)
  })

  it('recusa o que está fora ou não é inteiro, com invalid_input', () => {
    for (const valor of [1999, 20_001, 0, -5, 2500.5, Number.NaN, 'abc', '', ' ', null, true, [], {}, '1999', '20001', [3000], ['3000']]) {
      const erro = recusa(() => limiteDaLeitura(valor))
      assert.equal(erro.status, 400, String(valor))
      assert.equal(erro.code, 'invalid_input')
      assert.equal(erro.message, 'maxChars deve ser um número inteiro de 2000 a 20000.')
    }
  })
})

describe('agenteDaLeitura', () => {
  it('usa o nome que veio, sem espaços nas pontas', () => {
    assert.equal(agenteDaLeitura('  Codex '), 'Codex')
  })

  it('sem nome (ausente, vazio, só espaços ou de outro tipo), o padrão', () => {
    assert.equal(AGENTE_PADRAO_DA_LEITURA, 'Claude')
    for (const valor of [undefined, '', '   ', 7, null, ['Codex']]) assert.equal(agenteDaLeitura(valor), 'Claude')
  })
})
