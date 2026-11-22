import assert from 'node:assert/strict'
import { test } from 'node:test'
import { leituraDaEvidencia } from '../server/store/evidencia-esperada.ts'

const casos = [
  ['falhar', 'failed', 'Falhou como esperado (fase vermelha)'],
  ['passar', 'passed', 'Passou como esperado'],
  ['passar', 'failed', 'Falhou sem esperar'],
  ['falhar', 'passed', 'Passou quando devia falhar'],
  [undefined, 'failed', 'falhou'],
] as const

for (const [esperado, outcome, texto] of casos) {
  test(`${esperado ?? 'sem esperado'} × ${outcome}, com versão e ambiente`, () => {
    const evidencia = { esperado, outcome }
    assert.equal(leituraDaEvidencia(evidencia), texto)
    assert.equal(leituraDaEvidencia({ ...evidencia, versao: 'a1b2c3d', ambiente: 'prévia' }),
      `${texto.charAt(0).toUpperCase()}${texto.slice(1)} na prévia do commit a1b2c3d`)
  })
}

test('conserva cada resultado antigo quando o contexto está ausente', () => {
  assert.equal(leituraDaEvidencia({ outcome: 'passed' }), 'passou')
  assert.equal(leituraDaEvidencia({ outcome: 'failed' }), 'falhou')
  assert.equal(leituraDaEvidencia({ outcome: 'not_run' }), 'não rodou')
})

test('uma expectativa pode acompanhar um teste que ainda não rodou', () => {
  assert.equal(leituraDaEvidencia({ esperado: 'passar', outcome: 'not_run' }), 'não rodou')
  assert.equal(leituraDaEvidencia({ esperado: 'falhar', outcome: 'not_run' }), 'não rodou')
})

test('versão e ambiente também podem aparecer independentemente', () => {
  assert.equal(leituraDaEvidencia({ outcome: 'passed', versao: 'a1b2c3d' }), 'Passou no commit a1b2c3d')
  assert.equal(leituraDaEvidencia({ outcome: 'failed', ambiente: 'staging' }), 'Falhou no ambiente staging')
})
