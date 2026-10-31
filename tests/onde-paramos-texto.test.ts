process.env.TZ = 'America/Sao_Paulo'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { GrupoFalta, ItemFalta, MesFeito, OrigemItem } from '../shared/carta.ts'
import {
  abaInicial,
  atorDaConfirmacao,
  contar,
  cortarTexto,
  dataPorExtenso,
  diaEMes,
  dicaDoItem,
  etapaDoItem,
  formatarHaDias,
  fraseParaContinuar,
  gruposDaFalta,
  linhaDeSaude,
  nomeDoMes,
  podeConfirmar,
  rotuloDaOrigem,
  rotuloDoMes,
  ultimaVezAqui,
} from '../src/onde-paramos/texto.ts'

function item(extra: Partial<ItemFalta> = {}): ItemFalta {
  return { origem: 'cartao', id: 'i1', titulo: 'Item', detalhe: null, etapa: null, versao: 0, ...extra }
}

describe('formatarHaDias', () => {
  it('hoje, ontem e há N dias', () => {
    assert.equal(formatarHaDias(0), 'hoje')
    assert.equal(formatarHaDias(1), 'ontem')
    assert.equal(formatarHaDias(2), 'há 2 dias')
    assert.equal(formatarHaDias(8), 'há 8 dias')
    assert.equal(formatarHaDias(30), 'há 30 dias')
  })

  it('valor negativo (relógio adiantado) não vira "há -1 dias": é hoje', () => {
    assert.equal(formatarHaDias(-1), 'hoje')
  })
})

describe('nomeDoMes', () => {
  it('os doze meses em português, com o ano', () => {
    const esperado = [
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    ]
    esperado.forEach((nome, indice) => {
      const mes = String(indice + 1).padStart(2, '0')
      assert.equal(nomeDoMes(`2026-${mes}`), `${nome} de 2026`)
    })
  })

  it('usa o ano que veio no texto', () => {
    assert.equal(nomeDoMes('2025-12'), 'dezembro de 2025')
  })

  it('o que não é "AAAA-MM" volta como veio, sem inventar mês', () => {
    for (const invalido of ['2026-13', '2026-00', '26-10', '2026-1', '2026-10-05', 'x2026-10', '2026-10x', 'outubro', '']) {
      assert.equal(nomeDoMes(invalido), invalido, invalido)
    }
  })
})

describe('fraseParaContinuar', () => {
  it('frase pronta para colar no Claude Code', () => {
    assert.equal(fraseParaContinuar('Alfa Exemplo'), 'Retome o projeto Alfa Exemplo de onde paramos.')
  })
})

describe('abaInicial', () => {
  it('parado há 7 dias ou mais abre pela carta; antes disso, na aba de sempre', () => {
    assert.equal(abaInicial(null), 'overview')
    assert.equal(abaInicial(0), 'overview')
    assert.equal(abaInicial(6), 'overview')
    assert.equal(abaInicial(7), 'carta')
    assert.equal(abaInicial(8), 'carta')
    assert.equal(abaInicial(120), 'carta')
  })
})

describe('datas no horário do navegador', () => {
  it('dataPorExtenso: dia sem zero à esquerda, mês e ano', () => {
    assert.equal(dataPorExtenso('2026-10-17T15:00:00.000Z'), '17 de outubro de 2026')
    assert.equal(dataPorExtenso('2026-01-05T12:00:00.000Z'), '5 de janeiro de 2026')
  })

  it('dataPorExtenso: a virada de dia vale no horário local (UTC-3)', () => {
    assert.equal(dataPorExtenso('2026-11-01T01:00:00.000Z'), '31 de outubro de 2026')
  })

  it('dataPorExtenso: texto que não é data volta como veio', () => {
    assert.equal(dataPorExtenso('ontem'), 'ontem')
  })

  it('diaEMes: dd/mm com zero à esquerda', () => {
    assert.equal(diaEMes('2026-03-05T15:00:00.000Z'), '05/03')
    assert.equal(diaEMes('2026-10-25T00:30:00.000Z'), '24/10')
  })
})

describe('ultimaVezAqui', () => {
  it('data por extenso e há quantos dias', () => {
    assert.equal(ultimaVezAqui('2026-10-17T15:00:00.000Z', 8), 'Última vez aqui: 17 de outubro de 2026 (há 8 dias)')
    assert.equal(ultimaVezAqui('2026-10-17T15:00:00.000Z', 1), 'Última vez aqui: 17 de outubro de 2026 (ontem)')
    assert.equal(ultimaVezAqui('2026-10-17T15:00:00.000Z', 0), 'Última vez aqui: 17 de outubro de 2026 (hoje)')
  })

  it('sem número de dias, a data aparece sem parênteses', () => {
    assert.equal(ultimaVezAqui('2026-10-17T15:00:00.000Z', null), 'Última vez aqui: 17 de outubro de 2026')
  })

  it('sem atividade registrada, diz isso com todas as letras', () => {
    assert.equal(ultimaVezAqui(null, null), 'Ainda não há atividade registrada neste projeto.')
  })
})

describe('linhaDeSaude', () => {
  const SEM_DADO = { ultimoRegistroAutomatico: null, ultimoErro: null }

  it('sem nenhum dado, não há linha (regra de honestidade)', () => {
    assert.equal(linhaDeSaude(SEM_DADO, null), null)
    assert.equal(linhaDeSaude(SEM_DADO, '2026-10-25T15:00:00.000Z'), null)
  })

  it('último registro automático: dia, mês e hora local sem zero à esquerda', () => {
    const saude = { ultimoRegistroAutomatico: '2026-10-26T00:30:00.000Z', ultimoErro: null }
    assert.equal(linhaDeSaude(saude, null), 'Último registro automático em 25/10, 21h.')
    const manha = { ultimoRegistroAutomatico: '2026-10-25T12:00:00.000Z', ultimoErro: null }
    assert.equal(linhaDeSaude(manha, null), 'Último registro automático em 25/10, 9h.')
  })

  it('registro tão recente quanto a atividade do projeto: sem alarme', () => {
    const saude = { ultimoRegistroAutomatico: '2026-10-26T00:30:00.000Z', ultimoErro: null }
    assert.equal(linhaDeSaude(saude, '2026-10-26T00:30:00.000Z'), 'Último registro automático em 25/10, 21h.')
    assert.equal(linhaDeSaude(saude, '2026-10-20T00:30:00.000Z'), 'Último registro automático em 25/10, 21h.')
  })

  it('o projeto andou e a conexão ficou calada há 2 dias ou mais: avisa desde quando', () => {
    const saude = { ultimoRegistroAutomatico: '2026-10-12T15:00:00.000Z', ultimoErro: null }
    assert.equal(linhaDeSaude(saude, '2026-10-24T15:00:00.000Z'), 'A conexão com o Claude não registrou nada desde 12/10.')
    // 48 horas exatas já contam; 47h59 ainda não.
    assert.equal(linhaDeSaude(saude, '2026-10-14T15:00:00.000Z'), 'A conexão com o Claude não registrou nada desde 12/10.')
    assert.equal(linhaDeSaude(saude, '2026-10-14T14:59:00.000Z'), 'Último registro automático em 12/10, 12h.')
  })

  it('erro da conexão: mostra o texto e fecha com ponto', () => {
    assert.equal(
      linhaDeSaude({ ultimoRegistroAutomatico: null, ultimoErro: 'Banco travado por outro processo' }, null),
      'Último erro da conexão: Banco travado por outro processo.',
    )
  })

  it('erro que já termina em pontuação não ganha outro ponto', () => {
    for (const fim of ['.', '!', '?', '…']) {
      assert.equal(
        linhaDeSaude({ ultimoRegistroAutomatico: null, ultimoErro: `Falhou${fim}` }, null),
        `Último erro da conexão: Falhou${fim}`,
      )
    }
  })

  it('pontuação no meio do erro não conta: só o fim da frase decide', () => {
    assert.equal(
      linhaDeSaude({ ultimoRegistroAutomatico: null, ultimoErro: 'Falhou. Banco travado' }, null),
      'Último erro da conexão: Falhou. Banco travado.',
    )
  })

  it('erro enorme é cortado em 160 caracteres', () => {
    const justo = 'e'.repeat(160)
    assert.equal(linhaDeSaude({ ultimoRegistroAutomatico: null, ultimoErro: justo }, null), `Último erro da conexão: ${justo}.`)
    const grande = 'e'.repeat(161)
    assert.equal(
      linhaDeSaude({ ultimoRegistroAutomatico: null, ultimoErro: grande }, null),
      `Último erro da conexão: ${'e'.repeat(159)}…`,
    )
  })

  it('registro e erro juntos: duas frases na mesma linha', () => {
    const saude = { ultimoRegistroAutomatico: '2026-10-26T00:30:00.000Z', ultimoErro: 'Sem permissão' }
    assert.equal(
      linhaDeSaude(saude, null),
      'Último registro automático em 25/10, 21h. Último erro da conexão: Sem permissão.',
    )
  })
})

describe('cortarTexto', () => {
  it('texto que cabe volta inteiro', () => {
    assert.equal(cortarTexto('abc', 3), 'abc')
    assert.equal(cortarTexto('', 3), '')
  })

  it('texto que passa do limite sai com reticências e no máximo `limite` caracteres', () => {
    assert.equal(cortarTexto('abcd', 3), 'ab…')
    assert.equal(cortarTexto('abcdefghij', 5), 'abcd…')
  })

  it('não deixa espaço pendurado antes das reticências', () => {
    assert.equal(cortarTexto('abc def', 5), 'abc…')
  })
})

describe('gruposDaFalta', () => {
  const vazio: Record<GrupoFalta, ItemFalta[]> = { precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [] }

  it('sem nada faltando, nenhum grupo', () => {
    assert.deepEqual(gruposDaFalta(vazio), [])
  })

  it('cinco grupos na ordem do produto, com o nome certo; só os que têm itens', () => {
    const a = item({ id: 'a' })
    const b = item({ id: 'b' })
    // Chaves em ordem embaralhada de propósito: a ordem vem da regra, não do objeto.
    const falta: Record<GrupoFalta, ItemFalta[]> = {
      ideias: [b], a_fazer: [a], travado: [a, b], em_andamento: [b], precisa_de_voce: [a],
    }
    assert.deepEqual(gruposDaFalta(falta), [
      { id: 'precisa_de_voce', titulo: 'Precisa de você', recolhido: false, itens: [a] },
      { id: 'travado', titulo: 'Travado', recolhido: false, itens: [a, b] },
      { id: 'em_andamento', titulo: 'Em andamento', recolhido: false, itens: [b] },
      { id: 'a_fazer', titulo: 'A fazer', recolhido: false, itens: [a] },
      { id: 'ideias', titulo: 'Ideias guardadas', recolhido: true, itens: [b] },
    ])
  })

  it('grupo vazio não aparece, mesmo entre outros cheios', () => {
    const a = item({ id: 'a' })
    const falta = { ...vazio, travado: [a], ideias: [a] }
    assert.deepEqual(gruposDaFalta(falta).map((g) => g.id), ['travado', 'ideias'])
  })
})

describe('rótulos dos itens', () => {
  it('rotuloDaOrigem: um nome em português para cada origem', () => {
    const esperado: Record<OrigemItem, string> = {
      cartao: 'Cartão do quadro',
      tarefa: 'Tarefa',
      backlog: 'Backlog',
      aprovacao: 'Aprovação pendente',
      decisao: 'Decisão proposta',
      bloqueio: 'Bloqueio',
    }
    for (const [origem, rotulo] of Object.entries(esperado)) {
      assert.equal(rotuloDaOrigem(origem as OrigemItem), rotulo, origem)
    }
  })

  it('dicaDoItem: só a aprovação precisa de uma dica de onde responder', () => {
    assert.equal(dicaDoItem(item({ origem: 'aprovacao' })), 'Responda na Visão geral, em "Esperando por você".')
    for (const origem of ['cartao', 'tarefa', 'backlog', 'decisao', 'bloqueio'] as OrigemItem[]) {
      assert.equal(dicaDoItem(item({ origem })), null, origem)
    }
  })

  it('etapaDoItem: a etapa só aparece em "Em andamento"', () => {
    const emTeste = item({ etapa: 'Em teste' })
    assert.equal(etapaDoItem('em_andamento', emTeste), 'Em teste')
    assert.equal(etapaDoItem('em_andamento', item({ etapa: null })), null)
    for (const grupo of ['precisa_de_voce', 'travado', 'a_fazer', 'ideias'] as GrupoFalta[]) {
      assert.equal(etapaDoItem(grupo, emTeste), null, grupo)
    }
  })

  it('rotuloDoMes: mês por extenso e quantos itens', () => {
    const mes = (n: number): MesFeito => ({
      mes: '2026-08',
      itens: Array.from({ length: n }, (_, i) => ({ origem: 'cartao', id: `c${i}`, texto: 'x', quando: '2026-08-10T12:00:00.000Z' })),
    })
    assert.equal(rotuloDoMes(mes(1)), 'agosto de 2026 · 1 item')
    assert.equal(rotuloDoMes(mes(3)), 'agosto de 2026 · 3 itens')
  })
})

describe('contar', () => {
  it('singular só para 1', () => {
    assert.equal(contar(0, 'item', 'itens'), '0 itens')
    assert.equal(contar(1, 'item', 'itens'), '1 item')
    assert.equal(contar(2, 'item', 'itens'), '2 itens')
    assert.equal(contar(13, 'ideia', 'ideias'), '13 ideias')
  })
})

describe('confirmação de decisão', () => {
  it('podeConfirmar: só decisão com versão conhecida (versão 0 vale)', () => {
    assert.equal(podeConfirmar(item({ origem: 'decisao', versao: 0 })), true)
    assert.equal(podeConfirmar(item({ origem: 'decisao', versao: 4 })), true)
    assert.equal(podeConfirmar(item({ origem: 'decisao', versao: null })), false)
    assert.equal(podeConfirmar(item({ origem: 'aprovacao', versao: 3 })), false)
    assert.equal(podeConfirmar(item({ origem: 'cartao', versao: 3 })), false)
  })

  it('atorDaConfirmacao: nome da conta logada; sem conta, "Dono"', () => {
    assert.equal(atorDaConfirmacao(null), 'Dono')
    assert.equal(atorDaConfirmacao({ displayName: 'Maria Souza', username: 'maria' }), 'Maria Souza')
  })

  it('atorDaConfirmacao: nome em branco cai no usuário; os dois em branco, "Dono"', () => {
    assert.equal(atorDaConfirmacao({ displayName: '   ', username: 'maria' }), 'maria')
    assert.equal(atorDaConfirmacao({ displayName: '', username: '  ' }), 'Dono')
  })

  it('atorDaConfirmacao: tira espaços das pontas e respeita o limite de 80 caracteres do servidor', () => {
    assert.equal(atorDaConfirmacao({ displayName: '  Ana  ', username: 'ana' }), 'Ana')
    assert.equal(atorDaConfirmacao({ displayName: 'n'.repeat(80), username: 'x' }), 'n'.repeat(80))
    assert.equal(atorDaConfirmacao({ displayName: 'n'.repeat(81), username: 'x' }), 'n'.repeat(80))
    assert.equal(atorDaConfirmacao({ displayName: '', username: 'u'.repeat(100) }), 'u'.repeat(80))
  })
})
