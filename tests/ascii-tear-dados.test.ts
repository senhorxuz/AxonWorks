import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROJETOS_NO_TEAR, atividadesDaCarta, escolherProjetos, fraseDoTear, haQuanto, janelaDoTempo, marcasDaRegua,
  resumoDoTear, rotuloDoProjeto, trilhosDoTear, ultimaVez, type Historico,
} from '../src/ascii/tear-dados.ts'
import type { Project } from '../shared/types.ts'

// O Tear: de onde vêm os trilhos (um por projeto), a régua do tempo e os textos ao lado.

const MIN = 60_000
const H = 60 * MIN
const D = 24 * H
// 31/10/2026 15:00 UTC = 12:00 em São Paulo (sábado).
const AGORA = Date.UTC(2026, 9, 31, 15)
const iso = (ms: number) => new Date(ms).toISOString()
const projeto = (id: string, atualizado: number, criado = atualizado - 10 * D): Project => ({
  id, name: `Projeto ${id}`, objective: '', workspacePath: '', createdAt: iso(criado), updatedAt: iso(atualizado), revision: 1,
})
const pronto = (...quando: number[]): Historico => ({ estado: 'pronto', quando })

describe('tear-dados: quais projetos aparecem', () => {
  it('os mais recentes primeiro, no máximo seis, e quantos ficaram de fora', () => {
    const lista = Array.from({ length: 9 }, (_, i) => projeto(`p${i}`, AGORA - i * H))
    const embaralhada = [lista[4]!, lista[0]!, lista[8]!, lista[2]!, lista[1]!, lista[7]!, lista[3]!, lista[6]!, lista[5]!]
    const { visiveis, resto } = escolherProjetos(embaralhada)
    assert.equal(PROJETOS_NO_TEAR, 6)
    assert.deepEqual(visiveis.map(p => p.id), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
    assert.equal(resto, 3)
  })

  it('com poucos projetos, todos aparecem e nada fica de fora', () => {
    const { visiveis, resto } = escolherProjetos([projeto('a', AGORA - D), projeto('b', AGORA)], 6)
    assert.deepEqual(visiveis.map(p => p.id), ['b', 'a'])
    assert.equal(resto, 0)
  })
})

describe('tear-dados: a atividade de verdade vem da carta', () => {
  it('junta o recente e o resto, em ordem do mais antigo para o mais novo', () => {
    const item = (quando: number) => ({ origem: 'registro' as const, id: String(quando), texto: 'Feito', quando: iso(quando) })
    const quando = atividadesDaCarta({
      feitoRecente: [item(AGORA - H), item(AGORA - 3 * D)],
      feitoPorMes: [{ mes: '2026-09', itens: [item(AGORA - 40 * D)] }, { mes: '2026-08', itens: [item(AGORA - 70 * D)] }],
    })
    assert.deepEqual(quando, [AGORA - 70 * D, AGORA - 40 * D, AGORA - 3 * D, AGORA - H])
  })

  it('a última vez é a mais nova entre a mudança do projeto e a última coisa feita', () => {
    const p = projeto('a', AGORA - 5 * H)
    assert.equal(ultimaVez(p, pronto(AGORA - 9 * H, AGORA - H)), AGORA - H)
    assert.equal(ultimaVez(p, pronto(AGORA - 9 * H)), AGORA - 5 * H)
    assert.equal(ultimaVez(p, pronto()), AGORA - 5 * H)
    assert.equal(ultimaVez(p, { estado: 'lendo' }), AGORA - 5 * H)
    assert.equal(ultimaVez(p, { estado: 'erro' }), AGORA - 5 * H)
  })
})

describe('tear-dados: há quanto tempo', () => {
  it('fala como gente: agora, minutos, horas, dias, meses e anos', () => {
    assert.equal(haQuanto(AGORA - 20_000, AGORA), 'agora mesmo')
    assert.equal(haQuanto(AGORA + 5 * MIN, AGORA), 'agora mesmo', 'relógio adiantado não vira tempo negativo')
    assert.equal(haQuanto(AGORA - 5 * MIN, AGORA), 'há 5 min')
    assert.equal(haQuanto(AGORA - 2 * H - 10 * MIN, AGORA), 'há 2 h')
    assert.equal(haQuanto(AGORA - D - H, AGORA), 'há 1 dia')
    assert.equal(haQuanto(AGORA - 12 * D, AGORA), 'há 12 dias')
    assert.equal(haQuanto(AGORA - 31 * D, AGORA), 'há 1 mês')
    assert.equal(haQuanto(AGORA - 100 * D, AGORA), 'há 3 meses')
    assert.equal(haQuanto(AGORA - 370 * D, AGORA), 'há 1 ano')
    assert.equal(haQuanto(AGORA - 800 * D, AGORA), 'há 2 anos')
  })
})

describe('tear-dados: o texto ao lado de cada trilho', () => {
  const p = projeto('a', AGORA - 2 * H)
  it('diz quando foi a última vez e quanto foi feito; sem dado, diz isso em vez de inventar', () => {
    assert.equal(rotuloDoProjeto(p, { estado: 'lendo' }, AGORA), 'há 2 h · lendo…')
    assert.equal(rotuloDoProjeto(p, { estado: 'erro' }, AGORA), 'há 2 h · sem histórico')
    assert.equal(rotuloDoProjeto(p, pronto(), AGORA), 'há 2 h · nada feito ainda')
    assert.equal(rotuloDoProjeto(p, pronto(AGORA - 3 * D), AGORA), 'há 2 h · 1 coisa feita')
    assert.equal(rotuloDoProjeto(p, pronto(AGORA - 3 * D, AGORA - 30 * MIN), AGORA), 'há 30 min · 2 coisas feitas')
  })

  it('o resumo conta os projetos e avisa quando só os mais recentes aparecem', () => {
    assert.equal(resumoDoTear(1), '1 projeto')
    assert.equal(resumoDoTear(6), '6 projetos')
    assert.equal(resumoDoTear(20), '20 projetos · os 6 mais recentes')
  })

  it('a frase para leitor de tela diz quantos são e qual está aceso', () => {
    const visiveis = [projeto('a', AGORA - 2 * H), projeto('b', AGORA - 3 * D)]
    assert.equal(fraseDoTear(visiveis, 2, {}, AGORA), 'Sua memória: 2 projetos. O mais recente, aceso, é Projeto a, com atividade há 2 h.')
    assert.equal(fraseDoTear([], 0, {}, AGORA), 'Sua memória: 0 projetos.')
  })
})

describe('tear-dados: a janela do tempo', () => {
  it('a janela vai do nascimento do projeto mais antigo até agora, com um pouco de folga, em horas ou dias inteiros', () => {
    assert.deepEqual(janelaDoTempo(AGORA - 20 * MIN, AGORA), { inicio: AGORA - 30 * MIN, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA - 50 * MIN, AGORA), { inicio: AGORA - H, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA - 2 * H, AGORA), { inicio: AGORA - 3 * H, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA - 6 * H, AGORA), { inicio: AGORA - 7 * H, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA - 10 * H, AGORA), { inicio: AGORA - 11 * H, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA - 23 * H, AGORA), { inicio: AGORA - 2 * D, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA - 2 * D, AGORA), { inicio: AGORA - 3 * D, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA - 10 * D, AGORA), { inicio: AGORA - 11 * D, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA - 45 * D, AGORA), { inicio: AGORA - 48 * D, fim: AGORA })
  })

  it('nunca menos de 10 minutos, e projeto muito velho não espreme a janela além de 90 dias', () => {
    assert.deepEqual(janelaDoTempo(AGORA - 400 * D, AGORA), { inicio: AGORA - 90 * D, fim: AGORA })
    assert.deepEqual(janelaDoTempo(AGORA + H, AGORA), { inicio: AGORA - 10 * MIN, fim: AGORA })
  })
})

describe('tear-dados: as marcas da régua (no fuso do dono)', () => {
  it('janela de horas e grade larga: uma marca por hora, e a meia-noite vira o dia', () => {
    const marcas = marcasDaRegua({ inicio: AGORA - 6 * H, fim: AGORA }, 120)
    assert.deepEqual(marcas.map(m => m.rotulo), ['06h', '07h', '08h', '09h', '10h', '11h', '12h'])
    assert.equal(marcas[0]!.quando, AGORA - 6 * H)
    const noite = marcasDaRegua({ inicio: Date.UTC(2026, 9, 31, 1), fim: Date.UTC(2026, 9, 31, 5) }, 60)
    assert.ok(noite.some(m => m.rotulo === '31 OUT'), noite.map(m => m.rotulo).join(','))
  })

  it('janela de uma hora: uma marca a cada 10 minutos, com hora e minuto', () => {
    const marcas = marcasDaRegua({ inicio: AGORA - H, fim: AGORA }, 120)
    assert.deepEqual(marcas.map(m => m.rotulo), ['11h', '11:10', '11:20', '11:30', '11:40', '11:50', '12h'])
  })

  it('grade apertada: o passo cresce até as marcas caberem', () => {
    const marcas = marcasDaRegua({ inicio: AGORA - D, fim: AGORA }, 50)
    // 48 colunas para 24 horas: 2 colunas por hora, então uma marca a cada 6 horas.
    assert.deepEqual(marcas.map(m => m.rotulo), ['12h', '18h', '31 OUT', '06h', '12h'])
  })

  it('janela de dias: meia-noite, um dia sim, outro não, quando aperta', () => {
    const marcas = marcasDaRegua({ inicio: AGORA - 7 * D, fim: AGORA }, 90)
    assert.deepEqual(marcas.map(m => m.rotulo), ['25 OUT', '26 OUT', '27 OUT', '28 OUT', '29 OUT', '30 OUT', '31 OUT'])
    const apertada = marcasDaRegua({ inicio: AGORA - 7 * D, fim: AGORA }, 50)
    assert.deepEqual(apertada.map(m => m.rotulo), ['25 OUT', '27 OUT', '29 OUT', '31 OUT'])
  })

  it('janela de semanas marca as segundas; a de meses, o dia 1', () => {
    const semanas = marcasDaRegua({ inicio: AGORA - 30 * D, fim: AGORA }, 120)
    assert.deepEqual(semanas.map(m => m.rotulo), ['05 OUT', '12 OUT', '19 OUT', '26 OUT'])
    const meses = marcasDaRegua({ inicio: AGORA - 90 * D, fim: AGORA }, 120)
    assert.deepEqual(meses.map(m => m.rotulo), ['SET', 'OUT'])
  })
})

describe('tear-dados: um trilho por projeto', () => {
  it('o primeiro (o mais recente) é o vivo; parado é quem não mexe há mais de 7 dias; nós só do que foi lido', () => {
    const visiveis = [projeto('a', AGORA - H, AGORA - 20 * D), projeto('b', AGORA - 2 * D), projeto('c', AGORA - 9 * D), projeto('d', AGORA - 12 * D)]
    const historicos: Record<string, Historico> = {
      a: pronto(AGORA - 20 * D, AGORA - 30 * MIN),
      b: { estado: 'erro' },
      c: pronto(AGORA - 15 * D),
    }
    const trilhos = trilhosDoTear(visiveis, historicos, AGORA)
    assert.deepEqual(trilhos.map(t => t.vivo), [true, false, false, false])
    assert.deepEqual(trilhos.map(t => t.parado), [false, false, true, true])
    assert.deepEqual(trilhos[0], { desde: AGORA - 20 * D, ultimo: AGORA - 30 * MIN, atividades: [AGORA - 20 * D, AGORA - 30 * MIN], vivo: true, parado: false })
    assert.deepEqual(trilhos[1]!.atividades, [], 'erro na leitura: nenhum nó inventado')
    assert.deepEqual(trilhos[3]!.atividades, [], 'ainda lendo: nenhum nó')
    assert.equal(trilhos[3]!.ultimo, AGORA - 12 * D)
  })
})
