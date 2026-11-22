import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Licao } from '../shared/licoes.js'
import { aplicarLicao, separarLicoes, autoriaDaLicao, resumoDaFalha, mensagemDaEscrita, rotulosDaEdicao } from '../src/regras/texto.js'

const base: Licao = {
  id: '1', projectId: 'projeto', texto: 'Conferir os links', origem: 'Claude', criadaEm: '2026-11-20T12:00:00.000Z',
  aposentadaEm: null, motivoAposentadoria: null, tipo: 'erro', fraseDoDono: null,
  momento: null, linhaCurta: null, substituiId: null,
}

test('separa regras, erros de cada alcance e verificações em ordem de momento', () => {
  const regra: Licao = { ...base, id: '2', tipo: 'regra' }
  const geral = { ...base, id: '3', projectId: null }
  const subir: Licao = { ...base, id: '4', tipo: 'verificacao', momento: 'antes_de_subir' }
  const pronto: Licao = { ...base, id: '5', tipo: 'verificacao', momento: 'antes_de_pronto' }
  const commit: Licao = { ...base, id: '6', tipo: 'verificacao', momento: 'antes_de_commit' }
  const semMomento: Licao = { ...base, id: '7', tipo: 'verificacao' }
  assert.deepEqual(separarLicoes([pronto, commit, geral, base, regra, subir, semMomento]), {
    regras: [regra], errosDoProjeto: [base], errosGerais: [geral],
    verificacoes: { antes_de_subir: [subir], antes_de_pronto: [pronto], antes_de_commit: [commit] },
  })
  assert.deepEqual(separarLicoes([]).regras, [])
})

test('aplica o retorno da escrita sem duplicar, mantendo apenas versões ativas', () => {
  const outra = { ...base, id: 'outra' }
  const corrigida = { ...base, id: 'nova', substituiId: base.id }
  assert.deepEqual(aplicarLicao([], base), [base])
  assert.deepEqual(aplicarLicao([base, outra], base), [base, outra])
  assert.deepEqual(aplicarLicao([base, outra], corrigida), [outra, corrigida])
  assert.deepEqual(aplicarLicao([outra, corrigida], { ...corrigida, aposentadaEm: base.criadaEm }), [outra])
})

test('autoria em português diferencia o texto do dono da anotação de uma IA', () => {
  assert.equal(autoriaDaLicao(base), 'Anotado por Claude')
  assert.equal(autoriaDaLicao({ ...base, origem: 'Dono' }), 'Anotado por você')
  assert.equal(autoriaDaLicao({ ...base, tipo: 'regra' }), 'Anotada por Claude')
  assert.equal(autoriaDaLicao({ ...base, tipo: 'verificacao', origem: 'Dono' }), 'Dita por você')
})

test('resume uma ou várias falhas e inclui data em português', () => {
  assert.equal(resumoDaFalha(1, base.criadaEm), 'Falhou 1 vez · Última em 20/11/2026')
  assert.equal(resumoDaFalha(3, base.criadaEm), 'Falhou 3 vezes · Última em 20/11/2026')
})

test('traduz códigos do servidor e usa a mesma frase para erro desconhecido ou de conexão', () => {
  const mensagens = {
    regra_precisa_de_projeto: 'Abra um projeto para guardar esta orientação.',
    frase_do_dono_obrigatoria: 'Escreva a orientação com suas palavras.',
    momento_obrigatorio: 'Escolha quando a verificação deve ser feita.',
    momento_so_em_verificacao: 'Só as verificações têm um momento para conferir.',
    pedido_do_dono_obrigatorio: 'Escreva o motivo para retirar este item.',
    licao_igual_ja_existe: 'Já existe uma orientação ativa com esse texto. Escreva um texto diferente.',
    tipo_diferente_na_substituicao: 'Uma correção precisa manter o mesmo tipo de orientação.',
    escopo_diferente: 'Só é possível corrigir uma orientação no lugar onde ela foi anotada.',
    lesson_already_retired: 'Este item já saiu da lista. Reabra a aba para atualizar.',
    not_found: 'Não encontramos este item. Reabra a aba para atualizar.',
    invalid_input: 'Confira os campos e tente novamente.',
    corrupted_text: 'Alguns caracteres vieram ilegíveis. Digite o texto de novo.',
    so_o_dono: 'Só você, na conta de dono, pode fazer esta alteração.',
    forbidden_project_scope: 'Seu acesso não permite fazer esta alteração.',
  }
  for (const [codigo, texto] of Object.entries(mensagens)) assert.equal(mensagemDaEscrita(codigo), texto)
  for (const codigo of ['internal_error', 'toString', undefined]) {
    assert.equal(mensagemDaEscrita(codigo), 'Não foi possível salvar agora. Tente novamente.')
  }
})

test('rótulos de edição distinguem salvar, corrigir, desfazer e aposentar', () => {
  const regra = { ...base, tipo: 'regra' } as const
  const verificacao = { ...base, tipo: 'verificacao' } as const
  assert.deepEqual(rotulosDaEdicao({ tipo: 'criar', categoria: 'regra' }), {
    titulo: 'Nova regra', campo: 'Texto da regra', botao: 'Salvar regra', sucesso: 'Regra salva.',
  })
  assert.deepEqual(rotulosDaEdicao({ tipo: 'criar', categoria: 'verificacao' }), {
    titulo: 'Nova verificação', campo: 'O que precisa ser conferido', botao: 'Salvar verificação', sucesso: 'Verificação salva.',
  })
  assert.deepEqual(rotulosDaEdicao({ tipo: 'corrigir', licao: regra }), {
    titulo: 'Corrigir regra', campo: 'Texto da regra', botao: 'Salvar correção', sucesso: 'Correção salva.',
  })
  assert.deepEqual(rotulosDaEdicao({ tipo: 'corrigir', licao: verificacao }), {
    titulo: 'Corrigir verificação', campo: 'O que precisa ser conferido', botao: 'Salvar correção', sucesso: 'Correção salva.',
  })
  assert.deepEqual(rotulosDaEdicao({ tipo: 'aposentar', licao: regra }), {
    titulo: 'Desfazer regra', campo: 'Motivo', botao: 'Desfazer regra', sucesso: 'Regra desfeita.',
  })
  assert.deepEqual(rotulosDaEdicao({ tipo: 'aposentar', licao: verificacao }), {
    titulo: 'Desfazer verificação', campo: 'Motivo', botao: 'Desfazer verificação', sucesso: 'Verificação desfeita.',
  })
  assert.deepEqual(rotulosDaEdicao({ tipo: 'aposentar', licao: base }), {
    titulo: 'Aposentar erro', campo: 'Motivo', botao: 'Aposentar erro', sucesso: 'Erro aposentado.',
  })
})
