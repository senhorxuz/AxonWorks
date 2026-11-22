// Cenário de ponta a ponta da proposta de continuidade (docs/superpowers/specs/2026-11-19-proposta-continuidade-entre-ias.md):
// as artes dos depoimentos foram aprovadas, os testes falharam de propósito na versão anterior (fase vermelha do
// TDD), passaram na prévia do commit local a1b2c3d, e a publicação ainda depende do dono. Uma IA sugere publicar,
// o que não é autorização. Dados sintéticos, banco em memória: nada do banco real do dono.
import { WorkspaceStore } from '../../server/store.ts'

export const PASTA_DO_CENARIO = 'D:/cenario/presente-do-casal'
export const COMMIT_LOCAL = 'a1b2c3d'
export const RAMO_LOCAL = 'feat/depoimentos-com-artes'
export const SUGESTAO_DE_AGENTE = 'Sugiro publicar os depoimentos no staging agora mesmo.'
export const APROVACAO_VISUAL = 'gostei da carta rosa, do cartão com clipe e do bilhete com fita'

export interface OpcoesDoCenario {
  /** 100 cartões feitos, 40 erros gerais e 30 registros antigos, para o histórico ficar longo. */
  historicoLongo?: boolean
  /** O dono aprova a publicação no staging (aprovação registrada). */
  autorizarStaging?: boolean
}

export interface CenarioDepoimentos {
  store: WorkspaceStore
  projectId: string
  ids: {
    regra: string
    verificacao: string
    checkpointVermelho: string
    checkpointAtual: string
    evidenciaVermelha: string
    evidenciaVerde: string
    aprovacaoPublicacao: string
    cartaoDepoimentos: string
  }
}

function relogio(inicio: string): () => Date {
  let instante = Date.parse(inicio)
  return () => new Date((instante += 60_000))
}

function idDaEvidencia(store: WorkspaceStore, projectId: string, checkpointId: string): string {
  const evidencia = store.listEvidence(projectId, { checkpointId })[0]
  if (!evidencia) throw new Error('O cenário esperava uma evidência no checkpoint.')
  return evidencia.id
}

function encherHistorico(store: WorkspaceStore, projectId: string): void {
  for (let i = 1; i <= 100; i += 1) {
    store.createBoardCard(projectId, { actor: 'Claude', title: `Ajuste antigo número ${i} da página`, column: 'done' })
  }
  for (let i = 1; i <= 40; i += 1) {
    store.registrarLicao(null, {
      texto: `Erro de ambiente ${i}: no Windows, um comando de exemplo falha em silêncio quando o caminho tem espaço.`,
      agent: 'Claude',
      linhaCurta: `Erro de ambiente ${i}: caminho com espaço falha em silêncio no Windows.`,
    })
  }
  for (let i = 1; i <= 30; i += 1) {
    const revisao = store.getProject(projectId).project.revision
    store.saveCheckpoint(projectId, {
      expectedRevision: revisao,
      idempotencyKey: `antigo-${i}`,
      agent: 'Claude',
      summary: `Rodada antiga ${i} de ajustes na landing.`,
      humanSummary: `Ajustes antigos ${i} na página inicial.`,
      nextStep: `Seguir com a rodada ${i + 1}.`,
    })
  }
}

export function montarCenarioDepoimentos(opcoes: OpcoesDoCenario = {}): CenarioDepoimentos {
  const store = new WorkspaceStore(':memory:', { now: relogio('2026-11-07T12:00:00.000Z') })
  const projectId = store.createProject({
    name: 'Presente do Casal (cenário)',
    objective: 'Presente digital para casais, vendido pelo celular.',
    workspacePath: PASTA_DO_CENARIO,
  }).id

  if (opcoes.historicoLongo) encherHistorico(store, projectId)

  const regra = store.registrarLicao(projectId, {
    texto: 'Push e publicação só com o OK do dono, a cada vez.',
    agent: 'Claude',
    tipo: 'regra',
    fraseDoDono: 'não sobe nada sem eu falar',
  }).id
  const verificacao = store.registrarLicao(projectId, {
    texto: 'Rodar os testes Playwright da seção de depoimentos na prévia.',
    agent: 'Claude',
    tipo: 'verificacao',
    momento: 'antes_de_subir',
    fraseDoDono: 'antes de subir roda os testes dos depoimentos',
  }).id

  const vermelho = store.saveCheckpoint(projectId, {
    expectedRevision: store.getProject(projectId).project.revision,
    idempotencyKey: 'depoimentos-vermelho',
    agent: 'Claude',
    summary: 'Testes novos dos depoimentos escritos antes do código; falharam na versão anterior, como esperado (fase vermelha do TDD).',
    humanSummary: 'Os testes novos dos depoimentos foram escritos e falharam na versão antiga, como deveriam.',
    nextStep: 'Implementar as três artes até os testes passarem.',
    evidence: [{ command: 'npx playwright test depoimentos', outcome: 'failed', details: 'Esperado falhar: a versão anterior não tem as três artes.' }],
  })

  const cartao = store.createBoardCard(projectId, {
    actor: 'Claude',
    title: 'Depoimentos com três artes',
    description: 'Carta rosa, cartão com clipe e bilhete com fita. Aprovado e testado; falta publicar.',
    column: 'awaiting_deploy',
    needsOwner: true,
  }).id

  const atual = store.saveCheckpoint(projectId, {
    expectedRevision: store.getProject(projectId).project.revision,
    idempotencyKey: 'depoimentos-verde',
    agent: 'Claude',
    summary: `O dono aprovou as três artes (carta rosa, cartão com clipe e bilhete com fita). Seis testes Playwright passaram na prévia local. Commit ${COMMIT_LOCAL} só no computador, no ramo ${RAMO_LOCAL}. O staging continua na versão anterior.`,
    humanSummary: 'As artes dos depoimentos foram aprovadas e testadas no computador; a publicação ainda depende de você.',
    nextStep: `Publicar o commit ${COMMIT_LOCAL} no staging depois do OK do dono.`,
    evidence: [{ command: 'npx playwright test depoimentos', outcome: 'passed', details: `6 testes passaram na prévia do commit ${COMMIT_LOCAL}.` }],
  })

  const aprovacao = store.proposeApproval(projectId, {
    agent: 'Claude',
    kind: 'note',
    title: 'Posso publicar os depoimentos no staging?',
    body: `Publicar o commit ${COMMIT_LOCAL} no staging.`,
    rationale: 'Artes aprovadas e testes verdes na prévia local.',
  })

  const evidenciaVerde = idDaEvidencia(store, projectId, atual.id)
  store.recordOwnerApproval(projectId, cartao, { agent: 'Claude', tipo: 'visual', fraseDoDono: APROVACAO_VISUAL, versao: COMMIT_LOCAL })
  store.updateDelivery(projectId, cartao, {
    agent: 'Claude',
    testes: { estado: 'passando', evidenciaId: evidenciaVerde },
    codigo: { onde: 'local', commit: COMMIT_LOCAL, ramo: RAMO_LOCAL },
  })

  store.postMessage(projectId, { from: 'Codex', to: '*', kind: 'note', body: SUGESTAO_DE_AGENTE })

  if (opcoes.autorizarStaging) {
    store.approveApproval(projectId, aprovacao.id, { actor: 'Dono', expectedVersion: aprovacao.version, decisionNote: 'Pode publicar no staging.' })
    store.recordOwnerApproval(projectId, cartao, { tipo: 'publicacao', ambiente: 'staging', versao: COMMIT_LOCAL }, 'Dono')
  }

  return {
    store,
    projectId,
    ids: {
      regra,
      verificacao,
      checkpointVermelho: vermelho.id,
      checkpointAtual: atual.id,
      evidenciaVermelha: idDaEvidencia(store, projectId, vermelho.id),
      evidenciaVerde,
      aprovacaoPublicacao: aprovacao.id,
      cartaoDepoimentos: cartao,
    },
  }
}
