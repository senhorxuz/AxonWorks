import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, type TestContext } from 'node:test'
import { ArtifactHashCache, RACY_MARGIN_MS, sha256File, type FileIdentity } from '../server/store/artifact-hash-cache.ts'

// Relógio fixo bem depois dos arquivos "antigos": nenhum deles cai na janela de gravação recente.
const NOW = 10_000_000
const OLD = NOW - 60_000

function identity(over: Partial<FileIdentity> = {}): FileIdentity {
  return { size: 10, mtimeMs: OLD, ctimeMs: OLD, ino: 7, dev: 1, ...over }
}

function countingHasher() {
  const calls: string[] = []
  return {
    calls,
    hashFile: (path: string): string => {
      calls.push(path)
      return `hash-${calls.length}`
    },
  }
}

describe('ArtifactHashCache', () => {
  it('arquivo antigo e idêntico: calcula uma vez e reaproveita nas leituras seguintes', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    assert.equal(cache.sha256('/w/a.ts', identity()), 'hash-1')
    assert.equal(cache.sha256('/w/a.ts', identity()), 'hash-1')
    assert.equal(cache.sha256('/w/a.ts', identity()), 'hash-1')
    assert.deepEqual(h.calls, ['/w/a.ts'])
  })

  for (const [field, value] of [
    ['size', 11],
    ['mtimeMs', OLD + 1],
    ['ctimeMs', OLD + 1],
    ['ino', 8],
    ['dev', 2],
  ] as const) {
    it(`mudança de ${field} recalcula o hash`, () => {
      const h = countingHasher()
      const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
      cache.sha256('/w/a.ts', identity())
      assert.equal(cache.sha256('/w/a.ts', identity({ [field]: value })), 'hash-2')
      assert.equal(h.calls.length, 2)
    })
  }

  it('a identidade nova passa a ser a lembrada: a leitura seguinte com ela reaproveita', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    cache.sha256('/w/a.ts', identity())
    cache.sha256('/w/a.ts', identity({ size: 11 }))
    assert.equal(cache.sha256('/w/a.ts', identity({ size: 11 })), 'hash-2')
    assert.equal(h.calls.length, 2)
  })

  it('caminhos diferentes com a mesma identidade não se confundem', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    assert.equal(cache.sha256('/w/a.ts', identity()), 'hash-1')
    assert.equal(cache.sha256('/w/b.ts', identity()), 'hash-2')
    assert.deepEqual(h.calls, ['/w/a.ts', '/w/b.ts'])
  })

  it('arquivo gravado na janela recente (pela modificação) nunca é lembrado', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    const recent = identity({ mtimeMs: NOW - RACY_MARGIN_MS })
    cache.sha256('/w/a.ts', recent)
    cache.sha256('/w/a.ts', recent)
    assert.equal(h.calls.length, 2)
  })

  it('arquivo alterado na janela recente (pela data de alteração, que ninguém consegue voltar) nunca é lembrado', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    const recent = identity({ ctimeMs: NOW - RACY_MARGIN_MS })
    cache.sha256('/w/a.ts', recent)
    cache.sha256('/w/a.ts', recent)
    assert.equal(h.calls.length, 2)
  })

  it('um milissegundo antes da janela recente já pode ser lembrado', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    const edge = identity({ mtimeMs: NOW - RACY_MARGIN_MS - 1, ctimeMs: NOW - RACY_MARGIN_MS - 1 })
    cache.sha256('/w/a.ts', edge)
    cache.sha256('/w/a.ts', edge)
    assert.equal(h.calls.length, 1)
  })

  it('arquivo com data no futuro (relógio torto) nunca é lembrado', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    const future = identity({ mtimeMs: NOW + 60_000, ctimeMs: NOW + 60_000 })
    cache.sha256('/w/a.ts', future)
    cache.sha256('/w/a.ts', future)
    assert.equal(h.calls.length, 2)
  })

  it('a janela é medida antes de ler: o arquivo recente passa a ser lembrado quando envelhece', () => {
    const h = countingHasher()
    let clock = OLD + 1000
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => clock })
    cache.sha256('/w/a.ts', identity())
    clock = NOW
    cache.sha256('/w/a.ts', identity())
    cache.sha256('/w/a.ts', identity())
    assert.equal(h.calls.length, 2)
  })

  it('gravação durante a leitura: a janela usa o instante de ANTES de ler, não o de depois', () => {
    // O arquivo foi tocado 1 s antes de a leitura começar; a leitura demora 10 s.
    // Medindo depois de ler, ele pareceria velho e seria lembrado por engano.
    let clock = NOW
    const touched = NOW - 1000
    let calls = 0
    const cache = new ArtifactHashCache({
      now: () => clock,
      hashFile: () => {
        calls += 1
        clock += 10_000
        return 'h'
      },
    })
    cache.sha256('/w/a.ts', identity({ mtimeMs: touched, ctimeMs: touched }))
    assert.equal(cache.size, 0)
    cache.sha256('/w/a.ts', identity({ mtimeMs: touched, ctimeMs: touched }))
    assert.equal(calls, 2)
  })

  it('a janela de gravação recente é de pelo menos 2 segundos', () => {
    assert.ok(RACY_MARGIN_MS >= 2000, `RACY_MARGIN_MS caiu para ${RACY_MARGIN_MS}`)
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    const touched = NOW - 1999
    cache.sha256('/w/a.ts', identity({ mtimeMs: touched, ctimeMs: touched }))
    cache.sha256('/w/a.ts', identity({ mtimeMs: touched, ctimeMs: touched }))
    assert.equal(h.calls.length, 2)
  })

  it('sistema de arquivo sem número de arquivo (ino 0) nunca é lembrado', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    cache.sha256('/w/a.ts', identity({ ino: 0 }))
    cache.sha256('/w/a.ts', identity({ ino: 0 }))
    assert.equal(h.calls.length, 2)
    assert.equal(cache.size, 0)
  })

  it('guarda uma cópia da identidade: mexer no objeto de quem chamou depois não altera a lembrança', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    const id = identity()
    cache.sha256('/w/a.ts', id)
    id.size = 999
    cache.sha256('/w/a.ts', identity())
    assert.equal(h.calls.length, 1)
  })

  it('identidade recente depois de uma lembrada apaga a lembrança antiga', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW })
    cache.sha256('/w/a.ts', identity())
    cache.sha256('/w/a.ts', identity({ mtimeMs: NOW, ctimeMs: NOW }))
    assert.equal(cache.size, 0)
    assert.equal(cache.sha256('/w/a.ts', identity()), 'hash-3')
  })

  it('erro de leitura sobe para quem chamou e não deixa lembrança', () => {
    let fail = true
    let calls = 0
    const cache = new ArtifactHashCache({
      now: () => NOW,
      hashFile: () => {
        calls += 1
        if (fail) throw Object.assign(new Error('sem permissão'), { code: 'EACCES' })
        return 'ok'
      },
    })
    assert.throws(() => cache.sha256('/w/a.ts', identity()), /sem permissão/)
    assert.equal(cache.size, 0)
    fail = false
    assert.equal(cache.sha256('/w/a.ts', identity()), 'ok')
    assert.equal(calls, 2)
  })

  it('guarda no máximo maxEntries arquivos e esquece primeiro o usado há mais tempo', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW, maxEntries: 2 })
    cache.sha256('/w/a.ts', identity())
    cache.sha256('/w/b.ts', identity())
    cache.sha256('/w/a.ts', identity()) // a volta a ser o mais recente
    cache.sha256('/w/c.ts', identity()) // b é esquecido
    assert.equal(cache.size, 2)
    assert.deepEqual(h.calls, ['/w/a.ts', '/w/b.ts', '/w/c.ts'])
    cache.sha256('/w/a.ts', identity())
    assert.equal(h.calls.length, 3)
    cache.sha256('/w/b.ts', identity())
    assert.equal(h.calls.length, 4)
  })

  it('recusa maxEntries que não seja inteiro positivo', () => {
    assert.throws(() => new ArtifactHashCache({ maxEntries: 0 }), /maxEntries/)
    assert.throws(() => new ArtifactHashCache({ maxEntries: 1.5 }), /maxEntries/)
  })

  it('aceita maxEntries 1 (o menor valor válido) e lembra só o último arquivo', () => {
    const h = countingHasher()
    const cache = new ArtifactHashCache({ hashFile: h.hashFile, now: () => NOW, maxEntries: 1 })
    cache.sha256('/w/a.ts', identity())
    cache.sha256('/w/b.ts', identity())
    assert.equal(cache.size, 1)
    cache.sha256('/w/b.ts', identity())
    assert.deepEqual(h.calls, ['/w/a.ts', '/w/b.ts'])
  })

  it('sem opções usa o SHA-256 real em blocos e o relógio do sistema', async () => {
    const { mkdtempSync, writeFileSync, rmSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { createHash } = await import('node:crypto')
    const dir = mkdtempSync(join(tmpdir(), 'axon-hash-cache-'))
    try {
      const file = join(dir, 'grande.bin')
      const content = Buffer.alloc(200 * 1024, 7)
      writeFileSync(file, content)
      const s = statSync(file)
      const cache = new ArtifactHashCache()
      const startedAt = Date.now()
      const got = cache.sha256(file, { size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, ino: s.ino, dev: s.dev })
      assert.equal(got, createHash('sha256').update(content).digest('hex'))
      // recém-gravado: o relógio real o põe na janela recente, então não fica lembrado.
      // Só dá para afirmar isso se a máquina não travou mais de 1 s entre gravar e ler.
      if (startedAt - s.mtimeMs < 1000) assert.equal(cache.size, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// `node:fs` e `node:crypto` são trocados só durante o teste; `syncBuiltinESMExports` faz o módulo de
// produção, que importa `readSync` e `createHash` por nome, enxergar a troca (e a volta).
function trocarNoModulo<T extends object, K extends keyof T & string>(t: TestContext, alvo: T, nome: K, troca: T[K]): void {
  t.mock.method(alvo, nome, troca as never)
  syncBuiltinESMExports()
}

function restaurarModulos(t: TestContext): void {
  t.mock.restoreAll()
  syncBuiltinESMExports()
}

/** Cria um arquivo temporário com o conteúdo dado e devolve o caminho; `limpar` apaga a pasta. */
function arquivoTemporario(conteudo: Buffer): { arquivo: string; limpar: () => void } {
  const dir = fs.mkdtempSync(join(tmpdir(), 'axon-sha256file-'))
  const arquivo = join(dir, 'dado.bin')
  fs.writeFileSync(arquivo, conteudo)
  return { arquivo, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

/** O menor descritor livre agora: se algo vazou, o próximo `open` devolve um número maior. */
function proximoDescritorLivre(arquivo: string): number {
  const fd = fs.openSync(arquivo, 'r')
  fs.closeSync(fd)
  return fd
}

describe('sha256File', () => {
  it('lê em blocos de 64 KB reaproveitando um único buffer e devolve o SHA-256 do conteúdo todo', (t) => {
    const bloco = 64 * 1024
    const conteudo = Buffer.alloc(2 * bloco + 10, 3)
    conteudo.fill(9, 2 * bloco) // o resto final tem conteúdo diferente do dos blocos cheios
    const { arquivo, limpar } = arquivoTemporario(conteudo)
    const pedacos: Buffer[] = []
    const tamanhos: number[] = []
    const createHashReal = crypto.createHash
    try {
      trocarNoModulo(t, crypto, 'createHash', ((algoritmo: string) => {
        const hash = createHashReal(algoritmo)
        const updateReal = hash.update.bind(hash)
        hash.update = ((pedaco: Buffer) => {
          pedacos.push(pedaco)
          tamanhos.push(pedaco.length)
          return updateReal(pedaco)
        }) as typeof hash.update
        return hash
      }) as typeof crypto.createHash)
      const got = sha256File(arquivo)
      assert.equal(got, createHashReal('sha256').update(conteudo).digest('hex'))
      assert.deepEqual(tamanhos, [bloco, bloco, 10])
      assert.equal(pedacos[0], pedacos[1], 'os blocos cheios passam pelo mesmo buffer, sem cópia nem buffer novo')
    } finally {
      restaurarModulos(t)
      limpar()
    }
  })

  it('devolve o descritor do arquivo depois de ler', () => {
    const { arquivo, limpar } = arquivoTemporario(Buffer.from('abc'))
    try {
      const antes = proximoDescritorLivre(arquivo)
      sha256File(arquivo)
      assert.equal(proximoDescritorLivre(arquivo), antes, 'o arquivo ficou aberto depois da leitura')
    } finally {
      limpar()
    }
  })

  it('erro no meio da leitura sobe para quem chamou e também devolve o descritor', (t) => {
    const { arquivo, limpar } = arquivoTemporario(Buffer.from('abc'))
    try {
      const antes = proximoDescritorLivre(arquivo)
      trocarNoModulo(t, fs, 'readSync', (() => {
        throw new Error('disco falhou')
      }) as typeof fs.readSync)
      assert.throws(() => sha256File(arquivo), /disco falhou/)
      restaurarModulos(t)
      assert.equal(proximoDescritorLivre(arquivo), antes, 'o arquivo ficou aberto depois do erro')
    } finally {
      restaurarModulos(t)
      limpar()
    }
  })
})
