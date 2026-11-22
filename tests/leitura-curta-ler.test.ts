import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { lerDadosDaLeitura, lerLeituraCurta } from '../server/carta/leitura-curta-ler.ts'
import { WorkspaceStore } from '../server/store.ts'

// A leitura curta lida de uma Axon de verdade (banco em memória): o que o store entrega vira o texto.

const stores: WorkspaceStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

/** Banco em memória com relógio próprio: cada gravação cai um minuto depois da anterior. */
function novaAxon(): { store: WorkspaceStore; projectId: string } {
  let instante = Date.parse('2026-11-18T10:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => new Date((instante += 60_000)) })
  stores.push(store)
  const projectId = store.createProject({ name: 'Agenda de Posts', objective: 'Vender cursos pela internet' }).id
  return { store, projectId }
}

function gravar(store: WorkspaceStore, projectId: string, chave: string, campos: Record<string, unknown> = {}) {
  return store.saveCheckpoint(projectId, {
    expectedRevision: store.getProject(projectId).project.revision,
    idempotencyKey: chave,
    agent: 'Claude',
    summary: `Resumo técnico ${chave}`,
    nextStep: `Passo depois de ${chave}`,
    ...campos,
  })
}

const AGORA = () => new Date('2026-11-19T12:00:00.000Z')

describe('lerDadosDaLeitura', () => {
  it('lê do banco o contexto da evidência e o ponto de conferência da passagem', () => {
    const { store, projectId } = novaAxon()
    const registro = gravar(store, projectId, 'fase-vermelha', {
      evidence: [{ command: 'npm test', outcome: 'failed', details: 'Teste antes do código', esperado: 'falhar', versao: 'a1b2c3d', ambiente: 'prévia' }],
    })
    const passagem = store.createHandoffDelivery(projectId, {
      checkpointId: registro.id, from: 'Claude', to: 'Codex', message: 'A próxima mudança é no cartão.',
      pontoDeConferencia: { commit: 'a1b2c3d', comoConferir: 'Ver reproduções.' },
    })

    const leitura = lerLeituraCurta(store, projectId, 'Codex', undefined, AGORA)
    const evidenciaId = store.listEvidence(projectId)[0].id
    assert.ok(leitura.markdown.includes(`[evidencia:${evidenciaId}] \`npm test\`: relatado como Falhou como esperado (fase vermelha) na prévia do commit a1b2c3d`))
    assert.ok(leitura.markdown.includes(`[passagem:${passagem.id}] Ponto de partida: commit a1b2c3d. Para conferir: Ver reproduções. Passagem de Claude para Codex: A próxima mudança é no cartão.`))
  })

  it('lê as entregas registradas no cartão do projeto', () => {
    const { store, projectId } = novaAxon()
    const cardId = store.createBoardCard(projectId, { actor: 'Claude', title: 'Três artes' }).id
    const entrega = store.updateDelivery(projectId, cardId, { agent: 'Claude', codigo: { onde: 'local' } })
    assert.deepEqual(lerDadosDaLeitura(store, projectId, 'Claude', AGORA().toISOString()).entregas, [entrega])
  })

  it('leva ao texto a falha ligada a uma verificação mesmo depois de um checkpoint que passou', () => {
    const { store, projectId } = novaAxon()
    const verificacao = store.registrarLicao(projectId, {
      texto: 'Conferir a versão.', agent: 'Codex', tipo: 'verificacao', fraseDoDono: 'Conferir a versão.', momento: 'antes_de_subir',
    })
    const falhou = gravar(store, projectId, 'falhou', {
      evidence: [{ command: 'preflight', outcome: 'failed', details: 'Versão antiga', verificacaoId: verificacao.id }],
    })
    gravar(store, projectId, 'passou', {
      evidence: [{ command: 'preflight', outcome: 'passed', details: 'Versão nova', verificacaoId: verificacao.id }],
    })
    const dados = lerDadosDaLeitura(store, projectId, 'Codex', AGORA().toISOString())
    assert.deepEqual(dados.falhas, [{
      verificacaoId: verificacao.id, quantas: 1, ultimaEm: falhou.createdAt, ultimoCheckpointId: falhou.id, ultimoDetalhe: 'Versão antiga',
    }])
    const leitura = lerLeituraCurta(store, projectId, 'Codex', 2000, AGORA)
    assert.ok(leitura.markdown.length <= 2000)
    assert.ok(leitura.markdown.split('\n').includes(
      `- [licao:${verificacao.id}] Conferir a versão. (falhou 1 vez; a última em 2026-11-18)`,
    ))
  })

  it('lê o projeto, o último registro (o de maior revisão), as evidências dele e as lições ativas', () => {
    const { store, projectId } = novaAxon()
    gravar(store, projectId, 'cp-1', { evidence: [{ command: 'npm run velho', outcome: 'failed', details: '' }] })
    gravar(store, projectId, 'cp-2')
    const ultimo = gravar(store, projectId, 'cp-3', { evidence: [{ command: 'npm test', outcome: 'passed', details: '' }] })
    store.registrarLicao(projectId, { texto: 'Rodar o preflight antes de subir.', agent: 'Claude', tipo: 'verificacao', fraseDoDono: 'Sempre rode o preflight.', momento: 'antes_de_subir' })
    store.registrarLicao(null, { texto: 'No Windows, o Set-Content estraga acento.', agent: 'Claude' })

    const dados = lerDadosDaLeitura(store, projectId, 'Claude', '2026-11-19T12:00:00.000Z')

    assert.deepEqual(dados.projeto, { id: projectId, nome: 'Agenda de Posts' })
    assert.equal(dados.geradaEm, '2026-11-19T12:00:00.000Z')
    assert.equal(dados.revisao, store.getProject(projectId).project.revision)
    assert.equal(dados.checkpoint?.id, ultimo.id)
    assert.deepEqual(dados.evidencias.map((e) => e.command), ['npm test'])
    assert.deepEqual(dados.licoes.map((l) => l.tipo).sort(), ['erro', 'verificacao'])
  })

  it('projeto sem nenhum registro: sem checkpoint e sem evidências', () => {
    const { store, projectId } = novaAxon()
    const dados = lerDadosDaLeitura(store, projectId, 'Claude', AGORA().toISOString())
    assert.equal(dados.checkpoint, null)
    assert.deepEqual(dados.evidencias, [])
  })

  it('lê aprovações, decisões (com histórico), quadro, tarefas, bloqueios e só as passagens não lidas para o agente ou para todos', () => {
    const { store, projectId } = novaAxon()
    const cp = gravar(store, projectId, 'cp-1')
    store.proposeApproval(projectId, { agent: 'Claude', kind: 'note', title: 'Posso mexer no login?', body: 'Texto', rationale: 'Quebrou' })
    store.proposeDecision(projectId, { agent: 'Claude', title: 'Usar Postgres', body: 'Escala' })
    store.createBoardCard(projectId, { actor: 'Claude', title: 'Publicar o site', column: 'in_progress' })
    store.createTask(projectId, { title: 'Migrar o banco' })
    store.openBlocker(projectId, { agent: 'Claude', title: 'Cobrança do GitHub', body: 'Cartão recusado' })
    const paraCodex = store.createHandoffDelivery(projectId, { checkpointId: cp.id, from: 'Claude', to: 'Codex', message: 'Para o Codex' })
    store.createHandoffDelivery(projectId, { checkpointId: cp.id, from: 'Claude', to: '*', message: 'Para todos' })
    store.createHandoffDelivery(projectId, { checkpointId: cp.id, from: 'Claude', to: 'Gemini', message: 'Para o Gemini' })
    const lida = store.createHandoffDelivery(projectId, { checkpointId: cp.id, from: 'Claude', to: 'Codex', message: 'Já lida' })
    store.acknowledgeHandoffDelivery(projectId, lida.id, { agent: 'Codex' })

    const dados = lerDadosDaLeitura(store, projectId, 'Codex', AGORA().toISOString())

    assert.deepEqual(dados.aprovacoes.map((a) => a.title), ['Posso mexer no login?'])
    assert.deepEqual(dados.decisoes.map((d) => [d.title, d.status]), [['Usar Postgres', 'proposed']])
    assert.deepEqual(dados.cartoes.map((c) => c.title), ['Publicar o site'])
    assert.deepEqual(dados.tarefas.map((t) => t.title), ['Migrar o banco'])
    assert.deepEqual(dados.bloqueios.map((b) => b.title), ['Cobrança do GitHub'])
    assert.deepEqual(dados.passagens.map((p) => p.message).sort(), ['Para o Codex', 'Para todos'])
    assert.ok(dados.passagens.some((p) => p.id === paraCodex.id))
  })

  it('decisão já aceita continua nos dados (a regra decide o que entra, não a leitura)', () => {
    const { store, projectId } = novaAxon()
    const decisao = store.proposeDecision(projectId, { agent: 'Claude', title: 'Usar Postgres', body: 'Escala' })
    store.acceptDecision(projectId, decisao.id, { actor: 'dono', expectedVersion: decisao.version })
    const dados = lerDadosDaLeitura(store, projectId, 'Claude', AGORA().toISOString())
    assert.deepEqual(dados.decisoes.map((d) => d.status), ['accepted'])
  })
})

describe('decisão aceita pela ferramenta do MCP', () => {
  it('com actor "dono" declarado pela IA, não vira "decidido pelo dono": aparece em "decisões alteradas", com o nome marcado como declarado', () => {
    const { store, projectId } = novaAxon()
    gravar(store, projectId, 'cp-1')
    const decisao = store.proposeDecision(projectId, { agent: 'Claude', title: 'Publicar em produção já', body: 'Agora' })
    store.acceptDecision(projectId, decisao.id, { actor: 'dono', expectedVersion: decisao.version })
    const leitura = lerLeituraCurta(store, projectId, 'Claude', 6000, AGORA)
    assert.deepEqual(leitura.decididoPeloDono, [])
    assert.ok(!leitura.markdown.includes('Há decisões do dono'))
    assert.ok(!leitura.markdown.includes('## Decidido pelo dono'))
    assert.match(leitura.decisoesAlteradas[0]!.texto, /^Aceita por dono \(nome declarado\) em .*: Publicar em produção já$/)
  })
})

describe('lerLeituraCurta (projeto de verdade)', () => {
  it('projeto com histórico longo: cabe em 6.000, traz regras, verificações, estado, pendência do dono e fontes', () => {
    const { store, projectId } = novaAxon()
    store.registrarLicao(projectId, { texto: 'Nunca subir para a produção sem o OK do dono, a cada vez.', agent: 'Claude', tipo: 'regra', fraseDoDono: 'Só sobe com o meu OK.' })
    store.registrarLicao(projectId, { texto: 'A Nata é feminino: "da Nata", nunca "do Nata".', agent: 'Claude', tipo: 'regra', fraseDoDono: 'É a Nata.' })
    store.registrarLicao(projectId, { texto: 'Rodar o preflight antes de subir.', agent: 'Claude', tipo: 'verificacao', fraseDoDono: 'Preflight sempre.', momento: 'antes_de_subir' })
    store.registrarLicao(projectId, { texto: 'Conferir lint e tipos antes de dizer pronto.', agent: 'Claude', tipo: 'verificacao', fraseDoDono: 'Lint e tipos.', momento: 'antes_de_pronto' })
    for (let i = 0; i < 40; i += 1) {
      store.registrarLicao(projectId, { texto: `Erro ${i}: ${'o teste falhou por causa de uma coisa de bom tamanho '.repeat(3)}`, agent: 'Claude' })
    }
    for (let i = 0; i < 80; i += 1) store.createBoardCard(projectId, { actor: 'Claude', title: `Cartão feito número ${i}`, column: 'done' })
    for (let i = 0; i < 30; i += 1) {
      gravar(store, projectId, `cp-${i}`, { humanSummary: `Etapa ${i} concluída.`, evidence: [{ command: `npm test ${i}`, outcome: 'passed', details: '' }] })
    }
    store.createBoardCard(projectId, { actor: 'Claude', title: 'Publicar o site', column: 'in_progress' })
    const aprovacao = store.proposeApproval(projectId, { agent: 'Claude', kind: 'note', title: 'Posso publicar a versão nova?', body: 'Texto', rationale: 'Pronta' })

    const leitura = lerLeituraCurta(store, projectId, 'Claude', 6000, AGORA)

    assert.ok(leitura.markdown.length <= 6000)
    assert.equal(leitura.geradaEm, '2026-11-19T12:00:00.000Z')
    assert.equal(leitura.regras.length, 2)
    assert.equal(leitura.verificacoes.antes_de_subir.length, 1)
    assert.equal(leitura.verificacoes.antes_de_pronto.length, 1)
    assert.equal(leitura.estado.emUmaFrase, 'Etapa 29 concluída.')
    assert.equal(leitura.estado.proximoPasso?.texto, 'Passo depois de cp-29')
    assert.deepEqual(leitura.dependeDoDono.map((l) => l.fonte), [{ tipo: 'aprovacao', id: aprovacao.id }])
    assert.deepEqual(leitura.ultimosResultados.map((r) => r.comando), ['npm test 29'])
    assert.ok(leitura.markdown.includes(`[aprovacao:${aprovacao.id}]`))
    assert.ok(leitura.markdown.includes('[checkpoint:'))
    assert.ok(!leitura.markdown.includes('Cartão feito número'))
    // Os 40 erros ocupam o espaço que sobrou (eles vêm antes do em andamento, na ordem do contrato): o cartão vira contagem.
    assert.deepEqual(leitura.emAndamento, [])
    assert.equal(leitura.foraDoTexto.emAndamento, 1)
    assert.ok((leitura.foraDoTexto.erros ?? 0) > 0)
  })

  it('sem registro de trabalho: a lacuna é dita e não há próximo passo inventado', () => {
    const { store, projectId } = novaAxon()
    const leitura = lerLeituraCurta(store, projectId, 'Claude', 6000, AGORA)
    assert.equal(leitura.estado.proximoPasso, null)
    assert.equal(leitura.estado.lacuna, 'Nenhum registro de trabalho sustenta um próximo passo neste projeto.')
  })

  it('aprovação visual registrada e nenhuma aprovação de publicação: a publicação não aparece como autorizada', () => {
    const { store, projectId } = novaAxon()
    gravar(store, projectId, 'cp-1', { nextStep: 'Publicar o site depois da aprovação visual' })
    const visual = store.proposeApproval(projectId, { agent: 'Claude', kind: 'note', title: 'Aprovação visual do layout', body: 'Texto', rationale: 'Pronto' })
    store.approveApproval(projectId, visual.id, { actor: 'dono', expectedVersion: visual.version })
    const leitura = lerLeituraCurta(store, projectId, 'Claude', 6000, AGORA)
    assert.deepEqual(leitura.dependeDoDono, [])
    assert.deepEqual(leitura.decididoPeloDono.map((l) => l.fonte.id), [visual.id])
    assert.match(leitura.decididoPeloDono[0]!.texto, /^Aprovada por dono em .*: Aprovação visual do layout$/)
    assert.ok(!leitura.markdown.includes('Publicação autorizada'))
    assert.ok(leitura.markdown.includes('(não é autorização do dono)'))
  })

  it('sem relógio informado, usa a hora de agora', () => {
    const { store, projectId } = novaAxon()
    const antes = Date.now()
    const leitura = lerLeituraCurta(store, projectId, 'Claude')
    const gerada = Date.parse(leitura.geradaEm)
    assert.ok(gerada >= antes && gerada <= Date.now())
    assert.equal(leitura.limite, 6000)
  })
})

describe('aviso da diretriz na leitura curta', () => {
  it('entra em Onde parou com a mesma informação da carta e some depois de o dono conferir', () => {
    const { store, projectId } = novaAxon()
    const ler = () => lerLeituraCurta(store, projectId, 'Claude', 6000, AGORA).markdown
    assert.doesNotMatch(ler(), /objetivo foi atualizado/)
    const nova = store.updateProjectObjective(projectId, {
      objetivo: 'Vender livros', motivo: 'A loja mudou de catálogo', agent: 'Codex', expectedRevision: 1,
    })
    const linha = `- [diretriz:${nova.id}] O objetivo foi atualizado por Codex em 18/11/2026: A loja mudou de catálogo. A atualização está na aba Diretriz para conferência do dono.`
    assert.ok(ler().split('## Onde parou')[1]?.split('\n## ')[0]?.includes(linha))
    store.marcarObjetivoVisto(projectId)
    assert.ok(!ler().includes(linha))
  })

  it('preserva a fonte e a autoria no limite mínimo com motivo, nome e checkpoint longos', () => {
    const { store, projectId } = novaAxon()
    const projeto = store.createProject({ name: 'P'.repeat(160), objective: 'Texto anterior' })
    gravar(store, projeto.id, 'grande', { agent: 'R'.repeat(80), humanSummary: 'r'.repeat(280), nextStep: 'p'.repeat(1000) })
    const motivo = 'm'.repeat(500)
    const nova = store.updateProjectObjective(projeto.id, {
      objetivo: 'Texto novo', motivo, agent: 'A'.repeat(80), expectedRevision: 1,
    })
    for (let i = 0; i < 20; i++) {
      const texto = `Conferência ${i} ${'método '.repeat(50)}`
      store.registrarLicao(projeto.id, { texto, tipo: 'regra', fraseDoDono: texto, agent: 'Dono' })
      store.registrarLicao(projeto.id, { texto, tipo: 'verificacao', fraseDoDono: texto, agent: 'Dono', momento: 'antes_de_commit' })
    }
    const leitura = lerLeituraCurta(store, projeto.id, 'Claude', 2000, AGORA)
    const linhaDoAviso = leitura.markdown.split('\n').find(linha => linha.startsWith(`- [diretriz:${nova.id}]`))!
    assert.ok(linhaDoAviso)
    const completa = lerLeituraCurta(store, projeto.id, 'Claude', 6000, AGORA).markdown
    const avisoCompleto = completa.split('\n').find(linha => linha.startsWith(`- [diretriz:${nova.id}]`))!
    const tamanhoDoAviso = avisoCompleto.length
    assert.equal(leitura.estado.emUmaFrase?.length, Math.floor((2000 - 2 * tamanhoDoAviso) * 0.07))
    assert.equal(leitura.estado.proximoPasso?.texto.length, Math.floor((2000 - 2 * tamanhoDoAviso) * 0.11))
    assert.ok(leitura.markdown.length <= 2000)
    assert.ok(leitura.markdown.includes(`[diretriz:${nova.id}]`))
    assert.ok(completa.includes(motivo))
    assert.ok(linhaDoAviso.includes(`O objetivo foi atualizado por ${'A'.repeat(80)} em 18/11/2026:`))
    assert.equal(linhaDoAviso, avisoCompleto)
    assert.match(leitura.markdown, /Atenção: .* regras do dono ficaram fora/)
    assert.match(leitura.markdown, /Atenção: .* verificações do dono ficaram fora/)
  })
})

it('preserva a leitura de um projeto sem revisão de diretriz', (t) => {
  const { store, projectId } = novaAxon()
  t.mock.method(store, 'getCharter', () => null)
  const leitura = lerLeituraCurta(store, projectId, 'Claude', 6000, AGORA)
  assert.doesNotMatch(leitura.markdown, /\[diretriz:/)
})

it('o motivo do aviso fica numa linha de contexto com segredos mascarados', () => {
  const { store, projectId } = novaAxon()
  const nova = store.updateProjectObjective(projectId, {
    objetivo: 'Vender livros', motivo: 'Catálogo novo\n  Bearer segredo-inventado conferido', agent: 'Claude', expectedRevision: 1,
  })
  const leitura = lerLeituraCurta(store, projectId, 'Claude', 6000, AGORA)
  const linha = leitura.markdown.split('\n').find(texto => texto.startsWith(`- [diretriz:${nova.id}]`))
  assert.ok(linha?.includes('Catálogo novo Bearer *** conferido. A atualização está na aba Diretriz'))
  assert.doesNotMatch(leitura.markdown, /segredo-inventado/)
})
