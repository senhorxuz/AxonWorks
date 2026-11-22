// A rota que alimenta a lista "O que será removido" do diálogo Excluir projeto, vista pela porta de entrada (HTTP).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import { WorkspaceStore } from '../server/store.js'
import { createApp } from '../server/app.js'

const pasta = mkdtempSync(path.join(tmpdir(), 'axon-excluir-http-'))
const store = new WorkspaceStore(path.join(pasta, 'excluir.sqlite'))
const projetoA = store.createProject({ name: 'Projeto A', objective: 'Do token' })
const projetoB = store.createProject({ name: 'Projeto B', objective: 'De outro' })
store.saveWorkDraft(projetoA.id, { agent: 'Astra', expectedVersion: 0, summary: 'Rascunho 1', nextAction: 'Seguir' })
store.saveWorkDraft(projetoA.id, { agent: 'Gemini', expectedVersion: 0, summary: 'Rascunho 2', nextAction: 'Seguir' })
const checkpoint = store.saveCheckpoint(projetoA.id, { expectedRevision: 0, idempotencyKey: 'cp-1', agent: 'Astra', summary: 'Feito.', nextStep: 'Seguir.' })
store.createHandoffDelivery(projetoA.id, { checkpointId: checkpoint.id, from: 'Astra', to: 'Gemini', message: 'Passagem.' })
const { token } = store.createAuthToken({
  name: 'Token só do A', tokenType: 'agent', role: 'collaborator', projectId: projetoA.id, agentName: 'Astra', expiresInHours: 1,
})

let servidor: Server
let base = ''

async function iniciar(): Promise<void> {
  if (base) return
  servidor = createApp(store).listen(0, '127.0.0.1')
  await new Promise((resolve) => servidor.once('listening', resolve))
  base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`
}

async function pedir(caminho: string, comToken: boolean): Promise<{ status: number; corpo: Record<string, unknown> }> {
  await iniciar()
  const resposta = await fetch(`${base}${caminho}`, {
    headers: { ...(comToken ? { Authorization: `Bearer ${token}` } : {}), Origin: base, 'X-Workspace-Client': 'local' },
  })
  return { status: resposta.status, corpo: (await resposta.json().catch(() => ({}))) as Record<string, unknown> }
}

after(() => {
  servidor?.close()
  store.close()
  rmSync(pasta, { recursive: true, force: true })
})

describe('GET /api/projects/:id/o-que-sera-removido', () => {
  test('200 com a contagem de rascunhos e passagens do projeto (token do próprio projeto)', async () => {
    const resposta = await pedir(`/api/projects/${projetoA.id}/o-que-sera-removido`, true)
    assert.equal(resposta.status, 200)
    assert.deepEqual(resposta.corpo, { rascunhos: 2, passagens: 1 })
  })

  test('200 também sem token restrito, e outro projeto conta o dele', async () => {
    const resposta = await pedir(`/api/projects/${projetoB.id}/o-que-sera-removido`, false)
    assert.equal(resposta.status, 200)
    assert.deepEqual(resposta.corpo, { rascunhos: 0, passagens: 0 })
  })

  test('token do projeto A não conta o projeto B (403 forbidden_project_scope)', async () => {
    const resposta = await pedir(`/api/projects/${projetoB.id}/o-que-sera-removido`, true)
    assert.equal(resposta.status, 403)
    assert.equal((resposta.corpo.error as { code: string }).code, 'forbidden_project_scope')
  })

  test('projeto que não existe é 404', async () => {
    const resposta = await pedir('/api/projects/00000000-0000-4000-8000-000000000000/o-que-sera-removido', false)
    assert.equal(resposta.status, 404)
    assert.equal((resposta.corpo.error as { code: string }).code, 'not_found')
  })
})
