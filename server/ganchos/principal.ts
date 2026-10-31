// Entrada do programa dos ganchos do Claude Code: lê a entrada padrão e o ambiente, chama a ação do
// evento e garante que a sessão nunca é atrapalhada (qualquer erro: saída vazia, código 0).
// Lê o banco direto, como o MCP, sem precisar do servidor HTTP ligado.
// Na abertura da sessão, o programa também lê o git da pasta (lote 2, D1) antes de montar a retomada:
// é o único passo que espera (até `LIMITE_DO_GIT_MS`), e qualquer falha dele só tira o aviso.
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { dbPath as dbPathDaConfiguracao } from '../config.js'
import { WorkspaceStore } from '../store.js'
import { normalizarPasta } from './achar-projeto.js'
import {
  aoAbrir,
  aoCompactar,
  aoFechar,
  aoResponder,
  gitDaAbertura,
  type Ambiente,
  type EntradaDoGancho,
  type LerGit,
} from './acoes.js'
import { lerEstadoDoGit } from './git.js'

/** Quanto se espera pela entrada padrão antes de desistir (o Claude Code manda tudo de uma vez). */
export const ESPERA_DA_ENTRADA_MS = 1000
/**
 * Espera por trava do banco, só neste programa (o servidor e o MCP esperam 5 s). Medido no Windows:
 * com o banco em WAL (o da Axon), a leitura nunca espera e uma escrita barrada desiste em ~1,7 vez
 * a espera; com o banco inteiro travado, qualquer espera acima de 1 ms custa ~1,5 s.
 * Abrir a sessão e responder só precisam ler: não esperam. Compactar e fechar gravam o rascunho:
 * esperam um pouco (ganchos com tempo-limite de 10 s e 30 s no Claude Code).
 */
export const ESPERA_DE_LEITURA_MS = 0
export const ESPERA_DE_GRAVACAO_MS = 250
/** Entrada maior que isto não é de gancho: é largada. */
export const TAMANHO_MAXIMO_DA_ENTRADA = 4 * 1024 * 1024

interface Acao {
  executar: (e: EntradaDoGancho, a: Ambiente) => string
  esperaDeTravaMs: number
}

const ACOES = new Map<string, Acao>([
  ['SessionStart', { executar: aoAbrir, esperaDeTravaMs: ESPERA_DE_LEITURA_MS }],
  ['Stop', { executar: aoResponder, esperaDeTravaMs: ESPERA_DE_LEITURA_MS }],
  ['PostCompact', { executar: aoCompactar, esperaDeTravaMs: ESPERA_DE_GRAVACAO_MS }],
  ['SessionEnd', { executar: aoFechar, esperaDeTravaMs: ESPERA_DE_GRAVACAO_MS }],
])

// ---------------------------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------------------------

function textoOuAusente(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined
}

/** JSON do gancho; sem `hook_event_name` e `session_id` em texto, não é entrada de gancho (null). */
export function interpretarEntrada(texto: string): EntradaDoGancho | null {
  let valor: unknown
  try {
    valor = JSON.parse(texto)
  } catch {
    return null
  }
  // Só `null` precisa de cuidado: texto, número ou lista não têm os campos e caem na conferência abaixo.
  if (valor === null) return null
  const r = valor as Record<string, unknown>
  if (typeof r.hook_event_name !== 'string' || typeof r.session_id !== 'string') return null
  return {
    hook_event_name: r.hook_event_name,
    session_id: r.session_id,
    transcript_path: textoOuAusente(r.transcript_path),
    cwd: textoOuAusente(r.cwd),
    source: textoOuAusente(r.source),
    compact_summary: textoOuAusente(r.compact_summary),
  }
}

/** `CLAUDE_PROJECT_DIR` (raiz onde a sessão começou) vence o `cwd`, que muda durante a sessão. */
export function escolherPasta(doAmbiente: string | undefined, cwd: string | undefined): string {
  return doAmbiente || cwd || ''
}

export function dirDosMarcadores(dbPath: string): string {
  return join(dirname(dbPath), 'ganchos', 'sessoes')
}

// ---------------------------------------------------------------------------------------------
// Execução protegida
// ---------------------------------------------------------------------------------------------

export interface OpcoesDoGancho {
  dbPath: string
  pastaDoAmbiente?: string
  agora?: () => Date
}

/**
 * Antes de abrir o store (que cria o banco se faltar e migra o esquema), confere só lendo que ali
 * está um banco da Axon legível. Banco ausente, sem a tabela de projetos ou travado: lança, e
 * nada é criado nem alterado. A sonda é sempre fechada.
 */
function sondarBanco(dbPath: string, esperaMs: number): void {
  const sonda = new DatabaseSync(dbPath, { readOnly: true, timeout: esperaMs })
  try {
    sonda.prepare('SELECT 1 FROM projects LIMIT 1').get()
  } finally {
    sonda.close()
  }
}

interface Pedido {
  e: EntradaDoGancho
  acao: Acao
  pasta: string
}

/** Entrada que não é de gancho, evento que a Axon não trata ou sessão sem pasta: nada a fazer (null). */
function lerPedido(textoDaEntrada: string, opcoes: OpcoesDoGancho): Pedido | null {
  const e = interpretarEntrada(textoDaEntrada)
  if (e === null) return null
  const acao = ACOES.get(e.hook_event_name)
  const pasta = escolherPasta(opcoes.pastaDoAmbiente, e.cwd)
  if (acao === undefined || pasta === '') return null
  return { e, acao, pasta }
}

/** Abre o store do pedido (depois de sondar o banco). Quem chama fecha `store`. */
function abrirAmbiente(pedido: Pedido, opcoes: OpcoesDoGancho): Ambiente {
  const espera = pedido.acao.esperaDeTravaMs
  sondarBanco(opcoes.dbPath, espera)
  return {
    store: new WorkspaceStore(opcoes.dbPath, { busyTimeoutMs: espera }),
    pastaDoProjeto: pedido.pasta,
    dirMarcadores: dirDosMarcadores(opcoes.dbPath),
    agora: opcoes.agora ?? (() => new Date()),
  }
}

function despacharPedido(pedido: Pedido, opcoes: OpcoesDoGancho): string {
  const ambiente = abrirAmbiente(pedido, opcoes)
  try {
    return pedido.acao.executar(pedido.e, ambiente)
  } finally {
    ambiente.store.close()
  }
}

/**
 * Sem a rede de proteção: entrada sem nada a fazer devolve '' sem tocar o banco; só falha de verdade
 * (banco ausente, travado, ilegível) lança. Quem chama de fora usa `executarGancho`.
 */
export function despachar(textoDaEntrada: string, opcoes: OpcoesDoGancho): string {
  const pedido = lerPedido(textoDaEntrada, opcoes)
  return pedido === null ? '' : despacharPedido(pedido, opcoes)
}

/**
 * Como `despachar`, mas a abertura da sessão lê antes o git da pasta (D1) com o store aberto. Os
 * outros eventos seguem o caminho de sempre, sem git. Também sem a rede de proteção (quem chama de
 * fora usa `executarGanchoComGit`).
 */
export async function despacharComGit(textoDaEntrada: string, opcoes: OpcoesDoGancho, lerGit: LerGit): Promise<string> {
  const pedido = lerPedido(textoDaEntrada, opcoes)
  if (pedido === null) return ''
  if (pedido.e.hook_event_name !== 'SessionStart') return despacharPedido(pedido, opcoes)
  const ambiente = abrirAmbiente(pedido, opcoes)
  try {
    const git = await gitDaAbertura(ambiente, lerGit)
    return pedido.acao.executar(pedido.e, { ...ambiente, git })
  } finally {
    ambiente.store.close()
  }
}

/** O git de verdade (`git.ts`): processos filhos com tempo-limite, `null` em qualquer falha. */
const lerGitDeVerdade: LerGit = (pasta, desde) => lerEstadoDoGit(pasta, desde)

/** Nunca lança: qualquer erro (banco travado ou ausente, arquivo sem permissão, entrada estranha) vira ''. */
export function executarGancho(textoDaEntrada: string, opcoes: OpcoesDoGancho): string {
  try {
    return despachar(textoDaEntrada, opcoes)
  } catch {
    return ''
  }
}

/** O que o programa roda: `executarGancho` com o git na abertura da sessão. Nunca rejeita. */
export async function executarGanchoComGit(
  textoDaEntrada: string,
  opcoes: OpcoesDoGancho,
  lerGit: LerGit = lerGitDeVerdade,
): Promise<string> {
  try {
    return await despacharComGit(textoDaEntrada, opcoes, lerGit)
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------------------------
// Processo
// ---------------------------------------------------------------------------------------------

/** Lê a entrada inteira como UTF-8. Terminal, erro, demora ou tamanho demais: ''. */
export function lerEntrada(
  fluxo: Readable & { isTTY?: boolean },
  esperaMs: number = ESPERA_DA_ENTRADA_MS,
  tamanhoMaximo: number = TAMANHO_MAXIMO_DA_ENTRADA,
): Promise<string> {
  if (fluxo.isTTY) return Promise.resolve('')
  return new Promise((pronto) => {
    const pedacos: Buffer[] = []
    let tamanho = 0
    // Largar duas vezes não faz mal: a promessa só aceita a primeira resposta e destruir de novo é inócuo.
    const largar = (): void => {
      fluxo.destroy()
      pronto('')
    }
    // `unref`: o relógio sozinho não segura o processo depois que a entrada foi largada.
    const relogio = setTimeout(largar, esperaMs).unref()
    fluxo.on('data', (pedaco: Buffer) => {
      tamanho += pedaco.length
      if (tamanho > tamanhoMaximo) largar()
      else pedacos.push(pedaco)
    })
    fluxo.on('end', () => {
      clearTimeout(relogio)
      pronto(Buffer.concat(pedacos).toString('utf8'))
    })
    fluxo.on('error', largar)
  })
}

export interface Processo {
  stdin: Readable & { isTTY?: boolean }
  stdout: Writable
  env: Record<string, string | undefined>
  dbPath: string
  /** Quem lê o git na abertura; ausente = o git de verdade. */
  lerGit?: LerGit
}

export async function rodarComoPrograma(p: Processo): Promise<void> {
  // O Claude Code pode fechar o cano antes de ler; isso não pode virar código de saída diferente de 0.
  p.stdout.on('error', () => {})
  const opcoes = { dbPath: p.dbPath, pastaDoAmbiente: p.env.CLAUDE_PROJECT_DIR }
  const saida = await executarGanchoComGit(await lerEntrada(p.stdin), opcoes, p.lerGit)
  // `Buffer.from` de um texto codifica em UTF-8: os acentos chegam intactos ao Claude Code.
  if (saida !== '') p.stdout.write(Buffer.from(saida))
  process.exitCode = 0
}

/** Este arquivo foi chamado como programa (e não importado)? Compara caminhos sem diferenciar grafia. */
export function ehOProgramaPrincipal(urlDoModulo: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && normalizarPasta(fileURLToPath(urlDoModulo)) === normalizarPasta(resolve(argv1))
}

if (ehOProgramaPrincipal(import.meta.url, process.argv[1])) {
  void rodarComoPrograma({ stdin: process.stdin, stdout: process.stdout, env: process.env, dbPath: dbPathDaConfiguracao })
}
