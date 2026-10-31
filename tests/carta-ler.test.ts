import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { lerDadosDaCarta } from '../server/carta/ler.ts'
import { montarCarta } from '../server/carta/montar.ts'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import { AGENTE_AUTOMATICO, PROXIMO_PASSO_AUTOMATICO } from '../shared/carta.ts'

const stores: WorkspaceStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

/** Banco em memória com relógio próprio: cada gravação cai um minuto depois da anterior. */
function novaAxon(): { store: WorkspaceStore; projectId: string; agora: () => Date } {
  let instante = Date.parse('2026-10-20T10:00:00.000Z')
  const relogio = (): Date => new Date((instante += 60_000))
  const store = new WorkspaceStore(':memory:', { now: relogio })
  stores.push(store)
  const projectId = store.createProject({ name: 'Alfa', objective: 'Vender cursos pela internet' }).id
  return { store, projectId, agora: () => new Date(instante + 3 * 86_400_000) }
}

function rascunhoAutomatico(store: WorkspaceStore, projectId: string, resumo: string, taskId?: string) {
  return store.saveWorkDraft(projectId, {
    agent: AGENTE_AUTOMATICO,
    expectedVersion: 0,
    taskId,
    summary: resumo,
    nextAction: PROXIMO_PASSO_AUTOMATICO,
  })
}

describe('lerDadosDaCarta', () => {
  it('projeto com 2 cartões, 1 decisão proposta e 1 rascunho automático: cada um no seu lugar', () => {
    const { store, projectId, agora } = novaAxon()
    store.createBoardCard(projectId, { actor: 'Claude', title: 'Publicar o site', column: 'in_progress' })
    store.createBoardCard(projectId, { actor: 'Claude', title: 'Escolher o domínio', column: 'pending' })
    store.proposeDecision(projectId, { agent: 'Claude', title: 'Usar Postgres', body: 'Por causa da escala' })
    rascunhoAutomatico(store, projectId, 'A sessão mexeu no site')

    const carta = montarCarta(lerDadosDaCarta(store, projectId), agora())

    assert.deepEqual(
      carta.falta.em_andamento.map((i) => [i.origem, i.titulo, i.etapa]),
      [['cartao', 'Publicar o site', 'Em andamento']],
    )
    assert.deepEqual(
      carta.falta.a_fazer.map((i) => [i.origem, i.titulo]),
      [['cartao', 'Escolher o domínio']],
    )
    assert.deepEqual(
      carta.falta.precisa_de_voce.map((i) => [i.origem, i.titulo, i.detalhe, i.versao]),
      [['decisao', 'Usar Postgres', 'Por causa da escala', 0]],
    )
    assert.equal(carta.rascunhoAutomatico?.resumo, 'A sessão mexeu no site')
    assert.equal(carta.projeto.nome, 'Alfa')
    assert.equal(carta.diasParado, 3)
  })

  it('lê tarefas, registros, backlog, aprovações e bloqueios do projeto', () => {
    const { store, projectId, agora } = novaAxon()
    const tarefa = store.createTask(projectId, { title: 'Migrar o banco' })
    store.createBacklogItem(projectId, { title: 'Rever preços', createdBy: 'Claude', stage: 'ready' })
    store.createBacklogItem(projectId, { title: 'Ideia solta', createdBy: 'Claude', stage: 'idea' })
    store.proposeApproval(projectId, { agent: 'Claude', kind: 'note', title: 'Posso mexer no login?', body: 'Texto', rationale: 'Está quebrado' })
    store.openBlocker(projectId, { agent: 'Claude', title: 'Cobrança do GitHub', body: 'O cartão foi recusado' })
    store.saveCheckpoint(projectId, {
      expectedRevision: store.getProject(projectId).project.revision,
      idempotencyKey: 'cp-1',
      agent: 'Claude',
      summary: 'Resumo técnico',
      humanSummary: 'O site está no ar; falta o domínio.',
      nextStep: 'Escolher o domínio',
    })

    const dados = lerDadosDaCarta(store, projectId)
    assert.deepEqual(dados.tasks.map((t) => t.id), [tarefa.id])
    assert.deepEqual(dados.backlog.map((b) => b.title).sort(), ['Ideia solta', 'Rever preços'])
    assert.deepEqual(dados.approvals.map((a) => a.title), ['Posso mexer no login?'])
    assert.deepEqual(dados.blockers.map((b) => b.title), ['Cobrança do GitHub'])
    assert.deepEqual(dados.checkpoints.map((c) => c.humanSummary), ['O site está no ar; falta o domínio.'])
    assert.equal(dados.project.id, projectId)

    const carta = montarCarta(dados, agora())
    assert.equal(carta.emUmaFrase, 'O site está no ar; falta o domínio.')
    assert.deepEqual(carta.falta.precisa_de_voce.map((i) => i.titulo), ['Posso mexer no login?'])
    assert.deepEqual(carta.falta.travado.map((i) => i.titulo), ['Cobrança do GitHub'])
    assert.deepEqual(carta.falta.a_fazer.map((i) => i.titulo).sort(), ['Migrar o banco', 'Rever preços'])
    assert.deepEqual(carta.falta.ideias.map((i) => i.titulo), ['Ideia solta'])
  })

  it('traz as decisões propostas (e só elas viram pendência do dono)', () => {
    const { store, projectId, agora } = novaAxon()
    const aceita = store.proposeDecision(projectId, { agent: 'Claude', title: 'Já aceita', body: 'a' })
    store.acceptDecision(projectId, aceita.id, { actor: 'dono', expectedVersion: aceita.version })
    store.proposeDecision(projectId, { agent: 'Claude', title: 'Ainda proposta', body: 'b' })

    const dados = lerDadosDaCarta(store, projectId)
    assert.deepEqual(dados.decisions.map((d) => [d.title, d.status]).sort(), [
      ['Já aceita', 'accepted'],
      ['Ainda proposta', 'proposed'],
    ].sort())
    assert.deepEqual(montarCarta(dados, agora()).falta.precisa_de_voce.map((i) => i.titulo), ['Ainda proposta'])
  })

  it('o rascunho automático é o do agente automático, sem tarefa', () => {
    const { store, projectId } = novaAxon()
    const tarefa = store.createTask(projectId, { title: 'Alguma tarefa' })
    store.saveWorkDraft(projectId, {
      agent: 'Claude',
      expectedVersion: 0,
      summary: 'Rascunho deliberado do Claude',
      nextAction: 'Seguir',
    })
    rascunhoAutomatico(store, projectId, 'Automático com tarefa', tarefa.id)
    rascunhoAutomatico(store, projectId, 'Automático sem tarefa')

    const dados = lerDadosDaCarta(store, projectId)
    assert.equal(dados.rascunhoAutomatico?.summary, 'Automático sem tarefa')
    assert.equal(dados.rascunhoAutomatico?.actorId, AGENTE_AUTOMATICO)
    assert.equal(dados.rascunhoAutomatico?.taskId, null)
  })

  it('sem rascunho automático: null (rascunho deliberado e automático de tarefa não valem)', () => {
    const { store, projectId } = novaAxon()
    assert.equal(lerDadosDaCarta(store, projectId).rascunhoAutomatico, null)

    const tarefa = store.createTask(projectId, { title: 'Alguma tarefa' })
    store.saveWorkDraft(projectId, { agent: 'Claude', expectedVersion: 0, summary: 'Deliberado', nextAction: 'Seguir' })
    rascunhoAutomatico(store, projectId, 'Automático de tarefa', tarefa.id)
    assert.equal(lerDadosDaCarta(store, projectId).rascunhoAutomatico, null)
  })

  it('a saúde da conexão vem do registro dos ganchos; sem registro, tudo null', () => {
    const { store, projectId } = novaAxon()
    assert.deepEqual(lerDadosDaCarta(store, projectId).saude, { ultimoRegistroAutomatico: null, ultimoErro: null })

    store.registrarEventoDeIntegracao(projectId, { tipo: 'compactar', ok: true, detalhe: null })
    store.registrarEventoDeIntegracao(projectId, { tipo: 'fechar', ok: false, detalhe: 'banco ocupado' })
    const saude = lerDadosDaCarta(store, projectId).saude
    assert.deepEqual(saude, { ultimoRegistroAutomatico: '2026-10-20T10:02:00.000Z', ultimoErro: 'banco ocupado' })
    assert.deepEqual(montarCarta(lerDadosDaCarta(store, projectId), new Date('2026-10-21T00:00:00.000Z')).saude, saude)
  })

  it('projeto sem nada: carta vazia, sem número', () => {
    const { store, projectId, agora } = novaAxon()
    const carta = montarCarta(lerDadosDaCarta(store, projectId), agora())
    assert.equal(carta.ultimaAtividade, null)
    assert.equal(carta.diasParado, null)
    assert.equal(carta.emUmaFrase, null)
    assert.deepEqual(carta.falta, { precisa_de_voce: [], travado: [], em_andamento: [], a_fazer: [], ideias: [] })
  })

  it('projeto que não existe: o erro do store sobe, sem carta inventada', () => {
    const { store } = novaAxon()
    assert.throws(
      () => lerDadosDaCarta(store, '00000000-0000-4000-8000-000000000000'),
      (erro: unknown) => erro instanceof DomainError && erro.status === 404,
    )
  })
})

describe('salvamento de compactação na carta (D5)', () => {
  it('o salvamento gravado pelo store chega inteiro à carta; o rascunho mais velho que ele some', () => {
    const { store, projectId, agora } = novaAxon()
    rascunhoAutomatico(store, projectId, 'Rascunho de antes do salvamento')
    store.saveCompactionSnapshot(projectId, {
      expectedRevision: 0,
      idempotencyKey: 'salvar-1',
      agent: 'Claude',
      summary: 'Login refeito; falta o cadastro.',
      humanSummary: 'O login novo está pronto.',
      nextStep: 'Fazer o cadastro.',
      pedidosDoDono: ['Arruma o login'],
      pendencias: ['Cadastro'],
      arquivosMexidos: ['src/login.ts'],
    })

    const carta = montarCarta(lerDadosDaCarta(store, projectId), agora())

    assert.equal(carta.salvamentos.length, 1)
    assert.deepEqual(
      { ...carta.salvamentos[0], id: 'x', criadoEm: 'y' },
      {
        id: 'x',
        criadoEm: 'y',
        humanSummary: 'O login novo está pronto.',
        resumo: 'Login refeito; falta o cadastro.',
        pedidosDoDono: ['Arruma o login'],
        pendencias: ['Cadastro'],
        perguntasAbertas: [],
        arquivosMexidos: ['src/login.ts'],
        proximoPasso: 'Fazer o cadastro.',
      },
    )
    assert.equal(carta.rascunhoAutomatico, null)
    assert.equal(carta.emUmaFrase, 'O login novo está pronto.')
  })
})

describe('lerDadosDaCarta: diretriz vigente (lote 2, D2)', () => {
  it('a diretriz vigente vem do store; velha e com 5 registros depois, vira aviso na carta', () => {
    const { store, projectId } = novaAxon()
    assert.deepEqual(lerDadosDaCarta(store, projectId).diretriz, store.getCharter(projectId))
    for (let i = 0; i < 5; i++) {
      store.saveCheckpoint(projectId, {
        expectedRevision: store.getProject(projectId).project.revision,
        idempotencyKey: `d2-${i}`,
        agent: 'Claude',
        summary: 'Registro',
        nextStep: 'Seguir',
      })
    }
    const carta = montarCarta(lerDadosDaCarta(store, projectId), new Date('2026-11-10T10:00:00.000Z'))
    assert.deepEqual(carta.avisos, [
      'A diretriz deste projeto não muda desde 20/10/2026, e desde então houve 5 registros. Se o projeto mudou, o Claude pode propor a atualização, e você aprova aqui na Axon.',
    ])
    assert.deepEqual(carta.avisosDaRetomada, [
      'A diretriz deste projeto não muda desde 20/10/2026; depois dela houve 5 registros. Quando o estado mudou (por exemplo, a versão no ar), a atualização é proposta com save_charter e o dono aprova na tela.',
    ])
  })
})
