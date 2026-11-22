import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evidenciasDoRegistro, rotuloDoDetalhe } from '../src/checkpoints/evidencias.ts'
import type { Checkpoint, EvidenceView } from '../shared/types.ts'

const registro = (id: string, evidence: Array<{ command: string; outcome: string; details?: string }> = []) =>
  ({ id, projectId: 'p', agent: 'Astra', createdAt: '2026-11-22T12:00:00Z', evidence }) as unknown as Checkpoint
const visao = (id: string, checkpointId: string, extra: Partial<EvidenceView> = {}) => ({ id, checkpointId, command: `cmd-${id}`, position: 0, ...extra }) as EvidenceView

describe('evidenciasDoRegistro', () => {
  it('usa as evidências que o servidor ligou a este registro', () => {
    const r = evidenciasDoRegistro(registro('a'), [visao('1', 'a'), visao('2', 'b'), visao('3', 'a')])
    assert.deepEqual(r.map(v => v.id), ['1', '3'])
  })
  it('registro sem evidência não herda a evidência de outros registros (o desvio que inchava a página)', () => {
    assert.deepEqual(evidenciasDoRegistro(registro('a'), [visao('1', 'b'), visao('2', 'c')]), [])
  })
  it('sem visão ligada, monta a evidência a partir do que o registro declarou', () => {
    const r = evidenciasDoRegistro(registro('a', [{ command: 'npm test', outcome: 'passed', details: '10 ok' }]), [])
    assert.equal(r.length, 1)
    assert.deepEqual({ id: r[0]!.id, command: r[0]!.command, outcome: r[0]!.outcome, details: r[0]!.details, reportedBy: r[0]!.reportedBy, freshness: r[0]!.freshness },
      { id: 'ev-a-0', command: 'npm test', outcome: 'passed', details: '10 ok', reportedBy: 'Astra', freshness: 'no_artifacts' })
    assert.deepEqual(r[0]!.assertions, ['agent_reported'])
  })
  it('a declarada se liga à visão do servidor pelo comando ou pela posição', () => {
    const doServidor = visao('srv', 'outro', { command: 'npm test', position: 7 })
    const r = evidenciasDoRegistro(registro('a', [{ command: 'npm test', outcome: 'passed' }]), [doServidor])
    assert.equal(r[0], doServidor)
    const porPosicao = visao('pos', 'outro', { command: 'x', position: 0 })
    assert.equal(evidenciasDoRegistro(registro('a', [{ command: 'y', outcome: 'passed' }]), [porPosicao])[0], porPosicao)
  })
})

describe('rotuloDoDetalhe', () => {
  it('fechado mostra quantas evidências há; aberto oferece ocultar', () => {
    assert.equal(rotuloDoDetalhe(false, 3), 'Ver detalhes e evidências (3)')
    assert.equal(rotuloDoDetalhe(false, 0), 'Ver detalhes')
    assert.equal(rotuloDoDetalhe(true, 3), 'Ocultar detalhes')
  })
})

describe('evidenciasDoRegistro: a evidência declarada', () => {
  it('sem nenhuma ligada, monta a declarada com os campos vazios que a tela espera', () => {
    const r = evidenciasDoRegistro(registro('a', [{ command: 'npm test', outcome: 'passed', details: '10 ok' }]), [])
    assert.deepEqual(r, [{
      id: 'ev-a-0', projectId: 'p', checkpointId: 'a', position: 0, command: 'npm test', outcome: 'passed', details: '10 ok',
      reportedBy: 'Astra', provenance: 'agent_report', createdAt: '2026-11-22T12:00:00Z', assertions: ['agent_reported'],
      freshness: 'no_artifacts', explanation: '', artifacts: [], verifications: [],
    }])
  })
  it('a vista de outro registro só entra se bater por comando ou posição; a primeira da lista não vale por ser a primeira', () => {
    const estranha = visao('x', 'outro', { command: 'outro-comando', position: 5 })
    const certa = visao('y', 'outro', { command: 'npm test', position: 9 })
    const r = evidenciasDoRegistro(registro('a', [{ command: 'npm test', outcome: 'passed' }]), [estranha, certa])
    assert.equal(r[0], certa)
    const semPar = evidenciasDoRegistro(registro('a', [{ command: 'npm test', outcome: 'passed' }]), [estranha])
    assert.equal(semPar[0].id, 'ev-a-0')
  })
})
