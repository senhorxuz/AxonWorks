import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TRILHOS, contarIAs, familiaDe, rotuloDaFamilia, trilhosDe } from '../src/fio/trilhos.ts'
import type { CoisaFeita } from '../src/fio/coisas.ts'

let n = 0
const coisa = (quem: string | undefined, extra: Partial<CoisaFeita> = {}): CoisaFeita => {
  n++
  const dia = String(1 + Math.floor(n / 3)).padStart(2, '0')
  return { chave: `registro:${n}`, quando: `2026-11-${dia}T1${n % 3}:00:00Z`, tipo: 'registro', texto: `t${n}`, ...(quem !== undefined ? { quem } : {}), ...extra }
}

describe('familiaDe: a primeira sequência de letras, sem caixa nem acento', () => {
  it('Claude em todas as formas vira "claude"', () => {
    for (const nome of ['Claude', 'Claude Opus 5.5', 'claude-opus-5.5 (Claude Code)', 'Claude Code (Fable 5.2)', 'CLAUDE']) {
      assert.equal(familiaDe(nome), 'claude', nome)
    }
  })

  it('Codex e Fundação', () => {
    assert.equal(familiaDe('codex-gpt-6.1-sol'), 'codex')
    assert.equal(familiaDe('Fundação'), 'fundacao')
    assert.equal(familiaDe('Fundação'), familiaDe('Fundacao'))
    assert.equal(familiaDe('Fundacao1'), 'fundacao')
    assert.equal(familiaDe('Fundacao2'), 'fundacao')
  })

  it('nome que começa por número: a família é o número com as letras ("4o")', () => {
    assert.equal(familiaDe('4o'), '4o')
    assert.equal(familiaDe('4o mini'), '4o')
  })

  it('sem nenhuma letra, vale a primeira sequência de letras e números', () => {
    assert.equal(familiaDe('123'), '123')
    assert.equal(familiaDe('--- 7 ---'), '7')
  })

  it('sem nome, ou só símbolos: família vazia', () => {
    assert.equal(familiaDe(undefined), '')
    assert.equal(familiaDe(''), '')
    assert.equal(familiaDe('  ---  '), '')
  })
})

describe('rotuloDaFamilia', () => {
  it('primeira letra maiúscula, resto minúsculo, com o acento como veio', () => {
    assert.equal(rotuloDaFamilia('CLAUDE Opus'), 'Claude')
    assert.equal(rotuloDaFamilia('claude-opus'), 'Claude')
    assert.equal(rotuloDaFamilia('Fundação 2'), 'Fundação')
    assert.equal(rotuloDaFamilia('4o'), '4o')
  })

  it('sem nome: "Sem nome"', () => {
    assert.equal(rotuloDaFamilia(undefined), 'Sem nome')
    assert.equal(rotuloDaFamilia(''), 'Sem nome')
    assert.equal(rotuloDaFamilia('---'), 'Sem nome')
  })
})

describe('trilhosDe: um trilho por família', () => {
  it('as formas de Claude caem num trilho só, com total e os nomes declarados completos', () => {
    const lista = ['Claude', 'Claude Opus 5.5', 'claude-opus-5.5 (Claude Code)', 'Claude Code (Fable 5.2)', 'Claude'].map(q => coisa(q))
    const { trilhos, coisas } = trilhosDe(lista)
    assert.equal(trilhos.length, 1)
    assert.equal(trilhos[0]!.rotulo, 'Claude')
    assert.equal(trilhos[0]!.chave, 'claude')
    assert.equal(trilhos[0]!.total, 5)
    assert.equal(trilhos[0]!.outras, false)
    assert.deepEqual(trilhos[0]!.nomes, ['Claude', 'Claude Opus 5.5', 'claude-opus-5.5 (Claude Code)', 'Claude Code (Fable 5.2)'])
    assert.ok(coisas.every(c => c.trilho === 0))
  })

  it('cada coisa leva o dia (São Paulo) e o índice do trilho; a ordem dos trilhos é a da primeira aparição', () => {
    const { trilhos, coisas } = trilhosDe([
      { chave: 'tarefa:1', quando: '2026-11-21T02:30:00Z', tipo: 'tarefa', texto: 'a', quem: 'Codex' },
      { chave: 'tarefa:2', quando: '2026-11-21T12:00:00Z', tipo: 'tarefa', texto: 'b', quem: 'Claude' },
      { chave: 'tarefa:3', quando: '2026-11-22T12:00:00Z', tipo: 'tarefa', texto: 'c', quem: 'codex' },
    ])
    assert.deepEqual(trilhos.map(t => t.rotulo), ['Codex', 'Claude'])
    assert.deepEqual(coisas.map(c => c.trilho), [0, 1, 0])
    assert.deepEqual(coisas.map(c => c.dia), ['2026-11-20', '2026-11-21', '2026-11-22'])
    assert.equal(coisas[0]!.chave, 'tarefa:1')
  })

  it('rótulo: a forma mais frequente; empate, a que apareceu primeiro', () => {
    assert.equal(trilhosDe([coisa('Fundacao1'), coisa('Fundação2'), coisa('Fundação3')]).trilhos[0]!.rotulo, 'Fundação')
    assert.equal(trilhosDe([coisa('Fundacao1'), coisa('Fundação2')]).trilhos[0]!.rotulo, 'Fundacao')
    assert.equal(trilhosDe([coisa('CLAUDE'), coisa('Claude')]).trilhos[0]!.rotulo, 'Claude')
  })

  it('"4o" é a família "4o", com rótulo "4o"', () => {
    assert.equal(trilhosDe([coisa('4o')]).trilhos[0]!.rotulo, '4o')
  })

  it('item sem nome vai para o trilho "Sem nome", sem nomes declarados', () => {
    const { trilhos } = trilhosDe([coisa(undefined), coisa('Claude')])
    assert.deepEqual(trilhos.map(t => t.rotulo), ['Sem nome', 'Claude'])
    assert.equal(trilhos[0]!.chave, '')
    assert.deepEqual(trilhos[0]!.nomes, [])
  })

  it('lista vazia: nada', () => {
    assert.deepEqual(trilhosDe([]), { coisas: [], trilhos: [] })
  })
})

describe('trilhosDe: cartão concluído pelo dono', () => {
  it('entra no trilho da coisa anterior e conta nele, sem entrar nos nomes', () => {
    const { coisas, trilhos } = trilhosDe([coisa('Claude'), coisa('Codex'), coisa(undefined, { peloDono: true, tipo: 'cartao' })])
    assert.deepEqual(coisas.map(c => c.trilho), [0, 1, 1])
    assert.equal(trilhos[1]!.total, 2)
    assert.deepEqual(trilhos[1]!.nomes, ['Codex'])
  })

  it('o dono logo depois do dono herda o trilho já resolvido', () => {
    const { coisas } = trilhosDe([coisa('Claude'), coisa('Codex'), coisa(undefined, { peloDono: true }), coisa(undefined, { peloDono: true })])
    assert.deepEqual(coisas.map(c => c.trilho), [0, 1, 1, 1])
  })

  it('sem anterior, entra no da coisa seguinte (pulando outros do dono)', () => {
    const { coisas, trilhos } = trilhosDe([coisa(undefined, { peloDono: true }), coisa(undefined, { peloDono: true }), coisa('Codex')])
    assert.deepEqual(coisas.map(c => c.trilho), [0, 0, 0])
    assert.equal(trilhos.length, 1)
    assert.equal(trilhos[0]!.rotulo, 'Codex')
  })

  it('sozinho (ou só entre o dono), cai em "Sem nome"', () => {
    const { coisas, trilhos } = trilhosDe([coisa(undefined, { peloDono: true }), coisa(undefined, { peloDono: true })])
    assert.deepEqual(coisas.map(c => c.trilho), [0, 0])
    assert.deepEqual(trilhos.map(t => [t.rotulo, t.total]), [['Sem nome', 2]])
  })

  it('peloDono vale mesmo se vier um quem junto: o quem é ignorado', () => {
    const { trilhos } = trilhosDe([coisa('Claude'), coisa('Codex', { peloDono: true })])
    assert.deepEqual(trilhos.map(t => t.rotulo), ['Claude'])
  })
})

describe('trilhosDe: no máximo 6 trilhos', () => {
  it('6 famílias cabem sem juntar nada', () => {
    const { trilhos } = trilhosDe(['a', 'b', 'c', 'd', 'e', 'f'].map(q => coisa(`${q}ia`)))
    assert.equal(trilhos.length, MAX_TRILHOS)
    assert.ok(trilhos.every(t => !t.outras))
  })

  it('7 famílias viram 6 trilhos; o último é "Outras IAs" com as de menos coisas', () => {
    // a, b, c, d = 3 coisas; e = 2; f e g = 1: f e g se juntam
    const quem = ['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'c', 'd', 'd', 'd', 'e', 'e', 'f', 'g']
    const { trilhos, coisas } = trilhosDe(quem.map(q => coisa(`${q}ia`)))
    assert.deepEqual(trilhos.map(t => t.rotulo), ['Aia', 'Bia', 'Cia', 'Dia', 'Eia', 'Outras IAs'])
    const outras = trilhos[5]!
    assert.equal(outras.outras, true)
    assert.equal(outras.chave, '*outras')
    assert.equal(outras.total, 2)
    assert.deepEqual(outras.nomes, ['fia', 'gia'])
    assert.equal(coisas.length, 16)
    assert.deepEqual(coisas.slice(-2).map(c => c.trilho), [5, 5])
    assert.ok(trilhos.slice(0, 5).every(t => !t.outras))
  })

  it('duas IAs dentro de "Outras IAs" têm o mesmo índice de trilho (então não há troca entre elas)', () => {
    const { coisas } = trilhosDe(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(q => coisa(`${q}ia`)))
    const f = coisas.find(c => c.quem === 'fia')!
    const g = coisas.find(c => c.quem === 'gia')!
    assert.equal(f.trilho, 5)
    assert.equal(g.trilho, 5)
  })

  it('empate de quantidade: sai a que apareceu depois; os que ficam seguem a ordem de aparição', () => {
    const { trilhos } = trilhosDe(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'g', 'g'].map(q => coisa(`${q}ia`)))
    assert.deepEqual(trilhos.map(t => t.rotulo), ['Aia', 'Bia', 'Cia', 'Dia', 'Gia', 'Outras IAs'])
    assert.deepEqual(trilhos[5]!.nomes, ['eia', 'fia'])
  })
})

describe('contarIAs', () => {
  it('conta as famílias, inclusive as 7 de um fio com "Outras IAs"', () => {
    assert.equal(contarIAs(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(q => coisa(`${q}ia`))), 7)
  })

  it('não conta "Sem nome" nem cartão do dono', () => {
    assert.equal(contarIAs([coisa(undefined), coisa(''), coisa('Claude'), coisa('Claude Opus'), coisa('Codex', { peloDono: true })]), 1)
  })

  it('sem coisas, zero', () => {
    assert.equal(contarIAs([]), 0)
  })
})
