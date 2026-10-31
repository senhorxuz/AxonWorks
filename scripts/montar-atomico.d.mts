/** Tipos de `montar-atomico.mjs` (o código é JavaScript puro para o `node` rodar sem tsx; os testes e o `tsc` leem estes tipos). */

export const PASTA_PADRAO: string
export const VARIAVEL_DE_SAIDA: string
export const MAXIMO_DE_REPETICOES: number
export const ESPERA_BASE_MS: number

export type VereditoDaTroca = 'repetir' | 'em-uso' | 'outra'

export interface EntradaDaSaida {
  argv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
  raiz: string
  cwd: string
}

export interface DiscoDaTroca {
  renomear(origem: string, destino: string): Promise<void>
  esperar(ms: number): Promise<void>
  plataforma: string
}

export function resolverPastaDeSaida(entrada: EntradaDaSaida): string
export function pastaTemporariaDe(saida: string, pid: number): string
export function classificarFalhaDeTroca(falha: { codigo: string | undefined; tentativa: number; plataforma: string }): VereditoDaTroca
export function esperaDaTentativa(tentativa: number): number
export function mensagemDeArquivoEmUso(arquivo: string): string

export class ArquivoEmUsoError extends Error {
  readonly code: 'ARQUIVO_EM_USO'
  readonly arquivo: string
  constructor(arquivo: string, causa?: unknown)
}

export function ordenarParaTroca(nomes: readonly string[]): string[]
export function renomearComTentativas(pedido: { origem: string; destino: string } & DiscoDaTroca, tentativa?: number): Promise<void>
export function trocarArquivos(pedido: { de: string; para: string; nomes: readonly string[] } & DiscoDaTroca): Promise<void>
export function apagarPastaTemporaria(pasta: string, io: { apagar(pasta: string): Promise<void>; avisar(texto: string): void }): Promise<void>
export function caminhoParaMostrar(raiz: string, arquivo: string): string
