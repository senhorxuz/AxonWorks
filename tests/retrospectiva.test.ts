process.env.TZ = 'America/Sao_Paulo'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Checkpoint, ProjectDetail, Task } from '../shared/types.ts'
import type { Decision } from '../shared/continuity.ts'
import type { EvidenceView } from '../shared/evidence.ts'
import { calcularRetrospectiva, decisoesDoRumo } from '../src/retrospectiva/calculos.ts'
import { nivelDeConfianca } from '../src/confianca.ts'

const AGORA = new Date('2026-09-16T15:00:00-03:00')

function projeto(criadoEm: string, tarefas: Partial<Task>[] = [], checkpoints: Partial<Checkpoint>[] = []): ProjectDetail {
  return {
    project: { id: 'p1', name: 'Projeto', objective: 'Objetivo', createdAt: criadoEm, updatedAt: criadoEm, revision: 0 } as ProjectDetail['project'],
    tasks: tarefas.map((t, i) => ({ id: `t${i}`, title: `Tarefa ${i}`, status: 'todo', assignee: null, completionCheckpointId: null, createdAt: criadoEm, ...t }) as Task),
    checkpoints: checkpoints.map((c, i) => ({ id: `c${i}`, projectId: 'p1', taskId: null, agent: 'Astra', summary: `Resumo ${i}`, nextStep: '', blockers: [], decisions: [], evidence: [], revision: i + 1, createdAt: criadoEm, ...c }) as Checkpoint),
    messages: [],
  }
}

describe('retrospectiva: números', () => {
  it('projeto sem nada devolve zeros reais e nenhuma trilha', () => {
    const r = calcularRetrospectiva(projeto('2026-09-14T10:00:00-03:00'), AGORA)
    assert.equal(r.tarefasConcluidas, 0)
    assert.equal(r.checkpoints, 0)
    assert.equal(r.diasDeTrabalho, 0)
    assert.equal(r.trilha, null)
    assert.deepEqual(r.entregas, [])
    assert.deepEqual(r.porAgente, [])
    assert.equal(r.semanaMaisProdutiva, null)
  })

  it('dias de trabalho contam dias locais distintos com checkpoint', () => {
    const r = calcularRetrospectiva(projeto('2026-09-14T08:00:00-03:00', [], [
      { createdAt: '2026-09-14T09:00:00-03:00' },
      { createdAt: '2026-09-14T23:30:00-03:00' }, // ainda dia 14 no horário local
      { createdAt: '2026-09-16T01:00:00-03:00' },
    ]), AGORA)
    assert.equal(r.checkpoints, 3)
    assert.equal(r.diasDeTrabalho, 2)
  })
})

describe('retrospectiva: trilha de checkpoints', () => {
  it('posiciona cada checkpoint pelo tempo real, do primeiro (0) ao último (1)', () => {
    const r = calcularRetrospectiva(projeto('2026-09-14T08:00:00-03:00',
      [{ id: 'a', title: 'Núcleo', status: 'done', completionCheckpointId: 'c2' }],
      [
        { id: 'c2', agent: 'Gemini', taskId: 'a', summary: 'Núcleo técnico', humanSummary: 'O núcleo ficou pronto.', createdAt: '2026-09-16T10:00:00-03:00' },
        { id: 'c0', agent: 'Astra', summary: 'Começo', createdAt: '2026-09-14T10:00:00-03:00' },
        { id: 'c1', agent: 'Astra', summary: 'Meio', createdAt: '2026-09-15T10:00:00-03:00' },
      ]), AGORA)
    assert.ok(r.trilha)
    assert.deepEqual(r.trilha.pontos.map(p => [p.checkpointId, p.posicao]), [['c0', 0], ['c1', 0.5], ['c2', 1]])
    assert.deepEqual(r.trilha.pontos[2]!.tarefaConcluida, { id: 'a', titulo: 'Núcleo' })
    assert.equal(r.trilha.pontos[2]!.fraseSimples, 'O núcleo ficou pronto.')
    assert.equal(r.trilha.pontos[0]!.tarefaConcluida, undefined)
    assert.equal(r.trilha.inicio, '2026-09-14T10:00:00-03:00')
    assert.equal(r.trilha.fim, '2026-09-16T10:00:00-03:00')
    // 15:00 menos 10:00 do mesmo dia: 5 horas sem checkpoint até agora.
    assert.equal(r.trilha.semCheckpointHaMs, 5 * 60 * 60 * 1000)
  })

  it('um único checkpoint fica na ponta da trilha', () => {
    const r = calcularRetrospectiva(projeto('2026-09-16T08:00:00-03:00', [], [{ id: 'c0', createdAt: '2026-09-16T09:00:00-03:00' }]), AGORA)
    assert.deepEqual(r.trilha?.pontos.map(p => p.posicao), [1])
  })
})

describe('retrospectiva: entregas, pessoas e semana', () => {
  const detalhe = projeto('2026-09-01T08:00:00-03:00', [
    { id: 'a', title: 'Núcleo', status: 'done', completionCheckpointId: 'c0' },
    { id: 'b', title: 'Transportes', status: 'done', completionCheckpointId: 'c2' },
    { id: 'c', title: 'Importada sem checkpoint', status: 'done', completionCheckpointId: null },
    { id: 'd', title: 'Em andamento', status: 'in_progress' },
  ], [
    { id: 'c0', agent: 'Astra', taskId: 'a', summary: 'Núcleo técnico', humanSummary: 'O núcleo ficou pronto.', createdAt: '2026-09-02T10:00:00-03:00' },
    { id: 'c1', agent: 'Gemini', createdAt: '2026-09-09T10:00:00-03:00' },
    { id: 'c2', agent: 'Gemini', taskId: 'b', summary: 'Rotas HTTP e MCP', createdAt: '2026-09-10T10:00:00-03:00' },
    { id: 'c3', agent: 'Gemini', createdAt: '2026-09-11T10:00:00-03:00' },
  ])

  it('entregas vêm das tarefas concluídas com checkpoint, da mais recente para a mais antiga', () => {
    const r = calcularRetrospectiva(detalhe, AGORA)
    assert.equal(r.tarefasConcluidas, 3, 'conta toda tarefa concluída, mesmo sem checkpoint')
    assert.deepEqual(r.entregas.map(e => e.titulo), ['Transportes', 'Núcleo'])
    assert.equal(r.entregas[1]!.fraseSimples, 'O núcleo ficou pronto.')
    assert.equal(r.entregas[0]!.fraseSimples, undefined)
    assert.equal(r.entregas[0]!.resumoTecnico, 'Rotas HTTP e MCP')
    assert.equal(r.entregas[0]!.agente, 'Gemini')
    assert.equal(r.entregas[0]!.checkpointId, 'c2')
  })

  it('quem entregou o quê: contagem por nome declarado, mais checkpoints primeiro', () => {
    const r = calcularRetrospectiva(detalhe, AGORA)
    assert.deepEqual(r.porAgente, [
      { agente: 'Gemini', entregas: 1, checkpoints: 3 },
      { agente: 'Astra', entregas: 1, checkpoints: 1 },
    ])
  })

  it('semana mais produtiva só aparece quando há entregas em mais de uma semana', () => {
    const duasSemanas = calcularRetrospectiva(detalhe, AGORA)
    // 02/09 cai na semana de 31/08; 10/09 na de 07/09. Empate: vence a mais recente.
    assert.deepEqual(duasSemanas.semanaMaisProdutiva, { inicio: '2026-09-07', fim: '2026-09-13', entregas: 1 })

    const umaSemana = calcularRetrospectiva(projeto('2026-09-14T08:00:00-03:00',
      [{ id: 'x', status: 'done', completionCheckpointId: 'c0' }],
      [{ id: 'c0', createdAt: '2026-09-15T10:00:00-03:00' }]), AGORA)
    assert.equal(umaSemana.semanaMaisProdutiva, null)
  })
})

describe('retrospectiva: decisões do rumo', () => {
  const base = { projectId: 'p1', body: '', proposedBy: 'Astra', acceptedBy: 'Astra', revokedBy: null, supersedesId: null, supersededById: null, version: 1, updatedAt: '', source: { kind: 'agent_proposal' } }
  it('ignora propostas, ordena pela data e diz por qual decisão cada uma foi trocada', () => {
    const lista = decisoesDoRumo([
      { ...base, id: 'd3', title: 'Export em v3', status: 'accepted', supersedesId: 'd1', createdAt: '2026-09-12T10:00:00Z' },
      { ...base, id: 'd1', title: 'Export em v2', status: 'superseded', supersededById: 'd3', createdAt: '2026-09-02T10:00:00Z' },
      { ...base, id: 'd2', title: 'Ainda em discussão', status: 'proposed', createdAt: '2026-09-05T10:00:00Z' },
      { ...base, id: 'd4', title: 'Aprovar pelo chat', status: 'revoked', createdAt: '2026-09-08T10:00:00Z' },
    ] as unknown as Decision[])
    assert.deepEqual(lista.map(d => [d.titulo, d.situacao, d.trocadaPor ?? null]), [
      ['Export em v2', 'substituida', 'Export em v3'],
      ['Aprovar pelo chat', 'revogada', null],
      ['Export em v3', 'vale-hoje', null],
    ])
  })
})

describe('confiança de uma entrega', () => {
  const ev = (assertions: string[]) => ({ assertions }) as unknown as EvidenceView
  it('usa a afirmação mais forte presente', () => {
    assert.deepEqual(nivelDeConfianca([]), { rotulo: 'Sem evidência registrada', tom: 'sem-evidencia' })
    assert.deepEqual(nivelDeConfianca([ev(['agent_reported'])]), { rotulo: 'Informado pela IA', tom: 'relato' })
    assert.deepEqual(nivelDeConfianca([ev(['agent_reported', 'cross_checked'])]), { rotulo: 'Conferido por outra IA', tom: 'ia' })
    assert.deepEqual(nivelDeConfianca([ev(['agent_reported']), ev(['agent_reported', 'artifact_bound'])]), { rotulo: 'Arquivos conferidos pelo sistema', tom: 'sistema' })
  })
})
