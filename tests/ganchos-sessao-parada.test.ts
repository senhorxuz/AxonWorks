import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { MarcadorDeSessao } from '../server/ganchos/marcadores.ts'
import { MINUTOS_PARA_RECUPERAR, dataDaConversa, sessaoParada } from '../server/ganchos/sessao-parada.ts'

/**
 * Quando uma sessão que ficou para trás conta como parada (spec 13.4). Defeito de 25/10 23h42: o marcador
 * (gravado pelo `Stop`, só ao fim de cada resposta) estava velho, mas a sessão estava ativa numa resposta
 * longa. Parada = as DUAS fontes mais velhas que o prazo. Medição de 26/10: o Claude Code grava a conversa de
 * forma preguiçosa (uma sessão viva ficou 40 minutos sem mudar a data do arquivo), então o prazo é de 6 horas:
 * recuperar tarde custa pouco (o rascunho é rede de segurança), recuperar sessão viva grava a conversa no
 * projeto errado.
 */

const AGORA = new Date('2026-10-25T12:00:00.000Z')
const MINUTO = 60_000
/** O prazo: 6 horas. Os instantes "velhos" dos testes passam dele com folga; os "recentes" ficam bem abaixo. */
const PRAZO_EM_MINUTOS = 360

/** Instante (ms) de N minutos antes do `AGORA`; fração de minuto em milissegundos. */
const haMinutos = (minutos: number) => AGORA.getTime() - minutos * MINUTO
const haMilissegundos = (ms: number) => AGORA.getTime() - ms

function marcadorDe(atualizadoEmMs: number | string): MarcadorDeSessao {
  const atualizadoEm = typeof atualizadoEmMs === 'string' ? atualizadoEmMs : new Date(atualizadoEmMs).toISOString()
  return { sessionId: 's-1', transcriptPath: 'C:\\conversas\\s-1.jsonl', pasta: 'D:\\Projetos\\projeto-exemplo', atualizadoEm }
}

describe('o prazo', () => {
  it('é de 6 horas (360 minutos)', () => {
    assert.equal(MINUTOS_PARA_RECUPERAR, 360)
  })
})

describe('sessaoParada (regra pura)', () => {
  it('marcador velho e conversa velha: parada', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(450)), haMinutos(400), AGORA), true)
  })

  it('marcador velho e conversa recente: a sessão está ativa, não está parada', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(450)), haMinutos(1), AGORA), false)
  })

  it('marcador recente e conversa velha: não está parada', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(2)), haMinutos(450), AGORA), false)
  })

  it('sessão que ficou 40 minutos sem escrever na conversa (caso medido) ou 5 horas e meia: ainda não está parada', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(40)), haMinutos(40), AGORA), false)
    assert.equal(sessaoParada(marcadorDe(haMinutos(330)), haMinutos(330), AGORA), false)
  })

  it('marcador recente e conversa recente: não está parada', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(2)), haMinutos(1), AGORA), false)
  })

  it('conversa sumida (sem data): vale só o marcador, não há o que esperar', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(450)), null, AGORA), true)
    assert.equal(sessaoParada(marcadorDe(haMinutos(2)), null, AGORA), false)
    assert.equal(sessaoParada(marcadorDe(haMinutos(45)), null, AGORA), false, '45 minutos não basta mais')
  })

  it('exatamente 360 minutos ainda não é parada; 1 milissegundo a mais é (marcador)', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(PRAZO_EM_MINUTOS)), haMinutos(450), AGORA), false)
    assert.equal(sessaoParada(marcadorDe(haMilissegundos(PRAZO_EM_MINUTOS * MINUTO + 1)), haMinutos(450), AGORA), true)
  })

  it('exatamente 360 minutos ainda não é parada; 1 milissegundo a mais é (conversa)', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(450)), haMinutos(PRAZO_EM_MINUTOS), AGORA), false)
    assert.equal(sessaoParada(marcadorDe(haMinutos(450)), haMilissegundos(PRAZO_EM_MINUTOS * MINUTO + 1), AGORA), true)
  })

  it('hora do marcador ilegível: nunca está parada (na dúvida, não recupera)', () => {
    assert.equal(sessaoParada(marcadorDe('ontem'), haMinutos(450), AGORA), false)
    assert.equal(sessaoParada(marcadorDe(''), null, AGORA), false)
  })

  it('data da conversa ilegível (NaN): nunca está parada', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(450)), Number.NaN, AGORA), false)
  })

  it('conversa com data no futuro (relógio adiantado): não está parada', () => {
    assert.equal(sessaoParada(marcadorDe(haMinutos(450)), AGORA.getTime() + MINUTO, AGORA), false)
  })
})

describe('dataDaConversa (leitura do disco)', () => {
  const pastas: string[] = []
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
  })

  function arquivo(): string {
    const pasta = mkdtempSync(join(tmpdir(), 'axon-sessao-parada-'))
    pastas.push(pasta)
    const caminho = join(pasta, 'conversa.jsonl')
    writeFileSync(caminho, '{}\n')
    return caminho
  }

  it('devolve a data de modificação do arquivo (não a de acesso nem a de criação)', () => {
    const caminho = arquivo()
    const modificada = new Date('2026-10-25T11:20:00.000Z')
    utimesSync(caminho, new Date('2026-10-25T09:00:00.000Z'), modificada)
    assert.equal(dataDaConversa(caminho), modificada.getTime())
  })

  it('arquivo que não existe: null (a conversa sumiu)', () => {
    const caminho = arquivo()
    assert.equal(dataDaConversa(`${caminho}.sumiu`), null)
    assert.equal(dataDaConversa(''), null)
  })

  it('arquivo que o sistema não deixa consultar: NaN (na dúvida, não recupera)', () => {
    assert.ok(Number.isNaN(dataDaConversa('C:\\conversas\\a\0b.jsonl')))
  })
})
