// Lê o fim da conversa do Claude Code (arquivo JSONL em `transcript_path`) para o rascunho automático.
// Só o fim do arquivo é lido (a conversa pode ter centenas de MB); linha cortada, linha de tipo
// desconhecido ou JSON inválido é pulada sem quebrar nada (Review Focus 4).
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { tirarBlocosInjetados } from './blocos-injetados.js'

export interface FimDaConversa {
  /** Últimas mensagens de texto (dono e Claude), até o limite, sem partir palavra. */
  texto: string
  pedidosDoDono: number
  /** Texto de cada pedido do dono, na ordem, aparado e sem corte (D6: a seção de pedidos do rascunho). */
  pedidos: string[]
  usosDeFerramenta: number
  /** Hora do último pedido do dono (campo `timestamp` da linha); '' quando nenhum pedido trouxe hora. */
  ultimoPedidoEm: string
}

/** Tanto do fim do arquivo é lido; o que vem antes não entra na conta. */
export const JANELA_PADRAO_BYTES = 8 * 1024 * 1024

const VAZIO: FimDaConversa = { texto: '', pedidosDoDono: 0, pedidos: [], usosDeFerramenta: 0, ultimoPedidoEm: '' }

// ---------------------------------------------------------------------------------------------
// Cortes sem partir palavra
// ---------------------------------------------------------------------------------------------

/** Guarda o começo; se o corte cair no meio de uma palavra, para antes dela (palavra gigante: corte seco). */
export function cortarInicioSemPartir(texto: string, limite: number): string {
  if (texto.length <= limite) return texto
  const pedaco = texto.slice(0, limite)
  if (/\s/.test(texto[limite]!)) return pedaco.trimEnd()
  const espaco = pedaco.search(/\s\S*$/)
  return espaco === -1 ? pedaco : pedaco.slice(0, espaco).trimEnd()
}

/** Guarda o fim; se o corte cair no meio de uma palavra, começa depois dela (palavra gigante: corte seco). */
export function cortarFimSemPartir(texto: string, limite: number): string {
  if (texto.length <= limite) return texto
  const inicio = texto.length - limite
  const pedaco = texto.slice(inicio)
  if (/\s/.test(texto[inicio - 1]!)) return pedaco.trimStart()
  const espaco = pedaco.search(/\s/)
  return espaco === -1 ? pedaco : pedaco.slice(espaco).trimStart()
}

// ---------------------------------------------------------------------------------------------
// Leitura do fim do arquivo
// ---------------------------------------------------------------------------------------------

/** Linhas inteiras do fim do arquivo; a primeira é descartada quando a janela começou no meio dela. */
function linhasDoFim(caminho: string | undefined, janelaBytes: number): string[] {
  // Caminho ausente: `openSync` recusa, e quem chama devolve a conversa vazia.
  const fd = openSync(caminho as string, 'r')
  try {
    const tamanho = fstatSync(fd).size
    const inicio = Math.max(0, tamanho - janelaBytes)
    // Um byte a mais antes da janela diz se ela começa numa linha nova.
    const antes = inicio > 0 ? 1 : 0
    const buffer = Buffer.alloc(tamanho - inicio + antes)
    readSync(fd, buffer, 0, buffer.length, inicio - antes)
    const linhas = buffer.toString('utf8').split('\n')
    return antes === 1 ? linhas.slice(1) : linhas
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------------------------
// O que cada linha conta
// ---------------------------------------------------------------------------------------------

type Registro = Record<string, unknown>

interface Contagem {
  mensagens: string[]
  pedidos: string[]
  usosDeFerramenta: number
  ultimoPedidoEm: string
}

/**
 * Linha inválida vira null. Linha que é texto, número ou lista passa adiante e simplesmente não tem
 * `type` de mensagem, então não conta.
 */
function interpretar(linha: string): Registro | null {
  try {
    return JSON.parse(linha) as Registro | null
  } catch {
    return null
  }
}

function partes(registro: Registro): unknown[] | string | null {
  const mensagem = registro.message as Registro | undefined
  const conteudo = mensagem?.content
  if (typeof conteudo === 'string' || Array.isArray(conteudo)) return conteudo
  return null
}

/** Parte que é texto ou número não tem `type`; só `null` precisa de cuidado. */
function ehParte(parte: unknown, tipo: string): parte is Registro {
  return parte !== null && (parte as Registro).type === tipo
}

function textoDasPartes(lista: unknown[]): string {
  return lista
    .filter((parte) => ehParte(parte, 'text') && typeof parte.text === 'string')
    .map((parte) => (parte as Registro).text as string)
    .join('')
}

/**
 * O Claude Code grava como `user` também o que não foi o dono quem escreveu: comandos de barra, a saída
 * deles e o aviso de interrupção. Esses textos começam sempre por uma destas marcas.
 */
const COMECOS_DE_TEXTO_DE_SISTEMA = ['<command-name>', '<command-message>', '<local-command-', '[Request interrupted']

function ehTextoDeSistema(texto: string): boolean {
  return COMECOS_DE_TEXTO_DE_SISTEMA.some((comeco) => texto.startsWith(comeco))
}

/**
 * Pedido do dono: linha `user` de gente (não meta, não subagente, não notificação, não o resumo que a
 * compactação injeta), com texto e sem `tool_result`.
 */
function textoDoDono(registro: Registro): string | null {
  const origem = registro.origin as Registro | undefined
  if (registro.isMeta === true || registro.isCompactSummary === true || (origem !== undefined && origem.kind !== 'human')) return null
  const conteudo = partes(registro)
  if (conteudo === null) return null
  if (typeof conteudo === 'string') return conteudo
  if (conteudo.some((parte) => ehParte(parte, 'tool_result'))) return null
  return textoDasPartes(conteudo)
}

function contarDono(registro: Registro, contagem: Contagem): void {
  const bruto = textoDoDono(registro)
  if (bruto === null) return
  // Blocos que ferramentas injetaram na mensagem saem; se não sobrar texto, não foi o dono quem pediu.
  const texto = tirarBlocosInjetados(bruto).trim()
  if (!texto || ehTextoDeSistema(texto)) return
  contagem.pedidos.push(texto)
  contagem.mensagens.push(`Dono: ${texto}`)
  if (typeof registro.timestamp === 'string') contagem.ultimoPedidoEm = registro.timestamp
}

function contarClaude(registro: Registro, contagem: Contagem): void {
  const conteudo = partes(registro)
  if (!Array.isArray(conteudo)) return
  contagem.usosDeFerramenta += conteudo.filter((parte) => ehParte(parte, 'tool_use')).length
  const texto = textoDasPartes(conteudo).trim()
  if (texto) contagem.mensagens.push(`Claude: ${texto}`)
}

function contarLinha(linha: string, contagem: Contagem): void {
  const registro = interpretar(linha)
  if (registro === null || registro.isSidechain === true) return
  if (registro.type === 'user') contarDono(registro, contagem)
  if (registro.type === 'assistant') contarClaude(registro, contagem)
}

export function lerFimDaConversa(
  caminho: string | undefined,
  limiteCaracteres: number,
  janelaBytes: number = JANELA_PADRAO_BYTES,
): FimDaConversa {
  let linhas: string[]
  try {
    linhas = linhasDoFim(caminho, janelaBytes)
  } catch {
    return { ...VAZIO }
  }
  const contagem: Contagem = { mensagens: [], pedidos: [], usosDeFerramenta: 0, ultimoPedidoEm: '' }
  for (const linha of linhas) contarLinha(linha, contagem)
  return {
    texto: cortarFimSemPartir(contagem.mensagens.join('\n\n'), limiteCaracteres),
    pedidosDoDono: contagem.pedidos.length,
    pedidos: contagem.pedidos,
    usosDeFerramenta: contagem.usosDeFerramenta,
    ultimoPedidoEm: contagem.ultimoPedidoEm,
  }
}
