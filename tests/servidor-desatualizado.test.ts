import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import { createApp } from '../server/app.ts'
import { WorkspaceStore } from '../server/store.ts'
import { ApiError, errorText } from '../src/api.ts'

/**
 * Quando a tela é mais nova que o servidor aberto, a rota da tela ainda não existe.
 * O dono precisa ler o que fazer, não "Rota não encontrada".
 */

test('rota da API que não existe responde com código próprio, diferente de "registro não encontrado"', async (t) => {
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

  const resposta = await fetch(`http://${host}/api/esta-rota-nao-existe`, { headers: { Host: host, Origin: `http://${host}` } })
  assert.equal(resposta.status, 404)
  const corpo = await resposta.json() as { error: { code: string; message: string } }
  assert.equal(corpo.error.code, 'route_not_found')

  // Registro que não existe continua com o código de sempre.
  const projeto = await fetch(`http://${host}/api/projects/00000000-0000-4000-8000-000000000000`, { headers: { Host: host, Origin: `http://${host}` } })
  assert.equal(projeto.status, 404)
  assert.equal((await projeto.json() as { error: { code: string } }).error.code, 'not_found')
})

test('a tela traduz "rota não encontrada" em uma instrução simples', () => {
  assert.equal(
    errorText(new ApiError('Rota não encontrada.', 404, 'route_not_found')),
    'Esta parte da Axon é mais nova que o servidor que está aberto. Feche a Axon e abra de novo para carregar a versão atual.',
  )
  // Outros erros continuam com a mensagem do servidor.
  assert.equal(errorText(new ApiError('Cartão não encontrado neste projeto.', 404, 'not_found')), 'Cartão não encontrado neste projeto.')
})

test('o servidor de desenvolvimento recarrega sozinho quando o código do servidor muda', () => {
  const pacote = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  assert.match(pacote.scripts.dev!, /^tsx watch\b/)
})
