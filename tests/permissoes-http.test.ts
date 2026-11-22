import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApp } from '../server/app.js'
import { WorkspaceStore } from '../server/store.js'

test('rotas globais respeitam o administrador e o escopo do token', async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'axon-permissoes-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  let instante = 0
  const store = new WorkspaceStore(':memory:', { now: () => new Date(Date.UTC(2026, 10, 21) + instante++) })
  t.after(() => store.close())
  const outro = store.createProject({ name: 'Projeto de fora', objective: 'Contexto de fora' })
  const proprio = store.createProject({ name: 'Projeto do token', objective: 'Contexto próprio' })
  for (let i = 0; i < 100; i++) store.createTask(outro.id, { title: `Verificar ${i}` })
  store.createTask(proprio.id, { title: 'Verificar o cronograma' })
  store.saveCheckpoint(outro.id, {
    agent: 'Teste', expectedRevision: store.getProject(outro.id).project.revision,
    idempotencyKey: 'fora-do-escopo', summary: 'Resumo de fora', nextStep: 'Verificar outro registro',
  })
  store.saveCheckpoint(proprio.id, {
    agent: 'Teste', expectedRevision: store.getProject(proprio.id).project.revision,
    idempotencyKey: 'permissoes', summary: 'Verificar o registro', nextStep: 'Conferir',
  })
  store.postMessage(proprio.id, { from: 'Teste', to: '*', kind: 'note', body: 'Verificar a mensagem' })
  store.postMessage(outro.id, { from: 'Teste', to: '*', kind: 'note', body: 'Verificar outra mensagem' })
  const restrito = store.createAuthToken({ name: 'Restrito', tokenType: 'agent', role: 'observer', projectId: proprio.id })
  const donoComEscopo = store.createAuthToken({ name: 'Dono com escopo', tokenType: 'user_session', role: 'owner', projectId: proprio.id })
  const agenteDono = store.createAuthToken({ name: 'Agente', tokenType: 'agent', role: 'owner' })
  const leitor = store.createAuthToken({ name: 'Leitor', tokenType: 'user_session', role: 'observer' })
  const dono = store.createAuthToken({ name: 'Dono', tokenType: 'user_session', role: 'owner' })
  const backupAnterior = process.env.AXON_BACKUP_DIR
  process.env.AXON_BACKUP_DIR = join(pasta, 'backups')
  t.after(() => {
    if (backupAnterior === undefined) delete process.env.AXON_BACKUP_DIR
    else process.env.AXON_BACKUP_DIR = backupAnterior
  })
  const app = createApp(store)
  const servidor = app.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve) => servidor.close(() => resolve())))
  await new Promise<void>((resolve, reject) => servidor.once('listening', resolve).once('error', reject))
  const endereco = servidor.address()
  assert.ok(endereco && typeof endereco !== 'string')
  const base = `http://127.0.0.1:${endereco.port}`

  async function pedir(caminho: string, status: number, opcoes: { token?: string; corpo?: unknown; code?: string; local?: boolean } = {}) {
    const { token, corpo, code, local = true } = opcoes
    const resposta = await fetch(base + caminho, {
      method: corpo === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: {
        'Content-Type': 'application/json', Origin: base,
        ...(local ? { 'X-Workspace-Client': 'local' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
    const dados = await resposta.json()
    assert.equal(resposta.status, status, caminho)
    if (code) assert.equal(dados.error?.code, code, caminho)
    if (code === 'so_quem_administra') assert.equal(dados.error?.message, 'Só quem administra a Axon pode fazer isso.')
    if (code === 'forbidden_project_scope') assert.equal(dados.error?.message, 'Este token está restrito a um projeto e não pode importar outro.')
    return dados
  }

  await t.test('lista e busca só no projeto autorizado, antes do limite de resultados', async () => {
    assert.deepEqual(await pedir('/api/projects', 200, restrito), [store.getProject(proprio.id).project])
    const projetos = await pedir('/api/search?q=Projeto', 200, restrito)
    assert.deepEqual(projetos.map(({ projectId }: { projectId: string }) => projectId), [proprio.id])
    const registros = await pedir('/api/search?q=Verificar', 200, restrito)
    assert.deepEqual(registros.map(({ kind, projectId }: { kind: string; projectId: string }) => [kind, projectId]),
      [['task', proprio.id], ['checkpoint', proprio.id], ['message', proprio.id]])
    assert.equal((await pedir('/api/projects', 200, { local: false })).length, 2)
    assert.equal((await pedir('/api/search?q=Verificar', 200, { local: false })).length, 100)
  })

  // Importar cria projeto na Axon: só quem administra (dono, sem escopo, não agente). Revisão de segurança de 21/11/2026.
  await t.test('só quem administra importa; o dono local chega à validação do pacote', async () => {
    for (const { token } of [restrito, donoComEscopo, agenteDono, leitor]) {
      await pedir('/api/import', 403, { token, corpo: {}, code: 'so_quem_administra' })
    }
    await pedir('/api/import', 400, { corpo: {} })
  })

  await t.test('só administrador cria, lista e revoga tokens', async () => {
    const caminho = '/api/auth/tokens'
    for (const { token } of [restrito, donoComEscopo, agenteDono, leitor]) {
      const erro = { token, code: 'so_quem_administra' }
      await pedir(caminho, 403, { ...erro, corpo: {} })
      await pedir(caminho, 403, erro)
      await pedir(`${caminho}/${restrito.tokenInfo.id}/revoke`, 403, { ...erro, corpo: {} })
    }
    const criado = await pedir(caminho, 201, { corpo: { name: 'Pela tela local', tokenType: 'agent', role: 'agent', projectId: proprio.id } })
    assert.equal(criado.tokenInfo.projectId, proprio.id)
    const revogado = await pedir(`${caminho}/${criado.tokenInfo.id}/revoke`, 200, { corpo: {} })
    assert.equal(revogado.revokedBy, 'local-operator')
    assert.ok(Array.isArray(await pedir(caminho, 200, dono)))
    await pedir(caminho, 400, {
      ...dono, code: 'invalid_token_role', corpo: { name: 'Inválido', tokenType: 'agent', role: { toString: {} } },
    })
  })

  await t.test('só administrador lê a auditoria, inclusive quando pede outro projeto', async () => {
    const code = 'so_quem_administra'
    const auditoria = `/api/audit-logs?projectId=${outro.id}`
    await pedir(auditoria, 403, { ...restrito, code })
    await pedir('/api/audit-logs', 403, { ...agenteDono, code })
    await pedir('/api/audit-logs', 403, { local: false, code })
    assert.deepEqual(await pedir(auditoria, 200, dono), [])
  })

  await t.test('só administrador cria ou restaura backups', async () => {
    for (const rota of ['/api/backups', '/api/backups/inexistente/restore']) {
      await pedir(rota, 403, { token: restrito.token, code: 'so_quem_administra', corpo: {} })
    }
  })

  // Segunda revisão de 21/11/2026: rotas que ainda abriam para qualquer token.
  await t.test('só administrador lê backups, roda o ensaio de recuperação, lista contas e revoga dispositivo', async () => {
    const leituras = ['/api/backups', '/api/backups/drills', '/api/backups/inexistente', '/api/auth/accounts']
    const escritas = ['/api/backups/drill', '/api/backups/inexistente/drill', '/api/devices/inexistente/revoke']
    for (const { token } of [restrito, donoComEscopo, agenteDono, leitor]) {
      for (const rota of leituras) await pedir(rota, 403, { token, code: 'so_quem_administra' })
      for (const rota of escritas) await pedir(rota, 403, { token, code: 'so_quem_administra', corpo: {} })
    }
    assert.ok(Array.isArray(await pedir('/api/backups', 200, {})))
    assert.ok(Array.isArray(await pedir('/api/auth/accounts', 200, {})))
  })
})
