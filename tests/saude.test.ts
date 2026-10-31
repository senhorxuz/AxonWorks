import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createApp } from '../server/app.ts'
import { WorkspaceStore } from '../server/store.ts'

/**
 * `/api/health` diz também quem é o servidor (`pid`) e quando subiu (`iniciadoEm`, ISO). O atalho da Área de
 * Trabalho usa os dois para saber se o servidor que já está de pé roda código mais velho que o atual e, se for,
 * reiniciá-lo (a regra está em `scripts/abrir-axon-decisao.ts`).
 */

test('GET /api/health devolve o pid do processo e a hora em que ele subiu, além do que já devolvia', async (t) => {
  const store = new WorkspaceStore(':memory:')
  const server = createServer(createApp(store))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('endereço inválido')
  const host = `127.0.0.1:${address.port}`

  const antes = Date.now()
  const resposta = await fetch(`http://${host}/api/health`, { headers: { Host: host } })
  const depois = Date.now()
  assert.equal(resposta.status, 200)
  const corpo = await resposta.json() as { status: string; mode: string; version: string; pid: number; iniciadoEm: string }
  assert.equal(corpo.status, 'ok')
  assert.equal(corpo.mode, 'local')
  assert.equal(corpo.version, '0.1.0')
  assert.equal(corpo.pid, process.pid)

  assert.match(corpo.iniciadoEm, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  const iniciadoEmMs = Date.parse(corpo.iniciadoEm)
  // Subiu junto com o processo: não depois de agora, e não antes do começo do processo (com uma folga de 2 s para o relógio).
  assert.ok(iniciadoEmMs <= antes, `iniciadoEm ${corpo.iniciadoEm} vem depois do pedido`)
  assert.ok(iniciadoEmMs >= antes - process.uptime() * 1000 - 2000, `iniciadoEm ${corpo.iniciadoEm} vem antes de o processo existir`)
  assert.ok(depois >= antes)

  // É a hora em que o processo subiu, não a hora do pedido: um segundo pedido devolve a mesma.
  const outra = await fetch(`http://${host}/api/health`, { headers: { Host: host } })
  assert.equal(((await outra.json()) as { iniciadoEm: string }).iniciadoEm, corpo.iniciadoEm)
})
