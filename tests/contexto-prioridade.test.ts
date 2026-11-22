import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { WorkspaceStore } from '../server/store.js'
import { TAMANHO_DA_DIRETRIZ_CURTA } from '../server/contexto/itens.js'

const T0 = new Date('2026-11-19T12:00:00.000Z')

function enchimento(inicio: string, tamanho: number): string {
  const base = `${inicio} `
  let texto = base
  while (texto.length < tamanho) texto += 'detalhe do trabalho com acentuação e contexto; '
  return texto.slice(0, tamanho)
}

interface Cenario {
  store: WorkspaceStore
  projectId: string
}

function cenario(opcoes: { resumoDoCheckpoint: number; mensagemDaPassagem: number }): Cenario {
  const store = new WorkspaceStore(':memory:', { now: () => T0 })
  const projeto = store.createProject({ name: 'Projeto Prioridade', objective: 'Provar o orçamento por prioridade' })
  store.saveCharter(projeto.id, {
    actor: 'Dono',
    body: enchimento('Diretriz longa.', 2000),
    expectedRevision: 1,
    sourceKind: 'human_directive',
  })
  const tarefa = store.createTask(projeto.id, { title: 'Fechar o contexto' })
  store.claimTask(projeto.id, tarefa.id, { agent: 'alfa', expectedVersion: 0 })
  const checkpoint = store.saveCheckpoint(projeto.id, {
    expectedRevision: 0,
    idempotencyKey: 'cp-prioridade',
    taskId: tarefa.id,
    agent: 'alfa',
    summary: enchimento('Resumo técnico.', opcoes.resumoDoCheckpoint),
    humanSummary: 'O contexto passou a escolher por prioridade.',
    nextStep: 'Conferir o corte com o dono.',
    blockers: ['Falta confirmar o limite com o dono'],
  })
  store.createHandoffDelivery(projeto.id, {
    checkpointId: checkpoint.id,
    from: 'alfa',
    to: 'beta',
    message: enchimento('Passagem para a beta.', opcoes.mensagemDaPassagem),
  })
  for (let i = 0; i < 12; i += 1) {
    store.createBoardCard(projeto.id, { actor: 'alfa', title: `Cartão pequeno ${i}`, column: 'pending' })
  }
  return { store, projectId: projeto.id }
}

describe('Contexto compilado: orçamento por prioridade', () => {
  it('com 4.500 caracteres, a passagem e a atenção entram e o quadro fica de fora', () => {
    const { store, projectId } = cenario({ resumoDoCheckpoint: 2000, mensagemDaPassagem: 760 })
    const envelope = store.compileContext(projectId, { agent: 'beta', maxChars: 4500 })
    const tipos = envelope.sections.map((s) => s.kind)
    assert.ok(tipos.includes('deliveries'), 'a passagem não lida precisa entrar')
    assert.ok(tipos.includes('attention'), 'o item de atenção precisa entrar')
    assert.ok(tipos.includes('checkpoint'))
    assert.ok(!tipos.includes('board'), 'o quadro fica de fora quando falta espaço')
    assert.ok(envelope.cutSections.includes('board'))
    assert.equal(envelope.omittedCounts['board'], 12)
    assert.equal(envelope.truncated, true)
    assert.ok(envelope.markdown.length <= 4500)
    assert.ok(!envelope.markdown.includes('Cartão pequeno'))
  })

  it('a diretriz grande não toma o lugar da passagem nem da atenção, como o corte guloso fazia', () => {
    const { store, projectId } = cenario({ resumoDoCheckpoint: 1500, mensagemDaPassagem: 900 })
    const envelope = store.compileContext(projectId, { agent: 'beta', maxChars: 4500 })
    const tipos = envelope.sections.map((s) => s.kind)
    assert.ok(tipos.includes('deliveries'), 'a passagem não lida precisa entrar')
    assert.ok(tipos.includes('attention'), 'o item de atenção precisa entrar')
    assert.ok(envelope.markdown.length <= 4500)
  })

  // Conferido num banco real (20/11/2026): sem forma curta, a diretriz do dono saía inteira e cartões comuns
  // do quadro entravam no lugar dela. A diretriz é o objetivo e as regras de trabalho do projeto.
  it('a diretriz que não cabe inteira entra resumida, com o aviso de onde ler o resto, antes de qualquer cartão', () => {
    // Sobra espaço para a diretriz resumida, não para os 2.000 caracteres dela inteira.
    const { store, projectId } = cenario({ resumoDoCheckpoint: 1500, mensagemDaPassagem: 600 })
    const envelope = store.compileContext(projectId, { agent: 'beta', maxChars: 4500 })
    const diretriz = envelope.sections.find((s) => s.kind === 'charter')?.items[0]
    assert.ok(diretriz, 'a diretriz precisa aparecer, mesmo que resumida')
    assert.equal(diretriz.shortened, true)
    assert.ok(diretriz.body.startsWith('Diretriz longa. detalhe do trabalho'))
    assert.ok(diretriz.body.endsWith(' […] (inteiro: get_charter)'), diretriz.body.slice(-40))
    assert.ok(diretriz.body.length <= TAMANHO_DA_DIRETRIZ_CURTA + ' […] (inteiro: get_charter)'.length)
    assert.ok(!envelope.cutSections.includes('charter'))
    assert.ok(envelope.markdown.length <= 4500)
  })

  it('a ordem do texto continua a de leitura, mesmo quando a escolha seguiu a prioridade', () => {
    const { store, projectId } = cenario({ resumoDoCheckpoint: 2000, mensagemDaPassagem: 760 })
    const envelope = store.compileContext(projectId, { agent: 'beta', maxChars: 4500 })
    const tipos: string[] = envelope.sections.map((s) => s.kind)
    const ordemDeLeitura = ['charter', 'checkpoint', 'deliveries', 'attention', 'board']
    assert.deepEqual(tipos, ordemDeLeitura.filter((kind) => tipos.includes(kind)))
    assert.ok(['checkpoint', 'deliveries', 'attention'].every((kind) => tipos.includes(kind)))
    assert.deepEqual(
      envelope.includedSources.map((s) => s.sourceType),
      envelope.sections.flatMap((s) => s.items.map((i) => i.sourceType)),
    )
  })

  it('o checkpoint longo entra na forma curta quando o inteiro não cabe, e o resto da prioridade fica', () => {
    const { store, projectId } = cenario({ resumoDoCheckpoint: 6000, mensagemDaPassagem: 900 })
    const envelope = store.compileContext(projectId, { agent: 'beta', maxChars: 4500 })
    const checkpoint = envelope.sections.find((s) => s.kind === 'checkpoint')?.items[0]
    assert.ok(checkpoint, 'o checkpoint precisa aparecer, mesmo que curto')
    assert.equal(checkpoint.shortened, true)
    assert.equal(
      checkpoint.body,
      'Para o dono do projeto: O contexto passou a escolher por prioridade.\nPróximo passo: Conferir o corte com o dono.\n(inteiro: get_resume_brief)',
    )
    assert.ok(envelope.sections.some((s) => s.kind === 'deliveries'))
    assert.ok(envelope.sections.some((s) => s.kind === 'attention'))
    assert.ok(envelope.markdown.length <= 4500)
  })

  it('quando tudo cabe, ninguém é encurtado e nada é cortado', () => {
    const { store, projectId } = cenario({ resumoDoCheckpoint: 300, mensagemDaPassagem: 100 })
    const envelope = store.compileContext(projectId, { agent: 'beta', maxChars: 40_000 })
    assert.equal(envelope.truncated, false)
    assert.deepEqual(envelope.cutSections, [])
    assert.deepEqual(envelope.omittedCounts, {})
    assert.ok(envelope.sections.every((s) => s.items.every((i) => i.shortened === undefined)))
    assert.ok(envelope.sections.some((s) => s.kind === 'board'))
  })

  it('quando tudo cabe, o markdown é o do corte guloso de antes: cabeçalho, seções na ordem de leitura e itens por linha', () => {
    const { store, projectId } = cenario({ resumoDoCheckpoint: 300, mensagemDaPassagem: 100 })
    const envelope = store.compileContext(projectId, { agent: 'beta', maxChars: 40_000 })
    const corpo = envelope.sections
      .map((sec) => `\n\n## ${sec.title}\n` + sec.items.map((i) => `\n- [${i.sourceType}] **${i.title}**: ${i.body}`).join(''))
      .join('')
    const inicioDasSecoes = envelope.markdown.indexOf('\n\n## ')
    assert.equal(envelope.markdown.slice(inicioDasSecoes), corpo)
    assert.deepEqual(
      envelope.sections.map((s) => s.kind),
      ['charter', 'checkpoint', 'deliveries', 'attention', 'board'],
    )
    assert.equal(envelope.includedSources.length, envelope.sections.reduce((n, s) => n + s.items.length, 0))
  })
})
