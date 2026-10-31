import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { DomainError, WorkspaceStore } from '../server/store.ts'
import type { CheckpointInput, ProjectDetail } from '../shared/types.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const T0 = new Date('2026-09-14T15:00:00.000Z')

let cleanups: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) {
    try {
      dispose()
    } catch {
      /* limpeza */
    }
  }
})

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DomainError, `esperado DomainError, recebido ${String(err)}`)
    assert.equal(err.status, status)
    assert.equal(err.code, code)
    return true
  })
}

function makeStore(now?: () => Date): { store: WorkspaceStore; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'axon-continuity-'))
  const dbPath = join(dir, 'workspace.sqlite')
  const store = new WorkspaceStore(dbPath, now ? { now } : undefined)
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* já fechado */
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return { store, dbPath }
}

describe('Módulo de Continuidade e Memória Confiável', () => {
  describe('searchProjects (busca literal parametrizada)', () => {
    it('encontra termos literais em projetos, tarefas, checkpoints e mensagens', () => {
      const { store } = makeStore(() => T0)
      const p1 = store.createProject({
        name: 'Projeto Alfa',
        objective: 'Desenvolvimento do núcleo criptográfico',
      })
      const t1 = store.createTask(p1.id, { title: 'Implementar handshake HMAC' })
      store.claimTask(p1.id, t1.id, { agent: 'agente-1', expectedVersion: 0 })
      store.saveCheckpoint(p1.id, {
        expectedRevision: 0,
        idempotencyKey: 'cp-search-1',
        taskId: t1.id,
        agent: 'agente-1',
        summary: 'Finalizado algoritmo AES-GCM',
        nextStep: 'Testar performance com buffers grandes',
        decisions: ['Adotar curvas elípticas Ed25519'],
        blockers: ['Aguardando benchmark de memória'],
      })
      store.postMessage(p1.id, {
        from: 'agente-1',
        to: 'agente-2',
        kind: 'note',
        body: 'Verificar alocação de memória no buffer circular',
      })

      // Busca por objetivo do projeto
      const r1 = store.searchProjects('criptográfico')
      assert.equal(r1.length, 1)
      assert.equal(r1[0]?.kind, 'project')
      assert.equal(r1[0]?.recordId, p1.id)
      assert.equal(r1[0]?.projectName, 'Projeto Alfa')
      assert.ok(r1[0]?.excerpt.includes('criptográfico'))

      // Busca por título de tarefa
      const r2 = store.searchProjects('handshake')
      assert.equal(r2.length, 1)
      assert.equal(r2[0]?.kind, 'task')
      assert.equal(r2[0]?.recordId, t1.id)
      assert.ok(r2[0]?.excerpt.includes('handshake'))

      // Busca por decisão em checkpoint
      const r3 = store.searchProjects('Ed25519')
      assert.equal(r3.length, 1)
      assert.equal(r3[0]?.kind, 'checkpoint')
      assert.ok(r3[0]?.excerpt.includes('Ed25519'))

      // Busca por mensagem
      const r4 = store.searchProjects('buffer circular')
      assert.equal(r4.length, 1)
      assert.equal(r4[0]?.kind, 'message')
      assert.ok(r4[0]?.excerpt.includes('buffer circular'))

      // Termo presente em múltiplos locais (memória aparece em checkpoint e mensagem)
      const r5 = store.searchProjects('memória')
      assert.ok(r5.length >= 2)
      assert.ok(r5.some((r) => r.kind === 'checkpoint'))
      assert.ok(r5.some((r) => r.kind === 'message'))
    })

    it('escapa caracteres curingas do LIKE (% e _ e \\) tratando-os como literais', () => {
      const { store } = makeStore()
      const p = store.createProject({
        name: 'Busca 100% segura_e_precisa',
        objective: 'Testar padrões como C:\\Arquivos\\dados e 50% de ganho',
      })
      store.createTask(p.id, { title: 'Tarefa_com_underscore e 100% teste' })

      // '%' não deve casar qualquer texto; deve casar o literal '100%'
      const rPercent = store.searchProjects('100%')
      assert.ok(rPercent.length >= 1)
      assert.ok(rPercent.every((r) => r.excerpt.includes('100%')))

      // '_' não deve agir como curinga de caractere único
      const rUnderscore = store.searchProjects('segura_e_precisa')
      assert.equal(rUnderscore.length, 1)

      // '\\' deve ser tratado literalmente
      const rBackslash = store.searchProjects('C:\\Arquivos')
      assert.equal(rBackslash.length, 1)
      assert.ok(rBackslash[0]?.excerpt.includes('C:\\Arquivos'))
    })

    it('rejeita query vazia, só espaços ou longa demais (máx 200)', () => {
      const { store } = makeStore()
      expectDomain(() => store.searchProjects(''), 400, 'invalid_input')
      expectDomain(() => store.searchProjects('   '), 400, 'invalid_input')
      expectDomain(() => store.searchProjects('a'.repeat(201)), 400, 'invalid_input')
    })
  })

  describe('getInbox e acknowledgeMessage (caixa de entrada e recibos)', () => {
    it('filtra por agente de destino e broadcast (*), respeitando projeto', () => {
      const { store } = makeStore(() => T0)
      const p1 = store.createProject({ name: 'Projeto 1', objective: 'Obj 1' })
      const p2 = store.createProject({ name: 'Projeto 2', objective: 'Obj 2' })

      // Mensagem direta para agente alfa em p1
      const m1 = store.postMessage(p1.id, {
        from: 'orquestrador',
        to: 'alfa',
        kind: 'question',
        body: 'Qual o status da tarefa?',
      })

      // Mensagem broadcast em p1
      const m2 = store.postMessage(p1.id, {
        from: 'orquestrador',
        to: '*',
        kind: 'note',
        body: 'Aviso geral para todos os agentes',
      })

      // Mensagem direta para agente beta em p1
      store.postMessage(p1.id, {
        from: 'orquestrador',
        to: 'beta',
        kind: 'note',
        body: 'Mensagem privada para beta',
      })

      // Mensagem em p2 (não deve vazar para p1)
      store.postMessage(p2.id, {
        from: 'orquestrador',
        to: 'alfa',
        kind: 'note',
        body: 'Mensagem do projeto 2',
      })

      const inboxAlfa = store.getInbox(p1.id, 'alfa')
      assert.equal(inboxAlfa.length, 2)
      assert.equal(inboxAlfa[0]?.message.id, m1.id)
      assert.equal(inboxAlfa[0]?.acknowledgedAt, null)
      assert.equal(inboxAlfa[1]?.message.id, m2.id)
      assert.equal(inboxAlfa[1]?.acknowledgedAt, null)

      const inboxBeta = store.getInbox(p1.id, 'beta')
      assert.equal(inboxBeta.length, 2)
      assert.ok(inboxBeta.some((i) => i.message.body === 'Mensagem privada para beta'))
      assert.ok(inboxBeta.some((i) => i.message.body === 'Aviso geral para todos os agentes'))
    })

    it('acknowledgeMessage registra recibo idempotente sem reescrever a tabela de mensagens', () => {
      const { store } = makeStore(() => T0)
      const p = store.createProject({ name: 'P', objective: 'O' })
      const msg = store.postMessage(p.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'question',
        body: 'Verificar contrato',
      })

      // Recibo inicial
      const ack1 = store.acknowledgeMessage(p.id, msg.id, { agent: 'alfa' })
      assert.equal(ack1.messageId, msg.id)
      assert.equal(ack1.agent, 'alfa')
      assert.equal(ack1.acknowledgedAt, T0.toISOString())

      // Idempotência: mesma confirmação não gera erro e devolve o mesmo timestamp
      const ack2 = store.acknowledgeMessage(p.id, msg.id, { agent: 'alfa' })
      assert.equal(ack2.acknowledgedAt, ack1.acknowledgedAt)

      // getInbox reflete acknowledgedAt
      const inbox = store.getInbox(p.id, 'alfa')
      assert.equal(inbox.length, 1)
      assert.equal(inbox[0]?.acknowledgedAt, T0.toISOString())

      // unreadOnly filtra mensagens confirmadas
      const unread = store.getInbox(p.id, 'alfa', { unreadOnly: true })
      assert.equal(unread.length, 0)

      // Tabela de mensagens original não foi reescrita ou mutada
      const projectDetail = store.getProject(p.id)
      assert.equal(projectDetail.messages[0]?.id, msg.id)
      assert.equal(projectDetail.messages[0]?.body, 'Verificar contrato')
    })

    it('permite confirmação de broadcast (*) por múltiplos agentes independentes', () => {
      const { store } = makeStore(() => T0)
      const p = store.createProject({ name: 'P', objective: 'O' })
      const broadcast = store.postMessage(p.id, {
        from: 'coord',
        to: '*',
        kind: 'note',
        body: 'Reunião de alinhamento',
      })

      // Alfa confirma
      store.acknowledgeMessage(p.id, broadcast.id, { agent: 'alfa' })

      // Alfa vê confirmado; Beta vê como não lido
      const inboxAlfa = store.getInbox(p.id, 'alfa')
      assert.equal(inboxAlfa[0]?.acknowledgedAt, T0.toISOString())

      const inboxBetaUnread = store.getInbox(p.id, 'beta', { unreadOnly: true })
      assert.equal(inboxBetaUnread.length, 1)

      // Beta confirma
      store.acknowledgeMessage(p.id, broadcast.id, { agent: 'beta' })
      const inboxBetaAfter = store.getInbox(p.id, 'beta', { unreadOnly: true })
      assert.equal(inboxBetaAfter.length, 0)
    })

    it('rejeita confirmação por agente que não é o destinatário (409 recipient_mismatch)', () => {
      const { store } = makeStore()
      const p = store.createProject({ name: 'P', objective: 'O' })
      const msg = store.postMessage(p.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'note',
        body: 'Confidencial para alfa',
      })

      expectDomain(
        () => store.acknowledgeMessage(p.id, msg.id, { agent: 'hacker' }),
        409,
        'recipient_mismatch',
      )
    })

    it('rejeita confirmação para mensagem ou projeto inexistente (404)', () => {
      const { store } = makeStore()
      const p = store.createProject({ name: 'P', objective: 'O' })
      expectDomain(
        () => store.acknowledgeMessage(p.id, randomUUID(), { agent: 'alfa' }),
        404,
        'not_found',
      )
      expectDomain(
        () => store.acknowledgeMessage(randomUUID(), randomUUID(), { agent: 'alfa' }),
        404,
        'not_found',
      )
    })
  })

  describe('resolveMessageAttention (leitura separada de resolução)', () => {
    function makeClockForResolution(start: Date) {
      let current = start
      return {
        now: () => current,
        advance(ms: number) {
          current = new Date(current.getTime() + ms)
        },
      }
    }

    it('mantém question em atenção após ack e só a remove depois de resolução explícita persistida', () => {
      const clock = makeClockForResolution(T0)
      const { store, dbPath } = makeStore(() => clock.now())
      const project = store.createProject({ name: 'Pergunta persistente', objective: 'Não confundir ler com resolver' })
      const question = store.postMessage(project.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'question',
        body: 'Qual formato será usado?',
      })

      store.acknowledgeMessage(project.id, question.id, { agent: 'alfa' })
      const afterAck = store.getResumeBrief(project.id, 'alfa')
      assert.ok(afterAck.attention.some((item) => item.sourceId === question.id))
      assert.equal(afterAck.inbox[0]?.resolution, null)

      clock.advance(1000)
      const resolution = store.resolveMessageAttention(project.id, question.id, {
        agent: 'alfa',
        note: 'Usaremos o formato estruturado v2.',
      })
      assert.equal(resolution.projectId, project.id)
      assert.equal(resolution.messageId, question.id)
      assert.equal(resolution.agent, 'alfa')
      assert.equal(resolution.note, 'Usaremos o formato estruturado v2.')
      assert.equal(resolution.responseMessageId, null)
      assert.equal(resolution.checkpointId, null)
      assert.equal(resolution.resolvedAt, clock.now().toISOString())

      const afterResolution = store.getResumeBrief(project.id, 'alfa')
      assert.equal(afterResolution.attention.some((item) => item.sourceId === question.id), false)
      assert.deepEqual(afterResolution.inbox[0]?.resolution, resolution)

      store.close()
      const reopened = new WorkspaceStore(dbPath)
      cleanups.push(() => reopened.close())
      assert.deepEqual(reopened.getInbox(project.id, 'alfa')[0]?.resolution, resolution)
    })

    it('aceita resolução de question/review por broadcast sem ack com referências autorais do mesmo projeto', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Referências', objective: 'Vincular resposta e checkpoint' })
      const question = store.postMessage(project.id, {
        from: 'coord',
        to: '*',
        kind: 'question',
        body: 'A análise terminou?',
      })
      const review = store.postMessage(project.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'review',
        body: 'Revise a evidência.',
      })
      const response = store.postMessage(project.id, {
        from: 'alfa',
        to: 'coord',
        kind: 'note',
        body: 'A análise terminou e está documentada.',
      })
      const checkpoint = store.saveCheckpoint(project.id, {
        expectedRevision: 0,
        idempotencyKey: 'resolution-reference',
        agent: 'alfa',
        summary: 'Revisão concluída',
        nextStep: 'Aguardar nova tarefa',
      })

      const byResponse = store.resolveMessageAttention(project.id, question.id, {
        agent: 'alfa',
        responseMessageId: response.id,
      })
      const byCheckpoint = store.resolveMessageAttention(project.id, review.id, {
        agent: 'alfa',
        checkpointId: checkpoint.id,
      })

      assert.equal(byResponse.responseMessageId, response.id)
      assert.equal(byCheckpoint.checkpointId, checkpoint.id)
      assert.equal(store.getInbox(project.id, 'alfa', { unreadOnly: true }).length, 2)
      const attention = store.getResumeBrief(project.id, 'alfa').attention
      assert.equal(attention.some((item) => item.sourceId === question.id), false)
      assert.equal(attention.some((item) => item.sourceId === review.id), false)
      assert.ok(store.getResumeBrief(project.id, 'beta').attention.some((item) => item.sourceId === question.id))
    })

    it('é idempotente com payload igual e rejeita payload divergente', () => {
      const clock = makeClockForResolution(T0)
      const { store } = makeStore(() => clock.now())
      const project = store.createProject({ name: 'Idempotência', objective: 'Resolver uma vez' })
      const review = store.postMessage(project.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'review',
        body: 'Confirme a revisão.',
      })
      const input = { agent: 'alfa', note: 'Revisão confirmada.' }
      const first = store.resolveMessageAttention(project.id, review.id, input)
      clock.advance(5000)
      const retry = store.resolveMessageAttention(project.id, review.id, input)

      assert.deepEqual(retry, first)
      expectDomain(
        () => store.resolveMessageAttention(project.id, review.id, { agent: 'alfa', note: 'Outro resultado.' }),
        409,
        'resolution_conflict',
      )
    })

    it('rejeita destinatário, kind e resolução sem conteúdo útil', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Validação', objective: 'Resolução restrita' })
      const question = store.postMessage(project.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'question',
        body: 'Pergunta direta.',
      })
      const note = store.postMessage(project.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'note',
        body: 'Nota não resolvível.',
      })
      const handoff = store.postMessage(project.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'handoff',
        body: 'Handoff legado não resolvível.',
      })

      expectDomain(
        () => store.resolveMessageAttention(project.id, question.id, { agent: 'beta', note: 'Tentativa.' }),
        409,
        'recipient_mismatch',
      )
      expectDomain(
        () => store.resolveMessageAttention(project.id, note.id, { agent: 'alfa', note: 'Tentativa.' }),
        409,
        'attention_not_resolvable',
      )
      expectDomain(
        () => store.resolveMessageAttention(project.id, handoff.id, { agent: 'alfa', note: 'Tentativa.' }),
        409,
        'attention_not_resolvable',
      )
      expectDomain(
        () => store.resolveMessageAttention(project.id, question.id, { agent: 'alfa', note: '   ' }),
        400,
        'invalid_input',
      )
    })

    it('isola referências por projeto e exige autoria declarada do resolvedor', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Projeto alvo', objective: 'Isolar referências' })
      const foreignProject = store.createProject({ name: 'Projeto externo', objective: 'Não vazar' })
      const question = store.postMessage(project.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'question',
        body: 'Mostre a evidência.',
      })
      const foreignResponse = store.postMessage(foreignProject.id, {
        from: 'alfa',
        to: 'coord',
        kind: 'note',
        body: 'Resposta em outro projeto.',
      })
      const responseByOther = store.postMessage(project.id, {
        from: 'beta',
        to: 'coord',
        kind: 'note',
        body: 'Resposta do beta.',
      })
      const checkpointByOther = store.saveCheckpoint(project.id, {
        expectedRevision: 0,
        idempotencyKey: 'resolution-other-author',
        agent: 'beta',
        summary: 'Checkpoint do beta',
        nextStep: 'Continuar como beta',
      })

      expectDomain(
        () => store.resolveMessageAttention(project.id, question.id, { agent: 'alfa', responseMessageId: foreignResponse.id }),
        404,
        'not_found',
      )
      expectDomain(
        () => store.resolveMessageAttention(project.id, question.id, { agent: 'alfa', responseMessageId: responseByOther.id }),
        409,
        'resolution_reference_author_mismatch',
      )
      expectDomain(
        () => store.resolveMessageAttention(project.id, question.id, { agent: 'alfa', checkpointId: checkpointByOther.id }),
        409,
        'resolution_reference_author_mismatch',
      )
      expectDomain(
        () => store.resolveMessageAttention(project.id, randomUUID(), { agent: 'alfa', note: 'Ausente.' }),
        404,
        'not_found',
      )
    })

    it('exporta e importa resolução com todas as referências remapeadas', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Resolução portátil', objective: 'Preservar continuidade' })
      const question = store.postMessage(project.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'question',
        body: 'Qual foi o resultado?',
      })
      const response = store.postMessage(project.id, {
        from: 'alfa',
        to: 'coord',
        kind: 'note',
        body: 'Resultado registrado.',
      })
      const checkpoint = store.saveCheckpoint(project.id, {
        expectedRevision: 0,
        idempotencyKey: 'portable-resolution',
        agent: 'alfa',
        summary: 'Resultado final',
        nextStep: 'Importar em outro workspace',
      })
      store.resolveMessageAttention(project.id, question.id, {
        agent: 'alfa',
        note: 'Resolvido com referências.',
        responseMessageId: response.id,
        checkpointId: checkpoint.id,
      })

      const data = store.exportProjectBundleData(project.id)
      assert.equal(data.messageResolutions?.length, 1)
      const imported = store.importProjectBundleData({
        format: 'axon-project',
        version: 2,
        exportedAt: T0.toISOString(),
        ...data,
      })
      const importedQuestionId = imported.idMap[question.id]!
      const restored = store
        .getInbox(imported.project.id, 'alfa')
        .find((item) => item.message.id === importedQuestionId)?.resolution

      assert.ok(restored)
      assert.equal(restored.projectId, imported.project.id)
      assert.equal(restored.messageId, importedQuestionId)
      assert.equal(restored.responseMessageId, imported.idMap[response.id])
      assert.equal(restored.checkpointId, imported.idMap[checkpoint.id])
      assert.equal(restored.agent, 'alfa')
      assert.equal(restored.note, 'Resolvido com referências.')
      assert.equal(restored.resolvedAt, T0.toISOString())
      const restoredCharter = store.getCharter(imported.project.id)
      assert.equal(restoredCharter?.revision, 1)
      assert.equal(restoredCharter?.body, project.objective)
      assert.equal(restoredCharter?.sourceKind, 'human_directive')
    })
  })

  describe('exportProject e importProject (portabilidade e snapshot consistente)', () => {
    it('exporta snapshot consistente sem ler disco e importa em novo projeto com novos UUIDs e taskId remapeado', () => {
      const { store } = makeStore(() => T0)
      const p = store.createProject({
        name: 'Projeto Exportável',
        objective: 'Garantir portabilidade e integridade referencial',
        workspacePath: 'D:\\projetos\\axon\\dummy',
      })
      const t1 = store.createTask(p.id, { title: 'Tarefa 1' })
      const t2 = store.createTask(p.id, { title: 'Tarefa 2' })

      // Leases ativos no projeto de origem
      store.claimTask(p.id, t1.id, { agent: 'agente-origem', expectedVersion: 0, leaseSeconds: 1200 })

      store.saveCheckpoint(p.id, {
        expectedRevision: 0,
        idempotencyKey: 'cp-exp-1',
        taskId: t1.id,
        agent: 'agente-origem',
        summary: 'Primeiro marco da tarefa 1',
        nextStep: 'Passar para tarefa 2',
        decisions: ['Decisão A'],
        blockers: ['Nenhum'],
        evidence: [{ command: 'npm test', outcome: 'passed', details: 'relato local' }],
      })

      store.postMessage(p.id, {
        from: 'agente-origem',
        to: 'revisor',
        kind: 'handoff',
        body: 'Finalizei a etapa 1',
      })

      // Exportar snapshot
      const snapshot = store.exportProject(p.id)
      assert.equal(snapshot.project.id, p.id)
      assert.equal(snapshot.tasks.length, 2)
      assert.equal(snapshot.checkpoints.length, 1)
      assert.equal(snapshot.messages.length, 1)

      // Importar snapshot
      const imported = store.importProject(snapshot)
      assert.match(imported.project.id, UUID_RE)
      assert.notEqual(imported.project.id, p.id, 'Novo projeto deve receber UUID distinto')
      assert.equal(imported.sourceProjectId, p.id)
      assert.equal(imported.project.name, 'Projeto Exportável')
      assert.equal(imported.project.revision, 1)

      // Verificar idMap
      assert.equal(imported.idMap[p.id], imported.project.id)
      assert.ok(imported.idMap[t1.id])
      assert.ok(imported.idMap[t2.id])
      assert.ok(imported.idMap[snapshot.checkpoints[0]!.id])
      assert.ok(imported.idMap[snapshot.messages[0]!.id])

      // Obter detalhes do projeto importado
      const detail = store.getProject(imported.project.id)
      assert.equal(detail.tasks.length, 2)

      // Regra CRÍTICA: LEASES ATIVOS NUNCA SÃO COPIADOS
      for (const task of detail.tasks) {
        assert.equal(task.status, 'todo', 'Tarefas importadas devem ter status todo')
        assert.equal(task.assignee, null, 'Assignee deve ser null')
        assert.equal(task.leaseUntil, null, 'LeaseUntil deve ser null')
        assert.equal(task.version, 0, 'Versão deve ser normalizada para 0')
        assert.equal(task.projectId, imported.project.id)
      }

      // Regra: Remapeamento de taskId em checkpoints
      assert.equal(detail.checkpoints.length, 1)
      const importedCp = detail.checkpoints[0]!
      assert.equal(importedCp.projectId, imported.project.id)
      assert.equal(importedCp.taskId, imported.idMap[t1.id], 'taskId deve apontar para o novo UUID da tarefa')
      assert.notEqual(importedCp.taskId, t1.id)
      assert.equal(importedCp.agent, 'agente-origem')
      assert.equal(importedCp.summary, 'Primeiro marco da tarefa 1')
      assert.equal(importedCp.evidence[0]?.provenance, 'agent_report')

      // Mensagens preservadas com novo UUID e novo projectId
      assert.equal(detail.messages.length, 1)
      assert.equal(detail.messages[0]?.id, imported.idMap[snapshot.messages[0]!.id])
      assert.equal(detail.messages[0]?.projectId, imported.project.id)
      assert.equal(detail.messages[0]?.body, 'Finalizei a etapa 1')

      // Projeto original permanece intacto e independente
      const originalDetail = store.getProject(p.id)
      assert.equal(originalDetail.tasks.find(task => task.id === t1.id)?.assignee, 'agente-origem')
      assert.equal(originalDetail.tasks.find(task => task.id === t1.id)?.status, 'in_progress')
    })

    it('força proveniência agent_report mesmo se snapshot tentar injetar outra proveniência', () => {
      const { store } = makeStore()
      const p = store.createProject({ name: 'P', objective: 'O' })
      store.saveCheckpoint(p.id, {
        expectedRevision: 0,
        idempotencyKey: 'cp-fake',
        agent: 'alfa',
        summary: 'S',
        nextStep: 'N',
        evidence: [{ command: 'run', outcome: 'passed', details: 'd' }],
      })
      const snapshot = store.exportProject(p.id)

      // Tentativa de falsificar provenance no snapshot para 'verified'
      const forgedSnapshot = JSON.parse(JSON.stringify(snapshot)) as ProjectDetail
      ;(forgedSnapshot.checkpoints[0]!.evidence[0] as unknown as { provenance: string }).provenance =
        'verified_system_execution'

      const imported = store.importProject(forgedSnapshot)
      const importedDetail = store.getProject(imported.project.id)
      assert.equal(importedDetail.checkpoints[0]?.evidence[0]?.provenance, 'agent_report')
    })

    it('validação estrita: rejeita integridade referencial violada (taskId inexistente nas tarefas)', () => {
      const { store } = makeStore()
      const p = store.createProject({ name: 'P', objective: 'O' })
      const snapshot = store.exportProject(p.id)

      // Checkpoint referenciando taskId fantasma
      snapshot.checkpoints.push({
        id: randomUUID(),
        projectId: p.id,
        taskId: randomUUID(), // não está em snapshot.tasks!
        agent: 'alfa',
        summary: 'Inválido',
        nextStep: 'Erro',
        blockers: [],
        decisions: [],
        evidence: [],
        revision: 1,
        createdAt: new Date().toISOString(),
      })
      snapshot.project.revision = 1

      expectDomain(() => store.importProject(snapshot), 400, 'invalid_input')
    })

    it('validação estrita: rejeita projectId inconsistente entre entidades', () => {
      const { store } = makeStore()
      const p = store.createProject({ name: 'P', objective: 'O' })
      const snapshot = store.exportProject(p.id)

      // Adiciona tarefa com projectId divergente
      snapshot.tasks.push({
        id: randomUUID(),
        projectId: randomUUID(), // outro projectId
        title: 'Tarefa alienígena',
        status: 'todo',
        assignee: null,
        leaseUntil: null,
        version: 0,
        blockedReason: null,
        completionCheckpointId: null,
        workIntent: null,
        createdAt: new Date().toISOString(),
      })

      expectDomain(() => store.importProject(snapshot), 400, 'invalid_input')
    })

    it('validação estrita: rejeita revisões inconsistentes ou com lacunas nos checkpoints', () => {
      const { store } = makeStore()
      const p = store.createProject({ name: 'P', objective: 'O' })
      const snapshot = store.exportProject(p.id)

      // Adiciona dois checkpoints com revisão 1 e 3 (lacuna: falta 2)
      snapshot.checkpoints.push({
        id: randomUUID(),
        projectId: p.id,
        taskId: null,
        agent: 'alfa',
        summary: 'Rev 1',
        nextStep: 'Passo 1',
        blockers: [],
        decisions: [],
        evidence: [],
        revision: 1,
        createdAt: new Date().toISOString(),
      })
      snapshot.checkpoints.push({
        id: randomUUID(),
        projectId: p.id,
        taskId: null,
        agent: 'alfa',
        summary: 'Rev 3 (pula 2)',
        nextStep: 'Passo 3',
        blockers: [],
        decisions: [],
        evidence: [],
        revision: 3,
        createdAt: new Date().toISOString(),
      })
      snapshot.project.revision = 3

      expectDomain(() => store.importProject(snapshot), 400, 'invalid_input')
    })

    it('validação estrita: rejeita IDs duplicados dentro do snapshot', () => {
      const { store } = makeStore()
      const p = store.createProject({ name: 'P', objective: 'O' })
      const snapshot = store.exportProject(p.id)
      const duplicateId = randomUUID()

      snapshot.tasks.push({
        id: duplicateId,
        projectId: p.id,
        title: 'T1',
        status: 'todo',
        assignee: null,
        leaseUntil: null,
        version: 0,
        blockedReason: null,
        completionCheckpointId: null,
        workIntent: null,
        createdAt: new Date().toISOString(),
      })
      snapshot.tasks.push({
        id: duplicateId,
        projectId: p.id,
        title: 'T2',
        status: 'todo',
        assignee: null,
        leaseUntil: null,
        version: 0,
        blockedReason: null,
        completionCheckpointId: null,
        workIntent: null,
        createdAt: new Date().toISOString(),
      })

      expectDomain(() => store.importProject(snapshot), 400, 'invalid_input')
    })

    it('validação estrita: rejeita datas inválidas e limites cumulativos excedidos', () => {
      const { store } = makeStore()
      const p = store.createProject({ name: 'P', objective: 'O' })
      const snapshot = store.exportProject(p.id)

      // Data inválida
      snapshot.project.createdAt = 'data-invalida'
      expectDomain(() => store.importProject(snapshot), 400, 'invalid_input')

      // Restaura data
      snapshot.project.createdAt = new Date().toISOString()

      // Excesso de tarefas (> 500)
      for (let i = 0; i < 501; i += 1) {
        snapshot.tasks.push({
          id: randomUUID(),
          projectId: p.id,
          title: `T-${i}`,
          status: 'todo',
          assignee: null,
          leaseUntil: null,
          version: 0,
          blockedReason: null,
          completionCheckpointId: null,
        workIntent: null,
          createdAt: new Date().toISOString(),
        })
      }
      expectDomain(() => store.importProject(snapshot), 400, 'invalid_input')
    })
  })

  describe('getResumeBrief (caixa inteligente de retomada)', () => {
    function makeClock(start: Date) {
      let current = start
      return {
        now: () => current,
        set(next: Date) {
          current = next
        },
        advance(ms: number) {
          current = new Date(current.getTime() + ms)
        },
      }
    }

    it('não escolhe silenciosamente entre múltiplos leases do agente e mantém as candidatas visíveis', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const p = store.createProject({ name: 'Retomada', objective: 'Continuar o núcleo transacional' })

      const heldByOther = store.createTask(p.id, { title: 'Tarefa de outro agente' })
      clock.advance(1)
      const ownActive = store.createTask(p.id, { title: 'Foco do alfa' })
      clock.advance(1)
      const laterOwnActive = store.createTask(p.id, { title: 'Segundo lease do alfa' })
      clock.advance(1)
      const unclaimed = store.createTask(p.id, { title: 'Tarefa livre' })
      clock.advance(1)
      const expiredOwn = store.createTask(p.id, { title: 'Lease expirado do alfa' })

      store.claimTask(p.id, heldByOther.id, { agent: 'beta', expectedVersion: 0, leaseSeconds: 900 })
      store.claimTask(p.id, ownActive.id, { agent: 'alfa', expectedVersion: 0, leaseSeconds: 900 })
      store.claimTask(p.id, laterOwnActive.id, { agent: 'alfa', expectedVersion: 0, leaseSeconds: 900 })
      store.claimTask(p.id, expiredOwn.id, { agent: 'alfa', expectedVersion: 0, leaseSeconds: 30 })

      clock.advance(31_000)

      const brief = store.getResumeBrief(p.id, 'alfa')
      assert.equal(brief.project.id, p.id)
      assert.equal(brief.generatedAt, clock.now().toISOString())
      assert.equal(brief.revision, p.revision)
      assert.equal(brief.focusTask, null)
      assert.deepEqual(
        brief.claimedTasks.map((task) => task.id),
        [ownActive.id, laterOwnActive.id],
      )
      assert.deepEqual(
        brief.availableTasks.map((task) => task.id),
        [unclaimed.id, expiredOwn.id],
      )
      assert.equal(brief.latestCheckpoint, null)
      assert.equal(brief.latestTaskCheckpoint, null)
      assert.equal(brief.latestProjectCheckpoint, null)
      assert.match(brief.markdown, /2 tarefas reservadas por este agente/i)
      assert.match(brief.markdown, /escolha uma tarefa/i)
      assert.doesNotMatch(brief.markdown, /nenhum lease ativo/i)
    })

    it('usa taskId explícito e separa o checkpoint da tarefa do checkpoint mais recente do projeto', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const p = store.createProject({ name: 'Contexto por tarefa', objective: 'Não misturar próximos passos' })
      const taskA = store.createTask(p.id, { title: 'Implementar parser' })
      const taskB = store.createTask(p.id, { title: 'Revisar interface' })

      store.claimTask(p.id, taskA.id, { agent: 'alfa', expectedVersion: 0 })
      store.claimTask(p.id, taskB.id, { agent: 'alfa', expectedVersion: 0 })
      const checkpointA = store.saveCheckpoint(p.id, {
        expectedRevision: 0,
        idempotencyKey: 'resume-task-a',
        taskId: taskA.id,
        agent: 'alfa',
        summary: 'Parser implementado parcialmente',
        nextStep: 'Completar casos inválidos do parser',
        blockers: ['Falta fixture do parser'],
      })
      const checkpointB = store.saveCheckpoint(p.id, {
        expectedRevision: 1,
        idempotencyKey: 'resume-task-b',
        taskId: taskB.id,
        agent: 'alfa',
        summary: 'Interface revisada depois do parser',
        nextStep: 'Ajustar contraste da interface',
        blockers: ['Aguardando decisão visual'],
      })

      const brief = store.getResumeBrief(p.id, 'alfa', taskA.id)

      assert.equal(brief.focusTask?.id, taskA.id)
      assert.deepEqual(
        brief.claimedTasks.map((task) => task.id).sort(),
        [taskA.id, taskB.id].sort(),
      )
      assert.equal(brief.latestTaskCheckpoint?.id, checkpointA.id)
      assert.equal(brief.latestProjectCheckpoint?.id, checkpointB.id)
      assert.equal(brief.latestCheckpoint?.id, checkpointA.id)
      assert.ok(brief.attention.some((item) => item.text === 'Falta fixture do parser'))
      assert.equal(brief.attention.some((item) => item.text === 'Aguardando decisão visual'), false)
      assert.match(brief.markdown, /Completar casos inválidos do parser/)
      assert.match(brief.markdown, /Ajustar contraste da interface/)
    })

    it('permite focar uma tarefa reservada por outro agente sem atribuir identidade ao leitor', () => {
      const { store } = makeStore(() => T0)
      const p = store.createProject({ name: 'Revisão cruzada', objective: 'Consultar trabalho em andamento' })
      const task = store.createTask(p.id, { title: 'Implementação do beta' })
      store.claimTask(p.id, task.id, { agent: 'beta', expectedVersion: 0 })
      const checkpoint = store.saveCheckpoint(p.id, {
        expectedRevision: 0,
        idempotencyKey: 'resume-other-agent',
        taskId: task.id,
        agent: 'beta',
        summary: 'Beta registrou o estado',
        nextStep: 'Alfa deve revisar sem assumir autoria',
      })

      const brief = store.getResumeBrief(p.id, 'alfa', task.id)

      assert.equal(brief.focusTask?.id, task.id)
      assert.equal(brief.focusTask?.assignee, 'beta')
      assert.equal(brief.claimedTasks.length, 0)
      assert.equal(brief.latestTaskCheckpoint?.id, checkpoint.id)
      assert.equal(brief.latestTaskCheckpoint?.agent, 'beta')
    })

    it('taskId explícito foca tarefa livre mesmo quando o ator possui outro lease', () => {
      const { store } = makeStore(() => T0)
      const p = store.createProject({ name: 'Escolha explícita', objective: 'Respeitar o foco solicitado' })
      const claimed = store.createTask(p.id, { title: 'Tarefa já reservada' })
      const free = store.createTask(p.id, { title: 'Tarefa livre escolhida' })
      store.claimTask(p.id, claimed.id, { agent: 'alfa', expectedVersion: 0 })

      const automatic = store.getResumeBrief(p.id, 'alfa')
      const explicit = store.getResumeBrief(p.id, 'alfa', free.id)

      assert.equal(automatic.focusTask?.id, claimed.id)
      assert.equal(explicit.focusTask?.id, free.id)
      assert.deepEqual(explicit.claimedTasks.map((task) => task.id), [claimed.id])
      assert.ok(explicit.availableTasks.some((task) => task.id === free.id))
    })

    it('não usa checkpoint geral como checkpoint efetivo quando a tarefa focada ainda não tem marco', () => {
      const { store } = makeStore(() => T0)
      const p = store.createProject({ name: 'Foco sem marco', objective: 'Manter a ausência explícita' })
      const task = store.createTask(p.id, { title: 'Tarefa sem checkpoint' })
      const general = store.saveCheckpoint(p.id, {
        expectedRevision: 0,
        idempotencyKey: 'resume-general-only',
        agent: 'coord',
        summary: 'Checkpoint geral existente',
        nextStep: 'Próximo passo geral não deve virar passo da tarefa',
        blockers: ['Bloqueio apenas geral'],
      })

      const brief = store.getResumeBrief(p.id, 'alfa', task.id)

      assert.equal(brief.focusTask?.id, task.id)
      assert.equal(brief.latestTaskCheckpoint, null)
      assert.equal(brief.latestProjectCheckpoint?.id, general.id)
      assert.equal(brief.latestCheckpoint, null)
      assert.equal(brief.attention.some((item) => item.text === 'Bloqueio apenas geral'), false)
      assert.match(brief.markdown, /Nenhum checkpoint registrado para esta tarefa/)
      assert.match(brief.markdown, /Próximo passo geral não deve virar passo da tarefa/)
    })

    it('focusMode project força visão geral e rejeita combinação ambígua ou modo inválido', () => {
      const { store } = makeStore(() => T0)
      const p = store.createProject({ name: 'Visão geral explícita', objective: 'Escolher o nível de contexto' })
      const task = store.createTask(p.id, { title: 'Tarefa reservada' })
      store.claimTask(p.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      store.saveCheckpoint(p.id, {
        expectedRevision: 0,
        idempotencyKey: 'resume-focused-before-project',
        taskId: task.id,
        agent: 'alfa',
        summary: 'Marco da tarefa',
        nextStep: 'Próximo passo da tarefa',
      })
      const general = store.saveCheckpoint(p.id, {
        expectedRevision: 1,
        idempotencyKey: 'resume-project-mode',
        agent: 'coord',
        summary: 'Marco geral posterior',
        nextStep: 'Próximo passo do projeto',
      })
      const brief = store.getResumeBrief(p.id, 'alfa', undefined, 'project')

      assert.equal(brief.focusTask, null)
      assert.deepEqual(brief.claimedTasks.map((item) => item.id), [task.id])
      assert.equal(brief.latestTaskCheckpoint, null)
      assert.equal(brief.latestProjectCheckpoint?.id, general.id)
      assert.equal(brief.latestCheckpoint?.id, general.id)
      assert.match(brief.markdown, /Próximo passo do projeto/)

      expectDomain(() => store.getResumeBrief(p.id, 'alfa', task.id, 'project'), 400, 'invalid_input')
      expectDomain(
        () => store.getResumeBrief(p.id, 'alfa', undefined, 'task' as never),
        400,
        'invalid_input',
      )
    })

    it('com lease expirado a tarefa volta a ficar disponível e o foco some', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const p = store.createProject({ name: 'Expiração', objective: 'Liberar após prazo' })
      const task = store.createTask(p.id, { title: 'Única tarefa' })
      store.claimTask(p.id, task.id, { agent: 'alfa', expectedVersion: 0, leaseSeconds: 30 })

      const whileHeld = store.getResumeBrief(p.id, 'alfa')
      assert.equal(whileHeld.focusTask?.id, task.id)
      assert.deepEqual(whileHeld.claimedTasks.map((item) => item.id), [task.id])
      assert.equal(whileHeld.availableTasks.length, 0)

      clock.advance(30_000)
      const afterExpiry = store.getResumeBrief(p.id, 'alfa')
      assert.equal(afterExpiry.focusTask, null)
      assert.equal(afterExpiry.claimedTasks.length, 0)
      assert.equal(afterExpiry.availableTasks.length, 1)
      assert.equal(afterExpiry.availableTasks[0]?.id, task.id)
    })

    it('inbox do brief: diretas e broadcast, não lidas primeiro, cronologia estável no grupo', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const p = store.createProject({ name: 'Caixa', objective: 'Ordenar mensagens' })

      const readOlder = store.postMessage(p.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'note',
        body: 'Nota antiga já lida',
      })
      clock.advance(1000)
      const unreadOlder = store.postMessage(p.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'question',
        body: 'Pergunta não lida',
      })
      clock.advance(1000)
      const foreign = store.postMessage(p.id, {
        from: 'coord',
        to: 'beta',
        kind: 'review',
        body: 'Privada do beta',
      })
      clock.advance(1000)
      const broadcastUnread = store.postMessage(p.id, {
        from: 'coord',
        to: '*',
        kind: 'handoff',
        body: 'Passagem geral',
      })
      clock.advance(1000)
      const unreadNewer = store.postMessage(p.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'note',
        body: 'Nota nova não lida',
      })

      const receipt = store.acknowledgeMessage(p.id, readOlder.id, { agent: 'alfa' })

      const inboxCanonical = store.getInbox(p.id, 'alfa')
      assert.equal(inboxCanonical.length, 4)
      assert.equal(inboxCanonical[0]?.message.id, readOlder.id)

      const brief = store.getResumeBrief(p.id, 'alfa')
      assert.deepEqual(
        brief.inbox.map((item) => item.message.id),
        [unreadOlder.id, broadcastUnread.id, unreadNewer.id, readOlder.id],
      )
      assert.equal(brief.inbox[0]?.acknowledgedAt, null)
      assert.equal(brief.inbox[3]?.acknowledgedAt, receipt.acknowledgedAt)
      assert.equal(
        brief.inbox.some((item) => item.message.id === foreign.id),
        false,
      )
    })

    it('atenção deriva bloqueios do checkpoint mais recente e mensagens não lidas question/review/handoff', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const p = store.createProject({ name: 'Atenção', objective: 'Listar o que pede cuidado' })
      const task = store.createTask(p.id, { title: 'Implementar brief' })
      store.claimTask(p.id, task.id, { agent: 'alfa', expectedVersion: 0 })

      store.saveCheckpoint(p.id, {
        expectedRevision: 0,
        idempotencyKey: 'cp-old',
        taskId: task.id,
        agent: 'alfa',
        summary: 'Primeiro marco',
        nextStep: 'Não usar este passo',
        blockers: ['Bloqueio antigo ignorado'],
      })
      const latest = store.saveCheckpoint(p.id, {
        expectedRevision: 1,
        idempotencyKey: 'cp-new',
        taskId: task.id,
        agent: 'alfa',
        summary: 'Segundo marco',
        nextStep: 'Escrever testes do brief',
        blockers: ['Falta revisão independente', 'Quota do provedor alheio ao AXON'],
      })

      clock.advance(1000)
      const question = store.postMessage(p.id, {
        from: 'revisor',
        to: 'alfa',
        kind: 'question',
        body: 'O lease cobre o próximo passo?',
      })
      clock.advance(1000)
      store.postMessage(p.id, {
        from: 'revisor',
        to: 'alfa',
        kind: 'note',
        body: 'Nota não entra em atenção',
      })
      clock.advance(1000)
      const review = store.postMessage(p.id, {
        from: 'revisor',
        to: '*',
        kind: 'review',
        body: 'Revisar o markdown compacto',
      })
      clock.advance(1000)
      const handoffRead = store.postMessage(p.id, {
        from: 'revisor',
        to: 'alfa',
        kind: 'handoff',
        body: 'Passagem já reconhecida',
      })
      store.acknowledgeMessage(p.id, handoffRead.id, { agent: 'alfa' })

      const brief = store.getResumeBrief(p.id, 'alfa')
      assert.equal(brief.revision, 2)
      assert.equal(brief.latestCheckpoint?.id, latest.id)
      assert.deepEqual(
        brief.attention.map((item) => ({ kind: item.kind, text: item.text, sourceId: item.sourceId })),
        [
          {
            kind: 'blocker',
            text: 'Falta revisão independente',
            sourceId: latest.id,
          },
          {
            kind: 'blocker',
            text: 'Quota do provedor alheio ao AXON',
            sourceId: latest.id,
          },
          {
            kind: 'question',
            text: 'O lease cobre o próximo passo?',
            sourceId: question.id,
          },
          {
            kind: 'review',
            text: 'Revisar o markdown compacto',
            sourceId: review.id,
          },
        ],
      )
    })

    it('isola projetos e valida agent pelas mesmas regras existentes', () => {
      const { store } = makeStore(() => T0)
      const p1 = store.createProject({ name: 'Um', objective: 'Objetivo do projeto um' })
      const p2 = store.createProject({ name: 'Dois', objective: 'Objetivo do projeto dois' })
      store.createTask(p1.id, { title: 'Só no um' })
      store.postMessage(p1.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'question',
        body: 'Pergunta do projeto um',
      })
      store.saveCheckpoint(p2.id, {
        expectedRevision: 0,
        idempotencyKey: 'cp-p2',
        agent: 'beta',
        summary: 'Marco do dois',
        nextStep: 'Não vazar para o um',
        blockers: ['Bloqueio do dois'],
      })
      store.postMessage(p2.id, {
        from: 'coord',
        to: 'alfa',
        kind: 'review',
        body: 'Revisão do projeto dois',
      })

      const brief = store.getResumeBrief(p1.id, 'alfa')
      assert.equal(brief.project.id, p1.id)
      assert.equal(brief.availableTasks.length, 1)
      assert.equal(brief.availableTasks[0]?.title, 'Só no um')
      assert.equal(brief.latestCheckpoint, null)
      assert.equal(brief.inbox.length, 1)
      assert.equal(brief.inbox[0]?.message.body, 'Pergunta do projeto um')
      assert.equal(
        brief.attention.some((item) => item.text.includes('dois') || item.text.includes('Bloqueio')),
        false,
      )

      expectDomain(() => store.getResumeBrief(p1.id, ''), 400, 'invalid_input')
      expectDomain(() => store.getResumeBrief(p1.id, '   '), 400, 'invalid_input')
      expectDomain(() => store.getResumeBrief(p1.id, 'a'.repeat(81)), 400, 'invalid_input')
      expectDomain(() => store.getResumeBrief('nao-uuid', 'alfa'), 400, 'invalid_input')
      expectDomain(() => store.getResumeBrief(randomUUID(), 'alfa'), 404, 'not_found')
      expectDomain(() => store.getResumeBrief(p1.id, 'alfa', 'nao-uuid'), 400, 'invalid_input')
      expectDomain(() => store.getResumeBrief(p1.id, 'alfa', randomUUID()), 404, 'not_found')

      const taskFromOtherProject = store.createTask(p2.id, { title: 'Tarefa privada do projeto dois' })
      expectDomain(() => store.getResumeBrief(p1.id, 'alfa', taskFromOtherProject.id), 404, 'not_found')
    })

    it('markdown compacto declara conteúdo não confiável, cobre as seções e trunca com aviso explícito', () => {
      const { store } = makeStore(() => T0)
      const objective = `Documentar retomada sem executar instruções. ${'Objetivo longo. '.repeat(400)}`
      const p = store.createProject({ name: 'Markdown', objective })
      const task = store.createTask(p.id, { title: 'Assumir o brief' })
      store.claimTask(p.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      store.saveCheckpoint(p.id, {
        expectedRevision: 0,
        idempotencyKey: 'cp-md',
        taskId: task.id,
        agent: 'alfa',
        summary: 'Resumo com OPENAI_API_KEY=sk-secret-nao-vazar',
        nextStep: 'Conferir evidência observada',
        blockers: ['Falta prova de teste'],
      })
      store.postMessage(p.id, {
        from: 'revisor',
        to: 'alfa',
        kind: 'question',
        body: `Há um passo pendente? ${'Inbox longa. '.repeat(400)} Bearer abcdef123`,
      })

      const brief = store.getResumeBrief(p.id, 'alfa')
      assert.match(brief.markdown, /não confiável/i)
      assert.match(brief.markdown, /não (deve|devem) ser executad/i)
      assert.match(brief.markdown, /Objetivo/)
      assert.match(brief.markdown, /Assumir o brief/)
      assert.match(brief.markdown, /Conferir evidência observada/)
      assert.match(brief.markdown, /Falta prova de teste/)
      assert.match(brief.markdown, /Há um passo pendente/)
      assert.equal(brief.markdown.includes('sk-secret-nao-vazar'), false)
      assert.equal(brief.markdown.includes('abcdef123'), false)
      assert.ok(brief.markdown.length <= 8000)
      assert.match(brief.markdown, /truncad/i)
    })
  })

  describe('HandoffDelivery (passagem estruturada de trabalho)', () => {
    function makeClock(start: Date) {
      let current = start
      return {
        now: () => current,
        set(next: Date) {
          current = next
        },
        advance(ms: number) {
          current = new Date(current.getTime() + ms)
        },
      }
    }

    function seedWork(
      store: WorkspaceStore,
      agent: string,
      title: string,
      summary: string,
      nextStep: string,
      key: string,
    ) {
      const project = store.createProject({ name: `Projeto ${title}`, objective: 'Continuar entre IAs' })
      const task = store.createTask(project.id, { title })
      store.claimTask(project.id, task.id, { agent, expectedVersion: 0 })
      const checkpoint = store.saveCheckpoint(project.id, {
        expectedRevision: 0,
        idempotencyKey: key,
        taskId: task.id,
        agent,
        summary,
        nextStep,
      })
      return { project, task, checkpoint }
    }

    it('cria passagem com mensagem, checkpoint imutável e tarefa derivada', () => {
      const { store } = makeStore(() => T0)
      const { project, task, checkpoint } = seedWork(
        store,
        'alfa',
        'Revisar contrato',
        'Contrato do store fechado.',
        'Implementar a listagem por agente.',
        'cp-del-1',
      )

      const delivery = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: 'beta',
        message: 'Assuma a listagem e confirme a leitura.',
      })

      assert.match(delivery.id, UUID_RE)
      assert.equal(delivery.projectId, project.id)
      assert.equal(delivery.checkpointId, checkpoint.id)
      assert.equal(delivery.taskId, task.id)
      assert.equal(delivery.from, 'alfa')
      assert.equal(delivery.to, 'beta')
      assert.equal(delivery.message, 'Assuma a listagem e confirme a leitura.')
      assert.equal(delivery.createdAt, T0.toISOString())
      assert.equal(delivery.acknowledgedAt, null)
      assert.equal(delivery.checkpoint.id, checkpoint.id)
      assert.equal(delivery.checkpoint.summary, 'Contrato do store fechado.')
      assert.equal(delivery.checkpoint.nextStep, 'Implementar a listagem por agente.')
      assert.equal(delivery.task?.id, task.id)
      assert.equal(delivery.task?.title, 'Revisar contrato')
    })

    it('aceita mensagem vazia e deriva taskId do checkpoint mesmo se o cliente omitir', () => {
      const { store } = makeStore(() => T0)
      const { project, task, checkpoint } = seedWork(
        store,
        'alfa',
        'Tarefa derivada',
        'Resumo suficiente.',
        'Seguir o próximo passo do checkpoint.',
        'cp-empty-msg',
      )

      const delivery = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: '*',
        message: '   ',
      })

      assert.equal(delivery.message, '')
      assert.equal(delivery.to, '*')
      assert.equal(delivery.taskId, task.id)
    })

    it('rejeita autor divergente do checkpoint.agent com 409 handoff_author_mismatch', () => {
      const { store } = makeStore(() => T0)
      const { project, checkpoint } = seedWork(
        store,
        'alfa',
        'Autor divergente',
        'Feito por alfa.',
        'Não deixar beta assinar.',
        'cp-author',
      )

      expectDomain(
        () =>
          store.createHandoffDelivery(project.id, {
            checkpointId: checkpoint.id,
            from: 'beta',
            to: 'gama',
            message: 'Tentativa indevida.',
          }),
        409,
        'handoff_author_mismatch',
      )
    })

    it('rejeita checkpoint de outro projeto e taskId escolhido pelo cliente', () => {
      const { store } = makeStore(() => T0)
      const a = seedWork(store, 'alfa', 'Projeto A', 'Marco A', 'Passo A', 'cp-a')
      const b = seedWork(store, 'alfa', 'Projeto B', 'Marco B', 'Passo B', 'cp-b')
      const otherTask = store.createTask(a.project.id, { title: 'Outra tarefa' })

      expectDomain(
        () =>
          store.createHandoffDelivery(a.project.id, {
            checkpointId: b.checkpoint.id,
            from: 'alfa',
            to: 'beta',
            message: 'Checkpoint alheio.',
          }),
        404,
        'not_found',
      )

      expectDomain(
        () =>
          store.createHandoffDelivery(a.project.id, {
            checkpointId: a.checkpoint.id,
            from: 'alfa',
            to: 'beta',
            message: 'Tarefa forçada.',
            taskId: otherTask.id,
          }),
        400,
        'invalid_input',
      )

      const accepted = store.createHandoffDelivery(a.project.id, {
        checkpointId: a.checkpoint.id,
        from: 'alfa',
        to: 'beta',
        message: 'Tarefa correta.',
        taskId: a.task.id,
      })
      assert.equal(accepted.taskId, a.task.id)
    })

    it('lista diretas e broadcast, não lidas primeiro, com cronologia estável e unreadOnly', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const { project, checkpoint } = seedWork(
        store,
        'alfa',
        'Ordenar passagens',
        'Base pronta.',
        'Entregar com ordem estável.',
        'cp-order',
      )

      const readOlder = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: 'beta',
        message: 'Direta antiga, depois lida.',
      })
      clock.advance(1000)
      const unreadBroadcast = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: '*',
        message: 'Aviso geral.',
      })
      clock.advance(1000)
      store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: 'gama',
        message: 'Privada de gama.',
      })
      clock.advance(1000)
      const unreadNewer = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: 'beta',
        message: 'Direta nova.',
      })

      const receipt = store.acknowledgeHandoffDelivery(project.id, readOlder.id, { agent: 'beta' })

      const listed = store.getHandoffDeliveries(project.id, 'beta')
      assert.deepEqual(
        listed.map((item) => item.id),
        [unreadBroadcast.id, unreadNewer.id, readOlder.id],
      )
      assert.equal(listed[0]?.acknowledgedAt, null)
      assert.equal(listed[2]?.acknowledgedAt, receipt.acknowledgedAt)
      assert.equal(
        listed.some((item) => item.to === 'gama'),
        false,
      )

      const unread = store.getHandoffDeliveries(project.id, 'beta', { unreadOnly: true })
      assert.deepEqual(
        unread.map((item) => item.id),
        [unreadBroadcast.id, unreadNewer.id],
      )
    })

    it('confirma leitura de forma idempotente e só autoriza o destinatário direto', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const { project, checkpoint } = seedWork(
        store,
        'alfa',
        'Autorizar recibo',
        'Pronto para entrega.',
        'Confirmar com o destinatário certo.',
        'cp-ack',
      )

      const direct = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: 'beta',
        message: 'Somente beta confirma.',
      })
      clock.advance(1000)
      const broadcast = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: '*',
        message: 'Qualquer identidade confirma.',
      })

      expectDomain(
        () => store.acknowledgeHandoffDelivery(project.id, direct.id, { agent: 'gama' }),
        409,
        'recipient_mismatch',
      )

      const first = store.acknowledgeHandoffDelivery(project.id, direct.id, { agent: 'beta' })
      clock.advance(5000)
      const retry = store.acknowledgeHandoffDelivery(project.id, direct.id, { agent: 'beta' })
      assert.equal(first.deliveryId, direct.id)
      assert.equal(first.agent, 'beta')
      assert.ok(first.acknowledgedAt)
      assert.equal(retry.acknowledgedAt, first.acknowledgedAt)

      const other = store.acknowledgeHandoffDelivery(project.id, broadcast.id, { agent: 'gama' })
      assert.equal(other.agent, 'gama')
      const stillUnreadForBeta = store.getHandoffDeliveries(project.id, 'beta', { unreadOnly: true })
      assert.equal(stillUnreadForBeta.length, 1)
      assert.equal(stillUnreadForBeta[0]?.id, broadcast.id)
    })

    it('isola projetos, valida limites e persiste após reabrir o banco', () => {
      const { store, dbPath } = makeStore(() => T0)
      const a = seedWork(store, 'alfa', 'Isolado A', 'Marco A', 'Passo A', 'cp-iso-a')
      const b = seedWork(store, 'alfa', 'Isolado B', 'Marco B', 'Passo B', 'cp-iso-b')

      const kept = store.createHandoffDelivery(a.project.id, {
        checkpointId: a.checkpoint.id,
        from: 'alfa',
        to: 'beta',
        message: 'Fica no projeto A.',
      })
      store.createHandoffDelivery(b.project.id, {
        checkpointId: b.checkpoint.id,
        from: 'alfa',
        to: 'beta',
        message: 'Não vazar para A.',
      })

      assert.equal(store.getHandoffDeliveries(a.project.id, 'beta').length, 1)
      assert.equal(store.getHandoffDeliveries(a.project.id, 'beta')[0]?.id, kept.id)

      expectDomain(
        () => store.createHandoffDelivery(a.project.id, { checkpointId: a.checkpoint.id, from: '', to: 'beta' }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.createHandoffDelivery(a.project.id, {
            checkpointId: a.checkpoint.id,
            from: 'alfa',
            to: 'x'.repeat(81),
          }),
        400,
        'invalid_input',
      )
      expectDomain(
        () =>
          store.createHandoffDelivery(a.project.id, {
            checkpointId: a.checkpoint.id,
            from: 'alfa',
            to: 'beta',
            message: 'm'.repeat(8001),
          }),
        400,
        'invalid_input',
      )
      expectDomain(() => store.getHandoffDeliveries(a.project.id, ''), 400, 'invalid_input')
      expectDomain(
        () => store.acknowledgeHandoffDelivery(a.project.id, randomUUID(), { agent: 'beta' }),
        404,
        'not_found',
      )
      expectDomain(
        () => store.acknowledgeHandoffDelivery(b.project.id, kept.id, { agent: 'beta' }),
        404,
        'not_found',
      )

      store.close()
      const reopened = new WorkspaceStore(dbPath)
      cleanups.push(() => reopened.close())
      const restored = reopened.getHandoffDeliveries(a.project.id, 'beta')
      assert.equal(restored.length, 1)
      assert.equal(restored[0]?.id, kept.id)
      assert.equal(restored[0]?.message, 'Fica no projeto A.')
      assert.equal(restored[0]?.checkpoint.id, a.checkpoint.id)
    })

    it('ResumeBrief inclui passagens, atenção handoff e fallback para nextStep sem duplicar legado', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const { project, task, checkpoint } = seedWork(
        store,
        'alfa',
        'Brief com passagem',
        'Resumo com OPENAI_API_KEY=sk-secret-nao-vazar',
        'Ler o próximo passo mascarado.',
        'cp-brief',
      )

      const withMessage = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: 'beta',
        message: 'Oriente pelo contrato. Bearer abcdef123',
      })
      clock.advance(1000)
      const emptyMessage = store.createHandoffDelivery(project.id, {
        checkpointId: checkpoint.id,
        from: 'alfa',
        to: '*',
        message: '',
      })
      clock.advance(1000)
      store.postMessage(project.id, {
        from: 'alfa',
        to: 'beta',
        kind: 'handoff',
        body: 'Mensagem genérica legada de passagem',
      })
      store.acknowledgeHandoffDelivery(project.id, withMessage.id, { agent: 'beta' })

      const brief = store.getResumeBrief(project.id, 'beta')
      assert.equal(brief.deliveries.length, 2)
      assert.equal(brief.deliveries[0]?.id, emptyMessage.id)
      assert.equal(brief.deliveries[0]?.acknowledgedAt, null)
      assert.equal(brief.deliveries[1]?.id, withMessage.id)
      assert.ok(brief.deliveries[1]?.acknowledgedAt)

      const handoffAttention = brief.attention.filter((item) => item.kind === 'handoff')
      assert.ok(handoffAttention.some((item) => item.sourceId === emptyMessage.id))
      assert.ok(handoffAttention.some((item) => item.text === 'Ler o próximo passo mascarado.'))
      assert.equal(
        handoffAttention.some((item) => item.sourceId === withMessage.id),
        false,
      )
      assert.ok(handoffAttention.some((item) => item.text === 'Mensagem genérica legada de passagem'))

      assert.match(brief.markdown, /Passagens de trabalho/)
      assert.match(brief.markdown, /Ler o próximo passo mascarado/)
      assert.equal(brief.markdown.includes('sk-secret-nao-vazar'), false)
      assert.equal(brief.markdown.includes('abcdef123'), false)
      const structuredSection = brief.markdown.split('## Inbox')[0] ?? ''
      assert.equal(structuredSection.includes('Mensagem genérica legada de passagem'), false)
      const deliverySection = structuredSection.split('## Passagens de trabalho')[1] ?? ''
      assert.ok(deliverySection.includes(task.title))
      assert.ok(deliverySection.includes(task.id))
      assert.match(brief.markdown, /Mensagem genérica legada de passagem/)
      assert.ok(brief.markdown.length <= 8000)
      assert.equal(brief.deliveries[0]?.task?.id, task.id)
    })
  })

  describe('BacklogItem (ideias ainda não assumidas)', () => {
    it('cria, lista, atualiza com CAS e persiste versão e timestamps ao reabrir SQLite', () => {
      const { store, dbPath } = makeStore(() => T0)
      const project = store.createProject({ name: 'Backlog durável', objective: 'Guardar ideias antes da tarefa' })
      const created = store.createBacklogItem(project.id, {
        title: '  Explorar busca por decisão  ',
        createdBy: 'Astra',
        description: '  Ainda não está pronta para lease.  ',
      })
      assert.match(created.id, UUID_RE)
      assert.equal(created.projectId, project.id)
      assert.equal(created.title, 'Explorar busca por decisão')
      assert.equal(created.description, 'Ainda não está pronta para lease.')
      assert.equal(created.priority, 'medium')
      assert.equal(created.stage, 'idea')
      assert.equal(created.createdBy, 'Astra')
      assert.equal(created.promotedTaskId, null)
      assert.equal(created.version, 0)
      assert.equal(created.createdAt, T0.toISOString())
      assert.equal(created.updatedAt, T0.toISOString())

      const updated = store.updateBacklogItem(project.id, created.id, {
        expectedVersion: 0,
        title: 'Explorar busca por decisão vigente',
        priority: 'high',
        stage: 'ready',
      })
      assert.equal(updated.version, 1)
      assert.equal(updated.stage, 'ready')
      assert.equal(updated.priority, 'high')
      assert.equal(updated.title, 'Explorar busca por decisão vigente')

      expectDomain(
        () => store.updateBacklogItem(project.id, created.id, { expectedVersion: 0, title: 'Stale' }),
        409,
        'backlog_version_conflict',
      )

      store.close()
      const reopened = new WorkspaceStore(dbPath)
      cleanups.push(() => reopened.close())
      const listed = reopened.listBacklog(project.id, { includeClosed: true })
      assert.equal(listed.length, 1)
      assert.equal(listed[0]?.id, created.id)
      assert.equal(listed[0]?.version, 1)
      assert.equal(listed[0]?.stage, 'ready')
      assert.equal(listed[0]?.priority, 'high')
      assert.equal(listed[0]?.updatedAt, T0.toISOString())
      assert.equal(listed[0]?.createdAt, T0.toISOString())
    })

    it('ordena ativos ready antes de idea, depois prioridade, createdAt e id; fechados depois', () => {
      let now = T0
      const { store } = makeStore(() => now)
      const project = store.createProject({ name: 'Ordem', objective: 'Determinismo da lista' })
      const ideaLow = store.createBacklogItem(project.id, {
        title: 'Idea baixa tarde',
        createdBy: 'Grok',
        priority: 'low',
      })
      now = new Date(T0.getTime() + 1000)
      const ideaUrgent = store.createBacklogItem(project.id, {
        title: 'Idea urgente',
        createdBy: 'Grok',
        priority: 'urgent',
      })
      now = new Date(T0.getTime() + 2000)
      const readyMedium = store.createBacklogItem(project.id, {
        title: 'Ready média',
        createdBy: 'Grok',
        priority: 'medium',
        stage: 'ready',
      })
      now = new Date(T0.getTime() + 3000)
      const readyHigh = store.createBacklogItem(project.id, {
        title: 'Ready alta',
        createdBy: 'Grok',
        priority: 'high',
        stage: 'ready',
      })
      now = new Date(T0.getTime() + 4000)
      const archived = store.createBacklogItem(project.id, {
        title: 'Arquivar depois',
        createdBy: 'Grok',
      })
      store.archiveBacklogItem(project.id, archived.id, { expectedVersion: 0 })
      now = new Date(T0.getTime() + 5000)
      const promoted = store.createBacklogItem(project.id, {
        title: 'Promover depois',
        createdBy: 'Grok',
        stage: 'ready',
      })
      store.promoteBacklogItem(project.id, promoted.id)

      const active = store.listBacklog(project.id)
      assert.deepEqual(
        active.map((item) => item.title),
        ['Ready alta', 'Ready média', 'Idea urgente', 'Idea baixa tarde'],
      )
      const all = store.listBacklog(project.id, { includeClosed: true })
      assert.deepEqual(
        all.map((item) => item.title),
        ['Ready alta', 'Ready média', 'Idea urgente', 'Idea baixa tarde', 'Promover depois', 'Arquivar depois'],
      )
      assert.equal(active.some((item) => item.id === archived.id || item.id === promoted.id), false)
    })

    it('promove em transação única, é idempotente e nunca duplica tarefa', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Promoção', objective: 'Virar tarefa sem duplicar' })
      const item = store.createBacklogItem(project.id, {
        title: 'Escrever contrato do backlog',
        createdBy: 'Gemini',
        description: 'Sai do backlog e entra com lease.',
        stage: 'ready',
      })
      const first = store.promoteBacklogItem(project.id, item.id)
      assert.equal(first.item.stage, 'promoted')
      assert.equal(first.item.promotedTaskId, first.task.id)
      assert.equal(first.item.version, 1)
      assert.equal(first.task.projectId, project.id)
      assert.equal(first.task.title, 'Escrever contrato do backlog')
      assert.equal(first.task.status, 'todo')
      assert.equal(first.task.assignee, null)
      assert.equal(first.task.leaseUntil, null)
      assert.equal(first.task.version, 0)

      const second = store.promoteBacklogItem(project.id, item.id)
      assert.equal(second.item.id, first.item.id)
      assert.equal(second.task.id, first.task.id)
      assert.equal(second.item.version, 1)
      assert.equal(store.getProject(project.id).tasks.filter((task) => task.title === first.task.title).length, 1)

      expectDomain(
        () => store.updateBacklogItem(project.id, item.id, { expectedVersion: 1, title: 'Não editar promovido' }),
        409,
        'backlog_stage_terminal',
      )
    })

    it('arquiva com CAS e só é idempotente quando a mesma versão já arquivada é reapresentada', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Arquivo', objective: 'Idempotência segura' })
      const item = store.createBacklogItem(project.id, { title: 'Descartar depois', createdBy: 'Astra' })
      const archived = store.archiveBacklogItem(project.id, item.id, { expectedVersion: 0 })
      assert.equal(archived.stage, 'archived')
      assert.equal(archived.version, 1)

      const replay = store.archiveBacklogItem(project.id, item.id, { expectedVersion: 1 })
      assert.equal(replay.stage, 'archived')
      assert.equal(replay.version, 1)
      assert.equal(replay.updatedAt, archived.updatedAt)

      expectDomain(
        () => store.archiveBacklogItem(project.id, item.id, { expectedVersion: 0 }),
        409,
        'backlog_version_conflict',
      )
      expectDomain(
        () => store.updateBacklogItem(project.id, item.id, { expectedVersion: 1, stage: 'idea' }),
        409,
        'backlog_stage_terminal',
      )
    })

    it('isola por projeto e rejeita payload inválido', () => {
      const { store } = makeStore(() => T0)
      const alpha = store.createProject({ name: 'Alfa', objective: 'Isolar backlog' })
      const beta = store.createProject({ name: 'Beta', objective: 'Não vazar item' })
      const item = store.createBacklogItem(alpha.id, { title: 'Só no Alfa', createdBy: 'Grok' })

      assert.equal(store.listBacklog(alpha.id).length, 1)
      assert.equal(store.listBacklog(beta.id).length, 0)
      expectDomain(
        () => store.updateBacklogItem(beta.id, item.id, { expectedVersion: 0, title: 'Invasão' }),
        404,
        'not_found',
      )
      expectDomain(() => store.promoteBacklogItem(beta.id, item.id), 404, 'not_found')
      expectDomain(
        () => store.createBacklogItem(alpha.id, { title: '', createdBy: 'Grok' }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.createBacklogItem(alpha.id, { title: 'x'.repeat(201), createdBy: 'Grok' }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.createBacklogItem(alpha.id, { title: 'Ok', createdBy: 'Grok', description: 'd'.repeat(6001) }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.createBacklogItem(alpha.id, { title: 'Ok', createdBy: '' }),
        400,
        'invalid_input',
      )
    })
  })

  describe('WorkDraft (rascunho de emergência não entregue)', () => {
    function makeClock(start: Date) {
      let current = start
      return {
        now: () => current,
        advance(ms: number) {
          current = new Date(current.getTime() + ms)
        },
      }
    }

    it('salva rascunho versionado sem incrementar a revisão nem virar checkpoint', () => {
      const clock = makeClock(T0)
      const { store, dbPath } = makeStore(() => clock.now())
      const project = store.createProject({
        name: 'Sessão interrompida',
        objective: 'Proteger trabalho longo contra queda da IA',
      })
      const task = store.createTask(project.id, { title: 'Implementar rascunho' })
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const checkpoint = store.saveCheckpoint(project.id, {
        expectedRevision: 0,
        idempotencyKey: 'draft-not-checkpoint',
        taskId: task.id,
        agent: 'alfa',
        summary: 'Checkpoint canônico já existe',
        nextStep: 'Continuar a implementação real',
      })

      const draft = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 0,
        taskId: task.id,
        summary: 'IA caiu no meio da edição de store.ts',
        nextAction: 'Reabrir store.ts e conferir o teste RED',
        changedAreas: ['server/store.ts'],
        openIssues: ['Ainda falta o descarte'],
        observedChecks: [{ commandOrMethod: 'npm test', reportedOutcome: 'ainda não rodei' }],
      })

      assert.match(draft.id, UUID_RE)
      assert.equal(draft.projectId, project.id)
      assert.equal(draft.actorId, 'alfa')
      assert.equal(draft.taskId, task.id)
      assert.equal(draft.version, 0)
      assert.equal(draft.status, 'undelivered')
      assert.equal(draft.summary, 'IA caiu no meio da edição de store.ts')
      assert.equal(draft.nextAction, 'Reabrir store.ts e conferir o teste RED')
      assert.deepEqual(draft.changedAreas, ['server/store.ts'])
      assert.deepEqual(draft.openIssues, ['Ainda falta o descarte'])
      assert.deepEqual(draft.observedChecks, [
        { commandOrMethod: 'npm test', reportedOutcome: 'ainda não rodei' },
      ])
      assert.equal(draft.updatedAt, T0.toISOString())
      assert.equal(store.getProject(project.id).project.revision, 1)
      assert.equal(store.getProject(project.id).checkpoints.length, 1)

      const brief = store.getResumeBrief(project.id, 'alfa')
      assert.equal(brief.latestCheckpoint?.id, checkpoint.id)
      assert.equal(brief.latestTaskCheckpoint?.id, checkpoint.id)
      assert.equal(brief.workDraft?.id, draft.id)
      assert.equal(brief.workDraft?.status, 'undelivered')
      assert.equal(brief.workDrafts.length, 1)
      assert.match(brief.markdown, /Rascunho não entregue/)
      assert.match(brief.markdown, /não é um checkpoint/i)
      assert.match(brief.markdown, /IA caiu no meio da edição de store.ts/)
      assert.equal(brief.markdown.includes('## Próximo passo') && brief.latestCheckpoint?.nextStep === 'Continuar a implementação real', true)
      assert.doesNotMatch(brief.markdown, /IA caiu no meio da edição de store.ts[\s\S]*## Próximo passo/)

      store.close()
      const reopened = new WorkspaceStore(dbPath)
      cleanups.push(() => reopened.close())
      const restored = reopened.getWorkDraft(project.id, 'alfa', task.id)
      assert.deepEqual(restored, draft)
      assert.equal(reopened.getResumeBrief(project.id, 'alfa').latestCheckpoint?.id, checkpoint.id)
    })

    it('usa CAS por versão, um rascunho por projeto-ator-tarefa, e descarta sem criar passagem', () => {
      const clock = makeClock(T0)
      const { store } = makeStore(() => clock.now())
      const project = store.createProject({ name: 'CAS do rascunho', objective: 'Um por escopo' })
      const taskA = store.createTask(project.id, { title: 'Tarefa A' })
      const taskB = store.createTask(project.id, { title: 'Tarefa B' })
      const first = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 0,
        summary: 'Rascunho geral do projeto',
        nextAction: 'Escolher a tarefa',
      })
      assert.equal(first.taskId, null)

      clock.advance(1000)
      const updated = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 0,
        summary: 'Rascunho geral atualizado',
        nextAction: 'Assumir a tarefa A',
      })
      assert.equal(updated.id, first.id)
      assert.equal(updated.version, 1)
      assert.equal(updated.summary, 'Rascunho geral atualizado')
      assert.equal(updated.updatedAt, clock.now().toISOString())
      assert.equal(store.getProject(project.id).project.revision, 0)

      expectDomain(
        () =>
          store.saveWorkDraft(project.id, {
            agent: 'alfa',
            expectedVersion: 0,
            summary: 'Versão antiga',
            nextAction: 'Não deve gravar',
          }),
        409,
        'version_conflict',
      )

      const forA = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 0,
        taskId: taskA.id,
        summary: 'Rascunho da tarefa A',
        nextAction: 'Seguir na A',
      })
      const forB = store.saveWorkDraft(project.id, {
        agent: 'beta',
        expectedVersion: 0,
        taskId: taskA.id,
        summary: 'Rascunho de outro ator na mesma tarefa',
        nextAction: 'Não misturar',
      })
      const otherTask = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 0,
        taskId: taskB.id,
        summary: 'Rascunho da tarefa B',
        nextAction: 'Seguir na B',
      })
      assert.notEqual(forA.id, first.id)
      assert.notEqual(forA.id, forB.id)
      assert.notEqual(forA.id, otherTask.id)
      assert.equal(store.listWorkDrafts(project.id, 'alfa').length, 3)
      assert.equal(store.getResumeBrief(project.id, 'alfa', undefined, 'project').workDraft?.id, updated.id)
      assert.equal(store.getResumeBrief(project.id, 'alfa', taskA.id).workDraft?.id, forA.id)
      assert.equal(store.getResumeBrief(project.id, 'alfa', taskA.id).latestCheckpoint, null)

      const discarded = store.discardWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 1,
        taskId: null,
      })
      assert.equal(discarded.projectId, project.id)
      assert.equal(discarded.actorId, 'alfa')
      assert.equal(discarded.taskId, null)
      assert.equal(store.getWorkDraft(project.id, 'alfa'), null)
      assert.equal(store.getHandoffDeliveries(project.id, 'alfa').length, 0)
      assert.equal(store.getProject(project.id).project.revision, 0)
      assert.equal(store.getResumeBrief(project.id, 'alfa', undefined, 'project').workDraft, null)
      expectDomain(
        () => store.discardWorkDraft(project.id, { agent: 'alfa', expectedVersion: 1 }),
        404,
        'not_found',
      )
    })

    it('rejeita tarefa de outro projeto e não limpa o rascunho ao salvar checkpoint', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'A', objective: 'Isolar' })
      const other = store.createProject({ name: 'B', objective: 'Outro' })
      const foreignTask = store.createTask(other.id, { title: 'Alheia' })
      const task = store.createTask(project.id, { title: 'Própria' })
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const draft = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 0,
        taskId: task.id,
        summary: 'Ainda não entregue',
        nextAction: 'Salvar checkpoint depois',
      })

      expectDomain(
        () =>
          store.saveWorkDraft(project.id, {
            agent: 'alfa',
            expectedVersion: 0,
            taskId: foreignTask.id,
            summary: 'Invasão',
            nextAction: 'Não',
          }),
        404,
        'not_found',
      )
      expectDomain(
        () =>
          store.saveWorkDraft(project.id, {
            agent: '',
            expectedVersion: 0,
            summary: 'x',
            nextAction: 'y',
          }),
        400,
        'invalid_input',
      )

      store.saveCheckpoint(project.id, {
        expectedRevision: 0,
        idempotencyKey: 'after-draft',
        taskId: task.id,
        agent: 'alfa',
        summary: 'Checkpoint posterior',
        nextStep: 'O rascunho continua separado',
      })
      assert.deepEqual(store.getWorkDraft(project.id, 'alfa', task.id), draft)
      assert.equal(store.getResumeBrief(project.id, 'alfa').workDraft?.id, draft.id)
      assert.equal(store.getResumeBrief(project.id, 'alfa').latestCheckpoint?.summary, 'Checkpoint posterior')
    })
  })

  describe('finalizeWork (saída atômica)', () => {
    it('grava checkpoint, passagem, libera a tarefa e descarta o rascunho numa transação', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Saída', objective: 'Encerrar sem deixar metade' })
      const task = store.createTask(project.id, { title: 'Fechar a frente' })
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const draft = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 0,
        taskId: task.id,
        summary: 'Ainda não entregue',
        nextAction: 'Finalizar de verdade',
      })
      const question = store.postMessage(project.id, {
        from: 'beta',
        to: 'alfa',
        kind: 'question',
        body: 'Qual o desfecho?',
      })

      const first = store.finalizeWork(project.id, {
        agent: 'alfa',
        expectedRevision: 0,
        idempotencyKey: 'finalize-1',
        taskId: task.id,
        summary: 'Frente encerrada',
        nextStep: 'A próxima IA lê a passagem',
        delivery: { to: 'beta', message: 'Comece pelo rascunho que não existe mais.' },
        taskTransition: { kind: 'release' },
        discardDraft: true,
        draftId: draft.id,
        expectedDraftVersion: draft.version,
      })

      assert.match(first.checkpoint.id, UUID_RE)
      assert.equal(first.checkpoint.revision, 1)
      assert.equal(first.checkpoint.summary, 'Frente encerrada')
      assert.equal(first.delivery?.to, 'beta')
      assert.equal(first.delivery?.from, 'alfa')
      assert.equal(first.delivery?.checkpointId, first.checkpoint.id)
      assert.equal(first.delivery?.acknowledgedAt, null)
      assert.equal(first.task?.status, 'todo')
      assert.equal(first.task?.assignee, null)
      assert.equal(first.draftDiscarded, true)
      assert.equal(store.getProject(project.id).project.revision, 1)
      assert.equal(store.getWorkDraft(project.id, 'alfa', task.id), null)
      assert.equal(store.getInbox(project.id, 'alfa')[0]?.acknowledgedAt, null)
      assert.equal(store.getInbox(project.id, 'alfa')[0]?.message.id, question.id)

      const retry = store.finalizeWork(project.id, {
        agent: 'alfa',
        expectedRevision: 0,
        idempotencyKey: 'finalize-1',
        taskId: task.id,
        summary: 'Frente encerrada',
        nextStep: 'A próxima IA lê a passagem',
        delivery: { to: 'beta', message: 'Comece pelo rascunho que não existe mais.' },
        taskTransition: { kind: 'release' },
        discardDraft: true,
        draftId: draft.id,
        expectedDraftVersion: draft.version,
      })
      assert.equal(retry.checkpoint.id, first.checkpoint.id)
      assert.equal(retry.delivery?.id, first.delivery?.id)
      assert.equal(store.getProject(project.id).project.revision, 1)
      assert.equal(store.getHandoffDeliveries(project.id, 'beta').length, 1)
    })

    it('keep_claimed preserva a reserva quando não há pedido de descarte', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Continua', objective: 'Não soltar ainda' })
      const task = store.createTask(project.id, { title: 'Seguir' })
      const claimed = store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const result = store.finalizeWork(project.id, {
        agent: 'alfa',
        expectedRevision: 0,
        idempotencyKey: 'finalize-keep',
        taskId: task.id,
        summary: 'Checkpoint incremental',
        nextStep: 'Continuar amanhã',
        taskTransition: { kind: 'keep_claimed' },
      })
      assert.equal(result.delivery, null)
      assert.equal(result.draftDiscarded, false)
      assert.equal(result.task?.assignee, 'alfa')
      assert.equal(result.task?.status, 'in_progress')
      assert.equal(result.task?.version, claimed.version)
      assert.equal(store.getResumeBrief(project.id, 'alfa').focusTask?.id, task.id)
    })

    it('exige identidade e versão do rascunho e aborta tudo quando ele mudou', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'CAS do rascunho', objective: 'Não perder trabalho novo' })
      const task = store.createTask(project.id, { title: 'Finalizar com segurança' })
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const draft = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: 0,
        taskId: task.id,
        summary: 'Versão aberta no formulário',
        nextAction: 'Finalizar',
      })

      expectDomain(
        () =>
          store.finalizeWork(project.id, {
            agent: 'alfa',
            expectedRevision: 0,
            idempotencyKey: 'finalize-missing-draft-cas',
            taskId: task.id,
            summary: 'Não pode finalizar',
            nextStep: 'Recarregar',
            taskTransition: { kind: 'release' },
            discardDraft: true,
          }),
        400,
        'invalid_input',
      )

      const newerDraft = store.saveWorkDraft(project.id, {
        agent: 'alfa',
        expectedVersion: draft.version,
        taskId: task.id,
        summary: 'Versão mais nova salva em outra tela',
        nextAction: 'Preservar esta versão',
      })
      expectDomain(
        () =>
          store.finalizeWork(project.id, {
            agent: 'alfa',
            expectedRevision: 0,
            idempotencyKey: 'finalize-stale-draft',
            taskId: task.id,
            summary: 'Finalização antiga',
            nextStep: 'Não deve existir',
            delivery: { to: 'beta', message: 'Esta passagem também deve ser revertida.' },
            taskTransition: { kind: 'release' },
            discardDraft: true,
            draftId: draft.id,
            expectedDraftVersion: draft.version,
          }),
        409,
        'version_conflict',
      )

      assert.equal(store.getProject(project.id).project.revision, 0)
      assert.equal(store.getProject(project.id).checkpoints.length, 0)
      assert.equal(store.getHandoffDeliveries(project.id, 'beta').length, 0)
      assert.deepEqual(store.getWorkDraft(project.id, 'alfa', task.id), newerDraft)
      assert.equal(store.getProject(project.id).tasks[0]?.status, 'in_progress')
    })

    it('rejeita payload divergente, estados inexistentes e release sem tarefa', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Conflito', objective: 'Não duplicar' })
      const task = store.createTask(project.id, { title: 'Tarefa' })
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      store.finalizeWork(project.id, {
        agent: 'alfa',
        expectedRevision: 0,
        idempotencyKey: 'finalize-conflict',
        taskId: task.id,
        summary: 'Primeiro',
        nextStep: 'Depois',
        taskTransition: { kind: 'keep_claimed' },
      })
      expectDomain(
        () =>
          store.finalizeWork(project.id, {
            agent: 'alfa',
            expectedRevision: 1,
            idempotencyKey: 'finalize-conflict',
            taskId: task.id,
            summary: 'Outro texto',
            nextStep: 'Depois',
            taskTransition: { kind: 'keep_claimed' },
          }),
        409,
        'idempotency_conflict',
      )
      expectDomain(
        () =>
          store.finalizeWork(project.id, {
            agent: 'alfa',
            expectedRevision: 1,
            idempotencyKey: 'finalize-no-task',
            summary: 'Soltar o quê?',
            nextStep: 'Nada',
            taskTransition: { kind: 'release' },
          }),
        400,
        'invalid_input',
      )
    })
  })

  describe('estados blocked e done com reabertura auditável', () => {
    it('declara done ligado ao checkpoint, impede claim e reabre com evento', () => {
      const clock = {
        current: T0,
        now: () => clock.current,
        advance(ms: number) {
          clock.current = new Date(clock.current.getTime() + ms)
        },
      }
      const { store } = makeStore(() => clock.now())
      const project = store.createProject({ name: 'Conclusão', objective: 'Fechar com marco' })
      const task = store.createTask(project.id, { title: 'Entregar a fatia' })
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const done = store.finalizeWork(project.id, {
        agent: 'alfa',
        expectedRevision: 0,
        idempotencyKey: 'finalize-done-ok',
        taskId: task.id,
        summary: 'Fatia concluída segundo o agente',
        nextStep: 'Revisar se ainda fizer sentido',
        taskTransition: { kind: 'declare_done' },
      })
      assert.equal(done.task?.status, 'done')
      assert.equal(done.task?.assignee, null)
      assert.equal(done.task?.completionCheckpointId, done.checkpoint.id)
      assert.equal(store.getResumeBrief(project.id, 'alfa').availableTasks.some((item) => item.id === task.id), false)
      expectDomain(
        () => store.claimTask(project.id, task.id, { agent: 'beta', expectedVersion: done.task!.version }),
        409,
        'task_closed',
      )
      assert.equal(done.task?.status, 'done')

      clock.advance(1000)
      const reopened = store.reopenTask(project.id, task.id, {
        agent: 'beta',
        expectedVersion: done.task!.version,
        note: 'A revisão pediu um ajuste.',
      })
      assert.equal(reopened.status, 'todo')
      assert.equal(reopened.completionCheckpointId, null)
      const events = store.listTaskEvents(project.id, task.id)
      assert.equal(events.length, 2)
      assert.equal(events[0]?.toStatus, 'done')
      assert.equal(events[1]?.toStatus, 'todo')
      assert.equal(events[1]?.note, 'A revisão pediu um ajuste.')
      const claimed = store.claimTask(project.id, task.id, { agent: 'beta', expectedVersion: reopened.version })
      assert.equal(claimed.status, 'in_progress')
    })

    it('declara blocked com motivo, pode manter a reserva e reabre para in_progress', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Impedimento', objective: 'Não misturar com done' })
      const task = store.createTask(project.id, { title: 'Esperar a chave' })
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      expectDomain(
        () =>
          store.finalizeWork(project.id, {
            agent: 'alfa',
            expectedRevision: 0,
            idempotencyKey: 'finalize-blocked-empty',
            taskId: task.id,
            summary: 'Sem motivo',
            nextStep: 'Esperar',
            taskTransition: { kind: 'declare_blocked', reason: '   ' },
          }),
        400,
        'invalid_input',
      )
      const blocked = store.finalizeWork(project.id, {
        agent: 'alfa',
        expectedRevision: 0,
        idempotencyKey: 'finalize-blocked-ok',
        taskId: task.id,
        summary: 'Travado na dependência',
        nextStep: 'Retomar quando a chave chegar',
        taskTransition: { kind: 'declare_blocked', reason: 'Falta a chave de API autorizada.', retainLease: true },
      })
      assert.equal(blocked.task?.status, 'blocked')
      assert.equal(blocked.task?.blockedReason, 'Falta a chave de API autorizada.')
      assert.equal(blocked.task?.assignee, 'alfa')
      assert.equal(store.getResumeBrief(project.id, 'alfa').claimedTasks[0]?.id, task.id)
      assert.ok(store.getResumeBrief(project.id, 'alfa').attention.some((item) => item.sourceId === task.id))
      expectDomain(
        () => store.claimTask(project.id, task.id, { agent: 'beta', expectedVersion: blocked.task!.version }),
        409,
        'lease_held',
      )
      const reopened = store.reopenTask(project.id, task.id, {
        agent: 'alfa',
        expectedVersion: blocked.task!.version,
        note: 'A chave chegou.',
      })
      assert.equal(reopened.status, 'in_progress')
      assert.equal(reopened.blockedReason, null)
      assert.equal(reopened.assignee, 'alfa')
    })

    it('blocked sem reserva não entra nas disponíveis e exige reabertura', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Bloqueio solto', objective: 'Não assumir fechada' })
      const task = store.createTask(project.id, { title: 'Esperar o humano' })
      store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 0 })
      const blocked = store.finalizeWork(project.id, {
        agent: 'alfa',
        expectedRevision: 0,
        idempotencyKey: 'finalize-blocked-release',
        taskId: task.id,
        summary: 'Precisa de decisão humana',
        nextStep: 'Esperar o usuário',
        taskTransition: { kind: 'declare_blocked', reason: 'O usuário ainda não escolheu o recorte.' },
      })
      assert.equal(blocked.task?.assignee, null)
      assert.equal(store.getResumeBrief(project.id, 'beta').availableTasks.some((item) => item.id === task.id), false)
      expectDomain(
        () => store.claimTask(project.id, task.id, { agent: 'beta', expectedVersion: blocked.task!.version }),
        409,
        'task_closed',
      )
      expectDomain(
        () => store.reopenTask(project.id, task.id, { agent: 'beta', expectedVersion: 0, note: 'Versão velha' }),
        409,
        'version_conflict',
      )
      expectDomain(
        () =>
          store.reopenTask(project.id, task.id, {
            agent: 'beta',
            expectedVersion: blocked.task!.version,
            note: '',
          }),
        400,
        'invalid_input',
      )
    })
  })

  describe('WorkIntent na reserva e aviso de sobreposição', () => {
    it('grava intenção opcional, avisa escrita sobreposta e não bloqueia a reserva', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Paralelo', objective: 'Duas IAs no mesmo arquivo' })
      const core = store.createTask(project.id, { title: 'Núcleo' })
      const tests = store.createTask(project.id, { title: 'Testes' })
      const intent = {
        objective: 'Alterar o store',
        areas: [{ kind: 'file_path' as const, locator: 'server/store.ts', access: 'write' as const }],
        expectedOutputs: ['claim com intenção'],
        plannedChecks: ['npm test'],
      }
      const first = store.claimTask(project.id, core.id, {
        agent: 'alfa',
        expectedVersion: 0,
        intent,
      })
      assert.deepEqual(first.workIntent, intent)
      const second = store.claimTask(project.id, tests.id, {
        agent: 'beta',
        expectedVersion: 0,
        intent,
      })
      assert.equal(second.assignee, 'beta')
      const overlaps = store.listIntentOverlaps(project.id, tests.id)
      assert.equal(overlaps.length, 1)
      assert.equal(overlaps[0]?.otherTaskId, core.id)
      assert.match(overlaps[0]?.explanation ?? '', /não é um lock/i)
      const brief = store.getResumeBrief(project.id, 'beta')
      assert.equal(brief.overlaps.length, 1)
      assert.match(brief.markdown, /Possível sobreposição/)
      assert.match(brief.markdown, /não é um lock/i)
    })

    it('renovação sem intent preserva, release limpa, leitura não avisa', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Renovação', objective: 'Preservar intenção' })
      const task = store.createTask(project.id, { title: 'Núcleo' })
      const other = store.createTask(project.id, { title: 'Leitura' })
      store.claimTask(project.id, task.id, {
        agent: 'alfa',
        expectedVersion: 0,
        intent: {
          objective: 'Escrever',
          areas: [{ kind: 'file_path', locator: 'src/app.ts', access: 'write' }],
          expectedOutputs: [],
          plannedChecks: [],
        },
      })
      const renewed = store.claimTask(project.id, task.id, { agent: 'alfa', expectedVersion: 1 })
      assert.equal(renewed.workIntent?.objective, 'Escrever')
      store.claimTask(project.id, other.id, {
        agent: 'beta',
        expectedVersion: 0,
        intent: {
          objective: 'Ler',
          areas: [{ kind: 'file_path', locator: 'src/app.ts', access: 'read' }],
          expectedOutputs: [],
          plannedChecks: [],
        },
      })
      assert.equal(store.listIntentOverlaps(project.id, task.id).length, 0)
      const released = store.releaseTask(project.id, task.id, { agent: 'alfa', expectedVersion: 2 })
      assert.equal(released.workIntent, null)
    })
  })

  describe('Decision (decisões canônicas e linhagem)', () => {
    it('proposta não vigente: IA propõe com agent e decisão não aparece como vigente nem no brief', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Projeto Decisões', objective: 'Testar ciclo canônico' })

      const decision = store.proposeDecision(project.id, {
        agent: 'gemini-1',
        title: 'Adotar SQLite WAL',
        body: 'Usar WAL para leituras concorrentes seguras no backend local.',
        note: 'Proposta baseada no contrato de concorrência.',
      })

      assert.equal(decision.projectId, project.id)
      assert.equal(decision.title, 'Adotar SQLite WAL')
      assert.equal(decision.body, 'Usar WAL para leituras concorrentes seguras no backend local.')
      assert.equal(decision.status, 'proposed')
      assert.equal(decision.proposedBy, 'gemini-1')
      assert.equal(decision.acceptedBy, null)
      assert.equal(decision.revokedBy, null)
      assert.equal(decision.supersedesId, null)
      assert.equal(decision.supersededById, null)
      assert.equal(decision.version, 0)
      assert.equal(decision.source.kind, 'agent_proposal')
      assert.equal(decision.source.note, 'Proposta baseada no contrato de concorrência.')

      // Listagem padrão traz somente vigentes (vazio)
      const active = store.listDecisions(project.id)
      assert.equal(active.length, 0)

      // Histórico inclui a proposta
      const history = store.listDecisions(project.id, { includeHistory: true })
      assert.equal(history.length, 1)
      assert.equal(history[0]?.id, decision.id)
      assert.equal(history[0]?.status, 'proposed')

      // Briefing não inclui propostas nas decisões vigentes
      const brief = store.getResumeBrief(project.id, 'gemini-1')
      assert.equal(brief.decisions.length, 0)
    })

    it('aceite torna vigente: operador humano aceita com actor e versão esperada', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Projeto Aceite', objective: 'Aceitar decisões' })

      const proposed = store.proposeDecision(project.id, {
        agent: 'gemini-1',
        title: 'Formato de data ISO',
        body: 'Todas as entidades usam strings ISO 8601 em UTC.',
      })

      const accepted = store.acceptDecision(project.id, proposed.id, {
        actor: 'operador-humano',
        expectedVersion: 0,
      })

      assert.equal(accepted.id, proposed.id)
      assert.equal(accepted.status, 'accepted')
      assert.equal(accepted.acceptedBy, 'operador-humano')
      assert.equal(accepted.version, 1)

      // Agora é vigente na listagem padrão
      const active = store.listDecisions(project.id)
      assert.equal(active.length, 1)
      assert.equal(active[0]?.id, proposed.id)
      assert.equal(active[0]?.status, 'accepted')
      assert.equal(active[0]?.acceptedBy, 'operador-humano')

      // Aparece no briefing como vigente
      const brief = store.getResumeBrief(project.id, 'qualquer-agente')
      assert.equal(brief.decisions.length, 1)
      assert.equal(brief.decisions[0]?.id, proposed.id)
      assert.match(brief.markdown, /Formato de data ISO/)
    })

    it('revogar tira da vigente: operador humano revoga com actor e versão esperada', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Projeto Revogação', objective: 'Revogar decisões' })

      const proposed = store.proposeDecision(project.id, {
        agent: 'gemini-1',
        title: 'Uso de Redis',
        body: 'Utilizar Redis para cache temporário.',
      })
      const accepted = store.acceptDecision(project.id, proposed.id, {
        actor: 'operador-humano',
        expectedVersion: 0,
      })

      const revoked = store.revokeDecision(project.id, accepted.id, {
        actor: 'operador-humano',
        expectedVersion: 1,
        note: 'Decidido manter apenas SQLite local.',
      })

      assert.equal(revoked.id, accepted.id)
      assert.equal(revoked.status, 'revoked')
      assert.equal(revoked.revokedBy, 'operador-humano')
      assert.equal(revoked.version, 2)

      // Sai da lista de vigentes
      const active = store.listDecisions(project.id)
      assert.equal(active.length, 0)

      // Permanece no briefing fora das vigentes
      const brief = store.getResumeBrief(project.id, 'gemini-1')
      assert.equal(brief.decisions.length, 0)

      // Permanece consultável no histórico
      const history = store.listDecisions(project.id, { includeHistory: true })
      assert.equal(history.length, 1)
      assert.equal(history[0]?.id, accepted.id)
      assert.equal(history[0]?.status, 'revoked')
    })

    it('supersede aponta linhagem: substitui decisão vigente em transação única com CAS', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Linhagem', objective: 'Substituição canônica' })

      const proposed = store.proposeDecision(project.id, {
        agent: 'gemini-1',
        title: 'Buffer de 4KB',
        body: 'Tamanho padrão de chunk 4096 bytes.',
      })
      const d1 = store.acceptDecision(project.id, proposed.id, {
        actor: 'operador-1',
        expectedVersion: 0,
      })

      const d2 = store.supersedeDecision(project.id, d1.id, {
        actor: 'operador-1',
        expectedVersion: 1,
        title: 'Buffer de 64KB',
        body: 'Aumentar tamanho de chunk para 65536 bytes após benchmarks.',
        note: 'Evidência de melhoria de throughput.',
      })

      assert.equal(d2.status, 'accepted')
      assert.equal(d2.supersedesId, d1.id)
      assert.equal(d2.supersededById, null)
      assert.equal(d2.proposedBy, 'operador-1')
      assert.equal(d2.acceptedBy, 'operador-1')
      assert.equal(d2.version, 0)
      assert.equal(d2.source.kind, 'human_directive')
      assert.equal(d2.source.note, 'Evidência de melhoria de throughput.')

      // Anterior virou superseded com supersededById apontando para a nova
      const history = store.listDecisions(project.id, { includeHistory: true })
      const prev = history.find((d) => d.id === d1.id)
      assert.ok(prev)
      assert.equal(prev.status, 'superseded')
      assert.equal(prev.supersededById, d2.id)
      assert.equal(prev.version, 2)

      // Somente a nova (d2) é vigente
      const active = store.listDecisions(project.id)
      assert.equal(active.length, 1)
      assert.equal(active[0]?.id, d2.id)
      assert.equal(active[0]?.title, 'Buffer de 64KB')

      // Briefing traz somente a vigente (d2)
      const brief = store.getResumeBrief(project.id, 'gemini-1')
      assert.equal(brief.decisions.length, 1)
      assert.equal(brief.decisions[0]?.id, d2.id)
      assert.match(brief.markdown, /Buffer de 64KB/)
    })

    it('CAS: version_conflict ao tentar aceitar, revogar ou substituir com versão defasada', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Conflito CAS', objective: 'Testar concorrência' })

      const d = store.proposeDecision(project.id, {
        agent: 'gemini-1',
        title: 'Decisão CAS',
        body: 'Conteúdo inicial.',
      })

      // Versão incorreta ao aceitar
      expectDomain(
        () => store.acceptDecision(project.id, d.id, { actor: 'operador', expectedVersion: 99 }),
        409,
        'version_conflict',
      )

      const accepted = store.acceptDecision(project.id, d.id, { actor: 'operador', expectedVersion: 0 })
      assert.equal(accepted.version, 1)

      // Versão antiga ao revogar
      expectDomain(
        () => store.revokeDecision(project.id, accepted.id, { actor: 'operador', expectedVersion: 0 }),
        409,
        'version_conflict',
      )

      // Versão antiga ao substituir
      expectDomain(
        () =>
          store.supersedeDecision(project.id, accepted.id, {
            actor: 'operador',
            expectedVersion: 0,
            title: 'Nova versão',
            body: 'Texto novo',
          }),
        409,
        'version_conflict',
      )
    })

    it('isolamento entre projetos e validações de existência', () => {
      const { store } = makeStore(() => T0)
      const p1 = store.createProject({ name: 'Projeto 1', objective: 'Isolamento 1' })
      const p2 = store.createProject({ name: 'Projeto 2', objective: 'Isolamento 2' })

      const d1 = store.proposeDecision(p1.id, {
        agent: 'alfa',
        title: 'Decisão do P1',
        body: 'Corpo P1',
      })
      store.acceptDecision(p1.id, d1.id, { actor: 'humano', expectedVersion: 0 })

      // P2 não vê decisões de P1
      assert.equal(store.listDecisions(p2.id).length, 0)
      assert.equal(store.listDecisions(p2.id, { includeHistory: true }).length, 0)
      assert.equal(store.getResumeBrief(p2.id, 'alfa').decisions.length, 0)

      // Operar em d1 usando p2 retorna 404
      expectDomain(
        () => store.acceptDecision(p2.id, d1.id, { actor: 'humano', expectedVersion: 0 }),
        404,
        'not_found',
      )
      expectDomain(
        () => store.revokeDecision(p2.id, d1.id, { actor: 'humano', expectedVersion: 1 }),
        404,
        'not_found',
      )
      expectDomain(
        () =>
          store.supersedeDecision(p2.id, d1.id, {
            actor: 'humano',
            expectedVersion: 1,
            title: 'Tentativa cruzada',
            body: 'Texto',
          }),
        404,
        'not_found',
      )
    })

    it('transições inválidas e validação de campos', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Regras de Transição', objective: 'Ciclo canônico estrito' })

      const prop = store.proposeDecision(project.id, {
        agent: 'alfa',
        title: 'Decisão inicial',
        body: 'Texto da proposta.',
      })

      // Não pode revogar proposta (só aceita pode ser revogada)
      expectDomain(
        () => store.revokeDecision(project.id, prop.id, { actor: 'humano', expectedVersion: 0 }),
        409,
        'invalid_transition',
      )

      // Não pode substituir proposta diretamente
      expectDomain(
        () =>
          store.supersedeDecision(project.id, prop.id, {
            actor: 'humano',
            expectedVersion: 0,
            title: 'Substituição prematura',
            body: 'Texto',
          }),
        409,
        'invalid_transition',
      )

      const acc = store.acceptDecision(project.id, prop.id, { actor: 'humano', expectedVersion: 0 })

      // Não pode aceitar novamente o que já foi aceito
      expectDomain(
        () => store.acceptDecision(project.id, acc.id, { actor: 'humano', expectedVersion: 1 }),
        409,
        'invalid_transition',
      )

      // Campos vazios ou inválidos são rejeitados
      expectDomain(
        () => store.proposeDecision(project.id, { agent: '', title: 'T', body: 'B' }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.proposeDecision(project.id, { agent: 'a', title: '   ', body: 'B' }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.proposeDecision(project.id, { agent: 'a', title: 'T', body: '   ' }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.acceptDecision(project.id, acc.id, { actor: '', expectedVersion: 1 }),
        400,
        'invalid_input',
      )
      expectDomain(
        () => store.revokeDecision(project.id, acc.id, { actor: '   ', expectedVersion: 1 }),
        400,
        'invalid_input',
      )
    })
  })

  describe('Charter versionado', () => {
    it('nasce com a revisão 1 a partir do objetivo e aceita nova revisão com CAS', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({
        name: 'Diretriz',
        objective: 'Construir o correio de continuidade.',
      })
      const first = store.getCharter(project.id)
      assert.equal(first?.revision, 1)
      assert.equal(first?.body, 'Construir o correio de continuidade.')
      assert.equal(first?.createdBy, 'operator')
      assert.equal(first?.sourceKind, 'human_directive')
      assert.equal(store.getResumeBrief(project.id, 'alfa').charter?.revision, 1)
      assert.match(store.getResumeBrief(project.id, 'alfa').markdown, /Charter/)

      const next = store.saveCharter(project.id, {
        actor: 'humano',
        expectedRevision: 1,
        body: 'Construir o correio e preservar decisões humanas.',
      })
      assert.equal(next.revision, 2)
      assert.equal(next.supersedesId, first?.id)
      assert.equal(store.getProject(project.id).project.objective, 'Construir o correio e preservar decisões humanas.')
      assert.equal(store.listCharterHistory(project.id).length, 2)
      expectDomain(
        () =>
          store.saveCharter(project.id, {
            actor: 'humano',
            expectedRevision: 1,
            body: 'Versão velha',
          }),
        409,
        'version_conflict',
      )
    })

    it('não promove proposta de agente nem altera o objetivo sem aceite humano', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({
        name: 'Autoridade do charter',
        objective: 'Objetivo definido pelo operador.',
      })
      const current = store.getCharter(project.id)!

      expectDomain(
        () =>
          store.saveCharter(project.id, {
            actor: 'agente-alfa',
            expectedRevision: current.revision,
            body: 'Objetivo proposto pela IA.',
            sourceKind: 'agent_proposal',
          }),
        409,
        'human_approval_required',
      )

      assert.equal(store.getProject(project.id).project.objective, 'Objetivo definido pelo operador.')
      assert.deepEqual(store.getCharter(project.id), current)
      assert.equal(store.listCharterHistory(project.id).length, 1)
    })
  })

  describe('Bloqueio canônico', () => {
    it('permanece na atenção até resolução explícita e pode ser reaberto', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Impedimentos', objective: 'Não perder bloqueio' })
      const task = store.createTask(project.id, { title: 'Esperar chave' })
      const opened = store.openBlocker(project.id, {
        agent: 'alfa',
        title: 'Falta a chave de API',
        body: 'O operador ainda não autorizou o acesso.',
        taskId: task.id,
      })
      assert.equal(opened.status, 'open')
      assert.equal(opened.taskId, task.id)
      const brief = store.getResumeBrief(project.id, 'alfa')
      assert.equal(brief.blockers.length, 1)
      assert.ok(brief.attention.some((item) => item.sourceId === opened.id))
      assert.match(brief.markdown, /Falta a chave de API/)

      const mitigated = store.mitigateBlocker(project.id, opened.id, {
        agent: 'alfa',
        expectedVersion: 0,
        note: 'Usamos uma chave temporária.',
      })
      assert.equal(mitigated.status, 'mitigated')
      assert.ok(store.getResumeBrief(project.id, 'alfa').attention.some((item) => item.sourceId === opened.id))

      const resolved = store.resolveBlocker(project.id, opened.id, {
        agent: 'humano',
        expectedVersion: 1,
        note: 'A chave definitiva chegou.',
      })
      assert.equal(resolved.status, 'resolved')
      assert.equal(resolved.resolvedBy, 'humano')
      assert.equal(store.getResumeBrief(project.id, 'alfa').blockers.length, 0)
      assert.equal(store.getResumeBrief(project.id, 'alfa').attention.some((item) => item.sourceId === opened.id), false)
      assert.equal(store.listBlockers(project.id, { includeClosed: true }).length, 1)

      const reopened = store.reopenBlocker(project.id, opened.id, {
        agent: 'alfa',
        expectedVersion: 2,
        note: 'A chave foi revogada.',
      })
      assert.equal(reopened.status, 'open')
      assert.equal(reopened.resolution, null)
      assert.ok(store.getResumeBrief(project.id, 'alfa').attention.some((item) => item.sourceId === opened.id))
    })

    it('aceitar risco tira da atenção e recusa tarefa de outro projeto', () => {
      const { store } = makeStore(() => T0)
      const project = store.createProject({ name: 'Risco', objective: 'Seguir mesmo assim' })
      const other = store.createProject({ name: 'Outro', objective: 'Isolar' })
      const foreign = store.createTask(other.id, { title: 'Alheia' })
      const opened = store.openBlocker(project.id, {
        agent: 'alfa',
        title: 'Sem backup',
        body: 'Ainda não há cópia remota.',
      })
      expectDomain(
        () =>
          store.openBlocker(project.id, {
            agent: 'alfa',
            title: 'Invasão',
            body: 'Não',
            taskId: foreign.id,
          }),
        404,
        'not_found',
      )
      const accepted = store.acceptBlockerRisk(project.id, opened.id, {
        agent: 'humano',
        expectedVersion: 0,
        note: 'Seguimos locais até a VPS.',
      })
      assert.equal(accepted.status, 'accepted_risk')
      assert.equal(store.getResumeBrief(project.id, 'alfa').blockers.length, 0)
    })
  })
})
