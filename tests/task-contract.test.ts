import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { createApp } from '../server/app.js'
import { createMcpServer } from '../server/mcp-tools.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DomainError, WorkspaceStore } from '../server/store.js'
import type { Task } from '../shared/types.js'

const T0 = new Date('2026-09-15T06:00:00.000Z')
const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) {
    await dispose()
  }
})

function makeStore(): WorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'axon-task-contract-'))
  const store = new WorkspaceStore(join(dir, 'workspace.sqlite'), { now: () => T0 })
  cleanups.push(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

function expectDomain(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError, `Esperava DomainError mas recebeu: ${String(error)}`)
    assert.equal(error.status, status)
    assert.equal(error.code, code)
    return true
  })
}

describe('Contrato de Tarefa — Critérios de Aceite, Dependências e Saídas', () => {
  it('cria tarefa com critérios de aceite, prioridade, dependências e saídas esperadas', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Projeto Tarefas', objective: 'Validar contrato' })

    const baseTask = store.createTask(project.id, { title: 'Tarefa Prévia' })

    const task = store.createTask(project.id, {
      title: 'Implementar compilador AST',
      description: 'Construir o analisador sintático com base na gramática vigente.',
      priority: 'high',
      acceptanceCriteria: [
        { description: 'Parseia declaração de tipos' },
        { description: 'Gera nós AST imutáveis' },
      ],
      dependencyTaskIds: [baseTask.id],
      expectedOutputs: [
        { title: 'Módulo parser.ts', kind: 'file_path', locator: 'src/parser.ts' },
      ],
    })

    assert.equal(task.title, 'Implementar compilador AST')
    assert.equal(task.description, 'Construir o analisador sintático com base na gramática vigente.')
    assert.equal(task.priority, 'high')
    assert.equal(task.acceptanceCriteria?.length, 2)
    assert.ok(task.acceptanceCriteria?.[0]?.id)
    assert.equal(task.acceptanceCriteria?.[0]?.description, 'Parseia declaração de tipos')
    assert.equal(task.acceptanceCriteria?.[0]?.completed, false)
    assert.deepEqual(task.dependencyTaskIds, [baseTask.id])
    assert.equal(task.expectedOutputs?.length, 1)
    assert.equal(task.expectedOutputs?.[0]?.title, 'Módulo parser.ts')
    assert.equal(task.expectedOutputs?.[0]?.locator, 'src/parser.ts')

    // Tarefa simples sem campos opcionais ganha defaults seguros
    const simple = store.createTask(project.id, { title: 'Tarefa simples' })
    assert.equal(simple.priority, 'medium')
    assert.deepEqual(simple.acceptanceCriteria, [])
    assert.deepEqual(simple.dependencyTaskIds, [])
    assert.deepEqual(simple.expectedOutputs, [])
  })

  it('atualiza contrato de tarefa com CAS por version', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Projeto CAS', objective: 'Testar CAS do contrato' })

    const task = store.createTask(project.id, { title: 'Tarefa Original' })
    assert.equal(task.version, 0)

    const updated = store.updateTaskContract(project.id, task.id, {
      expectedVersion: 0,
      title: 'Tarefa Atualizada',
      description: 'Nova descrição detalhada',
      priority: 'urgent',
      acceptanceCriteria: [{ description: 'Critério 1' }],
    })

    assert.equal(updated.version, 1)
    assert.equal(updated.title, 'Tarefa Atualizada')
    assert.equal(updated.description, 'Nova descrição detalhada')
    assert.equal(updated.priority, 'urgent')
    assert.equal(updated.acceptanceCriteria?.length, 1)

    // Versão antiga é rejeitada com 409 version_conflict
    expectDomain(
      () =>
        store.updateTaskContract(project.id, task.id, {
          expectedVersion: 0,
          title: 'Tentativa concorrente',
        }),
      409,
      'version_conflict',
    )
  })

  it('detecta e rejeita dependências cíclicas e dependências de outro projeto', () => {
    const store = makeStore()
    const p1 = store.createProject({ name: 'P1', objective: 'Obj 1' })
    const p2 = store.createProject({ name: 'P2', objective: 'Obj 2' })

    const t1 = store.createTask(p1.id, { title: 'T1' })
    const t2 = store.createTask(p1.id, { title: 'T2', dependencyTaskIds: [t1.id] })
    const t3 = store.createTask(p1.id, { title: 'T3', dependencyTaskIds: [t2.id] })
    const foreign = store.createTask(p2.id, { title: 'T Estrangeira' })

    // Auto-dependência (T1 depende de T1)
    expectDomain(
      () =>
        store.updateTaskContract(p1.id, t1.id, {
          expectedVersion: 0,
          dependencyTaskIds: [t1.id],
        }),
      400,
      'dependency_cycle',
    )

    // Ciclo transitivo: T1 tenta depender de T3 (T1 -> T3 -> T2 -> T1)
    expectDomain(
      () =>
        store.updateTaskContract(p1.id, t1.id, {
          expectedVersion: 0,
          dependencyTaskIds: [t3.id],
        }),
      400,
      'dependency_cycle',
    )

    // Dependência de tarefa de outro projeto (404)
    expectDomain(
      () =>
        store.updateTaskContract(p1.id, t1.id, {
          expectedVersion: 0,
          dependencyTaskIds: [foreign.id],
        }),
      404,
      'not_found',
    )
  })

  it('impede claimTask em tarefa com dependência não concluída', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Dependências', objective: 'Validar impedimento de claim' })

    const dep = store.createTask(project.id, { title: 'Dependência Obrigatória' })
    const main = store.createTask(project.id, {
      title: 'Tarefa Principal',
      dependencyTaskIds: [dep.id],
    })

    // Enquanto dep estiver em 'todo' ou 'in_progress', main não pode ser assumida
    expectDomain(
      () => store.claimTask(project.id, main.id, { agent: 'Astra', expectedVersion: 0 }),
      409,
      'dependency_unmet',
    )

    // Quando dep é declarada 'done', main pode ser assumida
    store.claimTask(project.id, dep.id, { agent: 'Grok', expectedVersion: 0 })
    store.finalizeWork(project.id, {
      agent: 'Grok',
      expectedRevision: 0,
      idempotencyKey: 'fin-dep',
      summary: 'Dependência concluída',
      nextStep: 'Seguir para a próxima',
      taskId: dep.id,
      taskTransition: { kind: 'declare_done' },
    })

    const claimed = store.claimTask(project.id, main.id, { agent: 'Astra', expectedVersion: 0 })
    assert.equal(claimed.assignee, 'Astra')
    assert.equal(claimed.status, 'in_progress')
  })

  it('ContextEnvelope inclui critérios de aceite, dependências e saídas no foco da tarefa', () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Envelope Contrato', objective: 'Exibir contrato no envelope' })

    const dep = store.createTask(project.id, { title: 'Setup inicial' })
    const task = store.createTask(project.id, {
      title: 'Criar componente visual',
      description: 'Componente com suporte a acessibilidade e tema escuro',
      priority: 'urgent',
      acceptanceCriteria: [
        { description: 'Contraste WCAG AAA', completed: true },
        { description: 'Navegação por teclado' },
      ],
      dependencyTaskIds: [dep.id],
      expectedOutputs: [
        { title: 'Componente React', kind: 'file_path', locator: 'src/Button.tsx' },
      ],
    })

    const envelope = store.compileContext(project.id, {
      agent: 'Astra',
      taskId: task.id,
    })

    const focusSec = envelope.sections.find((s) => s.kind === 'focus_task')
    assert.ok(focusSec)
    assert.match(focusSec.items[0]?.body ?? '', /Prioridade: urgent/)
    assert.match(focusSec.items[0]?.body ?? '', /Contraste WCAG AAA/)
    assert.match(focusSec.items[0]?.body ?? '', /Navegação por teclado/)
    assert.match(focusSec.items[0]?.body ?? '', /src\/Button\.tsx/)

    // Verifica que o Markdown do envelope renderiza os critérios
    assert.match(envelope.markdown, /Contraste WCAG AAA/)
    assert.match(envelope.markdown, /Navegação por teclado/)
  })

  it('HTTP e MCP expõem atualização de contrato de tarefa', async () => {
    const store = makeStore()
    const project = store.createProject({ name: 'Transporte Contrato', objective: 'HTTP e MCP' })
    const task = store.createTask(project.id, { title: 'Tarefa API' })

    const server = createServer(createApp(store))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`

    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    // 1. HTTP POST /api/projects/:id/tasks/:taskId/contract
    const res = await fetch(`${base}/api/projects/${project.id}/tasks/${task.id}/contract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Client': 'local',
        Host: `127.0.0.1:${address.port}`,
        Origin: `http://127.0.0.1:${address.port}`,
      },
      body: JSON.stringify({
        expectedVersion: 0,
        description: 'Descrição via HTTP',
        priority: 'high',
        acceptanceCriteria: [{ description: 'Critério via API' }],
      }),
    })

    assert.equal(res.status, 200)
    const updatedTask = (await res.json()) as Task
    assert.equal(updatedTask.description, 'Descrição via HTTP')
    assert.equal(updatedTask.priority, 'high')
    assert.equal(updatedTask.acceptanceCriteria?.length, 1)

    // 2. MCP update_task_contract
    const mcpServer = createMcpServer(store)
    const client = new Client({ name: 'axon-contract-mcp', version: '1.0.0' })
    cleanups.push(async () => {
      await client.close()
      await mcpServer.close()
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    await client.connect(clientTransport)

    const response = await client.callTool({
      name: 'update_task_contract',
      arguments: {
        projectId: project.id,
        taskId: task.id,
        expectedVersion: 1,
        priority: 'urgent',
      },
    })

    assert.equal(response.isError, undefined)
    const content = response.content as Array<{ type: string; text: string }>
    const mcpTask = JSON.parse(content[0]!.text) as Task
    assert.equal(mcpTask.priority, 'urgent')
    assert.equal(mcpTask.version, 2)
  })
})
