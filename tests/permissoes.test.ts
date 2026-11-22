import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Request, Response } from 'express'
import { conferirPermissaoDoToken, exigirAdministrador } from '../server/auth/permissoes.js'
import { DomainError } from '../server/store/errors.js'
import type { TokenRole } from '../shared/auth.js'

test('o papel de um token novo nunca ultrapassa o papel de quem pede', () => {
  const papeis: TokenRole[] = ['observer', 'agent', 'collaborator', 'owner']
  for (const [nivel, role] of papeis.entries()) {
    for (const [nivelPedido, papelPedido] of papeis.entries()) {
      const conferir = () => conferirPermissaoDoToken({ role }, papelPedido, null)
      if (nivelPedido <= nivel) assert.doesNotThrow(conferir)
      else assert.throws(conferir, (e) => e instanceof DomainError && e.status === 403 &&
        e.code === 'token_maior_que_quem_pede' && e.message === 'O token não pode ter um papel maior que o de quem o solicita.')
    }
  }
})

test('um token novo preserva o projeto de quem tem escopo', () => {
  const auth = { role: 'owner' as const, projectId: 'projeto-a' }
  assert.doesNotThrow(() => conferirPermissaoDoToken(auth, 'agent', 'projeto-a'))
  assert.doesNotThrow(() => conferirPermissaoDoToken({ role: 'owner', projectId: null }, 'agent', 'projeto-b'))
  for (const projeto of ['projeto-b', undefined, null]) {
    assert.throws(() => conferirPermissaoDoToken(auth, 'agent', projeto), (e) =>
      e instanceof DomainError && e.status === 403 && e.code === 'forbidden_project_scope' &&
      e.message === 'O token deve pertencer ao mesmo projeto de quem o solicita.')
  }
})

test('só quem administra passa: dono sem escopo e que não é agente', () => {
  const passa = (auth: unknown) => {
    let continuou = false
    try {
      exigirAdministrador({ auth } as Request, {} as Response, () => { continuou = true })
    } catch (e) {
      assert.ok(e instanceof DomainError && e.status === 403 && e.code === 'so_quem_administra' &&
        e.message === 'Só quem administra a Axon pode fazer isso.')
    }
    return continuou
  }
  assert.equal(passa({ role: 'owner', actorType: 'user', projectId: null }), true)
  assert.equal(passa(undefined), false)
  assert.equal(passa({ role: 'owner', actorType: 'agent', projectId: null }), false)
  assert.equal(passa({ role: 'collaborator', actorType: 'user', projectId: null }), false)
  assert.equal(passa({ role: 'owner', actorType: 'user', projectId: 'projeto-a' }), false)
})
