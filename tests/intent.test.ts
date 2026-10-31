import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findWriteOverlaps, writeLocatorsOverlap, type WorkIntent } from '../shared/intent.js'

const writeFile = (locator: string): WorkIntent => ({
  objective: 'Editar o núcleo',
  areas: [{ kind: 'file_path', locator, access: 'write' }],
  expectedOutputs: ['store.ts atualizado'],
  plannedChecks: ['npm test'],
})

describe('sobreposição de intenção de escrita', () => {
  it('detecta o mesmo arquivo e prefixo de pasta, mas não leitura nem outro tipo', () => {
    assert.equal(
      writeLocatorsOverlap(
        { kind: 'file_path', locator: 'src\\lib\\store.ts', access: 'write' },
        { kind: 'file_path', locator: 'src/lib/store.ts', access: 'write' },
      ),
      true,
    )
    assert.equal(
      writeLocatorsOverlap(
        { kind: 'file_path', locator: 'src/lib', access: 'write' },
        { kind: 'file_path', locator: 'src/lib/store.ts', access: 'write' },
      ),
      true,
    )
    assert.equal(
      writeLocatorsOverlap(
        { kind: 'file_path', locator: 'src/lib/store.ts', access: 'write' },
        { kind: 'file_path', locator: 'src/lib/store.ts', access: 'read' },
      ),
      false,
    )
    assert.equal(
      writeLocatorsOverlap(
        { kind: 'file_path', locator: 'contrato', access: 'write' },
        { kind: 'content_item', locator: 'contrato', access: 'write' },
      ),
      false,
    )
  })

  it('explica o aviso sem tratar como lock', () => {
    const overlaps = findWriteOverlaps(
      { taskId: 'a', title: 'Núcleo', agent: 'alfa', intent: writeFile('server/store.ts') },
      [{ taskId: 'b', title: 'Testes', agent: 'beta', intent: writeFile('server/store.ts') }],
    )
    assert.equal(overlaps.length, 1)
    assert.equal(overlaps[0]?.otherTaskId, 'b')
    assert.match(overlaps[0]?.explanation ?? '', /não é um lock/i)
  })
})
