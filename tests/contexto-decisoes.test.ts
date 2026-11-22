import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ContextSection } from '../shared/context.js'
import type { Licao } from '../shared/licoes.js'
import type { Task } from '../shared/types.js'
import {
  autoridadeDaFonte,
  escolherTarefaEmFoco,
  gruposDasLicoesDoDono,
  secaoSeHouverItens,
} from '../server/contexto/decisoes.js'
import * as secoes from '../server/contexto/secoes.js'

/** As decisões do contexto compilado, em módulo puro: quem manda na fonte, qual tarefa fica em foco, quais lições são do dono. */

function licao(id: string, tipo: Licao['tipo']): Licao {
  return {
    id,
    projectId: 'p',
    texto: `texto ${id}`,
    origem: 'Claude',
    criadaEm: '2026-11-19T10:00:00.000Z',
    aposentadaEm: null,
    motivoAposentadoria: null,
    tipo,
    fraseDoDono: tipo === 'erro' ? null : 'frase',
    momento: tipo === 'verificacao' ? 'antes_de_subir' : null,
    linhaCurta: null,
    substituiId: null,
  }
}

function tarefa(id: string): Task {
  return { id } as Task
}

describe('autoridadeDaFonte', () => {
  it('só a diretriz do dono manda; o resto é referência', () => {
    assert.equal(autoridadeDaFonte('human_directive'), 'directive')
    assert.equal(autoridadeDaFonte('agent_report'), 'reference')
    assert.equal(autoridadeDaFonte('external_source'), 'reference')
  })
})

describe('escolherTarefaEmFoco', () => {
  const a = tarefa('a')
  const b = tarefa('b')
  const c = tarefa('c')

  it('modo projeto: nenhuma tarefa, mesmo com pedida e reservada', () => {
    assert.equal(escolherTarefaEmFoco('project', a, [b]), null)
    assert.equal(escolherTarefaEmFoco('project', null, [b]), null)
  })

  it('a tarefa pedida vence a reservada', () => {
    assert.equal(escolherTarefaEmFoco('auto', a, [b]), a)
    assert.equal(escolherTarefaEmFoco('auto', a, [b, c]), a)
    assert.equal(escolherTarefaEmFoco('auto', a, []), a)
  })

  it('sem pedida: a única reservada fica em foco; duas ou nenhuma, não', () => {
    assert.equal(escolherTarefaEmFoco('auto', null, [b]), b)
    assert.equal(escolherTarefaEmFoco('auto', null, [b, c]), null)
    assert.equal(escolherTarefaEmFoco('auto', null, []), null)
  })
})

describe('gruposDasLicoesDoDono', () => {
  it('separa regras e verificações, na ordem em que vieram, e deixa os erros de fora', () => {
    const lista = [licao('e1', 'erro'), licao('r1', 'regra'), licao('v1', 'verificacao'), licao('r2', 'regra'), licao('e2', 'erro'), licao('v2', 'verificacao')]
    const grupos = gruposDasLicoesDoDono(lista)
    assert.deepEqual(grupos.regras.map((l) => l.id), ['r1', 'r2'])
    assert.deepEqual(grupos.verificacoes.map((l) => l.id), ['v1', 'v2'])
  })

  it('sem nenhuma lição do dono, os dois grupos ficam vazios', () => {
    assert.deepEqual(gruposDasLicoesDoDono([]), { regras: [], verificacoes: [] })
    assert.deepEqual(gruposDasLicoesDoDono([licao('e1', 'erro')]), { regras: [], verificacoes: [] })
  })
})

describe('secaoSeHouverItens', () => {
  const montar = (itens: string[]): ContextSection => ({ kind: 'decisions', title: 'T', items: itens.map((id) => ({ id }) as never) })

  it('sem itens, nenhuma seção, e a função de montar nem é chamada', () => {
    let chamadas = 0
    const resultado = secaoSeHouverItens([], (itens: string[]) => {
      chamadas += 1
      return montar(itens)
    })
    assert.deepEqual(resultado, [])
    assert.equal(chamadas, 0)
  })

  it('com itens, uma seção montada com eles', () => {
    const resultado = secaoSeHouverItens(['x', 'y'], montar)
    assert.equal(resultado.length, 1)
    assert.deepEqual(resultado[0].items.map((i) => i.id), ['x', 'y'])
  })
})

describe('secoes.ts continua oferecendo as mesmas funções', () => {
  it('autoridadeDaFonte e escolherTarefaEmFoco saem dos dois módulos como a mesma função', () => {
    assert.equal(secoes.autoridadeDaFonte, autoridadeDaFonte)
    assert.equal(secoes.escolherTarefaEmFoco, escolherTarefaEmFoco)
  })

  it('secoesDasLicoesDoDono: regras primeiro, verificações depois, só as que existem', () => {
    const tipos = (lista: Licao[]) => secoes.secoesDasLicoesDoDono(lista).map((s) => s.kind)
    assert.deepEqual(tipos([]), [])
    assert.deepEqual(tipos([licao('e1', 'erro')]), [])
    assert.deepEqual(tipos([licao('v1', 'verificacao'), licao('e1', 'erro')]), ['verificacoes'])
    assert.deepEqual(tipos([licao('r1', 'regra')]), ['regras_do_dono'])
    assert.deepEqual(tipos([licao('v1', 'verificacao'), licao('r1', 'regra')]), ['regras_do_dono', 'verificacoes'])
  })
})
