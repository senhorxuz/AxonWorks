// Cenário de ponta a ponta (item 9 da proposta): "As artes dos depoimentos já foram publicadas?".
// A leitura curta precisa trazer, com as fontes, o que foi aprovado, onde está o código, o que foi relatado como
// testado e que a publicação ainda depende do dono, mesmo com histórico longo. Uma sugestão de IA para publicar
// não vira autorização, e a fase vermelha do TDD não aparece como pendência.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { LIMITE_LEITURA_CURTA } from '../shared/leitura-curta.ts'
import { lerLeituraCurta } from '../server/carta/leitura-curta-ler.ts'
import { COMMIT_LOCAL, SUGESTAO_DE_AGENTE, montarCenarioDepoimentos } from './cenarios/depoimentos.ts'

const AGORA = () => new Date('2026-11-08T12:00:00.000Z')
const fontes = (linhas: Array<{ fonte: { id: string } }>) => linhas.map((linha) => linha.fonte.id)

describe('cenário dos depoimentos, com histórico longo', () => {
  const { store, projectId, ids } = montarCenarioDepoimentos({ historicoLongo: true })
  const leitura = lerLeituraCurta(store, projectId, 'IA nova', LIMITE_LEITURA_CURTA, AGORA)

  test('cabe no limite padrão', () => {
    assert.ok(leitura.markdown.length <= LIMITE_LEITURA_CURTA, `${leitura.markdown.length} caracteres`)
  })

  test('a regra e a verificação do dono entram, com o id', () => {
    assert.deepEqual(fontes(leitura.regras), [ids.regra])
    assert.deepEqual(fontes(leitura.verificacoes.antes_de_subir), [ids.verificacao])
    assert.ok(leitura.markdown.includes(ids.regra))
    assert.ok(leitura.markdown.includes(ids.verificacao))
  })

  test('o estado vem do último registro: aprovado, testado no computador, commit local e publicação pendente', () => {
    assert.equal(leitura.estado.ultimoRegistro?.id, ids.checkpointAtual)
    assert.equal(leitura.estado.proximoPasso?.fonte.id, ids.checkpointAtual)
    assert.equal(leitura.estado.lacuna, null)
    assert.match(leitura.estado.emUmaFrase ?? '', /aprovadas e testadas/)
    assert.ok(leitura.markdown.includes(COMMIT_LOCAL))
  })

  test('o último resultado é o verde da prévia, como relato com a fonte; a fase vermelha não aparece como pendência', () => {
    assert.deepEqual(
      leitura.ultimosResultados.map((r) => [r.fonte.id, r.resultado]),
      [[ids.evidenciaVerde, 'passed']],
    )
    assert.equal(leitura.markdown.includes(ids.evidenciaVermelha), false)
  })

  test('a publicação depende do dono: a aprovação pendente e o cartão marcado entram, com os ids', () => {
    const doDono = fontes(leitura.dependeDoDono)
    assert.ok(doDono.includes(ids.aprovacaoPublicacao))
    assert.ok(doDono.includes(ids.cartaoDepoimentos))
  })

  test('a sugestão de outra IA para publicar não aparece como autorização', () => {
    assert.equal(leitura.markdown.includes(SUGESTAO_DE_AGENTE), false)
  })

  test('o histórico longo fica de fora: nenhum cartão antigo e nenhum registro antigo no texto', () => {
    assert.doesNotMatch(leitura.markdown, /Ajuste antigo número/)
    assert.doesNotMatch(leitura.markdown, /Ajustes antigos/)
  })
})

describe('variação: o dono autoriza o staging', () => {
  test('a aprovação sai de "depende do dono"', () => {
    const { store, projectId, ids } = montarCenarioDepoimentos({ autorizarStaging: true })
    const leitura = lerLeituraCurta(store, projectId, 'IA nova', LIMITE_LEITURA_CURTA, AGORA)
    assert.equal(fontes(leitura.dependeDoDono).includes(ids.aprovacaoPublicacao), false)
    assert.match(leitura.entregas?.[0]?.texto ?? '', /publicação autorizada para staging/)
    assert.doesNotMatch(leitura.entregas?.[0]?.texto ?? '', /publicado em staging/)
  })

  test('o que o dono decidiu aparece em "decidido pelo dono", com quem, quando, o quê, o título e a nota', () => {
    const { store, projectId, ids } = montarCenarioDepoimentos({ autorizarStaging: true })
    const leitura = lerLeituraCurta(store, projectId, 'IA nova', LIMITE_LEITURA_CURTA, AGORA)
    assert.deepEqual(fontes(leitura.decididoPeloDono), [ids.aprovacaoPublicacao])
    assert.match(leitura.decididoPeloDono[0]?.texto ?? '', /^Aprovada por Dono em 2026-11-\d\dT[\d:.]+Z: .*Nota: Pode publicar no staging\.$/)
    assert.ok(leitura.markdown.includes('## Decidido pelo dono depois do último registro'))
    assert.ok(leitura.markdown.includes(`[aprovacao:${ids.aprovacaoPublicacao}] Aprovada por Dono`))
    assert.ok(leitura.markdown.includes('Nota: Pode publicar no staging.'))
    assert.ok(leitura.markdown.includes('Há decisões do dono mais novas que o último registro'))
  })

  test('sem a autorização, nada aparece em "decidido pelo dono"', () => {
    const { store, projectId } = montarCenarioDepoimentos({})
    const leitura = lerLeituraCurta(store, projectId, 'IA nova', LIMITE_LEITURA_CURTA, AGORA)
    assert.deepEqual(leitura.decididoPeloDono, [])
    assert.equal(leitura.markdown.includes('Decidido pelo dono'), false)
  })
})
