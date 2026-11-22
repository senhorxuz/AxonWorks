import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { secaoDasRegrasDoDono, secaoDasVerificacoes, secoesDasLicoesDoDono } from '../server/contexto/secoes.ts'
import { lerExtrasDaRetomada } from '../server/ganchos/extras.ts'
import { textoDaLicaoNaRetomada } from '../server/ganchos/marca-da-licao.ts'
import { WorkspaceStore } from '../server/store.ts'
import type { Licao } from '../shared/licoes.ts'

// Regras e verificações do dono no contexto compilado (seções `regras_do_dono` e `verificacoes`) e a marca do
// tipo no bloco de lições da retomada compacta.

const stores: WorkspaceStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

function novaAxon(): { store: WorkspaceStore; projectId: string } {
  let instante = Date.parse('2026-11-18T10:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => new Date((instante += 60_000)) })
  stores.push(store)
  return { store, projectId: store.createProject({ name: 'Agenda de Posts', objective: 'Vender cursos' }).id }
}

function licao(id: string, over: Partial<Licao> = {}): Licao {
  return {
    id,
    projectId: 'p1',
    texto: `texto ${id}`,
    origem: 'Claude',
    criadaEm: '2026-11-19T10:00:00.000Z',
    aposentadaEm: null,
    motivoAposentadoria: null,
    tipo: 'erro',
    fraseDoDono: null,
    momento: null,
    linhaCurta: null,
    substituiId: null,
    ...over,
  }
}

describe('seções do contexto com as lições do dono', () => {
  it('regra: diretriz do dono, com a frase literal e o tipo no meta; o título é a linha curta, ou o texto', () => {
    const secao = secaoDasRegrasDoDono([
      licao('r1', { tipo: 'regra', fraseDoDono: 'Só com o meu OK.', linhaCurta: 'Só sobe com OK' }),
      licao('r2', { tipo: 'regra', fraseDoDono: 'É a Nata.' }),
    ])
    assert.equal(secao.kind, 'regras_do_dono')
    assert.equal(secao.title, 'Regras do dono')
    assert.deepEqual(secao.items[0], {
      id: 'r1',
      sourceType: 'lesson',
      title: 'Só sobe com OK',
      body: 'texto r1',
      provenance: 'human_directive',
      authority: 'directive',
      reason: 'Regra dita pelo dono para este projeto.',
      meta: { tipo: 'regra', momento: null, fraseDoDono: 'Só com o meu OK.' },
    })
    assert.equal(secao.items[1]?.title, 'texto r2')
  })

  it('verificação: diretriz do dono, com o momento na razão e no meta', () => {
    const secao = secaoDasVerificacoes([
      licao('v1', { tipo: 'verificacao', momento: 'antes_de_subir' }),
      licao('v2', { tipo: 'verificacao', momento: 'antes_de_pronto' }),
      licao('v3', { tipo: 'verificacao', momento: 'antes_de_commit' }),
      licao('v4', { tipo: 'verificacao', momento: null }),
    ])
    assert.equal(secao.kind, 'verificacoes')
    assert.equal(secao.title, 'Verificações antes de agir')
    assert.deepEqual(
      secao.items.map((item) => item.reason),
      [
        'Verificação pedida pelo dono antes de subir.',
        'Verificação pedida pelo dono antes de dizer pronto.',
        'Verificação pedida pelo dono antes de commit ou junção.',
        'Verificação pedida pelo dono.',
      ],
    )
    assert.ok(secao.items.every((item) => item.authority === 'directive' && item.provenance === 'human_directive' && item.sourceType === 'lesson'))
    assert.equal(secao.items[0]?.meta?.momento, 'antes_de_subir')
  })

  it('só entram as que existem: erros ficam de fora, e sem regra nem verificação não há seção', () => {
    assert.deepEqual(secoesDasLicoesDoDono([licao('e1')]), [])
    assert.deepEqual(secoesDasLicoesDoDono([]), [])
    assert.deepEqual(secoesDasLicoesDoDono([licao('r1', { tipo: 'regra' }), licao('e1')]).map((s) => s.kind), ['regras_do_dono'])
    assert.deepEqual(secoesDasLicoesDoDono([licao('v1', { tipo: 'verificacao' }), licao('e1')]).map((s) => s.kind), ['verificacoes'])
    assert.deepEqual(
      secoesDasLicoesDoDono([licao('v1', { tipo: 'verificacao' }), licao('r1', { tipo: 'regra' })]).map((s) => s.kind),
      ['regras_do_dono', 'verificacoes'],
    )
  })
})

describe('compile_context com regras e verificações do dono', () => {
  it('as duas seções vêm primeiro, lidas das lições do projeto; erros e lições globais não entram', () => {
    const { store, projectId } = novaAxon()
    store.registrarLicao(projectId, { texto: 'Nunca subir sem o OK do dono.', agent: 'Claude', tipo: 'regra', fraseDoDono: 'Só com o meu OK.' })
    store.registrarLicao(projectId, { texto: 'Rodar o preflight.', agent: 'Claude', tipo: 'verificacao', fraseDoDono: 'Preflight.', momento: 'antes_de_subir' })
    store.registrarLicao(projectId, { texto: 'Um erro qualquer.', agent: 'Claude' })
    store.registrarLicao(null, { texto: 'Erro global.', agent: 'Claude' })
    store.saveCheckpoint(projectId, { expectedRevision: 0, idempotencyKey: 'cp-1', agent: 'Claude', summary: 'Resumo', nextStep: 'Seguir' })

    const envelope = store.compileContext(projectId, { agent: 'Claude' })

    assert.deepEqual(envelope.sections.map((s) => s.kind).slice(0, 3), ['regras_do_dono', 'verificacoes', 'charter'])
    assert.deepEqual(envelope.sections[0]?.items.map((i) => [i.title, i.authority, i.provenance]), [['Nunca subir sem o OK do dono.', 'directive', 'human_directive']])
    assert.deepEqual(envelope.sections[1]?.items.map((i) => i.title), ['Rodar o preflight.'])
    assert.ok(envelope.markdown.includes('Nunca subir sem o OK do dono.'))
    assert.ok(envelope.markdown.includes('Rodar o preflight.'))
    assert.ok(!envelope.markdown.includes('Um erro qualquer.'))
    assert.ok(!envelope.markdown.includes('Erro global.'))
    assert.ok(envelope.includedSources.some((fonte) => fonte.sourceType === 'lesson' && fonte.authority === 'directive'))
  })

  it('sem regra nem verificação, o envelope não ganha seção nenhuma', () => {
    const { store, projectId } = novaAxon()
    store.registrarLicao(projectId, { texto: 'Um erro qualquer.', agent: 'Claude' })
    const envelope = store.compileContext(projectId, { agent: 'Claude' })
    assert.ok(!envelope.sections.some((s) => s.kind === 'regras_do_dono' || s.kind === 'verificacoes'))
  })

  it('com pouco espaço, regras e verificações têm prioridade sobre o quadro', () => {
    const { store, projectId } = novaAxon()
    store.registrarLicao(projectId, { texto: 'Nunca subir sem o OK do dono.', agent: 'Claude', tipo: 'regra', fraseDoDono: 'Só com o meu OK.' })
    store.registrarLicao(projectId, { texto: 'Rodar o preflight.', agent: 'Claude', tipo: 'verificacao', fraseDoDono: 'Preflight.', momento: 'antes_de_subir' })
    for (let i = 0; i < 80; i += 1) store.createBoardCard(projectId, { actor: 'Claude', title: `Cartão comum número ${i} com título comprido`, column: 'pending' })

    const envelope = store.compileContext(projectId, { agent: 'Claude', maxChars: 2000 })

    assert.ok(envelope.markdown.length <= 2000)
    assert.ok(envelope.markdown.includes('Nunca subir sem o OK do dono.'))
    assert.ok(envelope.markdown.includes('Rodar o preflight.'))
  })
})

describe('marca do tipo nas lições da retomada compacta', () => {
  it('erro continua sem marca; regra e verificação ganham a marca do tipo e do momento', () => {
    assert.equal(textoDaLicaoNaRetomada(licao('e1', { texto: 'Um erro.' })), 'Um erro.')
    assert.equal(textoDaLicaoNaRetomada(licao('r1', { tipo: 'regra', texto: 'Uma regra.' })), 'Uma regra. (regra do dono)')
    assert.equal(textoDaLicaoNaRetomada(licao('v1', { tipo: 'verificacao', texto: 'Conferir.', momento: 'antes_de_subir' })), 'Conferir. (verificação antes de subir)')
    assert.equal(textoDaLicaoNaRetomada(licao('v2', { tipo: 'verificacao', texto: 'Conferir.', momento: 'antes_de_pronto' })), 'Conferir. (verificação antes de dizer pronto)')
    assert.equal(textoDaLicaoNaRetomada(licao('v3', { tipo: 'verificacao', texto: 'Conferir.', momento: 'antes_de_commit' })), 'Conferir. (verificação antes de commit ou junção)')
    assert.equal(textoDaLicaoNaRetomada(licao('v4', { tipo: 'verificacao', texto: 'Conferir.', momento: null })), 'Conferir. (verificação)')
  })

  it('as lições da retomada levam a marca; só erros, a saída é a de sempre', () => {
    const { store, projectId } = novaAxon()
    store.registrarLicao(projectId, { texto: 'Um erro.', agent: 'Claude' })
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).licoes, [{ texto: 'Um erro.' }])

    store.registrarLicao(projectId, { texto: 'Uma regra.', agent: 'Claude', tipo: 'regra', fraseDoDono: 'Regra.' })
    store.registrarLicao(projectId, { texto: 'Conferir.', agent: 'Claude', tipo: 'verificacao', fraseDoDono: 'Conferir.', momento: 'antes_de_commit' })
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).licoes, [
      { texto: 'Conferir. (verificação antes de commit ou junção)' },
      { texto: 'Uma regra. (regra do dono)' },
      { texto: 'Um erro.' },
    ])
  })
})
