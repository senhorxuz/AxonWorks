import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cabecalhoDaSecao,
  escolherPorOrcamento,
  ordemDePrioridade,
  posicaoDaPrioridade,
  PRIORIDADE_DAS_SECOES,
  type ItemCandidato,
  type SaidaDoOrcamento,
  type SecaoCandidata,
} from '../server/contexto/orcamento.js'

const CABECALHO = 'CAB'
const AVISO = 'AVISO'
const FIXO = CABECALHO.length + AVISO.length

/** Texto de exatamente `n` caracteres, começando por `marca`. */
function t(marca: string, n: number): string {
  return marca.padEnd(n, '.')
}

function item(dado: string, tamanho: number, curto?: number): ItemCandidato<string> {
  return curto === undefined
    ? { dado, texto: t(dado, tamanho) }
    : { dado, texto: t(dado, tamanho), curto: { dado: `${dado}-curto`, texto: t(`${dado}-curto`, curto) } }
}

function secao(kind: string, itens: Array<ItemCandidato<string>>): SecaoCandidata<string> {
  return { kind, titulo: `T-${kind}`, itens }
}

function custo(kind: string): number {
  return cabecalhoDaSecao(`T-${kind}`).length
}

function rodar(secoes: Array<SecaoCandidata<string>>, folga: number): SaidaDoOrcamento<string> {
  return escolherPorOrcamento({ cabecalho: CABECALHO, aviso: AVISO, secoes, maxChars: FIXO + folga })
}

function dados(saida: SaidaDoOrcamento<string>): Record<string, string[]> {
  return Object.fromEntries(saida.secoes.map((s) => [s.kind, s.itens.map((i) => i.dado)]))
}

/** O corte guloso de antes, na ordem de leitura: serve de referência quando tudo cabe. */
function guloso(secoes: Array<SecaoCandidata<string>>, maxChars: number): string {
  let markdown = CABECALHO
  let cortou = false
  for (const s of secoes) {
    let abriu = false
    for (const i of s.itens) {
      const cab = abriu ? 0 : cabecalhoDaSecao(s.titulo).length
      if (markdown.length + cab + i.texto.length + AVISO.length <= maxChars) {
        markdown += (abriu ? '' : cabecalhoDaSecao(s.titulo)) + i.texto
        abriu = true
      } else cortou = true
    }
  }
  return cortou ? markdown + AVISO : markdown
}

describe('cabeçalho de seção', () => {
  it('tem a forma do markdown de hoje', () => {
    assert.equal(cabecalhoDaSecao('Charter vigente'), '\n\n## Charter vigente\n')
  })
})

describe('prioridade das seções', () => {
  it('segue a ordem do contrato', () => {
    assert.deepEqual([...PRIORIDADE_DAS_SECOES], [
      'regras_do_dono', 'verificacoes', 'attention', 'deliveries', 'focus_task', 'checkpoint', 'blockers',
      'charter', 'decisions', 'work_draft', 'stale_evidence', 'overlaps', 'library_content', 'inbox',
      'board', 'backlog',
    ])
  })

  it('a posição é o lugar na lista; sem prioridade fica entre a caixa de entrada e o quadro', () => {
    assert.equal(posicaoDaPrioridade('regras_do_dono'), 0)
    assert.equal(posicaoDaPrioridade('inbox'), 13)
    assert.equal(posicaoDaPrioridade('board'), 14)
    assert.equal(posicaoDaPrioridade('seção_nova'), 13.5)
  })

  it('ordena por prioridade e mantém a ordem de leitura no empate', () => {
    assert.deepEqual(
      ordemDePrioridade(['board', 'novo_a', 'inbox', 'charter', 'novo_b', 'attention', 'backlog']),
      [5, 3, 2, 1, 4, 0, 6],
    )
  })

  it('o empate entre várias seções sem prioridade mantém a ordem de leitura', () => {
    assert.deepEqual(ordemDePrioridade(['n1', 'n2', 'n3', 'n4', 'n5']), [0, 1, 2, 3, 4])
    assert.deepEqual(ordemDePrioridade(['n1', 'inbox', 'n2', 'attention', 'n3', 'n4']), [3, 1, 0, 2, 4, 5])
  })

  it('os kinds que a frente B vai criar passam na frente de tudo', () => {
    assert.deepEqual(ordemDePrioridade(['attention', 'verificacoes', 'regras_do_dono']), [2, 1, 0])
  })
})

describe('quando tudo cabe', () => {
  it('a saída é a do corte guloso de antes, sem aviso e sem cortes', () => {
    const secoes = [
      secao('charter', [item('c1', 30)]),
      secao('checkpoint', [item('k1', 40, 10)]),
      secao('inbox', [item('m1', 20), item('m2', 25)]),
      secao('board', [item('b1', 15)]),
    ]
    const folga = secoes.reduce((s, x) => s + custo(x.kind) + x.itens.reduce((a, i) => a + i.texto.length, 0), 0)
    const saida = rodar(secoes, folga)
    assert.equal(saida.markdown, guloso(secoes, FIXO + folga))
    assert.equal(saida.truncated, false)
    assert.deepEqual(saida.cutSections, [])
    assert.deepEqual(saida.omittedCounts, {})
    assert.deepEqual(dados(saida), { charter: ['c1'], checkpoint: ['k1'], inbox: ['m1', 'm2'], board: ['b1'] })
    assert.ok(saida.secoes.every((s) => s.omitidos === 0 && s.itens.every((i) => !i.curto)))
    assert.ok(!saida.markdown.includes(AVISO))
  })

  it('sem seções, o texto é só o cabeçalho', () => {
    const saida = rodar([], 10)
    assert.equal(saida.markdown, CABECALHO)
    assert.deepEqual(saida.secoes, [])
    assert.equal(saida.truncated, false)
  })

  it('a seção sem itens vai para cutSections sem contar como item omitido', () => {
    const saida = rodar([secao('inbox', []), secao('board', [item('b', 10)])], 100)
    assert.deepEqual(saida.cutSections, ['inbox'])
    assert.deepEqual(saida.omittedCounts, {})
    assert.equal(saida.truncated, false)
    assert.deepEqual(dados(saida), { board: ['b'] })
  })
})

describe('orçamento exato', () => {
  it('cabe com folga zero e deixa de caber com um caractere a menos', () => {
    const s = [secao('inbox', [item('m', 20)])]
    const cabe = rodar(s, custo('inbox') + 20)
    assert.deepEqual(dados(cabe), { inbox: ['m'] })
    assert.equal(cabe.markdown.length, FIXO + custo('inbox') + 20 - AVISO.length)
    const nao = rodar(s, custo('inbox') + 19)
    assert.deepEqual(dados(nao), {})
    assert.equal(nao.markdown, CABECALHO + AVISO)
    assert.deepEqual(nao.cutSections, ['inbox'])
    assert.equal(nao.truncated, true)
  })

  it('o aviso fica reservado: se tudo só coubesse sem ele, o último item sai', () => {
    const s = [secao('inbox', [item('m1', 20), item('m2', 20)])]
    const folga = custo('inbox') + 40 - AVISO.length
    const saida = rodar(s, folga)
    assert.deepEqual(dados(saida), { inbox: ['m1'] })
    assert.equal(saida.secoes[0]!.omitidos, 1)
    assert.ok(saida.markdown.length <= FIXO + folga)
    assert.equal(saida.markdown, guloso(s, FIXO + folga))
    assert.ok(saida.markdown.endsWith(AVISO))
  })

  it('o cabeçalho da seção só é cobrado uma vez, no primeiro item', () => {
    const s = [secao('inbox', [item('m1', 10), item('m2', 10), item('m3', 10)])]
    const saida = rodar(s, custo('inbox') + 30)
    assert.deepEqual(dados(saida), { inbox: ['m1', 'm2', 'm3'] })
    assert.equal(saida.truncated, false)
  })

  it('o cabeçalho de uma seção que ficou sem item não gasta orçamento', () => {
    const s = [secao('charter', [item('c', 500)]), secao('inbox', [item('m', 10)])]
    const saida = rodar(s, custo('inbox') + 10)
    assert.deepEqual(dados(saida), { inbox: ['m'] })
    assert.deepEqual(saida.cutSections, ['charter'])
  })

  it('um item menor, depois de um maior que não coube, ainda entra', () => {
    const s = [secao('inbox', [item('grande', 100), item('pequeno', 10)])]
    const saida = rodar(s, custo('inbox') + 10)
    assert.deepEqual(dados(saida), { inbox: ['pequeno'] })
    assert.equal(saida.secoes[0]!.omitidos, 1)
    assert.deepEqual(saida.omittedCounts, { inbox: 1 })
  })
})

describe('escolha por prioridade', () => {
  it('sem espaço para tudo, a seção de maior prioridade leva o espaço, e o texto segue a ordem de leitura', () => {
    const s = [
      secao('charter', [item('c', 60)]),
      secao('deliveries', [item('d', 60)]),
      secao('board', [item('b', 60)]),
    ]
    const saida = rodar(s, custo('deliveries') + 60 + custo('board') + 60)
    assert.deepEqual(dados(saida), { deliveries: ['d'], board: ['b'] })
    assert.deepEqual(saida.cutSections, ['charter'])
    assert.deepEqual(saida.omittedCounts, { charter: 1 })
    assert.deepEqual(saida.secoes.map((x) => x.kind), ['deliveries', 'board'])
    assert.ok(saida.markdown.indexOf('d.') < saida.markdown.indexOf('b.'))
  })

  it('o quadro e o backlog só usam o que sobra', () => {
    const s = [
      secao('board', [item('b', 30)]),
      secao('backlog', [item('k', 30)]),
      secao('inbox', [item('m', 30)]),
    ]
    const saida = rodar(s, custo('inbox') + 30 + custo('board') + 30)
    assert.deepEqual(dados(saida), { board: ['b'], inbox: ['m'] })
    assert.deepEqual(saida.cutSections, ['backlog'])
  })

  it('seção sem prioridade declarada passa na frente do quadro e atrás da caixa de entrada', () => {
    const s = [
      secao('board', [item('b', 30)]),
      secao('nova', [item('n', 30)]),
      secao('inbox', [item('m', 30)]),
    ]
    const saida = rodar(s, custo('inbox') + 30 + custo('nova') + 30)
    assert.deepEqual(dados(saida), { nova: ['n'], inbox: ['m'] })
    assert.deepEqual(saida.cutSections, ['board'])
    const outra = rodar(s, custo('inbox') + 30)
    assert.deepEqual(dados(outra), { inbox: ['m'] })
  })

  it('duas seções sem prioridade ficam na ordem em que vieram', () => {
    const s = [secao('nova_a', [item('a', 30)]), secao('nova_b', [item('b', 30)])]
    const saida = rodar(s, custo('nova_a') + 30)
    assert.deepEqual(dados(saida), { nova_a: ['a'] })
    assert.deepEqual(saida.cutSections, ['nova_b'])
  })

  it('dentro da seção, os itens seguem a ordem em que vieram', () => {
    const s = [secao('decisions', [item('d1', 30), item('d2', 30), item('d3', 30)])]
    const saida = rodar(s, custo('decisions') + 60)
    assert.deepEqual(dados(saida), { decisions: ['d1', 'd2'] })
    assert.deepEqual(saida.omittedCounts, { decisions: 1 })
  })

  it('o contador soma quando duas seções têm o mesmo kind', () => {
    const s = [secao('nova', [item('a', 100)]), secao('nova', [item('b', 100), item('c', 100)])]
    const saida = rodar(s, 10)
    assert.deepEqual(saida.omittedCounts, { nova: 3 })
    assert.deepEqual(saida.cutSections, ['nova', 'nova'])
  })

  it('omittedCounts só tem os kinds que perderam item', () => {
    const s = [secao('inbox', [item('m', 10)]), secao('board', [item('b', 100)])]
    const saida = rodar(s, custo('inbox') + 10)
    assert.deepEqual(saida.omittedCounts, { board: 1 })
  })
})

describe('forma curta', () => {
  const inteiro = 100
  const curto = 20

  it('entra a curta quando o inteiro não cabe, e o item vem marcado', () => {
    const saida = rodar([secao('checkpoint', [item('k', inteiro, curto)])], custo('checkpoint') + curto + 30)
    assert.deepEqual(saida.secoes[0]!.itens, [{ dado: 'k-curto', curto: true }])
    assert.ok(saida.markdown.includes(t('k-curto', curto)))
    assert.ok(!saida.markdown.includes(t('k', inteiro)))
    assert.deepEqual(saida.omittedCounts, {})
    assert.equal(saida.truncated, false)
    assert.deepEqual(saida.cutSections, [])
  })

  it('o inteiro vence quando cabe', () => {
    const saida = rodar([secao('checkpoint', [item('k', inteiro, curto)])], custo('checkpoint') + inteiro)
    assert.deepEqual(saida.secoes[0]!.itens, [{ dado: 'k', curto: false }])
  })

  it('a curta cabe no limite exato; um caractere a menos e o item sai e conta como omitido', () => {
    const s = [secao('checkpoint', [item('k', inteiro, curto)])]
    const justo = rodar(s, custo('checkpoint') + curto)
    assert.deepEqual(justo.secoes[0]!.itens, [{ dado: 'k-curto', curto: true }])
    const falta = rodar(s, custo('checkpoint') + curto - 1)
    assert.deepEqual(falta.secoes, [])
    assert.deepEqual(falta.omittedCounts, { checkpoint: 1 })
    assert.deepEqual(falta.cutSections, ['checkpoint'])
    assert.equal(falta.truncated, true)
  })

  it('o item sem forma curta que não cabe fica de fora', () => {
    const saida = rodar([secao('checkpoint', [item('k', inteiro)])], custo('checkpoint') + curto)
    assert.deepEqual(saida.secoes, [])
    assert.deepEqual(saida.omittedCounts, { checkpoint: 1 })
  })

  it('a curta leva o espaço do cabeçalho da seção na conta', () => {
    const saida = rodar([secao('checkpoint', [item('k', inteiro, curto)])], curto)
    assert.deepEqual(saida.secoes, [])
  })

  it('o checkpoint curto não tira o lugar de quem tem prioridade maior', () => {
    const s = [
      secao('checkpoint', [item('k', inteiro, curto)]),
      secao('deliveries', [item('d', 50)]),
    ]
    const saida = rodar(s, custo('deliveries') + 50 + custo('checkpoint') + curto)
    assert.deepEqual(dados(saida), { checkpoint: ['k-curto'], deliveries: ['d'] })
    assert.deepEqual(saida.secoes.map((x) => x.kind), ['checkpoint', 'deliveries'])
  })
})

describe('tamanho final', () => {
  it('nunca passa de maxChars, com ou sem corte', () => {
    const s = [
      secao('charter', [item('c', 80, 30)]),
      secao('deliveries', [item('d', 40)]),
      secao('inbox', [item('m1', 25), item('m2', 25), item('m3', 25)]),
    ]
    for (let folga = 0; folga < 260; folga += 7) {
      const saida = rodar(s, folga)
      assert.ok(saida.markdown.length <= FIXO + folga, `folga ${folga}: ${saida.markdown.length}`)
    }
  })
})
