import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'

/**
 * Lembrança, só em memória, do SHA-256 de cada arquivo apontado por uma evidência.
 *
 * O frescor continua sendo calculado na leitura: o que muda é que um arquivo cuja identidade no
 * disco não mudou desde a última conta não é relido inteiro. A identidade é o conjunto
 * tamanho + data de modificação + data de alteração + número do arquivo + disco. A data de
 * alteração (ctime) não pode ser voltada pelas formas comuns de editar arquivo, então "editar e
 * devolver a data de modificação antiga" também força a releitura (conferido no NTFS em 25/10/2026:
 * utimes, cópia com datas preservadas, rename e regravação com o arquivo aberto mudam a identidade).
 *
 * Proteção contra gravação recente (a mesma ideia do "racy git"): duas gravações no mesmo tique do
 * relógio do disco, com o mesmo tamanho, deixariam a identidade igual. Por isso um arquivo
 * modificado ou alterado nos últimos RACY_MARGIN_MS antes da leitura nunca é lembrado: ele é
 * relido em toda consulta até envelhecer. O instante usado é o de ANTES da leitura.
 *
 * Limites conhecidos: a garantia depende de o sistema de arquivos ter uma data de alteração real e
 * um número de arquivo. FAT/exFAT, compartilhamentos de rede (SMB, NFS com atributos em cache,
 * 9p, FUSE) e ferramentas feitas para falsificar datas podem quebrar isso. Arquivo com número 0
 * (sinal de sistema de arquivos sem esse dado) nunca é lembrado. A Axon espera a pasta dos projetos
 * em disco local (NTFS no PC, ext4 na VPS).
 *
 * Nada é gravado no banco nem no disco. Cada processo (o servidor HTTP e cada sessão MCP) tem a sua.
 */

export interface FileIdentity {
  size: number
  mtimeMs: number
  ctimeMs: number
  ino: number
  dev: number
}

export interface ArtifactHashCacheOptions {
  /** Quem lê o arquivo e devolve o SHA-256 em hexadecimal. Padrão: `sha256File`. */
  hashFile?: (path: string) => string
  /** Relógio em milissegundos usado para a janela de gravação recente. Padrão: `Date.now`. */
  now?: () => number
  /** Quantos arquivos lembrar no máximo; o usado há mais tempo é esquecido primeiro. */
  maxEntries?: number
}

/** Janela em que um arquivo recém-gravado não é lembrado. Cobre também discos com relógio de 2 s (FAT). */
export const RACY_MARGIN_MS = 2000

export const DEFAULT_MAX_ENTRIES = 10_000

/** Tamanho do buffer reutilizado por `sha256File`. Não é um teto de tamanho de arquivo: é só o pedaço lido por vez. */
const HASH_STREAM_CHUNK_BYTES = 64 * 1024 // 64 KB

/**
 * Calcula o SHA-256 de um arquivo em streaming, em blocos de tamanho fixo, com uso de memória
 * constante (um único buffer reutilizado) independentemente do tamanho do arquivo.
 */
export function sha256File(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(HASH_STREAM_CHUNK_BYTES)
    let bytesRead: number
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}

interface Entry {
  identity: FileIdentity
  sha256: string
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev
}

export class ArtifactHashCache {
  private readonly entries = new Map<string, Entry>()
  private readonly hashFile: (path: string) => string
  private readonly now: () => number
  private readonly maxEntries: number

  constructor(options: ArtifactHashCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries deve ser um inteiro positivo.')
    }
    this.hashFile = options.hashFile ?? sha256File
    this.now = options.now ?? Date.now
    this.maxEntries = maxEntries
  }

  /** Quantos arquivos estão lembrados agora. */
  get size(): number {
    return this.entries.size
  }

  /**
   * SHA-256 do arquivo em `path`, cuja identidade no disco foi lida por quem chama logo antes.
   * Erros de leitura sobem sem deixar lembrança.
   */
  sha256(path: string, identity: FileIdentity): string {
    const cached = this.entries.get(path)
    if (cached && sameIdentity(cached.identity, identity)) {
      // Reinsere para marcar como usado agora (a ordem do Map é a ordem de esquecimento).
      this.entries.delete(path)
      this.entries.set(path, cached)
      return cached.sha256
    }
    this.entries.delete(path)
    // A janela é medida ANTES da leitura: uma gravação durante a leitura cai dentro dela.
    const startedAt = this.now()
    const sha256 = this.hashFile(path)
    const settled = Math.max(identity.mtimeMs, identity.ctimeMs) < startedAt - RACY_MARGIN_MS
    if (settled && identity.ino !== 0) {
      this.entries.set(path, { identity: { ...identity }, sha256 })
      if (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value as string
        this.entries.delete(oldest)
      }
    }
    return sha256
  }
}
