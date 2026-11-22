// Um token restrito a um projeto não lê nem escreve em outro projeto por nenhuma rota /api/projects/:id/*.
// Achado da revisão de segurança de 21/11/2026: a conferência de escopo existia (`requireProjectRole`), mas não
// estava ligada nas rotas; só as rotas das entregas conferiam o escopo, uma a uma.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import { WorkspaceStore } from '../server/store.js'
import { createApp } from '../server/app.js'
import { podeAgirNoProjeto } from '../server/auth/escopo.js'

const pasta = mkdtempSync(path.join(tmpdir(), 'axon-escopo-'))
const store = new WorkspaceStore(path.join(pasta, 'escopo.sqlite'))
const projetoA = store.createProject({ name: 'Projeto A', objective: 'Do token' })
const projetoB = store.createProject({ name: 'Projeto B', objective: 'De outro' })
const { token } = store.createAuthToken({
  name: 'Token só do A',
  tokenType: 'agent',
  role: 'collaborator',
  projectId: projetoA.id,
  agentName: 'Astra',
  expiresInHours: 1,
})

let servidor: Server
let base = ''

async function iniciar(): Promise<void> {
  if (base) return
  servidor = createApp(store).listen(0, '127.0.0.1')
  await new Promise((resolve) => servidor.once('listening', resolve))
  base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`
}

async function pedir(caminho: string, metodo = 'GET', corpo?: unknown): Promise<{ status: number; code?: string; message?: string }> {
  await iniciar()
  const resposta = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: base, 'X-Workspace-Client': 'local' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const dados = (await resposta.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
  return { status: resposta.status, code: dados.error?.code, message: dados.error?.message }
}

after(() => {
  servidor?.close()
  store.close()
  rmSync(pasta, { recursive: true, force: true })
})

describe('escopo do projeto em todas as rotas /api/projects/:id', () => {
  for (const rota of ['', '/carta', '/leitura-curta', '/entregas', '/licoes', '/lixeira', '/checkpoints', '/board']) {
    test(`token do projeto A não lê ${rota || 'o projeto'} do projeto B (403 forbidden_project_scope)`, async () => {
      const resposta = await pedir(`/api/projects/${projetoB.id}${rota}`)
      assert.equal(resposta.status, 403)
      assert.equal(resposta.code, 'forbidden_project_scope')
      assert.equal(resposta.message, 'Este token não possui permissão para acessar este projeto.')
    })
  }

  test('sem autenticação, sem token restrito ou com token do próprio projeto, pode agir', () => {
    assert.equal(podeAgirNoProjeto(undefined, projetoB.id), true)
    assert.equal(podeAgirNoProjeto({ projectId: null }, projetoB.id), true)
    assert.equal(podeAgirNoProjeto({ projectId: projetoB.id }, projetoB.id), true)
    assert.equal(podeAgirNoProjeto({ projectId: projetoA.id }, projetoB.id), false)
  })

  test('token do projeto A não escreve no projeto B', async () => {
    const resposta = await pedir(`/api/projects/${projetoB.id}/messages`, 'POST', { from: 'Astra', to: '*', kind: 'note', body: 'oi' })
    assert.equal(resposta.status, 403)
    assert.equal(resposta.code, 'forbidden_project_scope')
  })

  test('token do projeto A continua lendo o próprio projeto', async () => {
    for (const rota of ['', '/carta', '/leitura-curta']) {
      const resposta = await pedir(`/api/projects/${projetoA.id}${rota}`)
      assert.equal(resposta.status, 200, `rota ${rota || '/'}`)
    }
  })
})
